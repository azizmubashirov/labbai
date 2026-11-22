/**
 * @vitest-environment node
 */
import { hmacSha256Hex } from '@labbai/security/hmac'
import { dbChainMock, queueTableRows, resetEnvMock, schemaMock, setEnv } from '@labbai/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveBackgroundWebhookEnv,
  mockResolveOAuthAccountId,
  mockRefreshAccessTokenIfNeeded,
  mockGetCredentialOwner,
  mockLoggerWarn,
} = vi.hoisted(() => ({
  mockResolveBackgroundWebhookEnv: vi.fn(),
  mockResolveOAuthAccountId: vi.fn(),
  mockRefreshAccessTokenIfNeeded: vi.fn(),
  mockGetCredentialOwner: vi.fn(),
  mockLoggerWarn: vi.fn(),
}))

vi.mock('@labbai/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@labbai/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  resolveOAuthAccountId: mockResolveOAuthAccountId,
  refreshAccessTokenIfNeeded: mockRefreshAccessTokenIfNeeded,
}))

vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getCredentialOwner: mockGetCredentialOwner,
  getProviderConfig: (webhook: Record<string, unknown>) =>
    (webhook.providerConfig as Record<string, unknown>) || {},
}))

vi.mock('@/lib/webhooks/env-resolver', () => ({
  resolveBackgroundWebhookEnv: mockResolveBackgroundWebhookEnv,
}))

vi.mock('@/executor/utils/reference-validation', () => ({
  resolveEnvVarReferences: (value: string, envVars: Record<string, string>) =>
    value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, name: string) => envVars[name] ?? match),
}))

import {
  getInstagramAutoReplyPostbacks,
  getInstagramComments,
  getInstagramLiveComments,
  getInstagramOwnerReplies,
  getInstagramStoryEvents,
  instagramHandler,
  partitionInstagramDelivery,
  removeInstagramComments,
  removeInstagramMessages,
  scopeInstagramDelivery,
  splitInstagramDeliveryByAccount,
} from '@/lib/webhooks/providers/instagram'

beforeEach(() => {
  vi.clearAllMocks()
  resetEnvMock()
})

const body = {
  object: 'instagram',
  entry: [
    {
      id: 'IG1',
      messaging: [
        {
          sender: { id: 'U1' },
          recipient: { id: 'IG1' },
          timestamp: 1_790_000_000_000,
          message: { mid: 'm1', text: 'Salom' },
        },
        {
          sender: { id: 'IG1' },
          recipient: { id: 'U1' },
          timestamp: 1_790_000_000_001,
          message: { mid: 'm2', text: 'Echo', is_echo: true },
        },
      ],
    },
  ],
}

function requestWithSignature(signature: string | null): Request {
  return new Request('https://app.example.com/api/webhooks/trigger/p', {
    method: 'POST',
    headers: signature ? { 'x-hub-signature-256': signature } : {},
  })
}

describe('instagramHandler', () => {
  it('accepts a correctly signed delivery and rejects a forged one', async () => {
    const rawBody = JSON.stringify(body)
    const valid = `sha256=${hmacSha256Hex(rawBody, 'secret')}`
    const context = { rawBody, requestId: 'r', providerConfig: { appSecret: 'secret' } }

    expect(
      await instagramHandler.verifyAuth?.({
        ...context,
        request: requestWithSignature(valid),
      } as never)
    ).toBeNull()
    const forged = await instagramHandler.verifyAuth?.({
      ...context,
      request: requestWithSignature('sha256=deadbeef'),
    } as never)
    expect(forged?.status).toBe(401)
  })

  it('exposes the first customer message and skips echoes', async () => {
    const result = await instagramHandler.formatInput?.({ body } as never)
    expect(result?.input).toMatchObject({
      messageId: 'm1',
      senderId: 'U1',
      recipientId: 'IG1',
      text: 'Salom',
    })
    expect((result?.input as { messages: unknown[] }).messages).toHaveLength(1)
  })

  it('skips a delivery that only carries echoes', async () => {
    const echoOnly = { entry: [{ id: 'IG1', messaging: [body.entry[0].messaging[1]] }] }
    expect((await instagramHandler.formatInput?.({ body: echoOnly } as never))?.input).toBeNull()
    expect(scopeInstagramDelivery(echoOnly, 'IG1', 'messages')).toEqual({ status: 'no-events' })
  })

  it('derives a stable idempotency key from the message ids', () => {
    expect(instagramHandler.extractIdempotencyId?.(body)).toMatch(/^instagram:1:/)
  })
})

