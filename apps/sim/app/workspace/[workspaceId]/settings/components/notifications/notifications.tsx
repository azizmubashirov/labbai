'use client'

import { useState } from 'react'
import {
  Badge,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { Bell, Plus, Send } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import {
  NOTIFICATION_DIRECTION_LABELS,
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_NAME_MAX_LENGTH,
  type NotificationEventKey,
} from '@/lib/notifications/constants'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { NotificationTriggerModal } from '@/app/workspace/[workspaceId]/settings/components/notifications/trigger-modal'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  type NotificationRecipient,
  type NotificationTrigger,
  useCreateNotificationRecipient,
  useDeleteNotificationRecipient,
  useDeleteNotificationTrigger,
  useNotificationSettings,
  useTestNotificationRecipient,
  useUpdateNotificationTrigger,
} from '@/hooks/queries/notifications'

const RECIPIENT_STATUS: Record<
  NotificationRecipient['status'],
  { label: string; variant: 'green' | 'amber' | 'gray'; description: string }
> = {
  connected: {
    label: 'Connected',
    variant: 'green',
    description: 'Receives alerts',
  },
  pending: {
    label: 'Pending',
    variant: 'amber',
    description: 'Open the connect link in Telegram and press Start',
  },
  stopped: {
    label: 'Stopped',
    variant: 'gray',
    description: 'Stopped with /stop. Open the connect link again to resume',
  },
}

const PAUSE_BADGES: Record<NotificationTrigger['pauseMode'], string | null> = {
  none: null,
  temporary: 'Pauses AI',
  hard: 'Turns AI off',
}

function isEventKey(value: string | null): value is NotificationEventKey {
  return (NOTIFICATION_EVENT_KEYS as readonly string[]).includes(value ?? '')
}

function describeTrigger(trigger: NotificationTrigger): string {
  if (trigger.direction === 'event') {
    const event = isEventKey(trigger.eventKey) ? NOTIFICATION_EVENT_LABELS[trigger.eventKey] : ''
    return `${NOTIFICATION_DIRECTION_LABELS.event}: ${event || trigger.eventKey || 'unknown'}`
  }
  const condition = trigger.condition.replace(/\s+/g, ' ').trim()
  return `${NOTIFICATION_DIRECTION_LABELS[trigger.direction]} · ${condition}`
}

/** The `/start` command a group sends, since Telegram opens deep links only in private chats. */
function groupStartCommand(connectUrl: string, botUsername: string | null): string | null {
  const payload = new URL(connectUrl).searchParams.get('start')
  if (!payload) return null
  return `/start${botUsername ? `@${botUsername}` : ''} ${payload}`
}

function copyText(text: string, message: string) {
  void navigator.clipboard.writeText(text)
  toast.success(message)
}

interface ConnectTelegramModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  botUsername: string | null
}

/** Names a new recipient, then shows the link that connects a Telegram chat to it. */
function ConnectTelegramModal({
  open,
  onOpenChange,
  workspaceId,
  botUsername,
}: ConnectTelegramModalProps) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<NotificationRecipient | null>(null)
  const createRecipient = useCreateNotificationRecipient(workspaceId)

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setTitle('')
      setError(null)
      setCreated(null)
    }
  }

  const handleCreate = async () => {
    if (createRecipient.isPending) return
    setError(null)
    try {
      const data = await createRecipient.mutateAsync({ title: title.trim() })
      setCreated(data.recipient)
    } catch (createError) {
      setError(getErrorMessage(createError, 'Could not create the connect link'))
    }
  }

  const close = () => {
    if (!createRecipient.isPending) onOpenChange(false)
  }

  const connectUrl = created?.connectUrl ?? null
  const groupCommand = connectUrl ? groupStartCommand(connectUrl, botUsername) : null

  return (
    <ChipModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!createRecipient.isPending) onOpenChange(nextOpen)
      }}
      dismissDisabled={createRecipient.isPending}
      srTitle='Connect Telegram'
    >
      <ChipModalHeader onClose={close}>Connect Telegram</ChipModalHeader>
      {connectUrl ? (
        <>
          <ChipModalBody>
            <ChipModalField
              type='copy'
              title='Connect link'
              value={connectUrl}
              copyLabel='Copy connect link'
              hint='Open it in Telegram on the account that should get alerts, then press Start.'
            />
            {groupCommand && (
              <ChipModalField
                type='copy'
                title='For a group'
                value={groupCommand}
                copyLabel='Copy command'
                hint='Add the bot to the group, then send this command in the group.'
              />
            )}
          </ChipModalBody>
          <ChipModalFooter
            onCancel={close}
            cancelLabel='Done'
            primaryAction={{
              label: 'Open Telegram',
              onClick: () => window.open(connectUrl, '_blank', 'noopener,noreferrer'),
            }}
          />
        </>
      ) : (
        <>
          <ChipModalBody>
            <ChipModalField
              type='input'
              title='Name'
              value={title}
              onChange={(value) => {
                setTitle(value)
                if (error) setError(null)
              }}
              placeholder='e.g. Sales manager, Support group'
              maxLength={NOTIFICATION_NAME_MAX_LENGTH}
              autoComplete='off'
              hint='Who gets the alerts. You can connect a person or a Telegram group.'
            />
            <ChipModalError>{error}</ChipModalError>
          </ChipModalBody>
          <ChipModalFooter
            onCancel={close}
            cancelDisabled={createRecipient.isPending}
            primaryAction={{
              label: createRecipient.isPending ? 'Creating...' : 'Create link',
              onClick: () => void handleCreate(),
              disabled: createRecipient.isPending,
            }}
          />
        </>
      )}
    </ChipModal>
  )
}

