import { z } from 'zod'

/**
 * Upstream response schemas still read by the embeddings catalogs
 * (`lib/embeddings/*-model-catalog.server.ts`). Labbai removed the dynamic
 * chat-model discovery routes (`/api/providers/*`) and their contracts — every
 * chat model now runs on the curated OpenAI catalog.
 */

export const openRouterEmbeddingModelsUpstreamResponseSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string().min(1, 'OpenRouter embedding model id cannot be empty'),
        context_length: z
          .number()
          .int('OpenRouter embedding context length must be an integer')
          .positive('OpenRouter embedding context length must be positive'),
      })
      .passthrough()
  ),
})

// Shared by the local Ollama and Ollama Cloud /api/tags endpoints — same `{ models: [{ name }] }` shape.
export const ollamaUpstreamResponseSchema = z.object({
  models: z
    .array(
      z
        .object({
          name: z.string(),
        })
        .passthrough()
    )
    .default([]),
})

/**
 * Ollama `/api/show`. `capabilities` is what separates an embedding model from a
 * chat one — `/api/tags` lists both and says nothing about either. `model_info`
 * is keyed by architecture (`nomic-bert.embedding_length`, `bert.embedding_length`,
 * …), so the width is found by suffix rather than by a fixed key.
 *
 * Both fields are optional: an Ollama older than 0.5 reports no `capabilities`,
 * and a model whose architecture publishes no embedding length simply has none
 * to show.
 */
export const ollamaShowUpstreamResponseSchema = z
  .object({
    capabilities: z.array(z.string()).optional(),
    model_info: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
