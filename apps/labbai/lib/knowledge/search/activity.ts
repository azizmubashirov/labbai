import { db } from '@labbai/db'
import { organizationSearchInvocation } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { generateId } from '@labbai/utils/id'
import { sql } from 'drizzle-orm'
import type { SEARCH_STATS_SURFACES } from '@/lib/knowledge/search/stats'

const logger = createLogger('OrganizationSearchActivity')

interface SearchActivityInput {
  organizationId: string
  userId: string
  surface: (typeof SEARCH_STATS_SURFACES)[number]
  results: ReadonlyArray<{ documentId: string; connectorType: string | null }>
}

/** Records completed, authorized searches without query text, document IDs, or content. */
export async function recordOrganizationSearchActivity(input: SearchActivityInput): Promise<void> {
  const sourceTypes = [...new Set(input.results.map((result) => result.connectorType ?? 'uploads'))]
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '2s'`)
      await tx.insert(organizationSearchInvocation).values({
        id: generateId(),
        organizationId: input.organizationId,
        userId: input.userId,
        surface: input.surface,
        sourceTypes,
        resultCount: new Set(input.results.map((result) => result.documentId)).size,
      })
    })
  } catch (error) {
    logger.warn('Failed to record organization Search activity', {
      error: getErrorMessage(error),
    })
  }
}
