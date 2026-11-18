import type {
  CreateInstagramAutoReplyRuleBody,
  InstagramAutoReplyKeywordModeValue,
  InstagramAutoReplyMediaScopeValue,
  InstagramAutoReplyRule,
  InstagramAutoReplyRuleStatusValue,
  InstagramAutoReplyTriggerTypeValue,
} from '@/lib/api/contracts/instagram-auto-reply'
import {
  INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_DM_TEXT_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_DM_TEXT_WITH_BUTTONS_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_KEYWORD_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_MAX_KEYWORDS,
  INSTAGRAM_AUTO_REPLY_PUBLIC_REPLY_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_RULE_NAME_MAX_LENGTH,
} from '@/lib/instagram-auto-reply/constants'
import {
  dedupeList,
  getGoLiveIssues,
  type InstagramAutoReplyRuleIssue,
  supportsPublicReply,
} from '@/lib/instagram-auto-reply/rule-validation'

export const TRIGGER_TYPE_LABELS: Record<InstagramAutoReplyTriggerTypeValue, string> = {
  comment: 'Post comments',
  live_comment: 'Live comments',
  story_reply: 'Story replies',
  story_mention: 'Story mentions',
}

export const RULE_STATUS_LABELS: Record<InstagramAutoReplyRuleStatusValue, string> = {
  draft: 'Draft',
  live: 'Live',
  paused: 'Paused',
}

/** Public reply variants a new rule starts with; one is picked at random per comment. */
export const DEFAULT_PUBLIC_REPLIES = [
  'Thanks! Check your DMs.',
  'Sent you a DM.',
  'Just messaged you.',
] as const

/** Comment shown in the preview when the rule has no keyword to quote. */
export const SAMPLE_COMMENT = 'Love this! How much is it?'

/** An Instagram account (OAuth credential) a rule can reply from. */
export interface InstagramAccountOption {
  id: string
  name: string
}

/** One DM link button while it is being edited. */
export interface DmButtonDraft {
  title: string
  url: string
}

/**
 * The editor's working copy of a rule. Text stays raw while typing (untrimmed, empty variants
 * allowed); {@link toRuleBody} normalizes it on save.
 */
export interface RuleDraft {
  name: string
  credentialId: string
  triggerType: InstagramAutoReplyTriggerTypeValue
  mediaScope: InstagramAutoReplyMediaScopeValue
  mediaIds: string[]
  keywordMode: InstagramAutoReplyKeywordModeValue
  keywords: string[]
  publicReplyEnabled: boolean
  publicReplies: string[]
  dmEnabled: boolean
  dmText: string
  dmButtons: DmButtonDraft[]
  dmImageUrl: string
  handoffToAgent: boolean
  oncePerUserPerPost: boolean
}

/**
 * Error messages keyed by field. List fields use dotted keys for one entry, e.g.
 * `publicReplies.2` or `dmButtons.0.url`.
 */
export type RuleDraftErrors = Record<string, string>

/** A blank rule as the editor opens it. Once per user per post defaults to on. */
export function newRuleDraft(): RuleDraft {
  return {
    name: '',
    credentialId: '',
    triggerType: 'comment',
    mediaScope: 'specific',
    mediaIds: [],
    keywordMode: 'include',
    keywords: [],
    publicReplyEnabled: true,
    publicReplies: [...DEFAULT_PUBLIC_REPLIES],
    dmEnabled: true,
    dmText: '',
    dmButtons: [],
    dmImageUrl: '',
    handoffToAgent: false,
    oncePerUserPerPost: true,
  }
}

