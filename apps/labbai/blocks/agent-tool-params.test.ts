/**
 * @vitest-environment node
 *
 * Block `tools.config.params` on the Agent tool path. An Agent keeps a tool's
 * operation on its tool entry rather than in its params, and the per-operation
 * mapping in each block only runs when that operation is handed in. These run the
 * real block and tool configs through `transformBlockTool` + `prepareToolExecution`,
 * pinning both halves: the mapping runs, and the arguments the model sent survive it.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => ({
  getTrigger: vi.fn(() => ({ subBlocks: [] })),
}))

import { GmailV2Block } from '@/blocks/blocks/gmail'
import { ShopifyBlock } from '@/blocks/blocks/shopify'
import { ZoomBlock } from '@/blocks/blocks/zoom'
import type { BlockConfig } from '@/blocks/types'
import { prepareToolExecution, transformBlockTool } from '@/providers/utils'
import { gmailReadV2Tool } from '@/tools/gmail/read'
import { shopifyCreateProductTool } from '@/tools/shopify/create_product'
import { shopifyListOrdersTool } from '@/tools/shopify/list_orders'
import { zoomUpdateMeetingTool } from '@/tools/zoom/update_meeting'

const TOOLS: Record<string, unknown> = {
  gmail_read_v2: gmailReadV2Tool,
  shopify_create_product: shopifyCreateProductTool,
  shopify_list_orders: shopifyListOrdersTool,
  zoom_update_meeting: zoomUpdateMeetingTool,
}

async function runAgentTool(
  block: BlockConfig,
  operation: string,
  storedParams: Record<string, unknown>,
  llmArgs: Record<string, unknown>
) {
  const tool = await transformBlockTool(
    { type: block.type, operation, params: storedParams },
    {
      selectedOperation: operation,
      getAllBlocks: () => [block],
      getTool: (toolId: string) => TOOLS[toolId],
    }
  )
  if (!tool) throw new Error('transformBlockTool returned null')
  return prepareToolExecution(tool, llmArgs, {}, undefined).toolParams
}

describe('block params on the Agent tool path', () => {
  it('runs the Gmail read mapping and keeps the model arguments', async () => {
    const toolParams = await runAgentTool(
      GmailV2Block,
      'read_gmail',
      { oauthCredential: 'cred-1' },
      { maxResults: 5, unreadOnly: true }
    )

    expect(toolParams).toMatchObject({
      oauthCredential: 'cred-1',
      folder: 'INBOX',
      maxResults: 5,
      unreadOnly: true,
    })
    expect(toolParams).not.toHaveProperty('operation')
  })

  it('keeps the model order filter instead of the empty per-operation sub-blocks', async () => {
    const toolParams = await runAgentTool(
      ShopifyBlock,
      'shopify_list_orders',
      { oauthCredential: 'cred-1', shopDomain: 'shop.myshopify.com' },
      { status: 'open', query: 'email:a@example.com' }
    )

    expect(toolParams).toMatchObject({ status: 'open', query: 'email:a@example.com' })
  })

  it('accepts the tag list the model sends as an array', async () => {
    const toolParams = await runAgentTool(
      ShopifyBlock,
      'shopify_create_product',
      { oauthCredential: 'cred-1', shopDomain: 'shop.myshopify.com' },
      { title: 'Mug', tags: ['red', 'sale'] }
    )

    expect(toolParams).toMatchObject({ title: 'Mug', tags: ['red', 'sale'] })
  })

  it('keeps the meeting topic the model sends to Zoom update', async () => {
    const toolParams = await runAgentTool(
      ZoomBlock,
      'zoom_update_meeting',
      { oauthCredential: 'cred-1' },
      { meetingId: '123', topic: 'Weekly sync' }
    )

    expect(toolParams).toMatchObject({ meetingId: '123', topic: 'Weekly sync' })
  })
})
