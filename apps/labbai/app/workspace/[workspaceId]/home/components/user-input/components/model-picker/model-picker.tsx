'use client'

import { Fragment } from 'react'
import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@labbai/emcn'
import { ChevronDown } from '@labbai/emcn/icons'
import { useLocalCopilotConfig } from '@/local-copilot/hooks/use-local-copilot'
import {
  LOCAL_COPILOT_CATALOG,
  type LocalCopilotCatalogId,
} from '@/local-copilot/lib/model-catalog'
import { getModelDisplayName } from '@/providers/models'

interface ModelPickerProps {
  catalogId: LocalCopilotCatalogId
  onCatalogIdChange: (id: LocalCopilotCatalogId) => void
}

/**
 * The chat model dropdown. Renders nothing where the deployment cannot run the catalog
 * (outside Cloudflare mode), so the copilot there keeps its env model.
 */
export function ModelPicker({ catalogId, onCatalogIdChange }: ModelPickerProps) {
  const { data: config } = useLocalCopilotConfig()
  if (!config?.modelSelectionEnabled) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip shape='round' rightIcon={ChevronDown} aria-label='Model'>
          {getModelDisplayName(catalogId)}
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' side='top'>
        <DropdownMenuRadioGroup value={catalogId} onValueChange={onCatalogIdChange}>
          {LOCAL_COPILOT_CATALOG.map((entry, index) => (
            <Fragment key={entry.id}>
              {entry.group !== LOCAL_COPILOT_CATALOG[index - 1]?.group && (
                <DropdownMenuLabel>{entry.group}</DropdownMenuLabel>
              )}
              <DropdownMenuRadioItem value={entry.id}>{entry.label}</DropdownMenuRadioItem>
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
