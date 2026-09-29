import { NotificationsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

/**
 * Configures Telegram alerts for the workflow it sits in. It is a configuration block, like a
 * Note: it has no ports, never joins the execution graph and never runs as a step. Its recipients
 * are rows created at once by "Connect Telegram"; its rules become the workflow's notification
 * triggers when the workflow is deployed (and are removed on undeploy), so only the deployed
 * version's rules take effect. The type and sub-block ids match `NOTIFICATIONS_BLOCK_TYPE` and
 * the sub-block constants in `lib/notifications/constants.ts`, which the deploy sync reads.
 */
export const NotificationsBlock: BlockConfig = {
  type: 'notifications',
  name: 'Notifications',
  description: 'Alert your operators on Telegram about this workflow’s chats',
  longDescription:
    'Configure Telegram alerts for this workflow. Connect the Telegram chats (people or groups) that should get alerts, then add rules: a customer message or an agent reply that matches a condition you write (judged by AI), or an event a Notify block reports. A rule can also pause the AI for that customer and send them a notice. Only this workflow’s Inbox conversations are checked and only its recipients are alerted. Rules take effect when the workflow is deployed; change a rule, then redeploy. The block is not connected to other blocks and never runs as a step.',
  bestPractices: `
  - Put one Notifications block on the canvas of each agent workflow that should send alerts; workflows without one never alert anyone.
  - Connect Telegram creates the recipient immediately; rules only take effect after you deploy (redeploy after every change).
  - Event rules fire from a Notify block in this workflow or in a child workflow it calls (e.g. a shared escalate_to_human tool): the run's top-level workflow's rules and recipients are used.
  `,
  category: 'blocks',
  bgColor: '#F59E0B',
  icon: NotificationsIcon,
  singleInstance: true,
  subBlocks: [
    {
      id: 'recipients',
      title: 'Recipients',
      type: 'modal',
      modalId: 'notification-recipients',
      hideFromPreview: true,
      hideFromCopilot: true,
      description: 'Telegram chats that get this workflow’s alerts.',
    },
    {
      id: 'rules',
      title: 'Rules',
      type: 'modal',
      modalId: 'notification-rules',
      defaultValue: [],
      hideFromPreview: true,
      hideFromCopilot: true,
      description: 'When to alert the recipients, and whether to pause the AI.',
    },
  ],
  tools: { access: [] },
  inputs: {},
  outputs: {},
}
