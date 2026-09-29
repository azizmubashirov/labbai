import { defineScimDiscoveryRoute } from '@/lib/api/server/routes'
import { schemaDefinitions } from '@/lib/labbai/scim/protocol/discovery'
import { notFound } from '@/lib/labbai/scim/protocol/errors'

export const GET = defineScimDiscoveryRoute((baseUrl, params) => {
  const id = typeof params.id === 'string' ? decodeURIComponent(params.id) : ''
  const match = schemaDefinitions(baseUrl).find(
    (schema) => schema.id.toLowerCase() === id.toLowerCase()
  )
  if (!match) throw notFound(`Schema ${id} not found`)
  return match
})
