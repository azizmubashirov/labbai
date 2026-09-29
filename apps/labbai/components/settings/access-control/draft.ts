import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'

/**
 * Pure helpers for the Access Control group editor's local draft.
 */

/** The editable part of a permission group, held locally until saved. */
export interface PermissionGroupDraft {
  name: string
  description: string
  isDefault: boolean
  workspaceIds: string[]
  config: PermissionGroupConfig
}

/** Adds or removes `member`, keeping order and never duplicating. */
export function toggleListMember(
  list: readonly string[],
  member: string,
  include: boolean
): string[] {
  const without = list.filter((entry) => entry !== member)
  return include ? [...without, member] : without
}

/** Parses a comma- or newline-separated list of ids, trimmed and de-duplicated. */
export function parseIdList(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of text.split(/[\n,]/)) {
    const id = raw.trim()
    if (id) seen.add(id)
  }
  return [...seen]
}

/** Whether two drafts differ in anything that would be saved. */
export function isDraftDirty(current: PermissionGroupDraft, saved: PermissionGroupDraft): boolean {
  return (
    current.name.trim() !== saved.name.trim() ||
    current.description.trim() !== saved.description.trim() ||
    current.isDefault !== saved.isDefault ||
    JSON.stringify([...current.workspaceIds].sort()) !==
      JSON.stringify([...saved.workspaceIds].sort()) ||
    JSON.stringify(current.config) !== JSON.stringify(saved.config)
  )
}

/** One-line description of which workspaces a group governs. */
export function describeGroupScope(group: {
  isDefault: boolean
  workspaces: ReadonlyArray<{ name: string }>
}): string {
  if (group.isDefault) return 'Organization default · all workspaces'
  const count = group.workspaces.length
  if (count === 0) return 'No workspaces · inactive'
  if (count === 1) return group.workspaces[0].name
  return `${count} workspaces`
}
