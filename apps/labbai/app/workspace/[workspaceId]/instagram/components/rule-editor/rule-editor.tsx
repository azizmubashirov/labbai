'use client'

import { useState } from 'react'
import {
  Badge,
  Chip,
  ChipConfirmModal,
  ChipModalField,
  ChipSelect,
  ChipSwitch,
  cn,
  toast,
} from '@labbai/emcn'
import { getErrorMessage } from '@labbai/utils/errors'
import { InstagramIcon } from '@/components/icons'
import type {
  InstagramAutoReplyKeywordModeValue,
  InstagramAutoReplyMediaScopeValue,
  InstagramAutoReplyRule,
} from '@/lib/api/contracts/instagram-auto-reply'
import { INSTAGRAM_AUTO_REPLY_RULE_NAME_MAX_LENGTH } from '@/lib/instagram-auto-reply/constants'
import { isStoryTriggerType, supportsPublicReply } from '@/lib/instagram-auto-reply/rule-validation'
import { Resource } from '@/app/workspace/[workspaceId]/components'
import {
  InstagramMediaPicker,
  useInstagramMediaByIds,
} from '@/app/workspace/[workspaceId]/instagram/components/media-picker'
import { PhonePreview } from '@/app/workspace/[workspaceId]/instagram/components/phone-preview/phone-preview'
import { DmButtonsField } from '@/app/workspace/[workspaceId]/instagram/components/rule-editor/dm-buttons-field'
import { EditorStep } from '@/app/workspace/[workspaceId]/instagram/components/rule-editor/editor-step'
import { KeywordField } from '@/app/workspace/[workspaceId]/instagram/components/rule-editor/keyword-field'
import { ReplyVariantsField } from '@/app/workspace/[workspaceId]/instagram/components/rule-editor/reply-variants-field'
import { RuleStatusBadge } from '@/app/workspace/[workspaceId]/instagram/components/rule-status-badge'
import type { InstagramPreviewTab } from '@/app/workspace/[workspaceId]/instagram/search-params'
import {
  dmTextLimit,
  draftFromRule,
  getFormatErrors,
  getGoLiveErrors,
  getSaveErrors,
  type InstagramAccountOption,
  isHttpsUrl,
  isSameDraft,
  newRuleDraft,
  previewPublicReply,
  type RuleDraft,
  type RuleDraftErrors,
  sampleCommentFor,
  toRuleBody,
} from '@/app/workspace/[workspaceId]/instagram/utils'
import {
  useCreateInstagramAutoReplyRule,
  useSetInstagramAutoReplyRuleStatus,
  useUpdateInstagramAutoReplyRule,
} from '@/hooks/queries/instagram-auto-reply'

const MEDIA_SCOPE_OPTIONS = [
  { value: 'specific', label: 'Specific posts' },
  { value: 'any', label: 'Any post' },
  { value: 'next', label: 'Next post' },
] as const satisfies readonly { value: InstagramAutoReplyMediaScopeValue; label: string }[]

const KEYWORD_MODE_OPTIONS = [
  { value: 'include', label: 'These words' },
  { value: 'exclude', label: 'Not these words' },
  { value: 'any', label: 'Any comment' },
] as const satisfies readonly { value: InstagramAutoReplyKeywordModeValue; label: string }[]

/** Which check a save attempt ran; its errors stay shown until the next successful save. */
type SubmitIntent = 'draft' | 'live'

type PendingAction = 'save' | 'live' | 'pause' | null

export interface RuleEditorProps {
  workspaceId: string
  /** The saved rule, or null for a new one. */
  rule: InstagramAutoReplyRule | null
  accounts: readonly InstagramAccountOption[]
  accountsLoading: boolean
  canEdit: boolean
  previewTab: InstagramPreviewTab
  onPreviewTabChange: (tab: InstagramPreviewTab) => void
  onClose: () => void
  /** A new rule was saved; the page switches to editing it. */
  onCreated: (rule: InstagramAutoReplyRule) => void
}

/**
 * The ManyChat-style rule editor: numbered steps on the left, a live phone preview on the right
 * (stacked on narrow screens), and Save draft / Go live (or Pause / Update) in the footer.
 *
 * The form is a local draft seeded from the rule. Length and link problems show while typing;
 * missing pieces show after a save attempt, using the same completeness check the server runs
 * before a rule goes live. Server refusals surface their message in the footer.
 */
