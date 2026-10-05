/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLink: vi.fn(),
  acquireLease: vi.fn(),
  releaseLease: vi.fn(),
  defer: vi.fn(),
  getConversation: vi.fn(),
  listUndelivered: vi.fn(),
  recordDelivery: vi.fn(),
  recordDelivered: vi.fn(),
  recordLinkError: vi.fn(),
  listDirty: vi.fn(),
  postEvent: vi.fn(),
}))

vi.mock('@/lib/crm/repository', () => ({
  getCrmLinkById: mocks.getLink,
  acquireCrmConversationLease: mocks.acquireLease,
  releaseCrmConversationLease: mocks.releaseLease,
  deferCrmConversation: mocks.defer,
  getInboxConversationForCrm: mocks.getConversation,
  listUndeliveredCrmMessages: mocks.listUndelivered,
  recordCrmMessageDelivery: mocks.recordDelivery,
  recordCrmLinkDelivered: mocks.recordDelivered,
  recordCrmLinkError: mocks.recordLinkError,
  listDirtyCrmConversations: mocks.listDirty,
}))

vi.mock('@/lib/crm/binora/client', () => {
  class BinoraRequestError extends Error {
    readonly status: number | null
    constructor(message: string, status: number | null) {
      super(message)
      this.status = status
    }
    get isPermanentRejection() {
      return this.status === 400
    }
  }
  return { BinoraRequestError, postBinoraEvent: mocks.postEvent }
})

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: vi.fn(async () => ({ decrypted: 'secret' })),
}))

vi.mock('@/lib/crm/urls', () => ({
  crmMediaUrl: (linkId: string, messageId: string, index: number) =>
    `https://labbai.test/api/crm/media/${linkId}/${messageId}/${index}`,
}))

import { BinoraRequestError } from '@/lib/crm/binora/client'
import { syncCrmConversation } from '@/lib/crm/sync'

const LINK = {
  id: 'link-1',
  workspaceId: 'ws-1',
  workflowId: 'wf-1',
  provider: 'binora',
  baseUrl: 'https://api.binora.test/v1/messenger/tok',
  secretEncrypted: 'enc',
  callbackKey: 'key',
  deployed: true,
  mirrorSince: new Date('2026-09-29T00:00:00Z'),
  connectedAt: new Date('2026-09-29T00:00:00Z'),
}

const CONVERSATION = {
  id: 'conv-1',
  workspaceId: 'ws-1',
  workflowId: 'wf-1',
  channel: 'telegram',
  externalChatId: '555',
  contactName: 'Ali',
  contactHandle: null,
  aiEnabled: true,
  aiPausedUntil: null,
}

const LEASE_UNTIL = new Date('2026-09-29T10:02:00Z')

const FRESH_LEASE = {
  leaseUntil: LEASE_UNTIL,
  attempts: 0,
  sentAiEnabled: null,
  sentAiPausedUntil: null,
  sentContactName: null,
  sentContactHandle: null,
}

function message(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    author: 'customer',
    text: `text ${id}`,
    attachments: [],
    status: 'received',
    operatorName: null,
    createdAt: new Date('2026-09-29T10:00:00Z'),
    ...overrides,
  }
}

