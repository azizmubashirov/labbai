import type OpenAI from 'openai'
import {
  getContentType,
  getExtensionFromMimeType,
  getFileExtension,
  isGeneratedDocumentSourceType,
  MIME_TYPE_MAPPING,
  MODEL_SUPPORTED_IMAGE_MIME_TYPES,
  resolveFileType,
} from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'
import {
  getNativeConversationMessage,
  retainConversationMessageSource,
} from '@/providers/conversation-metadata'
import {
  getProviderFileAttachment,
  INLINE_ATTACHMENT_MAX_BYTES,
  LARGE_FILE_PATH_THRESHOLD_BYTES,
  type ProviderFileAttachmentStrategy,
} from '@/providers/models'
import type { ProviderId } from '@/providers/types'

/** Labbai: OpenAI is the only provider (Responses API input parts). */
export type AttachmentProvider = 'openai'

export interface PreparedProviderAttachment {
  file: UserFile
  filename: string
  mimeType: string
  providerMimeType: string
  /** Base64 payload — present only for inlined files (≤ inline threshold). Absent for large uploaded files. */
  base64?: string
  /** `data:` URL — present only for inlined files. Absent for large uploaded files. */
  dataUrl?: string
  text?: string
  extension: string
  contentType: 'image' | 'document' | 'audio' | 'video'
  /** Provider Files API id (OpenAI/Anthropic) when the file was uploaded instead of inlined. */
  providerFileId?: string
  /** Provider File API uri (Gemini) when the file was uploaded instead of inlined. */
  providerFileUri?: string
  /** Short-lived signed HTTPS URL for providers that fetch attachments by remote URL. */
  remoteUrl?: string
}

export type ProviderAttachmentFilenameProjector = (filename: string, extension: string) => string

type ProviderMessageInput = {
  role: string
  content?: string | null
  files?: UserFile[]
}

type ProviderFormattedMessage = {
  role: string
  content?: string | null | Array<Record<string, unknown>>
  files?: UserFile[]
  [key: string]: unknown
}

/** Largest file that can be carried as inline base64 when no upload path is available. */
export const INLINE_ATTACHMENT_THRESHOLD_BYTES = INLINE_ATTACHMENT_MAX_BYTES

/** Re-exported so callers choosing a hydration cap do not reach into `models.ts` directly. */
export { LARGE_FILE_PATH_THRESHOLD_BYTES }

export type ProviderFileStrategy = ProviderFileAttachmentStrategy

/** Large-file delivery strategy for a provider, sourced from its `models.ts` definition. */
export function getProviderFileStrategy(providerId: ProviderId | string): ProviderFileStrategy {
  return getProviderFileAttachment(providerId).strategy
}

/**
 * True when a file should be delivered through the provider's large-file path rather than as
 * inline base64.
 *
 * The two strategies cross over at different sizes on purpose. `files-api` carries every type
 * this provider already accepts, so it takes over as soon as base64 stops being cacheable. A
 * `remote-url` provider only fetches images and PDFs, so switching early would start rejecting
 * text documents that inline fine today; it therefore only takes over once inlining is no longer
 * possible at all.
 *
 * Remote URLs point at the primary storage object, so source-backed generated documents can only
 * use artifact-aware Files API uploads.
 */
export function shouldUseLargeFilePath(
  file: Pick<UserFile, 'size' | 'type'>,
  providerId: ProviderId | string
): boolean {
  const strategy = getProviderFileAttachment(providerId).strategy
  if (strategy === 'inline') return false
  if (strategy === 'remote-url' && isGeneratedDocumentSourceType(file.type)) return false
  const threshold =
    strategy === 'files-api' ? LARGE_FILE_PATH_THRESHOLD_BYTES : INLINE_ATTACHMENT_THRESHOLD_BYTES
  /**
   * A file whose declared size is missing or zero cannot be routed by size. `files-api` uploads
   * read the real bytes from storage and enforce the ceiling there, so routing one is always
   * safe — and refusing to would strand it with neither base64 (hydration bails on the real
   * length) nor a handle.
   */
  if (!Number.isFinite(file.size) || file.size <= 0) return strategy === 'files-api'
  return file.size > threshold
}

const DOCUMENT_MIME_TYPES = new Set(
  Object.entries(MIME_TYPE_MAPPING)
    .filter(([, contentType]) => contentType === 'document')
    .map(([mimeType]) => mimeType)
)

