import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  configureScimConnectionContract,
  deleteScimGroupMappingContract,
  getScimConnectionContract,
  issueScimCredentialContract,
  listScimActivityContract,
  listScimGroupMappingsContract,
  reconcileScimConnectionContract,
  revokeScimCredentialContract,
  type ScimConnectionSettingsInput,
  type ScimGroupMappingBody,
  upsertScimGroupMappingContract,
} from '@/lib/api/contracts/organization-scim'
import { listPermissionGroupsContract } from '@/lib/api/contracts/permission-groups'

export const SCIM_CONNECTION_STALE_TIME = 30_000
export const SCIM_MAPPINGS_STALE_TIME = 30_000
export const SCIM_ACTIVITY_STALE_TIME = 15_000
export const SCIM_PERMISSION_GROUP_OPTIONS_STALE_TIME = 60_000

export const scimKeys = {
  all: ['scim'] as const,
  connections: () => [...scimKeys.all, 'connection'] as const,
  connection: (organizationId: string) => [...scimKeys.connections(), organizationId] as const,
  mappingLists: () => [...scimKeys.all, 'mappings'] as const,
  mappings: (organizationId: string) => [...scimKeys.mappingLists(), organizationId] as const,
  activityLists: () => [...scimKeys.all, 'activity'] as const,
  activity: (organizationId: string, limit: number) =>
    [...scimKeys.activityLists(), organizationId, limit] as const,
  permissionGroupOptionLists: () => [...scimKeys.all, 'permission-group-options'] as const,
  permissionGroupOptions: (organizationId: string) =>
    [...scimKeys.permissionGroupOptionLists(), organizationId] as const,
}

/** The organization's SCIM connection, or `null` when provisioning was never set up. */
export function useScimConnection(organizationId: string) {
  return useQuery({
    queryKey: scimKeys.connection(organizationId),
    queryFn: ({ signal }) =>
      requestJson(getScimConnectionContract, { params: { id: organizationId }, signal }),
    enabled: Boolean(organizationId),
    staleTime: SCIM_CONNECTION_STALE_TIME,
  })
}

export function useConfigureScimConnection(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      status?: 'active' | 'disabled'
      settings?: ScimConnectionSettingsInput
    }) => requestJson(configureScimConnectionContract, { params: { id: organizationId }, body }),
    onSuccess: (data) => {
      queryClient.setQueryData(scimKeys.connection(organizationId), data)
    },
  })
}

/** Issues a bearer token. The secret is in the result and nowhere else, ever. */
export function useIssueScimCredential(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { expiresInDays?: number }) =>
      requestJson(issueScimCredentialContract, { params: { id: organizationId }, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scimKeys.connection(organizationId) })
    },
  })
}

export function useRevokeScimCredential(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (credentialId: string) =>
      requestJson(revokeScimCredentialContract, {
        params: { id: organizationId, credentialId },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scimKeys.connection(organizationId) })
    },
  })
}

export function useScimGroupMappings(organizationId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: scimKeys.mappings(organizationId),
    queryFn: ({ signal }) =>
      requestJson(listScimGroupMappingsContract, { params: { id: organizationId }, signal }),
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    staleTime: SCIM_MAPPINGS_STALE_TIME,
  })
}

export function useUpsertScimGroupMapping(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ScimGroupMappingBody) =>
      requestJson(upsertScimGroupMappingContract, { params: { id: organizationId }, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scimKeys.mappings(organizationId) })
    },
  })
}

export function useDeleteScimGroupMapping(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (mappingId: string) =>
      requestJson(deleteScimGroupMappingContract, {
        params: { id: organizationId, mappingId },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scimKeys.mappings(organizationId) })
    },
  })
}

export function useReconcileScimConnection(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      requestJson(reconcileScimConnectionContract, { params: { id: organizationId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scimKeys.connection(organizationId) })
    },
  })
}

export function useScimActivity(
  organizationId: string,
  limit = 25,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: scimKeys.activity(organizationId, limit),
    queryFn: ({ signal }) =>
      requestJson(listScimActivityContract, {
        params: { id: organizationId },
        query: { limit },
        signal,
      }),
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    staleTime: SCIM_ACTIVITY_STALE_TIME,
  })
}

/** Permission groups a directory group can be mapped to, as `{ id, name }` options. */
export function useScimPermissionGroupOptions(
  organizationId: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: scimKeys.permissionGroupOptions(organizationId),
    queryFn: async ({ signal }) => {
      const data = await requestJson(listPermissionGroupsContract, {
        params: { id: organizationId },
        signal,
      })
      return (data.permissionGroups ?? []).map((group) => ({ id: group.id, name: group.name }))
    },
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    staleTime: SCIM_PERMISSION_GROUP_OPTIONS_STALE_TIME,
  })
}
