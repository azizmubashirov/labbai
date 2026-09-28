import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  NOTIFICATION_CONDITION_MAX_LENGTH,
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EXTRACT_SPEC_MAX_LENGTH,
  NOTIFICATION_MAX_COOLDOWN_MINUTES,
  NOTIFICATION_MAX_PAUSE_MINUTES,
  NOTIFICATION_NAME_MAX_LENGTH,
  NOTIFICATION_PAUSE_MODES,
  NOTIFICATION_PAUSE_NOTICE_MAX_LENGTH,
  NOTIFICATION_TRIGGER_DIRECTIONS,
} from '@/lib/notifications/constants'

const idSchema = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .min(1, `${label} is required`)
    .max(128, `${label} is too long`)

export const notificationWorkspaceParamsSchema = z.object({ id: workspaceIdSchema })

export const notificationRecipientParamsSchema = notificationWorkspaceParamsSchema.extend({
  recipientId: idSchema('Recipient ID'),
})

export const notificationTriggerParamsSchema = notificationWorkspaceParamsSchema.extend({
  triggerId: idSchema('Trigger ID'),
})

export const notificationTriggerDirectionSchema = z.enum(NOTIFICATION_TRIGGER_DIRECTIONS)
export const notificationPauseModeSchema = z.enum(NOTIFICATION_PAUSE_MODES)
export const notificationEventKeySchema = z.enum(NOTIFICATION_EVENT_KEYS)

/** `pending` until the chat opens the connect link; `stopped` after `/stop` in the bot. */
export const notificationRecipientStatusSchema = z.enum(['pending', 'connected', 'stopped'])

export const notificationRecipientSchema = z.object({
  id: z.string(),
  workflowId: z.string().nullable(),
  title: z.string(),
  status: notificationRecipientStatusSchema,
  /** `t.me/<bot>?start=notify_<token>`; opening it in Telegram connects the chat. */
  connectUrl: z.string().nullable(),
  connectedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
})

export const notificationTriggerSchema = z.object({
  id: z.string(),
  workflowId: z.string().nullable(),
  name: z.string(),
  direction: notificationTriggerDirectionSchema,
  condition: z.string(),
  eventKey: z.string().nullable(),
  extractSpec: z.string(),
  pauseMode: notificationPauseModeSchema,
  pauseMinutes: z.number().int(),
  autoResume: z.boolean(),
  pauseNotice: z.string(),
  cooldownMinutes: z.number().int(),
  oncePerConversation: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export type NotificationRecipient = z.output<typeof notificationRecipientSchema>
export type NotificationTrigger = z.output<typeof notificationTriggerSchema>

export const getNotificationSettingsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/notifications',
  params: notificationWorkspaceParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      /** False while the platform notification bot is not configured on the server. */
      configured: z.boolean(),
      botUsername: z.string().nullable(),
      recipients: z.array(notificationRecipientSchema),
      triggers: z.array(notificationTriggerSchema),
      limits: z.object({ maxRecipients: z.number().int(), maxTriggers: z.number().int() }),
    }),
  },
})

export type NotificationSettings = z.output<typeof getNotificationSettingsContract.response.schema>

const NAME_TOO_LONG = `Name must be ${NOTIFICATION_NAME_MAX_LENGTH} characters or fewer`

const optionalWorkflowIdSchema = idSchema('Workflow ID').nullable().optional()

export const createNotificationRecipientBodySchema = z.object({
  title: z
    .string({ error: 'Name must be text' })
    .trim()
    .max(NOTIFICATION_NAME_MAX_LENGTH, NAME_TOO_LONG)
    .default(''),
  workflowId: optionalWorkflowIdSchema,
})

export type CreateNotificationRecipientBody = z.input<typeof createNotificationRecipientBodySchema>

export const createNotificationRecipientContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/notifications/recipients',
  params: notificationWorkspaceParamsSchema,
  body: createNotificationRecipientBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), recipient: notificationRecipientSchema }),
  },
})

export const deleteNotificationRecipientContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/notifications/recipients/[recipientId]',
  params: notificationRecipientParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

export const testNotificationRecipientContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/notifications/recipients/[recipientId]/test',
  params: notificationRecipientParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      delivered: z.boolean(),
      error: z.string().nullable(),
    }),
  },
})