const OPENAI_DOCUMENT_MIME_TYPES = new Set([...DOCUMENT_MIME_TYPES, 'application/x-yaml'])

const PROVIDER_SUPPORTED_LABELS: Record<AttachmentProvider, string> = {
  openai: 'images and documents through the Responses API input_image/input_file parts',
}

export function getAttachmentProvider(providerId: ProviderId | string): AttachmentProvider | null {
  if (providerId === 'openai') return 'openai'
  return null
}

export function supportsFileAttachments(providerId: ProviderId | string): boolean {
  return getAttachmentProvider(providerId) !== null
}

/**
 * Real maximum attachment size for a provider — its native ceiling when it has a large-file
 * path, else the inline base64 threshold. Used for UI limits and validation. It is not the
 * base64 hydration cap: that is chosen per request, because it depends on whether an upload
 * path is actually reachable — see the agent handler's `inlineMaxBytes`.
 */
export function getProviderAttachmentMaxBytes(providerId: ProviderId | string): number {
  return getProviderFileAttachment(providerId).maxBytes
}

const MEBIBYTE = 1024 * 1024

/**
 * Renders a size and the ceiling it violated, both in one unit derived from the ceiling.
 *
 * Ceilings are authored in whichever unit the vendor publishes — decimal MB for OpenAI, binary
 * MiB for everyone else — so a single fixed divisor is wrong for one group or the other: 1024²
 * reports OpenAI's 50 MB as "48MB", and 10⁶ reports Anthropic's 50 MiB as "52MB". Either way the
 * user is told a limit that does not exist. Taking the unit from the ceiling keeps the number
 * they see equal to the number the vendor documents, and keeps both figures in the same sentence
 * directly comparable.
 */
export function formatAttachmentSizes(
  bytes: number,
  limitBytes: number
): { size: string; limit: string } {
  const divisor = limitBytes % MEBIBYTE === 0 ? MEBIBYTE : 1_000_000
  /**
   * The size rounds up and the ceiling rounds down, so an over-limit file can never render as
   * the same number as the limit it broke. Rounding both to the nearest hundredth instead let a
   * file one byte over a 20 MiB cap print as "20.00MB exceeds the 20MB limit" — a sentence that
   * tells the user to shrink to a size they are already under.
   */
  const render = (value: number, round: (n: number) => number) => {
    const scaled = round((value / divisor) * 100) / 100
    return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(2)
  }
  return { size: render(bytes, Math.ceil), limit: render(limitBytes, Math.floor) }
}

export function inferAttachmentMimeType(file: UserFile): string {
  const explicitType = file.type?.trim().toLowerCase()
  return resolveFileType({
    name: file.name,
    type: isGeneratedDocumentSourceType(explicitType) ? '' : (explicitType ?? ''),
  }).toLowerCase()
}

function isTextDocumentMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/x-yaml'
  )
}

function isImageMimeType(mimeType: string): boolean {
  return MODEL_SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)
}

function isOpenAIDocumentMimeType(mimeType: string): boolean {
  return OPENAI_DOCUMENT_MIME_TYPES.has(mimeType) || isTextDocumentMimeType(mimeType)
}

function getAttachmentContentType(
  mimeType: string
): PreparedProviderAttachment['contentType'] | null {
  return getContentType(mimeType) || (isTextDocumentMimeType(mimeType) ? 'document' : null)
}

/** True only when this request path transmits the original filename to a model provider. */
export function isProviderAttachmentFilenameModelBound(
  file: UserFile,
  providerId: ProviderId | string,
  options: { largeFilePathAvailable?: boolean } = {}
): boolean {
  if (
    providerId === 'openai' &&
    options.largeFilePathAvailable &&
    shouldUseLargeFilePath(file, providerId)
  ) {
    return true
  }

  const provider = getAttachmentProvider(providerId)
  if (!provider) return false
  const contentType = getAttachmentContentType(inferAttachmentMimeType(file))
  if (contentType !== 'document') return false

  return providerId === 'openai'
}

function getProviderAttachmentFilename(
  attachment: PreparedProviderAttachment,
  projectFilename?: ProviderAttachmentFilenameProjector
): string {
  return projectFilename?.(attachment.filename, attachment.extension) ?? attachment.filename
}

