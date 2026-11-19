/**
 * Whether Instagram Auto-Reply is available. Off until the Meta app passes App Review: while it
 * is off the workspace page, its sidebar and search entries, the trigger's rules modal, and the
 * Inbox auto-reply timeline are hidden, and the webhook ingress does not run rules, so every
 * event goes to the workflows.
 *
 * The Instagram comment trigger's `autoReplyRules` sub-block carries its own `hidden: true` instead
 * of importing this flag, so flip both when the feature comes back.
 */
export const INSTAGRAM_AUTO_REPLY_ENABLED = false
