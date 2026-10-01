/**
 * @vitest-environment node
 */

import { createMockLogger, resetEnvMock, setEnv } from '@labbai/testing'
import { interruptibleSleep } from '@labbai/utils/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { EmbeddingAPIError } from '@/lib/embeddings/api-error'
import {
  assertKnowledgeEmbeddingCapacity,
  clampEmbeddingConcurrency,
  EMBEDDING_RETRY_BUDGET_MS,
  EmbeddingOutputLimitError,
  EmbeddingQuotaExhaustedError,
  embed,
  embedKnowledge,
  isBYOKEmbeddingCredentialRejection,
  isEmbeddingQuotaExhaustion,
  isTransientEmbeddingError,
  KNOWLEDGE_EMBEDDING_ADMISSION_WAIT_MS,
  MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES,
} from '@/lib/embeddings/client'

const { mockGetBYOKKey } = vi.hoisted(() => ({
  mockGetBYOKKey: vi.fn(),
}))

const { mockDiagnosticWarn } = vi.hoisted(() => ({ mockDiagnosticWarn: vi.fn() }))
vi.mock('@labbai/logger', () => ({
  createLogger: () => ({ ...createMockLogger(), warn: mockDiagnosticWarn }),
}))

const { quotaGates, mockAdmit, mockCooldown, mockQuotaCheck } = vi.hoisted(() => ({
  quotaGates: new Set<string>(),
  mockAdmit: vi.fn(),
  mockCooldown: vi.fn(),
  mockQuotaCheck: vi.fn(),
}))
vi.mock('@/lib/core/rate-limiter/provider-admission', () => ({
  waitForProviderAdmission: mockAdmit,
  ProviderQuotaExhaustedError: class ProviderQuotaExhaustedError extends Error {},
  PROVIDER_QUOTA_COOLDOWN_MS: 300_000,
  isProviderQuotaExhausted: mockQuotaCheck,
  recordProviderCooldown: mockCooldown,
}))

vi.mock('@/lib/api-key/byok', () => ({
  getBYOKKey: mockGetBYOKKey,
}))

/**
 * Exercises the orchestrator end-to-end against a mocked transport: batching,
 * per-provider item caps, input ordering, dimension resolution, and retry.
 * Every call passes an explicit `apiKey` so BYOK/env/rotating-pool resolution
 * (which needs a database) is bypassed.
 */

const originalFetch = global.fetch

function jsonResponse(body: unknown, status = 200, responseHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: String(status),
    headers: new Headers(responseHeaders),
  })
}

function sizedVector(values: number[], dimensions: number): number[] {
  return [...values, ...Array(Math.max(0, dimensions - values.length)).fill(0)].slice(0, dimensions)
}

function openAICompatibleBody(
  vectors: number[][],
  totalTokens = 5,
  dimensions: number | null = 1536
) {
  return {
    data: vectors.map((embedding) => ({
      embedding: dimensions === null ? embedding : sizedVector(embedding, dimensions),
    })),
    usage: { total_tokens: totalTokens },
  }
}

function openAIBody(vectors: number[][], totalTokens = 5, dimensions: number | null = 1536) {
  const body = openAICompatibleBody(vectors, totalTokens, dimensions)
  return {
    ...body,
    data: body.data.map(({ embedding }) => {
      const bytes = Buffer.alloc(embedding.length * 4)
      embedding.forEach((value, index) => bytes.writeFloatLE(value, index * 4))
      return { embedding: bytes.toString('base64') }
    }),
  }
}

function oversizedChunkedSuccessResponse(): Response {
  const chunkBytes = 1024 * 1024
  const chunk = new Uint8Array(chunkBytes).fill(0x20)
  const chunkCount = Math.floor(MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES / chunkBytes) + 1
  let emitted = 0

  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= chunkCount) {
          controller.close()
          return
        }
        controller.enqueue(chunk)
        emitted++
      },
    }),
    { status: 200 }
  )
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockDiagnosticWarn.mockClear()
  mockQuotaCheck
    .mockReset()
    .mockImplementation(async (identity: { credentialFingerprint: string }) =>
      quotaGates.has(identity.credentialFingerprint)
    )
  mockAdmit.mockReset().mockResolvedValue(undefined)
  mockCooldown.mockReset()
  mockCooldown.mockImplementation(
    async (identity: { credentialFingerprint: string }, _waitMs: number, quota: boolean) => {
      if (quota) quotaGates.add(identity.credentialFingerprint)
    }
  )

  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  mockGetBYOKKey.mockResolvedValue(null)
  setEnv({
    OPENAI_API_KEY: undefined,
    OPENAI_BASE_URL: undefined,
    OPENAI_EXTRA_HEADERS: undefined,
    CLOUDFLARE_AIG_TOKEN: undefined,
  })
})

afterEach(() => {
  quotaGates.clear()
  global.fetch = originalFetch
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetEnvMock()
})

