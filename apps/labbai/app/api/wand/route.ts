import { db } from '@labbai/db'
import { workflow } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { wandGenerateContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  resolveBillingAttribution,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier } from '@/lib/core/config/env-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { enrichTableSchema } from '@/lib/table/llm/wand'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import {
  createOpenAIFetch,
  getOpenAIAuthHeaders,
  getOpenAIBaseUrl,
  isOpenAIGatewayMode,
  OPENAI_GATEWAY_API_KEY,
} from '@/providers/openai/client-config'
import { isOpenAIReasoningModelId, OPENAI_DEFAULT_MODEL } from '@/providers/openai/model-ids'
import { calculateCost } from '@/providers/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const logger = createLogger('WandGenerateAPI')

/**
 * Labbai: wand runs on the platform OpenAI key (OPENAI_API_KEY) or the Cloudflare
 * AI Gateway (CLOUDFLARE_AIG_TOKEN) — no BYOK, no Azure.
 */
const WAND_MODEL = OPENAI_DEFAULT_MODEL
const WAND_MAX_OUTPUT_TOKENS = 10000

function isWandConfigured(): boolean {
  return isOpenAIGatewayMode() || Boolean(env.OPENAI_API_KEY)
}

if (!isWandConfigured()) {
  logger.warn('OPENAI_API_KEY is not configured. Wand generation API will not function.')
}

/**
 * In gateway mode the SDK still gets a placeholder `apiKey` (its constructor
 * requires one) and `createOpenAIFetch` strips the `Authorization` header it
 * builds from it, so only `cf-aig-authorization` reaches Cloudflare.
 */
function createWandClient(): OpenAI {
  const gateway = isOpenAIGatewayMode()
  return new OpenAI({
    apiKey: gateway ? OPENAI_GATEWAY_API_KEY : env.OPENAI_API_KEY,
    baseURL: getOpenAIBaseUrl(),
    defaultHeaders: getOpenAIAuthHeaders(),
    fetch: createOpenAIFetch(),
  })
}

