/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createNotificationTriggerBodySchema,
  notificationTriggerShapeError,
  updateNotificationTriggerBodySchema,
} from '@/lib/api/contracts/notifications'

describe('notification trigger contracts', () => {
  it('fills defaults for a message trigger', () => {
    expect(
      createNotificationTriggerBodySchema.parse({
        name: ' Needs a person ',
        condition: 'Customer asks for an operator',
      })
    ).toEqual({
      name: 'Needs a person',
      direction: 'inbound',
      condition: 'Customer asks for an operator',
      eventKey: null,
      extractSpec: '',
      pauseMode: 'none',
      pauseMinutes: 15,
      autoResume: true,
      pauseNotice: '',
      cooldownMinutes: 60,
      oncePerConversation: false,
      isActive: true,
      workflowId: null,
    })
  })

  it('needs a condition for message triggers and an event for event triggers', () => {
    expect(createNotificationTriggerBodySchema.safeParse({ name: 'X' }).success).toBe(false)
    expect(
      createNotificationTriggerBodySchema.safeParse({ name: 'X', direction: 'event' }).success
    ).toBe(false)
    expect(
      createNotificationTriggerBodySchema.safeParse({
        name: 'X',
        direction: 'event',
        eventKey: 'operator_handoff',
      }).success
    ).toBe(true)
  })

  it('rejects unknown events, pause modes and out-of-range minutes', () => {
    const base = { name: 'X', condition: 'c' }
    for (const body of [
      { ...base, direction: 'event', eventKey: 'order_paid' },
      { ...base, pauseMode: 'forever' },
      { ...base, pauseMinutes: 0 },
      { ...base, pauseMinutes: 24 * 60 + 1 },
      { ...base, cooldownMinutes: -1 },
      { ...base, name: '' },
    ]) {
      expect(createNotificationTriggerBodySchema.safeParse(body).success).toBe(false)
    }
  })

  it('accepts a partial update but not an empty one', () => {
    expect(updateNotificationTriggerBodySchema.safeParse({ isActive: false }).success).toBe(true)
    expect(updateNotificationTriggerBodySchema.safeParse({}).success).toBe(false)
  })

  it('names the missing field of a trigger', () => {
    expect(
      notificationTriggerShapeError({ direction: 'outbound', condition: ' ', eventKey: null })
    ).toMatchObject({ path: 'condition' })
    expect(
      notificationTriggerShapeError({ direction: 'event', condition: '', eventKey: null })
    ).toMatchObject({ path: 'eventKey' })
    expect(
      notificationTriggerShapeError({
        direction: 'event',
        condition: '',
        eventKey: 'booking_link_sent',
      })
    ).toBeNull()
  })
})
