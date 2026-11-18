import { z } from 'zod'
import { MAX_ID_LENGTH, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_DM_STAGES,
  INSTAGRAM_AUTO_REPLY_DM_TEXT_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_DM_TEXT_WITH_BUTTONS_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_EVENT_OUTCOMES,
  INSTAGRAM_AUTO_REPLY_EVENTS_PAGE_DEFAULT,
  INSTAGRAM_AUTO_REPLY_EVENTS_PAGE_MAX,
  INSTAGRAM_AUTO_REPLY_KEYWORD_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_KEYWORD_MODES,
  INSTAGRAM_AUTO_REPLY_MAX_DM_BUTTONS,
  INSTAGRAM_AUTO_REPLY_MAX_KEYWORDS,
  INSTAGRAM_AUTO_REPLY_MAX_MEDIA_IDS,
  INSTAGRAM_AUTO_REPLY_MAX_PUBLIC_REPLIES,
  INSTAGRAM_AUTO_REPLY_MAX_RULES,
  INSTAGRAM_AUTO_REPLY_MEDIA_ID_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_MEDIA_SCOPES,
  INSTAGRAM_AUTO_REPLY_PUBLIC_REPLY_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_RULE_NAME_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_RULE_STATUSES,
  INSTAGRAM_AUTO_REPLY_SETTABLE_STATUSES,
  INSTAGRAM_AUTO_REPLY_STORY_TRIGGER_TYPES,
  INSTAGRAM_AUTO_REPLY_TRIGGER_TYPES,
  INSTAGRAM_AUTO_REPLY_URL_MAX_LENGTH,
} from '@/lib/instagram-auto-reply/constants'

const idSchema = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .min(1, `${label} is required`)
    .max(MAX_ID_LENGTH, `${label} is too long`)

/** Whether a value parses as an absolute `https:` URL. */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const httpsUrlSchema = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(INSTAGRAM_AUTO_REPLY_URL_MAX_LENGTH, `${label} is too long`)
    .refine(isHttpsUrl, `${label} must be a full https:// link`)

export const instagramAutoReplyRuleStatusSchema = z.enum(INSTAGRAM_AUTO_REPLY_RULE_STATUSES)
export const instagramAutoReplySettableStatusSchema = z.enum(
  INSTAGRAM_AUTO_REPLY_SETTABLE_STATUSES,
  { error: 'Status must be live or paused' }
)
export const instagramAutoReplyTriggerTypeSchema = z.enum(INSTAGRAM_AUTO_REPLY_TRIGGER_TYPES, {
  error: 'Choose what the rule listens to',
})
export const instagramAutoReplyMediaScopeSchema = z.enum(INSTAGRAM_AUTO_REPLY_MEDIA_SCOPES, {
  error: 'Choose which posts the rule applies to',
})
export const instagramAutoReplyKeywordModeSchema = z.enum(INSTAGRAM_AUTO_REPLY_KEYWORD_MODES, {
  error: 'Choose how keywords match',
})
export const instagramAutoReplyEventOutcomeSchema = z.enum(INSTAGRAM_AUTO_REPLY_EVENT_OUTCOMES)
export const instagramAutoReplyDmStageSchema = z.enum(INSTAGRAM_AUTO_REPLY_DM_STAGES)

export const instagramAutoReplyDmButtonSchema = z.object({
  title: z
    .string({ error: 'Button title is required' })
    .trim()
    .min(1, 'Button title is required')
    .max(
      INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH,
      `Button titles must be ${INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH} characters or fewer`
    ),
  url: httpsUrlSchema('Button link'),
})

/**
 * The private reply. Meta caps button-template text at 640 characters and plain text at 1000,
 * so the text bound depends on whether any buttons are attached. An empty text is accepted for a
 * draft; going live requires it when the DM is on.
 */
