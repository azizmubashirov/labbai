import type {
  CredentialGroupEnrollment,
  CredentialGroupOption,
} from '@/lib/api/contracts/credential-groups'
import {
  isManagedMcpConnectorId,
  MANAGED_MCP_CONNECTORS,
} from '@/lib/credential-groups/managed-mcp-connectors'
import {
  getCredentialGroupProviderService,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'

/** Badge tone for an enrollment state. */
export type EnrollmentTone = 'green' | 'amber' | 'red' | 'gray'

/** Display name for an OAuth provider or managed MCP connector id. */
export function getProviderLabel(provider: string): string {
  if (isCredentialGroupProvider(provider)) {
    try {
      return getCredentialGroupProviderService(provider).name
    } catch {
      return provider
    }
  }
  if (isManagedMcpConnectorId(provider)) return MANAGED_MCP_CONNECTORS[provider].name
  if (provider === 'gitlab') return 'GitLab'
  return provider
}

/** Reader-facing label and tone for an enrollment's status, with expiry taking precedence. */
export function describeEnrollmentStatus(
  enrollment: Pick<CredentialGroupEnrollment, 'status' | 'expired'>
): { label: string; tone: EnrollmentTone } {
  switch (enrollment.status) {
    case 'completed':
      return { label: 'Connected', tone: 'green' }
    case 'revoked':
      return { label: 'Revoked', tone: 'gray' }
    case 'delivery_failed':
      return { label: 'Delivery failed', tone: 'red' }
    default:
      if (enrollment.expired) return { label: 'Expired', tone: 'gray' }
      return enrollment.status === 'in_progress'
        ? { label: 'In progress', tone: 'amber' }
        : { label: 'Invited', tone: 'amber' }
  }
}

/** Whether an invitation can be re-sent (anything not finished or revoked). */
export function canResendEnrollment(enrollment: Pick<CredentialGroupEnrollment, 'status'>) {
  return enrollment.status !== 'completed' && enrollment.status !== 'revoked'
}

/**
 * An option that still needs admin setup blocks new connection requests for
 * it; an option without a reported configuration state is treated as usable.
 */
export function isOptionSetupIncomplete(
  option: Pick<CredentialGroupOption, 'configurationStatus'> | undefined
): boolean {
  return (
    option?.configurationStatus === 'needs_update' ||
    option?.configurationStatus === 'not_configured'
  )
}
