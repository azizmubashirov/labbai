import { createLogger } from '@labbai/logger'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  cancelInvitationContract,
  resendInvitationContract,
  updateInvitationContract,
} from '@/lib/api/contracts/invitations'
import {
  createOrganizationContract,
  getMemberRemovalImpactContract,
  getOrganizationRosterContract,
  type OrganizationRoster,
  type RemovalImpactCredential,
  type RosterMember,
  type RosterPendingInvitation,
  type RosterWorkspaceAccess,
  removeOrganizationMemberContract,
  transferOwnershipContract,
  updateOrganizationMemberRoleContract,
} from '@/lib/api/contracts/organization'
import { client } from '@/lib/auth/auth-client'
import { isOrganizationsEnabled } from '@/lib/core/config/env-flags'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'
import { workspaceKeys } from '@/hooks/queries/workspace'

const logger = createLogger('OrganizationQueries')
const invitationListsKey = ['invitations', 'list'] as const

export const ORGANIZATION_ROSTER_STALE_TIME = 30 * 1000
export const ORGANIZATION_LIST_STALE_TIME = 30 * 1000
export const ORGANIZATION_DETAIL_STALE_TIME = 30 * 1000
export const ORGANIZATION_MEMBERS_STALE_TIME = 30 * 1000
/**
 * Zero: removal impact is a consent disclosure, so every dialog open must
 * refetch — a cached list may omit credentials added moments ago, and the
 * dialog holds its confirm on `isFetching` until fresh data lands.
 */
export const ORGANIZATION_REMOVAL_IMPACT_STALE_TIME = 0

export { organizationKeys }

export type { OrganizationRoster, RosterMember, RosterPendingInvitation, RosterWorkspaceAccess }

/** Better Auth owns the authenticated membership-list endpoint. */
export function useOrganizationList() {
  return useQuery({
    queryKey: organizationKeys.lists(),
    queryFn: async ({ signal }) => {
      const response = await client.organization.list({ fetchOptions: { signal } })
      if (response.error) {
        throw new Error(response.error.message || 'Failed to load organizations')
      }
      return response.data ?? []
    },
    enabled: isOrganizationsEnabled,
    staleTime: ORGANIZATION_LIST_STALE_TIME,
  })
}

async function fetchOrganizationRoster(
  orgId: string,
  signal?: AbortSignal
): Promise<OrganizationRoster | null> {
  if (!orgId) return null

  try {
    const payload = await requestJson(getOrganizationRosterContract, {
      params: { id: orgId },
      signal,
    })
    return payload.data
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return null
    }
    throw error
  }
}

export function organizationRosterQueryOptions(orgId: string) {
  return queryOptions({
    queryKey: organizationKeys.roster(orgId),
    queryFn: ({ signal }) => fetchOrganizationRoster(orgId, signal),
    staleTime: ORGANIZATION_ROSTER_STALE_TIME,
  })
}

export function useOrganizationRoster(orgId: string | undefined | null) {
  return useQuery({
    ...organizationRosterQueryOptions(orgId ?? ''),
    enabled: !!orgId,
  })
}

async function fetchMemberRemovalImpact(
  orgId: string,
  userId: string,
  signal?: AbortSignal
): Promise<RemovalImpactCredential[]> {
  const data = await requestJson(getMemberRemovalImpactContract, {
    params: { id: orgId },
    query: { userId },
    signal,
  })
  return data.credentials
}

/**
 * Identity-bound credentials the target user owns in organization workspaces —
 * the set that stops working after removal. Fetched lazily while the
 * remove-member dialog is open.
 */
export function useMemberRemovalImpact(
  orgId: string | undefined | null,
  userId: string | undefined | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: organizationKeys.removalImpact(orgId ?? '', userId ?? ''),
    queryFn: ({ signal }) => fetchMemberRemovalImpact(orgId as string, userId as string, signal),
    enabled: Boolean(orgId) && Boolean(userId) && (options?.enabled ?? true),
    staleTime: ORGANIZATION_REMOVAL_IMPACT_STALE_TIME,
  })
}

