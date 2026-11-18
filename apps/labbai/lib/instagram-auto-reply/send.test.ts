/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTextFallback,
  getUserFollowsBusiness,
  isTemplateRejected,
  listRecentMedia,
  sendLinkMessage,
  sendPostbackPrompt,
  sendPrivateReply,
  sendPublicReply,
} from '@/lib/instagram-auto-reply/send'

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function graphError(code: number, message: string, status = 400): Response {
  return jsonResponse({ error: { message, type: 'OAuthException', code } }, status)
}

/** The parsed JSON body of the n-th fetch call. */
function sentBody(call: number): Record<string, unknown> {
  return JSON.parse(mockFetch.mock.calls[call][1].body as string)
}

const BUTTONS = [
  { title: 'Katalog', url: 'https://app.test/api/instagram/r/ev-1/0' },
  { title: 'Narxlar', url: 'https://app.test/api/instagram/r/ev-1/1' },
]

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

describe('sendPublicReply', () => {
  it('posts the message to the comment replies edge with the bearer token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'reply-1' }))

    const result = await sendPublicReply('token-1', 'C1', 'Rahmat!')

    expect(result).toEqual({ ok: true, data: { replyId: 'reply-1' } })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toMatch(/^https:\/\/graph\.instagram\.com\/v[\d.]+\/C1\/replies$/)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer token-1')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(sentBody(0)).toEqual({ message: 'Rahmat!' })
  })

  it('marks rate limits and server errors retryable, bad requests not', async () => {
    mockFetch.mockResolvedValueOnce(graphError(4, 'Application request limit reached'))
    const limited = await sendPublicReply('t', 'C1', 'x')
    expect(limited).toMatchObject({ ok: false, code: 4, retryable: true })

    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'Oops' } }, 503))
    expect(await sendPublicReply('t', 'C1', 'x')).toMatchObject({ ok: false, retryable: true })

    mockFetch.mockResolvedValueOnce(graphError(10, 'Permission denied'))
    const denied = await sendPublicReply('t', 'C1', 'x')
    expect(denied).toMatchObject({ ok: false, code: 10, retryable: false })
    if (!denied.ok) expect(denied.error).toContain('Permission denied')
  })

  it('treats a network failure or timeout as retryable', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))
    expect(await sendPublicReply('t', 'C1', 'x')).toMatchObject({ ok: false, retryable: true })
  })
})

describe('shared send budget', () => {
  it('aborts a call when the shared signal fires, as a transient failure', async () => {
    mockFetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
    )
    const budget = new AbortController()

    const pending = sendPublicReply('t', 'C1', 'x', { signal: budget.signal })
    budget.abort(new Error('budget spent'))

    await expect(pending).resolves.toMatchObject({ ok: false, code: null, retryable: true })
  })

  it('passes the shared signal to every call of a DM with its fallback', async () => {
    mockFetch
      .mockResolvedValueOnce(graphError(100, 'Invalid parameter'))
      .mockResolvedValueOnce(jsonResponse({ message_id: 'mid-1' }))
    const budget = new AbortController()

    await sendPrivateReply(
      't',
      'IG1',
      'C1',
      { text: 'Hi', buttons: BUTTONS },
      {
        signal: budget.signal,
      }
    )
    budget.abort()

    expect(mockFetch).toHaveBeenCalledTimes(2)
    for (const [, init] of mockFetch.mock.calls) {
      expect((init.signal as AbortSignal).aborted).toBe(true)
    }
  })
})

