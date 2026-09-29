import { createLogger } from '@labbai/logger'
import { sha256Hex } from '@labbai/security/hash'
import { chunkArray } from '@labbai/utils/helpers'
import { truncate } from '@labbai/utils/string'
import { env, envNumber } from '@/lib/core/config/env'
import {
  ProviderQuotaExhaustedError,
  recordProviderCooldown,
  waitForProviderAdmission,
} from '@/lib/core/rate-limiter/provider-admission'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { EmbeddingAPIError } from '@/lib/embeddings/api-error'
import {
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingModelInfo,
  getEmbeddingModelInfo,
  hasApproximateTokenCount,
  normalizeEmbeddingModelId,
  resolveDimensions,
} from '@/lib/embeddings/catalog'
import { getEmbeddingResponseDiagnostic } from '@/lib/embeddings/error-diagnostics'
import { resolveProviderKey } from '@/lib/embeddings/keys'
import { getAdapterFactory } from '@/lib/embeddings/providers'
import {
  createEmbeddingQuotaCircuitIdentity,
  type EmbeddingQuotaCircuitIdentity,
  isEmbeddingQuotaCircuitOpen,
  openEmbeddingQuotaCircuit,
} from '@/lib/embeddings/quota-circuit'
import { resolveEmbeddingRetryDelayMs } from '@/lib/embeddings/rate-limit'
import type {
  EmbeddingBatchCheckpoints,
  EmbeddingBatchResult,
  EmbeddingProviderAdapter,
  EmbeddingProviderKind,
  EmbeddingTaskType,
  EmbedOptions,
  EmbedResult,
} from '@/lib/embeddings/types'
import {
  attachRetryHeaders,
  isRetryableError,
  retryWithExponentialBackoff,
} from '@/lib/knowledge/documents/utils'
import { estimateTokenCount } from '@/lib/tokenization'
import {
  batchByTokenLimit,
  getAccurateTokenCount,
  truncateToTokenLimit,
} from '@/lib/tokenization/accurate'

const logger = createLogger('EmbeddingClient')

/**
 * Embedding requests issued concurrently within a single embed call.
 *
 * A provider's rate limit is per API key, so this multiplies with however many
 * documents are being processed at once. That document count is no longer a
 * single number: the processing queues admit
 * {@link env.KB_CONFIG_CONCURRENCY_LIMIT} interactive and
 * {@link env.KB_CONFIG_BACKFILL_CONCURRENCY_LIMIT} backfill runs *per tenant*,
 * bounded in aggregate by the Trigger.dev environment concurrency limit, and
 * each run reaches here. The product is held down instead by the durable
 * per-credential token bucket in `waitForProviderAdmission`, which every one of
 * those runs shares. This factor was previously read from the same variable as
 * the queue depth, so one knob set both and the product reached four figures of
 * in-flight requests against one key — enough to hold a provider at its limit
 * indefinitely, which no retry policy can absorb.
 *
 * The `bulk` parameter below is a different axis: it marks document indexing as
 * opposed to query-time embedding, and is true for an interactive upload too.
 */
const DEFAULT_CONCURRENT_BATCHES = 8
const MAX_ALLOWED_CONCURRENT_BATCHES = 16

/** Keeps one worker's fan-out inside a tested local memory/concurrency ceiling. */
export function clampEmbeddingConcurrency(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONCURRENT_BATCHES
  return Math.min(Math.max(Math.floor(value), 1), MAX_ALLOWED_CONCURRENT_BATCHES)
}

const configuredEmbeddingConcurrency = envNumber(
  env.KB_CONFIG_EMBEDDING_CONCURRENCY,
  DEFAULT_CONCURRENT_BATCHES
)
const MAX_CONCURRENT_BATCHES = clampEmbeddingConcurrency(configuredEmbeddingConcurrency)
if (configuredEmbeddingConcurrency !== MAX_CONCURRENT_BATCHES) {
  logger.warn('Clamped embedding batch concurrency to the worker safety range', {
    configured: configuredEmbeddingConcurrency,
    effective: MAX_CONCURRENT_BATCHES,
    maximum: MAX_ALLOWED_CONCURRENT_BATCHES,
  })
}
const EMBEDDING_REQUEST_TIMEOUT_MS = 60_000

/**
 * Tokens this client aims to put in one request. Not a provider limit — every
 * provider accepts at least this much, and OpenAI documents 300,000 — but the
 * batch size the knowledge-base indexing path has run on in production.
 *
 * Kept here rather than raised to each provider's maximum so a request stays
 * comfortably inside {@link EMBEDDING_REQUEST_TIMEOUT_MS}: a timed-out batch is
 * retried three times, so large batches make a slow provider expensive to fail
 * against. Raising this trades fewer round trips for costlier retries.
 */
