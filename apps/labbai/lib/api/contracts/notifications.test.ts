/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createNotificationRecipientBodySchema,
  notificationRecipientParamsSchema,
  notificationWorkflowParamsSchema,
} from '@/lib/api/contracts/notifications'

describe('notification recipient contracts', () => {
  it('scopes every recipient route to a workflow of the workspace', () => {
    expect(notificationWorkflowParamsSchema.safeParse({ id: 'ws-1' }).success).toBe(false)
    expect(
      notificationWorkflowParamsSchema.safeParse({ id: 'ws-1', workflowId: 'wf-1' }).success
    ).toBe(true)
    expect(
      notificationRecipientParamsSchema.safeParse({ id: 'ws-1', workflowId: 'wf-1' }).success
    ).toBe(false)
    expect(
      notificationRecipientParamsSchema.safeParse({
        id: 'ws-1',
        workflowId: 'wf-1',
        recipientId: 'rec-1',
      }).success
    ).toBe(true)
  })

  it('trims the recipient name and defaults it to empty', () => {
    expect(createNotificationRecipientBodySchema.parse({ title: ' Sales ' })).toEqual({
      title: 'Sales',
    })
    expect(createNotificationRecipientBodySchema.parse({})).toEqual({ title: '' })
    const tooLong = createNotificationRecipientBodySchema.safeParse({ title: 'x'.repeat(121) })
    expect(tooLong.success).toBe(false)
  })

  it('never takes the workflow from the body', () => {
    expect(
      createNotificationRecipientBodySchema.parse({ title: 'Sales', workflowId: 'wf-other' })
    ).toEqual({ title: 'Sales' })
  })
})