/**
 * Fetch a specific organization by ID.
 *
 * `getFullOrganization` defaults to the active organization when no
 * `organizationId` is supplied; passing `orgId` through scopes the result to the
 * requested org so it is cached under the correct `organizationKeys.detail(orgId)`
 * (no cross-org cache collision). The active-org caller passes the active org's
 * id, so its behavior is unchanged.
 */
async function fetchOrganization(orgId: string, signal?: AbortSignal) {
  const response = await client.organization.getFullOrganization({
    query: { organizationId: orgId },
    fetchOptions: { signal },
  })
  if (response.error) {
    throw new Error(response.error.message || 'Failed to load organization')
  }
  return response.data
}

export function organizationDetailQueryOptions(orgId: string) {
  return queryOptions({
    queryKey: organizationKeys.detail(orgId),
    queryFn: ({ signal }) => fetchOrganization(orgId, signal),
    staleTime: ORGANIZATION_DETAIL_STALE_TIME,
  })
}

export function useOrganization(orgId: string) {
  return useQuery({
    ...organizationDetailQueryOptions(orgId),
    enabled: !!orgId,
  })
}

/**
 * Remove member mutation
 */
interface RemoveMemberParams {
  memberId: string
  orgId: string
}

export function useRemoveMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ memberId, orgId }: RemoveMemberParams) => {
      return requestJson(removeOrganizationMemberContract, {
        params: { id: orgId, memberId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.roster(variables.orgId),
      })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all })
      queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.all })
      queryClient.invalidateQueries({ queryKey: invitationListsKey })
    },
  })
}

interface UpdateMemberRoleParams {
  orgId: string
  userId: string
  role: ContractBodyInput<typeof updateOrganizationMemberRoleContract>['role']
}

export function useUpdateOrganizationMemberRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, userId, role }: UpdateMemberRoleParams) => {
      return requestJson(updateOrganizationMemberRoleContract, {
        params: { id: orgId, memberId: userId },
        body: { role },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.roster(variables.orgId),
      })
    },
  })
}

type TransferOwnershipParams = {
  orgId: string
} & ContractBodyInput<typeof transferOwnershipContract>

export function useTransferOwnership() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orgId, newOwnerUserId, alsoLeave = false }: TransferOwnershipParams) => {
      return requestJson(transferOwnershipContract, {
        params: { id: orgId },
        body: { newOwnerUserId, alsoLeave },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.roster(variables.orgId),
      })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
    },
  })
}

type UpdateInvitationParams = {
  orgId: string
  invitationId: string
} & ContractBodyInput<typeof updateInvitationContract>

export function useUpdateInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId, role, grants }: UpdateInvitationParams) => {
      return requestJson(updateInvitationContract, {
        params: { id: invitationId },
        body: { role, grants },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.roster(variables.orgId),
      })
    },
  })
}

/**
 * Revokes an entire pending invitation, including every workspace it grants.
 *
 * Sends no workspace scope, so the route requires authority over all of it —
 * organization admin, or admin of every granted workspace. To withdraw a single
 * workspace's access instead, use `useCancelWorkspaceInvitation`.
 */
interface CancelInvitationParams {
  invitationId: string
  orgId: string
}

export function useCancelInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId }: CancelInvitationParams) => {
      return requestJson(cancelInvitationContract, {
        params: { id: invitationId },
        query: {},
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.roster(variables.orgId),
      })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: invitationListsKey })
    },
  })
}

/**
 * Resend invitation mutation
 */
interface ResendInvitationParams {
  invitationId: string
  orgId: string
}

export function useResendInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId }: ResendInvitationParams) => {
      return requestJson(resendInvitationContract, {
        params: { id: invitationId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: organizationKeys.detail(variables.orgId),
      })
      queryClient.invalidateQueries({
        queryKey: organizationKeys.roster(variables.orgId),
      })
    },
  })
}

/**
 * Create organization mutation
 */
type CreateOrganizationParams = Pick<
  ContractBodyInput<typeof createOrganizationContract>,
  'slug'
> & {
  name: string
}

export function useCreateOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ name, slug }: CreateOrganizationParams) => {
      const data = await requestJson(createOrganizationContract, {
        body: {
          name,
          slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
        },
      })

      await client.organization.setActive({
        organizationId: data.organizationId,
      })

      return data
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
    },
  })
}
