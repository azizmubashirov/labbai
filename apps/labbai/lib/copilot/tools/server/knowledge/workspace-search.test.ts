/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  read: vi.fn(),
  info: vi.fn(),
}))
vi.mock('@labbai/logger', () => ({
  createLogger: () => ({ info: mocks.info, error: vi.fn(), warn: vi.fn() }),
}))
vi.mock('@/lib/knowledge/application/workspace-search', () => ({
  searchWorkspaceKnowledge: {
    get operation() {
      return knowledgeOperations.search
    },
    execute: mocks.search,
  },
}))
vi.mock('@/lib/knowledge/application/read-search-document', () => ({
  readSearchDocument: {
    get operation() {
      return knowledgeOperations.readDocument
    },
    execute: mocks.read,
  },
}))

import {
  readDocumentServerTool,
  searchWorkspaceServerTool,
} from '@/lib/copilot/tools/server/knowledge/workspace-search'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { annotateSearchDiagnostics } from '@/lib/knowledge/search/diagnostics'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const context = {
  userId: 'reader',
  workspaceId: 'workspace',
  toolCallId: 'call',
  copilotToolExecution: true,
  resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
    userId: 'reader',
    workspaceId: 'workspace',
  }),
}
describe('Copilot retrieval tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.search.mockResolvedValue({
      retrieval: { status: 'complete', timedOutLegs: [] },
      knowledgeBases: [{ id: 'index', name: 'Enterprise Search' }],
      results: [
        {
          knowledgeBaseId: 'index',
          documentId: 'doc',
          documentName: 'Title',
          sourceUrl: null,
          sourceModifiedAt: null,
          metadata: {},
          content: 'body',
          chunkIndex: 0,
          similarity: 1,
        },
      ],
    })
    mocks.read.mockResolvedValue({
      knowledgeBaseId: 'index',
      documentId: 'doc',
      documentName: 'Title',
      sourceUrl: 'https://source.test/doc',
      chunks: [{ content: 'body', chunkIndex: 0 }],
      hasMore: false,
      next: null,
    })
  })
  it('returns empty incomplete retrieval as a recoverable search outcome and logs coverage', async () => {
    mocks.search.mockImplementation(async () => {
      annotateSearchDiagnostics({
        retrievalStatus: 'partial',
        timedOutLegs: ['vector', 'keyword'],
      })
      return {
        retrieval: { status: 'partial', timedOutLegs: ['vector', 'keyword'] },
        knowledgeBases: [{ id: 'index', name: 'Enterprise Search' }],
        results: [],
      }
    })

    const result = await searchWorkspaceServerTool.execute({ query: 'canaries' }, context)

    expect(result).toMatchObject({
      success: true,
      message: expect.stringContaining('cannot establish absence or completeness'),
      data: {
        retrieval: { status: 'partial', timedOutLegs: ['vector', 'keyword'] },
        results: [],
      },
    })
    expect(result).not.toHaveProperty('error')
    expect(mocks.info).toHaveBeenCalledWith(
      'Knowledge search completed',
      expect.objectContaining({ passageBytes: 0, originalPassageBytes: 0, outcome: 'partial' })
    )
  })
  it('pins identity and workspace to the trusted turn', async () => {
    await searchWorkspaceServerTool.execute(
      { query: 'orion', workspaceId: 'forged', userId: 'other' },
      context
    )
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({
          kind: 'delegated',
          subjectUserId: 'reader',
          workspaceId: 'workspace',
        }),
        input: expect.objectContaining({
          workspaceId: 'workspace',
          filters: {},
        }),
      })
    )
  })
  it('returns only the projected query to the model', async () => {
    const secret = 'private-resolved-query-token'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', secret)
    const result = await searchWorkspaceServerTool.execute(
      { query: `Find ${secret}` },
      { ...context, resolvedSecretTraceRegistry: registry }
    )
    expect(result).toMatchObject({ success: true, data: { query: 'Find {{TOKEN}}' } })
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ query: 'Find {{TOKEN}}' }) })
    )
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it.each([0, 20, 50])(
    'measures UTF-8 bytes for %i passages without logging their content',
    async (count) => {
      const content = 'Confidential passage é🔎'.repeat(100)
      mocks.search.mockResolvedValueOnce({
        retrieval: { status: 'complete', timedOutLegs: [] },
        knowledgeBases: [{ id: 'index', name: 'Enterprise Search' }],
        results: Array.from({ length: count }, (_, index) => ({
          knowledgeBaseId: 'index',
          documentId: `doc-${index % 4}`,
          documentName: 'Private title',
          sourceUrl: null,
          sourceModifiedAt: null,
          metadata: {},
          content,
          chunkIndex: index,
          similarity: 1,
        })),
      })

      const output = await searchWorkspaceServerTool.execute(
        { query: 'Private query', ...(count === 50 ? { topK: 50 } : {}) },
        context
      )

      expect(output.success).toBe(true)
      expect(mocks.info).toHaveBeenCalledWith(
        'Knowledge search completed',
        expect.objectContaining({
          toolCallId: 'call',
          toolResultBytes: Buffer.byteLength(JSON.stringify(output)),
          passageBytes: count * Buffer.byteLength(content.slice(0, 1200)),
          originalPassageBytes: count * Buffer.byteLength(content),
          maxPassageBytes: count ? Buffer.byteLength(content.slice(0, 1200)) : 0,
          uniqueDocumentCount: Math.min(count, 4),
        })
      )
      const logged = JSON.stringify(mocks.info.mock.calls)
      expect(logged).not.toContain('Confidential passage')
      expect(logged).not.toContain('Private title')
      expect(logged).not.toContain('Private query')
    }
  )

  it('returns stable citation IDs with internal links for uploaded documents', async () => {
    const result = await searchWorkspaceServerTool.execute({ query: 'orion' }, context)
    expect(result).toMatchObject({
      success: true,
      data: {
        results: [
          expect.objectContaining({
            citationId: 'document:doc',
            citationUrl: expect.stringContaining('/workspace/workspace/knowledge/index/doc'),
          }),
        ],
      },
    })
  })
  it('projects the provider name for connected-source citations instead of the index name', async () => {
    mocks.search.mockResolvedValueOnce({
      retrieval: { status: 'complete', timedOutLegs: [] },
      knowledgeBases: [{ id: 'index', name: 'Team docs' }],
      results: [
        {
          knowledgeBaseId: 'index',
          documentId: 'doc',
          documentName: 'Launch checklist',
          sourceUrl: 'https://www.notion.so/launch-checklist',
          connectorType: 'notion',
          sourceModifiedAt: null,
          metadata: {},
          content: 'body',
          chunkIndex: 0,
          similarity: 1,
        },
      ],
    })
    expect(await searchWorkspaceServerTool.execute({ query: 'launch' }, context)).toMatchObject({
      success: true,
      data: {
        results: [
          expect.objectContaining({
            documentName: 'Launch checklist',
            siteName: 'Notion',
            knowledgeBaseName: 'Team docs',
          }),
        ],
      },
    })
  })
  it('rejects untrusted contexts', async () => {
    expect(
      await searchWorkspaceServerTool.execute(
        { query: 'orion' },
        { ...context, copilotToolExecution: false }
      )
    ).toMatchObject({ success: false })
    expect(
      await readDocumentServerTool.execute(
        { documentId: 'doc' },
        { ...context, copilotToolExecution: false }
      )
    ).toMatchObject({ success: false })
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('reads a selected document through the shared use case and rejects unbounded pages', async () => {
    expect(
      await readDocumentServerTool.execute({ documentId: 'doc', startChunkIndex: 20 }, context)
    ).toMatchObject({ success: true })
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          assertedWorkspaceId: 'workspace',
          filters: { documentIds: ['doc'] },
          startChunkIndex: 20,
          limit: 3,
        }),
      })
    )
    expect(
      await readDocumentServerTool.execute({ documentId: 'doc', limit: 9 }, context)
    ).toMatchObject({ success: false })
    expect(mocks.read).toHaveBeenCalledOnce()
  })
})