/** A customer comment in the `changes[]` shape. */
function commentChange(id: string, fromId: string, extra: Record<string, unknown> = {}) {
  return {
    field: 'comments',
    value: {
      id,
      from: { id: fromId, username: `user_${fromId}` },
      text: `comment ${id}`,
      media: { id: 'MEDIA1', media_product_type: 'REELS' },
      ...extra,
    },
  }
}

/** One delivery carrying two accounts, each with a DM and a comment, plus IG1's own reply. */
const twoAccountDelivery = {
  object: 'instagram',
  entry: [
    {
      id: 'IG1',
      time: 1_790_000_000,
      changes: [commentChange('C1', 'U1'), commentChange('C1-reply', 'IG1', { parent_id: 'C1' })],
    },
    {
      id: 'IG2',
      time: 1_790_000_001,
      changes: [commentChange('C2', 'U2')],
    },
    {
      id: 'IG1',
      messaging: [
        {
          sender: { id: 'U1' },
          recipient: { id: 'IG1' },
          timestamp: 1_790_000_000_000,
          message: { mid: 'm1', text: 'Salom' },
        },
      ],
    },
    {
      id: 'IG2',
      messaging: [
        {
          sender: { id: 'U2' },
          recipient: { id: 'IG2' },
          timestamp: 1_790_000_000_002,
          message: { mid: 'm2', text: 'Assalomu alaykum' },
        },
      ],
    },
  ],
}

describe('Instagram comments', () => {
  it('normalizes a comment from the changes[] shape', () => {
    const [comment] = getInstagramComments({
      entry: [{ id: 'IG1', time: 1_790_000_000, changes: [commentChange('C1', 'U1')] }],
    })
    expect(comment).toMatchObject({
      commentId: 'C1',
      mediaId: 'MEDIA1',
      mediaProductType: 'REELS',
      parentId: null,
      text: 'comment C1',
      fromId: 'U1',
      fromUsername: 'user_U1',
      accountId: 'IG1',
      timestamp: 1_790_000_000,
    })
    expect(comment.raw).toMatchObject({ id: 'C1' })
  })

  it('reads the Instagram Login shape with field and value on the entry, and comment_id', () => {
    const comments = getInstagramComments({
      entry: [
        { id: 'IG1', field: 'comments', value: commentChange('C1', 'U1').value },
        {
          id: 'IG1',
          changes: [{ field: 'comments', value: { comment_id: 'C2', from: { id: 'U2' } } }],
        },
      ],
    })
    expect(comments.map((comment) => comment.commentId)).toEqual(['C1', 'C2'])
  })

  it('drops comments the account wrote itself, so replies never loop', () => {
    const comments = getInstagramComments(twoAccountDelivery)
    expect(comments.map((comment) => comment.commentId)).toEqual(['C1', 'C2'])
  })

  it('ignores other change fields and comments without an author', () => {
    expect(
      getInstagramComments({
        entry: [
          {
            id: 'IG1',
            changes: [
              { field: 'mentions', value: { id: 'X', from: { id: 'U1' } } },
              { field: 'comments', value: { id: 'C9' } },
            ],
          },
        ],
      })
    ).toEqual([])
  })

  it('formats comment trigger input from the first comment', async () => {
    const result = await instagramHandler.formatInput?.({
      webhook: { providerConfig: { triggerId: 'instagram_comment_webhook' } },
      body: twoAccountDelivery,
    } as never)
    expect(result?.input).toMatchObject({
      commentId: 'C1',
      fromId: 'U1',
      accountId: 'IG1',
      mediaId: 'MEDIA1',
    })
    expect((result?.input as { comments: unknown[] }).comments).toHaveLength(2)
  })
})

