/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createSpecialistBudget,
  DEFAULT_MAX_MODEL_ROUNDS_PER_TURN,
} from '@/local-copilot/lib/agent/specialists/budget'

describe('createSpecialistBudget model rounds', () => {
  it('defaults to 20 rounds per turn', () => {
    expect(DEFAULT_MAX_MODEL_ROUNDS_PER_TURN).toBe(20)
    expect(createSpecialistBudget().maxModelRounds).toBe(20)
  })

  it('shares one round budget across every caller and refuses past the cap', () => {
    const budget = createSpecialistBudget({ maxModelRounds: 3 })
    expect(budget.tryConsumeModelRound()).toBe(true)
    expect(budget.tryConsumeModelRound()).toBe(true)
    expect(budget.tryConsumeModelRound()).toBe(true)
    expect(budget.modelRoundCapReached).toBe(false)

    expect(budget.tryConsumeModelRound()).toBe(false)
    expect(budget.tryConsumeModelRound()).toBe(false)
    expect(budget.modelRoundCount).toBe(3)
    expect(budget.modelRoundCapReached).toBe(true)
    expect(budget.snapshot()).toMatchObject({ modelRoundCount: 3, maxModelRounds: 3 })
  })

  it('keeps at least one round', () => {
    expect(createSpecialistBudget({ maxModelRounds: 0 }).maxModelRounds).toBe(1)
  })
})
