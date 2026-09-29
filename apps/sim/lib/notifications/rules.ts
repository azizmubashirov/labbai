/**
 * The rules of a workflow's Notifications block: what the block stores on the canvas and what a
 * deploy turns into `notification_trigger` rows. Client-safe (no server imports) so the block's
 * rule editor and the deploy sync read the stored value the same way.
 */
import {
  NOTIFICATION_CONDITION_MAX_LENGTH,
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EXTRACT_SPEC_MAX_LENGTH,
  NOTIFICATION_MAX_COOLDOWN_MINUTES,
  NOTIFICATION_MAX_PAUSE_MINUTES,
  NOTIFICATION_MAX_TRIGGERS,
  NOTIFICATION_NAME_MAX_LENGTH,
  NOTIFICATION_PAUSE_MODES,
  NOTIFICATION_PAUSE_NOTICE_MAX_LENGTH,
  NOTIFICATION_RULES_SUBBLOCK_ID,
  NOTIFICATION_TRIGGER_DIRECTIONS,
  NOTIFICATIONS_BLOCK_TYPE,
  type NotificationEventKey,
  type NotificationPauseMode,
  type NotificationTriggerDirection,
} from '@/lib/notifications/constants'

/** One alert rule of a Notifications block, as stored in its `rules` sub-block. */
export interface NotificationRule {
  /** Stable per rule, so a redeploy keeps its trigger row (and its cooldown history). */
  id: string
  name: string
  /** When: the customer's message, the agent's reply, or a workflow event. */
  direction: NotificationTriggerDirection
  /** The rule in the operator's own words; only for message rules. */
  condition: string
  /** The event it watches; only for event rules. */
  eventKey: NotificationEventKey | null
  /** Details the judge should pull out of the conversation when the rule fires. */
  extractSpec: string
  pauseMode: NotificationPauseMode
  pauseMinutes: number
  autoResume: boolean
  /** Sent to the customer when the rule pauses the AI; empty sends nothing. */
  pauseNotice: string
  cooldownMinutes: number
  oncePerConversation: boolean
  isActive: boolean
}

export const DEFAULT_NOTIFICATION_PAUSE_MINUTES = 15
export const DEFAULT_NOTIFICATION_COOLDOWN_MINUTES = 60

/** Rule ids travel into trigger row ids, so they stay short and URL-safe. */
const RULE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function wholeMinutes(value: unknown, min: number, max: number, fallback: number): number {
  const minutes = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(minutes)) return fallback
  return Math.min(max, Math.max(min, Math.round(minutes)))
}

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function isEventKey(value: unknown): value is NotificationEventKey {
  return typeof value === 'string' && (NOTIFICATION_EVENT_KEYS as readonly string[]).includes(value)
}

/** A new rule with the editor's defaults. */
export function createNotificationRule(id: string): NotificationRule {
  return {
    id,
    name: '',
    direction: 'inbound',
    condition: '',
    eventKey: null,
    extractSpec: '',
    pauseMode: 'none',
    pauseMinutes: DEFAULT_NOTIFICATION_PAUSE_MINUTES,
    autoResume: true,
    pauseNotice: '',
    cooldownMinutes: DEFAULT_NOTIFICATION_COOLDOWN_MINUTES,
    oncePerConversation: false,
    isActive: true,
  }
}

/**
 * Reads one stored rule into its full shape: trims and caps text, clamps minutes, drops unknown
 * enum values, and clears the half that does not apply (an event rule keeps no condition, a
 * message rule no event). Null only for a value that is not a rule object at all.
 */
