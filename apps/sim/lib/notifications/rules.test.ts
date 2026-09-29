/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  collectDeployedNotificationRules,
  createNotificationRule,
  notificationRuleProblem,
  notificationTriggerRowId,
  readNotificationRules,
} from '@/lib/notifications/rules'

describe('readNotificationRules', () => {
  it('fills defaults and clears the half of a rule that does not apply', () => {
    const [message, event] = readNotificationRules([
      {
        id: 'r1',
        name: ' Needs a person ',
        direction: 'outbound',
        condition: ' The agent promises a call ',
        eventKey: 'payment_receipt',
      },
      {
        id: 'r2',
        name: 'Receipt',
        direction: 'event',
        eventKey: 'payment_receipt',
        condition: 'leftover',
        extractSpec: 'leftover',
      },
    ])
    expect(message).toEqual({
      ...createNotificationRule('r1'),
      name: 'Needs a person',
      direction: 'outbound',
      condition: 'The agent promises a call',
    })
    expect(event).toMatchObject({
      direction: 'event',
      eventKey: 'payment_receipt',
      condition: '',
      extractSpec: '',
    })
  })

  it('clamps minutes and drops unknown enum values', () => {
    const [rule] = readNotificationRules([
      {
        id: 'r1',
        name: 'X',
        direction: 'sometimes',
        pauseMode: 'forever',
        pauseMinutes: 999_999,
        cooldownMinutes: -5,
        condition: 'c',
      },
    ])
    expect(rule).toMatchObject({
      direction: 'inbound',
      pauseMode: 'none',
      pauseMinutes: 24 * 60,
      cooldownMinutes: 0,
    })
  })

  it('reads nothing from a malformed value and keeps ids unique and safe', () => {
    expect(readNotificationRules(undefined)).toEqual([])
    expect(readNotificationRules('not json')).toEqual([])
    expect(readNotificationRules({ id: 'r1' })).toEqual([])
    const rules = readNotificationRules([
      { id: 'same', name: 'A', condition: 'a' },
      { id: 'same', name: 'B', condition: 'b' },
      { id: 'has spaces/and slashes', name: 'C', condition: 'c' },
      null,
    ])
    expect(rules.map((rule) => rule.id)).toEqual(['same', 'same-2', 'rule-3'])
  })

  it('reads a JSON string the way it reads an array', () => {
    expect(readNotificationRules(JSON.stringify([{ id: 'r1', name: 'A' }]))).toHaveLength(1)
  })
})

describe('notificationRuleProblem', () => {
  it('needs a name, a condition for message rules and an event for event rules', () => {
    const rule = createNotificationRule('r1')
    expect(notificationRuleProblem(rule)).toBe('Give the rule a name')
    expect(notificationRuleProblem({ ...rule, name: 'X' })).toBe(
      'Describe when the alert should fire'
    )
    expect(notificationRuleProblem({ ...rule, name: 'X', condition: 'c' })).toBeNull()
    expect(notificationRuleProblem({ ...rule, name: 'X', direction: 'event' })).toBe(
      'Choose the event to watch'
    )
    expect(
      notificationRuleProblem({
        ...rule,
        name: 'X',
        direction: 'event',
        eventKey: 'operator_handoff',
      })
    ).toBeNull()
  })
})

describe('collectDeployedNotificationRules', () => {
  it('takes the valid rules of enabled Notifications blocks only, at most ten', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `r${index}`,
      name: `Rule ${index}`,
      condition: 'c',
    }))
    const collected = collectDeployedNotificationRules({
      notifications: { type: 'notifications', subBlocks: { rules: { value: many } } },
      disabled: {
        type: 'notifications',
        enabled: false,
        subBlocks: { rules: { value: [{ id: 'x', name: 'X', condition: 'c' }] } },
      },
      agent: { type: 'agent', subBlocks: { rules: { value: [{ id: 'y', name: 'Y' }] } } },
    })
    expect(collected).toHaveLength(10)
    expect(collected.every(({ blockId }) => blockId === 'notifications')).toBe(true)
  })

  it('skips rules that could not take effect', () => {
    const collected = collectDeployedNotificationRules({
      n: {
        type: 'notifications',
        subBlocks: {
          rules: {
            value: [
              { id: 'ok', name: 'OK', condition: 'c' },
              { id: 'no-name', condition: 'c' },
              { id: 'no-event', name: 'E', direction: 'event' },
            ],
          },
        },
      },
    })
    expect(collected.map(({ rule }) => rule.id)).toEqual(['ok'])
  })

  it('reads no rules from an empty state', () => {
    expect(collectDeployedNotificationRules(undefined)).toEqual([])
    expect(collectDeployedNotificationRules({ broken: null })).toEqual([])
  })
})

describe('notificationTriggerRowId', () => {
  it('is deterministic per workflow, block and rule', () => {
    expect(notificationTriggerRowId('wf-1', 'b-1', 'r1')).toBe('ntr_wf-1_b-1_r1')
    expect(notificationTriggerRowId('wf-2', 'b-1', 'r1')).not.toBe(
      notificationTriggerRowId('wf-1', 'b-1', 'r1')
    )
  })
})
