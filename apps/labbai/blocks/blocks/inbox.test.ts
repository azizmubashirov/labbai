/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { InboxBlock } from '@/blocks/blocks/inbox'
import { inboxSetAiTool } from '@/tools/inbox'

function params(overrides: Record<string, unknown>) {
  const paramsFn = InboxBlock.tools.config?.params
  if (!paramsFn) throw new Error('expected a params transform')
  return paramsFn({ operation: 'turn_ai_off', channel: 'telegram', chatId: '555', ...overrides })
}

describe('Inbox block', () => {
  it('routes both operations to the one AI switch tool', () => {
    expect(InboxBlock.tools.access).toEqual(['inbox_set_ai'])
    expect(InboxBlock.tools.config?.tool({ operation: 'turn_ai_on' })).toBe('inbox_set_ai')
    expect(InboxBlock.tools.config?.tool({ operation: 'turn_ai_off' })).toBe('inbox_set_ai')
  })

  it('maps Turn AI off and Turn AI on to the enabled flag', () => {
    expect(params({})).toEqual({
      channel: 'telegram',
      chatId: '555',
      accountId: undefined,
      enabled: false,
    })
    expect(params({ operation: 'turn_ai_on' })).toMatchObject({ enabled: true })
  })

  it('accepts a numeric chat id from a trigger and trims ids', () => {
    expect(params({ chatId: 123456789, accountId: ' 777 ' })).toMatchObject({
      chatId: '123456789',
      accountId: '777',
    })
  })

  it('fails the block when the chat id resolves to nothing', () => {
    expect(() => params({ chatId: '  ' })).toThrow('Customer Chat ID is required')
  })

  it('keeps block outputs aligned with the tool outputs', () => {
    expect(Object.keys(InboxBlock.outputs)).toEqual(Object.keys(inboxSetAiTool.outputs ?? {}))
  })

  it('never carries a workspace in the operation input', () => {
    expect(
      inboxSetAiTool.operation.input({
        channel: 'telegram',
        chatId: 555,
        accountId: '',
        enabled: false,
      })
    ).toEqual({ channel: 'telegram', chatId: '555', enabled: false })
  })
})