describe('Instagram idempotency', () => {
  it('keeps the DM-only key unchanged and adds comment ids', () => {
    const dmOnly = instagramHandler.extractIdempotencyId?.(body)
    const withComment = instagramHandler.extractIdempotencyId?.({
      entry: [...body.entry, { id: 'IG1', changes: [commentChange('C1', 'U1')] }],
    })
    expect(dmOnly).toMatch(/^instagram:1:/)
    expect(withComment).toMatch(/^instagram:2:/)
    expect(withComment).not.toBe(dmOnly)
  })

  it('keys a comment-only delivery on the comment id and ignores self replies', () => {
    const first = instagramHandler.extractIdempotencyId?.({
      entry: [{ id: 'IG1', changes: [commentChange('C1', 'U1')] }],
    })
    const retried = instagramHandler.extractIdempotencyId?.({
      entry: [
        {
          id: 'IG1',
          changes: [commentChange('C1', 'U1'), commentChange('R1', 'IG1', { parent_id: 'C1' })],
        },
      ],
    })
    expect(first).toMatch(/^instagram:1:/)
    expect(retried).toBe(first)
    expect(
      instagramHandler.extractIdempotencyId?.({
        entry: [{ id: 'IG1', changes: [commentChange('R1', 'IG1')] }],
      })
    ).toBeNull()
  })
})

describe('removeInstagramComments', () => {
  const dmEvent = {
    sender: { id: 'U1' },
    recipient: { id: 'IG1' },
    message: { mid: 'm1', text: 'Salom' },
  }

  it('drops only the listed comments and keeps DMs and other comments', () => {
    const stripped = removeInstagramComments(
      {
        object: 'instagram',
        entry: [
          {
            id: 'IG1',
            changes: [commentChange('C1', 'U1'), commentChange('C2', 'U2')],
            messaging: [dmEvent],
          },
          { id: 'IG1', field: 'comments', value: commentChange('C3', 'U3').value },
        ],
      },
      new Set(['C1', 'C3'])
    )
    expect(stripped).not.toBeNull()
    expect(getInstagramComments(stripped).map((comment) => comment.commentId)).toEqual(['C2'])
    expect(stripped?.object).toBe('instagram')
    expect(stripped?.entry).toEqual([
      { id: 'IG1', changes: [commentChange('C2', 'U2')], messaging: [dmEvent] },
    ])
  })

  it('keeps an entry whose only remaining events are DMs', () => {
    const stripped = removeInstagramComments(
      { entry: [{ id: 'IG1', changes: [commentChange('C1', 'U1')], messaging: [dmEvent] }] },
      new Set(['C1'])
    )
    expect(stripped?.entry).toEqual([{ id: 'IG1', messaging: [dmEvent] }])
  })

  it('returns null when every event was consumed', () => {
    expect(
      removeInstagramComments(
        {
          entry: [
            { id: 'IG1', changes: [commentChange('C1', 'U1')] },
            { id: 'IG1', field: 'comments', value: { comment_id: 'C2', from: { id: 'U2' } } },
          ],
        },
        new Set(['C1', 'C2'])
      )
    ).toBeNull()
  })

  it('returns the body unchanged when nothing was consumed', () => {
    const original = { entry: [{ id: 'IG1', changes: [commentChange('C1', 'U1')] }] }
    expect(removeInstagramComments(original, new Set())).toBe(original)
  })

  it('drops consumed live comments too', () => {
    const live = { field: 'live_comments', value: { comment_id: 'LC1', from: { id: 'U1' } } }
    const stripped = removeInstagramComments(
      { entry: [{ id: 'IG1', changes: [live, commentChange('C1', 'U1')] }] },
      new Set(['LC1'])
    )
    expect(stripped?.entry).toEqual([{ id: 'IG1', changes: [commentChange('C1', 'U1')] }])
  })
})

