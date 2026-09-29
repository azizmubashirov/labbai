import { AuditAction, AuditResourceType } from '@labbai/audit'
import type { ScimConnectionPrincipal } from '@labbai/auth/principal'
import { db } from '@labbai/db'
import {
  foldedEmail,
  member,
  type ScimUserAttributes,
  scimUser,
  scimUserTombstone,
  user,
} from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { generateId } from '@labbai/utils/id'
import { normalizeEmail } from '@labbai/utils/string'
import { and, eq } from 'drizzle-orm'
import type { ScimPatchOperation } from '@/lib/api/contracts/scim'
import {
  invalidateMembershipCache,
  invalidateSecurityPolicyVersionCache,
} from '@/lib/auth/security-policy'
import { ensureUserStatsExists } from '@/lib/billing/core/usage'
import {
  ensureUserInOrganizationTx,
  removeUserFromOrganization,
} from '@/lib/billing/organizations/membership'
import type { DbOrTx } from '@/lib/db/types'
import { recordScimAudit } from '@/lib/labbai/scim/application/audit'
import { defineScimUseCase, scimOperations } from '@/lib/labbai/scim/application/operations'
import { scimBaseUrl } from '@/lib/labbai/scim/base-url'
import { endDirectoryMembershipTx } from '@/lib/labbai/scim/identity/end-directory-membership'
import { accountNameOf, primaryEmailOf } from '@/lib/labbai/scim/protocol/canonical'
import { notFound, ScimError } from '@/lib/labbai/scim/protocol/errors'
import { parseScimFilter } from '@/lib/labbai/scim/protocol/filter'
import {
  normalizePagination,
  projectionIncludes,
  renderUserResource,
  type ScimAttributeProjection,
  type ScimUserResource,
} from '@/lib/labbai/scim/protocol/resources'
import { applyUserPatch } from '@/lib/labbai/scim/protocol/user-patch'
import { nextScimOrderKey } from '@/lib/labbai/scim/repository/order-key'
import {
  findScimUser,
  findScimUserByAccount,
  findScimUserByExternalId,
  findScimUserByUserName,
  groupsForScimUsers,
  listScimUsersPage,
  type ScimUserRow,
} from '@/lib/labbai/scim/repository/users'
import { suspendMemberTx, unsuspendMemberTx } from '@/lib/organizations/members/lifecycle'

const logger = createLogger('ScimUsers')

/**
 * The User resource: provisioning links an external identity to a Labbai
 * account and makes it an organization member; deactivation suspends the
 * account (reversibly, keeping everything it owns); deletion ends the
 * organization membership.
 */

async function renderOne(
  row: ScimUserRow,
  projection?: ScimAttributeProjection,
  executor: DbOrTx = db
): Promise<ScimUserResource> {
  const groups = projectionIncludes(projection, 'groups')
    ? ((await groupsForScimUsers([row.id], executor)).get(row.id) ?? [])
    : []
  return renderUserResource(row, groups, scimBaseUrl(), projection)
}

async function requireScimUser(
  principal: ScimConnectionPrincipal,
  scimUserId: string,
  executor: DbOrTx = db
): Promise<ScimUserRow> {
  const row = await findScimUser(principal.connectionId, scimUserId, executor)
  if (!row) throw notFound(`User ${scimUserId} not found`)
  return row
}

/** Refuses a `userName` or `externalId` another User of the connection already holds. */
async function assertUnique(
  principal: ScimConnectionPrincipal,
  attributes: ScimUserAttributes,
  exceptId: string | null,
  executor: DbOrTx
): Promise<void> {
  const byName = await findScimUserByUserName(principal.connectionId, attributes.userName, executor)
  if (byName && byName.id !== exceptId) {
    throw new ScimError(409, 'uniqueness', `A user with userName ${attributes.userName} exists`)
  }
  if (attributes.externalId) {
    const byExternal = await findScimUserByExternalId(
      principal.connectionId,
      attributes.externalId,
      executor
    )
    if (byExternal && byExternal.id !== exceptId) {
      throw new ScimError(409, 'uniqueness', 'A user with this externalId exists')
    }
  }
}

/**
 * Finds the account an identity names: a tombstoned link for the same
 * `externalId` first (a directory that deleted and recreated the person),
 * else the account whose address matches.
 */
async function resolveAccount(
  tx: DbOrTx,
  principal: ScimConnectionPrincipal,
  attributes: ScimUserAttributes
): Promise<{ userId: string | null; tombstoneId: string | null; email: string | null }> {
  const email = primaryEmailOf(attributes)
  if (attributes.externalId) {
    const [tombstone] = await tx
      .select({ id: scimUserTombstone.id, userId: scimUserTombstone.userId })
      .from(scimUserTombstone)
      .where(
        and(
          eq(scimUserTombstone.connectionId, principal.connectionId),
          eq(scimUserTombstone.externalId, attributes.externalId)
        )
      )
      .limit(1)
    if (tombstone) {
      return { userId: tombstone.userId, tombstoneId: tombstone.id, email: email ?? null }
    }
  }
  const candidates = [email, attributes.userName.includes('@') ? attributes.userName : undefined]
    .filter((value): value is string => Boolean(value))
    .map(normalizeEmail)
  for (const candidate of new Set(candidates)) {
    const matches = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(foldedEmail(user.email), candidate))
      .limit(2)
    if (matches.length > 1) {
      throw new ScimError(409, 'uniqueness', 'More than one account uses this email address')
    }
    if (matches[0]) return { userId: matches[0].id, tombstoneId: null, email: candidate }
  }
  return { userId: null, tombstoneId: null, email: email ? normalizeEmail(email) : null }
}

