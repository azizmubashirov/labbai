import { AuditAction, AuditResourceType, recordAudit } from '@labbai/audit'
import { db } from '@labbai/db'
import { SCIM_SCOPES, scimCredential } from '@labbai/db/schema'
import { generateSecureToken } from '@labbai/security/tokens'
import { generateId } from '@labbai/utils/id'
import { and, count, eq, gt, isNull, or } from 'drizzle-orm'
import type { ScimCredentialView } from '@/lib/api/contracts/organization-scim'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  ensureScimConnection,
  requireScimConnection,
  toCredentialView,
} from '@/lib/labbai/scim/application/admin/connection'
import { scimAdminOperations } from '@/lib/labbai/scim/application/admin/operations'
import { hashScimToken } from '@/lib/labbai/scim/authenticate'
import {
  SCIM_MAX_ACTIVE_CREDENTIALS,
  SCIM_TOKEN_PREFIX,
} from '@/lib/labbai/scim/protocol/constants'

/** Characters of the token shown in the settings list to tell tokens apart. */
const VISIBLE_PREFIX_LENGTH = SCIM_TOKEN_PREFIX.length + 6

export const issueScimCredential = defineAuthorizedOrganizationUseCase({
  operation: scimAdminOperations.issueCredential,
  async execute({
    input,
    context,
    request,
  }: OrganizationUseCaseContext<{ organizationId: string; expiresInDays?: number }>): Promise<{
    secret: string
    credential: ScimCredentialView
  }> {
    const secret = `${SCIM_TOKEN_PREFIX}${generateSecureToken(32)}`
    const row = await db.transaction(async (tx) => {
      const { connection } = await ensureScimConnection(tx, input.organizationId, context.userId)
      const now = new Date()
      const [active] = await tx
        .select({ total: count() })
        .from(scimCredential)
        .where(
          and(
            eq(scimCredential.connectionId, connection.id),
            isNull(scimCredential.revokedAt),
            or(isNull(scimCredential.expiresAt), gt(scimCredential.expiresAt, now))
          )
        )
      if (Number(active?.total ?? 0) >= SCIM_MAX_ACTIVE_CREDENTIALS) {
        throw new OrchestrationError(
          'conflict',
          `At most ${SCIM_MAX_ACTIVE_CREDENTIALS} SCIM tokens can be active. Revoke one first.`
        )
      }
      const [inserted] = await tx
        .insert(scimCredential)
        .values({
          id: generateId(),
          connectionId: connection.id,
          tokenHash: hashScimToken(secret),
          tokenPrefix: secret.slice(0, VISIBLE_PREFIX_LENGTH),
          scopes: [...SCIM_SCOPES],
          expiresAt: input.expiresInDays
            ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
            : null,
          createdBy: context.userId,
          createdAt: now,
        })
        .returning()
      return inserted
    })

    recordAudit({
      actorId: context.userId,
      action: AuditAction.SCIM_CREDENTIAL_ISSUED,
      resourceType: AuditResourceType.SCIM_CONNECTION,
      resourceId: row.connectionId,
      description: `Issued SCIM token ${row.tokenPrefix}…`,
      metadata: {
        organizationId: input.organizationId,
        credentialId: row.id,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      },
      ...(request ? { request } : {}),
    })
    return { secret, credential: toCredentialView(row) }
  },
})

export const revokeScimCredential = defineAuthorizedOrganizationUseCase({
  operation: scimAdminOperations.revokeCredential,
  async execute({
    input,
    context,
    request,
  }: OrganizationUseCaseContext<{ organizationId: string; credentialId: string }>): Promise<{
    success: true
  }> {
    const connection = await requireScimConnection(input.organizationId)
    const [revoked] = await db
      .update(scimCredential)
      .set({ revokedAt: new Date(), revokedBy: context.userId })
      .where(
        and(
          eq(scimCredential.id, input.credentialId),
          eq(scimCredential.connectionId, connection.id),
          isNull(scimCredential.revokedAt)
        )
      )
      .returning()
    if (!revoked) throw new OrchestrationError('not_found', 'SCIM token not found')

    recordAudit({
      actorId: context.userId,
      action: AuditAction.SCIM_CREDENTIAL_REVOKED,
      resourceType: AuditResourceType.SCIM_CONNECTION,
      resourceId: connection.id,
      description: `Revoked SCIM token ${revoked.tokenPrefix}…`,
      metadata: { organizationId: input.organizationId, credentialId: revoked.id },
      ...(request ? { request } : {}),
    })
    return { success: true }
  },
})
