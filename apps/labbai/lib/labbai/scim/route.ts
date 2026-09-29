import { createScimRouteBuilder } from '@/lib/api/server/routes'
import { authenticateScimRequest } from '@/lib/labbai/scim/authenticate'
import { recordScimRequest } from '@/lib/labbai/scim/request-log'

/**
 * The SCIM route builder wired to the production authenticator and request
 * log. SCIM route files under `app/api/scim/v2` define their handlers with it.
 */
export const defineScimRoute = createScimRouteBuilder({
  authenticate: authenticateScimRequest,
  recordRequest: recordScimRequest,
})
