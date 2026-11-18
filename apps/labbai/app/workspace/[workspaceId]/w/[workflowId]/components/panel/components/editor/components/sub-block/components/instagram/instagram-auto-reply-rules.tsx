'use client'

import { useState } from 'react'
import { Chip, ChipLink, ChipModal, OverflowText, Skeleton } from '@labbai/emcn'
import { ArrowUpRight, Pencil, Plus } from '@labbai/emcn/icons'
import { getErrorMessage } from '@labbai/utils/errors'
import { useParams } from 'next/navigation'
import type { InstagramAutoReplyRule } from '@/lib/api/contracts/instagram-auto-reply'
import { RuleEditor } from '@/app/workspace/[workspaceId]/instagram/components/rule-editor/rule-editor'
import { RuleStatusBadge } from '@/app/workspace/[workspaceId]/instagram/components/rule-status-badge'
import type { InstagramPreviewTab } from '@/app/workspace/[workspaceId]/instagram/search-params'
import {
  type InstagramAccountOption,
  TRIGGER_TYPE_LABELS,
} from '@/app/workspace/[workspaceId]/instagram/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { ModalSubBlockProps } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/modal-registry'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import {
  useInstagramAutoReplyRule,
  useInstagramAutoReplyRules,
} from '@/hooks/queries/instagram-auto-reply'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'

/** The OAuth provider id Instagram accounts are connected under. */
const INSTAGRAM_PROVIDER_ID = 'instagram'

/** The trigger's account picker; the rules listed are the ones for that account. */
const CREDENTIAL_SUBBLOCK_ID = 'triggerCredentials'

const SKELETON_ROWS = 2

/** Which rule the editor modal shows: a saved one by id, or a new one. */
type EditorTarget = { kind: 'new' } | { kind: 'rule'; ruleId: string }

interface RuleRowProps {
  rule: InstagramAutoReplyRule
  readOnly: boolean
  onEdit: () => void
}

function RuleRow({ rule, readOnly, onEdit }: RuleRowProps) {
  return (
    <li className='flex min-w-0 items-center gap-2 rounded-lg border border-[var(--border)] px-2 py-1.5'>
      <div className='flex min-w-0 flex-1 flex-col'>
        <OverflowText label={rule.name} className='text-[var(--text-body)] text-small' />
        <span className='text-[var(--text-muted)] text-caption'>
          {TRIGGER_TYPE_LABELS[rule.triggerType]}
        </span>
      </div>
      <RuleStatusBadge status={rule.status} />
      <Chip
        leftIcon={Pencil}
        onClick={onEdit}
        aria-label={`${readOnly ? 'View' : 'Edit'} ${rule.name}`}
      >
        {readOnly ? 'View' : 'Edit'}
      </Chip>
    </li>
  )
}

interface RuleEditorModalProps {
  workspaceId: string
  workflowId: string
  target: EditorTarget
  credentialId: string
  accounts: readonly InstagramAccountOption[]
  accountsLoading: boolean
  canEdit: boolean
  onTargetChange: (target: EditorTarget | null) => void
}

/** The workspace page's rule editor, in a full-size modal over the workflow. */
function RuleEditorModal({
  workspaceId,
  workflowId,
  target,
  credentialId,
  accounts,
  accountsLoading,
  canEdit,
  onTargetChange,
}: RuleEditorModalProps) {
  const [previewTab, setPreviewTab] = useState<InstagramPreviewTab>('post')
  const ruleId = target.kind === 'rule' ? target.ruleId : null
  const { data: rule, isLoading, error } = useInstagramAutoReplyRule(workspaceId, ruleId)
  const close = () => onTargetChange(null)

  return (
    <ChipModal
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
      size='full'
      srTitle={target.kind === 'new' ? 'New auto-reply' : 'Edit auto-reply'}
      className='h-[85vh]'
    >
      {target.kind === 'rule' && !rule ? (
        <div className='flex flex-1 items-center justify-center p-6 text-[var(--text-muted)] text-small'>
          {isLoading ? 'Loading auto-reply…' : getErrorMessage(error, 'This auto-reply is gone.')}
        </div>
      ) : (
        <RuleEditor
          key={rule?.id ?? 'new'}
          workspaceId={workspaceId}
          workflowId={workflowId}
          rule={rule ?? null}
          accounts={accounts}
          accountsLoading={accountsLoading}
          canEdit={canEdit}
          defaultCredentialId={credentialId}
          previewTab={previewTab}
          onPreviewTabChange={setPreviewTab}
          onClose={close}
          onCreated={(created) => onTargetChange({ kind: 'rule', ruleId: created.id })}
        />
      )}
    </ChipModal>
  )
}