/** Sampling params for the wand model: GPT-5 family rejects `temperature`/`max_tokens`. */
function wandSamplingParams(): {
  temperature?: number
  max_tokens?: number
  max_completion_tokens?: number
} {
  return isOpenAIReasoningModelId(WAND_MODEL)
    ? { max_completion_tokens: WAND_MAX_OUTPUT_TOKENS }
    : { temperature: 0.2, max_tokens: WAND_MAX_OUTPUT_TOKENS }
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

/**
 * Wand enricher function type.
 * Enrichers add context to the system prompt based on generationType.
 */
type WandEnricher = (
  workspaceId: string | null,
  context: Record<string, unknown>
) => Promise<string | null>

/**
 * Registry of wand enrichers by generationType.
 * Each enricher returns additional context to append to the system prompt.
 */
const wandEnrichers: Partial<Record<string, WandEnricher>> = {
  timestamp: async () => {
    const now = new Date()
    return `Current date and time context for reference:
- Current UTC timestamp: ${now.toISOString()}
- Current Unix timestamp (seconds): ${Math.floor(now.getTime() / 1000)}
- Current Unix timestamp (milliseconds): ${now.getTime()}
- Current date (UTC): ${now.toISOString().split('T')[0]}
- Current year: ${now.getUTCFullYear()}
- Current month: ${now.getUTCMonth() + 1}
- Current day of month: ${now.getUTCDate()}
- Current day of week: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getUTCDay()]}

Use this context to calculate relative dates like "yesterday", "last week", "beginning of this month", etc.`
  },

  'table-schema': enrichTableSchema,
}

async function updateUserStatsForWand(
  billingAttribution: BillingAttributionSnapshot,
  usage: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  },
  requestId: string
): Promise<void> {
  if (!usage.total_tokens || usage.total_tokens <= 0) {
    return
  }

  try {
    const promptTokens = usage.prompt_tokens || 0
    const completionTokens = usage.completion_tokens || 0
    const costToStore =
      calculateCost(WAND_MODEL, promptTokens, completionTokens).total * getCostMultiplier()

    await recordUsage({
      userId: billingAttribution.actorUserId,
      workspaceId: billingAttribution.workspaceId ?? undefined,
      ...toBillingContext(billingAttribution),
      entries: [
        {
          category: 'model',
          source: 'wand',
          description: WAND_MODEL,
          cost: costToStore,
          sourceReference: `wand:${requestId}`,
          metadata: { inputTokens: promptTokens, outputTokens: completionTokens },
        },
      ],
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to update user stats for wand usage`, error)
  }
}

export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Received wand generation request`)

  const session = await getSession()
  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthorized wand generation attempt`)
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(wandGenerateContract, req, {})
    if (!parsed.success) return parsed.response
    const { body } = parsed.data

    const {
      prompt,
      systemPrompt,
      stream = false,
      history = [],
      workflowId,
      workspaceId: requestedWorkspaceId,
      generationType,
      wandContext = {},
    } = body

    if (!prompt) {
      logger.warn(`[${requestId}] Invalid request: Missing prompt.`)
      return NextResponse.json(
        { success: false, error: 'Missing required field: prompt.' },
        { status: 400 }
      )
    }

    let workspaceId: string | null = null
    if (workflowId) {
      const [workflowRecord] = await db
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflowRecord) {
        logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
        return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 })
      }

      workspaceId = workflowRecord.workspaceId

      if (workflowRecord.workspaceId) {
        const permission = await verifyWorkspaceMembership(
          session.user.id,
          workflowRecord.workspaceId
        )
        if (!permission || (permission !== 'admin' && permission !== 'write')) {
          logger.warn(
            `[${requestId}] User ${session.user.id} does not have write access to workspace for workflow ${workflowId}`
          )
          return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }
      } else {
        logger.warn(
          `[${requestId}] Workflow ${workflowId} has no workspaceId; wand request blocked`
        )
        return NextResponse.json(
          {
            success: false,
            error:
              'This workflow is not attached to a workspace. Personal workflows are deprecated and cannot be accessed.',
          },
          { status: 403 }
        )
      }
    } else if (requestedWorkspaceId) {
      // No workflow entity to resolve from (e.g. table-schema wand or an
      // unhydrated editor); attribute to the workspace the wand is running in,
      // but only when the caller is a member so usage can't be misattributed.
      const permission = await verifyWorkspaceMembership(session.user.id, requestedWorkspaceId)
      if (permission) {
        workspaceId = requestedWorkspaceId
      }
    }

    // Per-member usage must be attributable to an org workspace. The editor always
    // supplies a workflow or a workspace the caller belongs to; refuse to run rather
    // than stamp usage workspace-less (which would silently skip the per-member cap).
    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: 'Workspace context is required.' },
        { status: 400 }
      )
    }

    /** Wand is an interactive action attributed to the authenticated human. */
    const actorUserId = session.user.id
    const billingAttribution = await resolveBillingAttribution({
      actorUserId,
      workspaceId,
    })

    if (!isWandConfigured()) {
      logger.error(
        `[${requestId}] AI client not initialized. Missing OPENAI_API_KEY or CLOUDFLARE_AIG_TOKEN.`
      )
      return NextResponse.json(
        { success: false, error: 'Wand generation service is not configured.' },
        { status: 503 }
      )
    }

    const usageCheck = await checkAttributedUsageLimits(billingAttribution)
    if (usageCheck.isExceeded) {
      return NextResponse.json(
        {
          success: false,
          error:
            usageCheck.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
          scope: usageCheck.scope,
        },
        { status: 402 }
      )
    }

    let finalSystemPrompt =
      systemPrompt ||
      'You are a helpful AI assistant. Generate content exactly as requested by the user.'

    // Apply enricher if one exists for this generationType
    if (generationType) {
      const enricher = wandEnrichers[generationType]
      if (enricher) {
        const enrichment = await enricher(workspaceId, wandContext)
        if (enrichment) {
          finalSystemPrompt += `\n\n${enrichment}`
        }
      }
    }

    if (generationType === 'cron-expression') {
      finalSystemPrompt +=
        '\n\nIMPORTANT: Return ONLY the raw cron expression (e.g., "0 9 * * 1-5"). Do NOT wrap it in markdown code blocks, backticks, or quotes. Do NOT include any explanation or text before or after the expression.'
    }

    // Both the JavaScript and Python function-body prompts share this type, so
    // the reinforcement stays language-neutral.
    if (generationType === 'javascript-function-body') {
      finalSystemPrompt +=
        '\n\nIMPORTANT: Return ONLY the raw function body. Do NOT wrap it in markdown code blocks (no ```javascript, no ```python, no ```). Do NOT include any explanation before or after the code.'
    }

    if (generationType === 'json-object') {
      finalSystemPrompt +=
        '\n\nIMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (no ```json or ```). Do NOT include any explanation or text before or after the JSON. The response must start with { and end with }.'
    }

    // Separate from json-object: that reinforcement demands braces, which would
    // fight a field whose contract is an array.
    if (generationType === 'json-array') {
      finalSystemPrompt +=
        '\n\nIMPORTANT: Return ONLY the raw JSON array. Do NOT wrap it in markdown code blocks (no ```json or ```). Do NOT include any explanation or text before or after the JSON. The response must start with [ and end with ].'
    }

    const messages: ChatMessage[] = [{ role: 'system', content: finalSystemPrompt }]

    messages.push(...history.filter((msg) => msg.role !== 'system'))

    messages.push({ role: 'user', content: prompt })

    const client = createWandClient()

    if (stream) {
      try {
        logger.info(`[${requestId}] About to create stream with model: ${WAND_MODEL}`)

        const completionStream = await client.chat.completions.create({
          model: WAND_MODEL,
          messages,
          ...wandSamplingParams(),
          stream: true,
          stream_options: { include_usage: true },
        })

        logger.info(`[${requestId}] Stream response received, starting processing`)

        const encoder = new TextEncoder()

        const readable = new ReadableStream({
          async start(controller) {
            let finalUsage: {
              prompt_tokens?: number
              completion_tokens?: number
              total_tokens?: number
            } | null = null
            let usageRecorded = false

            const flushUsage = async () => {
              if (usageRecorded || !finalUsage) {
                return
              }

              usageRecorded = true
              await updateUserStatsForWand(billingAttribution, finalUsage, requestId)
            }

            try {
              let chunkCount = 0

              for await (const chunk of completionStream) {
                const content = chunk.choices?.[0]?.delta?.content
                if (content) {
                  chunkCount++
                  if (chunkCount === 1) {
                    logger.info(`[${requestId}] Received first content chunk`)
                  }

                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ chunk: content })}\n\n`)
                  )
                }

                if (chunk.usage) {
                  finalUsage = {
                    prompt_tokens: chunk.usage.prompt_tokens,
                    completion_tokens: chunk.usage.completion_tokens,
                    total_tokens: chunk.usage.total_tokens,
                  }
                  logger.info(`[${requestId}] Received usage data: ${JSON.stringify(finalUsage)}`)
                }
              }

              logger.info(`[${requestId}] Stream completed. Total chunks: ${chunkCount}`)
              await flushUsage()
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
              controller.close()
            } catch (streamError: any) {
              logger.error(`[${requestId}] Streaming error`, {
                name: streamError?.name,
                message: streamError?.message || 'Unknown error',
                stack: streamError?.stack,
              })

              try {
                await flushUsage()
              } catch (usageError) {
                logger.warn(`[${requestId}] Failed to record usage after stream error`, usageError)
              }

              const errorData = `data: ${JSON.stringify({ error: 'Streaming failed', done: true })}\n\n`
              controller.enqueue(encoder.encode(errorData))
              controller.close()
            }
          },
          cancel() {
            completionStream.controller?.abort()
          },
        })

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      } catch (error: any) {
        logger.error(`[${requestId}] Failed to create stream`, {
          name: error?.name,
          message: error?.message || 'Unknown error',
          code: error?.code,
          status: error?.status,
          stack: error?.stack,
          model: WAND_MODEL,
        })

        return NextResponse.json(
          { success: false, error: 'An error occurred during wand generation streaming.' },
          { status: 500 }
        )
      }
    }

    const completion = await client.chat.completions.create({
      model: WAND_MODEL,
      messages,
      ...wandSamplingParams(),
    })

    const generatedContent = completion.choices?.[0]?.message?.content?.trim()

    if (!generatedContent) {
      logger.error(`[${requestId}] OpenAI response was empty or invalid.`)
      return NextResponse.json(
        { success: false, error: 'Failed to generate content. AI response was empty.' },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Wand generation successful`)

    if (completion.usage) {
      await updateUserStatsForWand(
        billingAttribution,
        {
          prompt_tokens: completion.usage.prompt_tokens,
          completion_tokens: completion.usage.completion_tokens,
          total_tokens: completion.usage.total_tokens,
        },
        requestId
      )
    }

    return NextResponse.json({ success: true, content: generatedContent })
  } catch (error: any) {
    logger.error(`[${requestId}] Wand generation failed`, {
      name: error?.name,
      message: error?.message || 'Unknown error',
      code: error?.code,
      status: error?.status,
      stack: error?.stack,
      model: WAND_MODEL,
    })

    let clientErrorMessage = 'Wand generation failed. Please try again later.'
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500

    if (status === 401) {
      clientErrorMessage = 'Authentication failed. Please check your API key configuration.'
    } else if (status === 429) {
      clientErrorMessage = 'Rate limit exceeded. Please try again later.'
    } else if (status >= 500) {
      clientErrorMessage =
        'The wand generation service is currently unavailable. Please try again later.'
    }

    return NextResponse.json(
      {
        success: false,
        error: clientErrorMessage,
      },
      { status }
    )
  }
})