describe('embedding HTTP failure diagnostics', () => {
  const options = { model: 'text-embedding-3-small', projectInputs: null } as const

  it('logs safe OpenAI context internally while preserving the public error and retry policy', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'model_not_found', message: 'private document and private-key' } },
        404,
        { 'x-request-id': 'req_test', authorization: 'Bearer private-key' }
      )
    )
    const error = await embed(['private document'], { ...options, apiKey: 'private-key' }).catch(
      (caught) => caught
    )
    expect(error).toBeInstanceOf(EmbeddingAPIError)
    expect(error.message).toBe('Embedding API failed: 404')
    expect(isTransientEmbeddingError(error)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockDiagnosticWarn).toHaveBeenCalledWith('Embedding provider request failed', {
      providerId: 'openai',
      modelName: 'text-embedding-3-small',
      status: 404,
      providerRequestId: 'req_test',
      providerErrorCode: 'model_not_found',
      providerErrorType: null,
      bodyFormat: 'json',
    })
    expect(JSON.stringify(mockDiagnosticWarn.mock.calls)).not.toContain('private')
    expect(JSON.stringify(error)).not.toContain('req_test')
    expect(JSON.stringify(error)).not.toContain('model_not_found')
  })

  it('keeps the HTTP failure diagnosable when its response body cannot be read', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('private body failure'))
            },
          }),
          { status: 404, headers: { 'x-request-id': 'req_unreadable' } }
        )
    )
    await expect(embed(['text'], { ...options, apiKey: 'key' })).rejects.toThrow(
      'Embedding API failed: 404'
    )
    expect(mockDiagnosticWarn).toHaveBeenCalledWith(
      'Embedding provider request failed',
      expect.objectContaining({
        status: 404,
        providerRequestId: 'req_unreadable',
        bodyFormat: 'unavailable',
      })
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mockDiagnosticWarn.mock.calls)).not.toContain('private')
  })

  it('logs quota rejection before the existing quota circuit wraps the HTTP error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'insufficient_quota' } }, 429))
    await expect(embed(['text'], { ...options, apiKey: 'key' })).rejects.toBeInstanceOf(
      EmbeddingQuotaExhaustedError
    )
    expect(mockDiagnosticWarn).toHaveBeenCalledWith(
      'Embedding provider request failed',
      expect.objectContaining({ status: 429, providerErrorCode: 'insufficient_quota' })
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('embedding cancellation', () => {
  it('cancels a stalled response body after headers arrive without retrying', async () => {
    vi.useFakeTimers()
    const cancelBody = vi.fn()
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel: cancelBody })))
    const controller = new AbortController()
    const pending = embed(['text'], { apiKey: 'key', signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new Error('cancelled'))
    await rejected
    expect(cancelBody).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ends stalled admission at the overall deadline without sending a provider request', async () => {
    vi.useFakeTimers()
    mockAdmit.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const pending = embed(['text'], { apiKey: 'key' })
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'ProviderCapacityDeferredError',
      reason: 'provider_timeout',
      cause: { name: 'TimeoutError' },
    })
    await vi.advanceTimersByTimeAsync(150_000)
    await rejected
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockAdmit).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shares the same deadline between admission and a stalled response body', async () => {
    vi.useFakeTimers()
    mockAdmit.mockImplementationOnce(() => interruptibleSleep(120_000))
    const cancelBody = vi.fn()
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel: cancelBody })))
    const pending = embed(['text'], { apiKey: 'key' })
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'ProviderCapacityDeferredError',
      reason: 'provider_timeout',
      cause: { name: 'TimeoutError' },
    })
    await vi.advanceTimersByTimeAsync(149_999)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(cancelBody).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(cancelBody).toHaveBeenCalledOnce()
    expect(mockAdmit).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves a caller timeout instead of scheduling provider recovery', async () => {
    vi.useFakeTimers()
    const cancelBody = vi.fn()
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel: cancelBody })))
    const controller = new AbortController()
    const timeout = new DOMException('Caller deadline reached', 'TimeoutError')
    const pending = embed(['text'], { apiKey: 'key', signal: controller.signal })
    const rejected = expect(pending).rejects.toBe(timeout)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(timeout)
    await rejected
    expect(cancelBody).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels an in-flight knowledge embedding without retrying', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-key' })
    fetchMock.mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
    )
    const controller = new AbortController()
    const pending = embedKnowledge(['text'], { signal: controller.signal, projectInputs: null })
    const rejected = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await rejected
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('embed', () => {
  it('sends one request for a small batch and returns its vectors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2, 3]], 4)))

    const result = await embed(['hello'], {
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/embeddings')
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      input: ['hello'],
      model: 'text-embedding-3-small',
    })
    expect(result.embeddings[0].slice(0, 3)).toEqual([1, 2, 3])
    expect(result.embeddings[0]).toHaveLength(1536)
    expect(result.totalTokens).toBe(4)
    expect(result.dimensions).toBe(1536)
    expect(result.pricingId).toBe('text-embedding-3-small')
  })

  it('estimates tokens when the provider omits usage', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: openAIBody([[1, 2]]).data }))

    const result = await embed(['some text to embed'], {
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
    })

    expect(result.totalTokens).toBeGreaterThan(0)
  })

  it('splits a long input list into several bounded requests', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      return jsonResponse(openAIBody(body.input.map(() => [1])))
    })

    /**
     * 40 inputs of roughly 500 tokens each exceed the batch target several times
     * over, so they must be spread across requests rather than sent as one.
     * Every input still has to arrive exactly once, in order.
     */
    const inputs = Array.from({ length: 40 }, (_, i) => `${i} ${'word '.repeat(500)}`)
    const result = await embed(inputs, { model: 'text-embedding-3-small', apiKey: 'sk-test' })

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    const sent = fetchMock.mock.calls.flatMap(
      ([, init]) => JSON.parse((init as RequestInit).body as string).input as string[]
    )
    expect(sent).toEqual(inputs)
    expect(result.embeddings).toHaveLength(40)
  })

  it('splits max-dimension batches to the successful-response byte budget and preserves order', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const inputs = body.input as string[]
      return jsonResponse(
        openAIBody(
          inputs.map((input) => [Number(input.slice(1))]),
          inputs.length,
          1536
        )
      )
    })
    const inputs = Array.from({ length: 400 }, (_, index) => `i${index}`)

    const result = await embed(inputs, {
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
    })

    expect(
      fetchMock.mock.calls.map(
        ([, init]) => JSON.parse((init as RequestInit).body as string).input.length
      )
    ).toEqual([339, 61])
    expect(result.embeddings.map(([value]) => value)).toEqual(
      inputs.map((input) => Number(input.slice(1)))
    )
  })

  it('forwards a supported dimension reduction and reports it back', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 5, 1024)))

    const result = await embed(['hello'], {
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1024,
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.dimensions).toBe(1024)
    expect(result.dimensions).toBe(1024)
  })

  /**
   * Regression: the resolved dimensionality is reported back to the caller but
   * must not reach the wire unless the caller asked to reduce: a model without
   * Matryoshka support rejects the parameter outright.
   */
  it('omits the dimension field when no reduction was requested', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))

    const result = await embed(['hello'], {
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).not.toHaveProperty('dimensions')
    expect(result.dimensions).toBe(1536)
  })

  it('rejects an unsupported dimension before making a request', async () => {
    await expect(
      embed(['hello'], { model: 'text-embedding-3-small', apiKey: 'sk-test', dimensions: 999 })
    ).rejects.toThrow(/does not support 999/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown model before making a request', async () => {
    await expect(embed(['hello'], { model: 'nope', apiKey: 'sk-test' })).rejects.toThrow(
      'Unsupported embedding model: nope'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a non-retryable provider error with its status', async () => {
    const echoedSecret = 'sk-provider-echoed-secret'
    fetchMock.mockResolvedValue(jsonResponse({ error: `bad key: ${echoedSecret}` }, 401))

    const error = await embed(['hello'], {
      model: 'text-embedding-3-small',
      apiKey: 'sk-bad',
    }).catch((caught) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/Embedding API failed: 401/)
    expect((error as Error).message).not.toContain(echoedSecret)
    expect(isBYOKEmbeddingCredentialRejection(error)).toBe(true)
    // 401 is not retryable, so exactly one attempt is made.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized chunked success response before JSON materialization', async () => {
    fetchMock.mockResolvedValue(oversizedChunkedSuccessResponse())

    await expect(
      embed(['hello'], { model: 'text-embedding-3-small', apiKey: 'sk-test' })
    ).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
      label: 'Embedding API success response',
      maxBytes: MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'the wrong number of vectors',
      inputs: ['alpha', 'beta'],
      body: openAIBody([[1]], 2),
      message: 'returned 1 embeddings for 2 inputs',
    },
    {
      name: 'an empty vector',
      inputs: ['alpha'],
      body: openAIBody([[]], 1, null),
      message: 'the vector payload could not be parsed',
    },
    {
      name: 'a vector with the wrong catalog dimension',
      inputs: ['alpha'],
      body: openAIBody([[1, 2]], 1, null),
      message: 'the vector payload could not be parsed',
    },
    {
      name: 'a numeric array instead of base64',
      inputs: ['alpha'],
      body: openAICompatibleBody([[1]], 1),
      message: 'the vector payload could not be parsed',
    },
    {
      name: 'an unparseable vector envelope',
      inputs: ['alpha'],
      body: { data: {}, usage: { total_tokens: 1 } },
      message: 'the vector payload could not be parsed',
    },
  ])('rejects a valid-JSON success body containing $name', async ({ inputs, body, message }) => {
    fetchMock.mockResolvedValue(jsonResponse(body))

    await expect(
      embed(inputs, { model: 'text-embedding-3-small', apiKey: 'sk-test' })
    ).rejects.toMatchObject({
      name: 'EmbeddingResponseValidationError',
      message: expect.stringContaining(message),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a valid-JSON success body containing a non-finite coordinate', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[Number.POSITIVE_INFINITY]], 1)))

    await expect(
      embed(['alpha'], { model: 'text-embedding-3-small', apiKey: 'sk-test' })
    ).rejects.toMatchObject({
      name: 'EmbeddingResponseValidationError',
      message: expect.stringContaining('non-numeric or non-finite coordinate'),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects one malformed concurrent batch after admitting all independent batches', async () => {
    const inputs = Array.from({ length: 3 }, (_, index) => `i${index} ${'word '.repeat(5000)}`)
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      const input = (body.input as string[])[0]
      return input.startsWith('i1')
        ? jsonResponse({ data: [], usage: { total_tokens: 1 } })
        : jsonResponse(openAIBody([[Number(input[1])]], 1))
    })

    await expect(
      embed(inputs, { model: 'text-embedding-3-small', apiKey: 'sk-test' })
    ).rejects.toMatchObject({
      name: 'EmbeddingResponseValidationError',
      message: expect.stringContaining('returned 0 embeddings for 1 inputs'),
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('preserves input order when concurrent batches complete out of order', async () => {
    const inputs = Array.from({ length: 3 }, (_, index) => `i${index} ${'word '.repeat(5000)}`)
    const responders = new Map<string, (response: Response) => void>()
    fetchMock.mockImplementation(
      async (_url, init) =>
        new Promise<Response>((resolve) => {
          const body = JSON.parse((init as RequestInit).body as string)
          const input = (body.input as string[])[0]
          responders.set(input.slice(0, 2), resolve)
        })
    )

    const pending = embed(inputs, { model: 'text-embedding-3-small', apiKey: 'sk-test' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    for (const index of [2, 1, 0]) {
      responders.get(`i${index}`)?.(jsonResponse(openAIBody([[index]], 1)))
    }
    const result = await pending

    expect(result.embeddings.map(([value]) => value)).toEqual([0, 1, 2])
  })

  it('retries a rate-limited request and succeeds on a later attempt', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'slow down' }, 429))
      .mockResolvedValueOnce(jsonResponse(openAIBody([[7, 8]])))

    const pending = embed(['hello'], {
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
    })
    await vi.runAllTimersAsync()
    const result = await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.embeddings[0].slice(0, 2)).toEqual([7, 8])
  })

  it('marks a caller-supplied key as BYOK so Labbai does not bill for it', async () => {
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1]])))

    const result = await embed(['hello'], {
      model: 'text-embedding-3-small',
      apiKey: 'sk-user-owned',
    })

    expect(result.isBYOK).toBe(true)
    expect(result.billableTokens).toBe(0)
  })

  /**
   * The knowledge-base path rewrites resolved-secret plaintext back to
   * placeholders before inputs reach a provider. The block path projects
   * earlier, at the tool's HTTP hop, and passes null here so the substitution
   * does not run twice over already-projected content.
   */
  describe('resolved-secret projection', () => {
    it('sends projected inputs, not the originals', async () => {
      fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1], [2]])))

      await embed(['token is sk-live-123', 'harmless'], {
        model: 'text-embedding-3-small',
        apiKey: 'sk-test',
        projectInputs: (values) => values.map((v) => v.replace('sk-live-123', '{{API_KEY}}')),
      })

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.input).toEqual(['token is {{API_KEY}}', 'harmless'])
      expect(JSON.stringify(body)).not.toContain('sk-live-123')
    })

    it('leaves inputs untouched when the caller passes null', async () => {
      fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1]])))

      await embed(['already projected'], {
        model: 'text-embedding-3-small',
        apiKey: 'sk-test',
        projectInputs: null,
      })

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.input).toEqual(['already projected'])
    })

    it('projects once even when the request is retried', async () => {
      vi.useFakeTimers()
      const projectInputs = vi.fn((values: readonly string[]) => values.map(() => 'projected'))
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429))
        .mockResolvedValueOnce(jsonResponse(openAIBody([[1]])))

      const pending = embed(['secret'], {
        model: 'text-embedding-3-small',
        apiKey: 'sk-test',
        projectInputs,
      })
      await vi.runAllTimersAsync()
      await pending

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(projectInputs).toHaveBeenCalledTimes(1)
    })
  })
})

