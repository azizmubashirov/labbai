import { z } from 'zod'
import { organizationRoleSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workspacePermissionSchema } from '@/lib/api/contracts/workspaces'

const numericResponseSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : value
}, z.number())

export const organizationParamsSchema = z.object({
  id: z.string().min(1),
})

export const organizationMemberParamsSchema = z.object({
  id: z.string().min(1),
  memberId: z.string().min(1),
})

export const organizationMemberQuerySchema = z
  .object({
    include: z.enum(['usage']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .passthrough()

export const createOrganizationBodySchema = z
  .object({
    name: z.string().optional(),
    slug: z.string().optional(),
  })
  .passthrough()

export const updateOrganizationBodySchema = z.object({
  name: z.string().trim().min(1, 'Organization name is required').optional(),
  slug: z
    .string()
    .trim()
    .min(1, 'Organization slug is required')
    .regex(
      /^[a-z0-9-_]+$/,
      'Slug can only contain lowercase letters, numbers, hyphens, and underscores'
    )
    .optional(),
  logo: z.string().nullable().optional(),
})

export const updateOrganizationMemberRoleBodySchema = z.object({
  role: organizationRoleSchema,
})

export const MAX_ORGANIZATION_DOMAINS = 25

export const organizationDomainParamsSchema = z.object({
  id: z.string().min(1),
  domainId: z.string().min(1),
})

export const addOrganizationDomainBodySchema = z.object({
  domain: z.string().min(1, 'Domain is required').max(253, 'Domain is too long'),
})

export type AddOrganizationDomainBody = z.input<typeof addOrganizationDomainBodySchema>

export const organizationDomainStatusSchema = z.enum(['pending', 'verified'])

const organizationDomainSchema = z.object({
  id: z.string(),
  domain: z.string(),
  status: organizationDomainStatusSchema,
  verifiedAt: z.string().nullable(),
  /** DNS host the TXT record must live on (e.g. `_sim-challenge.acme.com`). */
  challengeHost: z.string(),
  /** Exact TXT record value the org must publish. Null for grandfathered/verified rows. */
  txtRecordValue: z.string().nullable(),
})

export type OrganizationDomain = z.output<typeof organizationDomainSchema>

const organizationDomainsDataSchema = z.object({
  isEnterprise: z.boolean(),
  domains: z.array(organizationDomainSchema),
})

export type OrganizationDomains = z.output<typeof organizationDomainsDataSchema>

export const listOrganizationDomainsResponseSchema = z.object({
  success: z.boolean(),
  data: organizationDomainsDataSchema,
})

export const organizationDomainResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({ domain: organizationDomainSchema }),
})

export const revokeOrganizationSessionsResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    revokedSessions: z.number().int().min(0),
  }),
})

export const transferOwnershipBodySchema = z.object({
  newOwnerUserId: z.string().min(1),
  alsoLeave: z.boolean().optional().default(false),
})

export const rosterWorkspaceAccessSchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string(),
  permission: workspacePermissionSchema,
  /**
   * Why this role is fixed, when it is. Carried so the roster can disable the
   * controls the workspace-permissions route refuses, the way the teammates list
   * already does — without them it offers an edit that can only fail.
   */
  roleSource: z.enum(['owner', 'explicit', 'org-admin']),
  isBilledAccount: z.boolean(),
})

export const rosterMemberSchema = z.object({
  memberId: z.string(),
  userId: z.string(),
  role: z.enum(['owner', 'admin', 'member', 'external']),
  createdAt: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  /** Set while a directory deactivation blocks the member's sign-in; access is otherwise intact. */
  suspendedAt: z.string().nullable(),
  workspaces: z.array(rosterWorkspaceAccessSchema),
})

export const rosterPendingInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  kind: z.enum(['organization', 'workspace']),
  membershipIntent: z.enum(['internal', 'external']).optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
  inviteeName: z.string().nullable(),
  inviteeImage: z.string().nullable(),
  workspaces: z.array(rosterWorkspaceAccessSchema),
})

export const organizationRosterSchema = z.object({
  members: z.array(rosterMemberSchema),
  pendingInvitations: z.array(rosterPendingInvitationSchema),
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
})

export const organizationMemberUsageSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    organizationId: z.string(),
    role: organizationRoleSchema,
    createdAt: z.string(),
    userName: z.string().nullable(),
    userEmail: z.string().nullable(),
    currentPeriodCost: numericResponseSchema.nullable().optional(),
    currentUsageLimit: numericResponseSchema.nullable().optional(),
    usageLimitUpdatedAt: z.string().nullable().optional(),
    billingPeriodStart: z.string().nullable().optional(),
    billingPeriodEnd: z.string().nullable().optional(),
  })
  .passthrough()

export const listOrganizationMembersResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.array(organizationMemberUsageSchema),
    total: z.number(),
    pagination: z.object({
      total: z.number().int().min(0),
      limit: z.number().int().min(1).max(100),
      offset: z.number().int().min(0),
      hasMore: z.boolean(),
    }),
    userRole: organizationRoleSchema,
    hasAdminAccess: z.boolean(),
  })
  .passthrough()

