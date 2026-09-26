import { InstagramIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const instagramWebhookTrigger: TriggerConfig = {
  id: 'instagram_webhook',
  name: 'Instagram Direct Messages',
  provider: 'instagram',
  description: 'Trigger workflow when a customer sends your Instagram account a direct message',
  version: '1.0.0',
  icon: InstagramIcon,

  subBlocks: [
    {
      id: 'triggerCredentials',
      title: 'Instagram Account',
      type: 'oauth-input',
      description:
        'The professional account that receives the messages. Inbox replies are sent from it.',
      serviceId: 'instagram',
      requiredScopes: [],
      required: true,
      mode: 'trigger',
    },
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
    },
    {
      id: 'verificationToken',
      title: 'Verification Token',
      type: 'short-input',
      placeholder: 'Generate or enter a verification token',
      description: 'Any secret string. Enter the same value as the Verify token in your Meta app.',
      password: true,
      required: true,
      mode: 'trigger',
    },
    {
      id: 'appSecret',
      title: 'App Secret',
      type: 'short-input',
      placeholder: 'Paste your Meta app secret',
      description: 'Used to validate the X-Hub-Signature-256 header on every delivery.',
      password: true,
      required: true,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Select the Instagram professional account above, then click <strong>"Save Configuration"</strong> and deploy the workflow.',
        'Open your app in the <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" class="text-muted-foreground underline transition-colors hover:text-muted-foreground/80">Meta App Dashboard</a> and go to <strong>Instagram &gt; API setup with Instagram login</strong>.',
        'Under <strong>Configure webhooks</strong>, paste the <strong>Webhook URL</strong> above as the Callback URL and the <strong>Verification Token</strong> as the Verify token, then click <strong>Verify and save</strong>.',
        'Subscribe to the <code>messages</code> webhook field.',
        'Copy the app secret from <strong>App settings &gt; Basic</strong> into the <strong>App Secret</strong> field above.',
        'Messages can only be answered within 24 hours of the customer’s last message.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
    messageId: { type: 'string', description: 'Instagram message id (mid) of the first message' },
    senderId: {
      type: 'string',
      description: 'Instagram-scoped id of the customer; use it as the recipient when replying',
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
    raw: { type: 'json', description: 'Complete webhook payload from Instagram' },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
