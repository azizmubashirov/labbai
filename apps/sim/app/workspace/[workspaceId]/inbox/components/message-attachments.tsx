'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn'
import { Compass, FileText, Link, Paperclip } from '@sim/emcn/icons'
import { INBOX_ATTACHMENT_LABELS } from '@/lib/inbox/attachments'
import { type InboxMessageAttachment, inboxAttachmentUrl } from '@/hooks/queries/inbox'

type MediaView = 'image' | 'video' | 'audio' | 'file'

/** How an attachment renders, decided by its MIME type first and its kind second. */
function mediaView(attachment: InboxMessageAttachment): MediaView {
  const mime = attachment.mimeType ?? ''
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (attachment.mimeType === null) {
    if (attachment.kind === 'image') return 'image'
    if (attachment.kind === 'video') return 'video'
    if (attachment.kind === 'audio' || attachment.kind === 'voice') return 'audio'
  }
  return 'file'
}

const LINK_ICONS = { location: Compass, link: Link } as const

interface AttachmentChipProps {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  download?: boolean
}

function AttachmentChip({ href, icon: Icon, label, download = false }: AttachmentChipProps) {
  return (
    <a
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      download={download || undefined}
      className='flex max-w-[260px] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[var(--text-body)] text-small transition-colors hover-hover:bg-[var(--surface-hover)]'
    >
      <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
      <span className='truncate'>{label}</span>
    </a>
  )
}

interface MediaAttachmentProps {
  attachment: InboxMessageAttachment
  src: string
}

/** A photo, video or voice note streamed from the channel; falls back to a chip if it is gone. */
function MediaAttachment({ attachment, src }: MediaAttachmentProps) {
  const [failed, setFailed] = useState(false)
  const label = attachment.fileName ?? INBOX_ATTACHMENT_LABELS[attachment.kind]
  const view = mediaView(attachment)

  if (failed) {
    return (
      <span className='flex items-center gap-2 px-1 text-[var(--text-muted)] text-caption'>
        <Paperclip className='size-[12px] shrink-0' />
        {label} could not be loaded from the channel
      </span>
    )
  }

  switch (view) {
    case 'image':
      return (
        <a href={src} target='_blank' rel='noopener noreferrer' className='block'>
          <img
            src={src}
            alt={label}
            loading='lazy'
            onError={() => setFailed(true)}
            className={cn(
              'max-h-[280px] max-w-[260px] rounded-lg object-contain',
              attachment.kind !== 'sticker' && 'border border-[var(--border)]'
            )}
          />
        </a>
      )
    case 'video':
      return (
        <video
          src={src}
          controls
          preload='metadata'
          onError={() => setFailed(true)}
          className='max-h-[280px] max-w-[260px] rounded-lg border border-[var(--border)]'
        >
          <track kind='captions' />
        </video>
      )
    case 'audio':
      return (
        <audio
          src={src}
          controls
          preload='none'
          onError={() => setFailed(true)}
          className='w-[260px] max-w-full'
          aria-label={label}
        >
          <track kind='captions' />
        </audio>
      )
    case 'file':
      return <AttachmentChip href={src} icon={FileText} label={label} download />
  }
}

interface MessageAttachmentsProps {
  workspaceId: string
  conversationId: string
  messageId: string
  attachments: InboxMessageAttachment[]
  align: 'start' | 'end'
}

/** Media and links sent with a message, shown above its text. */
export function MessageAttachments({
  workspaceId,
  conversationId,
  messageId,
  attachments,
  align,
}: MessageAttachmentsProps) {
  if (attachments.length === 0) return null
  return (
    <div className={cn('flex flex-col gap-1.5', align === 'start' ? 'items-start' : 'items-end')}>
      {attachments.map((attachment) => {
        if (attachment.downloadable) {
          return (
            <MediaAttachment
              key={attachment.index}
              attachment={attachment}
              src={inboxAttachmentUrl(workspaceId, conversationId, messageId, attachment.index)}
            />
          )
        }
        const label = attachment.fileName ?? INBOX_ATTACHMENT_LABELS[attachment.kind]
        if (
          attachment.link?.startsWith('https://') &&
          (attachment.kind === 'location' || attachment.kind === 'link')
        ) {
          return (
            <AttachmentChip
              key={attachment.index}
              href={attachment.link}
              icon={LINK_ICONS[attachment.kind]}
              label={label}
            />
          )
        }
        return (
          <span
            key={attachment.index}
            className='flex items-center gap-2 px-1 text-[var(--text-muted)] text-caption'
          >
            <Paperclip className='size-[12px] shrink-0' />
            {label}
          </span>
        )
      })}
    </div>
  )
}
