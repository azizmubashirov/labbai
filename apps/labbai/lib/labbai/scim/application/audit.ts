import { type AuditActionType, type AuditResourceTypeValue, recordAudit } from '@labbai/audit'
import type { ScimConnectionPrincipal } from '@labbai/auth/principal'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'

/**
 * Records an audit entry for a write the identity provider made. The actor is
 * the directory itself, never whoever configured the connection.
 */
export function recordScimAudit(
  principal: ScimConnectionPrincipal,
  entry: {
    action: AuditActionType
    resourceType: AuditResourceTypeValue
    resourceId: string
    resourceName?: string
    description: string
    metadata?: Record<string, unknown>
  },
  request?: OrchestrationRequestContext
): void {
  recordAudit({
    actorId: null,
    actorName: 'SCIM provisioning',
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    ...(entry.resourceName ? { resourceName: entry.resourceName } : {}),
    description: entry.description,
    metadata: {
      organizationId: principal.organizationId,
      scimConnectionId: principal.connectionId,
      scimCredentialId: principal.credentialId,
      ...entry.metadata,
    },
    ...(request ? { request } : {}),
  })
}
