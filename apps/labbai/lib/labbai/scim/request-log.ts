import type { ScimConnectionPrincipal } from '@labbai/auth/principal'
import { db } from '@labbai/db'
import { scimRequestLog } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { generateId } from '@labbai/utils/id'
import type { ScimType } from '@/lib/labbai/scim/protocol/errors'

const logger = createLogger('ScimRequestLog')

/** One authenticated SCIM request, as the settings activity view shows it. */
export interface ScimRequestLogEntry {
  principal: ScimConnectionPrincipal
  method: string
  /** Resource path template only; query strings can carry directory attribute values. */
  path: string
  status: number
  scimType?: ScimType
  detail?: string
  userAgent: string | null
  durationMs: number
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Records a request. Fire-and-forget: a logging failure never fails the request. */
export function recordScimRequest(entry: ScimRequestLogEntry): void {
  db.insert(scimRequestLog)
    .values({
      id: generateId(),
      connectionId: entry.principal.connectionId,
      credentialId: entry.principal.credentialId,
      method: entry.method,
      path: entry.path,
      status: entry.status,
      scimType: entry.scimType ?? null,
      detail: truncate(entry.detail, 1000),
      userAgent: truncate(entry.userAgent, 512),
      durationMs: Math.max(0, Math.round(entry.durationMs)),
    })
    .catch((error: unknown) => {
      logger.warn('Failed to record SCIM request', {
        connectionId: entry.principal.connectionId,
        error,
      })
    })
}
