'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  bulkAddPermissionGroupMembersContract,
  type CreatePermissionGroupBody,
  createPermissionGroupContract,
  deletePermissionGroupContract,
  getUserPermissionConfigContract,
  listOrganizationWorkspacesContract,
  listPermissionGroupMembersContract,
  listPermissionGroupsContract,
  type PermissionGroup,
  type PermissionGroupMember,
  type PermissionGroupWorkspaceRef,
  removePermissionGroupMemberContract,
  type UpdatePermissionGroupBody,
  type UserPermissionConfig,
  updatePermissionGroupContract,
} from '@/lib/api/contracts/permission-groups'
import {
  PERMISSION_GROUP_MEMBERS_STALE_TIME,
  PERMISSION_GROUPS_STALE_TIME,
  permissionGroupKeys,
} from '@/hooks/queries/utils/permission-group-keys'

export type { PermissionGroup, PermissionGroupMember, PermissionGroupWorkspaceRef }

async function fetchUserPermissionConfig(
  workspaceId: string,
  signal?: AbortSignal
): Promise<UserPermissionConfig> {
  return requestJson(getUserPermissionConfigContract, { query: { workspaceId }, signal })
}

/**
 * The permission group governing the viewer in a workspace, with its config.
 * `config: null` means no group applies. Disabled without a workspace.
 */
export function useUserPermissionConfig(workspaceId?: string) {
  return useQuery({
    queryKey: permissionGroupKeys.userConfig(workspaceId),
    queryFn: ({ signal }) => fetchUserPermissionConfig(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: PERMISSION_GROUPS_STALE_TIME,
    retryOnMount: true,
  })
}

async function fetchPermissionGroups(
  organizationId: string,
  signal?: AbortSignal
): Promise<PermissionGroup[]> {
  const data = await requestJson(listPermissionGroupsContract, {
    params: { id: organizationId },
    signal,
  })
  return data.permissionGroups ?? []
}

/** Every permission group of an organization (admin view). */
export function usePermissionGroups(organizationId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: permissionGroupKeys.list(organizationId),
    queryFn: ({ signal }) => fetchPermissionGroups(organizationId as string, signal),
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    staleTime: PERMISSION_GROUPS_STALE_TIME,
  })
}

async function fetchPermissionGroupMembers(
  organizationId: string,
  groupId: string,
  signal?: AbortSignal
): Promise<PermissionGroupMember[]> {
  const data = await requestJson(listPermissionGroupMembersContract, {
    params: { id: organizationId, groupId },
    signal,
  })
  return data.members ?? []
}

/** Explicit members of one permission group. */
export function usePermissionGroupMembers(organizationId?: string, groupId?: string) {
  return useQuery({
    queryKey: permissionGroupKeys.members(organizationId, groupId),
    queryFn: ({ signal }) =>
      fetchPermissionGroupMembers(organizationId as string, groupId as string, signal),
    enabled: Boolean(organizationId && groupId),
    staleTime: PERMISSION_GROUP_MEMBERS_STALE_TIME,
  })
}

async function fetchOrganizationWorkspaces(
  organizationId: string,
  signal?: AbortSignal
): Promise<PermissionGroupWorkspaceRef[]> {
  const data = await requestJson(listOrganizationWorkspacesContract, {
    params: { id: organizationId },
    signal,
  })
  return data.workspaces
}

/** The organization's workspaces, for scoping a group to specific workspaces. */
export function useOrganizationWorkspaces(
  organizationId?: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: permissionGroupKeys.orgWorkspaces(organizationId),
    queryFn: ({ signal }) => fetchOrganizationWorkspaces(organizationId as string, signal),
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    staleTime: PERMISSION_GROUPS_STALE_TIME,
  })
}

/**
 * A group write changes which config governs members, so every cached
 * group list, detail and resolved viewer config under the root key is stale.
 */
function useInvalidatePermissionGroups() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: permissionGroupKeys.all })
}

export function useCreatePermissionGroup() {
  const invalidate = useInvalidatePermissionGroups()
  return useMutation({
    mutationFn: ({
      organizationId,
      body,
    }: {
      organizationId: string
      body: CreatePermissionGroupBody
    }) =>
      requestJson(createPermissionGroupContract, {
        params: { id: organizationId },
        body,
      }),
    onSettled: invalidate,
  })
}

export function useUpdatePermissionGroup() {
  const invalidate = useInvalidatePermissionGroups()
  return useMutation({
    mutationFn: ({
      organizationId,
      groupId,
      body,
    }: {
      organizationId: string
      groupId: string
      body: UpdatePermissionGroupBody
    }) =>
      requestJson(updatePermissionGroupContract, {
        params: { id: organizationId, groupId },
        body,
      }),
    onSettled: invalidate,
  })
}

export function useDeletePermissionGroup() {
  const invalidate = useInvalidatePermissionGroups()
  return useMutation({
    mutationFn: ({ organizationId, groupId }: { organizationId: string; groupId: string }) =>
      requestJson(deletePermissionGroupContract, {
        params: { id: organizationId, groupId },
      }),
    onSettled: invalidate,
  })
}

export function useAddPermissionGroupMembers() {
  const invalidate = useInvalidatePermissionGroups()
  return useMutation({
    mutationFn: ({
      organizationId,
      groupId,
      userIds,
    }: {
      organizationId: string
      groupId: string
      userIds: string[]
    }) =>
      requestJson(bulkAddPermissionGroupMembersContract, {
        params: { id: organizationId, groupId },
        body: { userIds },
      }),
    onSettled: invalidate,
  })
}

export function useRemovePermissionGroupMember() {
  const invalidate = useInvalidatePermissionGroups()
  return useMutation({
    mutationFn: ({
      organizationId,
      groupId,
      memberId,
    }: {
      organizationId: string
      groupId: string
      memberId: string
    }) =>
      requestJson(removePermissionGroupMemberContract, {
        params: { id: organizationId, groupId },
        query: { memberId },
      }),
    onSettled: invalidate,
  })
}
