'use client'

import { useSyncExternalStore } from 'react'

/**
 * Client-side block-visibility change signal. Consumers that snapshot
 * `getAllBlocks()` (cmd+K search, the Access Control block list, the toolbar)
 * include {@link useBlockVisibilityVersion} in their memo deps so they re-read
 * the registry projection whenever the hydrated visibility state changes,
 * instead of going stale until a refresh.
 */
let version = 0
const listeners = new Set<() => void>()

/** Bump the version and notify subscribers that the visible block set changed. */
export function notifyBlockVisibilityChanged(): void {
  version += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Subscribe a component to visibility changes. Returns an opaque, monotonic
 * version — use it only as a dependency to recompute `getAllBlocks()`-derived data.
 */
export function useBlockVisibilityVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0
  )
}
