import { toStringOrNull } from '@sim/utils/coerce'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import {
  baseMimeType,
  type InboxOutgoingKind,
  isChannelVoiceFormat,
} from '@/lib/inbox/attachments'
import { configString, resolveConversationChannelConfig } from '@/lib/inbox/channel-config'
import type { InboxChannel } from '@/lib/inbox/channels'
import { parseOutboundToolMessage } from '@/lib/inbox/outbound'
import type { InboxConversationRecord } from '@/lib/inbox/repository'
import { executeTool } from '@/tools'
import { INSTAGRAM_GRAPH_BASE } from '@/tools/instagram/constants'
import { readGraphError } from '@/tools/instagram/utils'
import {
  buildMediaMessageBody,
  buildMediaUploadUrl,
  buildMessagesUrl,
  extractWhatsAppErrorMessage,
} from '@/tools/whatsapp/utils'

export type InboxSendOutcome =
  | { status: 'sent'; externalMessageId: string | null }
  | { status: 'failed'; error: string }

/**
 * Why a reply cannot be sent at all, as opposed to a provider rejecting it. Shown to the operator
 * as the message's failure reason so they know what to configure.
 */
function unavailable(error: string): InboxSendOutcome {
  return { status: 'failed', error }
}

/**
 * Channel errors an operator can act on, rewritten in plain words. Anything else is shown as the
 * channel reported it.
 */
const FRIENDLY_CHANNEL_ERRORS: Array<{
  channels: InboxChannel[]
  pattern: RegExp
  message: string
}> = [
  {
    channels: ['instagram'],
    pattern: /outside of (the )?allowed window|2534022/i,
    message:
      "Instagram only allows replies within 24 hours of the customer's last message. Wait for the customer to write again.",
  },
  {
    channels: ['whatsapp'],
    pattern: /131047|re-engagement|more than 24 hours/i,
    message:
      "WhatsApp only allows free-form replies within 24 hours of the customer's last message. Send an approved template from a workflow, or wait for the customer to write again.",
  },
  {
    channels: ['telegram'],
    pattern: /bot was blocked by the user/i,
    message: 'The customer blocked this bot on Telegram.',
  },
  {
    channels: ['telegram'],
    pattern: /user is deactivated/i,
    message: "The customer's Telegram account is deleted.",
  },
  {
    channels: ['whatsapp'],
    pattern: /131053|media upload error/i,
    message: 'WhatsApp did not accept this file. Send it as a PDF, an image, or an audio file.',
  },
  {
    channels: ['telegram'],
    pattern: /PHOTO_INVALID_DIMENSIONS|IMAGE_PROCESS_FAILED/i,
    message: 'Telegram could not process this photo. Try a smaller or less elongated image.',
  },
  {
    channels: ['telegram', 'whatsapp', 'instagram'],
    pattern: /\b401\b|invalid (oauth )?access token|unauthorized|session has expired/i,
    message:
      "The channel rejected the trigger's credentials. Reconnect the account on the trigger.",
  },
]

/** Plain-language version of a channel error when one is known. */
export function friendlyChannelError(channel: InboxChannel, error: string): string {
  const match = FRIENDLY_CHANNEL_ERRORS.find(
    (entry) => entry.channels.includes(channel) && entry.pattern.test(error)
  )
  return match?.message ?? error
}

function toolCall(
  conversation: InboxConversationRecord,
  providerConfig: Record<string, unknown>,
  text: string
): { toolId: string; params: Record<string, unknown> } | string {
  switch (conversation.channel) {
    case 'telegram': {
      const botToken = configString(providerConfig, 'botToken')
      if (!botToken) {
        return 'The Telegram trigger has no bot token.'
      }
      return {
        toolId: 'telegram_message',
        params: { botToken, chatId: conversation.externalChatId, text },
      }
    }
    case 'whatsapp': {
      const accessToken = configString(providerConfig, 'accessToken')
      if (!accessToken) {
        return 'Add an access token to the WhatsApp trigger to reply from the Inbox.'
      }
      return {
        toolId: 'whatsapp_send_message',
        params: {
          phoneNumber: conversation.externalChatId,
          phoneNumberId: conversation.accountId,
          accessToken,
          message: text,
        },
      }
    }
    case 'instagram': {
      const credentialId = configString(providerConfig, 'credentialId')
      if (!credentialId) {
        return 'Select an Instagram account on the Instagram trigger to reply from the Inbox.'
      }
      return {
        toolId: 'instagram_send_text_message',
        params: {
          credential: credentialId,
          igUserId: conversation.accountId,
          recipientId: conversation.externalChatId,
          message: text,
        },
      }
    }
  }
}

