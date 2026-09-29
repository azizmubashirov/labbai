import { getEnv } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'

/** Where the Labbai MCP route lives in this app, whichever host serves it publicly. */
export const LABBAI_MCP_ROUTE_PATH = '/api/mcp'

/**
 * The Labbai MCP server's canonical URL. Client setup, protected-resource
 * discovery, and OAuth token audience all use this one string.
 *
 * `SIM_MCP_URL` names a dedicated host (e.g. `https://mcp.example.com/mcp`),
 * which `proxy.ts` maps onto {@link LABBAI_MCP_ROUTE_PATH}. Without it the server
 * is served from the app's own origin.
 */
export function getLabbaiMcpUrl(): string {
  const configured = getEnv('SIM_MCP_URL')?.trim().replace(/\/+$/, '')
  return configured || `${getBaseUrl()}${LABBAI_MCP_ROUTE_PATH}`
}