describe('syncCrmConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLink.mockResolvedValue(LINK)
    mocks.acquireLease.mockResolvedValue(FRESH_LEASE)
    mocks.getConversation.mockResolvedValue(CONVERSATION)
    mocks.listUndelivered.mockResolvedValue([])
    mocks.postEvent.mockResolvedValue(undefined)
  })

  it('does nothing while the workflow is not deployed with the block', async () => {
    mocks.getLink.mockResolvedValue({ ...LINK, deployed: false })
    const result = await syncCrmConversation('link-1', 'conv-1')
    expect(result.delivered).toBe(0)
    expect(mocks.acquireLease).not.toHaveBeenCalled()
  })

  it('delivers the messages in order and records the state Binora now has', async () => {
    mocks.listUndelivered.mockResolvedValue([message('m1'), message('m2', { author: 'agent' })])

    const result = await syncCrmConversation('link-1', 'conv-1')

    expect(result).toMatchObject({ delivered: 2, skipped: 0, failed: false, stateSent: false })
    expect(mocks.postEvent.mock.calls.map(([call]) => call.event.message.id)).toEqual(['m1', 'm2'])
    expect(mocks.postEvent.mock.calls[1][0].event.message.role).toBe('assistant')
    expect(mocks.recordDelivery).toHaveBeenCalledWith({
      linkId: 'link-1',
      messageId: 'm2',
      outcome: 'delivered',
    })
    expect(mocks.releaseLease).toHaveBeenCalledWith('link-1', 'conv-1', LEASE_UNTIL, {
      aiEnabled: true,
      aiPausedUntil: null,
      contactName: 'Ali',
      contactHandle: null,
    })
    expect(mocks.recordDelivered).toHaveBeenCalledWith('link-1')
  })

  it('skips replies that never reached the customer', async () => {
    mocks.listUndelivered.mockResolvedValue([message('m1', { status: 'failed' })])
    const result = await syncCrmConversation('link-1', 'conv-1')
    expect(result.skipped).toBe(1)
    expect(mocks.postEvent).not.toHaveBeenCalled()
    expect(mocks.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm1', outcome: 'skipped' })
    )
  })

  it('skips a message Binora refuses for good and carries on', async () => {
    mocks.listUndelivered.mockResolvedValue([message('m1'), message('m2')])
    mocks.postEvent
      .mockRejectedValueOnce(new BinoraRequestError('Binora answered HTTP 400', 400))
      .mockResolvedValueOnce(undefined)

    const result = await syncCrmConversation('link-1', 'conv-1')

    expect(result).toMatchObject({ delivered: 1, skipped: 1, failed: false })
    expect(mocks.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm1', outcome: 'skipped' })
    )
  })

  it('stops at an outage and backs off, keeping the order', async () => {
    mocks.acquireLease.mockResolvedValue({ ...FRESH_LEASE, attempts: 2 })
    mocks.listUndelivered.mockResolvedValue([message('m1'), message('m2')])
    mocks.postEvent.mockRejectedValue(new BinoraRequestError('Binora is not reachable', null))

    const result = await syncCrmConversation('link-1', 'conv-1')

    expect(result.failed).toBe(true)
    expect(mocks.postEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordDelivery).not.toHaveBeenCalled()
    expect(mocks.defer).toHaveBeenCalledWith('link-1', 'conv-1', {
      leaseUntil: LEASE_UNTIL,
      attempts: 3,
      retryInMs: 2 * 60_000,
      error: 'Binora is not reachable',
      sentState: null,
    })
    expect(mocks.recordLinkError).toHaveBeenCalledWith('link-1', 'Binora is not reachable')
    expect(mocks.releaseLease).not.toHaveBeenCalled()
  })

  it('reports a changed AI switch for a chat Binora already knows', async () => {
    mocks.acquireLease.mockResolvedValue({
      ...FRESH_LEASE,
      sentAiEnabled: true,
      sentContactName: 'Ali',
    })
    mocks.getConversation.mockResolvedValue({ ...CONVERSATION, aiEnabled: false })

    const result = await syncCrmConversation('link-1', 'conv-1')

    expect(result.stateSent).toBe(true)
    expect(mocks.postEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          event: 'state',
          conversation: expect.objectContaining({ ai: { enabled: false, pausedUntil: null } }),
        }),
      })
    )
  })

  it('sends no state for a chat Binora has never heard of', async () => {
    mocks.getConversation.mockResolvedValue({ ...CONVERSATION, aiEnabled: false })
    const result = await syncCrmConversation('link-1', 'conv-1')
    expect(result.stateSent).toBe(false)
    expect(mocks.postEvent).not.toHaveBeenCalled()
  })

  it('ignores a conversation that another workflow now answers', async () => {
    mocks.listUndelivered.mockResolvedValue([message('m1')])
    mocks.getConversation.mockResolvedValue({ ...CONVERSATION, workflowId: 'wf-2' })
    const result = await syncCrmConversation('link-1', 'conv-1')
    expect(result.delivered).toBe(0)
    expect(mocks.postEvent).not.toHaveBeenCalled()
    expect(mocks.releaseLease).toHaveBeenCalledWith('link-1', 'conv-1', LEASE_UNTIL, null)
  })
})
