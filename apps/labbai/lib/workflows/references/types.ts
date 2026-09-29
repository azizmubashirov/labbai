/** Registered workspace references shared by workflow imports and fork synchronization. */
export const WORKFLOW_RESOURCE_KINDS = [
  'credential',
  'env-var',
  'knowledge-base',
  'knowledge-document',
  'table',
  'file',
  'file-folder',
  'mcp-server',
  'custom-tool',
  'skill',
  'sandbox',
] as const

export type WorkflowResourceKind = (typeof WORKFLOW_RESOURCE_KINDS)[number]
export type PortableResourceKind = WorkflowResourceKind | 'workflow'

export interface ReferenceOccurrence {
  blockId: string
  subBlockKey: string
  valuePath: Array<string | number>
  positions?: number[]
  encoding: 'scalar' | 'array' | 'csv' | 'files' | 'environment'
}

export interface PortableReference {
  kind: PortableResourceKind
  sourceId: string
  required: boolean
  occurrences: ReferenceOccurrence[]
}

export interface WorkflowReferenceManifest {
  version: 1
  references: PortableReference[]
}

/** Resolves a block identity in the destination graph; imports may use an identity resolver. */
export type WorkflowBlockIdResolver = (targetWorkflowId: string, sourceBlockId: string) => string

/**
 * A configured field that depends on a remappable parent resource (credential, knowledge base,
 * table or MCP server) and must be re-picked when that parent changes in the
 * destination workspace, e.g. during a workflow import.
 */
export interface ForkDependentReconfig {
  /** The remappable parent whose change makes this field reconfigurable. */
  parentKind: 'credential' | 'knowledge-base' | 'table' | 'mcp-server'
  /** Source id of that parent. */
  parentSourceId: string
  /** Selector context key the new parent value is supplied under. */
  parentContextKey?: string
  targetWorkflowId: string
  targetBlockId: string
  blockName: string
  subBlockKey: string
  /** Selector key. */
  selectorKey?: string
  multiSelect?: boolean
  /** Plain field title. */
  title: string
  /** Display name of the nested tool this field belongs to, if any. */
  toolName?: string
  /** Stable scope for one nested tool instance (e.g. `tools[0]`). */
  dependencyScope?: string
  /** Currently stored value, or empty string when unset. */
  currentValue: string
  /** Raw value in the source workflow state. */
  sourceValue: string
  /** Whether the field is required. */
  required: boolean
  /** Selector context key this field supplies to its in-block descendants. */
  providesContextKey?: string
  /** Selector context keys this field needs from in-block siblings. */
  consumesContextKeys: string[]
  /** Source-derived selector context. */
  context: Record<string, string>
}