const triggerFieldSchemas = {
  name: z
    .string({ error: 'Name is required' })
    .trim()
    .min(1, 'Name is required')
    .max(NOTIFICATION_NAME_MAX_LENGTH, NAME_TOO_LONG),
  direction: notificationTriggerDirectionSchema,
  condition: z
    .string()
    .trim()
    .max(
      NOTIFICATION_CONDITION_MAX_LENGTH,
      `Condition must be ${NOTIFICATION_CONDITION_MAX_LENGTH} characters or fewer`
    ),
  eventKey: notificationEventKeySchema.nullable(),
  extractSpec: z
    .string()
    .trim()
    .max(
      NOTIFICATION_EXTRACT_SPEC_MAX_LENGTH,
      `Details to collect must be ${NOTIFICATION_EXTRACT_SPEC_MAX_LENGTH} characters or fewer`
    ),
  pauseMode: notificationPauseModeSchema,
  pauseMinutes: z
    .number()
    .int('Pause must be whole minutes')
    .min(1, 'Pause must be at least 1 minute')
    .max(NOTIFICATION_MAX_PAUSE_MINUTES, 'Pause can be at most one day'),
  autoResume: z.boolean(),
  pauseNotice: z
    .string()
    .trim()
    .max(
      NOTIFICATION_PAUSE_NOTICE_MAX_LENGTH,
      `Message to the customer must be ${NOTIFICATION_PAUSE_NOTICE_MAX_LENGTH} characters or fewer`
    ),
  cooldownMinutes: z
    .number()
    .int('Cooldown must be whole minutes')
    .min(0, 'Cooldown cannot be negative')
    .max(NOTIFICATION_MAX_COOLDOWN_MINUTES, 'Cooldown can be at most one week'),
  oncePerConversation: z.boolean(),
  isActive: z.boolean(),
  workflowId: idSchema('Workflow ID').nullable(),
}

/**
 * Message triggers need a condition for the judge to read; event triggers need the event they
 * watch. Checked on the full trigger — for an update, after the change is applied.
 */
export function notificationTriggerShapeError(trigger: {
  direction: z.output<typeof notificationTriggerDirectionSchema>
  condition: string
  eventKey: string | null
}): { path: 'condition' | 'eventKey'; message: string } | null {
  if (trigger.direction === 'event') {
    return trigger.eventKey ? null : { path: 'eventKey', message: 'Choose the event to watch' }
  }
  return trigger.condition.trim()
    ? null
    : { path: 'condition', message: 'Describe when the alert should fire' }
}

export const createNotificationTriggerBodySchema = z
  .object({
    name: triggerFieldSchemas.name,
    direction: triggerFieldSchemas.direction.default('inbound'),
    condition: triggerFieldSchemas.condition.default(''),
    eventKey: triggerFieldSchemas.eventKey.default(null),
    extractSpec: triggerFieldSchemas.extractSpec.default(''),
    pauseMode: triggerFieldSchemas.pauseMode.default('none'),
    pauseMinutes: triggerFieldSchemas.pauseMinutes.default(15),
    autoResume: triggerFieldSchemas.autoResume.default(true),
    pauseNotice: triggerFieldSchemas.pauseNotice.default(''),
    cooldownMinutes: triggerFieldSchemas.cooldownMinutes.default(60),
    oncePerConversation: triggerFieldSchemas.oncePerConversation.default(false),
    isActive: triggerFieldSchemas.isActive.default(true),
    workflowId: triggerFieldSchemas.workflowId.default(null),
  })
  .superRefine((body, ctx) => {
    const problem = notificationTriggerShapeError(body)
    if (problem) ctx.addIssue({ code: 'custom', message: problem.message, path: [problem.path] })
  })

export type CreateNotificationTriggerBody = z.input<typeof createNotificationTriggerBodySchema>

export const createNotificationTriggerContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/notifications/triggers',
  params: notificationWorkspaceParamsSchema,
  body: createNotificationTriggerBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), trigger: notificationTriggerSchema }),
  },
})

export const updateNotificationTriggerBodySchema = z
  .object({
    name: triggerFieldSchemas.name.optional(),
    direction: triggerFieldSchemas.direction.optional(),
    condition: triggerFieldSchemas.condition.optional(),
    eventKey: triggerFieldSchemas.eventKey.optional(),
    extractSpec: triggerFieldSchemas.extractSpec.optional(),
    pauseMode: triggerFieldSchemas.pauseMode.optional(),
    pauseMinutes: triggerFieldSchemas.pauseMinutes.optional(),
    autoResume: triggerFieldSchemas.autoResume.optional(),
    pauseNotice: triggerFieldSchemas.pauseNotice.optional(),
    cooldownMinutes: triggerFieldSchemas.cooldownMinutes.optional(),
    oncePerConversation: triggerFieldSchemas.oncePerConversation.optional(),
    isActive: triggerFieldSchemas.isActive.optional(),
    workflowId: triggerFieldSchemas.workflowId.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Provide at least one field to change',
  })

export type UpdateNotificationTriggerBody = z.input<typeof updateNotificationTriggerBodySchema>

export const updateNotificationTriggerContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/notifications/triggers/[triggerId]',
  params: notificationTriggerParamsSchema,
  body: updateNotificationTriggerBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), trigger: notificationTriggerSchema }),
  },
})

export const deleteNotificationTriggerContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/notifications/triggers/[triggerId]',
  params: notificationTriggerParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})
