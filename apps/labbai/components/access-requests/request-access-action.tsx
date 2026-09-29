'use client'

import { useState } from 'react'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalDescription,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@labbai/emcn'
import { getErrorMessage } from '@labbai/utils/errors'
import type { AccessRequestScope, AccessRequestTarget } from '@/lib/api/contracts/access-requests'
import { ACCESS_REQUEST_MAX_REASON_LENGTH } from '@/lib/labbai/access-requests/constants'
import { useCancelAccessRequest, useCreateAccessRequest } from '@/hooks/queries/access-requests'

interface RequestAccessModalProps {
  scope: AccessRequestScope
  target: AccessRequestTarget
  /** Human name of what is being requested, e.g. "Tables" or "Slack". */
  label: string
  onClose: () => void
}

/**
 * Asks the organization's admins for one piece of access. The reason is
 * optional; admins see it next to the request in their review queue.
 */
export function RequestAccessModal({ scope, target, label, onClose }: RequestAccessModalProps) {
  const [reason, setReason] = useState('')
  const createRequest = useCreateAccessRequest()
  const submitted = createRequest.data?.request

  const submit = () => {
    if (createRequest.isPending) return
    createRequest.mutate({ scope, target, reason })
  }

  const outcome =
    submitted?.status === 'closed'
      ? `You already have access to ${label}. Reload the page if it still looks restricted.`
      : submitted
        ? 'Your request was sent. An organization admin will review it, and you will get an email when it is resolved.'
        : null

  return (
    <ChipModal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      srTitle={`Request access to ${label}`}
      size='sm'
      dismissDisabled={createRequest.isPending}
    >
      <ChipModalHeader onClose={onClose}>Request access to {label}</ChipModalHeader>
      <ChipModalBody>
        {outcome ? (
          <ChipModalDescription>{outcome}</ChipModalDescription>
        ) : (
          <>
            <ChipModalDescription>
              Your organization restricts {label}. Tell your admins why you need it.
            </ChipModalDescription>
            <ChipModalField
              type='textarea'
              title='Reason'
              value={reason}
              onChange={setReason}
              rows={4}
              maxLength={ACCESS_REQUEST_MAX_REASON_LENGTH}
              placeholder='Optional'
              disabled={createRequest.isPending}
            />
            <ChipModalError>
              {createRequest.error
                ? getErrorMessage(createRequest.error, 'Unable to send the request')
                : null}
            </ChipModalError>
          </>
        )}
      </ChipModalBody>
      {outcome ? (
        <ChipModalFooter hideCancel primaryAction={{ label: 'Done', onClick: onClose }} />
      ) : (
        <ChipModalFooter
          onCancel={onClose}
          cancelDisabled={createRequest.isPending}
          primaryAction={{
            label: createRequest.isPending ? 'Sending…' : 'Send request',
            onClick: submit,
            disabled: createRequest.isPending,
          }}
        />
      )}
    </ChipModal>
  )
}

interface RequestAccessActionProps {
  scope: AccessRequestScope
  target: AccessRequestTarget
  label: string
  /** The requester's open request for this target, if any. */
  pendingRequestId: string | null
}

/** The inline control on a restricted surface: request access, or withdraw a pending request. */
export function RequestAccessAction({
  scope,
  target,
  label,
  pendingRequestId,
}: RequestAccessActionProps) {
  const [open, setOpen] = useState(false)
  const cancelRequest = useCancelAccessRequest()

  if (pendingRequestId) {
    return (
      <Chip
        variant='outline'
        disabled={cancelRequest.isPending}
        onClick={() => cancelRequest.mutate({ scope, requestId: pendingRequestId })}
      >
        {cancelRequest.isPending ? 'Cancelling…' : 'Cancel request'}
      </Chip>
    )
  }

  return (
    <>
      <Chip variant='primary' onClick={() => setOpen(true)}>
        Request access
      </Chip>
      {open && (
        <RequestAccessModal
          scope={scope}
          target={target}
          label={label}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