/** A file the operator sends, prepared for the channel. */
export interface InboxOutgoingMedia {
  kind: InboxOutgoingKind
  buffer: Buffer
  mimeType: string
  fileName: string
  /** A link Meta can download the stored file from; Instagram sends attachments only by link. */
  publicUrl: string | null
}

/** Bounds one media send, including the upload of the file to the channel. */
const MEDIA_SEND_TIMEOUT_MS = 60_000

const CONNECTION_RESET_CODES: ReadonlySet<string> = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE'])
const CONNECTION_RESET_ATTEMPTS = 3

function isConnectionReset(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && CONNECTION_RESET_CODES.has(code)
}

/**
 * Connections to api.telegram.org are occasionally reset before a response arrives on some
 * networks; retry those a couple of times instead of failing the operator's send.
 */
async function fetchRetryingConnectionResets(
  url: string,
  buildInit: () => RequestInit
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, buildInit())
    } catch (error) {
      if (attempt >= CONNECTION_RESET_ATTEMPTS || !isConnectionReset(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
    }
  }
}

const FALLBACK_ERROR = 'The channel rejected the message.'

function sent(externalMessageId: unknown): InboxSendOutcome {
  const id =
    typeof externalMessageId === 'string' || typeof externalMessageId === 'number'
      ? String(externalMessageId)
      : null
  return { status: 'sent', externalMessageId: id }
}

