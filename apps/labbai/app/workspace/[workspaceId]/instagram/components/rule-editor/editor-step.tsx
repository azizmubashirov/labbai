'use client'

import { type ReactNode, useId } from 'react'
import { ChipSwitch } from '@labbai/emcn'

const ON_OFF_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
] as const

/** An optional on/off switch in a step's header, e.g. "Reply publicly". */
export interface EditorStepToggle {
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}

interface EditorStepProps {
  /** 1-based position shown in the step's badge. */
  index: number
  title: string
  toggle?: EditorStepToggle
  /** One line under the title, only where the title alone would mislead. */
  description?: string
  /** Step-level problem, e.g. "Choose at least one post". */
  error?: string
  children?: ReactNode
}

/**
 * One numbered step of the rule editor, read top to bottom like a sentence ("When someone
 * comments on… And the comment has… Reply publicly…"). Optional steps carry an Off/On switch;
 * their body shows only while the step is on.
 */
export function EditorStep({
  index,
  title,
  toggle,
  description,
  error,
  children,
}: EditorStepProps) {
  const titleId = useId()
  const showBody = Boolean(children) && (toggle ? toggle.value : true)

  return (
    <section
      aria-labelledby={titleId}
      className='flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4'
    >
      <div className='flex items-center gap-2.5'>
        <span
          aria-hidden
          className='flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-5)] text-[var(--text-muted)] text-caption tabular-nums dark:bg-[var(--surface-4)]'
        >
          {index}
        </span>
        <h3 id={titleId} className='min-w-0 flex-1 text-[var(--text-body)] text-sm'>
          {title}
        </h3>
        {toggle && (
          <ChipSwitch
            options={ON_OFF_OPTIONS}
            value={toggle.value ? 'on' : 'off'}
            onChange={(value) => toggle.onChange(value === 'on')}
            disabled={toggle.disabled}
            size='compact'
            aria-label={title}
          />
        )}
      </div>
      {description && <p className='text-[var(--text-muted)] text-caption'>{description}</p>}
      {showBody && <div className='flex flex-col gap-4'>{children}</div>}
      {error && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {error}
        </p>
      )}
    </section>
  )
}
