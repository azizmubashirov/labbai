import { createLogger } from '@labbai/logger'
import {
  OUTBOX_PROCESSOR_MAX_RUNTIME_MS,
  OUTBOX_PROCESSOR_RECOVERY_CUTOFF_MS,
} from '@/lib/core/outbox/constants'
import { type ProcessOutboxResult, processOutboxEvents } from '@/lib/core/outbox/service'
import { DeadlineExceededError } from '@/lib/core/utils/deadline'
import { directGrantOutboxHandlers } from '@/lib/invitations/direct-grant'
import { getConnectorFailureDiagnostic } from '@/lib/knowledge/connectors/connector-error'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'
import { recoverKnowledgeDocumentProcessing } from '@/lib/knowledge/documents/processing-recovery'
import { permissionAccessRequestOutboxHandlers } from '@/lib/labbai/access-requests/notifications'
import { organizationResourceCleanupOutboxHandlers } from '@/lib/organizations/resource-cleanup'
import { workspaceFileLiveDocOutboxHandlers } from '@/lib/uploads/contexts/workspace/workspace-file-live-doc-outbox'
import { workspaceFileStorageCleanupOutboxHandlers } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { workflowDeploymentOutboxHandlers } from '@/lib/workflows/deployment-outbox'
import { invitationMigrationOutboxHandlers } from '@/lib/workspaces/admin-move'
import { workspaceOperationOutboxHandlers } from '@/lib/workspaces/operations/outbox'

const logger = createLogger('OutboxProcessor')

const handlers = {
  ...invitationMigrationOutboxHandlers,
  ...directGrantOutboxHandlers,
  ...knowledgeDocumentProcessingOutboxHandlers,
  ...organizationResourceCleanupOutboxHandlers,
  ...permissionAccessRequestOutboxHandlers,
  ...workspaceFileLiveDocOutboxHandlers,
  ...workspaceFileStorageCleanupOutboxHandlers,
  ...workflowDeploymentOutboxHandlers,
  ...workspaceOperationOutboxHandlers,
} as const

export interface OutboxProcessorResult {
  result: ProcessOutboxResult
  recoveredDocuments: number
}

/** Processes one bounded batch and its recovery work in either the worker or self-hosted cron. */
export async function runOutboxProcessor(): Promise<OutboxProcessorResult> {
  const startedAt = Date.now()
  const result = await processOutboxEvents(handlers, {
    batchSize: 500,
    maxRuntimeMs: OUTBOX_PROCESSOR_MAX_RUNTIME_MS,
    minRemainingMs: 95_000,
  })

  let recoveredDocuments = 0
  try {
    if (Date.now() - startedAt < OUTBOX_PROCESSOR_RECOVERY_CUTOFF_MS) {
      recoveredDocuments = await recoverKnowledgeDocumentProcessing()
    }
  } catch (error) {
    logger.error('Stored document recovery failed', {
      error: getConnectorFailureDiagnostic(error) ?? {
        category: error instanceof DeadlineExceededError ? 'deadline' : 'internal',
        message:
          error instanceof DeadlineExceededError
            ? error.message
            : 'Unexpected stored-document recovery failure',
      },
    })
  }

  const output = { result, recoveredDocuments }
  logger.info('Outbox processing completed', {
    ...result,
    recoveredDocuments,
    durationMs: Date.now() - startedAt,
  })
  return output
}
