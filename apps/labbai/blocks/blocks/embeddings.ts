import { EmbeddingsIcon } from '@/components/icons'
/**
 * Imported from the catalog module directly rather than the `@/lib/embeddings`
 * barrel: the barrel re-exports the client, which reaches BYOK key lookup and
 * `@labbai/db`. Block configs are bundled for the browser, so only the pure
 * catalog data may cross this boundary.
 */
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_MODELS } from '@/lib/embeddings/catalog'
import type { BlockConfig, BlockMeta, SubBlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { EmbeddingsResponse } from '@/tools/embeddings/types'

/**
 * Labbai: embeddings run on OpenAI only. The provider dropdown keeps its one
 * option so saved blocks keep a valid shape; the Gemini / Cohere / Mistral /
 * OpenRouter / Ollama variants were removed.
 */
export const EMBEDDING_BLOCK_PROVIDERS = ['openai'] as const

type EmbeddingBlockProvider = (typeof EMBEDDING_BLOCK_PROVIDERS)[number]

const TOOL_ID_BY_PROVIDER: Record<EmbeddingBlockProvider, string> = {
  openai: 'embeddings_openai',
}

/** Dimension dropdowns are derived from the catalog, one per model. */
const CAPABILITY_SUB_BLOCKS: SubBlockConfig[] = Object.entries(EMBEDDING_MODELS).flatMap(
  ([model, info]) => {
    if (!info.supportedDimensions) return []
    return [
      {
        id: 'dimensions',
        title: 'Dimensions',
        type: 'dropdown',
        options: info.supportedDimensions.map((size) => ({
          label: size === info.nativeDimensions ? `${size} (default)` : String(size),
          id: String(size),
        })),
        value: () => String(info.nativeDimensions),
        condition: { field: 'model', value: model },
        dependsOn: ['model'],
      } satisfies SubBlockConfig,
    ]
  }
)

export const EmbeddingsBlock: BlockConfig<EmbeddingsResponse> = {
  type: 'embeddings',
  name: 'Embeddings',
  description: 'Generate embeddings',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Turn text into embedding vectors for semantic search, clustering, and similarity with OpenAI embedding models.',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#7B4DFF',
  icon: EmbeddingsIcon,
  canvasPresentation: {
    defaultTitle: 'Embeddings',
    sentences: {
      default: [
        { text: 'Embed', field: 'input', core: true },
        { text: 'with', field: 'model' },
      ],
    },
  },
  subBlocks: [
    {
      id: 'input',
      title: 'Input Text',
      type: 'long-input',
      placeholder: 'Enter text to generate embeddings for',
      required: true,
    },
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      options: [{ label: 'OpenAI', id: 'openai' }],
      hidden: true,
      value: () => 'openai',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: Object.entries(EMBEDDING_MODELS).map(([id, info]) => ({ label: info.label, id })),
      value: () => DEFAULT_EMBEDDING_MODEL,
    },
    ...CAPABILITY_SUB_BLOCKS,
    /** Labbai stocks the hosted OpenAI key, so the field is hidden on hosted Labbai. */
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your OpenAI API key',
      password: true,
      required: true,
      connectionDroppable: false,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['embeddings_openai'],
    config: {
      tool: () => TOOL_ID_BY_PROVIDER.openai,
      /**
       * A model or dimension saved before the OpenAI-only switch (another
       * provider's model, or a width it cannot emit) is rewritten to an explicit
       * `undefined` / the default rather than forwarded.
       */
      params: (params) => {
        if (!params.input) {
          throw new Error('Input text is required')
        }
        const savedModel = typeof params.model === 'string' ? params.model : undefined
        const model =
          savedModel && Object.hasOwn(EMBEDDING_MODELS, savedModel)
            ? savedModel
            : DEFAULT_EMBEDDING_MODEL
        const info = EMBEDDING_MODELS[model]
        const requested =
          params.dimensions !== undefined && params.dimensions !== ''
            ? Number(params.dimensions)
            : undefined
        const dimensions =
          requested !== undefined &&
          !Number.isNaN(requested) &&
          info?.supportedDimensions?.includes(requested)
            ? requested
            : undefined

        return {
          apiKey: params.apiKey,
          input: params.input,
          model,
          taskType: undefined,
          dimensions,
          openRouterApiKey: undefined,
        }
      },
    },
  },
  inputs: {
    input: { type: 'string', description: 'Text to embed, or an array of texts' },
    provider: { type: 'string', description: 'Embedding provider (always openai)' },
    model: { type: 'string', description: 'Embedding model' },
    dimensions: { type: 'number', description: 'Output vector dimensions' },
    apiKey: { type: 'string', description: 'OpenAI API key' },
  },
  outputs: {
    embeddings: { type: 'json', description: 'Generated embeddings' },
    model: { type: 'string', description: 'Model used' },
    provider: { type: 'string', description: 'Provider used' },
    dimensions: { type: 'number', description: 'Dimensionality of each vector' },
    usage: { type: 'json', description: 'Token usage' },
  },
}

