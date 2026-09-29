import { db } from '@labbai/db'
import { member, permissionAccessRequest, user } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { getEmailSubject, renderPermissionAccessRequestEmail } from '@/components/emails'
import { enqueueOutboxEvent, type OutboxHandler } from '@/lib/core/outbox/service'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { DbOrTx } from '@/lib/db/types'
import {
  ACCESS_REQUEST_CREATED_EVENT,
  ACCESS_REQUEST_DECIDED_EVENT,
} from '@/lib/labbai/access-requests/constants'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'

const logger = createLogger('AccessRequestNotifications')

/** Only the id travels: the email carries no request details, and the handler re-reads state. */
interface AccessRequestEventPayload {
  requestId: string
}

/** Queues the "needs review" email to the organization's admins, inside the caller's transaction. */
export async function enqueueAccessRequestCreated(executor: DbOrTx, requestId: string) {
  await enqueueOutboxEvent<AccessRequestEventPayload>(executor, ACCESS_REQUEST_CREATED_EVENT, {
    requestId,
  })
}

/** Queues the "your request was updated" email to the requester, inside the caller's transaction. */
export async function enqueueAccessRequestDecided(executor: DbOrTx, requestId: string) {
  await enqueueOutboxEvent<AccessRequestEventPayload>(executor, ACCESS_REQUEST_DECIDED_EVENT, {
    requestId,
  })
}

function readPayload(raw: unknown): AccessRequestEventPayload {
  if (
    !raw ||
    typeof raw !== 'object' ||
    typeof (raw as { requestId?: unknown }).requestId !== 'string'
  ) {
    throw new Error('Invalid access request notification payload')
  }
  return { requestId: (raw as { requestId: string }).requestId }
}

async function loadRequest(requestId: string) {
  const [row] = await db
    .select({
      id: permissionAccessRequest.id,
      organizationId: permissionAccessRequest.organizationId,
      requesterId: permissionAccessRequest.requesterId,
      status: permissionAccessRequest.status,
    })
    .from(permissionAccessRequest)
    .where(eq(permissionAccessRequest.id, requestId))
    .limit(1)
  return row ?? null
}

function requestLink(params: Record<string, string>): string {
  return `${getBaseUrl()}/access-requests?${new URLSearchParams(params).toString()}`
}

async function deliver(to: string, kind: 'created' | 'decided', link: string): Promise<void> {
  const html = await renderPermissionAccessRequestEmail({ kind, requestLink: link })
  const result = await sendEmail({
    to,
    subject: getEmailSubject(
      kind === 'created' ? 'permission-access-request-created' : 'permission-access-request-decided'
    ),
    html,
    from: getFromEmailAddress(),
    emailType: 'transactional',
  })
  if (!result.success) throw new Error(result.message || 'Failed to send access request email')
}

const notifyAdmins: OutboxHandler = async (rawPayload) => {
  const { requestId } = readPayload(rawPayload)
  const request = await loadRequest(requestId)
  if (!request || request.status !== 'pending') return
  const admins = await db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, request.organizationId),
        inArray(member.role, ['owner', 'admin'])
      )
    )
  const link = requestLink({
    organizationId: request.organizationId,
    view: 'review',
    'request-id': request.id,
  })
  for (const admin of admins) {
    if (!admin.email) continue
    await deliver(admin.email, 'created', link)
  }
  logger.info('Notified admins of access request', { requestId, recipients: admins.length })
}

const notifyRequester: OutboxHandler = async (rawPayload) => {
  const { requestId } = readPayload(rawPayload)
  const request = await loadRequest(requestId)
  if (!request || request.status === 'pending') return
  const [requester] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, request.requesterId))
    .limit(1)
  if (!requester?.email) return
  await deliver(
    requester.email,
    'decided',
    requestLink({ organizationId: request.organizationId, view: 'requests', requestId })
  )
}

export const permissionAccessRequestOutboxHandlers = {
  [ACCESS_REQUEST_CREATED_EVENT]: notifyAdmins,
  [ACCESS_REQUEST_DECIDED_EVENT]: notifyRequester,
} as const
