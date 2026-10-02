/**
 * Loop limits for the Arena Copilot agent turn.
 *
 * These live outside the orchestrator because the system prompt states several
 * of them to the model verbatim — keeping one definition stops the prompt and
 * the enforcing code from drifting apart.
 */

/**
 * Forced follow-up rounds before the turn stops chasing mandatory follow-ups. Each is a full
 * model round; past a few the model is not going to comply.
 */
export const MAX_FORCED_FOLLOW_UP_ROUNDS = 3

/** Cap for "I am applying…" prose with no tool call — avoid infinite nudge loops. */
export const MAX_INTENT_CONTINUATION_ROUNDS = 2

/** Successful create-then-edit_workflow calls before the post-build lock. */
export const MAX_POPULATE_EDITS = 5
