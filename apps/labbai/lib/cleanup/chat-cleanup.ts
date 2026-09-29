import { dbFor } from '@labbai/db'
import { copilotChats, copilotMessages, workspaceFiles } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { chunkArray } from '@labbai/utils/helpers'
import { and, inArray, isNull } from 'drizzle-orm'
import type { StorageContext } from '@/lib/uploads'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'

const logger = createLogger('ChatCleanup')

/** Chat cleanup only ever runs from cleanup jobs, so its reads use the cleanup pool. */
const cleanupDb = dbFor('cleanup')

/** Bounds how many chats' `copilot_messages` rows are scanned per query. */
const CHAT_FILE_COLLECT_CHUNK_SIZE = 500

/**
 * Only storage in these contexts is tied to chat/task lifecycle. Workspace
 * files, execution logs, knowledge bases, profile pictures, etc. are owned by
 * other subsystems and must never be touched by chat cleanup — even if a row
 * somehow ends up with `chatId` set through a future flow.
 */
const CHAT_SCOPED_CONTEXTS = ['copilot', 'mothership'] as const satisfies readonly StorageContext[]
type ChatScopedContext = (typeof CHAT_SCOPED_CONTEXTS)[number]

interface FileRef {
  key: string
  context: ChatScopedContext
  chatId: string
}

/**
 * Collect all file storage keys for the given chat IDs from two sources:
 * 1. workspaceFiles rows with chatId FK (chat-scoped contexts only)
 * 2. fileAttachments[].key inside each copilot_messages.content
 */
export async function collectChatFiles(chatIds: string[]): Promise<FileRef[]> {
  const files: FileRef[] = []
  if (chatIds.length === 0) return files

  const seen = new Set<string>()

  for (const chunk of chunkArray(chatIds, CHAT_FILE_COLLECT_CHUNK_SIZE)) {
    const [linkedFiles, messageRows] = await Promise.all([
      cleanupDb
        .select({
          key: workspaceFiles.key,
          context: workspaceFiles.context,
          chatId: workspaceFiles.chatId,
        })
        .from(workspaceFiles)
        .where(
          and(
            inArray(workspaceFiles.chatId, chunk),
            isNull(workspaceFiles.deletedAt),
            inArray(workspaceFiles.context, [...CHAT_SCOPED_CONTEXTS])
          )
        ),
      // Scan every message row for the chat (no deleted_at filter): this is a
      // deletion path collecting blob keys, so attachments on any row count.
      cleanupDb
        .select({ content: copilotMessages.content, chatId: copilotMessages.chatId })
        .from(copilotMessages)
        .where(inArray(copilotMessages.chatId, chunk)),
    ])

    for (const f of linkedFiles) {
      if (f.chatId && !seen.has(f.key)) {
        seen.add(f.key)
        files.push({ key: f.key, context: f.context as ChatScopedContext, chatId: f.chatId })
      }
    }

    for (const row of messageRows) {
      const msg = row.content
      if (!msg || typeof msg !== 'object') continue
      const attachments = (msg as Record<string, unknown>).fileAttachments
      if (!Array.isArray(attachments)) continue
      for (const attachment of attachments) {
        if (
          attachment &&
          typeof attachment === 'object' &&
          (attachment as Record<string, unknown>).key
        ) {
          const key = (attachment as Record<string, unknown>).key as string
          if (!seen.has(key)) {
            seen.add(key)
            files.push({ key, context: 'copilot', chatId: row.chatId })
          }
        }
      }
    }
  }

  return files
}

/** Groups files by storage context so each context can use one batch DELETE call. */
export async function deleteStorageFiles(
  files: FileRef[],
  label: string
): Promise<{ filesDeleted: number; filesFailed: number }> {
  const stats = { filesDeleted: 0, filesFailed: 0 }
  if (files.length === 0 || !isUsingCloudStorage()) return stats

  const keysByContext = new Map<ChatScopedContext, string[]>()
  for (const file of files) {
    const bucket = keysByContext.get(file.context)
    if (bucket) bucket.push(file.key)
    else keysByContext.set(file.context, [file.key])
  }

  for (const [context, keys] of keysByContext) {
    const result = await StorageService.deleteFiles(keys, context)
    stats.filesDeleted += result.deleted
    stats.filesFailed += result.failed.length
    for (const { key, error } of result.failed) {
      logger.error(`[${label}] Failed to delete storage file ${key} (context: ${context}):`, {
        error,
      })
    }
  }

  return stats
}

/**
 * Full chat cleanup: collect file refs, then (after DB deletion by caller)
 * delete storage files.
 *
 * Usage:
 *   const cleanup = await prepareChatCleanup(chatIds, label)
 *   // ... delete DB rows ...
 *   await cleanup.execute()
 */
export async function prepareChatCleanup(
  chatIds: string[],
  label: string
): Promise<{ execute: () => Promise<void> }> {
  // Collect file refs BEFORE DB deletion (keys + context are lost after cascade)
  const files = await collectChatFiles(chatIds)
  if (files.length > 0) {
    logger.info(`[${label}] Collected ${files.length} files for cleanup`, {
      files: files.map((f) => ({ key: f.key, context: f.context })),
    })
  }

  return {
    execute: async () => {
      // A chat can be restored (or its delete can fail) between selection and
      // the caller's row delete. Purge files only for chats whose rows are
      // actually gone, so a surviving row never loses its data.
      const survivors = new Set<string>()
      for (const chunk of chunkArray(chatIds, CHAT_FILE_COLLECT_CHUNK_SIZE)) {
        const rows = await cleanupDb
          .select({ id: copilotChats.id })
          .from(copilotChats)
          .where(inArray(copilotChats.id, chunk))
        for (const row of rows) survivors.add(row.id)
      }
      if (survivors.size > 0) {
        logger.info(
          `[${label}] Skipping external cleanup for ${survivors.size} chats whose rows still exist`
        )
      }
      const confirmedFiles = files.filter((file) => !survivors.has(file.chatId))

      // Delete storage files with correct context per file
      if (confirmedFiles.length > 0) {
        const fileStats = await deleteStorageFiles(confirmedFiles, label)
        logger.info(
          `[${label}] Storage cleanup: ${fileStats.filesDeleted} deleted, ${fileStats.filesFailed} failed`
        )
      }
    },
  }
}
