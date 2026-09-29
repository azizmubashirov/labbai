/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isInboxAiActive, settleInboxAiPause } from '@/lib/inbox/ai-pause'

const NOW = new Date('2026-09-28T12:00:00Z')
const LATER = new Date('2026-09-28T12:30:00Z')
const EARLIER = new Date('2026-09-28T11:30:00Z')

describe('Inbox AI pause', () => {
  it('answers while AI is on', () => {
    expect(isInboxAiActive({ aiEnabled: true, aiPausedUntil: null }, NOW)).toBe(true)
  })

  it('stays quiet while a temporary pause runs', () => {
    expect(isInboxAiActive({ aiEnabled: false, aiPausedUntil: LATER }, NOW)).toBe(false)
  })

  it('answers again once a temporary pause has run out', () => {
    expect(isInboxAiActive({ aiEnabled: false, aiPausedUntil: EARLIER }, NOW)).toBe(true)
    expect(isInboxAiActive({ aiEnabled: false, aiPausedUntil: NOW }, NOW)).toBe(true)
  })

  it('stays off after a person (or a hard pause) switched it off', () => {
    expect(isInboxAiActive({ aiEnabled: false, aiPausedUntil: null }, NOW)).toBe(false)
  })

  it('reads a run-out pause as AI on and leaves everything else as stored', () => {
    const row = { id: 'conv-1', aiEnabled: false, aiPausedUntil: EARLIER }
    expect(settleInboxAiPause(row, NOW)).toEqual({ id: 'conv-1', aiEnabled: true, aiPausedUntil: null })

    const paused = { id: 'conv-2', aiEnabled: false, aiPausedUntil: LATER }
    expect(settleInboxAiPause(paused, NOW)).toBe(paused)
    const off = { id: 'conv-3', aiEnabled: false, aiPausedUntil: null }
    expect(settleInboxAiPause(off, NOW)).toBe(off)
  })
})
