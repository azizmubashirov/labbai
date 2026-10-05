import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ConnectCrmLinkBody,
  type CrmLink,
  connectCrmLinkContract,
  deleteCrmLinkContract,
  getCrmLinkContract,
} from '@/lib/api/contracts/crm'

export const CRM_LINK_STALE_TIME = 30 * 1000
/** While the block is open, the link's delivery status refreshes this often. */
export const CRM_LINK_POLL_INTERVAL_MS = 30 * 1000

export const crmKeys = {
  all: ['crm'] as const,
  links: () => [...crmKeys.all, 'link'] as const,
  link: (workspaceId: string, workflowId: string) =>
    [...crmKeys.links(), workspaceId, workflowId] as const,
}

async function fetchCrmLink(
  workspaceId: string,
  workflowId: string,
  signal?: AbortSignal
): Promise<CrmLink | null> {
  const data = await requestJson(getCrmLinkContract, {
    params: { id: workspaceId, workflowId },
    signal,
  })
  return data.link
}

/**
 * A workflow's CRM link (null when it has none). Needs write on the workspace, so callers pass
 * `enabled: false` for read-only members.
 */
export function useWorkflowCrmLink(
  workspaceId: string,
  workflowId: string,
  options: { enabled: boolean }
) {
  return useQuery({
    queryKey: crmKeys.link(workspaceId, workflowId),
    queryFn: ({ signal }) => fetchCrmLink(workspaceId, workflowId, signal),
    enabled: Boolean(workspaceId && workflowId) && options.enabled,
    staleTime: CRM_LINK_STALE_TIME,
    refetchInterval: CRM_LINK_POLL_INTERVAL_MS,
  })
}

export function useConnectCrmLink(workspaceId: string, workflowId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ConnectCrmLinkBody) =>
      requestJson(connectCrmLinkContract, {
        params: { id: workspaceId, workflowId },
        body,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: crmKeys.link(workspaceId, workflowId) }),
  })
}

export function useDeleteCrmLink(workspaceId: string, workflowId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      requestJson(deleteCrmLinkContract, {
        params: { id: workspaceId, workflowId },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: crmKeys.link(workspaceId, workflowId) }),
  })
}