function failed(channel: InboxChannel, error: string): InboxSendOutcome {
  return { status: 'failed', error: friendlyChannelError(channel, error) }
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown>> {
  return toRecord(await response.json().catch(() => ({})))
}

function fileBlob(media: InboxOutgoingMedia): Blob {
  return new Blob([new Uint8Array(media.buffer)], { type: media.mimeType })
}

/** Formats Telegram's `sendVoice` accepts; anything else would be rejected as a voice note. */
const TELEGRAM_VOICE_TYPES: ReadonlySet<string> = new Set(['audio/ogg', 'audio/mpeg', 'audio/mp4'])

/** Telegram Bot API method and form field for each kind of file. */
const TELEGRAM_MEDIA_METHODS: Record<InboxOutgoingKind, { method: string; field: string }> = {
  image: { method: 'sendPhoto', field: 'photo' },
  voice: { method: 'sendVoice', field: 'voice' },
  document: { method: 'sendDocument', field: 'document' },
}

async function sendTelegramMedia(
  botToken: string,
  chatId: string,
  media: InboxOutgoingMedia,
  caption: string
): Promise<InboxSendOutcome> {
  const kind =
    media.kind === 'voice' && !TELEGRAM_VOICE_TYPES.has(baseMimeType(media.mimeType))
      ? 'document'
      : media.kind
  const { method, field } = TELEGRAM_MEDIA_METHODS[kind]
  const form = new FormData()
  form.append('chat_id', chatId)
  form.append(field, fileBlob(media), media.fileName)
  if (caption) form.append('caption', caption)

  const response = await fetchRetryingConnectionResets(
    `https://api.telegram.org/bot${botToken}/${method}`,
    () => ({ method: 'POST', body: form, signal: AbortSignal.timeout(MEDIA_SEND_TIMEOUT_MS) })
  )
  const data = await readJsonRecord(response)
  if (!response.ok || data.ok !== true) {
    return failed(
      'telegram',
      toStringOrNull(data.description) ?? `Telegram rejected the file (${response.status}).`
    )
  }
  return sent(toRecord(data.result).message_id)
}

/** Audio formats WhatsApp accepts in an audio message; OGG must carry Opus. */
const WHATSAPP_AUDIO_TYPES: ReadonlySet<string> = new Set([
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
])

function whatsappMediaType(media: InboxOutgoingMedia): 'image' | 'audio' | 'document' {
  if (media.kind === 'image') return 'image'
  if (media.kind === 'voice' && WHATSAPP_AUDIO_TYPES.has(baseMimeType(media.mimeType))) {
    return 'audio'
  }
  return 'document'
}

/**
 * Uploads the file to WhatsApp, then sends it. Audio messages carry no caption, so for a voice
 * note the text is returned as still to be sent.
 */
async function sendWhatsAppMedia(
  accessToken: string,
  phoneNumberId: string,
  phoneNumber: string,
  media: InboxOutgoingMedia,
  caption: string
): Promise<{ outcome: InboxSendOutcome; captionSent: boolean }> {
  const authorization = { Authorization: `Bearer ${accessToken.trim()}` }
  const upload = new FormData()
  upload.append('messaging_product', 'whatsapp')
  upload.append('type', baseMimeType(media.mimeType))
  upload.append('file', fileBlob(media), media.fileName)
  const uploadResponse = await fetch(buildMediaUploadUrl(phoneNumberId), {
    method: 'POST',
    headers: authorization,
    body: upload,
    signal: AbortSignal.timeout(MEDIA_SEND_TIMEOUT_MS),
  })
  const uploaded = await readJsonRecord(uploadResponse)
  const mediaId = toStringOrNull(uploaded.id)
  if (!uploadResponse.ok || !mediaId) {
    return {
      outcome: failed('whatsapp', extractWhatsAppErrorMessage(uploaded, uploadResponse.status)),
      captionSent: false,
    }
  }

  const mediaType = whatsappMediaType(media)
  const captionSent = mediaType !== 'audio' && caption.length > 0
  const response = await fetch(buildMessagesUrl(phoneNumberId), {
    method: 'POST',
    headers: { ...authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(
      buildMediaMessageBody({
        phoneNumber,
        mediaType,
        mediaId,
        caption: captionSent ? caption : undefined,
        filename: mediaType === 'document' ? media.fileName : undefined,
      })
    ),
    signal: AbortSignal.timeout(MEDIA_SEND_TIMEOUT_MS),
  })
  const data = await readJsonRecord(response)
  if (!response.ok) {
    return {
      outcome: failed('whatsapp', extractWhatsAppErrorMessage(data, response.status)),
      captionSent: false,
    }
  }
  const [first] = Array.isArray(data.messages) ? data.messages : []
  return { outcome: sent(toRecord(first).id), captionSent }
}

function instagramAttachmentType(media: InboxOutgoingMedia): 'image' | 'audio' | 'video' | 'file' {
  if (media.kind === 'image') return 'image'
  if (media.kind === 'voice') {
    return isChannelVoiceFormat('instagram', media.mimeType) ? 'audio' : 'file'
  }
  const mime = baseMimeType(media.mimeType)
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

const INSTAGRAM_NO_PUBLIC_LINK =
  'Instagram downloads files from a public link, and this server keeps files on its own disk. ' +
  'Connect cloud file storage (S3, Azure Blob or Google Cloud Storage) to send files on Instagram.'

/** The trigger account's Instagram token, resolved as the operator so their access is checked. */
async function instagramAccessToken(credentialId: string, operatorUserId: string) {
  const [{ resolveExecutorCredentialToken }, { getCanonicalScopesForProvider }] =
    await Promise.all([import('@/executor/utils/credential-token'), import('@/lib/oauth/utils')])
  const scopes = getCanonicalScopesForProvider('instagram')
  const token = await resolveExecutorCredentialToken({
    requestId: generateId().slice(0, 8),
    credentialId,
    userId: operatorUserId,
    toolId: 'instagram_send_text_message',
    toolLabel: 'Instagram',
    scopes: scopes.length > 0 ? scopes : undefined,
    enforceCredentialAccess: true,
  })
  return token.accessToken
}

async function sendInstagramMedia(
  accessToken: string,
  igUserId: string,
  recipientId: string,
  media: InboxOutgoingMedia,
  publicUrl: string
): Promise<InboxSendOutcome> {
  const response = await fetch(`${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(igUserId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: {
        attachment: { type: instagramAttachmentType(media), payload: { url: publicUrl } },
      },
    }),
    signal: AbortSignal.timeout(MEDIA_SEND_TIMEOUT_MS),
  })
  if (!response.ok) return failed('instagram', await readGraphError(response))
  const data = await readJsonRecord(response)
  return sent(data.message_id)
}

/** Sends plain text through the conversation's channel tool, as the operator. */
async function sendTextThroughTool(
  conversation: InboxConversationRecord,
  providerConfig: Record<string, unknown>,
  text: string,
  operatorUserId: string
): Promise<InboxSendOutcome> {
  const call = toolCall(conversation, providerConfig, text)
  if (typeof call === 'string') return unavailable(call)

  try {
    const result = await executeTool(call.toolId, {
      ...call.params,
      _context: {
        userId: operatorUserId,
        workspaceId: conversation.workspaceId,
        enforceCredentialAccess: true,
      },
    })
    if (!result.success) return failed(conversation.channel, result.error ?? FALLBACK_ERROR)
    const delivered = parseOutboundToolMessage(call.toolId, call.params, result.output)
    return { status: 'sent', externalMessageId: delivered?.externalMessageId ?? null }
  } catch (error) {
    return failed(conversation.channel, getErrorMessage(error, FALLBACK_ERROR))
  }
}

/**
 * A caption that has to follow the file as its own message (Instagram attachments and WhatsApp
 * audio carry none). The file already reached the customer, so a failed caption is reported
 * without hiding that.
 */
async function sendFollowUpCaption(
  conversation: InboxConversationRecord,
  providerConfig: Record<string, unknown>,
  caption: string,
  operatorUserId: string,
  mediaOutcome: InboxSendOutcome
): Promise<InboxSendOutcome> {
  if (mediaOutcome.status !== 'sent' || caption.length === 0) return mediaOutcome
  const textOutcome = await sendTextThroughTool(
    conversation,
    providerConfig,
    caption,
    operatorUserId
  )
  if (textOutcome.status === 'sent') return mediaOutcome
  return {
    status: 'failed',
    error: `The file was delivered, but the text was not: ${textOutcome.error}`,
  }
}

async function sendMedia(
  conversation: InboxConversationRecord,
  providerConfig: Record<string, unknown>,
  media: InboxOutgoingMedia,
  caption: string,
  operatorUserId: string
): Promise<InboxSendOutcome> {
  switch (conversation.channel) {
    case 'telegram': {
      const botToken = configString(providerConfig, 'botToken')
      if (!botToken) return unavailable('The Telegram trigger has no bot token.')
      return sendTelegramMedia(botToken, conversation.externalChatId, media, caption)
    }
    case 'whatsapp': {
      const accessToken = configString(providerConfig, 'accessToken')
      if (!accessToken) {
        return unavailable('Add an access token to the WhatsApp trigger to reply from the Inbox.')
      }
      const { outcome, captionSent } = await sendWhatsAppMedia(
        accessToken,
        conversation.accountId,
        conversation.externalChatId,
        media,
        caption
      )
      return captionSent
        ? outcome
        : sendFollowUpCaption(conversation, providerConfig, caption, operatorUserId, outcome)
    }
    case 'instagram': {
      const credentialId = configString(providerConfig, 'credentialId')
      if (!credentialId) {
        return unavailable(
          'Select an Instagram account on the Instagram trigger to reply from the Inbox.'
        )
      }
      if (!media.publicUrl) return unavailable(INSTAGRAM_NO_PUBLIC_LINK)
      const accessToken = await instagramAccessToken(credentialId, operatorUserId)
      const outcome = await sendInstagramMedia(
        accessToken,
        conversation.accountId,
        conversation.externalChatId,
        media,
        media.publicUrl
      )
      return sendFollowUpCaption(conversation, providerConfig, caption, operatorUserId, outcome)
    }
  }
}

/**
 * Delivers an operator reply through the channel the conversation came from, using the
 * credentials on the trigger that last received a message in it. The operator's identity scopes
 * credential access, so an operator can only send through an account they may use. With `media`,
 * the file goes out as a photo, voice note or file and `text` becomes its caption.
 */
export async function sendInboxReply(params: {
  conversation: InboxConversationRecord
  text: string
  operatorUserId: string
  media?: InboxOutgoingMedia
}): Promise<InboxSendOutcome> {
  const { conversation } = params
  const channelConfig = await resolveConversationChannelConfig(conversation)
  if (!channelConfig.ok) return unavailable(channelConfig.error)

  if (!params.media) {
    return sendTextThroughTool(
      conversation,
      channelConfig.providerConfig,
      params.text,
      params.operatorUserId
    )
  }

  try {
    return await sendMedia(
      conversation,
      channelConfig.providerConfig,
      params.media,
      params.text,
      params.operatorUserId
    )
  } catch (error) {
    return failed(conversation.channel, getErrorMessage(error, FALLBACK_ERROR))
  }
}
