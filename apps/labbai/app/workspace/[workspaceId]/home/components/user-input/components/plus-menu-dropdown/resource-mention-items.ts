import type { AvailableItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'

export interface ResourceMentionGroup {
  type: MothershipResourceType
  items: AvailableItem[]
}

/** Adds table and knowledge-base folders as stable folder-ID chat mentions. */
export function withFolderMentions(
  groups: readonly ResourceMentionGroup[],
  folders: { table: AvailableItem[]; knowledgebase: AvailableItem[] }
): ResourceMentionGroup[] {
  return groups.map((group) =>
    group.type === 'folder'
      ? {
          ...group,
          items: [
            ...group.items,
            ...folders.table.map((item) => ({ ...item, mentionFamily: 'Table folders' })),
            ...folders.knowledgebase.map((item) => ({
              ...item,
              mentionFamily: 'Knowledge base folders',
            })),
          ],
        }
      : group
  )
}

/** A family query such as "tables" keeps that family's rows visible. */
export function resourceMentionMatches(item: AvailableItem, query: string): boolean {
  const normalized = query.toLowerCase().trim()
  if (!normalized) return true
  return (
    item.name.toLowerCase().includes(normalized) ||
    (typeof item.mentionFamily === 'string' &&
      item.mentionFamily.toLowerCase().includes(normalized))
  )
}

/** One row of the `@` list: an item plus the family it came from. */
export interface ResourceMentionCandidate {
  type: MothershipResourceType
  item: AvailableItem
}

/**
 * The rows an `@` list shows for an EMPTY query — a preview of what is mentionable,
 * capped per family so no one family can bury the rest.
 *
 * `integration` carries 300+ near-identical rows and sorts FIRST, so while the cap
 * defaulted to "uncapped" the preview was its entire catalog and no other family was
 * reachable without scrolling past all of it. Capping is therefore the default and a
 * family opts out by raising its own limit, not by omitting one.
 *
 * Only the empty-query preview is capped; {@link resourceMentionMatches} searches
 * every family in full once the user types.
 */
export function buildMentionPreview(
  groups: readonly ResourceMentionGroup[],
  limitFor: (type: MothershipResourceType) => number
): ResourceMentionCandidate[] {
  return groups.flatMap(({ type, items }) =>
    items.slice(0, limitFor(type)).map((item) => ({ type, item }))
  )
}
