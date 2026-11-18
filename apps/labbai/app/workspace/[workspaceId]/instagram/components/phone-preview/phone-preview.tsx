'use client'

import { ChipSwitch, cn, OverflowText } from '@labbai/emcn'
import { ImageUp } from '@labbai/emcn/icons'
import { InstagramIcon } from '@/components/icons'
import type { InstagramAutoReplyMediaScopeValue } from '@/lib/api/contracts/instagram-auto-reply'
import type { InstagramPreviewTab } from '@/app/workspace/[workspaceId]/instagram/search-params'

const TAB_OPTIONS = [
  { value: 'post', label: 'Post' },
  { value: 'comments', label: 'Comments' },
  { value: 'dm', label: 'DM' },
] as const satisfies readonly { value: InstagramPreviewTab; label: string }[]

const POST_PLACEHOLDERS: Record<InstagramAutoReplyMediaScopeValue, string> = {
  specific: 'Choose a post',
  any: 'Any post or Reel',
  next: 'Your next post or Reel',
}

/** A customer handle for the sample comment; never a real account. */
const SAMPLE_COMMENTER = 'customer'

const BUBBLE_CLASS =
  'whitespace-pre-wrap break-words rounded-2xl bg-[var(--surface-5)] px-3 py-2 text-[var(--text-body)] text-small dark:bg-[var(--surface-4)]'

/** The DM as the preview shows it; the image is only passed once it is a valid https link. */
export interface PhonePreviewDm {
  text: string
  buttons: readonly { title: string }[]
  imageUrl: string | null
}

export interface PhonePreviewProps {
  tab: InstagramPreviewTab
  onTabChange: (tab: InstagramPreviewTab) => void
  /** The replying account's display name. */
  accountName: string
  mediaScope: InstagramAutoReplyMediaScopeValue
  /** Fresh thumbnail of the first chosen post, or null for a placeholder. */
  postThumbnailUrl: string | null
  /** The sample customer comment. */
  comment: string
  /** The public reply, `''` while unwritten, or null when the rule sends none. */
  publicReply: string | null
  handoffToAgent: boolean
  /** The DM, or null when the rule sends none. */
  dm: PhonePreviewDm | null
}

/**
 * A phone mockup of what a commenter sees: the post, the comment thread with the public reply,
 * and the DM with its buttons. Purely presentational; every value comes from the editor's form
 * state, so it updates as the client types.
 */
export function PhonePreview({
  tab,
  onTabChange,
  accountName,
  mediaScope,
  postThumbnailUrl,
  comment,
  publicReply,
  handoffToAgent,
  dm,
}: PhonePreviewProps) {
  return (
    <div className='flex w-full max-w-[300px] flex-col items-center gap-4'>
      <ChipSwitch options={TAB_OPTIONS} value={tab} onChange={onTabChange} aria-label='Preview' />
      <section
        aria-label='Phone preview'
        className='flex h-[560px] w-full flex-col overflow-hidden rounded-[36px] border border-[var(--border)] bg-[var(--bg)] p-2'
      >
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-[var(--border)]'>
          <div className='flex items-center gap-2 border-[var(--border)] border-b px-3 py-2.5'>
            <Avatar />
            <OverflowText
              label={accountName}
              className='flex-1 text-[var(--text-body)] text-small'
            />
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            {tab === 'post' && <PostView mediaScope={mediaScope} thumbnailUrl={postThumbnailUrl} />}
            {tab === 'comments' && (
              <CommentsView
                accountName={accountName}
                comment={comment}
                publicReply={publicReply}
                handoffToAgent={handoffToAgent}
              />
            )}
            {tab === 'dm' && <DmView dm={dm} handoffToAgent={handoffToAgent} />}
          </div>
        </div>
      </section>
    </div>
  )
}

interface AvatarProps {
  muted?: boolean
}

function Avatar({ muted = false }: AvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full',
        muted ? 'bg-[var(--surface-active)]' : 'bg-[var(--surface-5)] dark:bg-[var(--surface-4)]'
      )}
    >
      {!muted && <InstagramIcon className='size-[14px] text-[var(--text-icon)]' />}
    </span>
  )
}

interface PostViewProps {
  mediaScope: InstagramAutoReplyMediaScopeValue
  thumbnailUrl: string | null
}

function PostView({ mediaScope, thumbnailUrl }: PostViewProps) {
  return (
    <div className='aspect-square w-full bg-[var(--surface-active)]'>
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt='Selected post'
          referrerPolicy='no-referrer'
          className='size-full object-cover'
        />
      ) : (
        <div className='flex size-full flex-col items-center justify-center gap-2'>
          <ImageUp className='size-[14px] text-[var(--text-icon)]' />
          <p className='text-[var(--text-muted)] text-caption'>{POST_PLACEHOLDERS[mediaScope]}</p>
        </div>
      )}
    </div>
  )
}

interface CommentsViewProps {
  accountName: string
  comment: string
  publicReply: string | null
  handoffToAgent: boolean
}

function CommentsView({ accountName, comment, publicReply, handoffToAgent }: CommentsViewProps) {
  return (
    <ul aria-label='Comments' className='flex flex-col gap-4 p-3'>
      <li className='flex gap-2'>
        <Avatar muted />
        <div className='min-w-0 text-small'>
          <span className='font-medium text-[var(--text-body)]'>{SAMPLE_COMMENTER}</span>{' '}
          <span className='break-words text-[var(--text-body)]'>{comment}</span>
        </div>
      </li>
      {handoffToAgent ? (
        <li className='pl-9 text-[var(--text-muted)] text-caption'>Your agent replies</li>
      ) : publicReply !== null ? (
        <li className='flex gap-2 pl-9'>
          <Avatar />
          <div className='min-w-0 text-small'>
            <span className='font-medium text-[var(--text-body)]'>{accountName}</span>{' '}
            {publicReply ? (
              <span className='break-words text-[var(--text-body)]'>{publicReply}</span>
            ) : (
              <span className='text-[var(--text-muted)]'>Write a public reply</span>
            )}
          </div>
        </li>
      ) : null}
    </ul>
  )
}

interface DmViewProps {
  dm: PhonePreviewDm | null
  handoffToAgent: boolean
}

function DmView({ dm, handoffToAgent }: DmViewProps) {
  if (handoffToAgent || !dm) {
    return (
      <p className='p-6 text-center text-[var(--text-muted)] text-caption'>
        {handoffToAgent ? 'Your agent replies' : 'No DM is sent'}
      </p>
    )
  }
  return (
    <div aria-label='Direct message' className='flex max-w-[85%] flex-col gap-1.5 p-3'>
      {dm.imageUrl && (
        <img
          src={dm.imageUrl}
          alt='DM image'
          referrerPolicy='no-referrer'
          className='w-full rounded-2xl object-cover'
        />
      )}
      <p className={BUBBLE_CLASS}>
        {dm.text || <span className='text-[var(--text-muted)]'>Write your message</span>}
      </p>
      {dm.buttons.map((button, index) => (
        <span
          key={index}
          className='rounded-xl border border-[var(--border)] px-3 py-1.5 text-center text-[var(--text-body)] text-small'
        >
          {button.title || <span className='text-[var(--text-muted)]'>Button {index + 1}</span>}
        </span>
      ))}
    </div>
  )
}
