import { CLIENT_INFO_HEADER, formatClientInfo } from '@labbai/utils/client-info'

export { CLIENT_INFO_HEADER }

export interface BrowserSurface {
  surface: 'web'
}

/**
 * Which browser-hosted surface this page is. The one decision behind both the
 * `X-Sim-Client-Info` header and the PostHog super property, so the two can
 * never disagree.
 */
export function resolveBrowserSurface(): BrowserSurface {
  return { surface: 'web' }
}

/**
 * The `X-Sim-Client-Info` value the web app sends on its own API calls.
 *
 * Returns `undefined` on the server, where the same client code runs during
 * prefetching and a request from the app to itself is not a web-surface call.
 */
export function getClientInfoHeader(): string | undefined {
  if (typeof window === 'undefined') return undefined
  return formatClientInfo(resolveBrowserSurface())
}