export { TOOL_ID_BY_PROVIDER }

export const EmbeddingsBlockMeta = {
  tags: ['llm', 'vector-search'],
  templates: [
    {
      icon: EmbeddingsIcon,
      title: 'Semantic duplicate detector',
      prompt:
        'Build a workflow that reads new rows from a table, generates an embedding for each, compares them against existing rows by cosine similarity, and flags near-duplicates in an evaluation table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis', 'vector-search'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'FAQ semantic router',
      prompt:
        'Create a workflow that embeds an incoming question, compares it against embedded FAQ entries to find the closest match, and returns the canned answer when similarity is high or escalates to an agent when it is not.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'vector-search'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'Embedding-based content clustering',
      prompt:
        'Build a scheduled workflow that pulls recent feedback from a table, generates embeddings for each entry, clusters them by semantic similarity, and writes the themed groups with representative quotes back to a summary table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'automation', 'vector-search'],
    },
  ],
  skills: [
    {
      name: 'embed-text',
      description:
        'Generate an embedding vector for a piece of text to use in semantic search or similarity.',
      content:
        '# Embed Text\n\nConvert text into an embedding vector.\n\n## Steps\n1. Take the input text. If it is long, ensure it fits the model context; otherwise chunk it first.\n2. Use OpenAI text-embedding-3-small, and keep the dimensionality consistent with any existing vectors it will be compared against.\n3. Generate the embedding.\n\n## Output\nReturn the embedding vector, the provider and model used, the dimensionality, and token usage. Vectors are only comparable when they come from the same model at the same dimensionality.',
    },
    {
      name: 'embed-documents-for-retrieval',
      description:
        'Chunk and embed a set of documents so they can be upserted into a vector store for retrieval.',
      content:
        '# Embed Documents for Retrieval\n\nPrepare documents for semantic retrieval by chunking and embedding them.\n\n## Steps\n1. Split each document into reasonably sized chunks with light overlap so context is preserved.\n2. Embed each chunk with a single consistent model.\n3. Pair each vector with its source metadata (document ID, chunk index, title) ready for upsert into the vector store.\n\n## Output\nReturn the embeddings with their associated metadata, the model used, and the dimensionality. Report how many chunks were produced and flag any chunk that failed to embed.',
    },
    {
      name: 'find-semantic-duplicates',
      description:
        'Embed items and compare vectors by cosine similarity to flag near-duplicate content.',
      content:
        '# Find Semantic Duplicates\n\nDetect items that mean the same thing even when worded differently.\n\n## Steps\n1. Embed each candidate item with the same model and dimensionality used for the existing set.\n2. Compare each new vector against existing vectors using cosine similarity.\n3. Flag pairs above a similarity threshold (e.g. 0.9) as likely duplicates; treat lower scores as distinct.\n\n## Output\nReturn the flagged duplicate pairs with their similarity scores, sorted highest first, so they can be merged or deduplicated.',
    },
  ],
} as const satisfies BlockMeta
