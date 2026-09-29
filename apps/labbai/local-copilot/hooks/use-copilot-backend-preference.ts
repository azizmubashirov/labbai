'use client'

import { useCallback } from 'react'
import {
  useLocalCopilotConfig,
  useUpdateLocalCopilotDefaultModel,
} from '@/local-copilot/hooks/use-local-copilot'
import {
  DEFAULT_LOCAL_COPILOT_CATALOG_ID,
  type LocalCopilotCatalogId,
  resolveLocalCopilotCatalogId,
} from '@/local-copilot/lib/model-catalog'

/**
 * Local catalog selection is the per-user enum default, not mothership `chat.model`.
 */
export function useLocalCopilotCatalogSelection() {
  const { data: config, isSuccess } = useLocalCopilotConfig()
  const localCopilotCatalogId = isSuccess
    ? resolveLocalCopilotCatalogId(config?.defaultCatalogId)
    : DEFAULT_LOCAL_COPILOT_CATALOG_ID
  const { mutate: persistDefaultModel } = useUpdateLocalCopilotDefaultModel()
  const setLocalCopilotCatalogId = useCallback(
    (id: LocalCopilotCatalogId) => {
      persistDefaultModel(id)
    },
    [persistDefaultModel]
  )

  return {
    localCopilotCatalogId,
    setLocalCopilotCatalogId,
  }
}
