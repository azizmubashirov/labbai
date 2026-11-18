import type {
  InstagramAutoReplyDmStage,
  InstagramAutoReplyEventOutcome,
  InstagramAutoReplyKeywordMode,
  InstagramAutoReplyMediaScope,
  InstagramAutoReplyRuleStatus,
  InstagramAutoReplyTriggerType,
} from '@labbai/db/schema'

export const INSTAGRAM_AUTO_REPLY_RULE_STATUSES = [
  'draft',
  'live',
  'paused',
] as const satisfies readonly InstagramAutoReplyRuleStatus[]

/** Statuses a rule can be switched to from the list or editor; `draft` is only the initial state. */
export const INSTAGRAM_AUTO_REPLY_SETTABLE_STATUSES = [
  'live',
  'paused',
] as const satisfies readonly InstagramAutoReplyRuleStatus[]

export const INSTAGRAM_AUTO_REPLY_TRIGGER_TYPES = [
  'comment',
  'live_comment',
  'story_reply',
  'story_mention',
] as const satisfies readonly InstagramAutoReplyTriggerType[]

/** Story triggers have no "next post"; they apply to any story or to listed ones. */
export const INSTAGRAM_AUTO_REPLY_STORY_TRIGGER_TYPES = [
  'story_reply',
  'story_mention',
] as const satisfies readonly InstagramAutoReplyTriggerType[]

export const INSTAGRAM_AUTO_REPLY_MEDIA_SCOPES = [
  'specific',
  'any',
  'next',
] as const satisfies readonly InstagramAutoReplyMediaScope[]

export const INSTAGRAM_AUTO_REPLY_KEYWORD_MODES = [
  'include',
  'exclude',
  'any',
] as const satisfies readonly InstagramAutoReplyKeywordMode[]

export const INSTAGRAM_AUTO_REPLY_EVENT_OUTCOMES = [
  'pending',
  'replied',
  'partial',
  'skipped_duplicate',
  'handoff',
  'expired',
  'failed',
] as const satisfies readonly InstagramAutoReplyEventOutcome[]

/** Outcomes that count as "this user already got an answer on this post". */
export const INSTAGRAM_AUTO_REPLY_ANSWERED_OUTCOMES = [
  'replied',
  'partial',
] as const satisfies readonly InstagramAutoReplyEventOutcome[]

export const INSTAGRAM_AUTO_REPLY_DM_STAGES = [
  'opening',
  'follow_gate',
  'delivered',
] as const satisfies readonly InstagramAutoReplyDmStage[]

export const INSTAGRAM_AUTO_REPLY_RULE_NAME_MAX_LENGTH = 100
/** Most rules one workspace can hold; also bounds list, reorder, and engine lookups. */
export const INSTAGRAM_AUTO_REPLY_MAX_RULES = 200
export const INSTAGRAM_AUTO_REPLY_MAX_MEDIA_IDS = 50
export const INSTAGRAM_AUTO_REPLY_MEDIA_ID_MAX_LENGTH = 128
export const INSTAGRAM_AUTO_REPLY_MAX_KEYWORDS = 30
export const INSTAGRAM_AUTO_REPLY_KEYWORD_MAX_LENGTH = 50
export const INSTAGRAM_AUTO_REPLY_MAX_PUBLIC_REPLIES = 10
export const INSTAGRAM_AUTO_REPLY_PUBLIC_REPLY_MAX_LENGTH = 300
export const INSTAGRAM_AUTO_REPLY_MAX_DM_BUTTONS = 3
export const INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH = 20
/** Meta's button-template text limit. */
export const INSTAGRAM_AUTO_REPLY_DM_TEXT_WITH_BUTTONS_MAX_LENGTH = 640
/** Meta's plain-text message limit. */
export const INSTAGRAM_AUTO_REPLY_DM_TEXT_MAX_LENGTH = 1000
export const INSTAGRAM_AUTO_REPLY_URL_MAX_LENGTH = 2000
/** Comment text kept on an event row. */
export const INSTAGRAM_AUTO_REPLY_EVENT_TEXT_MAX_LENGTH = 1000
/** Send error kept on an event row. */
export const INSTAGRAM_AUTO_REPLY_EVENT_ERROR_MAX_LENGTH = 500
export const INSTAGRAM_AUTO_REPLY_EVENTS_PAGE_MAX = 100
export const INSTAGRAM_AUTO_REPLY_EVENTS_PAGE_DEFAULT = 50
/** Posts listed in a stats breakdown, most matched first. */
export const INSTAGRAM_AUTO_REPLY_STATS_MAX_MEDIA = 50
/** Meta allows a private reply only within 7 days of the comment; older comments are `expired`. */
export const INSTAGRAM_AUTO_REPLY_PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
/**
 * A `pending` event untouched for this long belongs to a run that stopped between its claim and
 * its outcome; a redelivery re-opens it. Runs finish within the ingress deadline, far below this.
 */
export const INSTAGRAM_AUTO_REPLY_PENDING_STALE_MS = 2 * 60 * 1000
/**
 * Shared time budget for every Graph call one source makes (public reply and DM together, which
 * run side by side), so one comment cannot hold a send slot for several 10-second timeouts.
 */
export const INSTAGRAM_AUTO_REPLY_SOURCE_SEND_BUDGET_MS = 12_000
/** Comments the engine answers at once across one whole webhook delivery. */
export const INSTAGRAM_AUTO_REPLY_SEND_CONCURRENCY = 5
/** Public path of the tracked DM link redirect; the event id and button index follow it. */
export const INSTAGRAM_AUTO_REPLY_REDIRECT_PATH = '/api/instagram/r'
/**
 * Inside Meta's 24-hour messaging window a story reply or mention can be answered by DM. Past it
 * (a Meta redelivery can arrive up to 36 hours late) the event is `expired`.
 */
export const INSTAGRAM_AUTO_REPLY_MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000
/** A story mention is answered at most once per user in this period. */
export const INSTAGRAM_AUTO_REPLY_MENTION_COOLDOWN_MS = 24 * 60 * 60 * 1000
/** Prefix of every postback and quick-reply payload the engine sends and owns. */
export const INSTAGRAM_AUTO_REPLY_PAYLOAD_PREFIX = 'iar:'
/** Meta's limit on a postback button or quick-reply title. */
export const INSTAGRAM_AUTO_REPLY_PROMPT_TITLE_MAX_LENGTH = 20
/** Public path of the Meta data deletion status page; `?code=` carries the confirmation code. */
export const INSTAGRAM_DATA_DELETION_STATUS_PATH = '/instagram/data-deletion'
/** Public path of the data deletion instructions page linked from the Meta app settings. */
export const INSTAGRAM_DATA_DELETION_INSTRUCTIONS_PATH = '/instagram/data-deletion/instructions'
