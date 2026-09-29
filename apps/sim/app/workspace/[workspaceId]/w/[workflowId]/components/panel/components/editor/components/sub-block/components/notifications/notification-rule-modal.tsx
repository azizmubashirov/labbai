'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Label,
  Switch,
} from '@sim/emcn'
import {
  NOTIFICATION_CONDITION_MAX_LENGTH,
  NOTIFICATION_DIRECTION_LABELS,
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EXTRACT_SPEC_MAX_LENGTH,
  NOTIFICATION_MAX_COOLDOWN_MINUTES,
  NOTIFICATION_MAX_PAUSE_MINUTES,
  NOTIFICATION_NAME_MAX_LENGTH,
  NOTIFICATION_PAUSE_MODE_LABELS,
  NOTIFICATION_PAUSE_MODES,
  NOTIFICATION_PAUSE_NOTICE_MAX_LENGTH,
  NOTIFICATION_TRIGGER_DIRECTIONS,
  type NotificationEventKey,
  type NotificationPauseMode,
  type NotificationTriggerDirection,
} from '@/lib/notifications/constants'
import {
  DEFAULT_NOTIFICATION_PAUSE_MINUTES,
  type NotificationRule,
  notificationRuleProblem,
} from '@/lib/notifications/rules'

const DIRECTION_OPTIONS = NOTIFICATION_TRIGGER_DIRECTIONS.map((value) => ({
  value,
  label: NOTIFICATION_DIRECTION_LABELS[value],
}))

const EVENT_OPTIONS = NOTIFICATION_EVENT_KEYS.map((value) => ({
  value,
  label: NOTIFICATION_EVENT_LABELS[value],
}))

const PAUSE_OPTIONS = NOTIFICATION_PAUSE_MODES.map((value) => ({
  value,
  label: NOTIFICATION_PAUSE_MODE_LABELS[value],
}))

const CONDITION_PLACEHOLDER =
  'Fires when: the customer asks to talk to a person — an operator, a manager, the owner.\n' +
  'Does not fire when: they ask an ordinary question, even a hard one.\n' +
  'Examples: "give me an operator" fires; "how much is it?" does not.'

const CONDITION_HINT =
  'Write it in your own words, in any language. Say when it fires, when it must not, and give ' +
  'an example of each: precise conditions give fewer false alerts.'

const COOLDOWN_HINT =
  'No repeat alert from this rule in the same conversation within this time. 0 = no cooldown.'

/** The editor's working copy: minutes stay text until saved, so a half-typed number is fine. */
interface RuleDraft {
  name: string
  direction: NotificationTriggerDirection
  eventKey: NotificationEventKey
  condition: string
  extractSpec: string
  pauseMode: NotificationPauseMode
  pauseMinutes: string
  autoResume: boolean
  pauseNotice: string
  cooldownMinutes: string
  oncePerConversation: boolean
  isActive: boolean
}

function draftFrom(rule: NotificationRule): RuleDraft {
  return {
    name: rule.name,
    direction: rule.direction,
    eventKey: rule.eventKey ?? 'operator_handoff',
    condition: rule.condition,
    extractSpec: rule.extractSpec,
    pauseMode: rule.pauseMode,
    pauseMinutes: String(rule.pauseMinutes),
    autoResume: rule.autoResume,
    pauseNotice: rule.pauseNotice,
    cooldownMinutes: String(rule.cooldownMinutes),
    oncePerConversation: rule.oncePerConversation,
    isActive: rule.isActive,
  }
}

/** A whole number within `[min, max]`, or null when the text is not one. */
function parseMinutes(value: string, min: number, max: number): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const minutes = Number(trimmed)
  return minutes >= min && minutes <= max ? minutes : null
}

