/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import { rewriteMessageFileRefs } from '@/lib/copilot/chat/rewrite-file-references'

const message = (content: string): PersistedMessage => ({
  id: 'm1',
  role: 'assistant',
  content,
  timestamp: '2026-01-01T00:00:00.000Z',
})

describe('rewriteMessageFileRefs', () => {
  it('returns the input untouched when there are no mappings', () => {
    const messages = [message('see /api/files/view/file-a')]
    const result = rewriteMessageFileRefs(messages, { fileIds: new Map(), fileKeys: new Map() })
    expect(result).toBe(messages)
  })

  it('rewrites mapped ids and keys in free text', () => {
    const [result] = rewriteMessageFileRefs(
      [message('view /files/file-a and serve ws/key-a.png, keep file-z')],
      {
        fileIds: new Map([['file-a', 'file-b']]),
        fileKeys: new Map([['ws/key-a.png', 'ws/key-b.png']]),
      }
    )
    expect(result.content).toBe('view /files/file-b and serve ws/key-b.png, keep file-z')
  })

  it('does not chain replacements', () => {
    const [result] = rewriteMessageFileRefs([message('a b')], {
      fileIds: new Map([
        ['a', 'b'],
        ['b', 'c'],
      ]),
      fileKeys: new Map(),
    })
    expect(result.content).toBe('b c')
  })
})
