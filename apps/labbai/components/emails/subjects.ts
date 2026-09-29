import { getBrandConfig } from '@/lib/branding'

/** Email subject type for all supported email templates */
export type EmailSubjectType =
  | 'sign-in'
  | 'email-verification'
  | 'change-email'
  | 'forget-password'
  | 'reset-password'
  | 'existing-account'
  | 'invitation'
  | 'enterprise-owner-invitation'
  | 'batch-invitation'
  | 'workspace-added'
  | 'permission-access-request-created'
  | 'permission-access-request-decided'
  | 'schedule-disabled'
  | 'subprocessor-change'
  | 'onboarding-followup'
  | 'welcome'

/**
 * Returns the email subject line for a given email type.
 * @param type - The type of email being sent
 * @returns The subject line for the email
 */
export function getEmailSubject(type: EmailSubjectType): string {
  const brandName = getBrandConfig().name

  switch (type) {
    case 'sign-in':
      return `Sign in to ${brandName}`
    case 'email-verification':
      return `Verify your email for ${brandName}`
    case 'change-email':
      return `Verify your new email for ${brandName}`
    case 'forget-password':
      return `Reset your ${brandName} password`
    case 'reset-password':
      return `Reset your ${brandName} password`
    case 'existing-account':
      return `Sign-up attempt with your ${brandName} email`
    case 'invitation':
      return `You've been invited to join a team on ${brandName}`
    case 'enterprise-owner-invitation':
      return `Activate your Enterprise organization on ${brandName}`
    case 'batch-invitation':
      return `You've been invited to join a team and workspaces on ${brandName}`
    case 'workspace-added':
      return `You've been added to a workspace on ${brandName}`
    case 'permission-access-request-created':
      return `An access request needs review on ${brandName}`
    case 'permission-access-request-decided':
      return `Your access request was updated on ${brandName}`
    case 'schedule-disabled':
      return `A schedule was turned off on ${brandName}`
    case 'subprocessor-change':
      return `Upcoming change to ${brandName} sub-processors`
    case 'onboarding-followup':
      return `Quick question about ${brandName}`
    case 'welcome':
      return `Welcome to ${brandName}`
    default:
      return brandName
  }
}

/** Echoes the sender's own subject line so the reply threads correctly. */
export function getRequestConfirmationSubject(userSubject: string, requestType?: string): string {
  return requestType
    ? `Your ${requestType} request has been received: ${userSubject}`
    : `We've received your message: ${userSubject}`
}

/** Names the resource being unlocked rather than the brand — that is what the recipient opened. */
export function getOtpSubject(resourceLabel: string): string {
  return `Verification code for ${resourceLabel}`
}

/**
 * Names the workspace so an external recipient can identify the request, and the
 * inviter when there is one — a workflow-issued invitation has no person to name.
 */
export function getCredentialGroupInvitationSubject(
  inviterName: string | undefined,
  workspaceName: string
): string {
  const brandName = getBrandConfig().name
  return inviterName
    ? `${inviterName} invited you to connect accounts for ${workspaceName} on ${brandName}`
    : `You have been invited to connect accounts for ${workspaceName} on ${brandName}`
}
