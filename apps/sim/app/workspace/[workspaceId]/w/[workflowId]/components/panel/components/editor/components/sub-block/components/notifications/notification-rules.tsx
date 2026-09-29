'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { Badge, Button, Tooltip } from '@sim/emcn'
import { Bell, Pencil, Plus, Trash } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import { useParams } from 'next/navigation'
import {
  NOTIFICATION_DIRECTION_LABELS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_MAX_TRIGGERS,
} from '@/lib/notifications/constants'
import {
  createNotificationRule,
  type NotificationRule,
  notificationRuleProblem,
  readNotificationRules,
} from '@/lib/notifications/rules'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { NotificationRuleModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/notifications/notification-rule-modal'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useWorkflowNotificationRecipients } from '@/hooks/queries/notifications'

const PAUSE_BADGES: Record<NotificationRule['pauseMode'], string | null> = {
  none: null,
  temporary: 'Pauses AI',
  hard: 'Turns AI off',
}

function describeRule(rule: NotificationRule): string {
  if (rule.direction === 'event') {
    const event = rule.eventKey ? NOTIFICATION_EVENT_LABELS[rule.eventKey] : 'no event chosen'
    return `${NOTIFICATION_DIRECTION_LABELS.event}: ${event}`
  }
  const condition = rule.condition.replace(/\s+/g, ' ').trim()
  return `${NOTIFICATION_DIRECTION_LABELS[rule.direction]} · ${condition || 'no condition'}`
}

interface RuleActionProps {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

function RuleAction({ label, disabled, onClick, children }: RuleActionProps) {
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

interface NotificationRulesProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

/**
 * Notifications block → Rules: when this workflow alerts its recipients, and what happens to the
 * AI then. The list is the block's value (every write is the whole array, like any other field),
 * so it is versioned with the workflow: a rule takes effect when the workflow is deployed and
 * stops when it is removed and the workflow is redeployed.
 */
export function NotificationRules({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: NotificationRulesProps) {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
  const workflowId = typeof params?.workflowId === 'string' ? params.workflowId : ''
  const permissions = useUserPermissionsContext()
  const [storeValue, setStoreValue] = useSubBlockValue<NotificationRule[]>(blockId, subBlockId)
  /** Shares the Recipients field's query: it also says whether the server has the bot. */
  const { data } = useWorkflowNotificationRecipients(workspaceId, workflowId, {
    enabled: permissions.canEdit,
  })

  const [editing, setEditing] = useState<{ rule: NotificationRule; isNew: boolean } | null>(null)

  const rules = useMemo(
    () => readNotificationRules(isPreview ? previewValue : storeValue),
    [isPreview, previewValue, storeValue]
  )
  const notConfigured = data?.configured === false
  const readOnly = isPreview || disabled
  const atLimit = rules.length >= NOTIFICATION_MAX_TRIGGERS
  const limitHint = `A workflow can have up to ${NOTIFICATION_MAX_TRIGGERS} rules`

  const saveRule = (rule: NotificationRule) => {
    const exists = rules.some((existing) => existing.id === rule.id)
    const next = exists
      ? rules.map((existing) => (existing.id === rule.id ? rule : existing))
      : [...rules, rule]
    setStoreValue(next)
  }

  const removeRule = (ruleId: string) => {
    setStoreValue(rules.filter((rule) => rule.id !== ruleId))
  }

  const toggleRule = (rule: NotificationRule) => {
    saveRule({ ...rule, isActive: !rule.isActive })
  }

  return (
    <div className='flex flex-col gap-2'>
      {notConfigured && (
        <p className='text-[var(--text-tertiary)] text-caption'>
          Telegram alerts are not set up on this server, so these rules do nothing yet.
        </p>
      )}

      {rules.length === 0 ? (
        <p className='text-[var(--text-tertiary)] text-caption'>
          Add a rule to say when this workflow should alert its recipients.
        </p>
      ) : (
        <div className='flex flex-col gap-1.5'>
          {rules.map((rule) => {
            const problem = notificationRuleProblem(rule)
            const pauseBadge = PAUSE_BADGES[rule.pauseMode]
            return (
              <div
                key={rule.id}
                className='flex min-w-0 items-center gap-2 rounded-sm border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5'
              >
                <Bell className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                <div className='flex min-w-0 flex-1 flex-col'>
                  <div className='flex min-w-0 items-center gap-1.5'>
                    <span className='truncate text-[var(--text-primary)] text-small'>
                      {rule.name || 'Untitled rule'}
                    </span>
                    {!rule.isActive ? (
                      <Badge variant='gray' size='sm'>
                        Off
                      </Badge>
                    ) : pauseBadge ? (
                      <Badge variant='amber' size='sm'>
                        {pauseBadge}
                      </Badge>
                    ) : null}
                  </div>
                  <span
                    className={
                      problem
                        ? 'truncate text-[var(--text-error)] text-caption'
                        : 'truncate text-[var(--text-tertiary)] text-caption'
                    }
                  >
                    {problem ? `${problem} — ignored on deploy` : describeRule(rule)}
                  </span>
                </div>
                {!readOnly && (
                  <div className='flex shrink-0 items-center gap-0.5'>
                    <RuleAction
                      label={rule.isActive ? 'Turn off' : 'Turn on'}
                      onClick={() => toggleRule(rule)}
                    >
                      <Bell className='size-[14px]' />
                    </RuleAction>
                    <RuleAction label='Edit' onClick={() => setEditing({ rule, isNew: false })}>
                      <Pencil className='size-[14px]' />
                    </RuleAction>
                    <RuleAction label='Delete' onClick={() => removeRule(rule.id)}>
                      <Trash className='size-[14px]' />
                    </RuleAction>
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
            onClick={() =>
              setEditing({ rule: createNotificationRule(generateShortId(12)), isNew: true })
            }
            disabled={atLimit}
            title={atLimit ? limitHint : undefined}
          >
            <Plus className='mr-1 size-[12px]' />
            Add rule
          </Button>
        </div>
      )}

      <p className='text-[var(--text-tertiary)] text-caption'>
        Rules take effect when you deploy the workflow. Change a rule, then redeploy.
      </p>

      {editing && (
        <NotificationRuleModal
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          rule={editing.rule}
          isNew={editing.isNew}
          onSave={saveRule}
        />
      )}
    </div>
  )
}