const BATCH_TOKEN_TARGET = 8192

/**
 * Hard ceiling on one successful embedding response.
 *
 * OpenAI batches are split below from their expected vector width so each
 * response fits inside 16 MiB, including a conservative JSON representation
 * allowance; the guard therefore rejects malformed provider output rather than
 * valid catalog traffic.
 */
export const MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES = 16 * 1024 * 1024

/** Bounds vectors retained across batches, aligned with the app's 100 MiB response ceiling. */
export const MAX_EMBEDDING_AGGREGATE_RESPONSE_BYTES = 100 * 1024 * 1024

/** Leaves room for the provider envelope, usage metadata, indices, and delimiters. */
const EMBEDDING_RESPONSE_ENVELOPE_RESERVE_BYTES = 64 * 1024

/**
 * JSON may render a finite double with more characters than its in-memory
 * representation. Thirty-two bytes per coordinate is deliberately conservative
 * for the number, comma, and surrounding array syntax.
 */
const EMBEDDING_RESPONSE_BYTES_PER_DIMENSION = 32
const EMBEDDING_RESPONSE_BYTES_PER_ITEM = 128

/** Retries after the initial attempt, per embedding request. */
export const EMBEDDING_MAX_RETRIES = 5

/** Ceiling on exponential backoff when the provider supplies no retry delay. */
export const EMBEDDING_MAX_RETRY_DELAY_MS = 30_000

/**
 * Longest a request can stay in the retry loop. An admitted provider-stated wait
 * is honored in full when it fits inside this deadline.
 */
export const EMBEDDING_RETRY_BUDGET_MS = EMBEDDING_MAX_RETRIES * EMBEDDING_MAX_RETRY_DELAY_MS

/**
 * How long a checkpointed indexing batch waits for the shared admission bucket
 * before the document yields its slot. Twenty concurrent documents fanning out
 * eight batches each can queue for a couple of minutes behind the configured
 * per-minute budget; yielding after a few seconds turned every such wait into a
 * full re-dispatch with a minute-or-more delay. A minute of idle waiting is far
 * cheaper than that round trip, and the per-request retry budget still bounds
 * the whole attempt. Interactive callers keep the full request budget.
 */
export const KNOWLEDGE_EMBEDDING_ADMISSION_WAIT_MS = 60_000

class EmbeddingResponseValidationError extends EmbeddingAPIError {
  constructor(message: string) {
    super(`Embedding API returned an invalid success response: ${message}`, 502)
    this.name = 'EmbeddingResponseValidationError'
  }
}

export class EmbeddingInputLimitError extends Error {
  constructor(model: string, maxInputTokens: number) {
    super(
      `A projected embedding input exceeds the ${maxInputTokens.toLocaleString()}-token limit for ${model}. Reduce the knowledge-base chunk size and retry.`
    )
    this.name = 'EmbeddingInputLimitError'
  }
}

export class EmbeddingOutputLimitError extends Error {
  constructor(itemCount: number, dimensions: number, estimatedBytes: number) {
    super(
      `Embedding output for ${itemCount} inputs at ${dimensions} dimensions is estimated at ${estimatedBytes} bytes, exceeding the safe aggregate limit of ${MAX_EMBEDDING_AGGREGATE_RESPONSE_BYTES} bytes`
    )
    this.name = 'EmbeddingOutputLimitError'
  }
}

export const EMBEDDING_QUOTA_EXHAUSTED_MESSAGE =
  'The embedding provider has exhausted its available quota. Add credit or replace the credential before retrying.'

export const BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE =
  'The configured embedding API key was rejected. Update the key and retry this document.'

/**
 * A provider credential has no remaining credit. This remains transient across
 * providers so a configured fallback can run, but it is terminal for the
 * credential and for a Trigger task after every fallback is exhausted.
 */
export class EmbeddingQuotaExhaustedError extends EmbeddingAPIError {
  public readonly providerId: EmbeddingProviderKind

  constructor(providerId: EmbeddingProviderKind, cause?: unknown) {
    const status = cause instanceof EmbeddingAPIError ? cause.status : 429
    super(
      `The ${providerId} embedding credential has exhausted its available quota. Add credit or replace the credential before retrying.`,
      status,
      cause instanceof EmbeddingAPIError && cause.isBYOK
    )
    this.name = 'EmbeddingQuotaExhaustedError'
    this.providerId = providerId
    this.quotaExhausted = true
    this.cause = cause
  }
}

