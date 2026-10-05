'use client'

import { useState } from 'react'
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
  toast,
} from '@labbai/emcn'
import { Link, Plus, Trash } from '@labbai/emcn/icons'
import { getErrorMessage } from '@labbai/utils/errors'
import { useParams } from 'next/navigation'
import type { CrmLink } from '@/lib/api/contracts/crm'
import { CRM_BASE_URL_MAX_LENGTH, CRM_SECRET_MAX_LENGTH } from '@/lib/crm/constants'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useConnectCrmLink, useDeleteCrmLink, useWorkflowCrmLink } from '@/hooks/queries/crm'

const BACKFILL_OPTIONS = [
  { value: '0', label: 'Only new messages' },
  { value: '24', label: 'Also the last 24 hours' },
  { value: '72', label: 'Also the last 3 days' },
] as const

const LINK_STATUS: Record<
  CrmLink['status'],
  { label: string; variant: 'green' | 'amber'; description: string }
> = {
  active: { label: 'Active', variant: 'green', description: 'Chats reach Binora' },
  waiting_deploy: {
    label: 'Deploy to start',
    variant: 'amber',
    description: 'Deploy this workflow with the block to start sending chats',
  },
}

function formatTime(value: Date | null): string | null {
  return value ? value.toLocaleString() : null
}

interface ConnectBinoraModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workflowId: string
  initialBaseUrl: string
}

/** Asks for the Binora lead source's address and key, then runs the handshake. */
function ConnectBinoraModal({
  open,
  onOpenChange,
  workspaceId,
  workflowId,
  initialBaseUrl,
}: ConnectBinoraModalProps) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl)
  const [secret, setSecret] = useState('')
  const [backfill, setBackfill] = useState<string>(BACKFILL_OPTIONS[0].value)
  const [error, setError] = useState<string | null>(null)
  const connect = useConnectCrmLink(workspaceId, workflowId)

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setBaseUrl(initialBaseUrl)
      setSecret('')
      setBackfill(BACKFILL_OPTIONS[0].value)
      setError(null)
    }
  }

  const canSubmit = baseUrl.trim().length > 0 && secret.trim().length > 0 && !connect.isPending

  const handleConnect = async () => {
    if (!canSubmit) return
    setError(null)
    try {
      await connect.mutateAsync({
        baseUrl: baseUrl.trim(),
        secret: secret.trim(),
        backfillHours: Number(backfill),
      })
      onOpenChange(false)
    } catch (connectError) {
      setError(getErrorMessage(connectError, 'Could not connect to Binora'))
    }
  }

  const close = () => {
    if (!connect.isPending) onOpenChange(false)
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!connect.isPending) onOpenChange(nextOpen)
      }}
      dismissDisabled={connect.isPending}
      srTitle='Connect Binora'
    >
      <ChipModalHeader onClose={close}>Connect Binora</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Address'
          value={baseUrl}
          onChange={(value) => {
            setBaseUrl(value)
            if (error) setError(null)
          }}
          inputType='url'
          placeholder='https://api.binora.uz/v1/messenger/…'
          maxLength={CRM_BASE_URL_MAX_LENGTH}
          autoComplete='off'
          mono
          hint='Binora → Settings → Lead sources → the “AI agent (Telegram, WhatsApp)” source → Address.'
        />
        <ChipModalField
          type='input'
          title='Key'
          value={secret}
          onChange={(value) => {
            setSecret(value)
            if (error) setError(null)
          }}
          inputType='password'
          maxLength={CRM_SECRET_MAX_LENGTH}
          autoComplete='new-password'
          hint='The same lead source → Key. It is stored encrypted and never shown again.'
        />
        <ChipModalField
          type='dropdown'
          title='Existing chats'
          value={backfill}
          onChange={setBackfill}
          options={BACKFILL_OPTIONS}
        />
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        cancelDisabled={connect.isPending}
        primaryAction={{
          label: connect.isPending ? 'Connecting...' : 'Connect',
          onClick: () => void handleConnect(),
          disabled: !canSubmit,
        }}
      />
    </ChipModal>
  )
}

interface BinoraCrmConnectionProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  disabled?: boolean
}

/**
 * Binora CRM block → Binora link: where THIS workflow's chats go. The link is saved at once by
 * "Connect" (it needs Binora's handshake); chats flow while the deployed version has the block.
 * The link belongs to the workflow, not to a version, so a preview shows it read-only.
 */
