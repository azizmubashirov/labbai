import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { generateId } from '@labbai/utils/id'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import { isChannelVoiceFormat } from '@/lib/inbox/attachments'
import type { InboxChannel } from '@/lib/inbox/channels'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
import {
  downloadFileStream,
  generatePresignedDownloadUrl,
  hasCloudStorage,
  uploadFile,
} from '@/lib/uploads/core/storage-service'

const logger = createLogger('InboxOperatorMedia')

/** Operator files share the workspace bucket; the prefix keeps them apart from Files. */
const OPERATOR_MEDIA_CONTEXT = 'workspace' as const

/** How long the link Instagram downloads an operator's file from stays valid. */
const PUBLIC_LINK_TTL_SECONDS = 60 * 60

/** An operator's file as it is sent and stored. */
export interface InboxOperatorFile {
  buffer: Buffer
  mimeType: string
  fileName: string
}

/** Where an operator's files for one conversation are stored. */
export function inboxOperatorMediaPrefix(workspaceId: string, conversationId: string): string {
  return `workspace/${workspaceId}/inbox/${conversationId}/`
}

/**
 * Keeps an operator's file in the app's file storage so the thread can show it afterwards and
 * Instagram can fetch it. Returns the storage key.
 */
export async function storeInboxOperatorFile(params: {
  workspaceId: string
  conversationId: string
  file: InboxOperatorFile
}): Promise<string> {
  const prefix = inboxOperatorMediaPrefix(params.workspaceId, params.conversationId)
  const unique = `${Date.now()}-${generateId().slice(0, 8)}-`
  const key = `${prefix}${buildStorageKeySegment(unique, params.file.fileName)}`
  const stored = await uploadFile({
    file: params.file.buffer,
    fileName: params.file.fileName,
    contentType: params.file.mimeType,
    context: OPERATOR_MEDIA_CONTEXT,
    customKey: key,
    preserveKey: true,
  })
  return stored.key
}

/** Streams a stored operator file back for the thread view. */
export async function readInboxOperatorFile(
  storageKey: string
): Promise<ReadableStream<Uint8Array>> {
  const stream = await downloadFileStream({ key: storageKey, context: OPERATOR_MEDIA_CONTEXT })
  return nodeReadableToWebStream(stream)
}

/**
 * A link anyone can download a stored operator file from for the next hour, or null when files
 * live on this server's disk: then the only link is the app's own signed-in file route, which
 * Meta cannot open. Instagram sends attachments only from such a public link.
 */
export async function publicInboxOperatorFileUrl(storageKey: string): Promise<string | null> {
  if (!hasCloudStorage()) return null
  try {
    return await generatePresignedDownloadUrl(
      storageKey,
      OPERATOR_MEDIA_CONTEXT,
      PUBLIC_LINK_TTL_SECONDS
    )
  } catch (error) {
    logger.warn('Could not create a public link for an Inbox file', {
      error: getErrorMessage(error),
    })
    return null
  }
}

interface VoiceTarget {
  /** ffmpeg output extension: `.opus` is an OGG container with Opus audio. */
  format: string
  mimeType: string
  fileName: string
}

/** What a recording is converted to when the browser recorded another format. */
const VOICE_TARGETS: Record<InboxChannel, VoiceTarget> = {
  telegram: { format: 'opus', mimeType: 'audio/ogg', fileName: 'voice.ogg' },
  whatsapp: { format: 'opus', mimeType: 'audio/ogg', fileName: 'voice.ogg' },
  instagram: { format: 'm4a', mimeType: 'audio/mp4', fileName: 'voice.m4a' },
}

/**
 * Browsers record WebM/Opus (Chrome, Firefox) or MP4/AAC (Safari), while Telegram and WhatsApp
 * show a voice note only for OGG/Opus and Instagram plays AAC/M4A. The recording is converted
 * with ffmpeg (installed in the app image). When ffmpeg is missing or fails, the original file is
 * kept and goes out as a plain file instead of a voice note.
 */
export async function prepareInboxVoiceNote(
  channel: InboxChannel,
  file: InboxOperatorFile
): Promise<InboxOperatorFile> {
  if (isChannelVoiceFormat(channel, file.mimeType)) return file
  const target = VOICE_TARGETS[channel]
  try {
    const { runFfmpegOperation } = await import('@/lib/media/ffmpeg')
    const result = await runFfmpegOperation(
      'convert',
      [{ buffer: file.buffer, mimeType: file.mimeType, name: file.fileName }],
      { format: target.format }
    )
    if (!result.buffer || result.buffer.length === 0) return file
    return { buffer: result.buffer, mimeType: target.mimeType, fileName: target.fileName }
  } catch (error) {
    logger.warn('Could not convert an Inbox voice recording; sending it as a file', {
      channel,
      mimeType: file.mimeType,
      error: getErrorMessage(error),
    })
    return file
  }
}
