'use client'

import { ChipSwitch, cn, OverflowText } from '@labbai/emcn'
import { ImageUp } from '@labbai/emcn/icons'
import { InstagramIcon } from '@/components/icons'
import type {
  InstagramAutoReplyMediaScopeValue,
  InstagramAutoReplyTriggerTypeValue,
} from '@/lib/api/contracts/instagram-auto-reply'
import type { InstagramPreviewTab } from '@/app/workspace/[workspaceId]/instagram/search-params'
import type { DmPreviewStep } from '@/app/workspace/[workspaceId]/instagram/utils'

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

/** What the Post tab shows for triggers that are not post comments. */
const NON_POST_PLACEHOLDERS = {
  live_comment: 'Any live video',
  story_reply: 'Any story',
  story_mention: 'Any story',
} as const

/** How the sample customer action reads for each trigger. */
const ACTION_CAPTIONS: Record<InstagramAutoReplyTriggerTypeValue, string | null> = {
  comment: null,
  live_comment: 'Commented on your live video',
  story_reply: 'Replied to your story',
  story_mention: 'Mentioned you in their story',
}

const PROMPT_PLACEHOLDERS: Record<DmPreviewStep['kind'], string> = {
  opening: 'Write the opening message',
  follow_gate: 'Ask the user to follow you',
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
  triggerType: InstagramAutoReplyTriggerTypeValue
  mediaScope: InstagramAutoReplyMediaScopeValue
  /** Fresh thumbnail of the first chosen post, or null for a placeholder. */
  postThumbnailUrl: string | null
  /** The sample customer comment. */
  comment: string
  /** The public reply, `''` while unwritten, or null when the rule sends none. */
  publicReply: string | null
  handoffToAgent: boolean
  /** Messages sent before the DM (opening message, follow gate), each waiting for a tap. */
  prompts: readonly DmPreviewStep[]
  /** The DM, or null when the rule sends none. */
  dm: PhonePreviewDm | null
}

/**
 * A phone mockup of what a commenter sees: the post, the comment thread with the public reply,
 * and the DM conversation: the opening message, then the follow gate, then the DM with its
 * buttons. Purely presentational; every value comes from the editor's form state, so it updates
 * as the client types.
 */
export function PhonePreview({
  tab,
  onTabChange,
  accountName,
  triggerType,
  mediaScope,
  postThumbnailUrl,
  comment,
  publicReply,
  handoffToAgent,
  prompts,
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
            {tab === 'post' && (
              <PostView
                placeholder={
                  triggerType === 'comment'
                    ? POST_PLACEHOLDERS[mediaScope]
                    : NON_POST_PLACEHOLDERS[triggerType]
                }
                thumbnailUrl={triggerType === 'comment' ? postThumbnailUrl : null}
              />
            )}
            {tab === 'comments' && (
              <CommentsView
                accountName={accountName}
                caption={ACTION_CAPTIONS[triggerType]}
                comment={comment}
                publicReply={publicReply}
                handoffToAgent={handoffToAgent}
              />
            )}
            {tab === 'dm' && <DmView prompts={prompts} dm={dm} handoffToAgent={handoffToAgent} />}
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
  placeholder: string
  thumbnailUrl: string | null
}

function PostView({ placeholder, thumbnailUrl }: PostViewProps) {
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
          <p className='text-[var(--text-muted)] text-caption'>{placeholder}</p>
        </div>
      )}
    </div>
  )
}

interface CommentsViewProps {
  accountName: string
  /** How the customer reached the account, for triggers other than post comments. */
  caption: string | null
  comment: string
  publicReply: string | null
  handoffToAgent: boolean
}

function CommentsView({
  accountName,
  caption,
  comment,
  publicReply,
  handoffToAgent,
}: CommentsViewProps) {
  return (
    <ul aria-label='Comments' className='flex flex-col gap-4 p-3'>
      <li className='flex gap-2'>
        <Avatar muted />
        <div className='flex min-w-0 flex-col gap-0.5 text-small'>
          {caption && <span className='text-[var(--text-muted)] text-caption'>{caption}</span>}
          <p>
            <span className='font-medium text-[var(--text-body)]'>{SAMPLE_COMMENTER}</span>{' '}
            <span className='break-words text-[var(--text-body)]'>{comment}</span>
          </p>
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
  prompts: readonly DmPreviewStep[]
  dm: PhonePreviewDm | null
  handoffToAgent: boolean
}

interface MessageButtonProps {
  title: string
  placeholder: string
}

/** One button under a message, as Instagram draws it. */
function MessageButton({ title, placeholder }: MessageButtonProps) {
  return (
    <span className='rounded-xl border border-[var(--border)] px-3 py-1.5 text-center text-[var(--text-body)] text-small'>
      {title || <span className='text-[var(--text-muted)]'>{placeholder}</span>}
    </span>
  )
}

/**
 * The DM conversation in the order the user receives it: each prompt and the user's tap on its
 * button, then the DM itself.
 */
function DmView({ prompts, dm, handoffToAgent }: DmViewProps) {
  if (handoffToAgent || !dm) {
    return (
      <p className='p-6 text-center text-[var(--text-muted)] text-caption'>
        {handoffToAgent ? 'Your agent replies' : 'No DM is sent'}
      </p>
    )
  }
  return (
    <ol aria-label='Direct message' className='flex flex-col gap-3 p-3'>
      {prompts.map((prompt) => (
        <li key={prompt.kind} className='flex flex-col gap-3'>
          <div className='flex max-w-[85%] flex-col gap-1.5'>
            <p className={BUBBLE_CLASS}>
              {prompt.text || (
                <span className='text-[var(--text-muted)]'>{PROMPT_PLACEHOLDERS[prompt.kind]}</span>
              )}
            </p>
            <MessageButton title={prompt.buttonTitle} placeholder='Button' />
          </div>
          <p
            aria-label='Customer taps'
            className='max-w-[70%] self-end whitespace-pre-wrap break-words rounded-2xl border border-[var(--border)] px-3 py-2 text-[var(--text-body)] text-small'
          >
            {prompt.buttonTitle || 'Button'}
          </p>
        </li>
      ))}
      <li className='flex max-w-[85%] flex-col gap-1.5'>
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
          <MessageButton key={index} title={button.title} placeholder={`Button ${index + 1}`} />
        ))}
      </li>
    </ol>
  )
}