/**
 * True only when the overall embedding operation failed because every provider
 * it attempted had exhausted credit. A mixed fallback failure must retain task
 * retries because another provider may merely be temporarily unavailable.
 */
export function isEmbeddingQuotaExhaustion(error: unknown): boolean {
  if (error instanceof ProviderQuotaExhaustedError) return true
  if (error instanceof EmbeddingAPIError) return error.quotaExhausted === true
  if (error instanceof AggregateError) {
    return error.errors.length > 0 && error.errors.every(isEmbeddingQuotaExhaustion)
  }
  return false
}

/**
 * True when a customer-managed embedding credential was rejected outright.
 * These failures require a key or permission change; retrying the same request
 * cannot recover. Quota failures are classified separately even when a provider
 * reports them with HTTP 403.
 */
export function isBYOKEmbeddingCredentialRejection(error: unknown): error is EmbeddingAPIError {
  return (
    error instanceof EmbeddingAPIError &&
    error.isBYOK &&
    !error.quotaExhausted &&
    (error.status === 401 || error.status === 403)
  )
}

/**
 * True when a rejection body reports an exhausted balance rather than a rate
 * limit. OpenAI returns 429 for both, but only a rate limit reopens: a spent
 * account stands until someone adds credit, so retrying it cannot succeed.
 */
function isQuotaExhaustionBody(errorText: string): boolean {
  try {
    const body = JSON.parse(errorText) as { error?: { type?: string; code?: string } }
    const type = body.error?.type
    const code = body.error?.code
    return (
      type === 'insufficient_quota' ||
      code === 'insufficient_quota' ||
      code === 'credit_balance_exhausted'
    )
  } catch {
    return false
  }
}

/** Reads a bounded provider body for internal diagnostics and quota classification. */
async function readEmbeddingErrorBody(response: Response, signal?: AbortSignal): Promise<string> {
  try {
    return await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Embedding API error response',
      signal,
    })
  } catch {
    signal?.throwIfAborted()
    return ''
  }
}

/**
 * True when the provider's stated wait outlasts the entire retry budget.
 *
 * The retry layer honors a provider-stated wait in full only when it fits inside
 * the remaining operation deadline. A wait longer than the entire embedding
 * budget can therefore never be admitted.
 *
 * The error stays transient — it just is not worth retrying here — so refusing
 * the retry surfaces it immediately and the fallback chain, which classifies
 * separately via `shouldFallback`, reaches the next provider at once. Where no
 * fallback is configured the request fails either way; this only decides whether
 * it fails now or after the budget burns down for nothing.
 */
function statedWaitOutlastsBudget(error: unknown): boolean {
  return (
    error instanceof EmbeddingAPIError &&
    error.retryAfterMs !== undefined &&
    error.retryAfterMs > EMBEDDING_RETRY_BUDGET_MS
  )
}

/**
 * Whether another attempt against the *same* provider could succeed. Narrower
 * than {@link isTransientEmbeddingError}, which decides whether to fail over to a
 * different one: an exhausted balance rules out the key just used but says
 * nothing about the next in the chain.
 */
function isWorthRetrying(error: unknown): boolean {
  if (!isTransientEmbeddingError(error)) return false
  if (error instanceof EmbeddingResponseValidationError) return false
  if (error instanceof EmbeddingAPIError && error.quotaExhausted) return false
  return !statedWaitOutlastsBudget(error)
}

export function isTransientEmbeddingError(error: unknown): boolean {
  if (error instanceof EmbeddingAPIError) {
    if (error.quotaExhausted) return true
    return error.status === 429 || error.status >= 500
  }
  if (error instanceof Error && error.name === 'AbortError') return true
  return isRetryableError(error)
}

interface ResolvedProvider {
  adapter: EmbeddingProviderAdapter
  info: EmbeddingModelInfo
  providerId: EmbeddingProviderKind
  quotaCircuitIdentity: EmbeddingQuotaCircuitIdentity
  /** Model name as sent to the provider. */
  modelName: string
  /** Dimensionality the request will produce, for reporting and billing. */
  dimensions: number
  isBYOK: boolean
}

/**
 * Labbai: one provider (OpenAI). A caller-supplied key (the Embeddings block's
 * pasted key) wins, then the workspace's OpenAI BYOK key, then the platform
 * `OPENAI_API_KEY`.
 */
