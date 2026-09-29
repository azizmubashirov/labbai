/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { agentTool as exaAgentTool } from '@/tools/exa/agent'
import { answerTool as exaAnswerTool } from '@/tools/exa/answer'
import { getContentsTool as exaGetContentsTool } from '@/tools/exa/get_contents'
import { searchTool as exaSearchTool } from '@/tools/exa/search'
import { agentTool as firecrawlAgentTool } from '@/tools/firecrawl/agent'
import { batchScrapeTool as firecrawlBatchScrapeTool } from '@/tools/firecrawl/batch-scrape'
import { crawlTool as firecrawlCrawlTool } from '@/tools/firecrawl/crawl'
import { extractTool as firecrawlExtractTool } from '@/tools/firecrawl/extract'
import { parseTool as firecrawlParseTool } from '@/tools/firecrawl/parse'
import { scrapeTool as firecrawlScrapeTool } from '@/tools/firecrawl/scrape'
import { searchTool as firecrawlSearchTool } from '@/tools/firecrawl/search'
import { geminiSttTool, geminiSttV2Tool } from '@/tools/stt/gemini'
import type { ExecutableToolConfig } from '@/tools/types'

function selectModelInput(
  tool: ExecutableToolConfig,
  params: Record<string, unknown>
): Record<string, unknown> {
  const modelInput = tool.operation?.modelInput ?? tool.request?.modelInput
  expect(modelInput?.mode).toBe('project')
  if (modelInput?.mode !== 'project') throw new Error(`Expected ${tool.id} to project model input`)
  const selected = modelInput.select(params)
  expect(Object.keys(selected).every((key) => Object.hasOwn(tool.params, key))).toBe(true)
  return selected
}

describe('model-facing integration selectors', () => {
  it.each([
    [
      exaAgentTool,
      { query: 'research', outputSchema: { type: 'object' }, systemPrompt: 'be concise' },
      { query: 'research', outputSchema: { type: 'object' }, systemPrompt: 'be concise' },
    ],
    [
      exaAnswerTool,
      { query: 'answer', outputSchema: { type: 'object' } },
      { query: 'answer', outputSchema: { type: 'object' } },
    ],
    [
      exaSearchTool,
      {
        query: 'search',
        summaryQuery: 'summarize',
        outputSchema: { type: 'object' },
        systemPrompt: 'format this',
      },
      {
        query: 'search',
        summaryQuery: 'summarize',
        outputSchema: { type: 'object' },
        systemPrompt: 'format this',
      },
    ],
    [exaGetContentsTool, { summaryQuery: 'summarize' }, { summaryQuery: 'summarize' }],
    [
      firecrawlAgentTool,
      { prompt: 'extract', schema: { type: 'object' } },
      { prompt: 'extract', schema: { type: 'object' } },
    ],
    [
      firecrawlExtractTool,
      { prompt: 'extract', schema: { type: 'object' } },
      { prompt: 'extract', schema: { type: 'object' }, scrapeOptions: undefined },
    ],
    [
      firecrawlCrawlTool,
      { prompt: 'focus on docs' },
      { prompt: 'focus on docs', formats: undefined },
    ],
    [
      firecrawlScrapeTool,
      {
        formats: [
          'markdown',
          { type: 'json', prompt: 'extract pricing', schema: { type: 'object' } },
        ],
      },
      { formats: [{}, { prompt: 'extract pricing', schema: { type: 'object' } }] },
    ],
    [
      firecrawlBatchScrapeTool,
      { formats: [{ type: 'question', question: 'What changed?' }] },
      { formats: [{ question: 'What changed?' }] },
    ],
    [
      firecrawlSearchTool,
      { scrapeOptions: { formats: [{ type: 'json', prompt: 'extract plans' }] } },
      { scrapeOptions: { formats: [{ prompt: 'extract plans' }] } },
    ],
    [
      firecrawlParseTool,
      { formats: [{ type: 'json', schema: { type: 'object' } }] },
      { formats: [{ schema: { type: 'object' } }] },
    ],
    [geminiSttTool, { language: 'English' }, { language: 'English' }],
    [geminiSttV2Tool, { language: 'English' }, { language: 'English' }],
  ])('%s selects only declared model-facing fields', (tool, params, expected) => {
    expect(
      selectModelInput(tool, { ...params, apiKey: 'credential', callbackUrl: 'transport' })
    ).toStrictEqual(expected)
  })
})