export const instagramAutoReplyDmMessageSchema = z
  .object({
    text: z
      .string({ error: 'DM text must be text' })
      .trim()
      .max(
        INSTAGRAM_AUTO_REPLY_DM_TEXT_MAX_LENGTH,
        `DM text must be ${INSTAGRAM_AUTO_REPLY_DM_TEXT_MAX_LENGTH} characters or fewer`
      )
      .default(''),
    buttons: z
      .array(instagramAutoReplyDmButtonSchema)
      .max(
        INSTAGRAM_AUTO_REPLY_MAX_DM_BUTTONS,
        `A DM can have up to ${INSTAGRAM_AUTO_REPLY_MAX_DM_BUTTONS} buttons`
      )
      .default([]),
    imageUrl: httpsUrlSchema('Image link').nullable().default(null),
  })
  .superRefine((message, ctx) => {
    if (
      message.buttons.length > 0 &&
      message.text.length > INSTAGRAM_AUTO_REPLY_DM_TEXT_WITH_BUTTONS_MAX_LENGTH
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: `DM text must be ${INSTAGRAM_AUTO_REPLY_DM_TEXT_WITH_BUTTONS_MAX_LENGTH} characters or fewer when it has buttons`,
      })
    }
  })

const buttonTitleSchema = z
  .string({ error: 'Button title is required' })
  .trim()
  .min(1, 'Button title is required')
  .max(
    INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH,
    `Button titles must be ${INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH} characters or fewer`
  )

/** Opening DM with one postback button; the main DM follows once the user taps it. */
export const instagramAutoReplyOpeningDmSchema = z.object({
  text: z
    .string({ error: 'Opening message is required' })
    .trim()
    .min(1, 'Opening message is required')
    .max(
      INSTAGRAM_AUTO_REPLY_DM_TEXT_WITH_BUTTONS_MAX_LENGTH,
      `Opening message must be ${INSTAGRAM_AUTO_REPLY_DM_TEXT_WITH_BUTTONS_MAX_LENGTH} characters or fewer`
    ),
  buttonTitle: buttonTitleSchema,
})

/** Follow-gate prompt; its text and button are required only while the gate is on. */
export const instagramAutoReplyFollowGateSchema = z
  .object({
    enabled: z.boolean({ error: 'Follow gate must be on or off' }),
    text: z
      .string({ error: 'Follow prompt must be text' })
      .trim()
      .max(
        INSTAGRAM_AUTO_REPLY_DM_TEXT_WITH_BUTTONS_MAX_LENGTH,
        `Follow prompt must be ${INSTAGRAM_AUTO_REPLY_DM_TEXT_WITH_BUTTONS_MAX_LENGTH} characters or fewer`
      )
      .default(''),
    buttonTitle: z
      .string({ error: 'Follow button title must be text' })
      .trim()
      .max(
        INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH,
        `Button titles must be ${INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH} characters or fewer`
      )
      .default(''),
  })
  .superRefine((gate, ctx) => {
    if (!gate.enabled) return
    if (!gate.text) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'Follow prompt is required when the follow gate is on',
      })
    }
    if (!gate.buttonTitle) {
      ctx.addIssue({
        code: 'custom',
        path: ['buttonTitle'],
        message: 'Follow button title is required when the follow gate is on',
      })
    }
  })

const ruleNameSchema = z
  .string({ error: 'Rule name is required' })
  .trim()
  .min(1, 'Rule name is required')
  .max(
    INSTAGRAM_AUTO_REPLY_RULE_NAME_MAX_LENGTH,
    `Rule name must be ${INSTAGRAM_AUTO_REPLY_RULE_NAME_MAX_LENGTH} characters or fewer`
  )

const mediaIdsSchema = z
  .array(
    z
      .string({ error: 'Post ID must be text' })
      .trim()
      .min(1, 'Post ID is required')
      .max(INSTAGRAM_AUTO_REPLY_MEDIA_ID_MAX_LENGTH, 'Post ID is too long')
  )
  .max(
    INSTAGRAM_AUTO_REPLY_MAX_MEDIA_IDS,
    `A rule can watch up to ${INSTAGRAM_AUTO_REPLY_MAX_MEDIA_IDS} posts`
  )

const keywordsSchema = z
  .array(
    z
      .string({ error: 'Keyword must be text' })
      .trim()
      .min(1, 'Keywords cannot be empty')
      .max(
        INSTAGRAM_AUTO_REPLY_KEYWORD_MAX_LENGTH,
        `Keywords must be ${INSTAGRAM_AUTO_REPLY_KEYWORD_MAX_LENGTH} characters or fewer`
      )
  )
  .max(
    INSTAGRAM_AUTO_REPLY_MAX_KEYWORDS,
    `A rule can have up to ${INSTAGRAM_AUTO_REPLY_MAX_KEYWORDS} keywords`
  )

