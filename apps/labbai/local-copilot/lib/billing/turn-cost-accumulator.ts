import type {
  ModelCallUsageListener,
  TokenUsageListener,
} from '@/local-copilot/lib/providers/types'
import { LIST_PRICE_POLICY, type ModelUsage, priceModelUsage } from '@/providers/cost-policy'
import { ANTHROPIC_CACHE_WRITE_MULTIPLIER } from '@/providers/openai-compat/anthropic-stream'
import { getModelPricing } from '@/providers/pricing'

/** Tools whose child-workflow cost already lands under `source='workflow'`. */
export const LOCAL_COPILOT_EXCLUDED_TOOL_COST_NAMES = new Set([
  'run_workflow',
  'run_workflow_until_block',
])

export type LocalTurnCostComponentKind = 'model' | 'tool'

export interface LocalTurnCostComponent {
  kind: LocalTurnCostComponentKind
  /** Model id or tool name / service label. */
  id: string
  /** Vendor COGS in USD before USAGE_LOG_COST_MULTIPLIER. */
  cost: number
  /** Cache-inclusive prompt tokens. */
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  /** Model / tool calls merged into this component (1 until aggregated for the ledger). */
  calls?: number
  /** Priced input portion (uncached + cache reads + cache writes). */
  inputCost?: number
  /** Priced output portion. */
  outputCost?: number
  vendor?: string
  provider?: string
  toolId?: string
}

export interface LocalTurnCostSummary {
  /** Sum of component vendor COGS. */
  total: number
  input: number
  output: number
  components: LocalTurnCostComponent[]
}

/**
 * Explicit billing metadata returned by Local tool execution. Prefer this over
 * scraping arbitrary user-facing tool output.
 */
export interface LocalToolBillingMetadata {
  /** Trusted hosted-tool / server-tool cost in USD (vendor COGS). */
  cost: number
  service?: string
  vendor?: string
  provider?: string
  toolId?: string
}

export interface PriceModelUsageParams {
  model: string
  /** Cache-inclusive prompt tokens. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  /** Anthropic prompt-cache writes (a subset of `inputTokens`). */
  cacheCreationTokens?: number
}

