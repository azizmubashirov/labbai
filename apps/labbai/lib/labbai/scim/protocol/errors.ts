import {
  asOrchestrationError,
  messageForOrchestrationError,
  type OrchestrationErrorCode,
} from '@/lib/core/orchestration/types'
import { SCIM_ERROR_SCHEMA } from '@/lib/labbai/scim/protocol/constants'

/** The `scimType` vocabulary of RFC 7644 section 3.12. */
export type ScimType =
  | 'invalidFilter'
  | 'tooMany'
  | 'uniqueness'
  | 'mutability'
  | 'invalidSyntax'
  | 'invalidPath'
  | 'noTarget'
  | 'invalidValue'
  | 'invalidVers'
  | 'sensitive'

/** An RFC 7644 error response body. `status` is a string on the wire. */
export interface ScimErrorBody {
  schemas: [typeof SCIM_ERROR_SCHEMA]
  status: string
  scimType?: ScimType
  detail?: string
}

/** Builds an RFC 7644 error body. */
export function scimErrorBody(status: number, scimType?: ScimType, detail?: string): ScimErrorBody {
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    ...(detail ? { detail } : {}),
  }
}

/** A failure that already knows how it renders on the SCIM wire. */
export class ScimError extends Error {
  constructor(
    readonly status: number,
    readonly scimType?: ScimType,
    detail?: string,
    readonly headers?: Record<string, string>
  ) {
    super(detail ?? defaultDetail(status))
    this.name = 'ScimError'
  }

  get body(): ScimErrorBody {
    return scimErrorBody(this.status, this.scimType, this.message)
  }
}

function defaultDetail(status: number): string {
  if (status === 400) return 'Bad request'
  if (status === 401) return 'Unauthorized'
  if (status === 403) return 'Forbidden'
  if (status === 404) return 'Not found'
  if (status === 409) return 'Conflict'
  if (status === 413) return 'Request body is too large'
  if (status === 429) return 'Too many requests'
  return 'Internal server error'
}

/** A `404` naming what was not found. */
export function notFound(detail: string): ScimError {
  return new ScimError(404, undefined, detail)
}

function fromOrchestrationCode(code: OrchestrationErrorCode): {
  status: number
  scimType?: ScimType
} {
  switch (code) {
    case 'validation':
      return { status: 400, scimType: 'invalidValue' }
    case 'unauthorized':
      return { status: 401 }
    case 'forbidden':
      return { status: 403 }
    case 'not_found':
      return { status: 404 }
    case 'conflict':
    case 'locked':
      return { status: 409, scimType: 'uniqueness' }
    case 'payload_too_large':
      return { status: 413 }
    default:
      return { status: 500 }
  }
}

/**
 * Classifies any thrown value as a {@link ScimError}. Domain failures keep their
 * caller-safe message; anything unclassified becomes a generic `500`.
 */
export function toScimError(error: unknown): ScimError {
  if (error instanceof ScimError) return error
  const classified = asOrchestrationError(error)
  if (classified) {
    const { status, scimType } = fromOrchestrationCode(classified.code)
    const detail = messageForOrchestrationError(
      { error: classified.message, errorCode: classified.code },
      defaultDetail(status)
    )
    return new ScimError(status, scimType, detail)
  }
  return new ScimError(500, undefined, 'Internal server error')
}
