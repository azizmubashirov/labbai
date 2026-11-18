import type {
  InstagramAutoReplyDmMessage,
  InstagramAutoReplyKeywordMode,
  InstagramAutoReplyMediaScope,
  InstagramAutoReplyTriggerType,
} from '@labbai/db/schema'
import { INSTAGRAM_AUTO_REPLY_STORY_TRIGGER_TYPES } from '@/lib/instagram-auto-reply/constants'

/** The parts of a rule that decide whether it is complete enough to go live. */
export interface InstagramAutoReplyRuleContent {
  credentialId: string | null
  triggerType: InstagramAutoReplyTriggerType
  mediaScope: InstagramAutoReplyMediaScope
  mediaIds: string[]
  keywordMode: InstagramAutoReplyKeywordMode
  keywords: string[]
  publicReplyEnabled: boolean
  publicReplies: string[]
  dmEnabled: boolean
  dmMessage: InstagramAutoReplyDmMessage
  handoffToAgent: boolean
}

/** One reason a rule cannot go live, with the field the editor should point at. */
export interface InstagramAutoReplyRuleIssue {
  field: keyof InstagramAutoReplyRuleContent
  message: string
}

const STORY_TRIGGER_TYPES: ReadonlySet<InstagramAutoReplyTriggerType> = new Set(
  INSTAGRAM_AUTO_REPLY_STORY_TRIGGER_TYPES
)

/** Whether a trigger type is answered on a story (by DM only) rather than on a post. */
export function isStoryTriggerType(triggerType: InstagramAutoReplyTriggerType): boolean {
  return STORY_TRIGGER_TYPES.has(triggerType)
}

/** Public replies exist only for post comments; live comments and stories are answered by DM. */
export function supportsPublicReply(triggerType: InstagramAutoReplyTriggerType): boolean {
  return triggerType === 'comment'
}

/**
 * Shape rules that hold for drafts too: story triggers have no "next post".
 */
export function getRuleShapeIssues(
  rule: Pick<InstagramAutoReplyRuleContent, 'triggerType' | 'mediaScope'>
): InstagramAutoReplyRuleIssue[] {
  if (isStoryTriggerType(rule.triggerType) && rule.mediaScope === 'next') {
    return [
      {
        field: 'mediaScope',
        message: 'Story rules apply to any story or to chosen ones, not the next post',
      },
    ]
  }
  return []
}

/**
 * Everything a rule needs before it can answer customers: an account, posts for `specific`,
 * keywords for include/exclude, and something to send unless it hands off to the agent.
 * Returns an empty list when the rule can go live.
 */
export function getGoLiveIssues(
  rule: InstagramAutoReplyRuleContent
): InstagramAutoReplyRuleIssue[] {
  const issues = [...getRuleShapeIssues(rule)]
  if (!rule.credentialId) {
    issues.push({ field: 'credentialId', message: 'Choose the Instagram account to reply from' })
  }
  if (rule.mediaScope === 'specific' && rule.mediaIds.length === 0) {
    issues.push({ field: 'mediaIds', message: 'Choose at least one post' })
  }
  if (rule.keywordMode !== 'any' && rule.keywords.length === 0) {
    issues.push({ field: 'keywords', message: 'Add at least one keyword' })
  }
  if (rule.handoffToAgent) return issues

  const publicReply = supportsPublicReply(rule.triggerType) && rule.publicReplyEnabled
  if (publicReply && rule.publicReplies.length === 0) {
    issues.push({
      field: 'publicReplies',
      message: 'Add a public reply or turn public replies off',
    })
  }
  if (rule.dmEnabled && !rule.dmMessage.text.trim()) {
    issues.push({ field: 'dmMessage', message: 'Write the DM or turn it off' })
  }
  if (!publicReply && !rule.dmEnabled) {
    issues.push({
      field: 'dmEnabled',
      message: supportsPublicReply(rule.triggerType)
        ? 'Turn on a public reply or a DM, or hand off to the agent'
        : 'Turn on the DM, or hand off to the agent',
    })
  }
  return issues
}

/**
 * Trims, drops empties, and removes duplicates (keywords case-insensitively), keeping the first
 * spelling and the original order.
 */
export function dedupeList(
  values: readonly string[],
  options: { caseInsensitive?: boolean } = {}
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    const key = options.caseInsensitive ? value.toLocaleLowerCase() : value
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}
