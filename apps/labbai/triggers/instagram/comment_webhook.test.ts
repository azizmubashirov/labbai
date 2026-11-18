/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { instagramCommentWebhookTrigger } from '@/triggers/instagram/comment_webhook'
import { INSTAGRAM_COMMENT_CONDITION } from '@/triggers/instagram/utils'

describe('instagramCommentWebhookTrigger', () => {
  it('shows the account auto-replies in a modal field that stores nothing', () => {
    const field = instagramCommentWebhookTrigger.subBlocks.find(
      (subBlock) => subBlock.id === 'autoReplyRules'
    )

    expect(field).toMatchObject({
      type: 'modal',
      modalId: 'instagram-auto-reply-rules',
      mode: 'trigger',
      condition: INSTAGRAM_COMMENT_CONDITION,
      hideFromPreview: true,
      hideFromCopilot: true,
    })
    expect(field).not.toHaveProperty('defaultValue')
    expect(field).not.toHaveProperty('required')
  })

  it('keeps the account picker first so the rules follow the chosen account', () => {
    const ids = instagramCommentWebhookTrigger.subBlocks.map((subBlock) => subBlock.id)

    expect(ids.indexOf('triggerCredentials')).toBeLessThan(ids.indexOf('autoReplyRules'))
  })
})