async function resolveProvider(
  model: string,
  options: Omit<EmbedOptions, 'projectInputs'>
): Promise<ResolvedProvider> {
  const info = getEmbeddingModelInfo(model)
  const dimensions = resolveDimensions(info, options.dimensions)
  const modelName = normalizeEmbeddingModelId(model)

  const { apiKey, isBYOK } = options.apiKey
    ? { apiKey: options.apiKey, isBYOK: true }
    : await resolveProviderKey(info.provider, options.workspaceId)

  return {
    adapter: getAdapterFactory(info.provider)({
      modelName,
      apiKey,
      nativeDimensions: info.nativeDimensions,
    }),
    info,
    providerId: info.provider,
    quotaCircuitIdentity: createEmbeddingQuotaCircuitIdentity(info.provider, apiKey),
    modelName,
    dimensions,
    isBYOK,
  }
}

function validateEmbeddingBatch(
  value: unknown,
  expectedCount: number,
  expectedDimensions: number | undefined
): { embeddings: number[][]; dimensions: number } {
  if (!Array.isArray(value)) {
    throw new EmbeddingResponseValidationError('the vector payload is not an array')
  }
  if (value.length !== expectedCount) {
    throw new EmbeddingResponseValidationError(
      `returned ${value.length} embeddings for ${expectedCount} inputs`
    )
  }

  let resolvedDimensions = expectedDimensions
  for (let index = 0; index < value.length; index++) {
    const vector = value[index]
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new EmbeddingResponseValidationError(`vector ${index} is empty or not an array`)
    }
    if (
      vector.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))
    ) {
      throw new EmbeddingResponseValidationError(
        `vector ${index} contains a non-numeric or non-finite coordinate`
      )
    }

    resolvedDimensions ??= vector.length
    if (vector.length !== resolvedDimensions) {
      const qualifier = expectedDimensions === undefined ? 'inconsistent' : 'unexpected'
      throw new EmbeddingResponseValidationError(
        `vector ${index} has ${vector.length} ${qualifier} dimensions; expected ${resolvedDimensions}`
      )
    }
  }

  if (resolvedDimensions === undefined) {
    throw new EmbeddingResponseValidationError('the response did not contain any vectors')
  }
  return { embeddings: value as number[][], dimensions: resolvedDimensions }
}

/** Deployment-managed key rotations share one operating budget and provider pause. */
function embeddingAdmissionIdentity(
  provider: Pick<ResolvedProvider, 'providerId' | 'quotaCircuitIdentity' | 'isBYOK'>
): EmbeddingQuotaCircuitIdentity {
  return provider.isBYOK
    ? provider.quotaCircuitIdentity
    : { providerId: provider.providerId, credentialFingerprint: `hosted:${provider.providerId}` }
}

