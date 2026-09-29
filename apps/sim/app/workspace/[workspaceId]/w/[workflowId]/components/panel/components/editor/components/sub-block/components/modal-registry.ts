import type { ComponentType } from 'react'
import { NotificationRecipients } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/notifications/notification-recipients'
import { NotificationRules } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/notifications/notification-rules'

/**
 * Props every `type: 'modal'` sub-block component must accept. The sub-block
 * dispatcher passes these through from the surrounding editor shell.
 */
export interface ModalSubBlockProps {
  blockId: string
  /** The sub-block's own id, for components that keep a value in the sub-block store. */
  subBlockId: string
  isPreview?: boolean
  /** The value a preview (e.g. a deployed version) shows instead of the live store's. */
  previewValue?: unknown
  disabled?: boolean
}

/**
 * Registry of available modal sub-block components keyed by the `modalId`
 * string that trigger / block configs pass in their `SubBlockConfig`.
 *
 * @remarks
 * Adding a new modal sub-block is two lines: import the component, then
 * register it under a unique id. The id travels through config and
 * persistence as a plain string, so nothing here leaks into serialization.
 * Keep this file client-only — it imports React components and must not be
 * pulled into trigger / block config modules.
 */
export const MODAL_REGISTRY: Readonly<Record<string, ComponentType<ModalSubBlockProps>>> = {
  'notification-recipients': NotificationRecipients,
  'notification-rules': NotificationRules,
}

export type ModalId = keyof typeof MODAL_REGISTRY
