/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildNotificationJudgePrompt,
  type JudgeCompletion,
  judgeNotificationTriggers,
  parseNotificationVerdict,
} from '@/lib/notifications/evaluator'

const HUMAN = {
  name: 'Customer wants a person',
  condition: 'Fires when the customer asks for an operator.',
  extractSpec: 'name and phone',
}
const PROMISE = { name: 'Agent promised', condition: 'Fires on a concrete promise.', extractSpec: '' }

function completion(content: string | null): JudgeCompletion {
  return { content, model: 'gpt-4.1-mini', promptTokens: 120, completionTokens: 20 }
}

describe('buildNotificationJudgePrompt', () => {
  it('numbers the rules and marks the judged message last', () => {
    const prompt = buildNotificationJudgePrompt({
      triggers: [HUMAN, PROMISE],
      history: [
        { author: 'customer', text: 'Salom' },
        { author: 'agent', text: 'Assalomu alaykum!' },
        { author: 'customer', text: 'Operator bering' },
      ],
      text: 'Operator bering',
      direction: 'inbound',
    })

    expect(prompt).toContain('RULE 1: Customer wants a person')
    expect(prompt).toContain('If it fires, also collect: name and phone')
    expect(prompt).toContain('RULE 2: Agent promised')
    expect(prompt).not.toContain('RULE 2: Agent promised\nFires on a concrete promise.\nIf it fires')
    expect(prompt).toContain('CUSTOMER: Salom\nASSISTANT: Assalomu alaykum!')
    expect(prompt.endsWith('>>> CUSTOMER: Operator bering')).toBe(true)
    expect(prompt.match(/Operator bering/g)).toHaveLength(1)
  })

  it('marks an agent reply for outbound triggers', () => {
    const prompt = buildNotificationJudgePrompt({
      triggers: [PROMISE],
      history: [],
      text: 'Ertaga qo‘ng‘iroq qilamiz',
      direction: 'outbound',
    })
    expect(prompt.endsWith('>>> ASSISTANT: Ertaga qo‘ng‘iroq qilamiz')).toBe(true)
  })
})

describe('parseNotificationVerdict', () => {
  it('reads fired rules with their reason and details', () => {
    expect(
      parseNotificationVerdict(
        JSON.stringify({
          fired: [
            {
              rule: 2,
              reason: 'Asked for a manager',
              details: { name: 'Aziz', phone: 998901234567, empty: '' },
            },
          ],
        }),
        2
      )
    ).toEqual([
      { index: 1, reason: 'Asked for a manager', details: { name: 'Aziz', phone: '998901234567' } },
    ])
  })

  it('treats an empty list as nothing fired', () => {
    expect(parseNotificationVerdict('{"fired": []}', 3)).toEqual([])
  })

  it('reads malformed output as nothing fired', () => {
    expect(parseNotificationVerdict('not json', 2)).toEqual([])
    expect(parseNotificationVerdict('{"fired": "yes"}', 2)).toEqual([])
    expect(parseNotificationVerdict(null, 2)).toEqual([])
    expect(parseNotificationVerdict('[1, 2]', 2)).toEqual([])
  })

  it('ignores rule numbers outside the list, fractions and repeats', () => {
    expect(
      parseNotificationVerdict(
        {
          fired: [
            { rule: 0 },
            { rule: 3 },
            { rule: 1.5 },
            { rule: 'x' },
            { rule: '1', reason: 'first' },
            { rule: 1, reason: 'again' },
          ],
        },
        2
      )
    ).toEqual([{ index: 0, reason: 'first', details: {} }])
  })
})

describe('judgeNotificationTriggers', () => {
  it('returns the triggers the model fired and reports usage', async () => {
    const complete = vi.fn(async () =>
      completion('{"fired":[{"rule":1,"reason":"Wants an operator","details":{"name":"Aziz"}}]}')
    )
    const onUsage = vi.fn()
    const verdicts = await judgeNotificationTriggers({
      triggers: [HUMAN, PROMISE],
      history: [],
      text: 'Operator bering',
      direction: 'inbound',
      complete,
      onUsage,
    })

    expect(verdicts).toEqual([
      { trigger: HUMAN, reason: 'Wants an operator', details: { name: 'Aziz' } },
    ])
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0][0].system).toContain('Judge ONLY the LAST message')
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ promptTokens: 120 }))
  })

  it('never throws: a failing model means no alert', async () => {
    const complete = vi.fn(async () => {
      throw new Error('OpenAI 500')
    })
    await expect(
      judgeNotificationTriggers({
        triggers: [HUMAN],
        history: [],
        text: 'Operator bering',
        direction: 'inbound',
        complete,
      })
    ).resolves.toEqual([])
  })

  it('does not call the model without triggers or text', async () => {
    const complete = vi.fn(async () => completion('{"fired":[]}'))
    await judgeNotificationTriggers({
      triggers: [],
      history: [],
      text: 'hi',
      direction: 'inbound',
      complete,
    })
    await judgeNotificationTriggers({
      triggers: [HUMAN],
      history: [],
      text: '   ',
      direction: 'inbound',
      complete,
    })
    expect(complete).not.toHaveBeenCalled()
  })

  it('keeps the verdicts when recording usage fails', async () => {
    const verdicts = await judgeNotificationTriggers({
      triggers: [HUMAN],
      history: [],
      text: 'Operator bering',
      direction: 'inbound',
      complete: async () => completion('{"fired":[{"rule":1,"reason":"x"}]}'),
      onUsage: () => {
        throw new Error('ledger down')
      },
    })
    expect(verdicts).toHaveLength(1)
  })
})