describe('getInstagramLiveComments', () => {
  it('reads live comments by comment_id and skips the account’s own', () => {
    const delivery = {
      entry: [
        {
          id: 'IG1',
          time: 1_790_000_000,
          changes: [
            {
              field: 'live_comments',
              value: {
                comment_id: 'LC1',
                text: 'narx?',
                from: { id: 'U1', username: 'fan' },
                media: { id: 'LIVE1', media_product_type: 'LIVE' },
              },
            },
            { field: 'live_comments', value: { comment_id: 'LC2', from: { id: 'IG1' } } },
            commentChange('C1', 'U2'),
          ],
        },
      ],
    }
    const live = getInstagramLiveComments(delivery)
    expect(live.map((comment) => [comment.commentId, comment.mediaId, comment.fromId])).toEqual([
      ['LC1', 'LIVE1', 'U1'],
    ])
    expect(getInstagramComments(delivery).map((comment) => comment.commentId)).toEqual(['C1'])
  })
})

/** One `messaging` event from a customer to IG1. */
function messaging(message: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    sender: { id: 'U1' },
    recipient: { id: 'IG1' },
    timestamp: 1_790_000_000_000,
    message,
    ...extra,
  }
}

describe('getInstagramStoryEvents', () => {
  it('reads story replies and mentions and ignores plain DMs and echoes', () => {
    const delivery = {
      entry: [
        {
          id: 'IG1',
          messaging: [
            messaging({
              mid: 'm-reply',
              text: 'Narx?',
              reply_to: { story: { id: 'S1', url: 'https://cdn.example.com/s1' } },
            }),
            messaging({
              mid: 'm-mention',
              attachments: [
                { type: 'story_mention', payload: { url: 'https://cdn.example.com/s2' } },
              ],
            }),
            messaging({ mid: 'm-dm', text: 'Salom' }),
            messaging({ mid: 'm-reply-to-dm', text: 'ok', reply_to: { mid: 'm-dm' } }),
            messaging(
              { mid: 'm-echo', is_echo: true, reply_to: { story: { id: 'S1' } } },
              { sender: { id: 'IG1' } }
            ),
          ],
        },
      ],
    }
    expect(getInstagramStoryEvents(delivery)).toEqual([
      {
        kind: 'story_reply',
        messageId: 'm-reply',
        accountId: 'IG1',
        senderId: 'U1',
        text: 'Narx?',
        storyId: 'S1',
        storyUrl: 'https://cdn.example.com/s1',
        timestamp: 1_790_000_000_000,
      },
      {
        kind: 'story_mention',
        messageId: 'm-mention',
        accountId: 'IG1',
        senderId: 'U1',
        text: null,
        storyId: null,
        storyUrl: 'https://cdn.example.com/s2',
        timestamp: 1_790_000_000_000,
      },
    ])
  })
})

describe('getInstagramAutoReplyPostbacks', () => {
  it('reads iar: postbacks and quick replies and leaves every other tap alone', () => {
    const delivery = {
      entry: [
        {
          id: 'IG1',
          messaging: [
            {
              sender: { id: 'U1' },
              recipient: { id: 'IG1' },
              timestamp: 1,
              postback: { mid: 'p-1', title: 'Send it', payload: 'iar:ev-1:open' },
            },
            {
              sender: { id: 'U1' },
              recipient: { id: 'IG1' },
              postback: { mid: 'p-2', title: 'Menu', payload: 'MENU_MAIN' },
            },
            messaging({
              mid: 'q-1',
              text: 'I followed',
              quick_reply: { payload: 'iar:ev-1:followed' },
            }),
            messaging({ mid: 'q-2', text: 'Yes', quick_reply: { payload: 'YES' } }),
          ],
        },
      ],
    }
    expect(getInstagramAutoReplyPostbacks(delivery)).toEqual([
      {
        messageId: 'p-1',
        accountId: 'IG1',
        senderId: 'U1',
        payload: 'iar:ev-1:open',
        source: 'postback',
        timestamp: 1,
      },
      {
        messageId: 'q-1',
        accountId: 'IG1',
        senderId: 'U1',
        payload: 'iar:ev-1:followed',
        source: 'quick_reply',
        timestamp: 1_790_000_000_000,
      },
    ])
  })
})

