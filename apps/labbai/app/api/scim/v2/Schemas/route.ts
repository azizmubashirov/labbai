import { defineScimDiscoveryRoute } from '@/lib/api/server/routes'
import { schemaDefinitions } from '@/lib/labbai/scim/protocol/discovery'
import { toListResponse } from '@/lib/labbai/scim/protocol/resources'

export const GET = defineScimDiscoveryRoute((baseUrl) =>
  toListResponse(schemaDefinitions(baseUrl), schemaDefinitions(baseUrl).length, 1)
)