/** Settings → Notifications: Telegram recipients and the triggers that alert them. */
export function Notifications() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workspacePermissions = useUserPermissionsContext()
  const canManage = canMutateWorkspaceSettingsSection('notifications', workspacePermissions)

  const { data, isPending, error } = useNotificationSettings(workspaceId, {
    enabled: canManage,
  })
  const deleteRecipient = useDeleteNotificationRecipient(workspaceId)
  const testRecipient = useTestNotificationRecipient(workspaceId)
  const updateTrigger = useUpdateNotificationTrigger(workspaceId)
  const deleteTrigger = useDeleteNotificationTrigger(workspaceId)

  const [isConnectOpen, setIsConnectOpen] = useState(false)
  const [editingTrigger, setEditingTrigger] = useState<NotificationTrigger | null>(null)
  const [isTriggerModalOpen, setIsTriggerModalOpen] = useState(false)
  const [recipientToRemove, setRecipientToRemove] = useState<NotificationRecipient | null>(null)
  const [triggerToDelete, setTriggerToDelete] = useState<NotificationTrigger | null>(null)

  const recipients = data?.recipients ?? []
  const triggers = data?.triggers ?? []
  const configured = data?.configured === true
  const limits = data?.limits
  const atRecipientLimit = limits ? recipients.length >= limits.maxRecipients : false
  const atTriggerLimit = limits ? triggers.length >= limits.maxTriggers : false

  const openTriggerModal = (trigger: NotificationTrigger | null) => {
    setEditingTrigger(trigger)
    setIsTriggerModalOpen(true)
  }

  const handleTest = (recipient: NotificationRecipient) => {
    testRecipient.mutate(recipient.id, {
      onSuccess: (result) => {
        if (result.delivered) toast.success(`Test message sent to ${recipient.title || 'Telegram'}`)
        else toast.error(result.error ?? 'The test message was not delivered')
      },
      onError: (testError) =>
        toast.error(getErrorMessage(testError, 'Could not send the test message')),
    })
  }

  const handleToggleTrigger = (trigger: NotificationTrigger) => {
    updateTrigger.mutate(
      { triggerId: trigger.id, isActive: !trigger.isActive },
      {
        onError: (toggleError) =>
          toast.error(getErrorMessage(toggleError, 'Could not change the trigger')),
      }
    )
  }

  const handleRemoveRecipient = async () => {
    if (!recipientToRemove) return
    try {
      await deleteRecipient.mutateAsync(recipientToRemove.id)
      setRecipientToRemove(null)
    } catch (removeError) {
      toast.error(getErrorMessage(removeError, 'Could not remove the recipient'))
    }
  }

  const handleDeleteTrigger = async () => {
    if (!triggerToDelete) return
    try {
      await deleteTrigger.mutateAsync(triggerToDelete.id)
      setTriggerToDelete(null)
    } catch (deleteError) {
      toast.error(getErrorMessage(deleteError, 'Could not delete the trigger'))
    }
  }

  const actions: SettingsAction[] =
    canManage && configured
      ? [
          {
            id: 'connect-telegram',
            text: 'Connect Telegram',
            icon: Send,
            onSelect: () => setIsConnectOpen(true),
            disabled: atRecipientLimit,
            tooltip: atRecipientLimit
              ? 'This workspace has the most recipients allowed'
              : undefined,
          },
          {
            id: 'add-trigger',
            text: 'Add trigger',
            icon: Plus,
            variant: 'primary',
            onSelect: () => openTriggerModal(null),
            disabled: atTriggerLimit,
            tooltip: atTriggerLimit ? 'This workspace has the most triggers allowed' : undefined,
          },
        ]
      : []

  const body = (() => {
    if (!canManage) {
      if (workspacePermissions.isLoading) return null
      return (
        <SettingsEmptyState>Only workspace admins can manage notifications</SettingsEmptyState>
      )
    }
    if (error) {
      return (
        <SettingsEmptyState tone='error'>
          {getErrorMessage(error, 'Failed to load notifications')}
        </SettingsEmptyState>
      )
    }
    if (isPending) return null
    if (!configured) {
      return (
        <SettingsEmptyState>Notifications are not set up on this server</SettingsEmptyState>
      )
    }
    return (
      <div className='flex flex-col gap-6'>
        <SettingsSection label='Telegram recipients'>
          {recipients.length === 0 ? (
            <SettingsEmptyState variant='inline'>
              Click "Connect Telegram" to get alerts in a Telegram chat or group
            </SettingsEmptyState>
          ) : (
            <div className={RESOURCE_LIST_STACK}>
              {recipients.map((recipient) => {
                const status = RECIPIENT_STATUS[recipient.status]
                const connectUrl = recipient.connectUrl
                return (
                  <SettingsResourceRow
                    key={recipient.id}
                    icon={<Send className='text-[var(--text-icon)]' />}
                    title={recipient.title || 'Telegram chat'}
                    description={status.description}
                    badge={
                      <Badge variant={status.variant} size='sm' dot>
                        {status.label}
                      </Badge>
                    }
                    trailing={
                      <div className='shrink-0'>
                        <RowActionsMenu
                          label={`${recipient.title || 'Recipient'} actions`}
                          actions={[
                            ...(connectUrl
                              ? [
                                  {
                                    label: 'Copy connect link',
                                    onSelect: () => copyText(connectUrl, 'Connect link copied'),
                                  },
                                ]
                              : []),
                            {
                              label: 'Send test message',
                              disabled: recipient.status !== 'connected',
                              onSelect: () => handleTest(recipient),
                            },
                            {
                              label: 'Remove',
                              destructive: true,
                              onSelect: () => setRecipientToRemove(recipient),
                            },
                          ]}
                        />
                      </div>
                    }
                  />
                )
              })}
            </div>
          )}
        </SettingsSection>

        <SettingsSection label='Triggers'>
          {triggers.length === 0 ? (
            <SettingsEmptyState variant='inline'>
              Click "Add trigger" to say when your operators should be alerted
            </SettingsEmptyState>
          ) : (
            <div className={RESOURCE_LIST_STACK}>
              {triggers.map((trigger) => {
                const pauseBadge = PAUSE_BADGES[trigger.pauseMode]
                return (
                  <SettingsResourceRow
                    key={trigger.id}
                    icon={<Bell className='text-[var(--text-icon)]' />}
                    title={trigger.name}
                    description={describeTrigger(trigger)}
                    badge={
                      !trigger.isActive ? (
                        <Badge variant='gray' size='sm'>
                          Off
                        </Badge>
                      ) : pauseBadge ? (
                        <Badge variant='amber' size='sm'>
                          {pauseBadge}
                        </Badge>
                      ) : undefined
                    }
                    onClick={() => openTriggerModal(trigger)}
                    clickLabel={`Edit ${trigger.name}`}
                    trailing={
                      <div className='shrink-0'>
                        <RowActionsMenu
                          label={`${trigger.name} actions`}
                          actions={[
                            { label: 'Edit', onSelect: () => openTriggerModal(trigger) },
                            {
                              label: trigger.isActive ? 'Turn off' : 'Turn on',
                              onSelect: () => handleToggleTrigger(trigger),
                            },
                            {
                              label: 'Delete',
                              destructive: true,
                              onSelect: () => setTriggerToDelete(trigger),
                            },
                          ]}
                        />
                      </div>
                    }
                  />
                )
              })}
            </div>
          )}
        </SettingsSection>
      </div>
    )
  })()

  return (
    <>
      <SettingsPanel actions={actions}>{body}</SettingsPanel>

      {canManage && configured && (
        <>
          <ConnectTelegramModal
            open={isConnectOpen}
            onOpenChange={setIsConnectOpen}
            workspaceId={workspaceId}
            botUsername={data?.botUsername ?? null}
          />
          <NotificationTriggerModal
            open={isTriggerModalOpen}
            onOpenChange={setIsTriggerModalOpen}
            workspaceId={workspaceId}
            trigger={editingTrigger}
          />
        </>
      )}

      <ChipConfirmModal
        open={recipientToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setRecipientToRemove(null)
        }}
        srTitle='Remove recipient'
        title='Remove recipient'
        text={[
          'Removing ',
          { text: recipientToRemove?.title || 'this Telegram chat', bold: true },
          ' stops its alerts. Its connect link stops working.',
        ]}
        confirm={{
          label: 'Remove',
          onClick: () => void handleRemoveRecipient(),
          pending: deleteRecipient.isPending,
          pendingLabel: 'Removing...',
        }}
      />

      <ChipConfirmModal
        open={triggerToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setTriggerToDelete(null)
        }}
        srTitle='Delete trigger'
        title='Delete trigger'
        text={[
          'Deleting ',
          { text: triggerToDelete?.name ?? 'this trigger', bold: true },
          ' stops its alerts. Its alert history is deleted too.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: () => void handleDeleteTrigger(),
          pending: deleteTrigger.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
