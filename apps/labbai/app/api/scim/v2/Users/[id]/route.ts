import {
  deleteScimUserContract,
  getScimUserContract,
  patchScimUserContract,
  replaceScimUserContract,
} from '@/lib/api/contracts/scim'
import {
  deprovisionScimUser,
  getScimUser,
  patchScimUser,
  replaceScimUser,
} from '@/lib/labbai/scim/application/users'
import { toCanonicalUser } from '@/lib/labbai/scim/protocol/canonical'
import { parseAttributeProjection } from '@/lib/labbai/scim/protocol/resources'
import { defineScimRoute } from '@/lib/labbai/scim/route'

/** One User resource. */

export const GET = defineScimRoute({
  contract: getScimUserContract,
  operation: getScimUser.operation,
  useCase: getScimUser,
  mapInput: ({ params, query }) => ({
    scimUserId: params.id,
    projection: parseAttributeProjection(query),
  }),
  present: (resource) => resource,
})

export const PUT = defineScimRoute({
  contract: replaceScimUserContract,
  operation: replaceScimUser.operation,
  useCase: replaceScimUser,
  mapInput: ({ params, body }) => {
    return { scimUserId: params.id, attributes: toCanonicalUser(body) }
  },
  present: (result) => result.resource,
})

export const PATCH = defineScimRoute({
  contract: patchScimUserContract,
  operation: patchScimUser.operation,
  useCase: patchScimUser,
  mapInput: ({ params, body }) => ({ scimUserId: params.id, operations: body.Operations }),
  present: (result) => result.resource,
})

export const DELETE = defineScimRoute({
  contract: deleteScimUserContract,
  operation: deprovisionScimUser.operation,
  useCase: deprovisionScimUser,
  mapInput: ({ params }) => ({ scimUserId: params.id }),
})