describe('embedding concurrency admission', () => {
  it.each([
    [Number.NaN, 8],
    [0, 1],
    [-10, 1],
    [4.9, 4],
    [10_000, 16],
  ])('clamps %s to %s', (configured, expected) => {
    expect(clampEmbeddingConcurrency(configured)).toBe(expected)
  })
})

describe('knowledge embedding transport', () => {
  const options = {
    model: 'text-embedding-3-small',
    taskType: 'document' as const,
    dimensions: 1536,
    projectInputs: null,
  }

  it('rejects aggregate output above the safe limit before resolving a key', async () => {
    const texts = Array.from({ length: 5000 }, (_, index) => `input-${index}`)
    const projectInputs = vi.fn((inputs: string[]) => inputs)

    await expect(embedKnowledge(texts, { ...options, projectInputs })).rejects.toBeInstanceOf(
      EmbeddingOutputLimitError
    )
    expect(projectInputs).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('embeds with the platform OpenAI key and bills its tokens', async () => {
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 3)))

    const result = await embedKnowledge(['hello'], options)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/embeddings')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer openai-test' })
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    })
    expect(result).toMatchObject({
      billableTokens: 3,
      isBYOK: false,
      modelName: 'text-embedding-3-small',
      pricingId: 'text-embedding-3-small',
      dimensions: 1536,
    })
  })

  it('resolves an openai/-prefixed model id recorded on a knowledge base', async () => {
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 3)))

    const result = await embedKnowledge(['hello'], {
      ...options,
      model: 'openai/text-embedding-3-small',
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: 'text-embedding-3-small',
    })
    expect(result.modelName).toBe('text-embedding-3-small')
  })

  it('sends OpenAI requests to OPENAI_BASE_URL with OPENAI_EXTRA_HEADERS', async () => {
    setEnv({
      OPENAI_API_KEY: 'openai-test',
      OPENAI_BASE_URL: 'https://gateway.example/v1/',
      OPENAI_EXTRA_HEADERS: '{"x-gateway":"yes"}',
    })
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 3)))

    await embedKnowledge(['hello'], options)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://gateway.example/v1/embeddings')
    expect((init as RequestInit).headers).toMatchObject({
      'x-gateway': 'yes',
      Authorization: 'Bearer openai-test',
    })
  })

  it('embeds through the Cloudflare AI Gateway with no OpenAI key and no Authorization', async () => {
    setEnv({
      OPENAI_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/acct/gw/openai',
      CLOUDFLARE_AIG_TOKEN: 'cf-token',
    })
    mockGetBYOKKey.mockClear()
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 3)))

    const result = await embedKnowledge(['hello'], { ...options, workspaceId: 'workspace-1' })

    expect(mockGetBYOKKey).not.toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://gateway.ai.cloudflare.com/v1/acct/gw/openai/embeddings')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['cf-aig-authorization']).toBe('Bearer cf-token')
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('authorization')
    expect(result.isBYOK).toBe(false)
  })

  it('ignores a pasted key in gateway mode and bills the call', async () => {
    setEnv({
      OPENAI_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/acct/gw/openai',
      CLOUDFLARE_AIG_TOKEN: 'cf-token',
    })
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 3)))

    const result = await embed(['hello'], { ...options, apiKey: 'sk-pasted' })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.stringify((init as RequestInit).headers)).not.toContain('sk-pasted')
    expect(result.isBYOK).toBe(false)
  })

  it('fails with a clear error when no OpenAI key is configured', async () => {
    await expect(embedKnowledge(['hello'], options)).rejects.toThrow(
      'OPENAI_API_KEY is not configured'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses a workspace OpenAI key before the platform key', async () => {
    setEnv({ OPENAI_API_KEY: 'platform-openai-test' })
    mockGetBYOKKey.mockResolvedValue({
      apiKey: 'workspace-openai-test',
      isBYOK: true,
      scope: 'workspace',
    })
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))

    const result = await embedKnowledge(['hello'], { ...options, workspaceId: 'workspace-1' })

    expect(mockGetBYOKKey).toHaveBeenCalledWith('workspace-1', 'openai')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/embeddings')
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer workspace-openai-test',
    })
    expect(result.isBYOK).toBe(true)
  })

  it('distinguishes workspace credential rejection from a platform credential failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid key' }, 401))

    setEnv({ OPENAI_API_KEY: 'platform-openai-test' })
    const platformError = await embedKnowledge(['hello'], options).catch((error) => error)
    expect(isBYOKEmbeddingCredentialRejection(platformError)).toBe(false)

    mockGetBYOKKey.mockResolvedValue({ apiKey: 'workspace-openai-test', isBYOK: true })
    const workspaceError = await embedKnowledge(['hello'], {
      ...options,
      workspaceId: 'workspace-1',
    }).catch((error) => error)
    expect(isBYOKEmbeddingCredentialRejection(workspaceError)).toBe(true)
  })

  it('does not retry a fatal provider error', async () => {
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid key' }, 401))

    await expect(embedKnowledge(['hello'], options)).rejects.toThrow(/Embedding API failed: 401/)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  /**
   * The retry loop replaces its own backoff with a provider-stated wait, but only
   * if the wait reaches it. Nothing downstream of the transport could see the
   * response headers, so a rate-limited embedding request retried blind.
   */
  it('carries the provider-stated retry wait onto the thrown error', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: '429',
      headers: new Headers({ 'retry-after': '42' }),
      json: async () => ({ error: 'rate limited' }),
      text: async () => 'rate limited',
    } as Response)

    const pending = embed(['hello'], { ...options, apiKey: 'openai-test' }).catch((e) => e)
    await vi.runAllTimersAsync()
    const error = await pending

    expect(error).toBeInstanceOf(EmbeddingAPIError)
    expect(error.status).toBe(429)
    expect(error.retryAfterMs).toBe(42_000)
  })

  /**
   * A stated wait past the ceiling cannot be honoured, so retrying only clamps
   * every attempt below the reopen time and spends the budget for nothing. The
   * error surfaces at once rather than after the retries burn down.
   */
  it('does not retry a wait it cannot honour', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: '429',
      // Six minutes, far past EMBEDDING_MAX_RETRY_DELAY_MS.
      headers: new Headers({
        'x-ratelimit-remaining-tokens': '0',
        'x-ratelimit-reset-tokens': '6m0s',
      }),
      json: async () => ({ error: 'rate limited' }),
      text: async () => 'rate limited',
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const pending = embedKnowledge(['hello'], options).catch((error) => error)
    await vi.runAllTimersAsync()
    const error = await pending

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(error).toBeInstanceOf(EmbeddingAPIError)
    expect(error.status).toBe(429)
  })

  /**
   * A window shorter than the whole budget is still reachable: the individual
   * waits are clamped below it but they accumulate, so a later attempt lands
   * after it reopens. Refusing these would strand a single-provider caller that
   * had only to wait a little longer than one clamped delay.
   */
  it('keeps retrying a wait the budget can outlast, and recovers', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    let call = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) {
        return {
          ok: false,
          status: 429,
          statusText: '429',
          // Above the per-attempt ceiling, well inside the total budget.
          headers: new Headers({ 'retry-after': '35' }),
          json: async () => ({ error: 'rate limited' }),
          text: async () => 'rate limited',
        } as Response
      }
      return jsonResponse(openAIBody([[4, 4]], 2))
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = embed(['hello'], { ...options, apiKey: 'openai-test' })
    await vi.runAllTimersAsync()
    const result = await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.embeddings[0].slice(0, 2)).toEqual([4, 4])
  })

  /**
   * A spent account never reopens, and the sweep re-queues failed documents every
   * sync — so retrying one burns the budget per document, indefinitely.
   */
  it('does not retry a 429 that reports an exhausted balance', async () => {
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: 'You have no credits remaining.',
            type: 'insufficient_quota',
            code: 'credit_balance_exhausted',
          },
        },
        429
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(embed(['hello'], { ...options, apiKey: 'openai-test' })).rejects.toEqual(
      expect.objectContaining({ name: 'EmbeddingQuotaExhaustedError', quotaExhausted: true })
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('classifies quota JSON beyond the diagnostic truncation boundary', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          diagnosticPadding: 'x'.repeat(10_000),
          error: {
            message: 'You have no credits remaining.',
            type: 'insufficient_quota',
            code: 'insufficient_quota',
          },
        },
        429
      )
    )

    await expect(embed(['hello'], { ...options, apiKey: 'large-quota-body-key' })).rejects.toEqual(
      expect.objectContaining({
        name: 'EmbeddingQuotaExhaustedError',
        status: 429,
      })
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('short-circuits later requests that use the exhausted credential', async () => {
    const quotaResponse = jsonResponse(
      { error: { type: 'insufficient_quota', code: 'insufficient_quota' } },
      429
    )
    fetchMock.mockResolvedValue(quotaResponse)

    await expect(embed(['first'], { ...options, apiKey: 'exhausted-key' })).rejects.toBeInstanceOf(
      EmbeddingQuotaExhaustedError
    )
    await expect(embed(['second'], { ...options, apiKey: 'exhausted-key' })).rejects.toBeInstanceOf(
      EmbeddingQuotaExhaustedError
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * A rate limit with the same status must keep its retries — the two are only
   * distinguishable by the body.
   */
  it('shares hosted pauses across rotated keys while isolating customer keys', async () => {
    setEnv({ OPENAI_API_KEY: 'hosted-first' })
    fetchMock.mockResolvedValue(jsonResponse({ error: { type: 'insufficient_quota' } }, 429))
    await expect(embed(['first'], { model: 'text-embedding-3-small' })).rejects.toBeInstanceOf(
      EmbeddingQuotaExhaustedError
    )
    setEnv({ OPENAI_API_KEY: 'hosted-rotated' })
    await expect(embed(['second'], { model: 'text-embedding-3-small' })).rejects.toBeInstanceOf(
      EmbeddingQuotaExhaustedError
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]], 2)))
    await embed(['customer'], { apiKey: 'separate-customer-key' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mockCooldown).toHaveBeenCalledWith(
      expect.objectContaining({ credentialFingerprint: 'hosted:openai' }),
      300_000,
      true
    )
  })

  it('still retries a 429 that reports a rate limit', async () => {
    vi.useFakeTimers()
    setEnv({ OPENAI_API_KEY: 'openai-test' })
    let call = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers(),
          json: async () => ({}),
          text: async () =>
            JSON.stringify({ error: { message: 'slow down', type: 'rate_limit_exceeded' } }),
        } as Response
      }
      return jsonResponse(openAIBody([[5, 5]], 2))
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = embed(['hello'], { ...options, apiKey: 'openai-test' })
    await vi.runAllTimersAsync()
    const result = await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.embeddings[0].slice(0, 2)).toEqual([5, 5])
  })

  /**
   * An exhausted key rules out the key just used, not the next one in the chain,
   * so failover must still consider it.
   */
  it('keeps an exhausted-balance error eligible for failover', () => {
    const error = new EmbeddingAPIError('Embedding API failed: 429', 429)
    error.quotaExhausted = true
    expect(isTransientEmbeddingError(error)).toBe(true)
  })

  it('classifies aggregate quota exhaustion only when every batch exhausted credit', () => {
    const openAIQuota = new EmbeddingQuotaExhaustedError('openai')
    const secondQuota = new EmbeddingQuotaExhaustedError('openai')

    expect(isEmbeddingQuotaExhaustion(new AggregateError([openAIQuota, secondQuota]))).toBe(true)
    expect(
      isEmbeddingQuotaExhaustion(
        new AggregateError([openAIQuota, new EmbeddingAPIError('temporarily unavailable', 503)])
      )
    ).toBe(false)
  })

  it('classifies only transient embedding failures for failover', () => {
    expect(isTransientEmbeddingError(new EmbeddingAPIError('unavailable', 503))).toBe(true)
    expect(isTransientEmbeddingError(new EmbeddingAPIError('rate limited', 429))).toBe(true)
    expect(isTransientEmbeddingError(new EmbeddingAPIError('invalid key', 401))).toBe(false)
    expect(isTransientEmbeddingError(new DOMException('timed out', 'AbortError'))).toBe(true)
  })

  it('does not misclassify quota-related BYOK rejections as authentication failures', () => {
    const error = new EmbeddingAPIError('Embedding API failed: 403', 403, true)
    error.quotaExhausted = true

    expect(isBYOKEmbeddingCredentialRejection(error)).toBe(false)
  })
})

