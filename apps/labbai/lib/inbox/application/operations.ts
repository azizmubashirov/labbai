import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/** Operations the Inbox UI calls admit signed-in members only. */
const INBOX_PRINCIPALS = { principalKinds: ['session'] } as const

/** The Inbox workflow block acts through the executor delegation of the run that executes it. */
const INBOX_WORKFLOW_PRINCIPALS = {
  principalKinds: ['delegated'],
  delegatedServices: ['executor'],
} as const

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
  readAttachment: defineWorkspaceOperation({
    id: 'inbox.attachments.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INBOX_PRINCIPALS,
  }),
  // permission-group-exempt: the Inbox is not a governed permission-group surface yet; workspace roles gate it
  unreadCount: defineWorkspaceOperation({
    id: 'inbox.unread.count',
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
  // permission-group-exempt: a workflow run's own Inbox side effect; the block/tool gate governs the run
  setAiForChat: defineWorkspaceOperation({
    id: 'inbox.conversations.ai.set',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INBOX_WORKFLOW_PRINCIPALS,
  }),
}
