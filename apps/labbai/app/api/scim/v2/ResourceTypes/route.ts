import { defineScimDiscoveryRoute } from '@/lib/api/server/routes'
import { resourceTypes } from '@/lib/labbai/scim/protocol/discovery'
import { toListResponse } from '@/lib/labbai/scim/protocol/resources'

export const GET = defineScimDiscoveryRoute((baseUrl) =>
  toListResponse(resourceTypes(baseUrl), resourceTypes(baseUrl).length, 1)
)
