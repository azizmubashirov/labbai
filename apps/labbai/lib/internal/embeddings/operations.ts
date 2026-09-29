import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import {
  EmbeddingOutputLimitError,
  embed,
  findEmbeddingModelInfo,
  resolveDimensions,
} from '@/lib/embeddings'
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/embeddings/catalog'
import {
  type EmbeddingsInput,
  MAX_EMBEDDING_INPUTS,
  MAX_EMBEDDING_TOTAL_CHARS,
} from '@/lib/internal/embeddings/schema'

const logger = createLogger('EmbeddingOperations')

export interface EmbeddingOperationContext {
  signal?: AbortSignal
}

function failureResponse(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status })
}

export function normalizeEmbeddingInput(input: string | string[]): string[] {
  if (Array.isArray(input)) return input
  if (/^\s*\[/.test(input)) {
    try {
      const parsed: unknown = JSON.parse(input)
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) return parsed
    } catch {}
  }
  return [input]
}

export async function executeEmbedding(
  input: EmbeddingsInput,
  context: EmbeddingOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  const { provider, model, taskType, dimensions, apiKey } = input
  const texts = normalizeEmbeddingInput(input.input)
  if (texts.length === 0) return failureResponse('input must contain at least one text', 400)
  if (texts.length > MAX_EMBEDDING_INPUTS) {
    return failureResponse(
      `input cannot exceed ${MAX_EMBEDDING_INPUTS} texts, received ${texts.length}`,
      400
    )
  }
  const totalChars = texts.reduce((sum, text) => sum + text.length, 0)
  if (totalChars > MAX_EMBEDDING_TOTAL_CHARS) {
    return failureResponse(
      `Input is too large: ${totalChars} characters exceeds the ${MAX_EMBEDDING_TOTAL_CHARS} limit`,
      400
    )
  }
  if (texts.some((text) => !/\S/.test(text))) {
    return failureResponse('input entries cannot be empty', 400)
  }

  const resolvedModel = model || DEFAULT_EMBEDDING_MODEL
  const info = findEmbeddingModelInfo(resolvedModel)
  if (!info) return failureResponse(`Unsupported embedding model: ${resolvedModel}`, 400)
  if (info.provider !== provider) {
    return failureResponse(
      `Model ${resolvedModel} belongs to ${info.provider}, not ${provider}`,
      400
    )
  }
  try {
    resolveDimensions(info, dimensions)
  } catch (error) {
    return failureResponse(getErrorMessage(error, 'Invalid dimensions'), 400)
  }

  logger.info(`Embedding ${texts.length} input(s)`, { provider, model: resolvedModel })
  try {
    const result = await embed(texts, {
      model: resolvedModel,
      taskType,
      dimensions,
      apiKey,
      projectInputs: null,
      signal: context.signal,
    })
    context.signal?.throwIfAborted()
    return Response.json({
      success: true,
      embeddings: result.embeddings,
      model: result.modelName,
      provider,
      dimensions: result.dimensions,
      usage: { prompt_tokens: result.totalTokens, total_tokens: result.totalTokens },
      __embeddingTokens: result.totalTokens,
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    const message = getErrorMessage(error, 'Embedding generation failed')
    if (error instanceof EmbeddingOutputLimitError) {
      logger.warn('Embedding output exceeds safe limit', { error: message })
      return failureResponse(message, 413)
    }
    logger.error('Embedding generation failed', { error: message })
    return failureResponse(message, 502)
  }
}
