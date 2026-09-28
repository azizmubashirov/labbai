'use client'

import { useRef, useState } from 'react'
import { Chip, ChipTextarea, Tooltip, toast } from '@sim/emcn'
import { FileText, Mic, Paperclip, Send, X } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { INBOX_REPLY_MAX_LENGTH } from '@/lib/api/contracts/inbox'
import {
  INBOX_CAPTION_MAX_LENGTH,
  inboxOutgoingKind,
  inboxOutgoingSizeError,
} from '@/lib/inbox/attachments'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import {
  useVoiceRecorder,
  type VoiceRecorderError,
} from '@/app/workspace/[workspaceId]/inbox/hooks/use-voice-recorder'
import {
  formatRecordingTime,
  readFileAsDataUrl,
  voiceFileName,
} from '@/app/workspace/[workspaceId]/inbox/utils'
import {
  type InboxConversation,
  type InboxOutgoingAttachmentBody,
  useReplyToInboxConversation,
} from '@/hooks/queries/inbox'

const VOICE_ERRORS: Record<VoiceRecorderError, string> = {
  unsupported: 'This browser cannot record voice messages.',
  'microphone-blocked': 'Allow microphone access for this site to record a voice message.',
  'microphone-unavailable': 'No microphone was found.',
}

const FALLBACK_CONTENT_TYPE = 'application/octet-stream'

/** A file picked for the next reply, already read so it can be previewed and sent. */
interface PendingFile {
  name: string
  size: number
  contentType: string
  /** `data:` URL of the file: the image preview and, after the comma, the base64 upload. */
  dataUrl: string
  isImage: boolean
}

