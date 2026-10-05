import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { generateId, generateShortId } from '@labbai/utils/id'
import type { CrmLink } from '@/lib/api/contracts/crm'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { encryptSecret } from '@/lib/core/security/encryption'
import { crmLinkOperations } from '@/lib/crm/application/operations'
import {
  type BinoraConnectResult,
  BinoraRequestError,
  connectBinoraChannel,
  normalizeBinoraBaseUrl,
} from '@/lib/crm/binora/client'
import { hasEnabledCrmBlock } from '@/lib/crm/deploy-sync'
import {
  type CrmLinkRecord,
  deleteCrmLink,
  getActiveDeploymentBlocks,
  getCrmLinkForWorkflow,
  getWorkspaceWorkflowName,
  replaceCrmLink,
} from '@/lib/crm/repository'
import { scheduleCrmSync } from '@/lib/crm/schedule'
import { binoraCallbackUrl } from '@/lib/crm/urls'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const logger = createLogger('CrmLinks')

/** Length of the random callback key; URL-safe and unguessable. */
const CALLBACK_KEY_LENGTH = 32

/** Every link operation names the workflow whose Binora CRM block it belongs to. */
export interface CrmWorkflowInput {
  workspaceId: string
  workflowId: string
}

async function resolveCrmContext({ input }: { input: CrmWorkflowInput }) {
  return resolveActiveWorkspaceApplicationContext(input.workspaceId)
}

/** The workflow must be one of the workspace's, so a link never mirrors another's chats. */
async function requireWorkflowName(input: CrmWorkflowInput): Promise<string> {
  const name = await getWorkspaceWorkflowName(input.workspaceId, input.workflowId)
  if (name === null) throw new OrchestrationError('not_found', 'Workflow not found')
  return name
}

/** A link as the Binora CRM block sees it. */
export function toCrmLinkView(link: CrmLinkRecord): CrmLink {
  return {
    provider: link.provider,
    status: link.deployed ? 'active' : 'waiting_deploy',
    baseUrl: link.baseUrl,
    channelName: link.remoteChannelName,
    pipelineName: link.remotePipelineName,
    connectedAt: link.connectedAt,
    lastError: link.lastError,
    lastErrorAt: link.lastErrorAt,
    lastDeliveredAt: link.lastDeliveredAt,
  }
}

export const getCrmLinkOperation = defineAuthorizedWorkspaceUseCase({
  operation: crmLinkOperations.getLink,
  resolveContext: (args: { input: CrmWorkflowInput }) => resolveCrmContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    await requireWorkflowName(input)
    const link = await getCrmLinkForWorkflow(input.workspaceId, input.workflowId)
    return { link: link?.connectedAt ? toCrmLinkView(link) : null }
  },
})

export interface ConnectCrmLinkInput extends CrmWorkflowInput {
  baseUrl: string
  secret: string
  backfillHours: number
}

/**
 * Links the workflow to a Binora "AI agent" channel: runs Binora's signed handshake, which proves
 * the key and tells Binora where operator replies go, then stores the address and the encrypted
 * key. A handshake Binora refuses changes nothing, so a mistyped key never breaks a working
 * link. Connecting again (a rotated channel) replaces the link.
 */
export const connectCrmLinkOperation = defineAuthorizedWorkspaceUseCase({
  operation: crmLinkOperations.connectLink,
  resolveContext: (args: { input: ConnectCrmLinkInput }) => resolveCrmContext(args),
  authorizationOptions: {},
  async execute({ principal, input }) {
    const workflowName = await requireWorkflowName(input)
    const baseUrl = normalizeBinoraBaseUrl(input.baseUrl)
    const secret = input.secret.trim()
    const callbackKey = generateShortId(CALLBACK_KEY_LENGTH)

    let remote: BinoraConnectResult
    try {
      remote = await connectBinoraChannel({
        baseUrl,
        secret,
        callbackUrl: binoraCallbackUrl(callbackKey),
        agentName: workflowName,
      })
    } catch (error) {
      const reason =
        error instanceof BinoraRequestError && error.status === 401
          ? 'the key does not match this address'
          : error instanceof BinoraRequestError && error.status === 404
            ? 'no Binora channel has this address'
            : getErrorMessage(error, 'unknown error')
      logger.warn('Binora handshake failed', { workflowId: input.workflowId, reason })
      throw new OrchestrationError('validation', `Binora did not accept the connection: ${reason}`)
    }

    const { encrypted } = await encryptSecret(secret)
    const deployed = hasEnabledCrmBlock(await getActiveDeploymentBlocks(input.workflowId))
    const link = await replaceCrmLink({
      id: generateId(),
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      provider: 'binora',
      baseUrl,
      secretEncrypted: encrypted,
      callbackKey,
      deployed,
      mirrorSince: new Date(Date.now() - input.backfillHours * 60 * 60 * 1000),
      connectedAt: new Date(),
      remoteChannelName: remote.channelName,
      remotePipelineName: remote.pipelineName,
      createdBy: principal.userId,
    })
    scheduleCrmSync(input.workspaceId)
    return { link: toCrmLinkView(link) }
  },
})

/** Unlinks the workflow: its chats stop reaching Binora and Binora's callbacks stop working. */
export const deleteCrmLinkOperation = defineAuthorizedWorkspaceUseCase({
  operation: crmLinkOperations.deleteLink,
  resolveContext: (args: { input: CrmWorkflowInput }) => resolveCrmContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    await requireWorkflowName(input)
    const deleted = await deleteCrmLink(input.workspaceId, input.workflowId)
    if (!deleted) throw new OrchestrationError('not_found', 'This workflow is not linked to a CRM')
    return { success: true as const }
  },
})
