import type { InboxConversation } from '@/hooks/queries/inbox'

/** Contact name, then handle, then raw channel id, so every conversation has a title. */
export function conversationTitle(conversation: InboxConversation): string {
  return conversation.contactName ?? conversation.contactHandle ?? conversation.externalChatId
}

/** Reads a file or recording as a `data:` URL (preview source and base64 payload in one). */
export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Could not read the file'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

const VOICE_EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
}

/** File name for a browser recording, by its format: `voice.ogg`, `voice.webm`, `voice.m4a`. */
export function voiceFileName(contentType: string): string {
  const mime = contentType.split(';')[0].trim().toLowerCase()
  return `voice.${VOICE_EXTENSIONS[mime] ?? 'webm'}`
}

/** Elapsed recording time as `m:ss`. */
export function formatRecordingTime(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