function base64FromDataUrl(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

interface PendingFilePreviewProps {
  file: PendingFile
  disabled: boolean
  onRemove: () => void
}

function PendingFilePreview({ file, disabled, onRemove }: PendingFilePreviewProps) {
  return (
    <div className='flex w-fit max-w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1.5 pr-1'>
      {file.isImage ? (
        <img
          src={file.dataUrl}
          alt={file.name}
          className='size-[40px] shrink-0 rounded-md object-cover'
        />
      ) : (
        <span className='flex size-[40px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-5)]'>
          <FileText className='size-[16px] text-[var(--text-icon)]' />
        </span>
      )}
      <div className='flex min-w-0 flex-col'>
        <span className='truncate text-[var(--text-body)] text-small'>{file.name}</span>
        <span className='text-[var(--text-muted)] text-caption'>{formatFileSize(file.size)}</span>
      </div>
      <Chip
        shape='round'
        leftIcon={X}
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${file.name}`}
      />
    </div>
  )
}

interface RecordingBarProps {
  elapsedMs: number
  onCancel: () => void
  onSend: () => void
}

function RecordingBar({ elapsedMs, onCancel, onSend }: RecordingBarProps) {
  return (
    <div className='flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2'>
      <span className='size-[8px] shrink-0 animate-pulse rounded-full bg-[var(--text-error)]' />
      <span className='flex-1 text-[var(--text-body)] text-small tabular-nums' aria-live='polite'>
        Recording {formatRecordingTime(elapsedMs)}
      </span>
      <Chip leftIcon={X} onClick={onCancel} aria-label='Cancel recording'>
        Cancel
      </Chip>
      <Chip variant='primary' leftIcon={Send} onClick={onSend} aria-label='Send voice message'>
        Send
      </Chip>
    </div>
  )
}

interface ReplyBoxProps {
  workspaceId: string
  conversation: InboxConversation
  canEdit: boolean
}

/**
 * The operator's reply box: text, one attached photo or file (the text becomes its caption), or a
 * voice message recorded in the browser.
 */
export function ReplyBox({ workspaceId, conversation, canEdit }: ReplyBoxProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const reply = useReplyToInboxConversation(workspaceId)
  const [draft, setDraft] = useState('')
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null)
  const [isReadingFile, setIsReadingFile] = useState(false)

  const sendReply = (
    text: string,
    attachment: InboxOutgoingAttachmentBody | undefined,
    onSent: () => void
  ) => {
    reply.mutate(
      { conversationId: conversation.id, text, attachment },
      {
        onSuccess: (result) => {
          onSent()
          if (!result.delivered) toast.error(result.error ?? 'The message was not delivered')
        },
        onError: (mutationError) =>
          toast.error(getErrorMessage(mutationError, 'Could not send the message')),
      }
    )
  }

  const recorder = useVoiceRecorder({
    onRecorded: async (recording) => {
      const contentType = recording.type || 'audio/webm'
      const sizeError = inboxOutgoingSizeError(conversation.channel, 'voice', recording.size)
      if (sizeError) {
        toast.error(sizeError)
        return
      }
      try {
        const dataUrl = await readFileAsDataUrl(recording)
        sendReply(
          '',
          {
            fileName: voiceFileName(contentType),
            contentType,
            data: base64FromDataUrl(dataUrl),
            voice: true,
          },
          () => {}
        )
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not read the recording'))
      }
    },
    onError: (error) => toast.error(VOICE_ERRORS[error]),
  })

  const busy = !canEdit || reply.isPending || isReadingFile

  const handleFilePicked = async (file: File) => {
    const contentType = file.type || FALLBACK_CONTENT_TYPE
    const kind = inboxOutgoingKind(contentType, false)
    const sizeError = inboxOutgoingSizeError(conversation.channel, kind, file.size)
    if (sizeError) {
      toast.error(sizeError)
      return
    }
    setIsReadingFile(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setPendingFile({
        name: file.name || 'file',
        size: file.size,
        contentType,
        dataUrl,
        isImage: kind === 'image',
      })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not read the file'))
    } finally {
      setIsReadingFile(false)
    }
  }

  const handleSend = () => {
    if (busy) return
    const text = draft.trim()
    if (!pendingFile) {
      if (text) sendReply(text, undefined, () => setDraft(''))
      return
    }
    if (text.length > INBOX_CAPTION_MAX_LENGTH) {
      toast.error(`A caption must be ${INBOX_CAPTION_MAX_LENGTH} characters or fewer`)
      return
    }
    sendReply(
      text,
      {
        fileName: pendingFile.name,
        contentType: pendingFile.contentType,
        data: base64FromDataUrl(pendingFile.dataUrl),
      },
      () => {
        setDraft('')
        setPendingFile(null)
      }
    )
  }

  const canSend = !busy && (pendingFile !== null || draft.trim().length > 0)

  return (
    <footer className='flex flex-col gap-2 border-[var(--border)] border-t p-3'>
      {conversation.aiEnabled && (
        <p className='text-[var(--text-muted)] text-caption'>
          AI is answering this customer. Turn AI off to take over the conversation.
        </p>
      )}
      {pendingFile && (
        <PendingFilePreview
          file={pendingFile}
          disabled={reply.isPending}
          onRemove={() => setPendingFile(null)}
        />
      )}
      <input
        ref={fileInputRef}
        type='file'
        className='hidden'
        tabIndex={-1}
        aria-hidden='true'
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void handleFilePicked(file)
        }}
      />
      <div className='flex items-end gap-2'>
        {recorder.isRecording ? (
          <RecordingBar
            elapsedMs={recorder.elapsedMs}
            onCancel={recorder.cancel}
            onSend={recorder.stop}
          />
        ) : (
          <>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Chip
                  shape='round'
                  leftIcon={Paperclip}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy || pendingFile !== null}
                  aria-label='Attach a photo or file'
                />
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>Attach a photo or file</Tooltip.Content>
            </Tooltip.Root>
            <ChipTextarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  handleSend()
                }
              }}
              placeholder={
                canEdit
                  ? pendingFile
                    ? 'Add a caption…'
                    : 'Write a reply…'
                  : 'You have read-only access'
              }
              aria-label={pendingFile ? 'Caption' : 'Reply'}
              maxLength={pendingFile ? INBOX_CAPTION_MAX_LENGTH : INBOX_REPLY_MAX_LENGTH}
              disabled={busy}
              rows={2}
              className='min-w-0 flex-1'
            />
            {pendingFile || draft.trim().length > 0 ? (
              <Chip variant='primary' onClick={handleSend} disabled={!canSend}>
                {reply.isPending ? 'Sending…' : 'Send'}
              </Chip>
            ) : (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Chip
                    shape='round'
                    leftIcon={Mic}
                    onClick={() => void recorder.start()}
                    disabled={busy}
                    aria-label='Record a voice message'
                  />
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>Record a voice message</Tooltip.Content>
              </Tooltip.Root>
            )}
          </>
        )}
      </div>
    </footer>
  )
}
