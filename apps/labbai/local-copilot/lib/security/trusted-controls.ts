import {
  formatOAuthConnectCredentialTag,
  type OAuthConnectControl,
} from '@/local-copilot/lib/oauth-connect-text'
import { LOCAL_OPS_COUNTERS, recordLocalOpsEvent } from '@/local-copilot/lib/ops/metrics'

const PRIVILEGED_TAG_NAMES = [
  'credential',
  'workspace_resource',
  'tool_confirmation',
  'workflow_patch',
] as const

export interface GeneratedApiKeyControl {
  type: 'sim_key'
  value: string
}

export type LocalTrustedControl = OAuthConnectControl | GeneratedApiKeyControl

/**
 * Builds a one-time API key control from a successful generate_api_key result.
 */
export function buildGeneratedApiKeyControl(result: unknown): GeneratedApiKeyControl | null {
  if (!result || typeof result !== 'object') return null
  const key = (result as Record<string, unknown>).key
  return typeof key === 'string' && key.trim() ? { type: 'sim_key', value: key } : null
}

/**
 * Converts application-attested control data into the legacy chat renderer format.
 */
export function formatTrustedControl(control: LocalTrustedControl): string {
  if (control.type === 'credential_link') {
    return formatOAuthConnectCredentialTag(control)
  }
  return `<credential>${JSON.stringify({ type: 'sim_key', value: control.value })}</credential>`
}

function noteInjectionStrip(before: string, after: string): void {
  if (before !== after) {
    recordLocalOpsEvent({ counter: LOCAL_OPS_COUNTERS.injectionStripped })
  }
}

/** Env-var style names a model may ask the user to fill in (e.g. TELEGRAM_BOT_TOKEN). */
const SAFE_SECRET_INPUT_NAME = /^[A-Z][A-Z0-9_]{1,63}$/
const SECRET_INPUT_KEYS = new Set(['type', 'name', 'scope'])

/**
 * Model-authored `<credential>` bodies are allowed only when every row is an empty
 * `secret_input` (masked field that saves to the user's own workspace/personal env).
 * Such a card carries no value, URL, or credential id, so it cannot phish or leak;
 * links, keys and every other control stay application-attested only.
 */
function toSafeModelCredentialTag(body: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  const items = Array.isArray(parsed) ? parsed : [parsed]
  if (items.length === 0) return null
  const safe: Array<{ type: 'secret_input'; name: string; scope?: string }> = []
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    if (!Object.keys(record).every((key) => SECRET_INPUT_KEYS.has(key))) return null
    if (record.type !== 'secret_input') return null
    if (typeof record.name !== 'string' || !SAFE_SECRET_INPUT_NAME.test(record.name)) return null
    if (record.scope !== undefined && record.scope !== 'workspace' && record.scope !== 'personal') {
      return null
    }
    safe.push({
      type: 'secret_input',
      name: record.name,
      ...(record.scope ? { scope: record.scope as string } : {}),
    })
  }
  return `<credential>${JSON.stringify(safe)}</credential>`
}

/**
 * Removes security-sensitive controls from model-authored text.
 *
 * Trusted application controls use structured stream events and do not pass
 * through this filter. The one exception is an all-`secret_input` credential card
 * (see {@link toSafeModelCredentialTag}), which is re-serialized and kept.
 */
export function stripUntrustedSecurityControls(content: string, isStreaming: boolean): string {
  let sanitized = content

  for (const tagName of PRIVILEGED_TAG_NAMES) {
    const completeTag = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'gi')
    sanitized = sanitized.replace(completeTag, (_match, body: string) =>
      tagName === 'credential' ? (toSafeModelCredentialTag(body) ?? '') : ''
    )
  }

  if (!isStreaming) {
    noteInjectionStrip(content, sanitized)
    return sanitized
  }

  // Hold back any privileged tag that is still open. Checking only the last `<`
  // leaked the whole body once the closing tag began (`...</credential` before `>`).
  const lower = sanitized.toLowerCase()
  let cut = sanitized.length
  for (const tagName of PRIVILEGED_TAG_NAMES) {
    const openIndex = lower.lastIndexOf(`<${tagName}>`)
    if (openIndex >= 0 && lower.indexOf(`</${tagName}>`, openIndex) < 0) {
      cut = Math.min(cut, openIndex)
    }
  }
  sanitized = sanitized.slice(0, cut)

  const lastOpen = sanitized.lastIndexOf('<')
  if (lastOpen < 0) {
    noteInjectionStrip(content, sanitized)
    return sanitized
  }

  const tail = sanitized.slice(lastOpen).toLowerCase()
  const isPrivilegedTagPrefix = PRIVILEGED_TAG_NAMES.some((tagName) => {
    const opening = `<${tagName}`
    return opening.startsWith(tail) || tail.startsWith(opening)
  })

  const next = isPrivilegedTagPrefix ? sanitized.slice(0, lastOpen) : sanitized
  noteInjectionStrip(content, next)
  return next
}
