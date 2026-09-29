import { createLogger } from '@labbai/logger'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { getOpenAIBaseUrl, getOpenAIExtraHeaders } from '@/providers/openai/client-config'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'
import { executeResponsesProviderRequest } from './core'

const logger = createLogger('OpenAIProvider')

export const openaiProvider: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  description: "OpenAI's GPT models",
  version: '1.0.0',
  models: getProviderModels('openai'),
  defaultModel: getProviderDefaultModel('openai'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for OpenAI')
    }

    return executeResponsesProviderRequest(request, {
      providerId: 'openai',
      providerLabel: 'OpenAI',
      modelName: request.model,
      // Labbai: OPENAI_BASE_URL / OPENAI_EXTRA_HEADERS let a gateway sit in front later.
      endpoint: `${getOpenAIBaseUrl()}/responses`,
      headers: {
        ...getOpenAIExtraHeaders(),
        Authorization: `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'responses=v1',
      },
      logger,
    })
  },
}
