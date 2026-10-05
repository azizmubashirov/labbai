import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { generateId } from '@labbai/utils/id'
import { z } from 'zod'
import { decryptSecret } from '@/lib/core/security/encryption'
import {
  BINORA_SIGNATURE_HEADER,
  BINORA_TIMESTAMP_HEADER,
  type BinoraConversationSnapshot,
  binoraConversationSnapshot,
  verifyBinoraSignature,
} from '@/lib/crm/binora/protocol'
import { CRM_OPERATOR_PAUSE_MINUTES } from '@/lib/crm/constants'
import {
  type CrmLinkRecord,
  findCrmReplyMessage,
  getCrmLinkByCallbackKey,
  getInboxConversationForCrm,
  insertCrmOperatorReply,
  isCrmConversationKnown,
  setCrmSentState,
  withCrmReplyLock,
} from '@/lib/crm/repository'
import { announceInboxChange } from '@/lib/inbox/changes'
import {
  getInboxConversation,
  getInboxReplyRoute,
  type InboxConversationRecord,
  pauseInboxConversationAi,
  updateInboxConversation,
} from '@/lib/inbox/repository'
import { sendInboxReply } from '@/lib/inbox/send'

const logger = createLogger('BinoraCallbacks')

/** Binora's requests are a few hundred bytes; anything much larger is not Binora. */
const MAX_BODY_BYTES = 64 * 1024

/** Telegram's limit for one text message; WhatsApp and Instagram allow more. */
const MAX_REPLY_LENGTH = 4096

const conversationIdSchema = z.string().trim().min(1).max(128)

const sendBodySchema = z.object({
  conversationId: conversationIdSchema,
  text: z.string().trim().min(1, 'text required').max(MAX_REPLY_LENGTH, 'text is too long'),
  operatorName: z.string().trim().max(255).optional().default(''),
  idempotencyKey: z.string().trim().max(64).optional().default(''),
})

const aiBodySchema = z.object({
  conversationId: conversationIdSchema,
  enabled: z.boolean({ error: 'enabled must be true or false' }),
})

export type BinoraCallbackAction = 'send' | 'ai'

/**
 * The request body as text, or null once it passes `maxBytes` — read in chunks, so an oversized
 * or endless body is cut off instead of buffered whole.
 */
async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function detail(status: number, message: string): Response {
  return Response.json({ detail: message }, { status })
}

function stateOf(conversation: InboxConversationRecord) {
  return {
    aiEnabled: conversation.aiEnabled,
    aiPausedUntil: conversation.aiPausedUntil,
    contactName: conversation.contactName,
    contactHandle: conversation.contactHandle,
  }
}

/** A conversation of the link's workspace that this link has mirrored, or null. */
async function loadMirroredConversation(
  link: CrmLinkRecord,
  conversationId: string
): Promise<InboxConversationRecord | null> {
  const conversation = await getInboxConversation(link.workspaceId, conversationId)
  if (!conversation) return null
  return (await isCrmConversationKnown(link.id, conversation.id)) ? conversation : null
}

/**
 * The conversation's fresh snapshot, recorded as what Binora now knows — from the stored row, as
 * the mirror compares it, so the mirror does not report Binora's own change back to it.
 */
async function snapshotForBinora(
  link: CrmLinkRecord,
  conversationId: string
): Promise<BinoraConversationSnapshot | null> {
  const conversation = await getInboxConversationForCrm(conversationId)
  if (!conversation) return null
  await setCrmSentState(link.id, conversation.id, stateOf(conversation))
  return binoraConversationSnapshot(conversation)
}

/**
 * An operator answered the customer from the Binora lead card. The reply goes out the way an
 * Inbox reply does, through the channel account that last received the chat. The workflow
 * owner's identity scopes credential access, as it does for the agent's own sends (Binora's
 * operators are not Labbai users). A delivered reply steps the AI back for
 * {@link CRM_OPERATOR_PAUSE_MINUTES}, as when the owner types in Telegram; a person's OFF stays
 * off. `idempotencyKey` (Binora's timeline row id) makes a retried request return the first
 * result instead of messaging the customer twice.
 */
async function handleSend(
  link: CrmLinkRecord,
  conversation: InboxConversationRecord,
  body: z.output<typeof sendBodySchema>
): Promise<Response> {
  if (!body.idempotencyKey) return deliverReply(link, conversation, body)
  return withCrmReplyLock(link.id, body.idempotencyKey, () =>
    deliverReply(link, conversation, body)
  )
}

