'use client'

import { Chip, ChipInput } from '@labbai/emcn'
import { Link, Plus } from '@labbai/emcn/icons'
import {
  INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_MAX_DM_BUTTONS,
} from '@/lib/instagram-auto-reply/constants'
import { RemoveButton } from '@/app/workspace/[workspaceId]/instagram/components/rule-editor/remove-button'
import type { DmButtonDraft, RuleDraftErrors } from '@/app/workspace/[workspaceId]/instagram/utils'

interface DmButtonsFieldProps {
  buttons: DmButtonDraft[]
  onChange: (buttons: DmButtonDraft[]) => void
  /** Errors keyed `dmButtons.<index>.title` and `dmButtons.<index>.url`. */
  errors: RuleDraftErrors
  disabled?: boolean
}

/** Up to three link buttons under the DM, each a short title and an https link. */
export function DmButtonsField({
  buttons,
  onChange,
  errors,
  disabled = false,
}: DmButtonsFieldProps) {
  const atLimit = buttons.length >= INSTAGRAM_AUTO_REPLY_MAX_DM_BUTTONS

  function update(index: number, patch: Partial<DmButtonDraft>) {
    onChange(
      buttons.map((button, buttonIndex) =>
        buttonIndex === index ? { ...button, ...patch } : button
      )
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      {buttons.length > 0 && (
        <ul aria-label='DM buttons' className='flex flex-col gap-2'>
          {buttons.map((button, index) => {
            const titleError = errors[`dmButtons.${index}.title`]
            const urlError = errors[`dmButtons.${index}.url`]
            return (
              <li key={index} className='flex flex-col gap-1'>
                <div className='flex flex-col gap-2 sm:flex-row'>
                  <ChipInput
                    value={button.title}
                    onChange={(event) => update(index, { title: event.target.value })}
                    placeholder='Button title'
                    aria-label={`Button ${index + 1} title`}
                    maxLength={INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH}
                    disabled={disabled}
                    error={Boolean(titleError)}
                    className='sm:w-[180px] sm:shrink-0'
                  />
                  <ChipInput
                    type='url'
                    icon={Link}
                    value={button.url}
                    onChange={(event) => update(index, { url: event.target.value })}
                    placeholder='https://'
                    aria-label={`Button ${index + 1} link`}
                    disabled={disabled}
                    error={Boolean(urlError)}
                    className='min-w-0 flex-1'
                    endAdornment={
                      <RemoveButton
                        label={`Remove button ${index + 1}`}
                        onClick={() =>
                          onChange(buttons.filter((_, buttonIndex) => buttonIndex !== index))
                        }
                        disabled={disabled}
                      />
                    }
                  />
                </div>
                {(titleError || urlError) && (
                  <p role='alert' className='text-[var(--text-error)] text-caption'>
                    {titleError ?? urlError}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className='flex items-center justify-between gap-2'>
        <Chip
          variant='outline'
          leftIcon={Plus}
          onClick={() => onChange([...buttons, { title: '', url: '' }])}
          disabled={disabled || atLimit}
        >
          Add button
        </Chip>
        <span className='text-[var(--text-muted)] text-caption tabular-nums'>
          {buttons.length} of {INSTAGRAM_AUTO_REPLY_MAX_DM_BUTTONS} buttons
        </span>
      </div>
    </div>
  )
}
