/**
 * Top-level destinations of the signed-in app. Dependency-free so the edge proxy,
 * server components, and client code all read the same values.
 */

/**
 * Where an authenticated viewer lands when nothing more specific was asked for:
 * after login, from `/`, and from every "open Labbai" affordance. A server route
 * that resolves to the viewer's workspaces. Every default post-auth destination must
 * point here rather than at a concrete surface, so the landing decision lives in one place.
 */
export const APP_ENTRY_PATH = '/home'

/**
 * The workspace picker: resolves to the viewer's most recent workspace. Use it only
 * where the viewer explicitly asked for workspaces; the default landing is
 * {@link APP_ENTRY_PATH}.
 */
export const WORKSPACES_PATH = '/workspace'

/** Opens full settings in the viewer's most recent accessible workspace. */
export const WORKSPACE_SETTINGS_PATH = `${WORKSPACES_PATH}?redirect=settings`

function isPathOrDescendant(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`)
}

/**
 * Whether a pathname belongs to the signed-in app — the entry or the workspaces —
 * and so requires a session before it renders.
 */
export function isAppSurfacePath(pathname: string): boolean {
  return (
    isPathOrDescendant(pathname, APP_ENTRY_PATH) || isPathOrDescendant(pathname, WORKSPACES_PATH)
  )
}
