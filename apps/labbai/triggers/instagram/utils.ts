import type { SubBlockConfig } from '@/blocks/types'

/** Trigger id of the Instagram direct message trigger. Kept stable for deployed workflows. */
export const INSTAGRAM_DM_TRIGGER_ID = 'instagram_webhook'

/** Trigger id of the Instagram post and reel comment trigger. */
export const INSTAGRAM_COMMENT_TRIGGER_ID = 'instagram_comment_webhook'

/** Which Instagram event kind a trigger receives. */
export type InstagramEventKind = 'messages' | 'comments'

/**
 * The event kind a deployed Instagram trigger receives. Webhooks deployed before the comment
 * trigger existed carry no trigger id, or the DM trigger id, and keep receiving direct messages.
 */
export function instagramEventKindForTrigger(triggerId: unknown): InstagramEventKind {
  return triggerId === INSTAGRAM_COMMENT_TRIGGER_ID ? 'comments' : 'messages'
}

/** Options for the trigger type dropdown shared by every Instagram trigger. */
export const instagramTriggerOptions = [
  { label: 'Direct Messages', id: INSTAGRAM_DM_TRIGGER_ID },
  { label: 'Post and Reel Comments', id: INSTAGRAM_COMMENT_TRIGGER_ID },
]

/**
 * Shows a field for the DM trigger. Written as "not the comment trigger" so blocks saved before
 * the trigger dropdown existed, which have no `selectedTriggerId` value, still show their fields.
 */
export const INSTAGRAM_DM_CONDITION = {
  field: 'selectedTriggerId',
  value: INSTAGRAM_COMMENT_TRIGGER_ID,
  not: true,
} as const

/** Shows a field only for the comment trigger. */
export const INSTAGRAM_COMMENT_CONDITION = {
  field: 'selectedTriggerId',
  value: INSTAGRAM_COMMENT_TRIGGER_ID,
} as const

/** Renders numbered setup steps the way every trigger's instructions are rendered. */
export function instagramSetupInstructions(steps: string[]): string {
  return steps
    .map((step, index) => `<div class="mb-3"><strong>${index + 1}.</strong> ${step}</div>`)
    .join('')
}

/** The account picker shared by both Instagram triggers. */
export function instagramAccountField(
  condition: typeof INSTAGRAM_DM_CONDITION | typeof INSTAGRAM_COMMENT_CONDITION,
  description: string
): SubBlockConfig {
  return {
    id: 'triggerCredentials',
    title: 'Instagram Account',
    type: 'oauth-input',
    description,
    serviceId: 'instagram',
    requiredScopes: [],
    required: true,
    mode: 'trigger',
    condition,
  }
}