/** Applies an `active` transition to the account's organization standing. */
async function applyActiveState(
  tx: DbOrTx,
  principal: ScimConnectionPrincipal,
  userId: string,
  active: boolean
): Promise<void> {
  if (active) {
    await unsuspendMemberTx(tx, { userId, source: 'scim' })
  } else {
    await suspendMemberTx(tx, { userId, organizationId: principal.organizationId, source: 'scim' })
  }
}

export const provisionScimUser = defineScimUseCase({
  operation: scimOperations.provisionUser,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: ScimConnectionPrincipal
    input: { attributes: ScimUserAttributes }
    request?: Parameters<typeof recordScimAudit>[2]
  }): Promise<{ scimUserId: string; resource: ScimUserResource }> {
    const { attributes } = input
    let createdAccount = false

    const row = await db.transaction(async (tx) => {
      await assertUnique(principal, attributes, null, tx)
      const resolved = await resolveAccount(tx, principal, attributes)
      let userId = resolved.userId

      if (!userId) {
        if (!resolved.email) {
          throw new ScimError(
            400,
            'invalidValue',
            'A new user needs an email address in userName or emails'
          )
        }
        userId = generateId()
        const now = new Date()
        await tx.insert(user).values({
          id: userId,
          name: accountNameOf(attributes),
          email: resolved.email,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        })
        createdAccount = true
      }

      if (await findScimUserByAccount(principal.connectionId, userId, tx)) {
        throw new ScimError(409, 'uniqueness', 'This account is already provisioned')
      }

      const membership = await ensureUserInOrganizationTx(tx, {
        userId,
        organizationId: principal.organizationId,
        role: 'member',
      })
      if (!membership.success) {
        if (membership.failureCode === 'already-in-other-organization') {
          throw new ScimError(
            409,
            'uniqueness',
            'This person already belongs to another organization'
          )
        }
        throw new ScimError(400, 'invalidValue', membership.error ?? 'Could not add the member')
      }

      const now = new Date()
      const [inserted] = await tx
        .insert(scimUser)
        .values({
          id: generateId(),
          connectionId: principal.connectionId,
          userId,
          externalId: attributes.externalId ?? null,
          userName: attributes.userName.toLowerCase(),
          active: attributes.active,
          attributes,
          orderKey: nextScimOrderKey(now),
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      if (resolved.tombstoneId) {
        await tx.delete(scimUserTombstone).where(eq(scimUserTombstone.id, resolved.tombstoneId))
      }
      await applyActiveState(tx, principal, userId, attributes.active)
      return inserted
    })

    if (createdAccount) {
      await ensureUserStatsExists(row.userId).catch((error: unknown) => {
        logger.warn('Failed to initialize stats for a provisioned account', {
          userId: row.userId,
          error,
        })
      })
    }
    invalidateMembershipCache(row.userId)
    invalidateSecurityPolicyVersionCache(principal.organizationId)

    recordScimAudit(
      principal,
      {
        action: AuditAction.SCIM_USER_PROVISIONED,
        resourceType: AuditResourceType.USER,
        resourceId: row.userId,
        resourceName: attributes.userName,
        description: `Provisioned ${attributes.userName} from the identity provider`,
        metadata: { scimUserId: row.id, createdAccount, active: attributes.active },
      },
      request
    )

    return { scimUserId: row.id, resource: await renderOne(row) }
  },
})

export const listScimUsers = defineScimUseCase({
  operation: scimOperations.listUsers,
  async execute({
    principal,
    input,
  }: {
    principal: ScimConnectionPrincipal
    input: {
      filter?: string
      startIndex?: number
      count?: number
      projection: ScimAttributeProjection
    }
  }): Promise<{ resources: ScimUserResource[]; totalResults: number; startIndex: number }> {
    const filter = parseScimFilter(input.filter)
    const page = normalizePagination(input.startIndex, input.count)
    const { rows, total } = await listScimUsersPage(principal.connectionId, filter, page)
    const groups = projectionIncludes(input.projection, 'groups')
      ? await groupsForScimUsers(rows.map((row) => row.id))
      : new Map()
    const baseUrl = scimBaseUrl()
    return {
      resources: rows.map((row) =>
        renderUserResource(row, groups.get(row.id) ?? [], baseUrl, input.projection)
      ),
      totalResults: total,
      startIndex: page.startIndex,
    }
  },
})

