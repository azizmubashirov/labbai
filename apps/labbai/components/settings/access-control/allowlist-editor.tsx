'use client'

import { useId, useMemo, useState } from 'react'
import { Checkbox, ChipInput, Label, Switch } from '@labbai/emcn'
import { Search } from '@labbai/emcn/icons'
import { toggleListMember } from '@/components/settings/access-control/draft'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

export interface AllowlistOption {
  value: string
  label: string
}

interface AllowlistEditorProps {
  label: string
  /** Shown while unrestricted, to say what turning the restriction on does. */
  hint: string
  /** `null` = unrestricted; an array = only these values are allowed. */
  value: readonly string[] | null
  options: readonly AllowlistOption[]
  onChange: (next: string[] | null) => void
  searchable?: boolean
  disabled?: boolean
}

/**
 * An allowlist field: a switch that turns the restriction on (starting from
 * every option allowed) and a checklist of the allowed values.
 */
export function AllowlistEditor({
  label,
  hint,
  value,
  options,
  onChange,
  searchable = false,
  disabled = false,
}: AllowlistEditorProps) {
  const switchId = useId()
  const [search, setSearch] = useState('')
  const restricted = value !== null

  const visibleOptions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return options
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query)
    )
  }, [options, search])

  const allowed = useMemo(() => new Set(value ?? []), [value])

  return (
    <SettingsSection
      label={label}
      action={
        <div className='flex items-center gap-2'>
          <Label htmlFor={switchId} className='text-[var(--text-muted)] text-caption'>
            Restrict
          </Label>
          <Switch
            id={switchId}
            checked={restricted}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange(checked ? options.map((option) => option.value) : null)
            }
          />
        </div>
      }
    >
      {!restricted ? (
        <p className='pl-0.5 text-[var(--text-muted)] text-caption'>{hint}</p>
      ) : (
        <div className='flex flex-col gap-2'>
          <div className='flex items-center gap-2 pl-0.5 text-[var(--text-muted)] text-caption'>
            <span>
              {allowed.size} of {options.length} allowed
            </span>
            <button
              type='button'
              className='underline disabled:opacity-50'
              disabled={disabled}
              onClick={() => onChange(options.map((option) => option.value))}
            >
              Allow all
            </button>
            <button
              type='button'
              className='underline disabled:opacity-50'
              disabled={disabled}
              onClick={() => onChange([])}
            >
              Allow none
            </button>
          </div>
          {searchable && (
            <ChipInput
              icon={Search}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              aria-label={`Search ${label.toLowerCase()}`}
            />
          )}
          <div className='grid max-h-72 grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-4 gap-y-1.5 overflow-y-auto pl-0.5'>
            {visibleOptions.map((option) => {
              const checkboxId = `${switchId}-${option.value}`
              return (
                <div key={option.value} className='flex min-w-0 items-center gap-2'>
                  <Checkbox
                    id={checkboxId}
                    checked={allowed.has(option.value)}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      onChange(toggleListMember(value ?? [], option.value, checked === true))
                    }
                  />
                  <Label htmlFor={checkboxId} className='truncate text-sm'>
                    {option.label}
                  </Label>
                </div>
              )
            })}
            {visibleOptions.length === 0 && (
              <span className='text-[var(--text-muted)] text-caption'>No matches</span>
            )}
          </div>
        </div>
      )}
    </SettingsSection>
  )
}
