/**
 * Discovery of the public v2 operations from the Zod route contracts, plus the
 * prose (summary / description) each one carries in the OpenAPI documents.
 *
 * Shared by `generate-v2-mcp-operations.ts`. The summaries are read from the
 * OpenAPI document definitions in `apps/labbai/lib/api/contracts/v2/openapi/`,
 * rendered in memory by `openapi/generator.ts` (the published JSON specs lived
 * in the removed docs app).
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { z } from 'zod'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACTS_DIR = path.join(ROOT, 'apps/labbai/lib/api/contracts/v2')
const OPENAPI_DIR = path.join(CONTRACTS_DIR, 'openapi')

/** What the OpenAPI specs say about one operation, beyond its request shape. */
export interface OperationDoc {
  /** The spec's one-line summary. */
  summary?: string
  /** The spec's longer prose, which the MCP server returns when describing the operation. */
  description?: string
  /**
   * The operation refuses a workspace API key, per its `description`.
   *
   * Carried so the operation description can say so before the request goes out;
   * without it the caller learns the restriction from a `403` after the fact.
   */
  workspaceKeyUnsupported?: true
}

/**
 * The description sentences that mark an operation as personal-key-only.
 *
 * Read out of `apps/labbai/lib/api/contracts/v2/openapi/shared.ts` at generation
 * time rather than restated here, so rewording the sentence there cannot leave
 * the marker silently unemitted. The import is lazy because that module
 * resolves through the `@/` alias, which exists under `bun` but not under the
 * root `vitest` that imports this file's pure helpers.
 */
export async function loadWorkspaceKeyDenialMarkers(): Promise<readonly string[]> {
  const shared: Record<string, unknown> = await import(
    path.join(ROOT, 'apps/labbai/lib/api/contracts/v2/openapi/shared.ts')
  )
  const markers = [shared.WORKSPACE_API_KEY_DENIED, shared.WORKSPACE_API_KEY_DENIED_AS_NOT_FOUND]
  for (const marker of markers) {
    if (typeof marker !== 'string' || !marker.trim()) {
      throw new Error('openapi/shared.ts no longer exports the workspace-key denial sentences')
    }
  }
  return markers as string[]
}

/** `POST /api/v2/tables/[tableId]` → the `POST /api/v2/tables/{tableId}` key {@link loadSummaries} uses. */
export function docPathKey(method: string, contractPath: string): string {
  return `${method} ${contractPath.replace(/\[([^\]]+)\]/g, '{$1}')}`
}

/** `METHOD /api/v2/{id}/…` → what the OpenAPI documents say about that operation. */
export async function loadSummaries(
  workspaceKeyDenialMarkers: readonly string[]
): Promise<Map<string, OperationDoc>> {
  const docs = new Map<string, OperationDoc>()
  const { generateOpenApiDocument } = await import('./openapi/generator')

  const files = readdirSync(OPENAPI_DIR).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'shared.ts'
  )
  for (const file of files) {
    const mod: Record<string, unknown> = await import(path.join(OPENAPI_DIR, file))
    for (const [exportName, definition] of Object.entries(mod)) {
      if (!exportName.endsWith('OpenApiDocument') || !definition) continue
      const spec = generateOpenApiDocument(definition as never) as Record<string, any>
      for (const [specPath, methods] of Object.entries(spec.paths ?? {})) {
        for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
          const doc: OperationDoc = {}
          if (typeof operation?.summary === 'string') doc.summary = operation.summary
          const description = operation?.description
          if (typeof description === 'string' && description.trim()) {
            doc.description = description.trim()
          }
          if (
            typeof description === 'string' &&
            workspaceKeyDenialMarkers.some((marker) => description.includes(marker))
          ) {
            doc.workspaceKeyUnsupported = true
          }
          if (doc.summary || doc.workspaceKeyUnsupported) {
            docs.set(`${method.toUpperCase()} ${specPath}`, doc)
          }
        }
      }
    }
  }

  return docs
}

/**
 * Every contract module under `contracts/v2`, discovered rather than listed.
 *
 * A hardcoded list is the wrong shape for this: adding a v2 domain would leave
 * its operations silently absent from the MCP table, with no error and nothing in
 * `--check` to notice, because the generated file would still match a generator
 * that never looked. Discovery makes a new domain appear on the next
 * regeneration, which is the property the whole pipeline is built on.
 *
 * `shared.ts` holds the response-envelope helpers, not contracts; it is skipped
 * because it exports no route contract, not because it is named here.
 */
function contractModules(): string[] {
  return readdirSync(CONTRACTS_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        entry.name !== 'index.ts'
    )
    .map((entry) => entry.name.replace(/\.ts$/, ''))
    .sort()
}

export interface RouteContract {
  method: string
  path: string
  params?: z.ZodType
  query?: z.ZodType
  body?: z.ZodType
  headers?: z.ZodType
  response: { mode: string; schema?: z.ZodType }
}

export interface Operation {
  /** `listTables` — derived from the export name. */
  name: string
  /** `v2ListTablesContract` — the contract module's export. */
  exportName: string
  domain: string
  contract: RouteContract
}

function isRouteContract(value: unknown): value is RouteContract {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RouteContract>
  return (
    typeof candidate.method === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.response === 'object'
  )
}

/** `v2ListTablesContract` → `listTables`. */
function operationName(exportName: string): string {
  const stripped = exportName.replace(/^v2/, '').replace(/Contract$/, '')
  return stripped.charAt(0).toLowerCase() + stripped.slice(1)
}

/** Every v2 route contract, sorted by operation name. */
export async function collectOperations(): Promise<Operation[]> {
  const operations: Operation[] = []

  for (const domain of contractModules()) {
    const mod: Record<string, unknown> = await import(path.join(CONTRACTS_DIR, `${domain}.ts`))
    for (const [exportName, value] of Object.entries(mod)) {
      if (!exportName.endsWith('Contract') || !isRouteContract(value)) continue
      operations.push({ name: operationName(exportName), exportName, domain, contract: value })
    }
  }

  // Import order is stable, but sort anyway so a reordered export list does not
  // show up as a spurious diff in the generated file.
  return operations.sort((a, b) => a.name.localeCompare(b.name))
}