describe('sendPrivateReply', () => {
  it('sends a DM without buttons as plain text to recipient.comment_id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ recipient_id: 'U1', message_id: 'mid-1' }))

    const result = await sendPrivateReply('t', 'IG1', 'C1', { text: 'Salom', buttons: [] })

    expect(result).toEqual({ ok: true, data: { messageId: 'mid-1', usedTextFallback: false } })
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/IG1\/messages$/)
    expect(sentBody(0)).toEqual({ recipient: { comment_id: 'C1' }, message: { text: 'Salom' } })
  })

  it('sends a DM with buttons as a button template of web_url buttons', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message_id: 'mid-2' }))

    const result = await sendPrivateReply('t', 'IG1', 'C1', { text: 'Mana', buttons: BUTTONS })

    expect(result).toEqual({ ok: true, data: { messageId: 'mid-2', usedTextFallback: false } })
    expect(sentBody(0)).toEqual({
      recipient: { comment_id: 'C1' },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: 'Mana',
            buttons: BUTTONS.map((button) => ({ type: 'web_url', ...button })),
          },
        },
      },
    })
  })

  it('falls back to text with the links appended when Graph rejects the template (code 100)', async () => {
    mockFetch
      .mockResolvedValueOnce(graphError(100, 'Invalid parameter'))
      .mockResolvedValueOnce(jsonResponse({ message_id: 'mid-3' }))

    const result = await sendPrivateReply('t', 'IG1', 'C1', { text: 'Mana', buttons: BUTTONS })

    expect(result).toEqual({ ok: true, data: { messageId: 'mid-3', usedTextFallback: true } })
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(sentBody(1)).toEqual({
      recipient: { comment_id: 'C1' },
      message: {
        text: `Mana\n\nKatalog: ${BUTTONS[0].url}\nNarxlar: ${BUTTONS[1].url}`,
      },
    })
  })

  it('falls back when the error names the template', async () => {
    mockFetch
      .mockResolvedValueOnce(graphError(2018001, 'Template type not allowed for this recipient'))
      .mockResolvedValueOnce(jsonResponse({ message_id: 'mid-4' }))

    const result = await sendPrivateReply('t', 'IG1', 'C1', { text: 'Mana', buttons: BUTTONS })
    expect(result).toMatchObject({ ok: true, data: { usedTextFallback: true } })
  })

  it('does not fall back on other errors, and reports a failed fallback', async () => {
    mockFetch.mockResolvedValueOnce(graphError(10, 'Reply window has passed'))
    const refused = await sendPrivateReply('t', 'IG1', 'C1', { text: 'Mana', buttons: BUTTONS })
    expect(refused).toMatchObject({ ok: false, code: 10 })
    expect(mockFetch).toHaveBeenCalledTimes(1)

    mockFetch
      .mockResolvedValueOnce(graphError(100, 'Invalid parameter'))
      .mockResolvedValueOnce(graphError(4, 'Rate limited'))
    const fallbackFailed = await sendPrivateReply('t', 'IG1', 'C1', {
      text: 'Mana',
      buttons: BUTTONS,
    })
    expect(fallbackFailed).toMatchObject({ ok: false, retryable: true })
    if (!fallbackFailed.ok) expect(fallbackFailed.error).toContain('button template was rejected')
  })
})

describe('buildTextFallback', () => {
  it('cuts the message, never the links, to fit the 1000-character limit', () => {
    const text = buildTextFallback({ text: 'x'.repeat(1000), buttons: BUTTONS })
    expect(text.length).toBeLessThanOrEqual(1000)
    expect(text.endsWith(`Narxlar: ${BUTTONS[1].url}`)).toBe(true)
    expect(text.startsWith('xxx')).toBe(true)
  })
})

describe('listRecentMedia', () => {
  it('reads ids and timestamps from the account media edge', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { id: 'M2', timestamp: '2026-11-18T10:00:00+0000' },
          { id: 17, timestamp: 5 },
          { timestamp: '2026-11-18T09:00:00+0000' },
        ],
      })
    )

    const result = await listRecentMedia('t', 'IG1')

    expect(result).toEqual({
      ok: true,
      data: [
        { id: 'M2', timestamp: '2026-11-18T10:00:00+0000' },
        { id: '17', timestamp: null },
      ],
    })
    const url = new URL(mockFetch.mock.calls[0][0])
    expect(url.pathname).toMatch(/\/IG1\/media$/)
    expect(url.searchParams.get('fields')).toBe('id,timestamp')
    expect(mockFetch.mock.calls[0][1].method).toBe('GET')
  })
})