const successResponseSchema = z
  .object({
    success: z.boolean(),
    message: z.string().optional(),
  })
  .passthrough()

export const getOrganizationRosterContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/roster',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.boolean(),
      data: organizationRosterSchema,
    }),
  },
})

export const removalImpactCredentialSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  type: z.string(),
  workspaceId: z.string(),
})

export const memberRemovalImpactQuerySchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
})

/**
 * Identity-bound credentials (OAuth accounts, personal env keys) the user owns
 * in organization workspaces. These stop working when the user's workspace
 * access is revoked and must be reconnected by a remaining member — removal is
 * never blocked, only disclosed.
 */
export const getMemberRemovalImpactContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/removal-impact',
  params: organizationParamsSchema,
  query: memberRemovalImpactQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      credentials: z.array(removalImpactCredentialSchema),
    }),
  },
})

export type RemovalImpactCredential = z.infer<typeof removalImpactCredentialSchema>

export const listOrganizationMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/members',
  params: organizationParamsSchema,
  query: organizationMemberQuerySchema,
  response: {
    mode: 'json',
    schema: listOrganizationMembersResponseSchema,
  },
})

export const updateOrganizationMemberRoleContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/members/[memberId]',
  params: organizationMemberParamsSchema,
  body: updateOrganizationMemberRoleBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      data: z
        .object({
          id: z.string(),
          userId: z.string(),
          role: organizationRoleSchema,
          updatedBy: z.string(),
        })
        .passthrough()
        .optional(),
    }),
  },
})

export const removeOrganizationMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/members/[memberId]',
  params: organizationMemberParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      data: z.record(z.string(), z.unknown()).optional(),
    }),
  },
})

export const transferOwnershipContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/transfer-ownership',
  params: organizationParamsSchema,
  body: transferOwnershipBodySchema,
  response: {
    mode: 'json',
    schema: z
      .object({
        success: z.boolean(),
        transferred: z.boolean(),
        left: z.boolean(),
        warning: z.string().optional(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  },
})

export const organizationSeatInfoSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  currentSeats: z.number(),
  maxSeats: z.number(),
  availableSeats: z.number(),
  subscriptionPlan: z.string(),
  canAddSeats: z.boolean(),
})
export const getOrganizationQuerySchema = z.object({ include: z.string().max(100).optional() })
export type GetOrganizationQuery = z.input<typeof getOrganizationQuerySchema>
export const getOrganizationResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    logo: z.string().nullable(),
    metadata: z.unknown().describe('Organization-defined JSON metadata.'),
    createdAt: z.string(),
    updatedAt: z.string(),
    seats: organizationSeatInfoSchema.optional(),
    seatAnalytics: organizationSeatInfoSchema.extend({ utilizationRate: z.number() }).optional(),
  }),
  userRole: organizationRoleSchema,
  hasAdminAccess: z.boolean(),
})
export type GetOrganizationResponse = z.output<typeof getOrganizationResponseSchema>
export const getOrganizationContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]',
  params: organizationParamsSchema,
  query: getOrganizationQuerySchema,
  response: { mode: 'json', schema: getOrganizationResponseSchema },
})

export const updateOrganizationContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]',
  params: organizationParamsSchema,
  body: updateOrganizationBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      data: z
        .object({
          id: z.string(),
          name: z.string(),
          slug: z.string().nullable(),
          logo: z.string().nullable(),
          updatedAt: z.string(),
        })
        .passthrough()
        .optional(),
    }),
  },
})

export const revokeOrganizationSessionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/sessions/revoke',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: revokeOrganizationSessionsResponseSchema,
  },
})

export const listOrganizationDomainsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/domains',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: listOrganizationDomainsResponseSchema,
  },
})

export const addOrganizationDomainContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/domains',
  params: organizationParamsSchema,
  body: addOrganizationDomainBodySchema,
  response: {
    mode: 'json',
    schema: organizationDomainResponseSchema,
  },
})

export const verifyOrganizationDomainContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/domains/[domainId]/verify',
  params: organizationDomainParamsSchema,
  response: {
    mode: 'json',
    schema: organizationDomainResponseSchema,
  },
})

export const removeOrganizationDomainContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/domains/[domainId]',
  params: organizationDomainParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.boolean() }),
  },
})

export const createOrganizationContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations',
  body: createOrganizationBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.boolean(),
      organizationId: z.string(),
      created: z.boolean(),
    }),
  },
})

export type OrganizationRoster = z.infer<typeof organizationRosterSchema>
export type RosterWorkspaceAccess = z.infer<typeof rosterWorkspaceAccessSchema>
export type RosterMember = z.infer<typeof rosterMemberSchema>
export type RosterPendingInvitation = z.infer<typeof rosterPendingInvitationSchema>
export type OrganizationMembersResponse = z.infer<typeof listOrganizationMembersResponseSchema>
