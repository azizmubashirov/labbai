import { AuditAction, AuditResourceType, recordAudit } from '@labbai/audit'
import { db } from '@labbai/db'
import {
  type ScimConnectionSettings,
  scimConnection,
  scimCredential,
  scimGroup,
  scimRequestLog,
  scimUser,
} from '@labbai/db/schema'
import { generateId } from '@labbai/utils/id'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import type {
  ScimActivityEntry,
  ScimConnectionSettingsInput,
  ScimConnectionView,
  ScimCredentialView,
} from '@/lib/api/contracts/organization-scim'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { scimAdminOperations } from '@/lib/labbai/scim/application/admin/operations'
import { scimBaseUrl } from '@/lib/labbai/scim/base-url'
import { type ReconcileCounts, reconcileScimUsers } from '@/lib/labbai/scim/projection/grants'
import {
  DEFAULT_SCIM_CONNECTION_SETTINGS,
  effectiveScimSettings,
  findScimConnectionByOrganization,
  type ScimConnectionRow,
} from '@/lib/labbai/scim/repository/connections'

/** Renders a credential row for the settings surface; the token digest never leaves the server. */
export function toCredentialView(row: typeof scimCredential.$inferSelect): ScimCredentialView {
  return {
    id: row.id,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Builds the settings view of a connection, with its live credentials and counts. */
export async function buildConnectionView(
  connection: ScimConnectionRow,
  executor: DbOrTx = db
): Promise<ScimConnectionView> {
  const [credentials, [users], [groups]] = await Promise.all([
    executor
      .select()
      .from(scimCredential)
      .where(and(eq(scimCredential.connectionId, connection.id), isNull(scimCredential.revokedAt)))
      .orderBy(desc(scimCredential.createdAt)),
    executor
      .select({ total: count() })
      .from(scimUser)
      .where(eq(scimUser.connectionId, connection.id)),
    executor
      .select({ total: count() })
      .from(scimGroup)
      .where(eq(scimGroup.connectionId, connection.id)),
  ])
  return {
    id: connection.id,
    status: connection.status === 'disabled' ? 'disabled' : 'active',
    baseUrl: scimBaseUrl(),
    settings: effectiveScimSettings(connection.settings),
    lastRequestAt: connection.lastRequestAt?.toISOString() ?? null,
    reconciledAt: connection.reconciledAt?.toISOString() ?? null,
    createdAt: connection.createdAt.toISOString(),
    credentials: credentials.map(toCredentialView),
    userCount: Number(users?.total ?? 0),
    groupCount: Number(groups?.total ?? 0),
  }
}

/** The organization's connection, creating it with default settings when absent. */
export async function ensureScimConnection(
  tx: DbOrTx,
  organizationId: string,
  createdBy: string
): Promise<{ connection: ScimConnectionRow; created: boolean }> {
  const existing = await findScimConnectionByOrganization(organizationId, tx)
  if (existing) return { connection: existing, created: false }
  const now = new Date()
  const [inserted] = await tx
    .insert(scimConnection)
    .values({
      id: generateId(),
      organizationId,
      status: 'active',
      settings: DEFAULT_SCIM_CONNECTION_SETTINGS,
      createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: scimConnection.organizationId })
    .returning()
  if (inserted) return { connection: inserted, created: true }
  const raced = await findScimConnectionByOrganization(organizationId, tx)
  if (!raced) throw new Error('SCIM connection vanished during creation')
  return { connection: raced, created: false }
}

/** The organization's connection, or a `not_found` failure. */
export async function requireScimConnection(organizationId: string): Promise<ScimConnectionRow> {
  const connection = await findScimConnectionByOrganization(organizationId)
  if (!connection) {
    throw new OrchestrationError(
      'not_found',
      'SCIM provisioning is not set up for this organization'
    )
  }
  return connection
}

export const getScimConnection = defineAuthorizedOrganizationUseCase({
  operation: scimAdminOperations.getConnection,
  async execute({
    input,
  }: {
    input: { organizationId: string }
  }): Promise<{ connection: ScimConnectionView | null }> {
    const connection = await findScimConnectionByOrganization(input.organizationId)
    return { connection: connection ? await buildConnectionView(connection) : null }
  },
})

interface ConfigureScimConnectionInput {
  organizationId: string
  status?: 'active' | 'disabled'
  settings?: ScimConnectionSettingsInput
}

export const configureScimConnection = defineAuthorizedOrganizationUseCase({
  operation: scimAdminOperations.configureConnection,
  async execute({
    input: typedInput,
    context,
    request,
  }: OrganizationUseCaseContext<ConfigureScimConnectionInput>): Promise<{
    connection: ScimConnectionView
  }> {
    const { connection, created, previousStatus, settingsChanged } = await db.transaction(
      async (tx) => {
        const ensured = await ensureScimConnection(tx, typedInput.organizationId, context.userId)
        const current = ensured.connection
        const nextSettings: ScimConnectionSettings = {
          ...effectiveScimSettings(current.settings),
          ...(typedInput.settings ?? {}),
        }
        const changed =
          typedInput.settings !== undefined &&
          JSON.stringify(nextSettings) !== JSON.stringify(effectiveScimSettings(current.settings))
        const [updated] = await tx
          .update(scimConnection)
          .set({
            ...(typedInput.status ? { status: typedInput.status } : {}),
            settings: nextSettings,
            updatedAt: new Date(),
          })
          .where(eq(scimConnection.id, current.id))
          .returning()
        return {
          connection: updated,
          created: ensured.created,
          previousStatus: ensured.created ? null : current.status,
          settingsChanged: changed,
        }
      }
    )

    const base = {
      actorId: context.userId,
      resourceType: AuditResourceType.SCIM_CONNECTION,
      resourceId: connection.id,
      metadata: { organizationId: typedInput.organizationId },
      ...(request ? { request } : {}),
    }
    if (created || previousStatus !== connection.status) {
      recordAudit({
        ...base,
        action:
          connection.status === 'active'
            ? AuditAction.SCIM_CONNECTION_ENABLED
            : AuditAction.SCIM_CONNECTION_DISABLED,
        description:
          connection.status === 'active'
            ? 'Enabled SCIM provisioning'
            : 'Disabled SCIM provisioning',
      })
    }
    if (settingsChanged) {
      recordAudit({
        ...base,
        action: AuditAction.SCIM_CONNECTION_SETTINGS_UPDATED,
        description: 'Updated SCIM provisioning settings',
        metadata: { organizationId: typedInput.organizationId, settings: connection.settings },
      })
    }
    return { connection: await buildConnectionView(connection) }
  },
})

export const listScimActivity = defineAuthorizedOrganizationUseCase({
  operation: scimAdminOperations.listActivity,
  async execute({
    input,
  }: {
    input: { organizationId: string; limit?: number }
  }): Promise<{ entries: ScimActivityEntry[] }> {
    const connection = await findScimConnectionByOrganization(input.organizationId)
    if (!connection) return { entries: [] }
    const rows = await db
      .select()
      .from(scimRequestLog)
      .where(eq(scimRequestLog.connectionId, connection.id))
      .orderBy(desc(scimRequestLog.createdAt))
      .limit(input.limit ?? 50)
    return {
      entries: rows.map((row) => ({
        id: row.id,
        method: row.method,
        path: row.path,
        status: row.status,
        scimType: row.scimType,
        detail: row.detail,
        userAgent: row.userAgent,
        durationMs: row.durationMs,
        createdAt: row.createdAt.toISOString(),
      })),
    }
  },
})

/** Re-applies every mapping to every user of a connection and stamps the pass. */
export async function reconcileConnection(connection: ScimConnectionRow): Promise<ReconcileCounts> {
  const counts = await reconcileScimUsers(connection)
  await db
    .update(scimConnection)
    .set({ reconciledAt: new Date() })
    .where(eq(scimConnection.id, connection.id))
  return counts
}

export const reconcileScimConnection = defineAuthorizedOrganizationUseCase({
  operation: scimAdminOperations.reconcile,
  async execute({ input }: { input: { organizationId: string } }): Promise<ReconcileCounts> {
    return reconcileConnection(await requireScimConnection(input.organizationId))
  },
})