const publicRepliesSchema = z
  .array(
    z
      .string({ error: 'Reply must be text' })
      .trim()
      .min(1, 'Reply variants cannot be empty')
      .max(
        INSTAGRAM_AUTO_REPLY_PUBLIC_REPLY_MAX_LENGTH,
        `Replies must be ${INSTAGRAM_AUTO_REPLY_PUBLIC_REPLY_MAX_LENGTH} characters or fewer`
      )
  )
  .max(
    INSTAGRAM_AUTO_REPLY_MAX_PUBLIC_REPLIES,
    `A rule can have up to ${INSTAGRAM_AUTO_REPLY_MAX_PUBLIC_REPLIES} reply variants`
  )

const STORY_TRIGGER_TYPES: ReadonlySet<string> = new Set(INSTAGRAM_AUTO_REPLY_STORY_TRIGGER_TYPES)

/** Story triggers have no "next post"; flags `mediaScope: 'next'` on them. */
function refineStoryMediaScope(
  rule: { triggerType?: string; mediaScope?: string },
  ctx: z.RefinementCtx
): void {
  if (rule.triggerType && STORY_TRIGGER_TYPES.has(rule.triggerType) && rule.mediaScope === 'next') {
    ctx.addIssue({
      code: 'custom',
      path: ['mediaScope'],
      message: 'Story rules apply to any story or to chosen ones, not the next post',
    })
  }
}

export const instagramAutoReplyWorkspaceParamsSchema = z.object({ id: workspaceIdSchema })

export const instagramAutoReplyRuleParamsSchema = instagramAutoReplyWorkspaceParamsSchema.extend({
  ruleId: idSchema('Rule ID'),
})

/** A rule as the editor and the list see it. `igAccountId` is derived from the credential. */
export const instagramAutoReplyRuleSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  credentialId: z.string().nullable(),
  igAccountId: z.string(),
  name: z.string(),
  status: instagramAutoReplyRuleStatusSchema,
  triggerType: instagramAutoReplyTriggerTypeSchema,
  mediaScope: instagramAutoReplyMediaScopeSchema,
  mediaIds: z.array(z.string()),
  nextMediaArmedAt: z.coerce.date().nullable(),
  nextMediaId: z.string().nullable(),
  keywordMode: instagramAutoReplyKeywordModeSchema,
  keywords: z.array(z.string()),
  publicReplyEnabled: z.boolean(),
  publicReplies: z.array(z.string()),
  dmEnabled: z.boolean(),
  dmMessage: z.object({
    text: z.string(),
    buttons: z.array(z.object({ title: z.string(), url: z.string() })),
    imageUrl: z.string().nullable(),
  }),
  openingDm: z.object({ text: z.string(), buttonTitle: z.string() }).nullable(),
  followGate: z
    .object({ enabled: z.boolean(), text: z.string(), buttonTitle: z.string() })
    .nullable(),
  handoffToAgent: z.boolean(),
  oncePerUserPerPost: z.boolean(),
  sortOrder: z.number().int(),
  createdByUserId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

/** Outcome counters shown next to each rule in the list. */
export const instagramAutoReplyRuleCountersSchema = z.object({
  replied: z.number().int().min(0),
  failed: z.number().int().min(0),
  dmSent: z.number().int().min(0),
  clicks: z.number().int().min(0),
})

export const instagramAutoReplyRuleListItemSchema = instagramAutoReplyRuleSchema.extend({
  counters: instagramAutoReplyRuleCountersSchema,
})

export type InstagramAutoReplyRule = z.output<typeof instagramAutoReplyRuleSchema>
export type InstagramAutoReplyRuleListItem = z.output<typeof instagramAutoReplyRuleListItemSchema>
export type InstagramAutoReplyRuleCounters = z.output<typeof instagramAutoReplyRuleCountersSchema>
export type InstagramAutoReplyRuleStatusValue = z.output<typeof instagramAutoReplyRuleStatusSchema>
export type InstagramAutoReplySettableStatus = z.output<
  typeof instagramAutoReplySettableStatusSchema
