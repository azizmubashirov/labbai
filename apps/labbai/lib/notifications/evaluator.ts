import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { isPlainRecord, toRecord } from '@labbai/utils/object'
import { env } from '@/lib/core/config/env'
import { getNotificationModel } from '@/lib/notifications/config'
import {
  getOpenAIAuthHeaders,
  getOpenAIBaseUrl,
  isOpenAIGatewayMode,
} from '@/providers/openai/client-config'
import { isOpenAIReasoningModelId } from '@/providers/openai/model-ids'

const logger = createLogger('NotificationEvaluator')

/**
 * How many recent turns the judge sees: enough to understand the last message, far short of
 * the whole conversation.
 */
export const NOTIFICATION_HISTORY_WINDOW = 6

const REASON_MAX_LENGTH = 500
const DETAIL_MAX_LENGTH = 300
const MAX_DETAILS = 12

/**
 * One call judges every trigger of the turn and extracts what each fired trigger asked for, so
 * ten triggers cost one call. Ported from Mehmon's evaluator; the JSON shape is spelled out
 * because the reply is requested as a plain JSON object.
 */
export const NOTIFICATION_JUDGE_SYSTEM_PROMPT = `You watch one customer-support conversation and decide which of the operator's alert rules just became true.

You are given numbered RULES, each written by the operator in their own words, and the recent conversation. Judge ONLY the LAST message marked >>> — the earlier turns are context for understanding it, never a reason to fire.

For each rule decide, independently, whether it is true of that last message.

Be strict. A rule fires only when the situation it describes has ACTUALLY happened, not when it is merely being discussed, asked about, or is likely to happen soon. If you are unsure, do not fire — a false alert wastes a person's attention and trains the operator to ignore alerts.

When a rule fires and asks for extra details, pull them from anywhere in the conversation shown and return them as flat key/value pairs. Use only what is actually there; never invent a name, phone number, date or amount. Omit anything you cannot find.

Return one entry per rule that fired. Return an empty list when nothing fired — that is the normal outcome.

Reply with a JSON object only, in exactly this shape:
{"fired": [{"rule": <number of the rule>, "reason": "<one short sentence: what in the last message made this true>", "details": {"<detail name>": "<value>"}}]}`

/** What the judge needs of a trigger. */
export interface JudgedTrigger {
  name: string
  condition: string
  extractSpec: string
}

/** A recent message of the conversation, oldest first. */
export interface JudgeHistoryMessage {
  author: 'customer' | 'agent' | 'operator'
  text: string
}

export interface NotificationVerdict<T> {
  trigger: T
  reason: string
  details: Record<string, string>
}

function speakerFor(author: JudgeHistoryMessage['author']): string {
  if (author === 'customer') return 'CUSTOMER'
  if (author === 'operator') return 'OPERATOR'
  return 'ASSISTANT'
}

/**
 * The judge's user message: the numbered rules, then the recent turns oldest first, with the
 * message being judged last and marked `>>>`.
 */
export function buildNotificationJudgePrompt(input: {
  triggers: JudgedTrigger[]
  history: JudgeHistoryMessage[]
  text: string
  direction: 'inbound' | 'outbound'
}): string {
  const rules = input.triggers.map((trigger, index) => {
    let block = `RULE ${index + 1}: ${trigger.name}\n${trigger.condition.trim()}`
    if (trigger.extractSpec.trim()) {
      block += `\nIf it fires, also collect: ${trigger.extractSpec.trim()}`
    }
    return block
  })

  const judged = input.text.trim()
  const lines: string[] = []
  for (const message of input.history) {
    const body = message.text.trim()
    if (!body || body === judged) continue
    lines.push(`${speakerFor(message.author)}: ${body}`)
  }
  lines.push(`>>> ${input.direction === 'inbound' ? 'CUSTOMER' : 'ASSISTANT'}: ${judged}`)

  return `${rules.join('\n\n')}\n\n---\nCONVERSATION\n${lines.join('\n')}`
}

function toDetails(value: unknown): Record<string, string> {
  if (!isPlainRecord(value)) return {}
  const details: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value).slice(0, MAX_DETAILS)) {
    if (raw === null || raw === undefined) continue
    const text = (typeof raw === 'string' ? raw : JSON.stringify(raw)).trim()
    if (text && key.trim()) details[key.trim().slice(0, 60)] = text.slice(0, DETAIL_MAX_LENGTH)
  }
  return details
}