export const getScimUser = defineScimUseCase({
  operation: scimOperations.getUser,
  async execute({
    principal,
    input,
  }: {
    principal: ScimConnectionPrincipal
    input: { scimUserId: string; projection: ScimAttributeProjection }
  }): Promise<ScimUserResource> {
    const row = await requireScimUser(principal, input.scimUserId)
    return renderOne(row, input.projection)
  },
})

/** Writes a new canonical state for a User and applies what changed. */
async function writeUser(
  principal: ScimConnectionPrincipal,
  scimUserId: string,
  next: (current: ScimUserAttributes) => ScimUserAttributes,
  request: Parameters<typeof recordScimAudit>[2]
): Promise<{ resource: ScimUserResource }> {
  const { row, previous } = await db.transaction(async (tx) => {
    const current = await requireScimUser(principal, scimUserId, tx)
    const attributes = next(current.attributes)
    await assertUnique(principal, attributes, current.id, tx)
    const [updated] = await tx
      .update(scimUser)
      .set({
        userName: attributes.userName.toLowerCase(),
        externalId: attributes.externalId ?? null,
        active: attributes.active,
        attributes,
        updatedAt: new Date(),
      })
      .where(eq(scimUser.id, current.id))
      .returning()
    if (current.active !== attributes.active) {
      await applyActiveState(tx, principal, current.userId, attributes.active)
    }
    const name = accountNameOf(attributes)
    if (name !== accountNameOf(current.attributes)) {
      await tx.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, current.userId))
    }
    return { row: updated, previous: current }
  })

  if (previous.active !== row.active) invalidateMembershipCache(row.userId)

  const action =
    previous.active === row.active
      ? AuditAction.SCIM_USER_UPDATED
      : row.active
        ? AuditAction.SCIM_USER_REACTIVATED
        : AuditAction.SCIM_USER_DEACTIVATED
  recordScimAudit(
    principal,
    {
      action,
      resourceType: AuditResourceType.USER,
      resourceId: row.userId,
      resourceName: row.attributes.userName,
      description:
        action === AuditAction.SCIM_USER_DEACTIVATED
          ? `Deactivated ${row.attributes.userName} from the identity provider`
          : action === AuditAction.SCIM_USER_REACTIVATED
            ? `Reactivated ${row.attributes.userName} from the identity provider`
            : `Updated ${row.attributes.userName} from the identity provider`,
      metadata: { scimUserId: row.id },
    },
    request
  )
  return { resource: await renderOne(row) }
}

export const replaceScimUser = defineScimUseCase({
  operation: scimOperations.replaceUser,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: ScimConnectionPrincipal
    input: { scimUserId: string; attributes: ScimUserAttributes }
    request?: Parameters<typeof recordScimAudit>[2]
  }): Promise<{ resource: ScimUserResource }> {
    return writeUser(principal, input.scimUserId, () => input.attributes, request)
  },
})

export const patchScimUser = defineScimUseCase({
  operation: scimOperations.patchUser,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: ScimConnectionPrincipal
    input: { scimUserId: string; operations: ScimPatchOperation[] }
    request?: Parameters<typeof recordScimAudit>[2]
  }): Promise<{ resource: ScimUserResource }> {
    return writeUser(
      principal,
      input.scimUserId,
      (current) => applyUserPatch(current, input.operations),
      request
    )
  },
})

export const deprovisionScimUser = defineScimUseCase({
  operation: scimOperations.deprovisionUser,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: ScimConnectionPrincipal
    input: { scimUserId: string }
    request?: Parameters<typeof recordScimAudit>[2]
  }): Promise<Record<string, never>> {
    const row = await requireScimUser(principal, input.scimUserId)

    const [membership] = await db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(
        and(eq(member.organizationId, principal.organizationId), eq(member.userId, row.userId))
      )
      .limit(1)

    if (membership) {
      if (membership.role === 'owner') {
        throw new ScimError(
          409,
          'mutability',
          'The organization owner cannot be deprovisioned. Transfer ownership first.'
        )
      }
      /** Removal ends the directory row too, inside the same transaction. */
      const result = await removeUserFromOrganization({
        userId: row.userId,
        organizationId: principal.organizationId,
        memberId: membership.id,
        revokePersonalApiKeys: true,
        onError: 'throw',
      })
      if (!result.success) {
        throw new ScimError(409, undefined, result.error ?? 'The member could not be removed')
      }
    } else {
      await db.transaction((tx) =>
        endDirectoryMembershipTx(tx, {
          userId: row.userId,
          organizationId: principal.organizationId,
        })
      )
    }

    /** The suspension was organization-level; outside the organization it no longer applies. */
    await unsuspendMemberTx(db, { userId: row.userId, source: 'scim' })
    invalidateMembershipCache(row.userId)

    recordScimAudit(
      principal,
      {
        action: AuditAction.SCIM_USER_DEPROVISIONED,
        resourceType: AuditResourceType.USER,
        resourceId: row.userId,
        resourceName: row.attributes.userName,
        description: `Deprovisioned ${row.attributes.userName} from the identity provider`,
        metadata: { scimUserId: row.id },
      },
      request
    )
    return {}
  },
})