>
export type InstagramAutoReplyTriggerTypeValue = z.output<
  typeof instagramAutoReplyTriggerTypeSchema
>
export type InstagramAutoReplyMediaScopeValue = z.output<typeof instagramAutoReplyMediaScopeSchema>
export type InstagramAutoReplyKeywordModeValue = z.output<
  typeof instagramAutoReplyKeywordModeSchema
>
export type InstagramAutoReplyEventOutcomeValue = z.output<
  typeof instagramAutoReplyEventOutcomeSchema
>
export type InstagramAutoReplyDmMessageBody = z.input<typeof instagramAutoReplyDmMessageSchema>
export type InstagramAutoReplyDmMessageValue = z.output<typeof instagramAutoReplyDmMessageSchema>
export type InstagramAutoReplyOpeningDmBody = z.input<typeof instagramAutoReplyOpeningDmSchema>
export type InstagramAutoReplyFollowGateBody = z.input<typeof instagramAutoReplyFollowGateSchema>

export const listInstagramAutoReplyRulesQuerySchema = z.object({
  /** Only rules that reply with this credential, e.g. for a trigger's account. */
  credentialId: idSchema('Credential ID').optional(),
})

export type ListInstagramAutoReplyRulesQuery = z.input<
  typeof listInstagramAutoReplyRulesQuerySchema
>

export const listInstagramAutoReplyRulesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/instagram-auto-reply/rules',
  params: instagramAutoReplyWorkspaceParamsSchema,
  query: listInstagramAutoReplyRulesQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      rules: z.array(instagramAutoReplyRuleListItemSchema),
    }),
  },
})

export const getInstagramAutoReplyRuleContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/instagram-auto-reply/rules/[ruleId]',
  params: instagramAutoReplyRuleParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), rule: instagramAutoReplyRuleSchema }),
  },
})

/**
 * A new rule, always saved as a draft. Content completeness (keywords for include/exclude, posts
 * for `specific`, a reply to send) is checked when the rule goes live, so a half-written draft
 * can be saved.
 */
export const createInstagramAutoReplyRuleBodySchema = z
  .object({
    name: ruleNameSchema,
    credentialId: idSchema('Instagram account'),
    triggerType: instagramAutoReplyTriggerTypeSchema.default('comment'),
    mediaScope: instagramAutoReplyMediaScopeSchema,
    mediaIds: mediaIdsSchema.default([]),
    keywordMode: instagramAutoReplyKeywordModeSchema,
    keywords: keywordsSchema.default([]),
    publicReplyEnabled: z.boolean().default(true),
    publicReplies: publicRepliesSchema.default([]),
    dmEnabled: z.boolean().default(true),
    dmMessage: instagramAutoReplyDmMessageSchema,
    openingDm: instagramAutoReplyOpeningDmSchema.nullable().default(null),
    followGate: instagramAutoReplyFollowGateSchema.nullable().default(null),
    handoffToAgent: z.boolean().default(false),
    oncePerUserPerPost: z.boolean().default(true),
  })
  .superRefine(refineStoryMediaScope)

export type CreateInstagramAutoReplyRuleBody = z.input<
  typeof createInstagramAutoReplyRuleBodySchema
>
export type CreateInstagramAutoReplyRuleValues = z.output<
  typeof createInstagramAutoReplyRuleBodySchema
>

export const createInstagramAutoReplyRuleContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/instagram-auto-reply/rules',
  params: instagramAutoReplyWorkspaceParamsSchema,
  body: createInstagramAutoReplyRuleBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), rule: instagramAutoReplyRuleSchema }),
  },
})

/**
 * A partial edit. Omitted fields keep their value; arrays and DM objects are replaced whole.
 * A live rule must still be complete after the edit.
 */
