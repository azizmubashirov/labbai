/**
 * Labbai operator notifications: the shared vocabulary of triggers, events and pause modes.
 * Client-safe (no server imports) so contracts, the Notifications block and the Notify block
 * share it.
 */

/**
 * The canvas block that configures a workflow's notifications. It never runs: its rules become
 * the workflow's `notification_trigger` rows when the workflow is deployed.
 */
export const NOTIFICATIONS_BLOCK_TYPE = 'notifications'

/** Sub-block of the Notifications block that holds its rules (a `NotificationRule[]`). */
export const NOTIFICATION_RULES_SUBBLOCK_ID = 'rules'

/** Sub-block of the Notifications block that manages its Telegram recipients (no stored value). */
export const NOTIFICATION_RECIPIENTS_SUBBLOCK_ID = 'recipients'

/** Which messages a trigger judges: the customer's, the agent's, or a workflow event. */
export const NOTIFICATION_TRIGGER_DIRECTIONS = ['inbound', 'outbound', 'event'] as const
export type NotificationTriggerDirection = (typeof NOTIFICATION_TRIGGER_DIRECTIONS)[number]

/**
 * What a fired trigger does to the AI of its conversation: nothing, off for a while (back on by
 * itself), or off until an operator turns it back on.
 */
export const NOTIFICATION_PAUSE_MODES = ['none', 'temporary', 'hard'] as const
export type NotificationPauseMode = (typeof NOTIFICATION_PAUSE_MODES)[number]

/**
 * Events a workflow reports through the Notify block. They fire without a model call: the
 * workflow knows they happened.
 */
export const NOTIFICATION_EVENT_KEYS = [
  'operator_handoff',
  'booking_link_sent',
  'payment_receipt',
] as const
export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number]

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventKey, string> = {
  operator_handoff: 'Customer handed to an operator',
  booking_link_sent: 'Booking link sent to the customer',
  payment_receipt: 'Customer sent a payment receipt',
}

export const NOTIFICATION_DIRECTION_LABELS: Record<NotificationTriggerDirection, string> = {
  inbound: 'Customer message',
  outbound: 'Agent reply',
  event: 'Workflow event',
}

export const NOTIFICATION_PAUSE_MODE_LABELS: Record<NotificationPauseMode, string> = {
  none: "Don't pause AI",
  temporary: 'Pause AI for a while',
  hard: 'Turn AI off until an operator turns it on',
}

/** Rules per workflow. One LLM call judges them all, so the prompt must stay small. */
export const NOTIFICATION_MAX_TRIGGERS = 10

/** Recipients (Telegram chats) per workflow. */
export const NOTIFICATION_MAX_RECIPIENTS = 20

/** Longest pause a temporary trigger can set: one day. */
export const NOTIFICATION_MAX_PAUSE_MINUTES = 24 * 60

/** Longest cooldown between repeat alerts from one trigger in one conversation: one week. */
export const NOTIFICATION_MAX_COOLDOWN_MINUTES = 7 * 24 * 60

export const NOTIFICATION_NAME_MAX_LENGTH = 120
export const NOTIFICATION_CONDITION_MAX_LENGTH = 2000
export const NOTIFICATION_EXTRACT_SPEC_MAX_LENGTH = 500
export const NOTIFICATION_PAUSE_NOTICE_MAX_LENGTH = 1000
/** A free-form Notify block message; Telegram allows 4096 characters per message. */
export const NOTIFICATION_MESSAGE_MAX_LENGTH = 3000