/**
 * Instagram comment trigger → Auto-replies: the auto-reply rules of the account this trigger
 * listens on, each opening the same editor as the workspace's Instagram page. Rules are workspace
 * records, not part of the block: nothing is stored on the block, and changes apply at once,
 * without redeploying the workflow.
 */
export function InstagramAutoReplyRules({
  blockId,
  isPreview = false,
  disabled = false,
}: ModalSubBlockProps) {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
  const workflowId = typeof params?.workflowId === 'string' ? params.workflowId : ''
  const { canEdit } = useUserPermissionsContext()
  const [credentialValue] = useSubBlockValue<unknown>(blockId, CREDENTIAL_SUBBLOCK_ID)
  const credentialId = typeof credentialValue === 'string' ? credentialValue : ''

  const { data: credentials, isLoading: accountsLoading } = useOAuthCredentials(
    INSTAGRAM_PROVIDER_ID,
    { workspaceId, enabled: Boolean(workspaceId) && !isPreview }
  )
  const {
    data: rules = [],
    isLoading,
    isPlaceholderData,
    error,
  } = useInstagramAutoReplyRules(
    workspaceId,
    { credentialId },
    { enabled: Boolean(credentialId) && !isPreview }
  )

  const [target, setTarget] = useState<EditorTarget | null>(null)

  const readOnly = isPreview || disabled || !canEdit
  const accounts: InstagramAccountOption[] = (credentials ?? [])
    .filter((credential) => credential.type !== 'service_account')
    .map((credential) => ({ id: credential.id, name: credential.name }))
  const pageHref = `/workspace/${workspaceId}/instagram`

  if (isPreview) {
    return (
      <p className='text-[var(--text-muted)] text-caption'>
        Auto-replies are managed on the Instagram page.
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      {!credentialId ? (
        <p className='text-[var(--text-muted)] text-caption'>
          Choose an Instagram account to see its auto-replies.
        </p>
      ) : error ? (
        <p className='text-[var(--text-error)] text-caption'>
          {getErrorMessage(error, 'Could not load the auto-replies.')}
        </p>
      ) : isLoading || isPlaceholderData ? (
        <ul aria-label='Loading auto-replies' className='flex flex-col gap-1.5'>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <li key={index}>
              <Skeleton className='h-[44px] w-full rounded-lg' />
            </li>
          ))}
        </ul>
      ) : rules.length === 0 ? (
        <p className='text-[var(--text-muted)] text-caption'>No auto-replies for this account.</p>
      ) : (
        <ul aria-label='Auto-replies' className='flex flex-col gap-1.5'>
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              readOnly={readOnly}
              onEdit={() => setTarget({ kind: 'rule', ruleId: rule.id })}
            />
          ))}
        </ul>
      )}

      <div className='flex flex-wrap items-center gap-1.5'>
        {!readOnly && credentialId && (
          <Chip variant='outline' leftIcon={Plus} onClick={() => setTarget({ kind: 'new' })}>
            New auto-reply
          </Chip>
        )}
        <ChipLink href={pageHref} leftIcon={ArrowUpRight}>
          All auto-replies
        </ChipLink>
      </div>

      {target && (
        <RuleEditorModal
          workspaceId={workspaceId}
          workflowId={workflowId}
          target={target}
          credentialId={credentialId}
          accounts={accounts}
          accountsLoading={accountsLoading}
          canEdit={canEdit && !disabled}
          onTargetChange={setTarget}
        />
      )}
    </div>
  )
}
