import { InstagramIcon } from '@/components/icons'
import {
  INSTAGRAM_COMMENT_CONDITION,
  INSTAGRAM_COMMENT_TRIGGER_ID,
  instagramAccountField,
  instagramSetupInstructions,
} from '@/triggers/instagram/utils'
import type { TriggerConfig } from '@/triggers/types'

export const instagramCommentWebhookTrigger: TriggerConfig = {
  id: INSTAGRAM_COMMENT_TRIGGER_ID,
  name: 'Instagram Comments',
  provider: 'instagram',
  description: 'Trigger workflow when someone comments on a post or reel of your Instagram account',
  version: '1.0.0',
  icon: InstagramIcon,

  subBlocks: [
    instagramAccountField(
      INSTAGRAM_COMMENT_CONDITION,
      'The professional account whose posts and reels are watched. Replies are sent from it.'
    ),
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: instagramSetupInstructions([
        'Select the Instagram professional account above.',
        'Deploy the workflow. Labbai subscribes the account to its comments automatically.',
        'Comments the account writes itself, including automated replies, never start the workflow.',
        'A private reply to a comment can be sent once, within 7 days of the comment.',
      ]),
      mode: 'trigger',
      condition: INSTAGRAM_COMMENT_CONDITION,
    },
    {
      id: 'autoReplyRules',
      title: 'Auto-replies',
      type: 'modal',
      modalId: 'instagram-auto-reply-rules',
      /**
       * Mirrors `INSTAGRAM_AUTO_REPLY_ENABLED` (off until App Review). Kept as a literal: importing
       * the flag here changed how Turbopack merges the trigger registry and crashed the workflow
       * page with a TDZ error, so trigger configs must not import it.
       */
      hidden: true,
      hideFromPreview: true,
      hideFromCopilot: true,
      mode: 'trigger',
      condition: INSTAGRAM_COMMENT_CONDITION,
    },
  ],

  outputs: {
    commentId: {
      type: 'string',
      description: 'Id of the first comment; use it to reply publicly or privately',
    },
    mediaId: { type: 'string', description: 'Id of the post or reel that was commented on' },
    mediaProductType: {
      type: 'string',
      description: 'Kind of media (FEED, REELS, AD, …) when Instagram includes it',
    },
    parentId: {
      type: 'string',
      description: 'Id of the comment this one replies to, when it is a reply',
    },
    text: { type: 'string', description: 'Text of the comment, if any' },
    fromId: { type: 'string', description: 'Instagram-scoped id of the commenter' },
    fromUsername: { type: 'string', description: 'Username of the commenter' },
    accountId: { type: 'string', description: 'Your Instagram professional account id' },
    timestamp: {
      type: 'number',
      description: 'Time Instagram sent the notification (entry.time, as delivered)',
    },
    comments: { type: 'json', description: 'All customer comments in the delivery' },
    raw: {
      type: 'json',
      description: 'Webhook payload from Instagram, limited to this account’s comments',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
