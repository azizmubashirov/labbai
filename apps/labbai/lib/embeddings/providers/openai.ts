import type { EmbeddingAdapterFactory } from '@/lib/embeddings/types'
import { getOpenAIBaseUrl, getOpenAIExtraHeaders } from '@/providers/openai/client-config'

/** OpenAI `/v1/embeddings` response envelope. */
export interface OpenAIEmbeddingResponse<TEmbedding = number[]> {
  data: Array<{ embedding: TEmbedding }>
  usage?: { prompt_tokens?: number; total_tokens?: number }
}

/** OpenAI rejects an `input` array longer than 2048 entries. */
export const OPENAI_MAX_ITEMS_PER_REQUEST = 2048

/** Reject malformed or oversized payloads before materializing the numeric vector. */
function decodeEmbedding(encoded: string, dimensions: number): number[] {
  const byteLength = dimensions * Float32Array.BYTES_PER_ELEMENT
  if (typeof encoded !== 'string' || encoded.length !== 4 * Math.ceil(byteLength / 3)) {
    throw new Error('Invalid base64 embedding length')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length !== byteLength || bytes.toString('base64') !== encoded) {
    throw new Error('Invalid base64 embedding')
  }
  return Array.from({ length: dimensions }, (_, index) =>
    bytes.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT)
  )
}

/**
 * OpenAI `/v1/embeddings` at {@link getOpenAIBaseUrl} (`OPENAI_BASE_URL`, default
 * the public API) with any `OPENAI_EXTRA_HEADERS`. Omitting `dimensions` yields the model's native
 * dimensionality. Base64 carries Float32 coordinates with less JSON overhead,
 * matching the native OpenAI SDK's transport; callers still receive number arrays.
 */
export const createOpenAIAdapter: EmbeddingAdapterFactory = ({
  modelName,
  apiKey,
  nativeDimensions,
}) => ({
  maxItemsPerRequest: OPENAI_MAX_ITEMS_PER_REQUEST,
  buildRequest: ({ inputs, dimensions }) => ({
    apiUrl: `${getOpenAIBaseUrl()}/embeddings`,
    headers: {
      ...getOpenAIExtraHeaders(),
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      input: inputs,
      model: modelName,
      encoding_format: 'base64',
      ...(dimensions !== undefined && { dimensions }),
    },
    parse: (json) =>
      (json as OpenAIEmbeddingResponse<string>).data.map((item) =>
        decodeEmbedding(item.embedding, dimensions ?? nativeDimensions)
      ),
    parseTokens: (json) => (json as OpenAIEmbeddingResponse).usage?.total_tokens,
  }),
})