export interface PricedModelUsage {
  total: number
  input: number
  output: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/**
 * The catalog id to price: the id itself, or for an `openai/<id>` copilot id (Cloudflare
 * unified naming) the bare OpenAI id the catalog lists.
 */
function resolvePricingModelId(model: string): string {
  const trimmed = model.trim()
  if (getModelPricing(trimmed)) return trimmed
  const bare = trimmed.replace(/^openai\//i, '')
  return getModelPricing(bare) ? bare : trimmed
}

/**
 * Prices one model call with the catalog rates (`providers/models.ts`): uncached input at
 * the input price, cache reads at the cached-input price, Anthropic cache writes at the
 * 5-minute premium ({@link ANTHROPIC_CACHE_WRITE_MULTIPLIER} × input — the catalog has no
 * cache-write field). The input tier is chosen from the full prompt size.
 */
export function priceModelUsageWithCache(params: PriceModelUsageParams): PricedModelUsage {
  const inputTokens = Math.max(0, params.inputTokens)
  const outputTokens = Math.max(0, params.outputTokens)
  const cacheReadTokens = Math.min(Math.max(0, params.cacheReadTokens ?? 0), inputTokens)
  const cacheCreationTokens = Math.min(
    Math.max(0, params.cacheCreationTokens ?? 0),
    inputTokens - cacheReadTokens
  )
  const usage: ModelUsage = {
    input: inputTokens - cacheReadTokens - cacheCreationTokens,
    output: outputTokens,
    cacheRead: cacheReadTokens,
    ...(cacheCreationTokens > 0
      ? {
          cacheWrites: [
            { tokens: cacheCreationTokens, inputRateMultiplier: ANTHROPIC_CACHE_WRITE_MULTIPLIER },
          ],
        }
      : {}),
  }
  const priced = priceModelUsage(resolvePricingModelId(params.model), usage, LIST_PRICE_POLICY)

  return {
    total: priced.total,
    input: priced.input,
    output: priced.output,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  }
}

/**
 * Accumulates model and trusted tool costs for one Local Arena Copilot turn — every model
 * call made on the turn's behalf (main rounds, specialist / parallel subagent rounds,
 * stagnation recovery, session-memory summaries, live status lines). Does not write the
 * ledger; the turn flushes once (see `recordLocalCopilotTurnUsage`).
 */
export class LocalTurnCostAccumulator {
  private readonly components: LocalTurnCostComponent[] = []

  /** Prices one model call via the cache-aware catalog pricing and records the component. */
  addModelUsage(params: {
    model: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    provider?: string
    vendor?: string
  }): LocalTurnCostComponent | null {
    if (params.inputTokens <= 0 && params.outputTokens <= 0) {
      return null
    }

    const priced = priceModelUsageWithCache({
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      cacheReadTokens: params.cacheReadTokens,
      cacheCreationTokens: params.cacheCreationTokens,
    })
    if (priced.total <= 0) {
      return null
    }

    const component: LocalTurnCostComponent = {
      kind: 'model',
      id: params.model,
      cost: priced.total,
      inputTokens: priced.inputTokens,
      outputTokens: priced.outputTokens,
      cacheReadTokens: priced.cacheReadTokens,
      cacheCreationTokens: priced.cacheCreationTokens,
      calls: 1,
      inputCost: priced.input,
      outputCost: priced.output,
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.vendor ? { vendor: params.vendor } : {}),
    }
    this.components.push(component)
    return component
  }

  /**
   * A {@link TokenUsageListener} that records each model call it hears under `model`.
   * Pass it as `onUsage` on every provider request made for the turn.
   */
  usageListener(model: string, provider?: string): TokenUsageListener {
    return (usage) => {
      this.addModelUsage({
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        ...(provider ? { provider } : {}),
      })
    }
  }

  /** Records usage reported by a side call that resolves its own model (status, memory). */
  readonly recordModelCall: ModelCallUsageListener = ({ model, usage }) => {
    this.usageListener(model)(usage)
  }

  /**
   * Records a trusted tool cost. Excludes `run_workflow*` child-workflow spend
   * and ignores non-positive amounts.
   */
  addToolBilling(params: {
    toolName: string
    billing: LocalToolBillingMetadata | null | undefined
  }): LocalTurnCostComponent | null {
    if (LOCAL_COPILOT_EXCLUDED_TOOL_COST_NAMES.has(params.toolName)) {
      return null
    }
    const billing = params.billing
    if (!billing || !(billing.cost > 0)) {
      return null
    }

    const component: LocalTurnCostComponent = {
      kind: 'tool',
      id: billing.toolId ?? billing.service ?? params.toolName,
      cost: billing.cost,
      calls: 1,
      ...(billing.vendor ? { vendor: billing.vendor } : {}),
      ...(billing.provider ? { provider: billing.provider } : {}),
      ...(billing.toolId || params.toolName ? { toolId: billing.toolId ?? params.toolName } : {}),
    }
    this.components.push(component)
    return component
  }

  /** Snapshot of accumulated components (one per call) and totals. */
  summarize(): LocalTurnCostSummary {
    let total = 0
    let input = 0
    let output = 0
    for (const component of this.components) {
      total += component.cost
      if (component.kind !== 'model') continue
      input += component.inputCost ?? 0
      output += component.outputCost ?? 0
    }

    return {
      total: Number.parseFloat(total.toFixed(8)),
      input: Number.parseFloat(input.toFixed(8)),
      output: Number.parseFloat(output.toFixed(8)),
      components: [...this.components],
    }
  }
}

/**
 * Merges per-call components into one ledger line per (kind, id): costs, tokens and call
 * counts are summed. The ledger's component event key is `…:<kind>:<id>` and inserts are
 * `ON CONFLICT DO NOTHING`, so writing one row per call would keep only the first call of
 * each model (or tool) in a turn and silently drop the rest.
 */
export function aggregateLedgerComponents(
  components: LocalTurnCostComponent[]
): LocalTurnCostComponent[] {
  const merged = new Map<string, LocalTurnCostComponent>()
  for (const component of components) {
    const key = `${component.kind}:${component.id}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...component, calls: component.calls ?? 1 })
      continue
    }
    existing.cost += component.cost
    existing.calls = (existing.calls ?? 1) + (component.calls ?? 1)
    existing.inputTokens = sumOptional(existing.inputTokens, component.inputTokens)
    existing.outputTokens = sumOptional(existing.outputTokens, component.outputTokens)
    existing.cacheReadTokens = sumOptional(existing.cacheReadTokens, component.cacheReadTokens)
    existing.cacheCreationTokens = sumOptional(
      existing.cacheCreationTokens,
      component.cacheCreationTokens
    )
    existing.inputCost = sumOptional(existing.inputCost, component.inputCost)
    existing.outputCost = sumOptional(existing.outputCost, component.outputCost)
  }
  return [...merged.values()].map((component) => ({
    ...component,
    cost: Number.parseFloat(component.cost.toFixed(8)),
  }))
}

function sumOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined
  return (left ?? 0) + (right ?? 0)
}

/**
 * Extracts trusted billing metadata from a Local tool result payload.
 * Accepts explicit `billing` on the execution result, `_serviceCost` from
 * server tools, and canonical `cost.total` / `cost.costDollars` shapes.
 */
export function extractLocalToolBillingMetadata(result: unknown): LocalToolBillingMetadata | null {
  if (!result || typeof result !== 'object') return null
  const record = result as Record<string, unknown>

  const explicit = record.billing
  if (explicit && typeof explicit === 'object') {
    const billing = explicit as Record<string, unknown>
    const cost = typeof billing.cost === 'number' ? billing.cost : null
    if (cost != null && cost > 0) {
      return {
        cost,
        ...(typeof billing.service === 'string' ? { service: billing.service } : {}),
        ...(typeof billing.vendor === 'string' ? { vendor: billing.vendor } : {}),
        ...(typeof billing.provider === 'string' ? { provider: billing.provider } : {}),
        ...(typeof billing.toolId === 'string' ? { toolId: billing.toolId } : {}),
      }
    }
  }

  const serviceCost = record._serviceCost
  if (serviceCost && typeof serviceCost === 'object') {
    const sc = serviceCost as Record<string, unknown>
    const cost = typeof sc.cost === 'number' ? sc.cost : null
    if (cost != null && cost > 0) {
      return {
        cost,
        ...(typeof sc.service === 'string' ? { service: sc.service } : {}),
      }
    }
  }

  const costNode = record.cost
  if (costNode && typeof costNode === 'object') {
    const cost = costNode as Record<string, unknown>
    if (typeof cost.total === 'number' && cost.total > 0) {
      return { cost: cost.total }
    }
    if (typeof cost.costDollars === 'number' && cost.costDollars > 0) {
      return { cost: cost.costDollars }
    }
  }

  return null
}