/**
 * Reads the judge's reply. Anything malformed means "nothing fired" — the safe direction: a
 * broken judge can miss an alert but never invent one. Rule numbers are 1-based and must name
 * one of the `triggerCount` rules; a rule reported twice counts once.
 */
export function parseNotificationVerdict(
  raw: unknown,
  triggerCount: number
): Array<{ index: number; reason: string; details: Record<string, string> }> {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!isPlainRecord(value) || !Array.isArray(value.fired)) return []

  const seen = new Set<number>()
  const verdicts: Array<{ index: number; reason: string; details: Record<string, string> }> = []
  for (const entry of value.fired) {
    if (!isPlainRecord(entry)) continue
    const rule = typeof entry.rule === 'string' ? Number(entry.rule) : entry.rule
    if (typeof rule !== 'number' || !Number.isInteger(rule)) continue
    const index = rule - 1
    if (index < 0 || index >= triggerCount || seen.has(index)) continue
    seen.add(index)
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : ''
    verdicts.push({
      index,
      reason: reason.slice(0, REASON_MAX_LENGTH),
      details: toDetails(entry.details),
    })
  }
  return verdicts
}

export interface JudgeCompletion {
  content: string | null
  model: string
  promptTokens: number
  completionTokens: number
}

/** Sends the judge's messages to a model and returns its raw reply. */
export type JudgeCompleter = (messages: {
  system: string
  user: string
}) => Promise<JudgeCompletion>

/** Bounds one judge call; the customer's conversation never waits on it. */
const JUDGE_TIMEOUT_MS = 30_000

/**
 * The judge on the platform OpenAI key (`OPENAI_API_KEY`, `OPENAI_BASE_URL`,
 * `OPENAI_EXTRA_HEADERS`) or the Cloudflare AI Gateway (`CLOUDFLARE_AIG_TOKEN`),
 * like wand: one Chat Completions call asking for a JSON object.
 */
export const completeWithOpenAI: JudgeCompleter = async ({ system, user }) => {
  if (!isOpenAIGatewayMode() && !env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured')
  }
  const model = getNotificationModel()
  const sampling = isOpenAIReasoningModelId(model)
    ? { max_completion_tokens: 4000 }
    : { temperature: 0, max_tokens: 800 }

  const response = await fetch(`${getOpenAIBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      ...getOpenAIAuthHeaders(env.OPENAI_API_KEY),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      ...sampling,
    }),
    signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
  })
  const body = toRecord(await response.json().catch(() => ({})))
  if (!response.ok) {
    const message = toRecord(body.error).message
    throw new Error(
      `OpenAI ${response.status}${typeof message === 'string' ? `: ${message}` : ''}`.slice(0, 300)
    )
  }

  const choices = Array.isArray(body.choices) ? body.choices : []
  const content = toRecord(toRecord(choices[0]).message).content
  const usage = toRecord(body.usage)
  return {
    content: typeof content === 'string' ? content : null,
    model,
    promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
    completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
  }
}

/**
 * Asks the model which triggers the judged message makes true. Never throws: a failed judge
 * returns no verdicts, because an alert must never break the customer's conversation.
 * `onUsage` reports the call's token counts when there was a call.
 */
export async function judgeNotificationTriggers<T extends JudgedTrigger>(input: {
  triggers: T[]
  history: JudgeHistoryMessage[]
  text: string
  direction: 'inbound' | 'outbound'
  complete?: JudgeCompleter
  onUsage?: (completion: JudgeCompletion) => Promise<void> | void
}): Promise<Array<NotificationVerdict<T>>> {
  if (input.triggers.length === 0 || !input.text.trim()) return []
  const complete = input.complete ?? completeWithOpenAI

  let completion: JudgeCompletion
  try {
    completion = await complete({
      system: NOTIFICATION_JUDGE_SYSTEM_PROMPT,
      user: buildNotificationJudgePrompt(input),
    })
  } catch (error) {
    logger.error('Notification judge call failed', { error: getErrorMessage(error) })
    return []
  }

  try {
    await input.onUsage?.(completion)
  } catch (error) {
    logger.warn('Could not record notification judge usage', { error: getErrorMessage(error) })
  }

  return parseNotificationVerdict(completion.content ?? '', input.triggers.length).map(
    (verdict) => ({
      trigger: input.triggers[verdict.index],
      reason: verdict.reason,
      details: verdict.details,
    })
  )
}
