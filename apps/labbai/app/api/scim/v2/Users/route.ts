import { createScimUserContract, listScimUsersContract } from '@/lib/api/contracts/scim'
import { listScimUsers, provisionScimUser } from '@/lib/labbai/scim/application/users'
import { toCanonicalUser } from '@/lib/labbai/scim/protocol/canonical'
import { parseAttributeProjection, toListResponse } from '@/lib/labbai/scim/protocol/resources'
import { defineScimRoute } from '@/lib/labbai/scim/route'

/**
 * The User collection.
 *
 * Adapters only: authentication, rate policy, contract parsing, and rendering
 * live in the route builder, and every decision about identity, membership, and
 * access lives in `lib/labbai/scim/application`.
 */

export const GET = defineScimRoute({
  contract: listScimUsersContract,
  operation: listScimUsers.operation,
  useCase: listScimUsers,
  mapInput: ({ query }) => ({
    filter: query.filter,
    startIndex: query.startIndex,
    count: query.count,
    projection: parseAttributeProjection(query),
  }),
  present: (result) => toListResponse(result.resources, result.totalResults, result.startIndex),
})

export const POST = defineScimRoute({
  contract: createScimUserContract,
  operation: provisionScimUser.operation,
  useCase: provisionScimUser,
  mapInput: ({ body }) => {
    return { attributes: toCanonicalUser(body) }
  },
  present: (result) => result.resource,
  headers: (result, { baseUrl }) => ({ Location: `${baseUrl}/Users/${result.scimUserId}` }),
})
