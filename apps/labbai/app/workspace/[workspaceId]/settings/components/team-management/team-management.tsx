'use client'

import { useEffect, useState } from 'react'
import { Plus } from '@labbai/emcn'
import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { useSession } from '@/lib/auth/auth-client'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { generateSlug, isAdminOrOwner, type Member } from '@/lib/workspaces/organization'
import { InviteModal } from '@/app/workspace/[workspaceId]/components/invite-modal'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  NoOrganizationView,
  OrganizationMemberLists,
  RemoveMemberDialog,
  TransferOwnershipDialog,
} from '@/app/workspace/[workspaceId]/settings/components/team-management/components'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import {
  useCreateOrganization,
  useMemberRemovalImpact,
  useOrganization,
  useOrganizationRoster,
  useRemoveMember,
  useTransferOwnership,
} from '@/hooks/queries/organization'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const logger = createLogger('TeamManagement')

interface TeamManagementProps {
  organizationId: string
  canInviteMembers?: boolean
}

export function TeamManagement({ organizationId, canInviteMembers }: TeamManagementProps) {
  const { data: session } = useSession()
  const { isInvitationsDisabled } = usePermissionConfig()
  const invitationsDisabled =
    canInviteMembers === undefined ? isInvitationsDisabled : !canInviteMembers
  const [memberQuery, setMemberQuery] = useSettingsSearch()

  const {
    data: organization,
    isLoading,
    error: orgError,
    isFetchedAfterMount: isOrganizationFetchedAfterMount,
    isFetching: isOrganizationFetching,
    refetch: refetchOrganization,
  } = useOrganization(organizationId)
  const adminOrOwner = isAdminOrOwner(organization, session?.user?.email)

  const {
    data: roster,
    isLoading: isLoadingRoster,
    error: rosterError,
    isFetchedAfterMount: isRosterFetchedAfterMount,
    isFetching: isRosterFetching,
    refetch: refetchRoster,
  } = useOrganizationRoster(organizationId)

  const removeMemberMutation = useRemoveMember()
  const transferOwnershipMutation = useTransferOwnership()
  const createOrgMutation = useCreateOrganization()

  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false)
  const [removeMemberDialog, setRemoveMemberDialog] = useState<{
    open: boolean
    memberId: string
    memberName: string
    isSelfRemoval?: boolean
    isExternalRemoval?: boolean
  }>({ open: false, memberId: '', memberName: '' })
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')

  /**
   * `isFetching` (not `isLoading`) gates the confirm button: a background
   * refetch of cached data must also hold removal so the admin never
   * confirms against a stale credential-impact list.
   */
  const {
    data: removalImpactCredentials,
    isFetching: isRemovalImpactFetching,
    isError: isRemovalImpactError,
  } = useMemberRemovalImpact(organizationId, removeMemberDialog.memberId, {
    enabled: removeMemberDialog.open,
  })

  const disclosedBreakingCredentials = [
    ...new Set(removalImpactCredentials?.map((credential) => credential.displayName) ?? []),
  ]

  useEffect(() => {
    if (session?.user?.name && !orgName) {
      const defaultName = `${session.user.name}'s Team`
      setOrgName(defaultName)
      setOrgSlug(generateSlug(defaultName))
    }
  }, [session?.user?.name, orgName])

  const handleOrgNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setOrgName(newName)
    setOrgSlug(generateSlug(newName))
  }

  const handleCreateOrganization = async () => {
    if (!session?.user || !orgName.trim()) return

    try {
      await createOrgMutation.mutateAsync({
        name: orgName.trim(),
        slug: orgSlug.trim(),
      })

      setCreateOrgDialogOpen(false)
      setOrgName('')
      setOrgSlug('')
    } catch (error) {
      logger.error('Failed to create organization', error)
    }
  }

  const handleRemoveMember = async (member: Member) => {
    if (!session?.user) return

    if (!member.user?.id) {
      logger.error('Member object missing user ID', { member })
      return
    }

    const isLeavingSelf = member.user?.email === session.user.email
    const displayName = isLeavingSelf
      ? 'yourself'
      : member.user?.name || member.user?.email || 'this member'

    setRemoveMemberDialog({
      open: true,
      memberId: member.user.id,
      memberName: displayName,
      isSelfRemoval: isLeavingSelf,
      isExternalRemoval: member.role === 'external',
    })
  }

  const confirmRemoveMember = async () => {
    const { memberId, isSelfRemoval } = removeMemberDialog
    if (!session?.user || !memberId) return

    try {
      await removeMemberMutation.mutateAsync({
        memberId,
        orgId: organizationId,
      })

      setRemoveMemberDialog({
        open: false,
        memberId: '',
        memberName: '',
        isExternalRemoval: false,
      })

      if (isSelfRemoval) {
        window.location.href = APP_ENTRY_PATH
      }
    } catch (error) {
      logger.error('Failed to remove member', error)
    }
  }

  const handleTransferDialogOpenChange = (next: boolean) => {
    setTransferDialogOpen(next)
    if (!next) {
      transferOwnershipMutation.reset()
    }
  }

  const handleOpenTransferDialog = () => {
    transferOwnershipMutation.reset()
    setTransferDialogOpen(true)
  }

  const handleConfirmTransfer = async (newOwnerUserId: string) => {
    try {
      const result = await transferOwnershipMutation.mutateAsync({
        orgId: organizationId,
        newOwnerUserId,
        alsoLeave: true,
      })

      setTransferDialogOpen(false)

      if (result.left) {
        window.location.href = APP_ENTRY_PATH
      }
    } catch (error) {
      logger.error('Failed to transfer ownership', error)
    }
  }

  const displayOrganization = organization

  if (isLoading && !isOrganizationFetchedAfterMount && !displayOrganization) {
    return null
  }

  if (
    (orgError || (isOrganizationFetching && isOrganizationFetchedAfterMount)) &&
    !displayOrganization
  ) {
    return (
      <SettingsPanel>
        <SettingsQueryErrorState
          error={orgError}
          fallback='Failed to load organization'
          isRetrying={isOrganizationFetching}
          onRetry={() => void refetchOrganization()}
        />
      </SettingsPanel>
    )
  }

  if (!displayOrganization) {
    return (
      <NoOrganizationView
        orgName={orgName}
        orgSlug={orgSlug}
        setOrgSlug={setOrgSlug}
        onOrgNameChange={handleOrgNameChange}
        onCreateOrganization={handleCreateOrganization}
        isCreatingOrg={createOrgMutation.isPending}
        error={
          createOrgMutation.error
            ? getErrorMessage(createOrgMutation.error, 'Failed to create organization')
            : null
        }
        createOrgDialogOpen={createOrgDialogOpen}
        setCreateOrgDialogOpen={setCreateOrgDialogOpen}
      />
    )
  }

  return (
    <>
      <SettingsPanel
        search={{
          value: memberQuery,
          onChange: setMemberQuery,
          placeholder: 'Search members...',
        }}
        actions={
          adminOrOwner
            ? [
                {
                  text: 'Invite',
                  icon: Plus,
                  variant: 'primary',
                  onSelect: () => setInviteModalOpen(true),
                  disabled: invitationsDisabled,
                  tooltip: invitationsDisabled ? 'Invitations are disabled' : undefined,
                },
              ]
            : []
        }
      >
        {isLoadingRoster && !isRosterFetchedAfterMount ? (
          <SettingsEmptyState variant='inline'>Loading members…</SettingsEmptyState>
        ) : (rosterError || (isRosterFetching && isRosterFetchedAfterMount)) &&
          roster === undefined ? (
          <SettingsQueryErrorState
            error={rosterError}
            fallback='Failed to load organization members'
            isRetrying={isRosterFetching}
            onRetry={() => void refetchRoster()}
            variant='inline'
          />
        ) : (
          <OrganizationMemberLists
            canManage={adminOrOwner}
            organizationId={displayOrganization.id}
            roster={roster ?? null}
            isLoadingRoster={false}
            currentUserId={session?.user?.id ?? ''}
            query={memberQuery}
            onRemoveMember={handleRemoveMember}
            onTransferOwnership={handleOpenTransferDialog}
          />
        )}
      </SettingsPanel>

      {adminOrOwner && (
        <InviteModal
          open={inviteModalOpen}
          onOpenChange={setInviteModalOpen}
          organizationId={displayOrganization.id}
          isOrganizationAdmin={adminOrOwner}
          canInvite={adminOrOwner && !invitationsDisabled}
        />
      )}

      <TransferOwnershipDialog
        open={transferDialogOpen}
        onOpenChange={handleTransferDialogOpenChange}
        members={roster?.members ?? []}
        isLoadingMembers={isLoadingRoster}
        currentUserId={session?.user?.id ?? ''}
        isSubmitting={transferOwnershipMutation.isPending}
        error={transferOwnershipMutation.error}
        onConfirm={handleConfirmTransfer}
      />

      <RemoveMemberDialog
        open={removeMemberDialog.open}
        memberName={removeMemberDialog.memberName}
        isSelfRemoval={removeMemberDialog.isSelfRemoval}
        isExternalRemoval={removeMemberDialog.isExternalRemoval}
        breakingCredentials={disclosedBreakingCredentials}
        credentialImpactPending={isRemovalImpactFetching}
        credentialImpactFailed={isRemovalImpactError}
        isSubmitting={removeMemberMutation.isPending}
        error={removeMemberMutation.error}
        onOpenChange={(open: boolean) => {
          if (!open) setRemoveMemberDialog({ ...removeMemberDialog, open: false })
        }}
        onConfirmRemove={confirmRemoveMember}
        onCancel={() =>
          setRemoveMemberDialog({
            open: false,
            memberId: '',
            memberName: '',
            isSelfRemoval: false,
            isExternalRemoval: false,
          })
        }
      />
    </>
  )
}
