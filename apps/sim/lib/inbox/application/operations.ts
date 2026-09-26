import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/** The Inbox UI is the only surface today, so every operation admits signed-in members only. */
const INBOX_PRINCIPALS = { principalKinds: ['session'] } as const

export const inboxOperations = {
  // permission-group-exempt: the Inbox is not a governed permission-group surface yet; workspace roles gate it
  listConversations: defineWorkspaceOperation({
    id: 'inbox.conversations.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INBOX_PRINCIPALS,
  }),
  // permission-group-exempt: the Inbox is not a governed permission-group surface yet; workspace roles gate it
  getConversation: defineWorkspaceOperation({
    id: 'inbox.conversations.get',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INBOX_PRINCIPALS,
  }),
  // permission-group-exempt: the Inbox is not a governed permission-group surface yet; workspace roles gate it
  updateConversation: defineWorkspaceOperation({
    id: 'inbox.conversations.update',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INBOX_PRINCIPALS,
  }),
  // permission-group-exempt: the Inbox is not a governed permission-group surface yet; workspace roles gate it
  reply: defineWorkspaceOperation({
    id: 'inbox.conversations.reply',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INBOX_PRINCIPALS,
  }),
}