/** The editable fields of a saved rule. */
export function draftFromRule(rule: InstagramAutoReplyRule): RuleDraft {
  return {
    name: rule.name,
    credentialId: rule.credentialId ?? '',
    triggerType: rule.triggerType,
    mediaScope: rule.mediaScope,
    mediaIds: [...rule.mediaIds],
    keywordMode: rule.keywordMode,
    keywords: [...rule.keywords],
    publicReplyEnabled: rule.publicReplyEnabled,
    publicReplies: [...rule.publicReplies],
    dmEnabled: rule.dmEnabled,
    dmText: rule.dmMessage.text,
    dmButtons: rule.dmMessage.buttons.map((button) => ({ title: button.title, url: button.url })),
    dmImageUrl: rule.dmMessage.imageUrl ?? '',
    handoffToAgent: rule.handoffToAgent,
    oncePerUserPerPost: rule.oncePerUserPerPost,
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** Whether two drafts hold the same values, so the editor knows if there is anything to save. */
export function isSameDraft(left: RuleDraft, right: RuleDraft): boolean {
  return (
    left.name === right.name &&
    left.credentialId === right.credentialId &&
    left.triggerType === right.triggerType &&
    left.mediaScope === right.mediaScope &&
    sameStrings(left.mediaIds, right.mediaIds) &&
    left.keywordMode === right.keywordMode &&
    sameStrings(left.keywords, right.keywords) &&
    left.publicReplyEnabled === right.publicReplyEnabled &&
    sameStrings(left.publicReplies, right.publicReplies) &&
    left.dmEnabled === right.dmEnabled &&
    left.dmText === right.dmText &&
    left.dmButtons.length === right.dmButtons.length &&
    left.dmButtons.every(
      (button, index) =>
        button.title === right.dmButtons[index].title && button.url === right.dmButtons[index].url
    ) &&
    left.dmImageUrl === right.dmImageUrl &&
    left.handoffToAgent === right.handoffToAgent &&
    left.oncePerUserPerPost === right.oncePerUserPerPost
  )
}

/** Meta's DM text limit: 640 characters with buttons, 1000 without. */
export function dmTextLimit(buttonCount: number): number {
  return buttonCount > 0
    ? INSTAGRAM_AUTO_REPLY_DM_TEXT_WITH_BUTTONS_MAX_LENGTH
    : INSTAGRAM_AUTO_REPLY_DM_TEXT_MAX_LENGTH
}

/** Whether a value parses as an absolute `https:` URL. */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const HTTPS_LINK_ERROR = 'Use a full https:// link'

/**
 * Problems visible while typing: text over its limit and links that are not https. These never
 * wait for a save attempt.
 */
export function getFormatErrors(draft: RuleDraft): RuleDraftErrors {
  const errors: RuleDraftErrors = {}
  if (draft.name.trim().length > INSTAGRAM_AUTO_REPLY_RULE_NAME_MAX_LENGTH) {
    errors.name = `Use ${INSTAGRAM_AUTO_REPLY_RULE_NAME_MAX_LENGTH} characters or fewer`
  }
  draft.publicReplies.forEach((reply, index) => {
    if (reply.trim().length > INSTAGRAM_AUTO_REPLY_PUBLIC_REPLY_MAX_LENGTH) {
      errors[`publicReplies.${index}`] =
        `Use ${INSTAGRAM_AUTO_REPLY_PUBLIC_REPLY_MAX_LENGTH} characters or fewer`
    }
  })
  const limit = dmTextLimit(draft.dmButtons.length)
  if (draft.dmText.trim().length > limit) {
    errors.dmText =
      draft.dmButtons.length > 0
        ? `A DM with buttons can be ${limit} characters at most`
        : `A DM can be ${limit} characters at most`
  }
  draft.dmButtons.forEach((button, index) => {
    if (button.title.trim().length > INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH) {
      errors[`dmButtons.${index}.title`] =
        `Use ${INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH} characters or fewer`
    }
    if (button.url.trim() && !isHttpsUrl(button.url.trim())) {
      errors[`dmButtons.${index}.url`] = HTTPS_LINK_ERROR
    }
  })
  if (draft.dmImageUrl.trim() && !isHttpsUrl(draft.dmImageUrl.trim())) {
    errors.dmImageUrl = HTTPS_LINK_ERROR
  }
  return errors
}

/** Everything a draft needs before it can be saved at all: a name, an account, whole buttons. */
export function getSaveErrors(draft: RuleDraft): RuleDraftErrors {
  const errors = getFormatErrors(draft)
  if (!draft.name.trim()) errors.name = 'Name this auto-reply'
  if (!draft.credentialId) errors.credentialId = 'Choose the Instagram account to reply from'
  draft.dmButtons.forEach((button, index) => {
    if (!button.title.trim()) errors[`dmButtons.${index}.title`] = 'Add a button title'
    if (!button.url.trim()) errors[`dmButtons.${index}.url`] = 'Add the link this button opens'
  })
  return errors
}

const ISSUE_FIELDS: Record<InstagramAutoReplyRuleIssue['field'], string> = {
  credentialId: 'credentialId',
  triggerType: 'mediaScope',
  mediaScope: 'mediaScope',
  mediaIds: 'mediaIds',
  keywordMode: 'keywords',
  keywords: 'keywords',
  publicReplyEnabled: 'publicReplies',
  publicReplies: 'publicReplies',
  dmEnabled: 'dmEnabled',
  dmMessage: 'dmText',
  handoffToAgent: 'dmEnabled',
}

/**
 * Save problems plus what the server checks before going live, using the same rule
 * (`getGoLiveIssues`) so the editor and the server never disagree.
 */
export function getGoLiveErrors(draft: RuleDraft): RuleDraftErrors {
  const errors = getSaveErrors(draft)
  const body = toRuleBody(draft)
  const issues = getGoLiveIssues({
    credentialId: draft.credentialId || null,
    triggerType: draft.triggerType,
    mediaScope: draft.mediaScope,
    mediaIds: body.mediaIds,
    keywordMode: draft.keywordMode,
    keywords: body.keywords,
    publicReplyEnabled: draft.publicReplyEnabled,
    publicReplies: body.publicReplies,
    dmEnabled: draft.dmEnabled,
    dmMessage: { text: body.dmMessage.text, buttons: body.dmMessage.buttons, imageUrl: null },
    handoffToAgent: draft.handoffToAgent,
  })
  for (const issue of issues) {
    const field = ISSUE_FIELDS[issue.field]
    errors[field] ??= issue.message
  }
  return errors
}

/** The saved form of a draft, as the create and update contracts take it. */
export interface RuleBody extends CreateInstagramAutoReplyRuleBody {
  mediaIds: string[]
  keywords: string[]
  publicReplies: string[]
  dmMessage: { text: string; buttons: DmButtonDraft[]; imageUrl: string | null }
}

/**
 * Normalizes a draft for saving: trims text, drops empty and duplicate reply variants and
 * keywords (keywords case-insensitively), and turns an empty image link into `null`.
 */
export function toRuleBody(draft: RuleDraft): RuleBody {
  return {
    name: draft.name.trim(),
    credentialId: draft.credentialId,
    triggerType: draft.triggerType,
    mediaScope: draft.mediaScope,
    mediaIds: dedupeList(draft.mediaIds),
    keywordMode: draft.keywordMode,
    keywords: dedupeList(draft.keywords, { caseInsensitive: true }),
    publicReplyEnabled: draft.publicReplyEnabled,
    publicReplies: dedupeList(draft.publicReplies),
    dmEnabled: draft.dmEnabled,
    dmMessage: {
      text: draft.dmText.trim(),
      buttons: draft.dmButtons.map((button) => ({
        title: button.title.trim(),
        url: button.url.trim(),
      })),
      imageUrl: draft.dmImageUrl.trim() || null,
    },
    handoffToAgent: draft.handoffToAgent,
    oncePerUserPerPost: draft.oncePerUserPerPost,
  }
}

const COPY_SUFFIX = ' (copy)'

/**
 * A new draft rule with the same settings as `rule`, named "<name> (copy)". Faza 3 fields
 * (opening DM, follow gate) are carried over too. Returns null for a rule without an account,
 * which cannot be created.
 */
export function duplicateRuleBody(
  rule: InstagramAutoReplyRule
): CreateInstagramAutoReplyRuleBody | null {
  if (!rule.credentialId) return null
  const base = rule.name.slice(0, INSTAGRAM_AUTO_REPLY_RULE_NAME_MAX_LENGTH - COPY_SUFFIX.length)
  return {
    name: `${base}${COPY_SUFFIX}`,
    credentialId: rule.credentialId,
    triggerType: rule.triggerType,
    mediaScope: rule.mediaScope,
    mediaIds: rule.mediaIds,
    keywordMode: rule.keywordMode,
    keywords: rule.keywords,
    publicReplyEnabled: rule.publicReplyEnabled,
    publicReplies: rule.publicReplies,
    dmEnabled: rule.dmEnabled,
    dmMessage: rule.dmMessage,
    openingDm: rule.openingDm,
    followGate: rule.followGate,
    handoffToAgent: rule.handoffToAgent,
    oncePerUserPerPost: rule.oncePerUserPerPost,
  }
}

/** Splits typed or pasted keyword text on commas, trimming and dropping empties. */
export function splitKeywords(value: string): string[] {
  return value
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean)
}

/** Result of adding typed keywords: the new list, and why some were refused. */
export interface AddKeywordsResult {
  keywords: string[]
  error: string | null
}

/**
 * Adds keywords to the list, skipping case-insensitive duplicates. Refuses a keyword over the
 * length limit, and stops at the per-rule cap.
 */
export function addKeywords(
  existing: readonly string[],
  incoming: readonly string[]
): AddKeywordsResult {
  const seen = new Set(existing.map((keyword) => keyword.toLocaleLowerCase()))
  const keywords = [...existing]
  let error: string | null = null
  for (const keyword of incoming) {
    if (keyword.length > INSTAGRAM_AUTO_REPLY_KEYWORD_MAX_LENGTH) {
      error = `Keywords can be ${INSTAGRAM_AUTO_REPLY_KEYWORD_MAX_LENGTH} characters at most`
      continue
    }
    const key = keyword.toLocaleLowerCase()
    if (seen.has(key)) continue
    if (keywords.length >= INSTAGRAM_AUTO_REPLY_MAX_KEYWORDS) {
      error = `A rule can have up to ${INSTAGRAM_AUTO_REPLY_MAX_KEYWORDS} keywords`
      break
    }
    seen.add(key)
    keywords.push(keyword)
  }
  return { keywords, error }
}

/** The comment the preview shows: the first keyword when the rule matches on keywords. */
export function sampleCommentFor(draft: Pick<RuleDraft, 'keywordMode' | 'keywords'>): string {
  if (draft.keywordMode === 'include') {
    const keyword = draft.keywords.find((value) => value.trim())
    if (keyword) return keyword.trim()
  }
  return SAMPLE_COMMENT
}

/** The public reply the preview shows, or null when the rule sends none. */
export function previewPublicReply(
  draft: Pick<RuleDraft, 'triggerType' | 'publicReplyEnabled' | 'publicReplies' | 'handoffToAgent'>
): string | null {
  if (draft.handoffToAgent) return null
  if (!supportsPublicReply(draft.triggerType) || !draft.publicReplyEnabled) return null
  return draft.publicReplies.find((reply) => reply.trim())?.trim() ?? ''
}
