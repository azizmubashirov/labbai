import { createLogger } from '@labbai/logger'
import { isPlainRecord } from '@labbai/utils/object'
import { DEFAULT_SUBBLOCK_TYPE } from '@labbai/workflow-persistence/subblocks'
import { migrateMcpOperationControls } from '@/lib/workflows/migrations/mcp-operation-controls'
import { sanitizeMalformedSubBlocks } from '@/lib/workflows/sanitization/subblocks'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  isCanonicalPair,
  resolveCanonicalMode,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('SubblockMigrations')

/**
 * Marks a migration target as "this field is gone", rather than a rename. The
 * old value is discarded instead of being carried into workflow state.
 */
const REMOVED_SUBBLOCK_ID_PREFIX = '_removed_'

/**
 * One legacy-to-current subblock ID mapping for a block type.
 *
 * `whenOperation` scopes the rename to the operations the old ID belonged to.
 * Leave it off for an unconditional rename — the shape every entry predating
 * operation scoping uses.
 *
 * Scoping is required whenever the old ID is still a LIVE control for some
 * other operation on the same block. Cloudflare `type` is the
 * `list_dns_records` filter, `tags` the `purge_cache` list, `order`/`status`
 * the `list_zones` filters; ServiceNow `fields` is the Create/Update Record
 * JSON body — a different value space entirely; Okta `sendEmail` is the
 * activation/reset switch. An unconditional rename would move a value out of
 * the field that still owns it.
 */
export interface SubblockIdMigration {
  /** The subblock ID a legacy saved state stores the value under. */
  from: string
  /**
   * The current subblock ID, or a `_removed_`-prefixed name meaning the field
   * was deleted outright and the stored value should be dropped.
   */
  to: string
  /**
   * Apply only when the block's stored `operation` value is one of these.
   * Omit for an unconditional rename.
   */
  whenOperation?: readonly string[]
  /**
   * Apply only when the stored value passes this check. Needed when the legacy
   * ID served two incompatible value spaces that the stored `operation` alone
   * cannot separate, because a value written under one operation survives a
   * switch to another: subblock values are keyed by ID and are never cleared
   * when the operation changes.
   */
  whenValue?: (value: unknown) => boolean
}

/**
 * Maps old subblock IDs to their current equivalents per block type.
 *
 * When a subblock is renamed in a block definition, old deployed/saved states
 * still carry the value under the previous key. Without this mapping the
 * serializer silently drops the value, breaking execution.
 *
 * A `to` prefixed with `_removed_` means the field was deleted outright; the
 * stored value is dropped. Use it for fields with no replacement — never map a
 * secret onto a live subblock.
 */
export const SUBBLOCK_ID_MIGRATIONS: Record<string, readonly SubblockIdMigration[]> = {
  /** MCP normalization selects the active replacement before this rename pass. */
  mcp: [
    { from: 'server', to: 'serverSelector' },
    { from: 'tool', to: 'toolSelector' },
    { from: 'connection', to: '_removed_connection' },
    { from: 'operationPolicy', to: '_removed_operationPolicy' },
  ],
  instagram: [{ from: 'metrics', to: 'insightMetrics' }],
  knowledge: [{ from: 'knowledgeBaseId', to: 'knowledgeBaseSelector' }],
  /** Connected accounts resolve from the workspace; group selectors have no replacement. */
  credential_group: [
    { from: 'credentialGroup', to: '_removed_credentialGroup' },
    { from: 'manualCredentialGroup', to: '_removed_manualCredentialGroup' },
  ],
  /**
   * Exa deprecated both fields. `useAutoprompt` is gone from the API, and
   * `livecrawl` is superseded by `maxAgeHours` — but their values are not
   * interchangeable (`livecrawl` is a mode string, `maxAgeHours` a number),
   * so mapping one onto the other would send `NaN`. Dropping `livecrawl` is
   * also the fix for the block having defaulted it to `never`, which pinned
   * every saved search to cached results.
   */
  exa: [
    { from: 'useAutoprompt', to: '_removed_useAutoprompt' },
    { from: 'livecrawl', to: '_removed_livecrawl' },
  ],
}