/** `inputs` are already projected and batched by the embedding orchestrator. */
async function callEmbeddingAPI(
  inputs: string[],
  adapter: EmbeddingProviderAdapter,
  tokenizerProvider: string,
  taskType: EmbeddingTaskType,
  providerId: EmbeddingProviderKind,
  modelName: string,
  quotaCircuitIdentity: EmbeddingQuotaCircuitIdentity,
  /**
   * The caller's explicit reduction, or undefined when none was requested. Kept
   * distinct from `provider.dimensions` because a model without Matryoshka
   * support rejects the parameter outright — sending it populated with the
   * native size is a 400, not a no-op.
   */
  requestedDimensions: number | undefined,
  expectedDimensions: number | undefined,
  isBYOK: boolean,
  signal?: AbortSignal,
  /** Bulk indexing waits briefly and is capped below the credential budget; everything else has a person waiting on it. */
  bulk = false
): Promise<{ embeddings: number[][]; totalTokens: number; dimensions: number }> {
  const admissionWaitMs = bulk ? KNOWLEDGE_EMBEDDING_ADMISSION_WAIT_MS : EMBEDDING_RETRY_BUDGET_MS
  const admissionIdentity = embeddingAdmissionIdentity({ providerId, quotaCircuitIdentity, isBYOK })
  return retryWithExponentialBackoff(
    async (operationSignal, deadlineAt) => {
      if (await isEmbeddingQuotaCircuitOpen(admissionIdentity)) {
        throw new EmbeddingQuotaExhaustedError(providerId)
      }

      try {
        await waitForProviderAdmission({
          ...admissionIdentity,
          operation: 'embedding',
          inputTokens: inputs.reduce(
            (sum, text) => sum + estimateTokenCount(text, tokenizerProvider).count,
            0
          ),
          signal: operationSignal,
          maxWaitMs: Math.min(admissionWaitMs, Math.max(0, deadlineAt - Date.now())),
          bulk,
        })
      } catch (error) {
        if (error instanceof ProviderQuotaExhaustedError)
          throw new EmbeddingQuotaExhaustedError(providerId, error)
        throw error
      }

      const request = adapter.buildRequest({
        inputs,
        taskType,
        dimensions: requestedDimensions,
      })

      operationSignal?.throwIfAborted()
      const controller = new AbortController()
      const onAbort = () => controller.abort(operationSignal?.reason)
      operationSignal?.addEventListener('abort', onAbort, { once: true })
      if (operationSignal?.aborted) onAbort()
      const timeout = setTimeout(() => controller.abort(), EMBEDDING_REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(request.apiUrl, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.body),
          signal: controller.signal,
        })

        if (!response.ok) {
          const classificationBody = await readEmbeddingErrorBody(response, controller.signal)
          logger.warn('Embedding provider request failed', {
            providerId,
            modelName: truncate(modelName, 256),
            status: response.status,
            ...getEmbeddingResponseDiagnostic(response.headers, classificationBody),
          })
          const error = new EmbeddingAPIError(
            `Embedding API failed: ${response.status}`,
            response.status,
            isBYOK
          )
          error.quotaExhausted = isQuotaExhaustionBody(classificationBody)

          if (error.quotaExhausted) {
            await openEmbeddingQuotaCircuit(admissionIdentity)
            throw new EmbeddingQuotaExhaustedError(providerId, error)
          }

          /**
           * Carry the provider's own answer to "when may I retry" onto the error,
           * the way `fetchWithRetry` does for connectors. Without it the retry
           * loop had nothing but blind exponential backoff and would exhaust every
           * attempt inside a rate-limit window that had not yet reopened.
           *
           * The headers travel non-enumerably so the retry condition can re-read
           * them without the bag reaching a log line.
           */
          attachRetryHeaders(error, response.headers)
          const waitMs = resolveEmbeddingRetryDelayMs(response.headers)
          if (waitMs !== null) {
            error.retryAfterMs = waitMs
          }

          if (response.status === 429) {
            await recordProviderCooldown(
              { ...admissionIdentity, operation: 'embedding' },
              waitMs ?? 1000
            )
          }
          throw error
        }

        const json = await readResponseJsonWithLimit(response, {
          maxBytes: MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES,
          label: 'Embedding API success response',
          signal: controller.signal,
        })
        let parsedEmbeddings: unknown
        try {
          parsedEmbeddings = request.parse(json)
        } catch {
          throw new EmbeddingResponseValidationError('the vector payload could not be parsed')
        }
        const { embeddings, dimensions } = validateEmbeddingBatch(
          parsedEmbeddings,
          inputs.length,
          expectedDimensions
        )
        /**
         * Fallback for a response that carries no usage block. Estimated with the
         * provider's own tokenizer, which is approximate for every non-OpenAI
         * model — see {@link hasApproximateTokenCount}.
         */
        const totalTokens =
          request.parseTokens?.(json) ??
          inputs.reduce((sum, text) => sum + estimateTokenCount(text, tokenizerProvider).count, 0)

        return { embeddings, totalTokens, dimensions }
      } finally {
        clearTimeout(timeout)
        operationSignal?.removeEventListener('abort', onAbort)
      }
    },
    {
      /**
       * Sized against a rate-limit window rather than a transient blip. The
       * provider states its reset in tens of seconds, and the loop honors that
       * wait when it fits inside the operation budget.
       *
       * Bounded so a fully saturated provider cannot outlive the task: five
       * attempts at the ceiling is well inside `KB_CONFIG_MAX_DURATION`, and
       * batches wait concurrently rather than one after another.
       */
      maxRetries: EMBEDDING_MAX_RETRIES,
      initialDelayMs: 1000,
      maxDelayMs: EMBEDDING_MAX_RETRY_DELAY_MS,
      retryBudgetMs: EMBEDDING_RETRY_BUDGET_MS,
      retryCondition: (error) => !signal?.aborted && isWorthRetrying(error),
      signal,
    }
  ).catch((error: unknown) => {
    signal?.throwIfAborted()
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ProviderCapacityDeferredError('provider_timeout', {
        providerId,
        retryAfterMs: 60_000,
        cause: error,
      })
    }
    throw error
  })
}

interface EmbeddingInputLimits {
  maxInputTokens: number
  maxTokensPerRequest?: number
  tokenizerProvider: string
  approximateTokenCount: boolean
}