export function coerceNotificationRule(value: unknown, index: number): NotificationRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : ''
  const direction = oneOf(NOTIFICATION_TRIGGER_DIRECTIONS, raw.direction, 'inbound')
  const isEvent = direction === 'event'
  const eventKey = raw.eventKey
  return {
    id: RULE_ID_PATTERN.test(rawId) ? rawId : `rule-${index + 1}`,
    name: text(raw.name, NOTIFICATION_NAME_MAX_LENGTH),
    direction,
    condition: isEvent ? '' : text(raw.condition, NOTIFICATION_CONDITION_MAX_LENGTH),
    eventKey: isEvent && isEventKey(eventKey) ? eventKey : null,
    extractSpec: isEvent ? '' : text(raw.extractSpec, NOTIFICATION_EXTRACT_SPEC_MAX_LENGTH),
    pauseMode: oneOf(NOTIFICATION_PAUSE_MODES, raw.pauseMode, 'none'),
    pauseMinutes: wholeMinutes(
      raw.pauseMinutes,
      1,
      NOTIFICATION_MAX_PAUSE_MINUTES,
      DEFAULT_NOTIFICATION_PAUSE_MINUTES
    ),
    autoResume: raw.autoResume !== false,
    pauseNotice: text(raw.pauseNotice, NOTIFICATION_PAUSE_NOTICE_MAX_LENGTH),
    cooldownMinutes: wholeMinutes(
      raw.cooldownMinutes,
      0,
      NOTIFICATION_MAX_COOLDOWN_MINUTES,
      DEFAULT_NOTIFICATION_COOLDOWN_MINUTES
    ),
    oncePerConversation: raw.oncePerConversation === true,
    isActive: raw.isActive !== false,
  }
}

/**
 * The rules stored in a Notifications block's `rules` sub-block, in order. Tolerates anything:
 * a missing or malformed value reads as no rules, and duplicate ids are made unique so every
 * rule keeps its own trigger row.
 */
export function readNotificationRules(value: unknown): NotificationRule[] {
  let parsed = value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const rules: NotificationRule[] = []
  parsed.forEach((entry, index) => {
    const rule = coerceNotificationRule(entry, index)
    if (!rule) return
    const id = seen.has(rule.id) ? `${rule.id}-${index + 1}` : rule.id
    seen.add(id)
    rules.push({ ...rule, id })
  })
  return rules
}

/**
 * Why a rule cannot take effect, in the words the editor shows; null when it can. A message rule
 * needs a condition for the judge to read, an event rule the event it watches.
 */
export function notificationRuleProblem(
  rule: Pick<NotificationRule, 'name' | 'direction' | 'condition' | 'eventKey'>
): string | null {
  if (!rule.name.trim()) return 'Give the rule a name'
  if (rule.direction === 'event') return rule.eventKey ? null : 'Choose the event to watch'
  return rule.condition.trim() ? null : 'Describe when the alert should fire'
}

/** A block of a stored workflow state, as much of it as the deploy sync reads. */
interface StoredBlockLike {
  type?: unknown
  enabled?: unknown
  subBlocks?: Record<string, { value?: unknown } | undefined>
}

/** One deployable rule and the Notifications block it came from. */
export interface DeployedNotificationRule {
  blockId: string
  rule: NotificationRule
}

/**
 * The rules a deployed workflow state puts into effect: those of its enabled Notifications
 * blocks that can take effect, in canvas order, at most {@link NOTIFICATION_MAX_TRIGGERS}.
 */
export function collectDeployedNotificationRules(
  blocks: Record<string, unknown> | undefined | null
): DeployedNotificationRule[] {
  const collected: DeployedNotificationRule[] = []
  for (const [blockId, value] of Object.entries(blocks ?? {})) {
    if (!value || typeof value !== 'object') continue
    const block = value as StoredBlockLike
    if (block.type !== NOTIFICATIONS_BLOCK_TYPE || block.enabled === false) continue
    const stored = block.subBlocks?.[NOTIFICATION_RULES_SUBBLOCK_ID]?.value
    for (const rule of readNotificationRules(stored)) {
      if (notificationRuleProblem(rule)) continue
      collected.push({ blockId, rule })
    }
  }
  return collected.slice(0, NOTIFICATION_MAX_TRIGGERS)
}

/**
 * The `notification_trigger` id of a deployed rule. Deterministic, so redeploying an unchanged
 * (or edited) rule updates its row instead of replacing it: its alert history — what cooldown
 * and once-per-conversation are checked against — survives the redeploy.
 */
export function notificationTriggerRowId(workflowId: string, blockId: string, ruleId: string) {
  return `ntr_${workflowId}_${blockId}_${ruleId}`
}
