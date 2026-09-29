import type { TokenBucketConfig } from '@/lib/core/rate-limiter/storage'

/**
 * SCIM 2.0 protocol constants (RFC 7643 / RFC 7644) shared by the wire
 * contracts, the route builder, and the application layer.
 */

/** Core User resource schema. */
export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
/** Core Group resource schema. */
export const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group'
/** Enterprise User extension schema. */
export const SCIM_ENTERPRISE_USER_SCHEMA =
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
/** List response message schema. */
export const SCIM_LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
/** PATCH request message schema. */
export const SCIM_PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
/** Error response message schema. */
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'
/** Discovery schemas. */
export const SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA =
  'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'
export const SCIM_RESOURCE_TYPE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType'
export const SCIM_SCHEMA_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema'

/** The media type every SCIM response carries. */
export const SCIM_MEDIA_TYPE = 'application/scim+json'
/** Request media types accepted on body-bearing requests. */
export const SCIM_ACCEPTED_MEDIA_TYPES = [SCIM_MEDIA_TYPE, 'application/json'] as const

/** Largest accepted request body. */
export const SCIM_MAX_BODY_BYTES = 1024 * 1024
/** Most members one Group write may carry. */
export const SCIM_MAX_GROUP_MEMBERS = 5000
/** Most operations one PATCH may carry. */
export const SCIM_MAX_PATCH_OPERATIONS = 1000
/** Page size used when a list request names none. */
export const SCIM_DEFAULT_PAGE_SIZE = 100
/** Largest page a list request may ask for. */
export const SCIM_MAX_PAGE_SIZE = 200
/** Most bearer credentials one connection may hold at once (allows rotation). */
export const SCIM_MAX_ACTIVE_CREDENTIALS = 2
/** How long request log rows are kept. */
export const SCIM_REQUEST_LOG_RETENTION_DAYS = 30

/** Per-connection admission for authenticated SCIM traffic. */
export const SCIM_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 600,
  refillRate: 300,
  refillIntervalMs: 60_000,
}

/** Prefix of every issued bearer token, so a leaked one is recognizable. */
export const SCIM_TOKEN_PREFIX = 'lbscim_'
