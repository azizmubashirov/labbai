'use client'

import { Chip, ChipInput } from '@labbai/emcn'
import { Plus } from '@labbai/emcn/icons'
import {
  INSTAGRAM_AUTO_REPLY_MAX_PUBLIC_REPLIES,
  INSTAGRAM_AUTO_REPLY_PUBLIC_REPLY_MAX_LENGTH,
} from '@/lib/instagram-auto-reply/constants'
import { RemoveButton } from '@/app/workspace/[workspaceId]/instagram/components/rule-editor/remove-button'
import type { RuleDraftErrors } from '@/app/workspace/[workspaceId]/instagram/utils'

interface ReplyVariantsFieldProps {
  replies: string[]
  onChange: (replies: string[]) => void
  /** Errors keyed `publicReplies.<index>`. */
  errors: RuleDraftErrors
  disabled?: boolean
}

/** Public reply variants, one per row, up to the per-rule cap. */
export function ReplyVariantsField({
  replies,
  onChange,
  errors,
  disabled = false,
}: ReplyVariantsFieldProps) {
  const atLimit = replies.length >= INSTAGRAM_AUTO_REPLY_MAX_PUBLIC_REPLIES

  function update(index: number, value: string) {
    onChange(replies.map((reply, replyIndex) => (replyIndex === index ? value : reply)))
  }

  return (
    <div className='flex flex-col gap-2'>
      <ul aria-label='Public replies' className='flex flex-col gap-2'>
        {replies.map((reply, index) => {
          const error = errors[`publicReplies.${index}`]
          return (
            <li key={index} className='flex flex-col gap-1'>
              <ChipInput
                value={reply}
                onChange={(event) => update(index, event.target.value)}
                placeholder='Reply text'
                aria-label={`Reply ${index + 1}`}
                maxLength={INSTAGRAM_AUTO_REPLY_PUBLIC_REPLY_MAX_LENGTH}
                disabled={disabled}
                error={Boolean(error)}
                endAdornment={
                  <RemoveButton
                    label={`Remove reply ${index + 1}`}
                    onClick={() =>
                      onChange(replies.filter((_, replyIndex) => replyIndex !== index))
                    }
                    disabled={disabled}
                  />
                }
              />
              {error && (
                <p role='alert' className='text-[var(--text-error)] text-caption'>
                  {error}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <div className='flex items-center justify-between gap-2'>
        <Chip
          variant='outline'
          leftIcon={Plus}
          onClick={() => onChange([...replies, ''])}
          disabled={disabled || atLimit}
        >
          Add reply
        </Chip>
        <span className='text-[var(--text-muted)] text-caption'>
          One reply is picked at random for each comment.
        </span>
      </div>
    </div>
  )
}
