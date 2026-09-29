'use client'

import { type ReactNode, useState } from 'react'
import {
  Badge,
  Button,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Tooltip,
  toast,
} from '@sim/emcn'
import { Link, Plus, Send, Trash } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { NOTIFICATION_NAME_MAX_LENGTH } from '@/lib/notifications/constants'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  type NotificationRecipient,
  useCreateNotificationRecipient,
  useDeleteNotificationRecipient,
  useTestNotificationRecipient,
  useWorkflowNotificationRecipients,
} from '@/hooks/queries/notifications'

const RECIPIENT_STATUS: Record<
  NotificationRecipient['status'],
  { label: string; variant: 'green' | 'amber' | 'gray'; description: string }
> = {
  connected: { label: 'Connected', variant: 'green', description: 'Receives alerts' },
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
  workflowId: string
  botUsername: string | null
}

/** Names a new recipient of this workflow, then shows the link that connects a Telegram chat. */
function ConnectTelegramModal({
  open,
  onOpenChange,
  workspaceId,
  workflowId,
  botUsername,
}: ConnectTelegramModalProps) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<NotificationRecipient | null>(null)
  const createRecipient = useCreateNotificationRecipient(workspaceId, workflowId)

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
              hint='Open it in Telegram on the account that should get this workflow’s alerts, then press Start.'
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
              hint='Who gets this workflow’s alerts. You can connect a person or a Telegram group.'
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

interface RowActionProps {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

function RowAction({ label, disabled, onClick, children }: RowActionProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip.Root>
  )
}

interface NotificationRecipientsProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  disabled?: boolean
}

/**
 * Notifications block → Recipients: the Telegram chats that get THIS workflow's alerts. Rows are
 * created at once by "Connect Telegram" (they need the Telegram connect flow), unlike the rules,
 * which take effect on deploy. Recipients belong to the workflow, not to a version, so a preview
 * of a deployed version shows the current list read-only.
 */
export function NotificationRecipients({
  isPreview = false,
  disabled = false,
}: NotificationRecipientsProps) {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
  const workflowId = typeof params?.workflowId === 'string' ? params.workflowId : ''
  const permissions = useUserPermissionsContext()
  const canManage = permissions.canEdit

  const { data, isPending, error } = useWorkflowNotificationRecipients(workspaceId, workflowId, {
    enabled: canManage,
  })
  const deleteRecipient = useDeleteNotificationRecipient(workspaceId, workflowId)
  const testRecipient = useTestNotificationRecipient(workspaceId, workflowId)

  const [isConnectOpen, setIsConnectOpen] = useState(false)
  const [recipientToRemove, setRecipientToRemove] = useState<NotificationRecipient | null>(null)

  if (!canManage) {
    if (permissions.isLoading) return null
    return (
      <p className='text-[var(--text-tertiary)] text-caption'>
        Only workspace members who can edit this workflow can see its Telegram recipients.
      </p>
    )
  }
  if (error) {
    return (
      <p className='text-[var(--text-error)] text-caption'>
        {getErrorMessage(error, 'Failed to load the recipients')}
      </p>
    )
  }
  if (isPending || !data) return null
  if (!data.configured) {
    return (
      <p className='text-[var(--text-tertiary)] text-caption'>
        Telegram alerts are not set up on this server. Ask your administrator to configure the
        Labbai notification bot (NOTIFICATION_BOT_TOKEN and NOTIFICATION_BOT_USERNAME).
      </p>
    )
  }

  const recipients = data.recipients
  const readOnly = isPreview || disabled
  const atLimit = recipients.length >= data.limits.maxRecipients

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

  const handleRemove = async () => {
    if (!recipientToRemove) return
    try {
      await deleteRecipient.mutateAsync(recipientToRemove.id)
      setRecipientToRemove(null)
    } catch (removeError) {
      toast.error(getErrorMessage(removeError, 'Could not remove the recipient'))
    }
  }

  return (
    <div className='flex flex-col gap-2'>
      {recipients.length === 0 ? (
        <p className='text-[var(--text-tertiary)] text-caption'>
          No Telegram chat gets this workflow’s alerts yet.
        </p>
      ) : (
        <div className='flex flex-col gap-1.5'>
          {recipients.map((recipient) => {
            const status = RECIPIENT_STATUS[recipient.status]
            const connectUrl = recipient.connectUrl
            return (
              <div
                key={recipient.id}
                className='flex min-w-0 items-center gap-2 rounded-sm border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5'
              >
                <Send className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                <div className='flex min-w-0 flex-1 flex-col'>
                  <div className='flex min-w-0 items-center gap-1.5'>
                    <span className='truncate text-[var(--text-primary)] text-small'>
                      {recipient.title || 'Telegram chat'}
                    </span>
                    <Badge variant={status.variant} size='sm' dot>
                      {status.label}
                    </Badge>
                  </div>
                  <span className='truncate text-[var(--text-tertiary)] text-caption'>
                    {status.description}
                  </span>
                </div>
                {!readOnly && (
                  <div className='flex shrink-0 items-center gap-0.5'>
                    {connectUrl && (
                      <RowAction
                        label='Copy connect link'
                        onClick={() => copyText(connectUrl, 'Connect link copied')}
                      >
                        <Link className='size-[14px]' />
                      </RowAction>
                    )}
                    <RowAction
                      label='Send test message'
                      disabled={recipient.status !== 'connected' || testRecipient.isPending}
                      onClick={() => handleTest(recipient)}
                    >
                      <Send className='size-[14px]' />
                    </RowAction>
                    <RowAction label='Remove' onClick={() => setRecipientToRemove(recipient)}>
                      <Trash className='size-[14px]' />
                    </RowAction>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!readOnly && (
        <div>
          <Button
            type='button'
            variant='default'
            onClick={() => setIsConnectOpen(true)}
            disabled={atLimit}
            title={atLimit ? 'This workflow has the most recipients allowed' : undefined}
          >
            <Plus className='mr-1 size-[12px]' />
            Connect Telegram
          </Button>
        </div>
      )}

      {!readOnly && (
        <ConnectTelegramModal
          open={isConnectOpen}
          onOpenChange={setIsConnectOpen}
          workspaceId={workspaceId}
          workflowId={workflowId}
          botUsername={data.botUsername}
        />
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
          ' stops its alerts from this workflow. Its connect link stops working.',
        ]}
        confirm={{
          label: 'Remove',
          onClick: () => void handleRemove(),
          pending: deleteRecipient.isPending,
          pendingLabel: 'Removing...',
        }}
      />
    </div>
  )
}
