import type { InternalToolConfig } from '@/tools/types'

export interface GuardrailsValidateInput {
  input: string
  validationType: 'json' | 'regex' | 'hallucination'
  regex?: string
  knowledgeBaseId?: string
  threshold?: string
  topK?: string
  model?: string
  apiKey?: string
  _context?: {
    workflowId?: string
    workspaceId?: string
  }
}

export interface GuardrailsValidateOutput {
  success: boolean
  output: {
    passed: boolean
    validationType: string
    input?: string
    error?: string
    score?: number
    reasoning?: string
  }
  error?: string
}

export const guardrailsValidateTool: InternalToolConfig<
  GuardrailsValidateInput,
  GuardrailsValidateOutput
> = {
  id: 'guardrails_validate',
  name: 'Guardrails Validate',
  description: 'Validate content using guardrails (JSON, regex, or hallucination check)',
  version: '1.0.0',

  params: {
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Content to validate (from wired block)',
    },
    validationType: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Type of validation: json, regex, or hallucination',
    },
    regex: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Regex pattern (required for regex validation)',
    },
    knowledgeBaseId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Knowledge base ID (required for hallucination check)',
    },
    threshold: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Confidence threshold (0-10 scale, default: 3, scores below fail)',
    },
    topK: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of chunks to retrieve from knowledge base (default: 10)',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'LLM model for confidence scoring (default: gpt-5-mini)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key for LLM provider (optional if using hosted)',
    },
  },

  outputs: {
    passed: {
      type: 'boolean',
      description: 'Whether validation passed',
    },
    validationType: {
      type: 'string',
      description: 'Type of validation performed',
    },
    input: {
      type: 'string',
      description: 'Original input',
    },
    error: {
      type: 'string',
      description: 'Error message if validation failed',
      optional: true,
    },
    score: {
      type: 'number',
      description:
        'Confidence score (0-10, 0=hallucination, 10=grounded, only for hallucination check)',
      optional: true,
    },
    reasoning: {
      type: 'string',
      description: 'Reasoning for confidence score (only for hallucination check)',
      optional: true,
    },
  },

  operation: {
    modelInput: {
      mode: 'private-provenance',
      inputPaths: (params: GuardrailsValidateInput) =>
        params.validationType === 'hallucination' ? [['input']] : [],
    },
    input: (params: GuardrailsValidateInput) => ({
      input: params.input,
      validationType: params.validationType,
      regex: params.regex,
      knowledgeBaseId: params.knowledgeBaseId,
      threshold: params.threshold,
      topK: params.topK,
      model: params.model,
      apiKey: params.apiKey,
    }),
  },

  transformResponse: async (response: Response): Promise<GuardrailsValidateOutput> => {
    const result = await response.json()

    if (!response.ok && !result.output) {
      return {
        success: true,
        output: {
          passed: false,
          validationType: 'unknown',
          input: '',
          error: result.error || `Validation failed with status ${response.status}`,
        },
      }
    }

    return result
  },
}