describe('removeInstagramMessages', () => {
  const tap = {
    sender: { id: 'U1' },
    recipient: { id: 'IG1' },
    postback: { mid: 'p-1', payload: 'iar:ev-1:open' },
  }
  const otherTap = {
    sender: { id: 'U1' },
    recipient: { id: 'IG1' },
    postback: { mid: 'p-2', payload: 'MENU_MAIN' },
  }
  const storyReply = messaging({ mid: 'm-story', reply_to: { story: { id: 'S1' } } })
  const dm = messaging({ mid: 'm-dm', text: 'Salom' })

  it('drops consumed postbacks and story events and keeps DMs, other taps and comments', () => {
    const stripped = removeInstagramMessages(
      {
        object: 'instagram',
        entry: [
          { id: 'IG1', messaging: [tap, storyReply, dm, otherTap] },
          { id: 'IG1', changes: [commentChange('C1', 'U2')] },
        ],
      },
      new Set(['p-1', 'm-story'])
    )
    expect(stripped).toEqual({
      object: 'instagram',
      entry: [
        { id: 'IG1', messaging: [dm, otherTap] },
        { id: 'IG1', changes: [commentChange('C1', 'U2')] },
      ],
    })
  })

  it('returns null when every event was consumed, and the body itself when none was', () => {
    expect(
      removeInstagramMessages({ entry: [{ id: 'IG1', messaging: [tap] }] }, new Set(['p-1']))
    ).toBeNull()
    const original = { entry: [{ id: 'IG1', messaging: [tap] }] }
    expect(removeInstagramMessages(original, new Set())).toBe(original)
  })
})