interface SwitchRowProps {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function SwitchRow({ id, label, hint, checked, onChange }: SwitchRowProps) {
  return (
    <div className='flex items-center justify-between gap-4'>
      <div className='flex flex-col gap-1'>
        <Label htmlFor={id}>{label}</Label>
        <p className='text-[var(--text-muted)] text-caption'>{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

interface NotificationRuleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The rule being edited, or a fresh one (see `isNew`). */
  rule: NotificationRule
  isNew: boolean
  onSave: (rule: NotificationRule) => void
}

/**
 * Create or edit one rule of a Notifications block. Saving writes the block's value like any
 * other field; the rule takes effect when the workflow is deployed.
 */
export function NotificationRuleModal({
  open,
  onOpenChange,
  rule,
  isNew,
  onSave,
}: NotificationRuleModalProps) {
  const [draft, setDraft] = useState<RuleDraft>(() => draftFrom(rule))
  const [error, setError] = useState<string | null>(null)

  /** Seeded when the modal opens, so reopening it on another rule never shows stale fields. */
  const [seededFor, setSeededFor] = useState<{ open: boolean; id: string }>({
    open,
    id: rule.id,
  })
  if (seededFor.open !== open || seededFor.id !== rule.id) {
    setSeededFor({ open, id: rule.id })
    if (open) {
      setDraft(draftFrom(rule))
      setError(null)
    }
  }

  const update = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    if (error) setError(null)
  }

  const isEvent = draft.direction === 'event'

  const handleSave = () => {
    const pauseMinutes = parseMinutes(draft.pauseMinutes, 1, NOTIFICATION_MAX_PAUSE_MINUTES)
    if (draft.pauseMode === 'temporary' && pauseMinutes === null) {
      return setError(`Pause must be 1 to ${NOTIFICATION_MAX_PAUSE_MINUTES} minutes`)
    }
    const cooldownMinutes = parseMinutes(
      draft.cooldownMinutes,
      0,
      NOTIFICATION_MAX_COOLDOWN_MINUTES
    )
    if (cooldownMinutes === null) {
      return setError(`Cooldown must be 0 to ${NOTIFICATION_MAX_COOLDOWN_MINUTES} minutes`)
    }
    const next: NotificationRule = {
      id: rule.id,
      name: draft.name.trim(),
      direction: draft.direction,
      eventKey: isEvent ? draft.eventKey : null,
      condition: isEvent ? '' : draft.condition.trim(),
      extractSpec: isEvent ? '' : draft.extractSpec.trim(),
      pauseMode: draft.pauseMode,
      pauseMinutes: pauseMinutes ?? DEFAULT_NOTIFICATION_PAUSE_MINUTES,
      autoResume: draft.autoResume,
      pauseNotice: draft.pauseMode === 'none' ? '' : draft.pauseNotice.trim(),
      cooldownMinutes,
      oncePerConversation: draft.oncePerConversation,
      isActive: draft.isActive,
    }
    const problem = notificationRuleProblem(next)
    if (problem) return setError(problem)
    onSave(next)
    onOpenChange(false)
  }

  const close = () => onOpenChange(false)
  const title = isNew ? 'New rule' : 'Edit rule'

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={title}>
      <ChipModalHeader onClose={close}>{title}</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Name'
          value={draft.name}
          onChange={(value) => update('name', value)}
          placeholder='e.g. Customer wants a person'
          maxLength={NOTIFICATION_NAME_MAX_LENGTH}
          autoComplete='off'
          required
        />
        <ChipModalField
          type='dropdown'
          title='When'
          value={draft.direction}
          onChange={(value) => update('direction', value as NotificationTriggerDirection)}
          options={DIRECTION_OPTIONS}
          align='start'
          hint={
            isEvent
              ? 'Fires when a Notify block in this workflow reports the event below.'
              : 'Every message of this kind in this workflow’s Inbox conversations is checked against the condition.'
          }
        />
        {isEvent ? (
          <ChipModalField
            type='dropdown'
            title='Event'
            value={draft.eventKey}
            onChange={(value) => update('eventKey', value as NotificationEventKey)}
            options={EVENT_OPTIONS}
            align='start'
            required
          />
        ) : (
          <>
            <ChipModalField
              type='textarea'
              title='Condition'
              value={draft.condition}
              onChange={(value) => update('condition', value)}
              placeholder={CONDITION_PLACEHOLDER}
              maxLength={NOTIFICATION_CONDITION_MAX_LENGTH}
              rows={6}
              hint={CONDITION_HINT}
              required
            />
            <ChipModalField
              type='textarea'
              title='Details to extract'
              value={draft.extractSpec}
              onChange={(value) => update('extractSpec', value)}
              placeholder='e.g. customer name, phone number, what they asked for'
              maxLength={NOTIFICATION_EXTRACT_SPEC_MAX_LENGTH}
              rows={2}
            />
          </>
        )}
        <ChipModalField
          type='dropdown'
          title='Pause AI'
          value={draft.pauseMode}
          onChange={(value) => update('pauseMode', value as NotificationPauseMode)}
          options={PAUSE_OPTIONS}
          align='start'
        />
        {draft.pauseMode === 'temporary' && (
          <>
            <ChipModalField
              type='input'
              title='Pause for (minutes)'
              value={draft.pauseMinutes}
              onChange={(value) => update('pauseMinutes', value)}
              inputMode='numeric'
              submitOnEnter={false}
            />
            <ChipModalField type='custom' title='Resume'>
              <SwitchRow
                id='notification-rule-auto-resume'
                label='Turn AI back on by itself'
                hint='Off keeps AI off until an operator turns it on.'
                checked={draft.autoResume}
                onChange={(checked) => update('autoResume', checked)}
              />
            </ChipModalField>
          </>
        )}
        {draft.pauseMode !== 'none' && (
          <ChipModalField
            type='textarea'
            title='Pause notice'
            value={draft.pauseNotice}
            onChange={(value) => update('pauseNotice', value)}
            placeholder='e.g. Our specialist will reply to you shortly.'
            maxLength={NOTIFICATION_PAUSE_NOTICE_MAX_LENGTH}
            rows={2}
            hint='Sent to the customer when AI pauses. Leave empty to send nothing.'
          />
        )}
        <ChipModalField
          type='input'
          title='Cooldown (minutes)'
          value={draft.cooldownMinutes}
          onChange={(value) => update('cooldownMinutes', value)}
          inputMode='numeric'
          submitOnEnter={false}
          hint={COOLDOWN_HINT}
        />
        <ChipModalField type='custom' title='Options'>
          <div className='flex flex-col gap-3'>
            <SwitchRow
              id='notification-rule-once'
              label='Once per conversation'
              hint='Fire at most once in each conversation.'
              checked={draft.oncePerConversation}
              onChange={(checked) => update('oncePerConversation', checked)}
            />
            <SwitchRow
              id='notification-rule-active'
              label='Active'
              hint='Inactive rules are kept but never checked.'
              checked={draft.isActive}
              onChange={(checked) => update('isActive', checked)}
            />
          </div>
        </ChipModalField>
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        defaultAction='none'
        primaryAction={{ label: isNew ? 'Add rule' : 'Save', onClick: handleSave }}
      />
    </ChipModal>
  )
}
