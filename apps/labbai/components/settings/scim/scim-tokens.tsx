'use client'

import { useState } from 'react'
import { Chip, ChipCopyInput, ChipSelect, Label } from '@labbai/emcn'
import { getErrorMessage } from '@labbai/utils/errors'
import { formatScimTimestamp } from '@/components/settings/scim/format'
import type { ScimCredentialView } from '@/lib/api/contracts/organization-scim'
import { useIssueScimCredential, useRevokeScimCredential } from '@/hooks/queries/scim'

const EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never expires' },
  { value: '30', label: 'Expires in 30 days' },
  { value: '90', label: 'Expires in 90 days' },
  { value: '365', label: 'Expires in 1 year' },
]

interface ScimTokensProps {
  organizationId: string
  credentials: ScimCredentialView[]
}

/** Bearer tokens for the identity provider. A new token's secret is shown once. */
export function ScimTokens({ organizationId, credentials }: ScimTokensProps) {
  const issue = useIssueScimCredential(organizationId)
  const revoke = useRevokeScimCredential(organizationId)
  const [expiry, setExpiry] = useState('never')
  const [secret, setSecret] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const handleIssue = () => {
    setSecret(null)
    issue.mutate(expiry === 'never' ? {} : { expiresInDays: Number(expiry) }, {
      onSuccess: (result) => setSecret(result.secret),
    })
  }

  return (
    <div className='flex flex-col gap-3'>
      <Label>Bearer tokens</Label>

      {secret ? (
        <div className='flex flex-col gap-2 rounded-md border border-[var(--border)] p-3'>
          <span className='text-sm'>Copy this token now. It will not be shown again.</span>
          <ChipCopyInput
            value={secret}
            copyLabel='Copy SCIM token'
            aria-label='New SCIM token'
            inputClassName='font-mono'
          />
          <Chip className='self-start' onClick={() => setSecret(null)}>
            Done
          </Chip>
        </div>
      ) : null}

      {credentials.length === 0 ? (
        <p className='text-[var(--text-muted)] text-sm'>No active tokens.</p>
      ) : (
        <ul className='flex flex-col divide-y divide-[var(--border)]'>
          {credentials.map((credential) => (
            <li key={credential.id} className='flex items-center justify-between gap-4 py-2'>
              <div className='flex min-w-0 flex-col'>
                <span className='truncate font-mono text-sm'>{credential.tokenPrefix}…</span>
                <span className='text-[var(--text-muted)] text-caption'>
                  Created {formatScimTimestamp(credential.createdAt)} · last used{' '}
                  {formatScimTimestamp(credential.lastUsedAt)}
                  {credential.expiresAt
                    ? ` · expires ${formatScimTimestamp(credential.expiresAt)}`
                    : ''}
                </span>
              </div>
              {confirmingId === credential.id ? (
                <div className='flex shrink-0 items-center gap-2'>
                  <Chip
                    variant='destructive'
                    disabled={revoke.isPending}
                    onClick={() =>
                      revoke.mutate(credential.id, { onSettled: () => setConfirmingId(null) })
                    }
                  >
                    Revoke
                  </Chip>
                  <Chip onClick={() => setConfirmingId(null)}>Cancel</Chip>
                </div>
              ) : (
                <Chip className='shrink-0' onClick={() => setConfirmingId(credential.id)}>
                  Revoke…
                </Chip>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <div className='w-[200px]'>
          <ChipSelect
            value={expiry}
            onChange={setExpiry}
            options={EXPIRY_OPTIONS}
            aria-label='Token expiry'
            fullWidth
            dropdownWidth='trigger'
          />
        </div>
        <Chip variant='primary' disabled={issue.isPending} onClick={handleIssue}>
          {issue.isPending ? 'Generating…' : 'Generate token'}
        </Chip>
      </div>

      {issue.error || revoke.error ? (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {getErrorMessage(issue.error ?? revoke.error, 'The token request failed')}
        </p>
      ) : null}
    </div>
  )
}
