'use client'

import { type KeyboardEvent, useState } from 'react'
import { ChipInput, ChipTag, cn } from '@labbai/emcn'
import { X } from '@labbai/emcn/icons'
import { addKeywords, splitKeywords } from '@/app/workspace/[workspaceId]/instagram/utils'

interface KeywordFieldProps {
  keywords: string[]
  onChange: (keywords: string[]) => void
  disabled?: boolean
  /** Marks the input invalid; the owning step renders the message. */
  invalid?: boolean
}

/**
 * Keyword chips with a text box that adds on Enter, on a comma, and on blur (so a pasted
 * "price, cost, how much" becomes three chips). Backspace in an empty box removes the last chip.
 */
export function KeywordField({ keywords, onChange, disabled = false, invalid }: KeywordFieldProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  function commit(values: string[]) {
    if (values.length === 0) return
    const result = addKeywords(keywords, values)
    setError(result.error)
    if (result.keywords.length !== keywords.length) onChange(result.keywords)
  }

  function handleChange(value: string) {
    if (!value.includes(',')) {
      setText(value)
      return
    }
    const parts = value.split(',')
    const rest = parts.pop() ?? ''
    commit(splitKeywords(parts.join(',')))
    setText(rest)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit(splitKeywords(text))
      setText('')
      return
    }
    if (event.key === 'Backspace' && !text && keywords.length > 0) {
      onChange(keywords.slice(0, -1))
    }
  }

  function remove(index: number) {
    setError(null)
    onChange(keywords.filter((_, keywordIndex) => keywordIndex !== index))
  }

  return (
    <div className='flex flex-col gap-2'>
      <ChipInput
        value={text}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          commit(splitKeywords(text))
          setText('')
        }}
        placeholder='Type a keyword and press Enter'
        aria-label='Keyword'
        disabled={disabled}
        error={Boolean(error) || invalid}
      />
      {keywords.length > 0 && (
        <ul aria-label='Keywords' className='flex flex-wrap gap-1.5'>
          {keywords.map((keyword, index) => (
            <li key={keyword}>
              <ChipTag
                variant='invite'
                rightIcon={X}
                onRightIconClick={() => remove(index)}
                rightIconLabel={`Remove ${keyword}`}
                rightIconDisabled={disabled}
              >
                {keyword}
              </ChipTag>
            </li>
          ))}
        </ul>
      )}
      <p
        role={error ? 'alert' : undefined}
        className={cn(
          'text-caption',
          error ? 'text-[var(--text-error)]' : 'text-[var(--text-muted)]'
        )}
      >
        {error ?? 'Matches whole words and phrases, in any letter case.'}
      </p>
    </div>
  )
}