/** Reads the value out of a stored subblock entry, tolerating a bare value. */
function storedSubblockValue(entry: unknown): unknown {
  if (isPlainRecord(entry)) return Object.hasOwn(entry, 'value') ? entry.value : null
  return entry
}

/** A stored value carries nothing worth migrating when it is absent or blank. */
function isBlankValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * The operation a block is currently configured for, or `null` when it has
 * none. An operation-scoped migration cannot fire without it: the whole point
 * of the scope is that the same stored ID means different things per operation,
 * so an unknown operation must leave the value alone.
 */
function selectedOperation(
  subBlocks: Record<string, BlockState['subBlocks'][string]>
): string | null {
  const value = storedSubblockValue(subBlocks.operation)
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Migrates legacy subblock IDs inside a single block's subBlocks map.
 * Returns a new subBlocks record if anything changed, or the original if not.
 */
function migrateBlockSubblockIds(
  blockType: string,
  subBlocks: Record<string, BlockState['subBlocks'][string]>,
  migrations: readonly SubblockIdMigration[]
): { subBlocks: Record<string, BlockState['subBlocks'][string]>; migrated: boolean } {
  let touched = false
  for (const { from } of migrations) {
    if (from in subBlocks) {
      touched = true
      break
    }
  }

  if (!touched) return { subBlocks, migrated: false }

  const result = { ...subBlocks }
  const blockConfig = getBlock(blockType)
  const operation = selectedOperation(subBlocks)
  let migrated = false

  for (const { from, to, whenOperation, whenValue } of migrations) {
    if (!(from in result)) continue

    // A `_removed_` target means the field no longer exists in the block. Drop
    // the value rather than parking it under a dead key: nothing ever reads
    // these keys, and secret scrubbing walks the block config, so a parked
    // `password: true` value would never be cleared and would ride along in
    // workflow exports and templates.
    if (to.startsWith(REMOVED_SUBBLOCK_ID_PREFIX)) {
      delete result[from]
      migrated = true
      continue
    }

    if (whenOperation) {
      // Scoped renames only fire for the operation that owned the written
      // value. The source ID is still a live control for some other operation,
      // so applying one outside its scope would steal that operation's value —
      // and so would deleting the source outside its scope.
      if (operation === null || !whenOperation.includes(operation)) continue

      /**
       * The collision guard for a scoped rename, and the whole discriminator
       * for "is this state older than the rename?".
       *
       * Presence of the target ID means the state was written by a block config
       * that already declared it. `prepareBlockState` materializes an entry for
       * EVERY declared subblock at block-creation time and the add-block write
       * persists that map wholesale, so a block created after a rename always
       * carries the new ID — seeded, or explicitly `null` when the control has
       * no seed. A block created before it cannot carry the new ID at all: the
       * loader reads `workflow_blocks.sub_blocks` verbatim and no load-time
       * step hydrates missing declared subblocks.
       *
       * So "target absent" is exactly "this state predates the rename", and it
       * is the only condition under which the legacy value may move.
       * Overwriting a target that is merely blank or still at its seeded
       * default would reopen the cross-operation leak the renames closed — a
       * `list_dns_records` name filter promoted onto `updateRecordName` renames
       * a live DNS record, and a Create Record JSON body promoted onto
       * `readFields` goes out as `sysparm_fields=[object Object]`.
       *
       * A legacy value is therefore never clobbered by a live user pick, and a
       * live user pick is never clobbered by a legacy value. Leaving the source
       * in place here is deliberate: the target already owns the value, and the
       * source may still be this block's control for another operation.
       */
      if (to in result) continue

      // Nothing to recover, and writing the blank through would only create a
      // second key holding the same emptiness.
      if (isBlankValue(storedSubblockValue(result[from]))) continue
    } else if (to in result) {
      // Unconditional rename onto an occupied target: the target wins and the
      // legacy value is discarded, which is how every pre-scoping entry here
      // has always behaved.
      delete result[from]
      migrated = true
      continue
    }

    // A value the target's space cannot represent belongs to whichever control
    // still owns the source ID. Leave it there rather than moving it into a
    // field that would send it as something it is not.
    if (whenValue && !whenValue(storedSubblockValue(result[from]))) continue

    const oldEntry: unknown = result[from]
    const configuredType = blockConfig?.subBlocks?.find((config) => config.id === to)?.type
    if (isPlainRecord(oldEntry)) {
      const type =
        configuredType ||
        (typeof oldEntry.type === 'string' && oldEntry.type.length > 0
          ? oldEntry.type === 'unknown'
            ? DEFAULT_SUBBLOCK_TYPE
            : oldEntry.type
          : DEFAULT_SUBBLOCK_TYPE)
      const value = Object.hasOwn(oldEntry, 'value') ? oldEntry.value : null

      result[to] = {
        ...oldEntry,
        id: to,
        type: type as BlockState['subBlocks'][string]['type'],
        value: value as BlockState['subBlocks'][string]['value'],
      }
    } else {
      result[to] = {
        id: to,
        type: configuredType || DEFAULT_SUBBLOCK_TYPE,
        value: oldEntry as BlockState['subBlocks'][string]['value'],
      }
    }
    delete result[from]
    migrated = true
  }

  return migrated ? { subBlocks: result, migrated: true } : { subBlocks, migrated: false }
}

/**
 * Drops any `_removed_*` subblock left behind by an earlier version of this
 * migration, which renamed retired fields into a dead key instead of deleting
 * them. Those keys are unreachable from the block config, so secret scrubbing —
 * which walks the config — can never clear them, and a parked token or PII
 * would otherwise survive in state, exports, and templates indefinitely.
 *
 * Runs for every block, not just those with a rename map: the parked keys no
 * longer appear in any `SUBBLOCK_ID_MIGRATIONS` entry as an `oldId`, so nothing
 * else would ever look at them.
 */
function dropParkedSubblocks(subBlocks: Record<string, BlockState['subBlocks'][string]>): {
  subBlocks: Record<string, BlockState['subBlocks'][string]>
  dropped: boolean
} {
  const parked = Object.keys(subBlocks).filter((id) => id.startsWith(REMOVED_SUBBLOCK_ID_PREFIX))
  if (parked.length === 0) return { subBlocks, dropped: false }

  const result = { ...subBlocks }
  for (const id of parked) delete result[id]
  return { subBlocks: result, dropped: true }
}

/**
 * Applies subblock-ID migrations to every block in a workflow.
 * Returns a new blocks record with migrated subBlocks where needed.
 */
export function migrateSubblockIds(blocks: Record<string, BlockState>): {
  blocks: Record<string, BlockState>
  migrated: boolean
} {
  let anyMigrated = false
  const result: Record<string, BlockState> = {}

  for (const [blockId, block] of Object.entries(blocks)) {
    if (!block.subBlocks) {
      result[blockId] = block
      continue
    }

    const normalized = migrateMcpOperationControls(block)
    const migrations = SUBBLOCK_ID_MIGRATIONS[block.type]
    const renamed = migrations
      ? migrateBlockSubblockIds(block.type, normalized.subBlocks, migrations)
      : { subBlocks: normalized.subBlocks, migrated: false }
    const purged = dropParkedSubblocks(renamed.subBlocks)
    const changedSubBlocks = renamed.migrated || purged.dropped
    const renamedBlock = changedSubBlocks
      ? { ...normalized, subBlocks: purged.subBlocks }
      : normalized
    const sanitized = sanitizeMalformedSubBlocks(renamedBlock)
    const blockMigrated = changedSubBlocks || sanitized.changed || normalized !== block

    if (blockMigrated) {
      if (purged.dropped) {
        logger.info('Dropped parked subblock values left by an earlier migration', {
          blockId: block.id,
          blockType: block.type,
        })
      }
      if (renamed.migrated) {
        logger.info('Migrated legacy subblock IDs', {
          blockId: block.id,
          blockType: block.type,
        })
      }
      anyMigrated = true
      result[blockId] = { ...renamedBlock, subBlocks: sanitized.subBlocks }
    } else {
      result[blockId] = block
    }
  }

  return { blocks: result, migrated: anyMigrated }
}

/**
 * One legacy-to-current `canonicalParamId` rename for a block type.
 *
 * Renaming a canonical id is otherwise invisible to persistence — values are
 * stored under subblock `id`, which does not move — with one exception:
 * `data.canonicalModes` is keyed by canonical id, so the old entry is orphaned
 * and the pair reverts to whatever {@link backfillCanonicalModes} infers.
 *
 * That inference is right whenever exactly one side holds a value, which is why
 * this is a narrow migration rather than a general one. It is wrong when BOTH
 * sides hold values: `setBlockCanonicalMode` writes the mode without clearing
 * the sibling, so a workflow that uploaded a file, switched to advanced, and
 * typed a reference has both — and `resolveCanonicalMode` prefers basic, which
 * would silently swap which value the run uses.
 */
export interface CanonicalIdMigration {
  /** The canonical id a legacy saved state stores the mode under. */
  from: string
  /** The canonical id the block definition declares now. */
  to: string
}

/** Canonical-id renames per block type. */
export const CANONICAL_ID_MIGRATIONS: Record<string, readonly CanonicalIdMigration[]> = {}

/**
 * Renames persisted canonical-mode keys whose block definition moved them.
 *
 * Runs before {@link backfillCanonicalModes} so a carried-over selection is
 * already present and the backfill leaves it alone; anything genuinely missing
 * still gets inferred there.
 */
export function migrateCanonicalModeIds(blocks: Record<string, BlockState>): {
  blocks: Record<string, BlockState>
  migrated: boolean
} {
  let anyMigrated = false
  const result: Record<string, BlockState> = {}

  for (const [blockId, block] of Object.entries(blocks)) {
    const migrations = CANONICAL_ID_MIGRATIONS[block.type]
    const modes = block.data?.canonicalModes
    if (!migrations || !isPlainRecord(modes)) {
      result[blockId] = block
      continue
    }

    type CanonicalModes = Record<string, 'basic' | 'advanced'>
    let patched: CanonicalModes | null = null
    for (const { from, to } of migrations) {
      if (!(from in modes)) continue
      const next: CanonicalModes = patched ?? { ...(modes as CanonicalModes) }
      // A value already stored under the current id wins: it was written by the
      // current definition, so it is newer than the legacy one.
      if (!(to in next)) next[to] = next[from]
      delete next[from]
      patched = next
    }

    if (!patched) {
      result[blockId] = block
      continue
    }

    logger.info('Migrated legacy canonical-mode ids', { blockId: block.id, blockType: block.type })
    anyMigrated = true
    result[blockId] = { ...block, data: { ...block.data, canonicalModes: patched } }
  }

  return { blocks: result, migrated: anyMigrated }
}

/**
 * Backfills missing `canonicalModes` entries in block data.
 *
 * When a canonical pair is added to a block definition, existing blocks
 * won't have the entry in `data.canonicalModes`. Without it the editor
 * toggle may not render correctly. This resolves the correct mode based
 * on which subblock value is populated and adds the missing entry.
 */
export function backfillCanonicalModes(blocks: Record<string, BlockState>): {
  blocks: Record<string, BlockState>
  migrated: boolean
} {
  let anyMigrated = false
  const result: Record<string, BlockState> = {}

  for (const [blockId, block] of Object.entries(blocks)) {
    const blockConfig = getBlock(block.type)
    if (!blockConfig?.subBlocks || !block.subBlocks) {
      result[blockId] = block
      continue
    }

    // canonical-index-unscoped: the backfill writes a mode only for canonical PAIRS, whose two
    // members always sit on the same surface — a cross-surface alias joins an existing group
    // rather than forming a pair, so scoping cannot change what gets backfilled.
    const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks)
    const pairs = Object.values(canonicalIndex.groupsById).filter(isCanonicalPair)
    if (pairs.length === 0) {
      result[blockId] = block
      continue
    }

    const existing = (block.data?.canonicalModes ?? {}) as Record<string, 'basic' | 'advanced'>
    let patched: Record<string, 'basic' | 'advanced'> | null = null

    const values = buildSubBlockValues(block.subBlocks)

    for (const group of pairs) {
      if (existing[group.canonicalId] != null) continue

      const resolved = resolveCanonicalMode(group, values)
      if (!patched) patched = { ...existing }
      patched[group.canonicalId] = resolved
    }

    if (patched) {
      anyMigrated = true
      result[blockId] = {
        ...block,
        data: { ...(block.data ?? {}), canonicalModes: patched },
      }
    } else {
      result[blockId] = block
    }
  }

  return { blocks: result, migrated: anyMigrated }
}