describe('Instagram per-account scoping', () => {
  it('splits a delivery into one body per account', () => {
    const parts = splitInstagramDeliveryByAccount(twoAccountDelivery)
    expect(parts.map((part) => part.accountId)).toEqual(['IG1', 'IG2'])
    for (const part of parts) {
      expect(part.body.object).toBe('instagram')
      const ids = (part.body.entry as Array<{ id: string }>).map((entry) => entry.id)
      expect(new Set(ids)).toEqual(new Set([part.accountId]))
    }
  })

  it('skips entries without a string id and past the entry bound, keeping valid ones', () => {
    const partition = partitionInstagramDelivery(
      [
        {
          object: 'instagram',
          entry: [
            { messaging: [] },
            { id: 42, messaging: [] },
            { id: 'IG1', messaging: [] },
            { id: 'IG2', messaging: [] },
            { id: 'IG1', messaging: [] },
          ],
        },
      ],
      2
    )
    expect(partition.accounts.map((part) => part.accountId)).toEqual(['IG1', 'IG2'])
    expect(partition.accounts[0].body.object).toBe('instagram')
    expect(partition.skippedEntries).toBe(3)
  })

  it('gives each trigger only its own account and event kind', () => {
    const comments = scopeInstagramDelivery(twoAccountDelivery, 'IG2', 'comments')
    expect(comments.status).toBe('scoped')
    const commentBody = comments.status === 'scoped' ? comments.body : null
    expect(getInstagramComments(commentBody).map((comment) => comment.commentId)).toEqual(['C2'])
    expect(JSON.stringify(commentBody)).not.toContain('messaging')

    const messages = scopeInstagramDelivery(twoAccountDelivery, 'IG1', 'messages')
    expect(messages.status).toBe('scoped')
    expect(JSON.stringify(messages)).not.toContain('changes')
    expect(JSON.stringify(messages)).not.toContain('IG2')

    expect(scopeInstagramDelivery(twoAccountDelivery, 'IG3', 'messages')).toEqual({
      status: 'foreign-account',
    })
    expect(
      scopeInstagramDelivery(
        { entry: [{ id: 'IG1', changes: [commentChange('R1', 'IG1')] }] },
        'IG1',
        'comments'
      )
    ).toEqual({ status: 'no-events' })
  })

  it('scopes a routed webhook to its routing key', async () => {
    const scoped = await instagramHandler.scopeDeliveryBody?.({
      webhook: { id: 'wh-2', routingKey: 'IG2' },
      body: twoAccountDelivery,
      requestId: 'r',
      providerConfig: { triggerId: 'instagram_webhook' },
    })
    const delivered = JSON.stringify(scoped?.body)
    expect(delivered).toContain('m2')
    expect(delivered).not.toContain('m1')
    expect(mockResolveOAuthAccountId).not.toHaveBeenCalled()
  })

  it('scopes a legacy path webhook to its credential account and drops foreign entries', async () => {
    mockResolveOAuthAccountId.mockResolvedValueOnce({ accountId: 'acct-row-1' })
    queueTableRows(schemaMock.account, [{ accountId: 'IG1', providerId: 'instagram' }])

    const scoped = await instagramHandler.scopeDeliveryBody?.({
      webhook: { id: 'wh-legacy', routingKey: null },
      body: twoAccountDelivery,
      requestId: 'r',
      providerConfig: { credentialId: 'cred-1' },
    })

    expect(mockResolveOAuthAccountId).toHaveBeenCalledWith('cred-1')
    const delivered = JSON.stringify(scoped?.body)
    expect(delivered).toContain('m1')
    expect(delivered).not.toContain('IG2')
  })

  it('ignores a delivery that has nothing for the legacy webhook account', async () => {
    mockResolveOAuthAccountId.mockResolvedValueOnce({ accountId: 'acct-row-3' })
    queueTableRows(schemaMock.account, [{ accountId: 'IG3', providerId: 'instagram' }])

    expect(
      await instagramHandler.scopeDeliveryBody?.({
        webhook: { id: 'wh-legacy', routingKey: null },
        body: twoAccountDelivery,
        requestId: 'r',
        providerConfig: { credentialId: 'cred-3' },
      })
    ).toBeNull()
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('no entries for the webhook'),
      { webhookId: 'wh-legacy', accountId: 'IG3' }
    )
  })

  it('does not warn when the account matches but carries no event of the trigger kind', async () => {
    expect(
      await instagramHandler.scopeDeliveryBody?.({
        webhook: { id: 'wh-2', routingKey: 'IG1' },
        body: { entry: [{ id: 'IG1', changes: [commentChange('R1', 'IG1')] }] },
        requestId: 'r',
        providerConfig: { triggerId: 'instagram_comment_webhook' },
      })
    ).toBeNull()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('fails closed when the webhook account cannot be determined', async () => {
    expect(
      await instagramHandler.scopeDeliveryBody?.({
        webhook: { id: 'wh-x', routingKey: null },
        body: twoAccountDelivery,
        requestId: 'r',
        providerConfig: {},
      })
    ).toBeNull()
  })
})

describe('Instagram signature without a per-trigger secret', () => {
  it('verifies with the Instagram app secret from env', async () => {
    setEnv({ INSTAGRAM_CLIENT_SECRET: 'app-secret' })
    const rawBody = JSON.stringify(body)
    const context = { rawBody, requestId: 'r', providerConfig: {} }

    expect(
      await instagramHandler.verifyAuth?.({
        ...context,
        request: requestWithSignature(`sha256=${hmacSha256Hex(rawBody, 'app-secret')}`),
      } as never)
    ).toBeNull()
    const forged = await instagramHandler.verifyAuth?.({
      ...context,
      request: requestWithSignature(`sha256=${hmacSha256Hex(rawBody, 'other')}`),
    } as never)
    expect(forged?.status).toBe(401)
  })

  it('rejects when no secret is configured anywhere', async () => {
    setEnv({ INSTAGRAM_CLIENT_SECRET: undefined, INSTAGRAM_WEBHOOK_APP_SECRET: undefined })
    const rawBody = JSON.stringify(body)
    const response = await instagramHandler.verifyAuth?.({
      rawBody,
      requestId: 'r',
      providerConfig: {},
      request: requestWithSignature(`sha256=${hmacSha256Hex(rawBody, '')}`),
    } as never)
    expect(response?.status).toBe(401)
  })
})

describe('Instagram deployment', () => {
  it('routes by the professional account id stored on the credential', async () => {
    mockResolveOAuthAccountId.mockResolvedValueOnce({ accountId: 'acct-row-1' })
    queueTableRows(schemaMock.account, [
      { accountId: '17841400000000001', providerId: 'instagram' },
    ])

    await expect(
      instagramHandler.prepareDeploymentConfig?.({
        credentialId: 'cred-1',
        providerConfig: {},
        requestId: 'r',
        triggerId: 'instagram_comment_webhook',
      })
    ).resolves.toEqual({ routingKey: '17841400000000001' })
  })

  it('refuses to deploy without an Instagram credential', async () => {
    await expect(
      instagramHandler.prepareDeploymentConfig?.({
        providerConfig: {},
        requestId: 'r',
        triggerId: 'instagram_webhook',
      })
    ).rejects.toThrow('Select the Instagram account')

    mockResolveOAuthAccountId.mockResolvedValueOnce({ accountId: 'acct-row-9' })
    queueTableRows(schemaMock.account, [{ accountId: 'x', providerId: 'google' }])
    await expect(
      instagramHandler.prepareDeploymentConfig?.({
        credentialId: 'cred-9',
        providerConfig: {},
        requestId: 'r',
        triggerId: 'instagram_webhook',
      })
    ).rejects.toThrow('could not be read')
  })

  it('subscribes the account to messages, postbacks, comments and live comments on deploy', async () => {
    mockGetCredentialOwner.mockResolvedValueOnce({ userId: 'user-1', accountId: 'acct-row-1' })
    mockRefreshAccessTokenIfNeeded.mockResolvedValueOnce('token-1')
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))

    await instagramHandler.createSubscription?.({
      webhook: { id: 'wh-1', providerConfig: { credentialId: 'cred-1' } },
      workflow: {},
      userId: 'user-1',
      requestId: 'r',
      request: new NextRequest('http://localhost/'),
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://graph.instagram.com/v25.0/me/subscribed_apps?subscribed_fields=messages%2Cmessaging_postbacks%2Ccomments%2Clive_comments'
    )
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer token-1' } })
    fetchMock.mockRestore()
  })

  it('fails the deploy with Meta’s message when the subscription is rejected', async () => {
    mockGetCredentialOwner.mockResolvedValueOnce({ userId: 'user-1', accountId: 'acct-row-1' })
    mockRefreshAccessTokenIfNeeded.mockResolvedValueOnce('token-1')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Unsupported request' } }), {
        status: 400,
      })
    )

    await expect(
      instagramHandler.createSubscription?.({
        webhook: { id: 'wh-1', providerConfig: { credentialId: 'cred-1' } },
        workflow: {},
        userId: 'user-1',
        requestId: 'r',
        request: new NextRequest('http://localhost/'),
      })
    ).rejects.toThrow('Unsupported request')
    fetchMock.mockRestore()
  })

  it('never unsubscribes the shared account on webhook deletion', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await instagramHandler.deleteSubscription?.({
      webhook: { id: 'wh-1', providerConfig: { credentialId: 'cred-1' } },
      workflow: {},
      requestId: 'r',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })
})

