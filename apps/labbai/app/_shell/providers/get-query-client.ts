import { isServer, QueryClient } from '@tanstack/react-query'

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        // Off: tab-switch focus events are frequent and noisy on the web.
        // Per-query overrides always win over this default.
        refetchOnWindowFocus: false,
        /**
         * Query core already defaults retries to 0 on the server and 3 in the browser;
         * only the browser number is ours to change. Stating one value for both would
         * silently opt server prefetches into a retry, and because the layout awaits
         * them that spends a retry backoff of document latency on a read whose failure
         * the client recovers from on its own.
         */
        retry: isServer ? 0 : 1,
        retryOnMount: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

/**
 * Returns a QueryClient instance. On the server, creates a new instance per request.
 * On the client, reuses a singleton instance.
 */
export function getQueryClient() {
  if (isServer) {
    return makeQueryClient()
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient()
  }
  return browserQueryClient
}
