import { CrmFunnelIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

/**
 * Links the workflow's customer chats to a Binora sales funnel. It is a configuration block,
 * like a Note: it has no ports, never joins the execution graph and never runs as a step. The
 * link (Binora channel address and key) is saved at once by "Connect"; chats are mirrored while
 * the deployed version of the workflow has this block. The type and sub-block id match
 * `BINORA_CRM_BLOCK_TYPE` and `BINORA_CRM_CONNECTION_SUBBLOCK_ID` in `lib/crm/constants.ts`,
 * which the deploy sync reads.
 */
export const BinoraCrmBlock: BlockConfig = {
  type: 'binora_crm',
  name: 'Binora CRM',
  description: 'Turn this workflow’s chats into leads in a Binora funnel',
  longDescription:
    'Link this agent workflow to a Binora sales funnel. Every Telegram, WhatsApp and Instagram chat the workflow answers becomes a lead in Binora: the customer’s messages, the agent’s replies and operator replies all show on the lead card. Binora operators answer the customer or turn the AI off from the lead card, and the reply goes out through this workflow’s channel. Create an “AI agent (Telegram, WhatsApp)” lead source in Binora (Settings → Lead sources), paste its address and key here and press Connect, then deploy the workflow. The block is not connected to other blocks and never runs as a step.',
  bestPractices: `
  - Put one Binora CRM block on the canvas of each agent workflow whose chats should reach Binora; its funnel, stage and owner are chosen in Binora on the lead source.
  - Connecting saves the link immediately; chats start reaching Binora once the workflow is deployed with this block (remove the block and redeploy to stop).
  - A reply from the Binora lead card pauses the AI in that chat for 15 minutes, like an owner typing in Telegram.
  `,
  category: 'blocks',
  bgColor: '#2563EB',
  icon: CrmFunnelIcon,
  singleInstance: true,
  subBlocks: [
    {
      id: 'connection',
      title: 'Binora link',
      type: 'modal',
      modalId: 'binora-crm-connection',
      hideFromPreview: true,
      hideFromCopilot: true,
      description: 'The Binora lead source this workflow’s chats go to.',
    },
  ],
  tools: { access: [] },
  inputs: {},
  outputs: {},
}
