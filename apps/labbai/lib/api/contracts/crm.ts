import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  CRM_BASE_URL_MAX_LENGTH,
  CRM_MAX_BACKFILL_HOURS,
  CRM_SECRET_MAX_LENGTH,
} from '@/lib/crm/constants'

/** A workflow's CRM link lives under the workflow whose conversations it mirrors. */
export const crmWorkflowParamsSchema = z.object({
  id: workspaceIdSchema,
  workflowId: z
    .string({ error: 'Workflow ID is required' })
    .min(1, 'Workflow ID is required')
    .max(128, 'Workflow ID is too long'),
})

/**
 * `active` mirrors now; `waiting_deploy` is connected but the deployed version has no Binora CRM
 * block yet (deploy the workflow to start).
 */
export const crmLinkStatusSchema = z.enum(['active', 'waiting_deploy'])

/** A workflow's CRM link as the Binora CRM block shows it. The secret never leaves the server. */
export const crmLinkSchema = z.object({
  provider: z.literal('binora'),
  status: crmLinkStatusSchema,
  baseUrl: z.string(),
  /** The Binora channel and funnel the handshake reported. */
  channelName: z.string().nullable(),
  pipelineName: z.string().nullable(),
  connectedAt: z.coerce.date().nullable(),
  /** The last delivery problem, cleared by the next successful delivery. */
  lastError: z.string().nullable(),
  lastErrorAt: z.coerce.date().nullable(),
  lastDeliveredAt: z.coerce.date().nullable(),
})

export type CrmLink = z.output<typeof crmLinkSchema>

export const getCrmLinkContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/crm/workflows/[workflowId]/link',
  params: crmWorkflowParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), link: crmLinkSchema.nullable() }),
  },
})

export const connectCrmLinkBodySchema = z.object({
  baseUrl: z
    .string({ error: 'Address is required' })
    .trim()
    .min(1, 'Address is required')
    .max(CRM_BASE_URL_MAX_LENGTH, `Address must be ${CRM_BASE_URL_MAX_LENGTH} characters or fewer`)
    .refine((value) => /^https?:\/\/\S+$/i.test(value), {
      message: 'Address must start with https:// (or http://)',
    }),
  secret: z
    .string({ error: 'Key is required' })
    .trim()
    .min(1, 'Key is required')
    .max(CRM_SECRET_MAX_LENGTH, `Key must be ${CRM_SECRET_MAX_LENGTH} characters or fewer`),
  /** Also send the chats of the last this many hours, so the funnel does not start empty. */
  backfillHours: z
    .number({ error: 'Backfill must be a number of hours' })
    .int('Backfill must be a whole number of hours')
    .min(0, 'Backfill cannot be negative')
    .max(CRM_MAX_BACKFILL_HOURS, `Backfill can be at most ${CRM_MAX_BACKFILL_HOURS} hours`)
    .default(0),
})

export type ConnectCrmLinkBody = z.input<typeof connectCrmLinkBodySchema>

export const connectCrmLinkContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/crm/workflows/[workflowId]/link',
  params: crmWorkflowParamsSchema,
  body: connectCrmLinkBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), link: crmLinkSchema }),
  },
})

export const deleteCrmLinkContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/crm/workflows/[workflowId]/link',
  params: crmWorkflowParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})
