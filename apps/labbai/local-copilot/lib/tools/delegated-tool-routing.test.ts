/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TOOL_RUNTIME_SCHEMAS } from '@/lib/copilot/generated/tool-schemas-v1'
import { isClientExecuted, isKnownTool, isSimExecuted } from '@/lib/copilot/tool-executor/router'
import { getRegisteredServerToolNames } from '@/lib/copilot/tools/server/router'
import {
  buildMothershipDelegatedToolDefinitions,
  DIRECT_HANDLER_TOOLS,
  MOTHERSHIP_DELEGATED_TOOL_NAMES,
  resolveDelegatedServerToolId,
} from '@/local-copilot/lib/tools/mothership-delegated-tool-defs'

/**
 * Every tool the local copilot offers the model must reach something that runs it. A local
 * name the Sim runtime does not register (e.g. `knowledge_base` vs `manage_knowledge_base`)
 * failed every call with "Tool not found" and showed the model an empty parameter list.
 */
describe('delegated tool routing', () => {
  const serverTools = new Set(getRegisteredServerToolNames())

  for (const name of MOTHERSHIP_DELEGATED_TOOL_NAMES) {
    it(`${name} reaches a registered tool`, () => {
      const id = resolveDelegatedServerToolId(name)
      const runnable =
        serverTools.has(id) ||
        DIRECT_HANDLER_TOOLS.has(name) ||
        (isKnownTool(id) && (isSimExecuted(id) || isClientExecuted(id)))
      expect(runnable).toBe(true)
    })
  }

  it('gives every delegated tool a non-empty parameter schema', () => {
    const empty = buildMothershipDelegatedToolDefinitions()
      .filter((tool) => {
        const properties = (tool.parameters as { properties?: Record<string, unknown> })
          .properties
        return !properties || Object.keys(properties).length === 0
      })
      .map((tool) => tool.name)
    // list_file_folders genuinely takes no arguments.
    expect(empty.filter((name) => name !== 'list_file_folders')).toEqual([])
  })

  it('maps knowledge_base onto the manage_knowledge_base runtime schema', () => {
    expect(resolveDelegatedServerToolId('knowledge_base')).toBe('manage_knowledge_base')
    expect(TOOL_RUNTIME_SCHEMAS.manage_knowledge_base).toBeDefined()
  })
})
