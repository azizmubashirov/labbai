import { InstagramIcon } from '@/components/icons'
import {
  INSTAGRAM_DM_CONDITION,
  INSTAGRAM_DM_TRIGGER_ID,
  instagramAccountField,
  instagramSetupInstructions,
  instagramTriggerOptions,
} from '@/triggers/instagram/utils'
import type { TriggerConfig } from '@/triggers/types'

export const instagramWebhookTrigger: TriggerConfig = {
  id: INSTAGRAM_DM_TRIGGER_ID,
  name: 'Instagram Direct Messages',
  provider: 'instagram',
  description: 'Trigger workflow when a customer sends your Instagram account a direct message',
  version: '1.0.0',
  icon: InstagramIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      canvasNoun: 'an event',
      type: 'dropdown',
      mode: 'trigger',
      options: instagramTriggerOptions,
      value: () => INSTAGRAM_DM_TRIGGER_ID,
      required: true,
    },
    instagramAccountField(
      INSTAGRAM_DM_CONDITION,
      'The professional account that receives the messages. Inbox replies are sent from it.'
    ),
    {
      id: 'webhookUrlDisplay',
      title: 'Legacy Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      description:
        'Only for a Meta app of your own whose callback points at this workflow. Not needed with the shared Labbai app.',
      mode: 'trigger-advanced',
      condition: INSTAGRAM_DM_CONDITION,
    },
    {
      id: 'verificationToken',
      title: 'Verification Token (legacy)',
      type: 'short-input',
      placeholder: 'Only for a callback that points at this workflow',
      description:
        'Only needed when your own Meta app uses the legacy webhook URL above as its callback.',
      password: true,
      mode: 'trigger-advanced',
      condition: INSTAGRAM_DM_CONDITION,
    },
    {
      id: 'appSecret',
      title: 'App Secret (legacy)',
      type: 'short-input',
      placeholder: 'Only for a callback that points at this workflow',
      description:
        'Validates X-Hub-Signature-256 for the legacy webhook URL. Leave empty to use the Labbai app secret.',
      password: true,
      mode: 'trigger-advanced',
      condition: INSTAGRAM_DM_CONDITION,
    },
    {
      id: 'receiveOwnerReplies',
      title: 'Also run on your own replies',
      type: 'switch',
      defaultValue: false,
      description:
        'Runs the workflow when the account itself sends a customer a message, with ownerReply set to true. This includes replies this workflow sends, so check ownerReply before replying.',
      required: false,
      mode: 'trigger-advanced',
      condition: INSTAGRAM_DM_CONDITION,
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: instagramSetupInstructions([
        'Select the Instagram professional account above.',
        'Deploy the workflow. Labbai subscribes the account to its messages automatically.',
        'In the Instagram app, turn on <strong>Settings &gt; Messages &gt; Connected tools &gt; Allow access to messages</strong>.',
        'Messages can only be answered within 24 hours of the customer’s last message.',
      ]),
      mode: 'trigger',
      condition: INSTAGRAM_DM_CONDITION,
    },
  ],

  outputs: {
    messageId: { type: 'string', description: 'Instagram message id (mid) of the first message' },
    senderId: {
      type: 'string',
      description:
        'Instagram-scoped id of the customer, also for owner replies; use it as the recipient when replying',
    },
    recipientId: { type: 'string', description: 'Your Instagram professional account id' },
    text: { type: 'string', description: 'Text of the first message, if any' },
    timestamp: { type: 'number', description: 'Message time in milliseconds since epoch' },
    attachments: {
      type: 'json',
      description: 'Attachments on the first message: type (image, video, audio, …) and url',
    },
    replyToMessageId: {
      type: 'string',
      description: 'Id of the message the customer replied to, if any',
    },
    messages: { type: 'json', description: 'All customer messages in the delivery' },
    ownerReply: {
      type: 'boolean',
      description:
        'True when the account itself sent this message to the customer (only with "Also run on your own replies")',
    },
    appId: {
      type: 'string',
      description: 'Id of the app that sent an owner reply, when Meta reports it',
    },
    raw: {
      type: 'json',
      description: 'Webhook payload from Instagram, limited to this account’s direct messages',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
