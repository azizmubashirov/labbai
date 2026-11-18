import type { InstagramAutoReplyEvent } from '@/lib/api/contracts/instagram-auto-reply'
import type { InboxConversation, InboxMessage } from '@/hooks/queries/inbox'

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

/** One row of a conversation timeline: a message, or a read-only Instagram auto-reply. */
export type ThreadTimelineItem =
  | { kind: 'message'; id: string; createdAt: Date; message: InboxMessage }
  | { kind: 'auto_reply'; id: string; createdAt: Date; event: InstagramAutoReplyEvent }

interface ThreadTimelineInput {
  /** Messages oldest first, as the thread renders them. */
  messages: readonly InboxMessage[]
  /** Auto-reply events from this contact, in any order. */
  events: readonly InstagramAutoReplyEvent[]
  /** True when earlier messages exist that are not loaded yet. */
  hasEarlierMessages: boolean
}

/**
 * Interleaves auto-reply events with the conversation's messages by time, oldest first. While
 * earlier messages are still unloaded, events older than the first loaded message are held back,
 * so they never appear above a gap in the conversation.
 */
export function buildThreadTimeline({
  messages,
  events,
  hasEarlierMessages,
}: ThreadTimelineInput): ThreadTimelineItem[] {
  const earliest = hasEarlierMessages ? messages[0]?.createdAt : undefined
  const items: ThreadTimelineItem[] = messages.map((message) => ({
    kind: 'message',
    id: message.id,
    createdAt: message.createdAt,
    message,
  }))
  for (const event of events) {
    if (earliest && event.createdAt < earliest) continue
    items.push({ kind: 'auto_reply', id: event.id, createdAt: event.createdAt, event })
  }
  return items.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
}
