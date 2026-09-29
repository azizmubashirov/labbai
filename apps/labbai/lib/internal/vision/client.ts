import { createLogger } from '@labbai/logger'
import { toRecord } from '@labbai/utils/object'
import type { EgressProfile } from '@/lib/core/security/egress/profiles'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { VisionOperationError } from '@/lib/internal/vision/errors'
import { getOpenAIBaseUrl, getOpenAIExtraHeaders } from '@/providers/openai/client-config'
import { isOpenAIReasoningModelId, resolveOpenAIModelId } from '@/providers/openai/model-ids'

const logger = createLogger('VisionClient')
const MAX_PROVIDER_ERROR_BYTES = 64 * 1024

export interface VisionClientInput {
  apiKey: string
  imageSource: string
  imageContentType?: string
  model: string
  prompt: string
  remoteImageResolvedIP?: string
  remoteImageProfile?: EgressProfile
}

export interface VisionAnalysisResult {
  content?: string
  model?: string
  tokens?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
}

function record(value: unknown): Record<string, unknown> {
  return toRecord(value)
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function providerErrorMessage(value: unknown): string {
  const data = record(value)
  const nested = record(data.error)
  return string(nested.message) || string(data.message) || 'Failed to analyze image'
}

async function readProviderJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  return readResponseJsonWithLimit(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label: 'Vision provider response',
    signal,
  })
}

async function readProviderError(response: Response, signal?: AbortSignal): Promise<unknown> {
  return readResponseJsonWithLimit(response, {
    maxBytes: MAX_PROVIDER_ERROR_BYTES,
    label: 'Vision provider error response',
    signal,
  }).catch(() => {
    signal?.throwIfAborted()
    return {}
  })
}

/**
 * Output budget. GPT-5 family models spend part of it on hidden reasoning, so
 * they get a larger allowance than a non-reasoning model needs for a description.
 */
function maxCompletionTokens(model: string): number {
  return isOpenAIReasoningModelId(model) ? 4096 : 1000
}

function openAiRequest(input: VisionClientInput, model: string): Record<string, unknown> {
  return {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: input.prompt },
          { type: 'image_url', image_url: { url: input.imageSource } },
        ],
      },
    ],
    max_completion_tokens: maxCompletionTokens(model),
  }
}

/**
 * Labbai: vision runs on OpenAI only (chat completions with an `image_url` part,
 * at `OPENAI_BASE_URL`). A stored Claude / Gemini / retired OpenAI model id maps
 * to the closest curated OpenAI model via {@link resolveOpenAIModelId}. The
 * caller's key is an OpenAI key.
 */
export async function analyzeVision(
  input: VisionClientInput,
  signal?: AbortSignal
): Promise<VisionAnalysisResult> {
  const model = resolveOpenAIModelId(input.model)
  const headers: Record<string, string> = {
    ...getOpenAIExtraHeaders(),
    'Content-Type': 'application/json',
    Authorization: `Bearer ${input.apiKey}`,
  }

  signal?.throwIfAborted()
  const response = await fetch(`${getOpenAIBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(openAiRequest(input, model)),
    signal,
  })
  signal?.throwIfAborted()
  if (!response.ok) {
    const error = await readProviderError(response, signal)
    signal?.throwIfAborted()
    logger.error('Vision provider request failed', {
      model,
      status: response.status,
      error,
    })
    throw new VisionOperationError(providerErrorMessage(error), response.status)
  }

  const data = record(await readProviderJson(response, signal))
  const usage = record(data.usage)
  const choices = Array.isArray(data.choices) ? record(data.choices[0]) : {}
  const message = record(choices.message)
  const inputTokens = number(usage.prompt_tokens) ?? number(usage.input_tokens)
  const outputTokens = number(usage.completion_tokens) ?? number(usage.output_tokens)
  const totalTokens = number(usage.total_tokens)
  return {
    content: string(message.content),
    model: string(data.model) ?? model,
    tokens: totalTokens,
    usage:
      Object.keys(usage).length > 0
        ? {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: totalTokens || (inputTokens || 0) + (outputTokens || 0),
          }
        : undefined,
  }
}
