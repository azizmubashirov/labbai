/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolveConfig: vi.fn(), executeTool: vi.fn() }))

vi.mock('@/tools', () => ({ executeTool: mocks.executeTool }))
vi.mock('@/lib/inbox/channel-config', () => ({
  resolveConversationChannelConfig: mocks.resolveConfig,
  configString: (config: Record<string, unknown>, key: string) =>
    typeof config[key] === 'string' ? config[key] : null,
}))

import { friendlyChannelError, sendInboxReply } from '@/lib/inbox/send'

const instagramConversation = {
  id: 'c1',
  workspaceId: 'ws',
  channel: 'instagram',
  accountId: 'IG1',
  externalChatId: 'U1',
  webhookId: 'wh',
} as never

describe('friendlyChannelError', () => {
  it('explains the messaging window on Instagram and WhatsApp', () => {
    expect(
      friendlyChannelError('instagram', '(#10) This message is sent outside of allowed window.')
    ).toContain('24 hours')
    expect(
      friendlyChannelError('whatsapp', 'Re-engagement message — more than 24 hours (code 131047)')
    ).toContain('approved template')
  })

  it('explains a blocked Telegram bot and keeps unknown errors as they are', () => {
    expect(friendlyChannelError('telegram', 'Forbidden: bot was blocked by the user')).toBe(
      'The customer blocked this bot on Telegram.'
    )
    expect(friendlyChannelError('telegram', 'Bad Request: message is too long')).toBe(
      'Bad Request: message is too long'
    )
  })
})

describe('sendInboxReply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends an Instagram reply through the trigger credential as the operator', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { credentialId: 'cred-1' } })
    mocks.executeTool.mockResolvedValue({ success: true, output: { messageId: 'mid.9' } })

    const outcome = await sendInboxReply({
      conversation: instagramConversation,
      text: 'Salom',
      operatorUserId: 'op-1',
    })

    expect(mocks.executeTool).toHaveBeenCalledWith('instagram_send_text_message', {
      credential: 'cred-1',
      igUserId: 'IG1',
      recipientId: 'U1',
      message: 'Salom',
      _context: { userId: 'op-1', workspaceId: 'ws', enforceCredentialAccess: true },
    })
    expect(outcome).toEqual({ status: 'sent', externalMessageId: 'mid.9' })
  })

  it('reports the messaging window in plain words', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { credentialId: 'cred-1' } })
    mocks.executeTool.mockResolvedValue({
      success: false,
      error: 'This message is sent outside of allowed window.',
    })
    const outcome = await sendInboxReply({
      conversation: instagramConversation,
      text: 'Salom',
      operatorUserId: 'op-1',
    })
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringContaining('24 hours') })
  })

  it('does not call the channel when the trigger is gone', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: false, error: 'The trigger is gone.' })
    const outcome = await sendInboxReply({
      conversation: instagramConversation,
      text: 'Salom',
      operatorUserId: 'op-1',
    })
    expect(outcome).toEqual({ status: 'failed', error: 'The trigger is gone.' })
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })
})