describe('Instagram subscription handshake', () => {
  function handshake(token: string): NextRequest {
    return new NextRequest(
      `http://localhost/api/webhooks/trigger/abc?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=4242`
    )
  }

  function queueWebhook(verificationToken: string) {
    queueTableRows(schemaMock.webhook, [
      {
        webhook: { id: 'wh_1', providerConfig: { verificationToken } },
        workflowOwnerId: 'user-1',
        workspaceId: 'ws-1',
      },
    ])
  }

  it('answers with the challenge when the token matches a literal value', async () => {
    queueWebhook('plain-token')

    const response = await instagramHandler.handleChallenge!(
      {},
      handshake('plain-token'),
      'r1',
      'abc'
    )

    expect(response?.status).toBe(200)
    await expect(response?.text()).resolves.toBe('4242')
  })

  it('resolves a token kept in workspace secrets before comparing', async () => {
    mockResolveBackgroundWebhookEnv.mockResolvedValueOnce({ IG_VERIFY_TOKEN: 'secret-token' })
    queueWebhook('{{IG_VERIFY_TOKEN}}')

    const response = await instagramHandler.handleChallenge!(
      {},
      handshake('secret-token'),
      'r2',
      'abc'
    )

    expect(mockResolveBackgroundWebhookEnv).toHaveBeenCalledWith('user-1', 'ws-1')
    expect(response?.status).toBe(200)
    await expect(response?.text()).resolves.toBe('4242')
  })

  it('rejects the literal reference text when the secret cannot be resolved', async () => {
    mockResolveBackgroundWebhookEnv.mockResolvedValueOnce({})
    queueWebhook('{{IG_VERIFY_TOKEN}}')

    const response = await instagramHandler.handleChallenge!(
      {},
      handshake(encodeURIComponent('{{IG_VERIFY_TOKEN}}')),
      'r3',
      'abc'
    )

    expect(response?.status).toBe(403)
  })

  it('falls through when no Instagram webhook on the path expects a token', async () => {
    queueTableRows(schemaMock.webhook, [])

    const response = await instagramHandler.handleChallenge!({}, handshake('any'), 'r4', 'abc')

    expect(response).toBeNull()
  })
})

