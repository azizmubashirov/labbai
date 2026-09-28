/**
 * AI state of an Inbox conversation. `aiEnabled` false with `aiPausedUntil` set is a temporary
 * pause (a notification trigger): AI replies come back by themselves once that time passes.
 * `aiEnabled` false without it is off until a person turns it back on.
 */
export interface InboxAiState {
  aiEnabled: boolean
  aiPausedUntil: Date | null
}

/** Whether the agent may answer this conversation now. */
export function isInboxAiActive(state: InboxAiState, now: Date = new Date()): boolean {
  if (state.aiEnabled) return true
  return state.aiPausedUntil !== null && state.aiPausedUntil.getTime() <= now.getTime()
}

/**
 * A conversation as it should read now: a temporary pause that has run out reads as AI on, so
 * the list, the thread switch and every AI-on check agree without a background job flipping the
 * stored row. The next AI write stores the settled state.
 */
export function settleInboxAiPause<T extends InboxAiState>(row: T, now: Date = new Date()): T {
  if (row.aiEnabled || row.aiPausedUntil === null) return row
  if (row.aiPausedUntil.getTime() > now.getTime()) return row
  return { ...row, aiEnabled: true, aiPausedUntil: null }
}