function getEmbeddingInputLimits(info: EmbeddingModelInfo): EmbeddingInputLimits {
  return {
    maxInputTokens: info.maxInputTokens,
    maxTokensPerRequest: info.maxTokensPerRequest,
    tokenizerProvider: info.tokenizerProvider,
    approximateTokenCount: hasApproximateTokenCount(info),
  }
}

function prepareEmbeddingInputs(
  texts: string[],
  model: string,
  limits: EmbeddingInputLimits,
  projectInputs: EmbedOptions['projectInputs'],
  inputOverflow: EmbedOptions['inputOverflow'] = 'truncate'
): string[] {
  /**
   * Projected before batching, not after. The projector rewrites resolved-secret
   * plaintext to placeholders, which changes length, and `batchByTokenLimit`
   * measures and truncates whatever it is handed. Batching the pre-projection
   * text would size against a different string than the one actually sent: a
   * lengthening projection then exceeds the model's ceiling and the provider
   * rejects it, and a shortening one discards content that would have fit.
   *
   * Doing it here also keeps projection to exactly once per call, so no retry
   * can re-project already-projected content.
   */
  const modelInputs = projectInputs ? projectInputs(texts) : texts

  /**
   * Each input is held to the model's own per-input ceiling, exactly as declared.
   * One shared constant sent oversized input to models with a lower limit and
   * discarded content models with a higher one accept; discounting the ceiling
   * to absorb tokenizer error would reintroduce the second harm.
   *
   * Truncation happens here rather than inside `batchByTokenLimit` so it occurs
   * once, against the right limit, and is always warned about: a shortened
   * embedding input is otherwise indistinguishable from a good one, both to the
   * caller and in the vector it produces.
   */
  const ceiling = limits.maxInputTokens
  const boundedInputs = modelInputs.map((text) => {
    let tokenCount = estimateTokenCount(text, limits.tokenizerProvider).count
    if (inputOverflow === 'reject') {
      const tokenizerCount = getAccurateTokenCount(text, model)
      tokenCount = limits.approximateTokenCount
        ? Math.max(tokenCount, tokenizerCount)
        : tokenizerCount
    }
    if (tokenCount <= ceiling) return text
    if (inputOverflow === 'reject') throw new EmbeddingInputLimitError(model, ceiling)
    logger.warn('Embedding input exceeds the model token limit and will be truncated', {
      model,
      maxInputTokens: ceiling,
      chars: text.length,
      approximateTokenCount: limits.approximateTokenCount,
    })
    return truncateToTokenLimit(text, ceiling, model)
  })

  return boundedInputs
}

/** Stops admitting new work on failure and drains admitted batches before handing off ownership. */
async function mapEmbeddingBatches<T, R>(
  batches: readonly T[],
  mapper: (batch: T, index: number) => Promise<R>
): Promise<R[]> {
  const failures: unknown[] = []
  const results = await mapWithConcurrency(
    batches,
    MAX_CONCURRENT_BATCHES,
    async (batch, index) => {
      if (failures.length > 0) return undefined
      try {
        return { value: await mapper(batch, index) }
      } catch (error) {
        failures.push(error)
        return undefined
      }
    }
  )
  if (failures.length > 0) {
    /** A slower terminal response must not disappear behind another batch's earlier throttle. */
    const terminalFailure =
      failures.find((error) => error instanceof Error && error.name === 'AbortError') ??
      failures.find(
        (error) => error instanceof EmbeddingAPIError && !isTransientEmbeddingError(error)
      )
    if (terminalFailure) throw terminalFailure
    if (failures.length === 1) throw failures[0]
    throw new AggregateError(failures, 'Embedding batches could not complete')
  }
  return results.map((result) => result!.value)
}

