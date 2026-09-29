import type { SandboxProvider } from '@/lib/execution/remote-sandbox/types'

/**
 * Remote sandbox providers (E2B, Daytona) were removed. Every caller is gated
 * behind the remote-sandbox env flags, which are now always off, so reaching
 * this is a configuration bug rather than a user path.
 */
export function resolveProvider(): SandboxProvider {
  throw new Error('Remote code sandboxes are not available in this deployment')
}
