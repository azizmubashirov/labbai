import { createLogger } from '@labbai/logger'
import type { StreamingExecution } from '@/executor/types'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import {
  getOpenAIAuthHeaders,
  getOpenAIBaseUrl,
  isOpenAIGatewayMode,
} from '@/providers/openai/client-config'
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
    // Gateway mode (CLOUDFLARE_AIG_TOKEN) authenticates with the gateway token, not a key.
    if (!request.apiKey && !isOpenAIGatewayMode()) {
      throw new Error('API key is required for OpenAI')
    }

    return executeResponsesProviderRequest(request, {
      providerId: 'openai',
      providerLabel: 'OpenAI',
      modelName: request.model,
      // Labbai: OPENAI_BASE_URL + auth headers (API key, or the Cloudflare AI Gateway token).
      endpoint: `${getOpenAIBaseUrl()}/responses`,
      headers: {
        ...getOpenAIAuthHeaders(request.apiKey),
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'responses=v1',
      },
      logger,
    })
  },
}
