'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipSwitch, Skeleton, toast } from '@labbai/emcn'
import { Plus } from '@labbai/emcn/icons'
import { getErrorMessage } from '@labbai/utils/errors'
import { EmptyState } from '@/components/empty-state/empty-state'
import { InstagramIcon } from '@/components/icons'
import type { InstagramAutoReplyRuleListItem } from '@/lib/api/contracts/instagram-auto-reply'
import { Resource } from '@/app/workspace/[workspaceId]/components'
import { RuleRow } from '@/app/workspace/[workspaceId]/instagram/components/rule-list/rule-row'
import {
  INSTAGRAM_RULE_STATUS_FILTERS,
  type InstagramRuleStatusFilter,
} from '@/app/workspace/[workspaceId]/instagram/search-params'
import {
  duplicateRuleBody,
  type InstagramAccountOption,
  RULE_STATUS_LABELS,
} from '@/app/workspace/[workspaceId]/instagram/utils'
import {
  useCreateInstagramAutoReplyRule,
  useDeleteInstagramAutoReplyRule,
  useSetInstagramAutoReplyRuleStatus,
} from '@/hooks/queries/instagram-auto-reply'

const STATUS_FILTER_OPTIONS = INSTAGRAM_RULE_STATUS_FILTERS.map((value) => ({
  value,
  label: value === 'all' ? 'All' : RULE_STATUS_LABELS[value],
}))

const SKELETON_ROWS = 3

export interface RuleListProps {
  workspaceId: string
  rules: readonly InstagramAutoReplyRuleListItem[]
  isLoading: boolean
  accounts: readonly InstagramAccountOption[]
  canEdit: boolean
  search: string
  onSearchChange: (value: string) => void
  status: InstagramRuleStatusFilter
  onStatusChange: (status: InstagramRuleStatusFilter) => void
  onOpen: (ruleId: string) => void
  onCreate: () => void
}

/**
 * Every auto-reply in the workspace, newest order as the server returns it, filtered by status and
 * a name or keyword search. Rows open the editor; each row's menu runs the quick actions.
 */
export function RuleList({
  workspaceId,
  rules,
  isLoading,
  accounts,
  canEdit,
  search,
  onSearchChange,
  status,
  onStatusChange,
  onOpen,
  onCreate,
}: RuleListProps) {
  const setStatus = useSetInstagramAutoReplyRuleStatus(workspaceId)
  const createRule = useCreateInstagramAutoReplyRule(workspaceId)
  const deleteRule = useDeleteInstagramAutoReplyRule(workspaceId)
  const [pendingDelete, setPendingDelete] = useState<InstagramAutoReplyRuleListItem | null>(null)

  const accountNames = new Map(accounts.map((account) => [account.id, account.name]))
  const query = search.trim().toLowerCase()
  const visibleRules = rules.filter(
    (rule) =>
      (status === 'all' || rule.status === status) &&
      (!query ||
        rule.name.toLowerCase().includes(query) ||
        rule.keywords.some((keyword) => keyword.toLowerCase().includes(query)))
  )

  const handleToggleStatus = (rule: InstagramAutoReplyRuleListItem) => {
    const next = rule.status === 'live' ? 'paused' : 'live'
    setStatus.mutate(
      { ruleId: rule.id, status: next },
      {
        onSuccess: () =>
          toast.success(next === 'live' ? 'Auto-reply is live' : 'Auto-reply paused'),
        onError: (error) =>
          toast.error(getErrorMessage(error, 'Could not change the auto-reply status.')),
      }
    )
  }

  const handleDuplicate = (rule: InstagramAutoReplyRuleListItem) => {
    const body = duplicateRuleBody(rule)
    if (!body) return
    createRule.mutate(body, {
      onSuccess: (created) => toast.success(`Created “${created.name}” as a draft`),
      onError: (error) =>
        toast.error(getErrorMessage(error, 'Could not duplicate the auto-reply.')),
    })
  }

  const handleConfirmDelete = () => {
    if (!pendingDelete) return
    deleteRule.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success('Auto-reply deleted')
        setPendingDelete(null)
      },
      onError: (error) => toast.error(getErrorMessage(error, 'Could not delete the auto-reply.')),
    })
  }

  const clearFilters = () => {
    onSearchChange('')
    onStatusChange('all')
  }

  return (
    <>
      <Resource.Header
        icon={InstagramIcon}
        title='Instagram Auto-Reply'
        actions={[
          {
            id: 'create',
            text: 'New auto-reply',
            icon: Plus,
            variant: 'primary',
            onSelect: onCreate,
            disabled: !canEdit,
          },
        ]}
      />
      <Resource.Options
        search={{ value: search, onChange: onSearchChange, placeholder: 'Search auto-replies...' }}
        aside={
          <ChipSwitch
            aria-label='Status'
            size='compact'
            options={STATUS_FILTER_OPTIONS}
            value={status}
            onChange={onStatusChange}
          />
        }
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {isLoading && rules.length === 0 ? (
          <ul aria-label='Loading auto-replies' className='flex flex-col gap-1 px-3 py-3'>
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <li key={index}>
                <Skeleton className='h-[52px] w-full rounded-lg' />
              </li>
            ))}
          </ul>
        ) : rules.length === 0 ? (
          <EmptyState
            title='No auto-replies yet'
            description='Reply to comments and send a DM the moment someone comments on your posts.'
            action={
              <Chip variant='primary' leftIcon={Plus} onClick={onCreate} disabled={!canEdit}>
                Create auto-reply
              </Chip>
            }
          />
        ) : visibleRules.length === 0 ? (
          <EmptyState
            title={query ? `No results for “${search.trim()}”` : 'No results'}
            description='No auto-reply matches this search or status.'
            action={
              <Chip variant='outline' onClick={clearFilters}>
                Clear filters
              </Chip>
            }
          />
        ) : (
          <ul aria-label='Auto-replies' className='flex flex-col gap-0.5 px-3 py-3'>
            {visibleRules.map((rule) => (
              <RuleRow
                key={rule.id}
                workspaceId={workspaceId}
                rule={rule}
                accountName={
                  rule.credentialId ? (accountNames.get(rule.credentialId) ?? null) : null
                }
                canEdit={canEdit}
                onOpen={(item) => onOpen(item.id)}
                onToggleStatus={handleToggleStatus}
                onDuplicate={handleDuplicate}
                onDelete={setPendingDelete}
              />
            ))}
          </ul>
        )}
      </div>
      <ChipConfirmModal
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title='Delete auto-reply'
        text={[
          'Delete ',
          { text: pendingDelete?.name ?? '', bold: true },
          '? It stops replying at once, and this cannot be undone.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleConfirmDelete,
          pending: deleteRule.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
