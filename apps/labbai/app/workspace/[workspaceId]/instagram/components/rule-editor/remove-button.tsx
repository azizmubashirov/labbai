'use client'

import { Button } from '@labbai/emcn'
import { X } from '@labbai/emcn/icons'

interface RemoveButtonProps {
  /** Accessible name, e.g. "Remove reply 2". */
  label: string
  onClick: () => void
  disabled?: boolean
}

/** The trailing X inside a list row's input that removes the row. */
export function RemoveButton({ label, onClick, disabled = false }: RemoveButtonProps) {
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon'
      className='-mr-1 shrink-0'
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <X className='size-[14px]' />
    </Button>
  )
}
