'use client'

import { type ReactNode, useMemo, useState } from 'react'
import {
  Badge,
  Chip,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Input,
  toast,
} from '@labbai/emcn'
import { getErrorMessage } from '@labbai/utils/errors'
import {
  canResendEnrollment,
  describeEnrollmentStatus,
  getProviderLabel,
  isOptionSetupIncomplete,
} from '@/components/settings/credential-groups/labels'
import type { CredentialGroupEnrollmentDetail } from '@/lib/api/contracts/credential-groups'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  useInviteOrganizationAccountPeople,
  useOrganizationAccountPeople,
  useOrganizationAccounts,
  useResendOrganizationAccountInvitation,
  useRevokeOrganizationAccountEnrollment,
} from '@/hooks/queries/organization-accounts'
import { useOrganizationAccountPeopleSearch } from '@/hooks/use-organization-account-people-search'

export interface OrganizationAccountPeopleProps {
  organizationId: string
  /** False while the organization's account pool is not ready; stops the people query. */
  enabled?: boolean
  /** Rendered instead of the list (and blocks invitations) while setup is incomplete. */
  setupFallback?: ReactNode
  /** Narrows the list and new requests to one provider option. */
  searchConnection?: { optionId: string; providerName: string }
  /** Controls rendered above the list (tabs, integration filter). */
  filters?: ReactNode
}

/** Connections a person has made, as a short provider list. */
function describeConnections(enrollment: CredentialGroupEnrollmentDetail): string | null {
  const names = [
    ...enrollment.connections.map((connection) => getProviderLabel(connection.provider)),
    ...enrollment.mcpConnections.map((connection) => connection.name),
  ]
  const unique = Array.from(new Set(names))
  return unique.length > 0 ? unique.join(', ') : null
}

/**
 * People invited to connect their own accounts to the organization's account
 * pool: search, request connections by email, and resend or revoke a request.
 */