/** Checkpoints mark the bulk indexing path; every other caller is interactive. */
async function callCheckpointedEmbeddingBatch(
  batch: string[],
  batchIndex: number,
  inputHash: string,
  taskType: EmbeddingTaskType,
  requestedDimensions: number | undefined,
  provider: ResolvedProvider,
  signal?: AbortSignal,
  checkpoints?: EmbeddingBatchCheckpoints
): Promise<EmbeddingBatchResult> {
  signal?.throwIfAborted()
  const identity = checkpoints
    ? {
        key: sha256Hex(
          JSON.stringify({
            version: 1,
            inputHash,
            batchIndex,
            batchHash: sha256Hex(JSON.stringify(batch)),
            ...embeddingAdmissionIdentity(provider),
            modelName: provider.modelName,
            endpoint: provider.adapter.buildRequest({
              inputs: [],
              taskType,
              dimensions: requestedDimensions,
            }).apiUrl,
            dimensions: provider.dimensions,
            requestedDimensions,
            taskType,
            isBYOK: provider.isBYOK,
          })
        ),
        itemCount: batch.length,
        dimensions: provider.dimensions,
      }
    : undefined
  if (identity) {
    const cached = await checkpoints!.load(identity, signal)
    signal?.throwIfAborted()
    if (cached) return cached
    checkpoints!.beforeRequest()
  }
  const result = await callEmbeddingAPI(
    batch,
    provider.adapter,
    provider.info.tokenizerProvider,
    taskType,
    provider.providerId,
    provider.modelName,
    provider.quotaCircuitIdentity,
    requestedDimensions,
    provider.dimensions,
    provider.isBYOK,
    signal,
    checkpoints !== undefined
  )
  if (identity) await checkpoints!.save(identity, result, signal)
  return result
}

async function embedWithProvider(
  boundedInputs: string[],
  model: string,
  taskType: EmbeddingTaskType,
  requestedDimensions: number | undefined,
  provider: ResolvedProvider,
  signal?: AbortSignal,
  checkpoints?: EmbeddingBatchCheckpoints
): Promise<EmbedResult> {
  signal?.throwIfAborted()
  assertEmbeddingAggregateResponseWithinLimit(boundedInputs.length, provider.dimensions)
  const batches = createEmbeddingBatches(
    boundedInputs,
    model,
    getEmbeddingInputLimits(provider.info),
    provider.adapter.maxItemsPerRequest,
    provider.dimensions
  )

  const inputHash = checkpoints ? sha256Hex(JSON.stringify(boundedInputs)) : ''
  const batchResults = await mapEmbeddingBatches(batches, async (batch, i) => {
    try {
      signal?.throwIfAborted()
      return await callCheckpointedEmbeddingBatch(
        batch,
        i,
        inputHash,
        taskType,
        requestedDimensions,
        provider,
        signal,
        checkpoints
      )
    } catch (error) {
      const message = `Failed to generate embeddings for batch ${i + 1}/${batches.length}:`
      if (isEmbeddingQuotaExhaustion(error)) {
        logger.warn(message, { providerId: provider.providerId, quotaExhausted: true })
      } else if (isBYOKEmbeddingCredentialRejection(error)) {
        logger.warn(message, {
          providerId: provider.providerId,
          outcome: 'customer_configuration',
          status: error.status,
        })
      } else {
        logger.error(message, error)
      }
      throw error
    }
  })

  const { embeddings, totalTokens } = combineEmbeddingBatches(batchResults)

  return {
    embeddings,
    totalTokens,
    billableTokens: provider.isBYOK ? 0 : totalTokens,
    isBYOK: provider.isBYOK,
    modelName: provider.modelName,
    pricingId: provider.info.pricingId,
    dimensions: provider.dimensions,
  }
}

function createEmbeddingBatches(
  boundedInputs: string[],
  model: string,
  limits: Pick<EmbeddingInputLimits, 'maxInputTokens' | 'maxTokensPerRequest'>,
  itemLimit: number | undefined,
  dimensions: number | undefined
): string[][] {
  const ceiling = limits.maxInputTokens

  /**
   * How many tokens may share one request — a different limit from the per-input
   * ceiling above, and the one that decides how many inputs go in a batch.
   *
   * Three bounds compose here:
   *
   * 1. {@link BATCH_TOKEN_TARGET} is what we actually aim for — an operational
   *    choice, not a provider limit (see its declaration for the reasoning).
   * 2. A provider's documented summed-token cap, when it publishes one, is a
   *    hard ceiling the target can never exceed.
   * 3. The per-input ceiling is a floor. A budget below it would make
   *    `batchByTokenLimit` truncate inputs the provider would have accepted.
   */
  const requestBudget = Math.max(
    Math.min(limits.maxTokensPerRequest ?? BATCH_TOKEN_TARGET, BATCH_TOKEN_TARGET),
    ceiling
  )

  const tokenBatches = batchByTokenLimit(boundedInputs, requestBudget, model)
  const responseItemLimit = dimensions
    ? Math.max(
        1,
        Math.floor(
          (MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES - EMBEDDING_RESPONSE_ENVELOPE_RESERVE_BYTES) /
            (dimensions * EMBEDDING_RESPONSE_BYTES_PER_DIMENSION +
              EMBEDDING_RESPONSE_BYTES_PER_ITEM)
        )
      )
    : undefined
  const effectiveItemLimit =
    itemLimit && responseItemLimit
      ? Math.min(itemLimit, responseItemLimit)
      : (itemLimit ?? responseItemLimit)

  return effectiveItemLimit
    ? tokenBatches.flatMap((batch) => chunkArray(batch, effectiveItemLimit))
    : tokenBatches
}

