/**
 * Labbai CRM link: the shared vocabulary of the Binora CRM block and its API. Client-safe (no
 * server imports) so the block, the contract and the server share it.
 */

/**
 * The canvas block that links a workflow's conversations to a Binora funnel. It never runs: the
 * deploy sync reads whether the deployed version has it.
 */
export const BINORA_CRM_BLOCK_TYPE = 'binora_crm'

/** Sub-block of the Binora CRM block that manages the link (no stored value). */
export const BINORA_CRM_CONNECTION_SUBBLOCK_ID = 'connection'

/** Longest backfill a new link may ask for: the last three days of chats. */
export const CRM_MAX_BACKFILL_HOURS = 72

/** Longest channel address a link stores. */
export const CRM_BASE_URL_MAX_LENGTH = 500

/** Longest channel secret a link accepts. */
export const CRM_SECRET_MAX_LENGTH = 256

/**
 * After a CRM operator's reply reaches the customer, the AI steps back this long, as when the
 * owner types in Telegram Business, so it does not talk over the person who took the chat.
 */
export const CRM_OPERATOR_PAUSE_MINUTES = 15