export function OrganizationAccountPeople({
  organizationId,
  enabled = true,
  setupFallback,
  searchConnection,
  filters,
}: OrganizationAccountPeopleProps) {
  const [search, setSearch] = useOrganizationAccountPeopleSearch()
  const optionId = searchConnection?.optionId
  const queryEnabled = enabled && !setupFallback

  const accounts = useOrganizationAccounts(organizationId)
  const people = useOrganizationAccountPeople(
    organizationId,
    search,
    optionId ? { enabled: queryEnabled, optionId } : { enabled: queryEnabled }
  )
  const invite = useInviteOrganizationAccountPeople()
  const resend = useResendOrganizationAccountInvitation()
  const revoke = useRevokeOrganizationAccountEnrollment()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [emails, setEmails] = useState<string[]>([])
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<CredentialGroupEnrollmentDetail | null>(null)

  const selectedOption = optionId
    ? accounts.data?.credentialGroup?.options.find((option) => option.id === optionId)
    : undefined
  const setupIncomplete = Boolean(searchConnection) && isOptionSetupIncomplete(selectedOption)
  const canRequest = enabled && !setupFallback && !setupIncomplete

  const enrollments = useMemo(
    () => (people.data?.pages ?? []).flatMap((page) => page.enrollments ?? []),
    [people.data?.pages]
  )

  const title = searchConnection
    ? `Request ${searchConnection.providerName} connections`
    : 'Request connections'

  const closeInvite = () => {
    if (sending) return
    setInviteOpen(false)
    setEmails([])
    setInviteError(null)
  }

  const sendRequests = async () => {
    if (emails.length === 0 || sending) return
    setSending(true)
    setInviteError(null)
    try {
      const result = await invite.mutateAsync({
        organizationId,
        emails,
        ...(optionId ? { optionId } : {}),
      })
      const failed = result.results.filter((entry) => !entry.success)
      if (failed.length > 0) {
        setEmails(failed.map((entry) => entry.email))
        const first = failed[0]
        setInviteError(
          `Could not send ${failed.length} of ${result.results.length} requests.${
            first && 'error' in first ? ` ${first.error}` : ''
          }`
        )
        return
      }
      toast.success(
        result.sentCount === 1 ? 'Connection request sent' : `${result.sentCount} requests sent`
      )
      setInviteOpen(false)
      setEmails([])
    } catch (error) {
      setInviteError(getErrorMessage(error, 'Could not send connection requests.'))
    } finally {
      setSending(false)
    }
  }

  const resendRequest = (enrollment: CredentialGroupEnrollmentDetail) => {
    resend.mutate(
      { organizationId, enrollmentId: enrollment.id, ...(optionId ? { optionId } : {}) },
      {
        onSuccess: () => toast.success(`Request re-sent to ${enrollment.email}`),
        onError: (error) => toast.error(getErrorMessage(error, 'Could not resend the request.')),
      }
    )
  }

  const confirmRevoke = () => {
    if (!revokeTarget) return
    revoke.mutate(
      { organizationId, enrollmentId: revokeTarget.id },
      {
        onSuccess: () => {
          toast.success(`Access revoked for ${revokeTarget.email}`)
          setRevokeTarget(null)
        },
      }
    )
  }

  let body: ReactNode
  if (setupFallback) {
    body = setupFallback
  } else if (people.error) {
    body = (
      <SettingsQueryErrorState
        error={people.error}
        fallback='Could not load people.'
        isRetrying={Boolean(people.isRefetching)}
        onRetry={() => void people.refetch()}
        variant='inline'
      />
    )
  } else if (enrollments.length === 0) {
    body = (
      <SettingsEmptyState variant='inline'>
        {people.isPending && queryEnabled
          ? 'Loading people…'
          : search.trim()
            ? 'No people match your search.'
            : 'No people invited yet.'}
      </SettingsEmptyState>
    )
  } else {
    body = (
      <div className='flex flex-col gap-0.5'>
        {enrollments.map((enrollment) => {
          const status = describeEnrollmentStatus(enrollment)
          const connections = describeConnections(enrollment)
          const actions = [
            ...(canResendEnrollment(enrollment)
              ? [{ label: 'Resend request', onSelect: () => resendRequest(enrollment) }]
              : []),
            ...(enrollment.status !== 'revoked'
              ? [
                  {
                    label: 'Revoke',
                    destructive: true,
                    onSelect: () => {
                      revoke.reset()
                      setRevokeTarget(enrollment)
                    },
                  },
                ]
              : []),
          ]
          return (
            <div
              key={enrollment.id}
              className='flex items-center gap-3 rounded-md px-3 py-2 hover-hover:bg-[var(--surface-2)]'
            >
              <div className='flex min-w-0 flex-1 flex-col'>
                <span className='truncate text-[var(--text-primary)] text-small'>
                  {enrollment.email}
                </span>
                <span className='truncate text-[var(--text-muted)] text-caption'>
                  {connections ?? 'No accounts connected yet'}
                </span>
              </div>
              <Badge variant={status.tone} size='sm' dot>
                {status.label}
              </Badge>
              {actions.length > 0 ? (
                <RowActionsMenu label={`Actions for ${enrollment.email}`} actions={actions} />
              ) : (
                <span className='w-[28px] shrink-0' aria-hidden />
              )}
            </div>
          )
        })}
        {people.hasNextPage && (
          <div className='flex justify-center pt-2'>
            <Chip
              variant='border'
              disabled={Boolean(people.isFetchingNextPage)}
              onClick={() => void people.fetchNextPage()}
            >
              {people.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Chip>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      {filters}
      <div className='flex items-center gap-2'>
        <Input
          className='min-w-0 flex-1'
          placeholder='Search people...'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label='Search people'
        />
        <Chip
          variant='primary'
          disabled={!canRequest}
          onClick={() => {
            invite.reset()
            setInviteError(null)
            setInviteOpen(true)
          }}
        >
          Request connections
        </Chip>
      </div>
      {setupIncomplete && searchConnection && !setupFallback && (
        <SettingsEmptyState variant='inline'>
          Finish setting up {searchConnection.providerName} before requesting connections.
        </SettingsEmptyState>
      )}
      {body}

      <ChipModal
        open={inviteOpen}
        onOpenChange={(open) => {
          if (!open) closeInvite()
        }}
        srTitle={title}
      >
        <ChipModalHeader onClose={closeInvite}>{title}</ChipModalHeader>
        <ChipModalBody>
          <p className='text-[var(--text-secondary)] text-small'>
            Each person gets a link to connect their own account. They do not need to be a member of
            the organization.
          </p>
          <ChipModalField
            type='emails'
            title='Emails'
            value={emails}
            onChange={setEmails}
            placeholder='Enter emails'
            disabled={sending}
          />
          <ChipModalError>{inviteError}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={closeInvite}
          primaryAction={{
            label: sending ? 'Sending…' : 'Send requests',
            onClick: () => void sendRequests(),
            disabled: emails.length === 0 || sending,
          }}
        />
      </ChipModal>

      <ChipConfirmModal
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setRevokeTarget(null)
        }}
        title='Revoke access?'
        text={`${revokeTarget?.email ?? 'This person'} will no longer share their connected accounts with the organization. They cannot restore it themselves.`}
        confirm={{
          label: 'Revoke',
          pending: Boolean(revoke.isPending),
          onClick: confirmRevoke,
        }}
      >
        <ChipModalError>{revoke.error?.message}</ChipModalError>
      </ChipConfirmModal>
    </div>
  )
}
