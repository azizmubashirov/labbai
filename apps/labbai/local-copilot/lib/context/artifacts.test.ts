/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_ALREADY_LOADED_HINT,
  ARTIFACT_INLINE_MAX_CHARS,
  buildRepeatedArtifactLoadResult,
  createArtifactStore,
  LOAD_COPILOT_ARTIFACT_TOOL_NAME,
  rememberArtifactLoad,
} from '@/local-copilot/lib/context/artifacts'
import {
  MICROCOMPACT_PRESERVE_LATEST_TOOL_NAMES,
  microcompactMessages,
} from '@/local-copilot/lib/context/microcompact'
import type { ChatMessage } from '@/local-copilot/lib/providers/types'
import { formatToolResultForLlm } from '@/local-copilot/lib/tools/format-tool-result'

describe('artifact load dedupe', () => {
  it('flags the second load of the same artifact in a turn and keeps the body', () => {
    const loaded = new Set<string>()
    expect(rememberArtifactLoad(loaded, 'art1')).toBe(false)
    expect(rememberArtifactLoad(loaded, 'art1')).toBe(true)
    expect(rememberArtifactLoad(loaded, 'art2')).toBe(false)

    const repeated = buildRepeatedArtifactLoadResult('art1', { blocks: ['agent'] })
    expect(repeated).toEqual({
      artifactId: 'art1',
      alreadyLoadedThisTurn: true,
      hint: ARTIFACT_ALREADY_LOADED_HINT,
      content: { blocks: ['agent'] },
    })
  })

  it('returns a loaded artifact beyond the inline cap instead of cutting it back to 8k', () => {
    const body = { items: Array.from({ length: 800 }, (_, index) => `entry number ${index}`) }
    expect(JSON.stringify(body).length).toBeGreaterThan(ARTIFACT_INLINE_MAX_CHARS)

    const formatted = formatToolResultForLlm(LOAD_COPILOT_ARTIFACT_TOOL_NAME, body, {
      artifactStore: createArtifactStore(),
    })

    expect(JSON.parse(formatted)).toEqual(body)
  })
})

describe('microcompact in-turn preservation', () => {
  function round(id: string, name: string, content: string): ChatMessage[] {
    return [
      { role: 'assistant', content: '', toolCalls: [{ id, name, arguments: '{}' }] },
      { role: 'tool', toolCallId: id, content },
    ]
  }

  it('keeps the latest block metadata verbatim while older rounds are cleared', () => {
    const metadata = JSON.stringify({ metadata: { telegram: { type: 'telegram' } } })
    const messages: ChatMessage[] = [
      { role: 'user', content: 'build a telegram support agent' },
      ...round('c1', 'get_available_blocks', JSON.stringify({ blocks: [] })),
      ...round('c2', 'get_blocks_metadata', metadata),
      ...round('c3', 'create_workflow', JSON.stringify({ workflowId: 'wf' })),
      ...round('c4', 'user_table', JSON.stringify({ success: true })),
      ...round('c5', 'knowledge_base', JSON.stringify({ success: true })),
    ]

    const preserved = microcompactMessages(messages, {
      preserveLatestToolNames: MICROCOMPACT_PRESERVE_LATEST_TOOL_NAMES,
    }).messages
    const contentOf = (list: ChatMessage[], id: string) =>
      list.find((message) => message.toolCallId === id)?.content

    expect(contentOf(preserved, 'c2')).toBe(metadata)
    expect(String(contentOf(preserved, 'c1'))).toContain('Old tool result cleared')
    expect(String(contentOf(preserved, 'c3'))).toContain('Old tool result cleared')

    // Without the option (history compaction) nothing is preserved.
    const plain = microcompactMessages(messages).messages
    expect(String(contentOf(plain, 'c2'))).toContain('Old tool result cleared')
  })
})
