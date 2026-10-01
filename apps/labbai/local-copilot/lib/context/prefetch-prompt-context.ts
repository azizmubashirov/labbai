import {
  type CopilotChatConfig,
  loadCopilotChatConfig,
} from '@/local-copilot/lib/context/chat-config'
import { loadRelevantSkillGuidance } from '@/local-copilot/lib/context/relevant-skills'
import { type CopilotTaskState, parseTaskState } from '@/local-copilot/lib/context/task-state'
import type { ChatMessage } from '@/local-copilot/lib/providers/types'
import { resolveLocalCopilotTools } from '@/local-copilot/lib/tools/definitions'
import {
  formatUserSkillCatalogSystemMessage,
  type LocalCopilotSkillSummary,
  loadWorkspaceSkillSummaries,
} from '@/local-copilot/lib/tools/user-skills'
import type { LocalCopilotToolDefinition } from '@/local-copilot/lib/types'
import {
  type BuildLocalCopilotUserTurnParams,
  buildLocalCopilotUserTurn,
} from '@/local-copilot/lib/user-turn-content'

export interface PromptContextPrefetchInput {
  userId: string
  workspaceId: string
  chatId?: string
  message: string
  contexts?: BuildLocalCopilotUserTurnParams['contexts']
  fileAttachments?: BuildLocalCopilotUserTurnParams['fileAttachments']
}

export interface SettledPromptContextPrefetch {
  relevantSkills: Awaited<ReturnType<typeof loadRelevantSkillGuidance>>
  /** "Workspace skills available to load_user_skill" (dynamic context), or null. */
  skillCatalogMessage: ChatMessage | null
  /** The workspace-independent tool catalog. */
  allTools: LocalCopilotToolDefinition[]
  userTurn: ChatMessage
  taskState: CopilotTaskState | null
  chatConfig: CopilotChatConfig | null
}

export interface PromptContextPrefetch {
  /**
   * Started after structured context exposes skill summaries, so the skill bodies and the
   * load_user_skill catalog come from the same list (no second skills query).
   */
  startSkills: (skills: LocalCopilotSkillSummary[] | undefined) => void
  /** Awaits tools / user turn / chat config / skills (once started). */
  settle: () => Promise<SettledPromptContextPrefetch>
}

/**
 * Kicks off parent-prompt I/O that does not need intent classification, so it
 * overlaps spend-gate / session-memory work (and specialist TTFT when present).
 *
 * Chat config is loaded once and reused for both snapshot deltas and task state.
 * The tool catalog is static; the workspace's skill catalog (for load_user_skill) is a
 * dynamic context message built from the summaries given to `startSkills`, or from a DB
 * skills query when settle runs first.
 */
export function startPromptContextPrefetch(
  input: PromptContextPrefetchInput
): PromptContextPrefetch {
  const userTurnPromise = buildLocalCopilotUserTurn({
    message: input.message,
    ...(input.contexts?.length ? { contexts: input.contexts } : {}),
    ...(input.fileAttachments?.length ? { fileAttachments: input.fileAttachments } : {}),
    ...(input.chatId ? { chatId: input.chatId } : {}),
  })
  const chatConfigPromise: Promise<CopilotChatConfig | null> = input.chatId
    ? loadCopilotChatConfig(input.chatId, input.userId).catch(() => null)
    : Promise.resolve(null)
  const toolsPromise = resolveLocalCopilotTools()

  let skillsPromise: Promise<Awaited<ReturnType<typeof loadRelevantSkillGuidance>>> | null = null
  let skillSummariesPromise: Promise<LocalCopilotSkillSummary[]> | null = null

  return {
    startSkills(skills) {
      if (!skillsPromise) {
        skillsPromise = loadRelevantSkillGuidance({
          skills,
          workspaceId: input.workspaceId,
        })
      }
      skillSummariesPromise = Promise.resolve(skills ?? [])
    },
    async settle() {
      if (!skillsPromise) {
        skillsPromise = loadRelevantSkillGuidance({
          skills: undefined,
          workspaceId: input.workspaceId,
        })
      }
      if (!skillSummariesPromise) {
        skillSummariesPromise = loadWorkspaceSkillSummaries(input.workspaceId)
      }
      const [relevantSkills, skillSummaries, allTools, userTurn, chatConfig] = await Promise.all([
        skillsPromise,
        skillSummariesPromise,
        toolsPromise,
        userTurnPromise,
        chatConfigPromise,
      ])
      return {
        relevantSkills,
        skillCatalogMessage: formatUserSkillCatalogSystemMessage(skillSummaries),
        allTools,
        userTurn,
        taskState: chatConfig ? parseTaskState(chatConfig.taskState) : null,
        chatConfig,
      }
    },
  }
}