export const updateInstagramAutoReplyRuleBodySchema = z
  .object({
    name: ruleNameSchema.optional(),
    credentialId: idSchema('Instagram account').optional(),
    triggerType: instagramAutoReplyTriggerTypeSchema.optional(),
    mediaScope: instagramAutoReplyMediaScopeSchema.optional(),
    mediaIds: mediaIdsSchema.optional(),
    keywordMode: instagramAutoReplyKeywordModeSchema.optional(),
    keywords: keywordsSchema.optional(),
    publicReplyEnabled: z.boolean().optional(),
    publicReplies: publicRepliesSchema.optional(),
    dmEnabled: z.boolean().optional(),
    dmMessage: instagramAutoReplyDmMessageSchema.optional(),
    openingDm: instagramAutoReplyOpeningDmSchema.nullable().optional(),
    followGate: instagramAutoReplyFollowGateSchema.nullable().optional(),
    handoffToAgent: z.boolean().optional(),
    oncePerUserPerPost: z.boolean().optional(),
  })
  .superRefine((body, ctx) => {
    if (Object.values(body).every((value) => value === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'Provide at least one field' })
    }
    refineStoryMediaScope(body, ctx)
  })

export type UpdateInstagramAutoReplyRuleBody = z.input<
  typeof updateInstagramAutoReplyRuleBodySchema
>
export type UpdateInstagramAutoReplyRuleValues = z.output<
  typeof updateInstagramAutoReplyRuleBodySchema
>

export const updateInstagramAutoReplyRuleContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/instagram-auto-reply/rules/[ruleId]',
  params: instagramAutoReplyRuleParamsSchema,
  body: updateInstagramAutoReplyRuleBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), rule: instagramAutoReplyRuleSchema }),
  },
})

export const deleteInstagramAutoReplyRuleContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/instagram-auto-reply/rules/[ruleId]',
  params: instagramAutoReplyRuleParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

export const setInstagramAutoReplyRuleStatusBodySchema = z.object({
  status: instagramAutoReplySettableStatusSchema,
})

export type SetInstagramAutoReplyRuleStatusBody = z.input<
  typeof setInstagramAutoReplyRuleStatusBodySchema
>

/** Go live or pause. Going live checks the rule is complete and arms a `'next'` rule. */
export const setInstagramAutoReplyRuleStatusContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/instagram-auto-reply/rules/[ruleId]/status',
  params: instagramAutoReplyRuleParamsSchema,
  body: setInstagramAutoReplyRuleStatusBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), rule: instagramAutoReplyRuleSchema }),
  },
})

export const reorderInstagramAutoReplyRulesBodySchema = z.object({
  ruleIds: z
    .array(idSchema('Rule ID'))
    .min(1, 'Provide at least one rule')
    .max(INSTAGRAM_AUTO_REPLY_MAX_RULES, `Up to ${INSTAGRAM_AUTO_REPLY_MAX_RULES} rules`)
    .refine((ids) => new Set(ids).size === ids.length, 'Each rule can appear only once'),
})

export type ReorderInstagramAutoReplyRulesBody = z.input<
  typeof reorderInstagramAutoReplyRulesBodySchema
>

/**
 * Puts the listed rules first, in the given order; rules not listed keep their relative order
 * after them. Order decides which rule answers when several match.
 */
export const reorderInstagramAutoReplyRulesContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/instagram-auto-reply/rules/reorder',
  params: instagramAutoReplyWorkspaceParamsSchema,
  body: reorderInstagramAutoReplyRulesBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      rules: z.array(z.object({ id: z.string(), sortOrder: z.number().int() })),
    }),
  },
})

const countSchema = z.number().int().min(0)

/** Matched events per outcome; every outcome is present, zero when none. */
export const instagramAutoReplyOutcomeCountsSchema = z.object({
  pending: countSchema,
  replied: countSchema,
  partial: countSchema,
  skipped_duplicate: countSchema,
  handoff: countSchema,
  expired: countSchema,
  failed: countSchema,
})

export const instagramAutoReplyMediaStatsSchema = z.object({
  mediaId: z.string(),
  matched: z.number().int().min(0),
  replied: z.number().int().min(0),
  dmSent: z.number().int().min(0),
  clicks: z.number().int().min(0),
})