async function deliverReply(
  link: CrmLinkRecord,
  conversation: InboxConversationRecord,
  body: z.output<typeof sendBodySchema>
): Promise<Response> {
  if (body.idempotencyKey) {
    const earlier = await findCrmReplyMessage(link.id, body.idempotencyKey)
    if (earlier) {
      const delivered = earlier.status === 'sent'
      return Response.json({
        delivered,
        detail: delivered ? '' : (earlier.error ?? ''),
        messageId: delivered ? (earlier.externalMessageId ?? earlier.messageId) : null,
        conversation: binoraConversationSnapshot(conversation),
      })
    }
  }

  const route = conversation.webhookId ? await getInboxReplyRoute(conversation.webhookId) : null
  const outcome = route
    ? await sendInboxReply({
        conversation,
        text: body.text,
        operatorUserId: route.workflowOwnerId,
      })
    : ({
        status: 'failed',
        error: 'This chat has no channel to reply through. Redeploy the agent workflow.',
      } as const)

  const messageId = generateId()
  await insertCrmOperatorReply({
    linkId: link.id,
    messageId,
    conversationId: conversation.id,
    workspaceId: conversation.workspaceId,
    operatorName: body.operatorName || 'Binora',
    text: body.text,
    status: outcome.status,
    externalMessageId: outcome.status === 'sent' ? outcome.externalMessageId : null,
    error: outcome.status === 'failed' ? outcome.error : null,
    remoteKey: body.idempotencyKey || null,
  })
  if (outcome.status === 'sent') {
    await pauseInboxConversationAi(conversation.id, {
      kind: 'temporary',
      until: new Date(Date.now() + CRM_OPERATOR_PAUSE_MINUTES * 60_000),
    })
  } else {
    logger.warn('Binora operator reply not delivered', {
      linkId: link.id,
      conversationId: conversation.id,
      error: outcome.error,
    })
  }
  const snapshot = await snapshotForBinora(link, conversation.id)
  await announceInboxChange(conversation.workspaceId)
  return Response.json({
    delivered: outcome.status === 'sent',
    detail: outcome.status === 'failed' ? outcome.error : '',
    messageId: outcome.status === 'sent' ? (outcome.externalMessageId ?? messageId) : null,
    conversation: snapshot ?? binoraConversationSnapshot(conversation),
  })
}

/**
 * An operator switched the AI from the lead card: the same write as the Inbox switch. ON clears
 * any pause; OFF stays off until a person turns it back on.
 */
async function handleAi(
  link: CrmLinkRecord,
  conversation: InboxConversationRecord,
  body: z.output<typeof aiBodySchema>
): Promise<Response> {
  const updated = await updateInboxConversation(conversation.id, { aiEnabled: body.enabled })
  if (!updated) return detail(404, 'conversation not found')
  if (updated.aiEnabled !== conversation.aiEnabled) {
    logger.info('Binora switched the AI', {
      linkId: link.id,
      conversationId: conversation.id,
      aiEnabled: body.enabled,
    })
  }
  const snapshot = await snapshotForBinora(link, conversation.id)
  await announceInboxChange(conversation.workspaceId)
  return Response.json({ conversation: snapshot ?? binoraConversationSnapshot(updated) })
}

/**
 * Binora calling back on `/api/crm/binora/<callback key>/<send|ai>`. The key only names the link;
 * the signature over the raw body (the link's secret) is what proves the caller is Binora, so a
 * leaked callback URL alone cannot message a customer. Only chats this link mirrored can be
 * addressed. Unknown key: 404, as if the route did not exist.
 */
export async function handleBinoraCallback(
  request: Request,
  callbackKey: string,
  action: BinoraCallbackAction
): Promise<Response> {
  const link = callbackKey ? await getCrmLinkByCallbackKey(callbackKey) : null
  if (!link || link.provider !== 'binora' || !link.connectedAt) return detail(404, 'not found')

  const raw = await readBodyCapped(request, MAX_BODY_BYTES)
  if (raw === null) return detail(413, 'body too large')

  let secret: string
  try {
    secret = (await decryptSecret(link.secretEncrypted)).decrypted
  } catch (error) {
    logger.error('CRM link secret cannot be decrypted', {
      linkId: link.id,
      error: getErrorMessage(error),
    })
    return detail(503, 'link misconfigured')
  }
  const signed = verifyBinoraSignature({
    secret,
    body: raw,
    timestamp: request.headers.get(BINORA_TIMESTAMP_HEADER),
    signature: request.headers.get(BINORA_SIGNATURE_HEADER),
  })
  if (!signed) return detail(401, 'bad signature')

  let json: unknown
  try {
    json = JSON.parse(raw || '{}')
  } catch {
    return detail(400, 'invalid json')
  }
  if (action === 'send') {
    const parsed = sendBodySchema.safeParse(json)
    if (!parsed.success) return detail(400, parsed.error.issues[0]?.message ?? 'invalid body')
    const conversation = await loadMirroredConversation(link, parsed.data.conversationId)
    if (!conversation) return detail(404, 'conversation not found')
    return handleSend(link, conversation, parsed.data)
  }
  const parsed = aiBodySchema.safeParse(json)
  if (!parsed.success) return detail(400, parsed.error.issues[0]?.message ?? 'invalid body')
  const conversation = await loadMirroredConversation(link, parsed.data.conversationId)
  if (!conversation) return detail(404, 'conversation not found')
  return handleAi(link, conversation, parsed.data)
}