function sniffImageMimeType(base64: string): string {
  let bytes: Buffer
  try {
    bytes = Buffer.from(base64, 'base64')
  } catch {
    return ''
  }

  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }

  if (
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).equals(Buffer.from('GIF87a')) ||
      bytes.subarray(0, 6).equals(Buffer.from('GIF89a')))
  ) {
    return 'image/gif'
  }

  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).equals(Buffer.from('RIFF')) &&
    bytes.subarray(8, 12).equals(Buffer.from('WEBP'))
  ) {
    return 'image/webp'
  }

  return ''
}

function getAttachmentExtension(file: UserFile, mimeType: string): string {
  if (mimeType === 'text/markdown') return 'md'
  return getExtensionFromMimeType(mimeType) || getFileExtension(file.name)
}

function normalizeProviderMimeType(mimeType: string, _provider: AttachmentProvider): string {
  return mimeType
}

function decodeBase64Text(base64: string, filename: string): string {
  try {
    return Buffer.from(base64, 'base64').toString('utf8')
  } catch {
    throw new Error(`File "${filename}" could not be decoded as UTF-8 text`)
  }
}

function toDataUrl(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`
}

function isMimeTypeSupportedByProvider(
  provider: AttachmentProvider,
  mimeType: string,
  _contentType: PreparedProviderAttachment['contentType'],
  _extension: string
): boolean {
  switch (provider) {
    case 'openai':
      return isImageMimeType(mimeType) || isOpenAIDocumentMimeType(mimeType)
    default: {
      const _exhaustive: never = provider
      return _exhaustive
    }
  }
}

function validateProviderSupport(
  attachment: Omit<PreparedProviderAttachment, 'providerMimeType' | 'dataUrl' | 'text'>,
  provider: AttachmentProvider,
  providerId: ProviderId | string
) {
  const { filename, mimeType, contentType, extension } = attachment
  const supportedLabel = PROVIDER_SUPPORTED_LABELS[provider]

  const supported = isMimeTypeSupportedByProvider(provider, mimeType, contentType, extension)

  if (!supported) {
    throw new Error(
      `File "${filename}" has MIME type "${mimeType}", which is not supported by provider "${providerId}". Supported attachments: ${supportedLabel}.`
    )
  }
}

export function prepareProviderAttachments(
  files: UserFile[] | undefined,
  providerId: ProviderId | string
): PreparedProviderAttachment[] {
  if (!files || files.length === 0) return []

  const provider = getAttachmentProvider(providerId)
  if (!provider) {
    throw new Error(`File attachments are not supported for provider "${providerId}"`)
  }

  return files.map((file) => {
    const declaredMimeType = inferAttachmentMimeType(file)
    const contentType = getAttachmentContentType(declaredMimeType)

    if (!contentType) {
      throw new Error(
        `File "${file.name}" has MIME type "${declaredMimeType}", which is not supported by provider "${providerId}". Supported attachments: ${PROVIDER_SUPPORTED_LABELS[provider]}.`
      )
    }

    const maxBytes = getProviderAttachmentMaxBytes(providerId)
    if (Number.isFinite(file.size) && file.size > maxBytes) {
      const { size: sizeMB, limit: maxMB } = formatAttachmentSizes(file.size, maxBytes)
      throw new Error(
        `File "${file.name}" (${sizeMB}MB) exceeds the ${maxMB}MB agent attachment limit for provider "${providerId}"`
      )
    }

    const providerFileId = file.providerFileId
    const providerFileUri = file.providerFileUri
    const remoteUrl = file.remoteUrl
    const hasHandle = Boolean(providerFileId || providerFileUri || remoteUrl)

    if (!file.base64 && !hasHandle) {
      throw new Error(`File "${file.name}" could not be read for provider "${providerId}"`)
    }

    const sniffedImageMimeType =
      contentType === 'image' && file.base64 ? sniffImageMimeType(file.base64) : ''
    if (contentType === 'image' && file.base64 && !sniffedImageMimeType) {
      throw new Error(
        `Image bytes in "${file.name}" are not a supported model image format (declared MIME type "${declaredMimeType}"). Supported image formats: image/jpeg, image/png, image/gif, image/webp.`
      )
    }

    const mimeType = sniffedImageMimeType || declaredMimeType
    const extension = getAttachmentExtension(file, mimeType)
    const attachment = {
      file,
      filename: file.name,
      mimeType,
      base64: file.base64,
      extension,
      contentType,
    }

    validateProviderSupport(attachment, provider, providerId)

    const providerMimeType = normalizeProviderMimeType(mimeType, provider)
    return {
      ...attachment,
      providerMimeType,
      providerFileId,
      providerFileUri,
      remoteUrl,
      ...(file.base64 && { dataUrl: toDataUrl(providerMimeType, file.base64) }),
      ...(file.base64 &&
        isTextDocumentMimeType(mimeType) && {
          text: decodeBase64Text(file.base64, file.name),
        }),
    }
  })
}

type OpenAIResponsesInputContent = OpenAI.Responses.ResponseInputContent
type OpenAIChatContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart

export function buildOpenAIMessageContent(
  content: string | null | undefined,
  files: UserFile[] | undefined,
  providerId: ProviderId | string,
  projectFilename?: ProviderAttachmentFilenameProjector
): string | OpenAIResponsesInputContent[] {
  const attachments = prepareProviderAttachments(files, providerId)
  if (attachments.length === 0) return content ?? ''

  const parts: OpenAIResponsesInputContent[] = []
  if (content) {
    parts.push({ type: 'input_text', text: content } satisfies OpenAI.Responses.ResponseInputText)
  }

  for (const attachment of attachments) {
    if (attachment.contentType === 'image') {
      parts.push(
        attachment.providerFileId
          ? ({
              type: 'input_image',
              file_id: attachment.providerFileId,
              detail: 'auto',
            } satisfies OpenAI.Responses.ResponseInputImage)
          : ({
              type: 'input_image',
              image_url: attachment.dataUrl,
              detail: 'auto',
            } satisfies OpenAI.Responses.ResponseInputImage)
      )
    } else {
      parts.push(
        attachment.providerFileId
          ? ({
              type: 'input_file',
              file_id: attachment.providerFileId,
            } satisfies OpenAI.Responses.ResponseInputFile)
          : ({
              type: 'input_file',
              filename: getProviderAttachmentFilename(attachment, projectFilename),
              file_data: attachment.dataUrl,
            } satisfies OpenAI.Responses.ResponseInputFile)
      )
    }
  }

  return parts
}

export function buildOpenAICompatibleChatContent(
  content: string | null | undefined,
  files: UserFile[] | undefined,
  providerId: ProviderId | string
): string | OpenAIChatContentPart[] {
  const attachments = prepareProviderAttachments(files, providerId)
  if (attachments.length === 0) return content ?? ''

  const parts: OpenAIChatContentPart[] = []
  if (content) {
    parts.push({
      type: 'text',
      text: content,
    } satisfies OpenAI.Chat.Completions.ChatCompletionContentPartText)
  }

  for (const attachment of attachments) {
    parts.push({
      type: 'image_url',
      image_url: {
        url: attachment.remoteUrl ?? attachment.dataUrl ?? '',
      },
    } satisfies OpenAI.Chat.Completions.ChatCompletionContentPartImage)
  }

  return parts
}

/** Providers whose own request builder consumes `files` natively (OpenAI Responses). */
const SDK_NATIVE_ATTACHMENT_PROVIDERS = new Set<AttachmentProvider>(['openai'])

export function formatMessagesForProvider(
  messages: ProviderMessageInput[],
  providerId: ProviderId | string,
  projectFilename?: ProviderAttachmentFilenameProjector
): ProviderFormattedMessage[] {
  const provider = getAttachmentProvider(providerId)
  if (provider && SDK_NATIVE_ATTACHMENT_PROVIDERS.has(provider)) {
    return messages as ProviderFormattedMessage[]
  }

  return messages.map((message) => {
    const nativeMessage = getNativeConversationMessage(message, 'chat-completions')
    if (nativeMessage && typeof nativeMessage === 'object' && !Array.isArray(nativeMessage)) {
      message = retainConversationMessageSource(message, { ...message, ...nativeMessage })
    }
    if (!message.files?.length || (message.role !== 'user' && message.role !== 'assistant')) {
      return message as ProviderFormattedMessage
    }

    const { files: _omit, ...rest } = message
    return retainConversationMessageSource(message, {
      ...rest,
      content: buildOpenAICompatibleChatContent(message.content, message.files, providerId) as
        | string
        | Array<Record<string, unknown>>,
    })
  })
}
