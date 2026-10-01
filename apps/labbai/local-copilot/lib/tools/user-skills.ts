import { db } from '@labbai/db'
import { skill } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { eq } from 'drizzle-orm'
// import { LOAD_USER_SKILL_TOOL_NAME } from '@/lib/mothership/skills'
import { resolveSkillContent } from '@/executor/handlers/agent/skills-resolver'
import type { LocalCopilotToolDefinition } from '@/local-copilot/lib/types'

const logger = createLogger('LocalCopilotUserSkills')

/** Tool name for Arena's local load_user_skill (cloud mothership dropped this path). */
export const LOAD_USER_SKILL_TOOL_NAME = 'load_user_skill'

export interface LocalCopilotSkillSummary {
  id: string
  name: string
  description: string
}

/** Starts the dynamic system message that lists the workspace's skills. */
export const USER_SKILL_CATALOG_SYSTEM_PREFIX = 'Workspace skills available to load_user_skill:'

/**
 * The load_user_skill tool. The definition is the same for every workspace (no skill names
 * or enum) so the copilot's tool list stays byte-stable for prompt caching; the workspace's
 * own catalog travels in the dynamic context ({@link formatUserSkillCatalogSystemMessage}).
 * Unknown names fail in `executeLoadUserSkill` with "Skill … not found".
 */
export const LOCAL_COPILOT_USER_SKILL_TOOL: LocalCopilotToolDefinition = {
  name: LOAD_USER_SKILL_TOOL_NAME,
  description: `Load a user-created skill's full instructions only when that skill is listed under "${USER_SKILL_CATALOG_SYSTEM_PREFIX}" in the context and its body is not already in the Relevant workspace skills prompt. Do not call this for names that are already inlined. Never act on a skill's name or description alone.`,
  parameters: {
    type: 'object',
    properties: {
      skill_name: {
        type: 'string',
        description: 'Exact name of a listed user skill to load.',
      },
    },
    required: ['skill_name'],
    additionalProperties: false,
  },
}

/**
 * The workspace's skill catalog (name: description per line, sorted by name) as a dynamic
 * system message, or null when the workspace has no skills.
 */
export function formatUserSkillCatalogSystemMessage(
  rows: Array<{ name: string; description: string }>
): { role: 'system'; content: string } | null {
  if (rows.length === 0) return null
  const catalog = [...rows]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => `- ${row.name}: ${row.description}`)
    .join('\n')
  return { role: 'system', content: `${USER_SKILL_CATALOG_SYSTEM_PREFIX}\n${catalog}` }
}

/**
 * Loads lightweight skill metadata for Arena Copilot context injection.
 * User-created workspace skills only (no code-only builtins).
 */
export async function loadWorkspaceSkillSummaries(
  workspaceId: string
): Promise<LocalCopilotSkillSummary[]> {
  if (!workspaceId) return []

  try {
    const rows = await db
      .select({
        id: skill.id,
        name: skill.name,
        description: skill.description,
      })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
    }))
  } catch (error) {
    logger.warn('Failed to load workspace skill summaries for context', {
      error,
      workspaceId,
    })
    return []
  }
}

/**
 * Resolves full skill instructions for a load_user_skill tool call.
 */
export async function executeLoadUserSkill(
  skillName: string,
  workspaceId: string
): Promise<{ success: true; content: string } | { success: false; error: string }> {
  if (!skillName || !workspaceId) {
    return { success: false, error: 'Missing skill_name or workspace context' }
  }

  const content = await resolveSkillContent(skillName, workspaceId)
  if (!content) {
    return { success: false, error: `Skill "${skillName}" not found` }
  }

  return { success: true, content }
}

// export { LOAD_USER_SKILL_TOOL_NAME }