export function BinoraCrmConnection({
  isPreview = false,
  disabled = false,
}: BinoraCrmConnectionProps) {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
  const workflowId = typeof params?.workflowId === 'string' ? params.workflowId : ''
  const permissions = useUserPermissionsContext()
  const canManage = permissions.canEdit

  const { data: link, isPending, error } = useWorkflowCrmLink(workspaceId, workflowId, {
    enabled: canManage,
  })
  const deleteLink = useDeleteCrmLink(workspaceId, workflowId)

  const [isConnectOpen, setIsConnectOpen] = useState(false)
  const [isDisconnectOpen, setIsDisconnectOpen] = useState(false)

  if (!canManage) {
    if (permissions.isLoading) return null
    return (
      <p className='text-[var(--text-tertiary)] text-caption'>
        Only workspace members who can edit this workflow can see its Binora link.
      </p>
    )
  }
  if (error) {
    return (
      <p className='text-[var(--text-error)] text-caption'>
        {getErrorMessage(error, 'Failed to load the Binora link')}
      </p>
    )
  }
  if (isPending) return null

  const readOnly = isPreview || disabled

  const handleDisconnect = async () => {
    try {
      await deleteLink.mutateAsync()
      setIsDisconnectOpen(false)
    } catch (removeError) {
      toast.error(getErrorMessage(removeError, 'Could not disconnect'))
    }
  }

  const status = link ? LINK_STATUS[link.status] : null
  const lastDelivered = formatTime(link?.lastDeliveredAt ?? null)
  const lastErrorAt = formatTime(link?.lastErrorAt ?? null)

  return (
    <div className='flex flex-col gap-2'>
      {link && status ? (
        <div className='flex min-w-0 flex-col gap-1 rounded-sm border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5'>
          <div className='flex min-w-0 items-center gap-2'>
            <Link className='size-[14px] shrink-0 text-[var(--text-icon)]' />
            <span className='truncate text-[var(--text-primary)] text-small'>
              {link.pipelineName ?? link.channelName ?? 'Binora'}
            </span>
            <Badge variant={status.variant} size='sm' dot>
              {status.label}
            </Badge>
          </div>
          <span className='truncate text-[var(--text-tertiary)] text-caption'>
            {link.channelName ? `Lead source: ${link.channelName}. ` : ''}
            {status.description}
            {lastDelivered ? ` · last sent ${lastDelivered}` : ''}
          </span>
          {link.lastError && (
            <span className='text-[var(--text-error)] text-caption'>
              {lastErrorAt ? `${lastErrorAt}: ` : ''}
              {link.lastError}. Messages are retried automatically.
            </span>
          )}
        </div>
      ) : (
        <p className='text-[var(--text-tertiary)] text-caption'>
          This workflow’s chats do not reach Binora yet. Create an “AI agent (Telegram, WhatsApp)” lead source
          in Binora, then connect it here.
        </p>
      )}

      {!readOnly && (
        <div className='flex items-center gap-1.5'>
          <Button type='button' variant='default' onClick={() => setIsConnectOpen(true)}>
            <Plus className='mr-1 size-[12px]' />
            {link ? 'Reconnect' : 'Connect Binora'}
          </Button>
          {link && (
            <Button type='button' variant='ghost' onClick={() => setIsDisconnectOpen(true)}>
              <Trash className='mr-1 size-[12px]' />
              Disconnect
            </Button>
          )}
        </div>
      )}

      {!readOnly && (
        <ConnectBinoraModal
          open={isConnectOpen}
          onOpenChange={setIsConnectOpen}
          workspaceId={workspaceId}
          workflowId={workflowId}
          initialBaseUrl={link?.baseUrl ?? ''}
        />
      )}

      <ChipConfirmModal
        open={isDisconnectOpen}
        onOpenChange={setIsDisconnectOpen}
        srTitle='Disconnect Binora'
        title='Disconnect Binora'
        text={[
          'This workflow’s chats stop reaching ',
          { text: link?.pipelineName ?? 'Binora', bold: true },
          '. Leads already in Binora stay there, but operators can no longer reply from them.',
        ]}
        confirm={{
          label: 'Disconnect',
          onClick: () => void handleDisconnect(),
          pending: deleteLink.isPending,
          pendingLabel: 'Disconnecting...',
        }}
      />
    </div>
  )
}
