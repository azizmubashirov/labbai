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
import { getErrorMessage } from '@sim/utils/errors'
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
  type NotificationTrigger,
  useCreateNotificationTrigger,
  useUpdateNotificationTrigger,
} from '@/hooks/queries/notifications'

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
  'No repeat alert from this trigger in the same conversation within this time. 0 = no cooldown.'

interface TriggerDraft {
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

function isEventKey(value: string | null): value is NotificationEventKey {
  return (NOTIFICATION_EVENT_KEYS as readonly string[]).includes(value ?? '')
}

function draftFrom(trigger: NotificationTrigger | null): TriggerDraft {
  if (!trigger) {
    return {
      name: '',
      direction: 'inbound',
      eventKey: 'operator_handoff',
      condition: '',
      extractSpec: '',
      pauseMode: 'none',
      pauseMinutes: '15',
      autoResume: true,
      pauseNotice: '',
      cooldownMinutes: '60',
      oncePerConversation: false,
      isActive: true,
    }
  }
  return {
    name: trigger.name,
    direction: trigger.direction,
    eventKey: isEventKey(trigger.eventKey) ? trigger.eventKey : 'operator_handoff',
    condition: trigger.condition,
    extractSpec: trigger.extractSpec,
    pauseMode: trigger.pauseMode,
    pauseMinutes: String(trigger.pauseMinutes),
    autoResume: trigger.autoResume,
    pauseNotice: trigger.pauseNotice,
    cooldownMinutes: String(trigger.cooldownMinutes),
    oncePerConversation: trigger.oncePerConversation,
    isActive: trigger.isActive,
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

interface NotificationTriggerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  /** The trigger being edited; null creates a new one. */
  trigger: NotificationTrigger | null
}

/** Create or edit one notification trigger. */
export function NotificationTriggerModal({
  open,
  onOpenChange,
  workspaceId,
  trigger,
}: NotificationTriggerModalProps) {
  const [draft, setDraft] = useState<TriggerDraft>(() => draftFrom(trigger))
  const [error, setError] = useState<string | null>(null)
  const createTrigger = useCreateNotificationTrigger(workspaceId)
  const updateTrigger = useUpdateNotificationTrigger(workspaceId)
  const isSaving = createTrigger.isPending || updateTrigger.isPending

  /** Seeded when the modal opens, so reopening it on another trigger never shows stale fields. */
  const [seededFor, setSeededFor] = useState<{ open: boolean; id: string | null }>({
    open,
    id: trigger?.id ?? null,
  })
  if (seededFor.open !== open || seededFor.id !== (trigger?.id ?? null)) {
    setSeededFor({ open, id: trigger?.id ?? null })
    if (open) {
      setDraft(draftFrom(trigger))
      setError(null)
    }
  }

  const update = <K extends keyof TriggerDraft>(key: K, value: TriggerDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    if (error) setError(null)
  }

  const isEvent = draft.direction === 'event'

  const handleSave = async () => {
    if (isSaving) return
    const name = draft.name.trim()
    if (!name) return setError('Give the trigger a name')
    if (!isEvent && !draft.condition.trim()) {
      return setError('Describe when the alert should fire')
    }
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

    const body = {
      name,
      direction: draft.direction,
      eventKey: isEvent ? draft.eventKey : null,
      condition: isEvent ? '' : draft.condition.trim(),
      extractSpec: isEvent ? '' : draft.extractSpec.trim(),
      pauseMode: draft.pauseMode,
      pauseMinutes: pauseMinutes ?? 15,
      autoResume: draft.autoResume,
      pauseNotice: draft.pauseMode === 'none' ? '' : draft.pauseNotice.trim(),
      cooldownMinutes,
      oncePerConversation: draft.oncePerConversation,
      isActive: draft.isActive,
    }

    try {
      if (trigger) {
        await updateTrigger.mutateAsync({ triggerId: trigger.id, ...body })
      } else {
        await createTrigger.mutateAsync(body)
      }
      onOpenChange(false)
    } catch (saveError) {
      setError(getErrorMessage(saveError, 'Could not save the trigger'))
    }
  }

  const close = () => {
    if (!isSaving) onOpenChange(false)
  }

  const title = trigger ? 'Edit trigger' : 'New trigger'

  return (
    <ChipModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSaving) onOpenChange(nextOpen)
      }}
      dismissDisabled={isSaving}
      srTitle={title}
    >
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
          title='Check'
          value={draft.direction}
          onChange={(value) => update('direction', value as NotificationTriggerDirection)}
          options={DIRECTION_OPTIONS}
          align='start'
          hint={
            isEvent
              ? 'Fires when a workflow’s Notify block reports the event below.'
              : 'Every message of this kind in the Inbox is checked against the condition.'
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
              title='When should it fire?'
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
              title='Details to collect'
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
          title='AI replies'
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
                id='notification-trigger-auto-resume'
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
            title='Message to the customer'
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
              id='notification-trigger-once'
              label='Once per conversation'
              hint='Fire at most once in each conversation.'
              checked={draft.oncePerConversation}
              onChange={(checked) => update('oncePerConversation', checked)}
            />
            <SwitchRow
              id='notification-trigger-active'
              label='Active'
              hint='Inactive triggers are kept but never checked.'
              checked={draft.isActive}
              onChange={(checked) => update('isActive', checked)}
            />
          </div>
        </ChipModalField>
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        cancelDisabled={isSaving}
        defaultAction='none'
        primaryAction={{
          label: isSaving ? 'Saving...' : trigger ? 'Save' : 'Create',
          onClick: () => void handleSave(),
          disabled: isSaving,
        }}
      />
    </ChipModal>
  )
}