describe('knowledge embedding capacity preflight', () => {
  const options = { model: 'text-embedding-3-small', dimensions: 1536 }

  it('refuses a paused hosted pool without spending provider admission or making requests', async () => {
    setEnv({ OPENAI_API_KEY: 'platform-key' })
    quotaGates.add('hosted:openai')

    await expect(assertKnowledgeEmbeddingCapacity(options)).rejects.toBeInstanceOf(
      EmbeddingQuotaExhaustedError
    )
    expect(mockAdmit).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks the workspace credential independently of an exhausted hosted pool', async () => {
    setEnv({ OPENAI_API_KEY: 'platform-key' })
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'workspace-key', isBYOK: true })
    quotaGates.add('hosted:openai')

    await expect(
      assertKnowledgeEmbeddingCapacity({ ...options, workspaceId: 'workspace-1' })
    ).resolves.toBeUndefined()
    expect(mockGetBYOKKey).toHaveBeenCalledWith('workspace-1', 'openai')
    const identity = mockQuotaCheck.mock.calls[0][0]
    expect(identity.credentialFingerprint).not.toBe('hosted:openai')
    quotaGates.add(identity.credentialFingerprint)
    await expect(
      assertKnowledgeEmbeddingCapacity({ ...options, workspaceId: 'workspace-1' })
    ).rejects.toBeInstanceOf(EmbeddingQuotaExhaustedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('propagates admission storage failure instead of treating an alternate as available', async () => {
    setEnv({ OPENAI_API_KEY: 'platform-key' })
    const failure = new Error('Quota storage unavailable')
    mockQuotaCheck.mockRejectedValueOnce(failure)
    await expect(assertKnowledgeEmbeddingCapacity(options)).rejects.toBe(failure)
    expect(mockQuotaCheck).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('honors cancellation before and during a quota read', async () => {
    setEnv({ OPENAI_API_KEY: 'platform-key' })
    const controller = new AbortController()
    controller.abort()
    await expect(
      assertKnowledgeEmbeddingCapacity({ ...options, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockQuotaCheck).not.toHaveBeenCalled()

    const duringRead = new AbortController()
    mockQuotaCheck.mockImplementationOnce(async () => {
      duringRead.abort()
      return false
    })
    await expect(
      assertKnowledgeEmbeddingCapacity({ ...options, signal: duringRead.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('durable embedding batches', () => {
  function memoryCheckpoints() {
    const stored = new Map<string, import('@/lib/embeddings/types').EmbeddingBatchResult>()
    return {
      stored,
      load: vi.fn(
        async (identity: import('@/lib/embeddings/types').EmbeddingBatchIdentity) =>
          stored.get(identity.key) ?? null
      ),
      save: vi.fn(
        async (
          identity: import('@/lib/embeddings/types').EmbeddingBatchIdentity,
          result: import('@/lib/embeddings/types').EmbeddingBatchResult
        ) => {
          stored.set(identity.key, result)
        }
      ),
      beforeRequest: vi.fn(),
    }
  }

  it.each([400, 401, 403])(
    'preserves a slower terminal %i response after another batch yields its processing slice',
    async (status) => {
      const checkpoints = memoryCheckpoints()
      checkpoints.beforeRequest.mockImplementationOnce(() => {
        throw new ProviderCapacityDeferredError('processing_budget')
      })
      fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Rejected' } }, status))
      await expect(
        embed(
          Array.from({ length: 24 }, (_, index) => `part ${index} ${'token '.repeat(5000)}`),
          { apiKey: 'fixture-key', checkpoints }
        )
      ).rejects.toMatchObject({ name: 'EmbeddingAPIError', status, isBYOK: true })
      expect(fetchMock).toHaveBeenCalled()
      expect(fetchMock.mock.calls.length).toBeLessThan(24)
      const admittedRequests = fetchMock.mock.calls.length
      await Promise.resolve()
      expect(fetchMock).toHaveBeenCalledTimes(admittedRequests)
    }
  )

  it('retains every admitted batch failure so durable recovery can honor the longest wait', async () => {
    const checkpoints = memoryCheckpoints()
    const shortWait = new ProviderCapacityDeferredError('rate_limit', { retryAfterMs: 60_000 })
    const longWait = new ProviderCapacityDeferredError('rate_limit', { retryAfterMs: 600_000 })
    checkpoints.beforeRequest
      .mockImplementationOnce(() => {
        throw shortWait
      })
      .mockImplementation(() => {
        throw longWait
      })
    await expect(
      embed(
        Array.from({ length: 24 }, (_, index) => `part ${index} ${'token '.repeat(5000)}`),
        { apiKey: 'fixture-key', checkpoints }
      )
    ).rejects.toMatchObject({
      name: 'AggregateError',
      errors: expect.arrayContaining([shortWait, longWait]),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the checkpointed admission wait inside the retry budget the processing deadline reserves', () => {
    expect(KNOWLEDGE_EMBEDDING_ADMISSION_WAIT_MS).toBeLessThan(EMBEDDING_RETRY_BUDGET_MS)
  })

  it('limits checkpointed admission waits and keeps interactive callers off the bulk lane', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(openAIBody([[1]], 7))))
    await embed(['text'], { apiKey: 'fixture-key', checkpoints: memoryCheckpoints() })
    expect(mockAdmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxWaitMs: KNOWLEDGE_EMBEDDING_ADMISSION_WAIT_MS, bulk: true })
    )
    await embed(['text'], { apiKey: 'fixture-key' })
    expect(mockAdmit).toHaveBeenLastCalledWith(expect.objectContaining({ bulk: false }))
    expect(mockAdmit.mock.lastCall?.[0].maxWaitMs).toBeGreaterThan(
      KNOWLEDGE_EMBEDDING_ADMISSION_WAIT_MS
    )
  })

  it('drains admitted batches, resumes only missing requests and retains the complete token charge', async () => {
    const checkpoints = memoryCheckpoints()
    const texts = Array.from({ length: 24 }, (_, i) => `section ${i} ${'token '.repeat(5000)}`)
    const successful = new Set<string>()
    let failOnce = true
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const inputs = (JSON.parse(String(init.body)) as { input: string[] }).input
      if (failOnce && inputs[0].startsWith('section 1 ')) {
        failOnce = false
        return jsonResponse({ error: { message: 'Synthetic rejection' } }, 400)
      }
      for (const input of inputs) {
        expect(successful.has(input)).toBe(false)
        successful.add(input)
      }
      return jsonResponse(
        openAIBody(
          inputs.map(() => [1]),
          inputs.length * 5000
        )
      )
    })
    const options = {
      apiKey: 'fixture-key',
      model: 'text-embedding-3-small',
      projectInputs: null,
      checkpoints,
    } as const
    await expect(embed(texts, options)).rejects.toThrow('Embedding API failed: 400')
    expect(successful.size).toBeGreaterThan(0)
    expect(successful.size).toBeLessThan(texts.length)
    expect(checkpoints.stored.size).toBe(successful.size)
    const afterFailure = fetchMock.mock.calls.length
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(afterFailure)
    const result = await embed(texts, options)
    expect(result.embeddings).toHaveLength(texts.length)
    expect(result.totalTokens).toBe(120000)
    expect(successful.size).toBe(texts.length)
    expect(fetchMock).toHaveBeenCalledTimes(texts.length + 1)
  })

  it('reuses only requests with the current projected inputs, credential, task and dimensions', async () => {
    const checkpoints = memoryCheckpoints()
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[]; dimensions?: number }
      return jsonResponse(
        openAIBody(
          body.input.map(() => [1]),
          7,
          body.dimensions ?? 1536
        )
      )
    })
    const base = {
      apiKey: 'fixture-key',
      model: 'text-embedding-3-small',
      projectInputs: () => ['projected-one'],
      checkpoints,
    } as const
    await embed(['private input'], base)
    checkpoints.beforeRequest.mockImplementation(() => {
      throw new Error('new request refused')
    })
    expect((await embed(['private input'], base)).totalTokens).toBe(7)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(embed(['private input'], { ...base, apiKey: 'replacement-key' })).rejects.toThrow(
      'new request refused'
    )
    await expect(
      embed(['private input'], { ...base, projectInputs: () => ['projected-two'] })
    ).rejects.toThrow('new request refused')
    await expect(embed(['private input'], { ...base, dimensions: 512 })).rejects.toThrow(
      'new request refused'
    )
    await expect(embed(['private input'], { ...base, taskType: 'query' })).rejects.toThrow(
      'new request refused'
    )
    expect(JSON.stringify([...checkpoints.stored.keys()])).not.toContain('private input')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('preserves valid projected OpenAI inputs when the heuristic exceeds the token limit', async () => {
    const text = 'x();\n'.repeat(3200).trimEnd()
    const checkpoints = memoryCheckpoints()
    fetchMock.mockResolvedValue(jsonResponse(openAIBody([[1, 2]])))

    await embed(['source input'], {
      apiKey: 'fixture-key',
      model: 'text-embedding-3-small',
      projectInputs: () => [text],
      checkpoints,
      inputOverflow: 'reject',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toEqual([text])
    expect(checkpoints.save).toHaveBeenCalledOnce()
  })

  it('rejects projected indexing inputs that would otherwise be silently shortened', async () => {
    const checkpoints = memoryCheckpoints()
    await expect(
      embed(['short input'], {
        apiKey: 'fixture-key',
        model: 'text-embedding-3-small',
        projectInputs: () => ['token '.repeat(20000)],
        checkpoints,
        inputOverflow: 'reject',
      })
    ).rejects.toThrow('projected embedding input exceeds')
    expect(checkpoints.load).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