export function RuleEditor({
  workspaceId,
  rule,
  accounts,
  accountsLoading,
  canEdit,
  previewTab,
  onPreviewTabChange,
  onClose,
  onCreated,
}: RuleEditorProps) {
  const createRule = useCreateInstagramAutoReplyRule(workspaceId)
  const updateRule = useUpdateInstagramAutoReplyRule(workspaceId)
  const setStatus = useSetInstagramAutoReplyRuleStatus(workspaceId)

  const [storedDraft, setDraft] = useState<RuleDraft>(() =>
    rule ? draftFromRule(rule) : newRuleDraft()
  )
  const [submitted, setSubmitted] = useState<SubmitIntent | null>(null)
  const [footerError, setFooterError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  /** A workspace with exactly one account preselects it, without a sync effect. */
  const fallbackCredentialId = accounts.length === 1 ? accounts[0].id : ''
  const draft: RuleDraft =
    storedDraft.credentialId || !fallbackCredentialId
      ? storedDraft
      : { ...storedDraft, credentialId: fallbackCredentialId }

  const baseline = rule ? draftFromRule(rule) : null
  const isDirty = baseline ? !isSameDraft(draft, baseline) : true
  const status = rule?.status ?? 'draft'
  const readOnly = !canEdit || pending !== null

  const errors: RuleDraftErrors =
    submitted === 'live'
      ? getGoLiveErrors(draft)
      : submitted === 'draft'
        ? getSaveErrors(draft)
        : getFormatErrors(draft)

  const firstMediaId = draft.mediaScope === 'specific' ? draft.mediaIds[0] : undefined
  const { items: previewMedia } = useInstagramMediaByIds({
    credentialId: draft.credentialId || null,
    workspaceId,
    mediaIds: firstMediaId ? [firstMediaId] : [],
    enabled: Boolean(firstMediaId),
  })
  const accountName =
    accounts.find((account) => account.id === draft.credentialId)?.name ?? 'your_account'

  function update<K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setFooterError(null)
  }

  /** Saves the draft's content; creates the rule when it is new. Returns the saved rule. */
  async function persist(): Promise<{ saved: InstagramAutoReplyRule; created: boolean }> {
    const body = toRuleBody(draft)
    if (!rule) return { saved: await createRule.mutateAsync(body), created: true }
    if (!isDirty) return { saved: rule, created: false }
    const saved = await updateRule.mutateAsync({ ruleId: rule.id, body })
    setDraft(draftFromRule(saved))
    return { saved, created: false }
  }

  async function run(
    action: Exclude<PendingAction, null>,
    intent: SubmitIntent | null,
    task: () => Promise<void>
  ) {
    if (intent) {
      setSubmitted(intent)
      const found = intent === 'live' ? getGoLiveErrors(draft) : getSaveErrors(draft)
      if (Object.keys(found).length > 0) {
        setFooterError('Fix the highlighted fields first.')
        return
      }
    }
    setFooterError(null)
    setPending(action)
    try {
      await task()
      setSubmitted(null)
    } catch (error) {
      setFooterError(getErrorMessage(error, 'Could not save this auto-reply.'))
    } finally {
      setPending(null)
    }
  }

  const handleSave = () =>
    run('save', status === 'live' ? 'live' : 'draft', async () => {
      const { saved, created } = await persist()
      toast.success(status === 'live' ? 'Auto-reply updated' : 'Draft saved')
      if (created) onCreated(saved)
    })

  const handleGoLive = () =>
    run('live', 'live', async () => {
      const { saved, created } = await persist()
      try {
        await setStatus.mutateAsync({ ruleId: saved.id, status: 'live' })
      } catch (error) {
        if (!created) throw error
        toast.error(getErrorMessage(error, 'Saved as a draft, but it could not go live.'))
        onCreated(saved)
        return
      }
      toast.success('Auto-reply is live')
      if (created) onCreated(saved)
    })

  const handlePause = () =>
    run('pause', null, async () => {
      if (!rule) return
      await setStatus.mutateAsync({ ruleId: rule.id, status: 'paused' })
      toast.success('Auto-reply paused')
    })

  function requestClose() {
    if (rule ? isDirty : !isSameDraft(draft, newRuleDraft())) setConfirmDiscard(true)
    else onClose()
  }

  const showPublicReplyStep = supportsPublicReply(draft.triggerType)
  const dmLimit = dmTextLimit(draft.dmButtons.length)
  const dmLength = draft.dmText.trim().length
  let stepIndex = 0
  const nextStep = () => {
    stepIndex += 1
    return stepIndex
  }

  return (
    <Resource>
      <Resource.Header
        breadcrumbs={[
          { label: 'Instagram Auto-Reply', icon: InstagramIcon, onClick: requestClose },
          { label: rule?.name || 'New auto-reply', terminal: true },
        ]}
        aside={rule ? <RuleStatusBadge status={rule.status} /> : <Badge variant='gray'>New</Badge>}
      />

      <div className='flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden'>
        <div className='px-4 py-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto'>
          <form
            aria-label='Auto-reply settings'
            className='mx-auto flex w-full max-w-[640px] flex-col gap-4'
            onSubmit={(event) => event.preventDefault()}
          >
            <ChipModalField
              type='input'
              title='Name'
              value={draft.name}
              onChange={(value) => update('name', value)}
              placeholder='e.g. Price in DM'
              maxLength={INSTAGRAM_AUTO_REPLY_RULE_NAME_MAX_LENGTH}
              autoComplete='off'
              disabled={readOnly}
              error={errors.name}
              required
              flush
            />

            <EditorStep index={nextStep()} title='Instagram account' error={errors.credentialId}>
              <ChipSelect
                options={accounts.map((account) => ({ value: account.id, label: account.name }))}
                value={draft.credentialId || undefined}
                onChange={(value) => update('credentialId', value)}
                placeholder={accountsLoading ? 'Loading accounts…' : 'Choose an account'}
                disabled={readOnly || accounts.length === 0}
                aria-label='Instagram account'
                aria-invalid={Boolean(errors.credentialId) || undefined}
                fullWidth
                dropdownWidth='trigger'
              />
              {!accountsLoading && accounts.length === 0 && (
                <p className='text-[var(--text-muted)] text-caption'>
                  No Instagram account is connected. Connect one with an Instagram block in the
                  workflow builder.
                </p>
              )}
            </EditorStep>

            <EditorStep
              index={nextStep()}
              title='When someone comments on'
              error={errors.mediaIds ?? errors.mediaScope}
            >
              <ChipSwitch
                options={MEDIA_SCOPE_OPTIONS.map((option) => ({
                  ...option,
                  disabled: option.value === 'next' && isStoryTriggerType(draft.triggerType),
                }))}
                value={draft.mediaScope}
                onChange={(value) => update('mediaScope', value)}
                disabled={readOnly}
                aria-label='Which posts'
              />
              {draft.mediaScope === 'specific' &&
                (draft.credentialId ? (
                  <InstagramMediaPicker
                    credentialId={draft.credentialId}
                    workspaceId={workspaceId}
                    selectedIds={draft.mediaIds}
                    onChange={(ids) => update('mediaIds', ids)}
                  />
                ) : (
                  <p className='text-[var(--text-muted)] text-caption'>
                    Choose an account to see its posts.
                  </p>
                ))}
              {draft.mediaScope === 'next' && (
                <p className='text-[var(--text-muted)] text-caption'>
                  Applies to the first post or Reel you publish after going live.
                </p>
              )}
            </EditorStep>

            <EditorStep index={nextStep()} title='And the comment has' error={errors.keywords}>
              <ChipSwitch
                options={KEYWORD_MODE_OPTIONS}
                value={draft.keywordMode}
                onChange={(value) => update('keywordMode', value)}
                disabled={readOnly}
                aria-label='Keyword match'
              />
              {draft.keywordMode !== 'any' && (
                <KeywordField
                  keywords={draft.keywords}
                  onChange={(keywords) => update('keywords', keywords)}
                  disabled={readOnly}
                  invalid={Boolean(errors.keywords)}
                />
              )}
            </EditorStep>

            {showPublicReplyStep && (
              <EditorStep
                index={nextStep()}
                title='Reply publicly'
                toggle={{
                  value: draft.publicReplyEnabled,
                  onChange: (value) => update('publicReplyEnabled', value),
                  disabled: readOnly,
                }}
                error={errors.publicReplies}
              >
                <ReplyVariantsField
                  replies={draft.publicReplies}
                  onChange={(replies) => update('publicReplies', replies)}
                  errors={errors}
                  disabled={readOnly}
                />
              </EditorStep>
            )}

            <EditorStep
              index={nextStep()}
              title='Send a DM'
              toggle={{
                value: draft.dmEnabled,
                onChange: (value) => update('dmEnabled', value),
                disabled: readOnly,
              }}
              error={errors.dmEnabled}
            >
              <ChipModalField
                type='textarea'
                title='Message'
                titleActions={
                  <span
                    aria-label='DM length'
                    className={cn(
                      'text-caption tabular-nums',
                      dmLength > dmLimit ? 'text-[var(--text-error)]' : 'text-[var(--text-muted)]'
                    )}
                  >
                    {dmLength} / {dmLimit}
                  </span>
                }
                value={draft.dmText}
                onChange={(value) => update('dmText', value)}
                placeholder='Here is the link you asked for'
                rows={4}
                disabled={readOnly}
                error={errors.dmText}
                flush
              />
              <ChipModalField type='custom' title='Buttons' flush>
                <DmButtonsField
                  buttons={draft.dmButtons}
                  onChange={(buttons) => update('dmButtons', buttons)}
                  errors={errors}
                  disabled={readOnly}
                />
              </ChipModalField>
              <ChipModalField
                type='input'
                inputType='url'
                title='Image link'
                value={draft.dmImageUrl}
                onChange={(value) => update('dmImageUrl', value)}
                placeholder='https://'
                disabled={readOnly}
                error={errors.dmImageUrl}
                flush
              />
            </EditorStep>

            <EditorStep
              index={nextStep()}
              title='Hand off to agent'
              description='Matching comments go to your Instagram comment workflows, and your agent replies instead.'
              toggle={{
                value: draft.handoffToAgent,
                onChange: (value) => update('handoffToAgent', value),
                disabled: readOnly,
              }}
            />

            <EditorStep
              index={nextStep()}
              title='Once per user per post'
              toggle={{
                value: draft.oncePerUserPerPost,
                onChange: (value) => update('oncePerUserPerPost', value),
                disabled: readOnly,
              }}
            />
          </form>
        </div>

        <aside
          aria-label='Preview'
          className='flex shrink-0 justify-center border-[var(--border)] border-t px-4 py-6 lg:w-[380px] lg:overflow-y-auto lg:border-t-0 lg:border-l'
        >
          <PhonePreview
            tab={previewTab}
            onTabChange={onPreviewTabChange}
            accountName={accountName}
            mediaScope={draft.mediaScope}
            postThumbnailUrl={previewMedia[0]?.thumbnailUrl ?? null}
            comment={sampleCommentFor(draft)}
            publicReply={previewPublicReply(draft)}
            handoffToAgent={draft.handoffToAgent}
            dm={
              draft.dmEnabled
                ? {
                    text: draft.dmText.trim(),
                    buttons: draft.dmButtons,
                    imageUrl: isHttpsUrl(draft.dmImageUrl.trim()) ? draft.dmImageUrl.trim() : null,
                  }
                : null
            }
          />
        </aside>
      </div>

      <footer className='flex flex-wrap items-center gap-2 border-[var(--border)] border-t px-4 py-2'>
        <p role='alert' className='min-w-0 flex-1 text-[var(--text-error)] text-caption'>
          {footerError}
        </p>
        {status === 'live' ? (
          <>
            <Chip variant='outline' onClick={handlePause} disabled={readOnly}>
              {pending === 'pause' ? 'Pausing…' : 'Pause'}
            </Chip>
            <Chip variant='primary' onClick={handleSave} disabled={readOnly || !isDirty}>
              {pending === 'save' ? 'Updating…' : 'Update'}
            </Chip>
          </>
        ) : (
          <>
            <Chip variant='outline' onClick={handleSave} disabled={readOnly || !isDirty}>
              {pending === 'save' ? 'Saving…' : status === 'paused' ? 'Save' : 'Save draft'}
            </Chip>
            <Chip variant='primary' onClick={handleGoLive} disabled={readOnly}>
              {pending === 'live' ? 'Going live…' : 'Go live'}
            </Chip>
          </>
        )}
      </footer>

      <ChipConfirmModal
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title='Discard changes?'
        text='Your unsaved edits to this auto-reply will be lost.'
        dismissLabel='Keep editing'
        confirm={{
          label: 'Discard',
          onClick: () => {
            setConfirmDiscard(false)
            onClose()
          },
        }}
      />
    </Resource>
  )
}