function assertEmbeddingAggregateResponseWithinLimit(itemCount: number, dimensions: number): void {
  if (itemCount <= getEmbeddingAggregateItemLimit(dimensions)) return

  const estimatedBytes =
    EMBEDDING_RESPONSE_ENVELOPE_RESERVE_BYTES +
    itemCount *
      (dimensions * EMBEDDING_RESPONSE_BYTES_PER_DIMENSION + EMBEDDING_RESPONSE_BYTES_PER_ITEM)
  throw new EmbeddingOutputLimitError(itemCount, dimensions, estimatedBytes)
}

export function getEmbeddingAggregateItemLimit(dimensions: number): number {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('Embedding dimensions must be a positive integer')
  }
  return Math.floor(
    (MAX_EMBEDDING_AGGREGATE_RESPONSE_BYTES - EMBEDDING_RESPONSE_ENVELOPE_RESERVE_BYTES) /
      (dimensions * EMBEDDING_RESPONSE_BYTES_PER_DIMENSION + EMBEDDING_RESPONSE_BYTES_PER_ITEM)
  )
}

function combineEmbeddingBatches(
  batchResults: readonly { embeddings: number[][]; totalTokens: number; dimensions: number }[]
): { embeddings: number[][]; totalTokens: number; dimensions: number | undefined } {
  const embeddings: number[][] = []
  let totalTokens = 0
  let dimensions: number | undefined
  for (const batch of batchResults) {
    dimensions ??= batch.dimensions
    if (batch.dimensions !== dimensions) {
      throw new EmbeddingResponseValidationError(
        `concurrent batches returned inconsistent dimensions (${dimensions} and ${batch.dimensions})`
      )
    }
    for (const vector of batch.embeddings) {
      embeddings.push(vector)
    }
    totalTokens += batch.totalTokens
  }
  return { embeddings, totalTokens, dimensions }
}

/**
 * Generates embeddings for a batch of texts with token-aware batching,
 * per-provider item caps, bounded concurrency, and retry on transient failures.
 */
export async function embed(texts: string[], options: EmbedOptions): Promise<EmbedResult> {
  options.signal?.throwIfAborted()
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL
  const taskType = options.taskType ?? 'document'
  /** Refuse an oversized aggregate before key resolution or input projection. */
  assertEmbeddingAggregateResponseWithinLimit(
    texts.length,
    resolveDimensions(getEmbeddingModelInfo(model), options.dimensions)
  )
  const provider = await resolveProvider(model, options)
  const boundedInputs = prepareEmbeddingInputs(
    texts,
    model,
    getEmbeddingInputLimits(provider.info),
    options.projectInputs,
    options.inputOverflow
  )
  return embedWithProvider(
    boundedInputs,
    model,
    taskType,
    options.dimensions,
    provider,
    options.signal,
    options.checkpoints
  )
}

type KnowledgeEmbedOptions = Omit<EmbedOptions, 'apiKey'>
type KnowledgeProviderOptions = Omit<KnowledgeEmbedOptions, 'projectInputs'>

/**
 * Avoids downloading, parsing, and OCR when the OpenAI embedding credential is
 * already paused for quota.
 */
export async function assertKnowledgeEmbeddingCapacity(
  options: KnowledgeProviderOptions
): Promise<void> {
  options.signal?.throwIfAborted()
  const provider = await resolveProvider(options.model ?? DEFAULT_EMBEDDING_MODEL, options)
  options.signal?.throwIfAborted()
  const exhausted = await isEmbeddingQuotaCircuitOpen(embeddingAdmissionIdentity(provider))
  options.signal?.throwIfAborted()
  if (exhausted) throw new EmbeddingQuotaExhaustedError(provider.providerId)
}

/**
 * Generates KB document/query embeddings. Labbai has a single embedding provider
 * (OpenAI), so there is no fallback chain: this is {@link embed} with the key
 * resolved from the workspace BYOK key or the platform `OPENAI_API_KEY`.
 */
export async function embedKnowledge(
  texts: string[],
  options: KnowledgeEmbedOptions
): Promise<EmbedResult> {
  return embed(texts, options)
}
