/**
 * Per-turn budget for Local Copilot specialist invocations (pre-pass + mid-turn + nested)
 * and for model rounds.
 *
 * Depth is parent-relative: callers pass the parent agent depth (main = 0). Parallel
 * siblings under the same parent each call `tryEnter(parentDepth)` and receive
 * `parentDepth + 1`.
 *
 * Model rounds are one shared budget per user message: every model call of the main
 * loop and of every specialist / parallel subagent (at any depth) takes a round with
 * `tryConsumeModelRound()` before it is sent. Once the budget is spent no further model
 * call is made in the turn and the turn ends by asking the user whether to continue
 * (`COPILOT_MAX_ROUNDS_PER_TURN`, default {@link DEFAULT_MAX_MODEL_ROUNDS_PER_TURN}).
 */

/**
 * Specialists are leaves: the main agent delegates, a specialist does not delegate again.
 * Nested delegation re-discovered the workspace at each level and multiplied model rounds.
 */
export const MAX_SPECIALIST_DEPTH = 1
export const MAX_SPECIALIST_CONCURRENT = 4
export const MAX_SPECIALIST_INVOCATIONS = 8
export const SPECIALIST_TIMEOUT_MS = 90_000
/** Model rounds per user message (main + specialists + subagents) when unconfigured. */
export const DEFAULT_MAX_MODEL_ROUNDS_PER_TURN = 20

export interface SpecialistBudgetOptions {
  maxDepth?: number
  maxConcurrent?: number
  maxInvocations?: number
  timeoutMs?: number
  maxModelRounds?: number
}

export interface SpecialistBudgetEnterOk {
  ok: true
  depth: number
  release: () => void
}

export interface SpecialistBudgetEnterFail {
  ok: false
  reason: string
}

export type SpecialistBudgetEnterResult = SpecialistBudgetEnterOk | SpecialistBudgetEnterFail

export interface SpecialistBudget {
  readonly maxDepth: number
  readonly maxConcurrent: number
  readonly maxInvocations: number
  readonly timeoutMs: number
  readonly invocationCount: number
  readonly activeCount: number
  readonly maxDepthReached: number
  readonly maxModelRounds: number
  readonly modelRoundCount: number
  /** True once a model round was refused because the turn's round budget is spent. */
  readonly modelRoundCapReached: boolean
  /**
   * Takes one model round from the turn's shared budget. Returns false (and sends
   * nothing) once `maxModelRounds` rounds were taken this turn.
   */
  tryConsumeModelRound: () => boolean
  /**
   * Reserves one specialist slot at `parentDepth + 1`.
   * Main agent uses `tryEnter(0)`; a specialist at depth N nests with `tryEnter(N)`.
   */
  tryEnter: (parentDepth?: number) => SpecialistBudgetEnterResult
  snapshot: () => {
    invocationCount: number
    activeCount: number
    maxDepthReached: number
    modelRoundCount: number
    maxModelRounds: number
  }
}

/**
 * Creates a turn-scoped specialist budget.
 */
export function createSpecialistBudget(options: SpecialistBudgetOptions = {}): SpecialistBudget {
  const maxDepth = options.maxDepth ?? MAX_SPECIALIST_DEPTH
  const maxConcurrent = options.maxConcurrent ?? MAX_SPECIALIST_CONCURRENT
  const maxInvocations = options.maxInvocations ?? MAX_SPECIALIST_INVOCATIONS
  const timeoutMs = options.timeoutMs ?? SPECIALIST_TIMEOUT_MS
  const maxModelRounds = Math.max(
    1,
    Math.floor(options.maxModelRounds ?? DEFAULT_MAX_MODEL_ROUNDS_PER_TURN)
  )

  let invocationCount = 0
  let activeCount = 0
  let maxDepthReached = 0
  let modelRoundCount = 0
  let modelRoundCapReached = false

  const budget: SpecialistBudget = {
    maxDepth,
    maxConcurrent,
    maxInvocations,
    timeoutMs,
    get invocationCount() {
      return invocationCount
    },
    get activeCount() {
      return activeCount
    },
    get maxDepthReached() {
      return maxDepthReached
    },
    maxModelRounds,
    get modelRoundCount() {
      return modelRoundCount
    },
    get modelRoundCapReached() {
      return modelRoundCapReached
    },
    tryConsumeModelRound() {
      if (modelRoundCount >= maxModelRounds) {
        modelRoundCapReached = true
        return false
      }
      modelRoundCount += 1
      return true
    },
    tryEnter(parentDepth = 0): SpecialistBudgetEnterResult {
      if (invocationCount >= maxInvocations) {
        return {
          ok: false,
          reason: `Specialist invocation budget exhausted (${maxInvocations} per turn)`,
        }
      }
      if (activeCount >= maxConcurrent) {
        return {
          ok: false,
          reason: `Specialist concurrency limit reached (${maxConcurrent} concurrent)`,
        }
      }
      const nextDepth = parentDepth + 1
      if (nextDepth > maxDepth) {
        return {
          ok: false,
          reason: `Specialist nesting depth exceeded (max ${maxDepth})`,
        }
      }

      invocationCount += 1
      activeCount += 1
      if (nextDepth > maxDepthReached) {
        maxDepthReached = nextDepth
      }

      let released = false
      return {
        ok: true,
        depth: nextDepth,
        release: () => {
          if (released) return
          released = true
          activeCount = Math.max(0, activeCount - 1)
        },
      }
    },
    snapshot() {
      return {
        invocationCount,
        activeCount,
        maxDepthReached,
        modelRoundCount,
        maxModelRounds,
      }
    },
  }

  return budget
}
