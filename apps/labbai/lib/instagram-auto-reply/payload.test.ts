/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildAutoReplyPayload,
  isAutoReplyPayload,
  parseAutoReplyPayload,
} from '@/lib/instagram-auto-reply/payload'

const EVENT_ID = '3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c'

describe('auto-reply postback payloads', () => {
  it('round-trips an event id and action', () => {
    const payload = buildAutoReplyPayload(EVENT_ID, 'followed')
    expect(payload).toBe(`iar:${EVENT_ID}:followed`)
    expect(isAutoReplyPayload(payload)).toBe(true)
    expect(parseAutoReplyPayload(payload)).toEqual({ eventId: EVENT_ID, action: 'followed' })
  })

  it('rejects payloads that are not ours or not well formed', () => {
    for (const payload of [
      'MENU_MAIN',
      'iar:',
      `iar:${EVENT_ID}`,
      `iar:${EVENT_ID}:delete`,
      `iar:${EVENT_ID}:open:extra`,
      'iar:../../x:open',
      `IAR:${EVENT_ID}:open`,
    ]) {
      expect(parseAutoReplyPayload(payload)).toBeNull()
    }
  })
})
