/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  classifyLocalCopilotIntent,
  selectParallelSubagentDomains,
  specialistPassDomain,
} from '@/local-copilot/lib/agent/specialists/classify'
import { toolNamesForIntent } from '@/local-copilot/lib/agent/specialists/domains'

describe('channel-agent requests route to the workflow domain', () => {
  const requests = [
    'create a support agent for a gynecologist on a Telegram (Business) account, with a contacts table and knowledge',
    'Создай бота поддержки для гинеколога в Telegram Business с таблицей контактов',
    'Ginekolog uchun Telegram Business akkauntida support agent yarat',
  ]

  for (const message of requests) {
    it(`gives the parent create_workflow for: ${message.slice(0, 40)}…`, () => {
      const intent = classifyLocalCopilotIntent(message)

      expect(intent.primary).toBe('workflow')
      expect(toolNamesForIntent(intent)?.has('create_workflow')).toBe(true)
      // No turn-start specialist fan-out for a build: the parent builds it.
      expect(selectParallelSubagentDomains(intent)).toEqual([])
      expect(specialistPassDomain(intent)).toBeNull()
    })
  }

  it('keeps the table and knowledge leaves alongside the build tools', () => {
    const intent = classifyLocalCopilotIntent(requests[0])
    const tools = toolNamesForIntent(intent)

    expect(intent.secondary).toEqual(expect.arrayContaining(['table', 'knowledge']))
    expect(tools?.has('user_table')).toBe(true)
    expect(tools?.has('knowledge_base')).toBe(true)
  })
})
