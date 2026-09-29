import { createLogger } from '@labbai/logger'
import { type ModelCost, resolveProxiedModelCost } from '@/providers/cost-policy'
import { getProviderFromModel } from '@/providers/utils'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('LLMChatTool')

interface LLMChatParams {
  model: string
  systemPrompt?: string
  context: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
  _context?: {
    workspaceId?: string
    workflowId?: string
  }
}

interface LLMChatResponse extends ToolResponse {
  output: {
    content: string
    model: string
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
    cost?: ModelCost
  }
}

export const llmChatTool: InternalToolConfig<LLMChatParams, LLMChatResponse> = {
  id: 'llm_chat',
  name: 'LLM Chat',
  description: 'Send a chat completion request to an OpenAI model',
  version: '1.0.0',

  params: {
    model: {
      type: 'string',
      required: true,
      description: 'The OpenAI model to use (e.g., gpt-5-mini, gpt-5.5, gpt-4.1-mini)',
    },
    systemPrompt: {
      type: 'string',
      required: false,
      description: 'System prompt to set the behavior of the assistant',
    },
    context: {
      type: 'string',
      required: true,
      description: 'The user message or context to send to the model',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'API key for the provider (uses platform key if not provided for hosted models)',
    },
    temperature: {
      type: 'number',
      required: false,
      description: 'Temperature for response generation (0-2)',
    },
    maxTokens: {
      type: 'number',
      required: false,
      description: 'Maximum tokens in the response',
    },
  },

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => ({
        systemPrompt: params.systemPrompt,
        context: params.context,
      }),
      privateInputPaths: () => [['systemPrompt'], ['context']],
    },
    input: (params) => {
      const provider = getProviderFromModel(params.model)

      return {
        provider,
        model: params.model,
        systemPrompt: params.systemPrompt,
        context: JSON.stringify([{ role: 'user', content: params.context }]),
        apiKey: params.apiKey,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = errorData.error || `LLM API error: ${response.status}`
      logger.error('LLM chat request failed', { error: errorMessage })
      throw new Error(errorMessage)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        content: data.content,
        model: data.model,
        tokens: data.tokens,
        cost: resolveProxiedModelCost(data.cost),
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'The generated response content' },
    model: { type: 'string', description: 'The model used for generation' },
    tokens: { type: 'object', description: 'Token usage information' },
    cost: { type: 'object', description: 'Model cost for this call in dollars' },
  },
}
