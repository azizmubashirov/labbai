import { isRecordLike } from '@labbai/utils/object'
import { BINORA_CRM_BLOCK_TYPE } from '@/lib/crm/constants'
import { setWorkflowCrmLinkDeployed } from '@/lib/crm/repository'
import type { DbOrTx } from '@/lib/db/types'

/** Whether a deployed state has an enabled Binora CRM block. */
export function hasEnabledCrmBlock(blocks: Record<string, unknown> | undefined | null): boolean {
  return Object.values(blocks ?? {}).some(
    (block) => isRecordLike(block) && block.type === BINORA_CRM_BLOCK_TYPE && block.enabled !== false
  )
}

/**
 * Makes the workflow's CRM link follow its deployed version, like trigger webhooks and
 * notification rules: mirroring runs while the deployed version has an enabled Binora CRM block,
 * and stops when a redeploy removes or disables it. The link itself (address, secret) stays, so
 * adding the block back and redeploying resumes it. Runs inside the deployment's activation
 * transaction.
 */
export async function syncWorkflowCrmLink(
  tx: DbOrTx,
  params: { workflowId: string; blocks: Record<string, unknown> | undefined | null }
): Promise<void> {
  await setWorkflowCrmLinkDeployed(tx, params.workflowId, hasEnabledCrmBlock(params.blocks))
}

/** Undeploy: the workflow's conversations stop being mirrored. Runs inside the undeploy transaction. */
export async function pauseWorkflowCrmLink(tx: DbOrTx, workflowId: string): Promise<void> {
  await setWorkflowCrmLinkDeployed(tx, workflowId, false)
}
