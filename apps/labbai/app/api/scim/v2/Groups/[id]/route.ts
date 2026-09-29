import {
  deleteScimGroupContract,
  getScimGroupContract,
  patchScimGroupContract,
  replaceScimGroupContract,
} from '@/lib/api/contracts/scim'
import {
  deleteScimGroup,
  getScimGroup,
  patchScimGroup,
  replaceScimGroup,
} from '@/lib/labbai/scim/application/groups'
import { toCanonicalGroup } from '@/lib/labbai/scim/protocol/canonical'
import { parseAttributeProjection } from '@/lib/labbai/scim/protocol/resources'
import { defineScimRoute } from '@/lib/labbai/scim/route'

/** One Group resource. */

export const GET = defineScimRoute({
  contract: getScimGroupContract,
  operation: getScimGroup.operation,
  useCase: getScimGroup,
  mapInput: ({ params, query }) => ({
    groupId: params.id,
    projection: parseAttributeProjection(query),
  }),
  present: (resource) => resource,
})

export const PUT = defineScimRoute({
  contract: replaceScimGroupContract,
  operation: replaceScimGroup.operation,
  useCase: replaceScimGroup,
  mapInput: ({ params, body }) => {
    return { groupId: params.id, group: toCanonicalGroup(body) }
  },
  present: (result) => result.resource,
})

/** Answers 204: Microsoft asks that a group patch not echo the member list. */
export const PATCH = defineScimRoute({
  contract: patchScimGroupContract,
  operation: patchScimGroup.operation,
  useCase: patchScimGroup,
  mapInput: ({ params, body }) => ({ groupId: params.id, operations: body.Operations }),
})

export const DELETE = defineScimRoute({
  contract: deleteScimGroupContract,
  operation: deleteScimGroup.operation,
  useCase: deleteScimGroup,
  mapInput: ({ params }) => ({ groupId: params.id }),
})
