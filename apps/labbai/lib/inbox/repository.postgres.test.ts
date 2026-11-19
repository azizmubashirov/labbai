/** @vitest-environment node */
import { generateId } from '@labbai/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ current: undefined as PostgresJsDatabase | undefined }))
vi.unmock('drizzle-orm')
vi.unmock('@labbai/db/schema')
vi.mock('@labbai/db', () => ({
  db: {
    transaction: (...args: unknown[]) => {
      if (!database.current) throw new Error('Postgres test is not initialized')
      return Reflect.apply(database.current.transaction, database.current, args)
    },
  },
}))

import { clearInboxConversation } from '@/lib/inbox/repository'

const databaseUrl = process.env.MEMORY_PROVENANCE_TEST_DATABASE_URL
if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Inbox PostgreSQL tests require an explicitly configured local database')
}

const schemaName = `inbox_clear_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 4,
      connection: { search_path: `${schemaName},public` },
      onnotice: () => {},
    })
  : undefined

async function rows<T extends Record<string, unknown>>(query: string): Promise<T[]> {
  if (!connection) throw new Error('No test database')
  return connection.unsafe<T[]>(query)
}

describe.skipIf(!databaseUrl)('clearing an Inbox conversation in Postgres', () => {
  beforeAll(async () => {
    if (!connection) return
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    database.current = drizzle(connection)
    await connection.unsafe(`
      CREATE TABLE inbox_conversation (
        id text PRIMARY KEY, workspace_id text NOT NULL, channel text NOT NULL,
        account_id text NOT NULL, external_chat_id text NOT NULL, contact_name text,
        contact_handle text, workflow_id text, webhook_id text,
        ai_enabled boolean NOT NULL DEFAULT true, ai_paused_until timestamp,
        unread_count integer NOT NULL DEFAULT 0, last_message_preview text,
        last_message_at timestamp NOT NULL DEFAULT now(),
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE inbox_message (
        id text PRIMARY KEY,
        conversation_id text NOT NULL REFERENCES inbox_conversation(id) ON DELETE CASCADE,
        workspace_id text NOT NULL, text text NOT NULL
      );
      CREATE TABLE memory (
        id text PRIMARY KEY, workspace_id text NOT NULL, key text NOT NULL, data jsonb NOT NULL,
        deleted_at timestamp, UNIQUE(workspace_id, key)
      );
      CREATE TABLE agent_memory_turn (
        id text PRIMARY KEY, memory_id text NOT NULL REFERENCES memory(id) ON DELETE CASCADE
      );
    `)
  })

  beforeEach(async () => {
    if (!connection) return
    await connection.unsafe(`
      DELETE FROM agent_memory_turn; DELETE FROM memory;
      DELETE FROM inbox_message; DELETE FROM inbox_conversation;
      INSERT INTO inbox_conversation
        (id, workspace_id, channel, account_id, external_chat_id, ai_enabled, ai_paused_until,
         unread_count, last_message_preview, last_message_at)
      VALUES
        ('conv-1', 'ws-1', 'telegram', '777', '123', false, now() + interval '1 hour', 4, 'Salom',
         '2026-11-01 10:00:00'),
        ('conv-2', 'ws-1', 'telegram', '777', '1123', true, null, 1, 'Boshqa', now());
      INSERT INTO inbox_message (id, conversation_id, workspace_id, text) VALUES
        ('m-1', 'conv-1', 'ws-1', 'a'), ('m-2', 'conv-1', 'ws-1', 'b'),
        ('m-3', 'conv-1', 'ws-1', 'c'), ('m-4', 'conv-2', 'ws-1', 'd');
      INSERT INTO memory (id, workspace_id, key, data, deleted_at) VALUES
        ('mem-exact', 'ws-1', '123', '[]', null),
        ('mem-suffix', 'ws-1', 'rnb:tg:123', '[]', null),
        ('mem-other-chat', 'ws-1', 'rnb:tg:1123', '[]', null),
        ('mem-infix', 'ws-1', 'rnb:123:tg', '[]', null),
        ('mem-other-ws', 'ws-2', 'rnb:tg:123', '[]', null),
        ('mem-archived', 'ws-1', 'old:tg:123', '[]', now());
      INSERT INTO agent_memory_turn (id, memory_id) VALUES
        ('turn-1', 'mem-suffix'), ('turn-2', 'mem-other-chat');
    `)
  })

  afterAll(async () => {
    if (!connection) return
    try {
      await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
    } finally {
      await connection.end()
    }
  })

  it('deletes the history and the chat memory, and resets the conversation in place', async () => {
    const result = await clearInboxConversation({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      externalChatId: '123',
    })

    expect(result).toMatchObject({
      deletedMessages: 3,
      deletedMemories: 2,
      conversation: {
        id: 'conv-1',
        unreadCount: 0,
        aiEnabled: true,
        aiPausedUntil: null,
        lastMessagePreview: null,
        lastMessageAt: new Date('2026-11-01T10:00:00Z'),
      },
    })
    expect(await rows('SELECT id FROM inbox_message ORDER BY id')).toEqual([{ id: 'm-4' }])
    expect(await rows('SELECT id FROM memory ORDER BY id')).toEqual([
      { id: 'mem-archived' },
      { id: 'mem-infix' },
      { id: 'mem-other-chat' },
      { id: 'mem-other-ws' },
    ])
    expect(await rows('SELECT id FROM agent_memory_turn')).toEqual([{ id: 'turn-2' }])
    expect(
      await rows(
        "SELECT unread_count, last_message_preview FROM inbox_conversation WHERE id = 'conv-2'"
      )
    ).toEqual([{ unread_count: 1, last_message_preview: 'Boshqa' }])
  })

  it('treats LIKE wildcards in a chat id literally', async () => {
    await rows(
      `INSERT INTO memory (id, workspace_id, key, data) VALUES ('mem-x', 'ws-1', 'a:x1', '[]')`
    )
    const result = await clearInboxConversation({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      externalChatId: '_1',
    })

    expect(result?.deletedMemories).toBe(0)
    expect(await rows("SELECT id FROM memory WHERE id = 'mem-x'")).toEqual([{ id: 'mem-x' }])
  })

  it('touches nothing when the conversation is not in the workspace', async () => {
    const result = await clearInboxConversation({
      workspaceId: 'ws-2',
      conversationId: 'conv-1',
      externalChatId: '123',
    })

    expect(result).toBeNull()
    expect(await rows('SELECT count(*)::int AS n FROM inbox_message')).toEqual([{ n: 4 }])
    expect(await rows('SELECT count(*)::int AS n FROM memory')).toEqual([{ n: 6 }])
  })
})