describe('Instagram owner replies', () => {
  /** A message the account sent to a customer, as Meta echoes it back. */
  function echo(mid: string, extra: Record<string, unknown> = {}) {
    return {
      sender: { id: 'IG1' },
      recipient: { id: 'U1' },
      timestamp: 1_790_000_000_005,
      message: { mid, text: 'Doktor javobi', is_echo: true, ...extra },
    }
  }

  const ownerReplyOnly = { entry: [{ id: 'IG1', messaging: [echo('e1', { app_id: 123 })] }] }
  const optedIn = { triggerId: 'instagram_webhook', receiveOwnerReplies: true }

  it('reads echoes the account sent to a customer and skips self, deleted and foreign ones', () => {
    const delivery = {
      entry: [
        {
          id: 'IG1',
          messaging: [
            echo('e1', { app_id: 123 }),
            echo('e2', { is_self: true }),
            echo('e3', { is_deleted: true }),
            { ...echo('e4'), sender: { id: 'IG9' } },
            body.entry[0].messaging[0],
          ],
        },
      ],
    }
    expect(getInstagramOwnerReplies(delivery)).toEqual([
      expect.objectContaining({
        messageId: 'e1',
        customerId: 'U1',
        accountId: 'IG1',
        text: 'Doktor javobi',
        appId: '123',
      }),
    ])
  })

  it('keeps owner replies away from triggers that did not opt in', async () => {
    expect(scopeInstagramDelivery(ownerReplyOnly, 'IG1', 'messages')).toEqual({
      status: 'no-events',
    })
    const result = await instagramHandler.formatInput?.({
      webhook: { providerConfig: { triggerId: 'instagram_webhook' } },
      body: ownerReplyOnly,
    } as never)
    expect(result?.input).toBeNull()
  })

  it('runs an opted-in trigger with the customer as senderId and ownerReply set', async () => {
    const scoped = await instagramHandler.scopeDeliveryBody?.({
      webhook: { id: 'wh-1', routingKey: 'IG1' },
      body: ownerReplyOnly,
      requestId: 'r',
      providerConfig: optedIn,
    })
    expect(scoped?.body).toBeDefined()

    const result = await instagramHandler.formatInput?.({
      webhook: { providerConfig: optedIn },
      body: scoped?.body,
    } as never)
    expect(result?.input).toMatchObject({
      messageId: 'e1',
      senderId: 'U1',
      recipientId: 'IG1',
      text: 'Doktor javobi',
      ownerReply: true,
      appId: '123',
      messages: [],
    })
  })

  it('prefers the customer message when a delivery carries both', async () => {
    const result = await instagramHandler.formatInput?.({
      webhook: { providerConfig: optedIn },
      body,
    } as never)
    expect(result?.input).toMatchObject({ messageId: 'm1', ownerReply: false })
  })

  it('keys owner replies apart from customer messages and leaves DM-only keys unchanged', () => {
    const dmOnly = { entry: [{ id: 'IG1', messaging: [body.entry[0].messaging[0]] }] }
    const echoKey = instagramHandler.extractIdempotencyId?.(ownerReplyOnly)
    expect(echoKey).toMatch(/^instagram:1:/)
    expect(echoKey).not.toBe(instagramHandler.extractIdempotencyId?.(dmOnly))
    expect(instagramHandler.extractIdempotencyId?.(body)).toBe(
      instagramHandler.extractIdempotencyId?.(dmOnly)
    )
  })
})
