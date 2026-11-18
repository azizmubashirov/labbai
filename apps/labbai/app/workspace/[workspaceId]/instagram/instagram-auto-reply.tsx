'use client'

import { useParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { InstagramAutoReplyRule } from '@/lib/api/contracts/instagram-auto-reply'
import { Resource } from '@/app/workspace/[workspaceId]/components'
import { RuleEditor } from '@/app/workspace/[workspaceId]/instagram/components/rule-editor/rule-editor'
import { RuleList } from '@/app/workspace/[workspaceId]/instagram/components/rule-list/rule-list'
import InstagramAutoReplyLoading from '@/app/workspace/[workspaceId]/instagram/loading'
import {
  instagramAutoReplyParsers,
  instagramAutoReplyUrlKeys,
  NEW_INSTAGRAM_RULE_PARAM,
} from '@/app/workspace/[workspaceId]/instagram/search-params'
import type { InstagramAccountOption } from '@/app/workspace/[workspaceId]/instagram/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  useInstagramAutoReplyRule,
  useInstagramAutoReplyRules,
} from '@/hooks/queries/instagram-auto-reply'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'

/** The OAuth provider id Instagram accounts are connected under. */
const INSTAGRAM_PROVIDER_ID = 'instagram'

/**
 * Instagram Auto-Reply: the rule list, or the editor for the rule named by the `rule` URL param
 * (`new` for a fresh one). All URL state lives here and reaches the list and editor as props.
 */
export function InstagramAutoReply() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { canEdit } = useUserPermissionsContext()
  const [params, setParams] = useQueryStates(instagramAutoReplyParsers, instagramAutoReplyUrlKeys)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setParams({ search: value }, options)
  )

  const {
    data: credentials,
    isLoading: accountsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(INSTAGRAM_PROVIDER_ID, { workspaceId })
  useOAuthReturnRouter()
  useCredentialRefreshTriggers(refetchCredentials, INSTAGRAM_PROVIDER_ID, workspaceId)
  const accounts: InstagramAccountOption[] = (credentials ?? [])
    .filter((credential) => credential.type !== 'service_account')
    .map((credential) => ({ id: credential.id, name: credential.name }))

  const { data: rules = [], isLoading: rulesLoading } = useInstagramAutoReplyRules(workspaceId)

  const isNew = params.rule === NEW_INSTAGRAM_RULE_PARAM
  const openRuleId = params.rule && !isNew ? params.rule : null
  const { data: openRule, isLoading: openRuleLoading } = useInstagramAutoReplyRule(
    workspaceId,
    openRuleId
  )

  const handleOpenRule = (ruleId: string) => setParams({ rule: ruleId }, { history: 'push' })

  const closeEditor = () => setParams({ rule: null, preview: null }, { history: 'replace' })

  const showCreated = (rule: InstagramAutoReplyRule) =>
    setParams({ rule: rule.id }, { history: 'replace' })

  if (openRuleId && openRuleLoading) {
    return <InstagramAutoReplyLoading />
  }

  if (isNew || openRule) {
    return (
      <RuleEditor
        key={openRule?.id ?? NEW_INSTAGRAM_RULE_PARAM}
        workspaceId={workspaceId}
        rule={isNew ? null : (openRule ?? null)}
        accounts={accounts}
        accountsLoading={accountsLoading}
        canEdit={canEdit}
        previewTab={params.preview}
        onPreviewTabChange={(preview) => setParams({ preview })}
        onClose={closeEditor}
        onCreated={showCreated}
      />
    )
  }

  return (
    <Resource>
      <RuleList
        workspaceId={workspaceId}
        rules={rules}
        isLoading={rulesLoading}
        accounts={accounts}
        canEdit={canEdit}
        search={params.search}
        onSearchChange={setSearch}
        status={params.status}
        onStatusChange={(status) => setParams({ status })}
        onOpen={handleOpenRule}
        onCreate={() => setParams({ rule: NEW_INSTAGRAM_RULE_PARAM }, { history: 'push' })}
      />
    </Resource>
  )
}