describe('sendLinkMessage', () => {
  it('messages a user by id inside the window', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ recipient_id: 'U1', message_id: 'mid-1' }))

    const result = await sendLinkMessage('t', 'IG1', { userId: 'U1' }, { text: 'Hi', buttons: [] })

    expect(result).toEqual({ ok: true, data: { messageId: 'mid-1', usedTextFallback: false } })
    expect(sentBody(0)).toEqual({ recipient: { id: 'U1' }, message: { text: 'Hi' } })
  })
})

describe('sendPostbackPrompt', () => {
  const prompt = {
    text: 'Tap to get the link',
    buttonTitle: 'Send me the link please',
    payload: 'iar:ev-1:open',
  }

  it('sends a button template with one postback button, title cut to 20 characters', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message_id: 'mid-1' }))

    const result = await sendPostbackPrompt('t', 'IG1', { commentId: 'C1' }, prompt)

    expect(result).toEqual({ ok: true, data: { messageId: 'mid-1', usedQuickReply: false } })
    expect(sentBody(0)).toEqual({
      recipient: { comment_id: 'C1' },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: 'Tap to get the link',
            buttons: [
              { type: 'postback', title: 'Send me the link ple', payload: 'iar:ev-1:open' },
            ],
          },
        },
      },
    })
  })

  it('falls back to a quick reply carrying the same payload when the template is rejected', async () => {
    mockFetch
      .mockResolvedValueOnce(graphError(100, 'Invalid parameter'))
      .mockResolvedValueOnce(jsonResponse({ message_id: 'mid-2' }))

    const result = await sendPostbackPrompt('t', 'IG1', { userId: 'U1' }, prompt)

    expect(result).toEqual({ ok: true, data: { messageId: 'mid-2', usedQuickReply: true } })
    expect(sentBody(1)).toEqual({
      recipient: { id: 'U1' },
      message: {
        text: 'Tap to get the link',
        quick_replies: [
          { content_type: 'text', title: 'Send me the link ple', payload: 'iar:ev-1:open' },
        ],
      },
    })
  })

  it('reports a rejection the caller can recognise when no button format is accepted', async () => {
    mockFetch
      .mockResolvedValueOnce(graphError(100, 'Invalid parameter'))
      .mockResolvedValueOnce(graphError(100, 'Invalid parameter'))

    const result = await sendPostbackPrompt('t', 'IG1', { commentId: 'C1' }, prompt)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(isTemplateRejected(result)).toBe(true)
  })

  it('does not retry another format on a transient failure', async () => {
    mockFetch.mockResolvedValueOnce(graphError(2, 'Service temporarily unavailable', 503))

    const result = await sendPostbackPrompt('t', 'IG1', { commentId: 'C1' }, prompt)

    expect(result).toMatchObject({ ok: false, retryable: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('getUserFollowsBusiness', () => {
  it('reads is_user_follow_business from the user profile', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ is_user_follow_business: false, id: 'U1' }))

    const result = await getUserFollowsBusiness('t', 'U1')

    expect(result).toEqual({ ok: true, data: { follows: false } })
    const url = new URL(mockFetch.mock.calls[0][0])
    expect(url.pathname).toMatch(/\/U1$/)
    expect(url.searchParams.get('fields')).toBe('is_user_follow_business')
  })

  it('reports an unknown status when the field is missing', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'U1' }))
    await expect(getUserFollowsBusiness('t', 'U1')).resolves.toEqual({
      ok: true,
      data: { follows: null },
    })
  })

  it('returns Graph’s error when consent is missing', async () => {
    mockFetch.mockResolvedValueOnce(
      graphError(230, 'User consent is required to access user profile')
    )
    await expect(getUserFollowsBusiness('t', 'U1')).resolves.toMatchObject({ ok: false })
  })
})
