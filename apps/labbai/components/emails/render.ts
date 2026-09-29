import { render } from '@react-email/render'
import {
  ExistingAccountEmail,
  OnboardingFollowupEmail,
  OTPVerificationEmail,
  ResetPasswordEmail,
  WelcomeEmail,
} from '@/components/emails/auth'
import {
  BatchInvitationEmail,
  EnterpriseOwnerInvitationEmail,
  InvitationEmail,
  WorkspaceAddedEmail,
  WorkspaceInvitationEmail,
} from '@/components/emails/invitations'
import {
  PermissionAccessRequestEmail,
  ScheduleDisabledEmail,
  type SubprocessorChange,
  SubprocessorChangeEmail,
} from '@/components/emails/notifications'
import { HelpConfirmationEmail } from '@/components/emails/support'
import type { ScheduleDisableReason } from '@/lib/workflows/schedules/disable-reasons'

interface WorkspaceInvitation {
  workspaceId: string
  workspaceName: string
  permission: 'admin' | 'write' | 'read'
}

export async function renderOTPEmail(
  otp: string,
  email: string,
  type:
    | 'sign-in'
    | 'email-verification'
    | 'change-email'
    | 'forget-password' = 'email-verification',
  chatTitle?: string
): Promise<string> {
  return await render(OTPVerificationEmail({ otp, email, type, chatTitle }))
}

export async function renderExistingAccountEmail(username: string): Promise<string> {
  return await render(ExistingAccountEmail({ username }))
}

export async function renderPasswordResetEmail(
  username: string,
  resetLink: string
): Promise<string> {
  return await render(ResetPasswordEmail({ username, resetLink }))
}

export async function renderInvitationEmail(
  inviterName: string,
  organizationName: string,
  invitationUrl: string
): Promise<string> {
  return await render(
    InvitationEmail({
      inviterName,
      organizationName,
      inviteLink: invitationUrl,
    })
  )
}

export async function renderBatchInvitationEmail(
  inviterName: string,
  organizationName: string,
  organizationRole: 'admin' | 'member',
  workspaceInvitations: WorkspaceInvitation[],
  acceptUrl: string
): Promise<string> {
  return await render(
    BatchInvitationEmail({
      inviterName,
      organizationName,
      organizationRole,
      workspaceInvitations,
      acceptUrl,
    })
  )
}

export async function renderEnterpriseOwnerInvitationEmail(
  organizationName: string,
  inviteLink: string,
  expiresInDays: number
): Promise<string> {
  return await render(
    EnterpriseOwnerInvitationEmail({ organizationName, inviteLink, expiresInDays })
  )
}

export async function renderHelpConfirmationEmail(
  type: 'bug' | 'feedback' | 'feature_request' | 'other',
  attachmentCount = 0
): Promise<string> {
  return await render(
    HelpConfirmationEmail({
      type,
      attachmentCount,
      submittedDate: new Date(),
    })
  )
}

export async function renderPermissionAccessRequestEmail(params: {
  kind: 'created' | 'decided'
  requestLink: string
}): Promise<string> {
  return await render(PermissionAccessRequestEmail(params))
}

export async function renderScheduleDisabledEmail(params: {
  recipientName?: string
  resourceName?: string
  reason: ScheduleDisableReason
  failedCount?: number
  manageLink?: string
}): Promise<string> {
  return await render(ScheduleDisabledEmail(params))
}

export async function renderSubprocessorChangeEmail(params: {
  recipientName?: string
  changes: SubprocessorChange[]
  effectiveDate: Date
  objectionDeadline: Date
  objectionEmail: string
  subprocessorListUrl: string
  subscriptionUrl?: string
}): Promise<string> {
  return await render(SubprocessorChangeEmail(params))
}

export async function renderWelcomeEmail(userName?: string): Promise<string> {
  return await render(WelcomeEmail({ userName }))
}

export async function renderOnboardingFollowupEmail(userName?: string): Promise<string> {
  return await render(OnboardingFollowupEmail({ userName }))
}

export async function renderWorkspaceInvitationEmail(
  inviterName: string,
  workspaceNames: string[],
  invitationLink: string
): Promise<string> {
  return await render(
    WorkspaceInvitationEmail({
      inviterName,
      workspaceNames,
      invitationLink,
    })
  )
}

export async function renderWorkspaceAddedEmail(
  inviterName: string,
  workspaceName: string,
  workspaceLink: string
): Promise<string> {
  return await render(
    WorkspaceAddedEmail({
      inviterName,
      workspaceName,
      workspaceLink,
    })
  )
}
