/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { NotifyBlock } from '@/blocks/blocks/notify'
import { notifySendTool } from '@/tools/notify'

function params(overrides: Record<string, unknown>) {
  const paramsFn = NotifyBlock.tools.config?.params
  if (!paramsFn) throw new Error('expected a params transform')
  return paramsFn({
    operation: 'fire_event',
    eventKey: 'operator_handoff',
    channel: 'telegram',
    chatId: '555',
    ...overrides,
  })
}

describe('Notify block', () => {
  it('routes both operations to the one notify tool', () => {
    expect(NotifyBlock.tools.access).toEqual(['notify_send'])
    expect(NotifyBlock.tools.config?.tool({ operation: 'send_message' })).toBe('notify_send')
    expect(NotifyBlock.tools.config?.tool({ operation: 'fire_event' })).toBe('notify_send')
  })

  it('maps Fire event to an event with the chat and an optional reason', () => {
    expect(params({ chatId: 123456789, message: ' Wholesale ' })).toEqual({
      kind: 'event',
      eventKey: 'operator_handoff',
      message: 'Wholesale',
      channel: 'telegram',
      chatId: '123456789',
      accountId: undefined,
    })
  })

  it('maps Send message to a message, with the chat only when given', () => {
    expect(params({ operation: 'send_message', message: 'Hi', chatId: '' })).toEqual({
      kind: 'message',
      eventKey: undefined,
      message: 'Hi',
      channel: undefined,
      chatId: undefined,
      accountId: undefined,
    })
  })

  it('fails the block when a required value resolves to nothing', () => {
    expect(() => params({ chatId: '  ' })).toThrow('Customer Chat ID is required')
    expect(() => params({ operation: 'send_message', message: ' ' })).toThrow(
      'Message is required'
    )
  })

  it('keeps block outputs aligned with the tool outputs', () => {
    expect(Object.keys(NotifyBlock.outputs)).toEqual(Object.keys(notifySendTool.outputs ?? {}))
  })

  it('never carries a workspace in the operation input', () => {
    expect(
      notifySendTool.operation.input({
        kind: 'event',
        eventKey: 'payment_receipt',
        message: '',
        channel: 'whatsapp',
        chatId: 998901234567,
        accountId: '',
      })
    ).toEqual({
      kind: 'event',
      eventKey: 'payment_receipt',
      channel: 'whatsapp',
      chatId: '998901234567',
    })
    expect(notifySendTool.operation.input({ kind: 'message', message: ' Hi ' })).toEqual({
      kind: 'message',
      message: 'Hi',
    })
  })
})
