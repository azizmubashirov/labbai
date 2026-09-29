import type { MothershipResource } from '@/lib/copilot/resources/types'

export interface ResourceAttachment {
  type: MothershipResource['type']
  id: string
  title: string
  active: boolean
}

/** Maps the chat's open resources to request attachments. */
export function buildResourceAttachments(
  resources: readonly MothershipResource[],
  activeResourceId: string | null
): ResourceAttachment[] | undefined {
  const attachments = resources.map<ResourceAttachment>((resource) => ({
    type: resource.type,
    id: resource.id,
    title: resource.title,
    active: resource.id === activeResourceId,
  }))
  return attachments.length === 0 ? undefined : attachments
}
