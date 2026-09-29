import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_NAME_MAX_LENGTH,
} from '@/lib/notifications/constants'

const idSchema = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .min(1, `${label} is required`)
    .max(128, `${label} is too long`)

/** A workflow's notification recipients live under the workflow they alert about. */
export const notificationWorkflowParamsSchema = z.object({
  id: workspaceIdSchema,
  workflowId: idSchema('Workflow ID'),
})

export const notificationRecipientParamsSchema = notificationWorkflowParamsSchema.extend({
  recipientId: idSchema('Recipient ID'),
})

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

export type NotificationRecipient = z.output<typeof notificationRecipientSchema>

export const listNotificationRecipientsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/notifications/workflows/[workflowId]/recipients',
  params: notificationWorkflowParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      /** False while the platform notification bot is not configured on the server. */
      configured: z.boolean(),
      botUsername: z.string().nullable(),
      recipients: z.array(notificationRecipientSchema),
      limits: z.object({ maxRecipients: z.number().int(), maxRules: z.number().int() }),
    }),
  },
})

export type WorkflowNotificationRecipients = z.output<
  typeof listNotificationRecipientsContract.response.schema
>

const NAME_TOO_LONG = `Name must be ${NOTIFICATION_NAME_MAX_LENGTH} characters or fewer`

export const createNotificationRecipientBodySchema = z.object({
  title: z
    .string({ error: 'Name must be text' })
    .trim()
    .max(NOTIFICATION_NAME_MAX_LENGTH, NAME_TOO_LONG)
    .default(''),
})

export type CreateNotificationRecipientBody = z.input<typeof createNotificationRecipientBodySchema>

export const createNotificationRecipientContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/notifications/workflows/[workflowId]/recipients',
  params: notificationWorkflowParamsSchema,
  body: createNotificationRecipientBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), recipient: notificationRecipientSchema }),
  },
})

export const deleteNotificationRecipientContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/notifications/workflows/[workflowId]/recipients/[recipientId]',
  params: notificationRecipientParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

export const testNotificationRecipientContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/notifications/workflows/[workflowId]/recipients/[recipientId]/test',
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
