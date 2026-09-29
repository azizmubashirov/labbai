import { AuditAction, AuditResourceType, recordAudit } from '@labbai/audit'
import { db } from '@labbai/db'
import { member, organization } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { isOrgAdminRole } from '@labbai/platform-authz/workspace'
import { getErrorMessage } from '@labbai/utils/errors'
import { and, eq, or } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createOrganizationBodySchema } from '@/lib/api/contracts/organization'
import { listCreatorOrganizationsContract } from '@/lib/api/contracts/organizations'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { setActiveOrganizationForCurrentSession } from '@/lib/auth/active-organization'
import {
  createOrganizationWithOwner,
  OrganizationSlugInvalidError,
  OrganizationSlugTakenError,
} from '@/lib/billing/organizations/create-organization'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  attachOwnedWorkspacesToOrganization,
  WorkspaceOrganizationMembershipConflictError,
} from '@/lib/workspaces/organization-workspaces'

const logger = createLogger('OrganizationsAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(listCreatorOrganizationsContract, request, {})
    if (!parsed.success) return parsed.response

    const userOrganizations = await db
      .select({
        id: organization.id,
        name: organization.name,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(
        and(
          eq(member.userId, session.user.id),
          or(eq(member.role, 'owner'), eq(member.role, 'admin'))
        )
      )

    const anyMembership = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, session.user.id))
      .limit(1)

    return NextResponse.json({
      organizations: userOrganizations,
      isMemberOfAnyOrg: anyMembership.length > 0,
    })
  } catch (error) {
    logger.error('Failed to fetch organizations', {
      error: getErrorMessage(error, 'Unknown error'),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (request: Request) => {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized - no active session' }, { status: 401 })
    }

    const user = session.user

    let organizationName = user.name
    let organizationSlug: string | undefined

    const rawBody = await request.json().catch(() => ({}))
    const parsedBody = createOrganizationBodySchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(parsedBody.error, 'Invalid request body') },
        { status: 400 }
      )
    }
    if (parsedBody.data.name) {
      organizationName = parsedBody.data.name
    }
    if (parsedBody.data.slug) {
      organizationSlug = parsedBody.data.slug
    }

    const existingOrgMembership = await db
      .select({
        organizationId: member.organizationId,
        role: member.role,
      })
      .from(member)
      .where(eq(member.userId, user.id))
      .limit(1)

    const existingAdminMembership =
      existingOrgMembership.length > 0 && isOrgAdminRole(existingOrgMembership[0].role)
        ? existingOrgMembership[0]
        : null

    if (existingOrgMembership.length > 0 && !existingAdminMembership) {
      return NextResponse.json(
        {
          error:
            'You are already a member of an organization. Leave your current organization before creating a new one.',
        },
        { status: 409 }
      )
    }

    logger.info('Creating organization', {
      userId: user.id,
      organizationName,
      organizationSlug,
      existingOrganizationId: existingAdminMembership?.organizationId ?? null,
    })

    let organizationId: string
    let createdOrganization = false

    if (existingAdminMembership) {
      organizationId = existingAdminMembership.organizationId
    } else {
      createdOrganization = true
      const name = organizationName || `${user.email || 'User'}'s Team`
      const slug =
        organizationSlug ||
        `${user.id}-team-${Date.now()}`
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/g, '-')
          .replace(/^-|-$/g, '')
      const created = await createOrganizationWithOwner({
        ownerUserId: user.id,
        name,
        slug,
      })
      organizationId = created.organizationId
    }

    /**
     * Keeps the default `reject` policy: manual organization creation
     * surfaces a different-org collaborator as an explicit conflict (409
     * with actionable copy) rather than silently demoting them to an
     * external member. Safe alongside `includeArchived` because the attach
     * only enumerates collaborators of ACTIVE workspaces, so sweeping
     * archived rows cannot manufacture a conflict.
     */
    await attachOwnedWorkspacesToOrganization({
      ownerUserId: user.id,
      organizationId,
      includeArchived: true,
    })

    try {
      await setActiveOrganizationForCurrentSession(organizationId)
    } catch (error) {
      logger.error('Failed to activate organization after creation', {
        organizationId,
        userId: user.id,
        error: getErrorMessage(error),
      })
    }

    logger.info('Successfully ensured organization', {
      userId: user.id,
      organizationId,
      createdOrganization,
    })

    if (createdOrganization) {
      recordAudit({
        workspaceId: null,
        actorId: user.id,
        action: AuditAction.ORGANIZATION_CREATED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        actorName: user.name ?? undefined,
        actorEmail: user.email ?? undefined,
        resourceName: organizationName ?? undefined,
        description: `Created organization "${organizationName}"`,
        metadata: { organizationSlug },
        request,
      })
      captureServerEvent(
        user.id,
        'organization_created',
        {
          organization_id: organizationId,
          ...(organizationName ? { name: organizationName } : {}),
        },
        { groups: { organization: organizationId } }
      )
    }

    return NextResponse.json({
      success: true,
      organizationId,
      created: createdOrganization,
    })
  } catch (error) {
    if (error instanceof OrganizationSlugInvalidError) {
      return NextResponse.json(
        {
          error:
            'Organization slug can only contain lowercase letters, numbers, hyphens, and underscores.',
        },
        { status: 400 }
      )
    }

    if (error instanceof OrganizationSlugTakenError) {
      return NextResponse.json({ error: 'This slug is already taken' }, { status: 400 })
    }

    if (error instanceof WorkspaceOrganizationMembershipConflictError) {
      return NextResponse.json(
        {
          error:
            'One or more members of your existing shared workspaces already belong to another organization. Remove them from those workspaces before converting them to organization-owned workspaces.',
        },
        { status: 409 }
      )
    }

    logger.error('Failed to create organization', {
      error: getErrorMessage(error, 'Unknown error'),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      {
        error: 'Failed to create organization',
        message: getErrorMessage(error, 'Unknown error'),
      },
      { status: 500 }
    )
  }
})