export const instagramAutoReplyStatsSchema = z.object({
  /** The rule the stats cover; null for the whole workspace. */
  ruleId: z.string().nullable(),
  matched: z.number().int().min(0),
  outcomes: instagramAutoReplyOutcomeCountsSchema,
  dmSent: z.number().int().min(0),
  clicks: z.number().int().min(0),
  /** Most matched posts first, at most 50. */
  media: z.array(instagramAutoReplyMediaStatsSchema),
})

export type InstagramAutoReplyStats = z.output<typeof instagramAutoReplyStatsSchema>
export type InstagramAutoReplyMediaStats = z.output<typeof instagramAutoReplyMediaStatsSchema>
export type InstagramAutoReplyOutcomeCounts = z.output<typeof instagramAutoReplyOutcomeCountsSchema>

export const getInstagramAutoReplyStatsQuerySchema = z.object({
  /** Stats for one rule; omitted for the whole workspace ("Top posts"). */
  ruleId: idSchema('Rule ID').optional(),
})

export type GetInstagramAutoReplyStatsQuery = z.input<typeof getInstagramAutoReplyStatsQuerySchema>

export const getInstagramAutoReplyStatsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/instagram-auto-reply/stats',
  params: instagramAutoReplyWorkspaceParamsSchema,
  query: getInstagramAutoReplyStatsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), stats: instagramAutoReplyStatsSchema }),
  },
})

/** One matched comment and what was done with it. The DM snapshot stays on the server. */
export const instagramAutoReplyEventSchema = z.object({
  id: z.string(),
  ruleId: z.string().nullable(),
  igAccountId: z.string(),
  sourceId: z.string(),
  triggerType: instagramAutoReplyTriggerTypeSchema,
  mediaId: z.string().nullable(),
  fromId: z.string().nullable(),
  fromUsername: z.string().nullable(),
  text: z.string().nullable(),
  outcome: instagramAutoReplyEventOutcomeSchema,
  publicReplyId: z.string().nullable(),
  dmSent: z.boolean(),
  dmStage: instagramAutoReplyDmStageSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export type InstagramAutoReplyEvent = z.output<typeof instagramAutoReplyEventSchema>

export const listInstagramAutoReplyEventsQuerySchema = z.object({
  ruleId: idSchema('Rule ID').optional(),
  /** Id of the last event already loaded; returns the older page after it. */
  cursor: idSchema('Cursor').optional(),
  limit: z.coerce
    .number({ error: 'Limit must be a number' })
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(
      INSTAGRAM_AUTO_REPLY_EVENTS_PAGE_MAX,
      `Limit cannot exceed ${INSTAGRAM_AUTO_REPLY_EVENTS_PAGE_MAX}`
    )
    .default(INSTAGRAM_AUTO_REPLY_EVENTS_PAGE_DEFAULT),
})

export type ListInstagramAutoReplyEventsQuery = z.input<
  typeof listInstagramAutoReplyEventsQuerySchema
>

export const listInstagramAutoReplyEventsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/instagram-auto-reply/events',
  params: instagramAutoReplyWorkspaceParamsSchema,
  query: listInstagramAutoReplyEventsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      events: z.array(instagramAutoReplyEventSchema),
      /** Pass as `cursor` to load the next (older) page; null on the last page. */
      nextCursor: z.string().nullable(),
    }),
  },
})

export type InstagramAutoReplyEventsPage = z.output<
  typeof listInstagramAutoReplyEventsContract.response.schema
>

/**
 * Params of the tracked DM link redirect. Only the event and the button position travel in the
 * URL; the target is read from the event's DM snapshot, so the link cannot be pointed elsewhere.
 * Any small index parses, and an index past the snapshot's buttons is a 404 rather than a 400.
 */
export const instagramAutoReplyClickParamsSchema = z.object({
  eventId: idSchema('Event ID'),
  buttonIndex: z
    .string({ error: 'Button index is required' })
    .regex(/^\d{1,2}$/, 'Button index must be a small whole number')
    .transform(Number),
})

export type InstagramAutoReplyClickParams = z.input<typeof instagramAutoReplyClickParamsSchema>

export const instagramAutoReplyClickContract = defineRouteContract({
  method: 'GET',
  path: '/api/instagram/r/[eventId]/[buttonIndex]',
  params: instagramAutoReplyClickParamsSchema,
  response: { mode: 'redirect' },
})
