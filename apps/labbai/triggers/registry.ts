import { airtableWebhookTrigger } from '@/triggers/airtable'
import {
  calcomBookingCancelledTrigger,
  calcomBookingCreatedTrigger,
  calcomBookingPaidTrigger,
  calcomBookingRejectedTrigger,
  calcomBookingRequestedTrigger,
  calcomBookingRescheduledTrigger,
  calcomMeetingEndedTrigger,
  calcomRecordingReadyTrigger,
  calcomWebhookTrigger,
} from '@/triggers/calcom'
import {
  calendlyInviteeCanceledTrigger,
  calendlyInviteeCreatedTrigger,
  calendlyRoutingFormSubmittedTrigger,
  calendlyWebhookTrigger,
} from '@/triggers/calendly'
import { credentialGroupEventTrigger } from '@/triggers/credential-group'
import { genericWebhookTrigger } from '@/triggers/generic'
import { gmailPollingTrigger } from '@/triggers/gmail'
import { googleCalendarPollingTrigger } from '@/triggers/google-calendar'
import { googleDrivePollingTrigger } from '@/triggers/google-drive'
import { googleSheetsPollingTrigger } from '@/triggers/google-sheets'
import { googleFormsWebhookTrigger } from '@/triggers/googleforms'
import { hubspotPollingTrigger } from '@/triggers/hubspot'
import { imapPollingTrigger } from '@/triggers/imap'
import { instagramWebhookTrigger } from '@/triggers/instagram'
import {
  notionCommentCreatedTrigger,
  notionDatabaseCreatedTrigger,
  notionDatabaseDeletedTrigger,
  notionDatabaseSchemaUpdatedTrigger,
  notionPageContentUpdatedTrigger,
  notionPageCreatedTrigger,
  notionPageDeletedTrigger,
  notionPagePropertiesUpdatedTrigger,
  notionWebhookTrigger,
} from '@/triggers/notion'
import { rssPollingTrigger } from '@/triggers/rss'
import { labbaiWorkspaceEventTrigger } from '@/triggers/sim'
import { tableNewRowTrigger } from '@/triggers/table'
import { telegramWebhookTrigger } from '@/triggers/telegram'
import { twilioSmsReceivedTrigger, twilioSmsStatusTrigger } from '@/triggers/twilio'
import type { TriggerRegistry } from '@/triggers/types'
import { whatsappWebhookTrigger } from '@/triggers/whatsapp'
import {
  zoomMeetingEndedTrigger,
  zoomMeetingStartedTrigger,
  zoomParticipantJoinedTrigger,
  zoomParticipantLeftTrigger,
  zoomRecordingCompletedTrigger,
  zoomWebhookTrigger,
} from '@/triggers/zoom'

export const TRIGGER_REGISTRY: TriggerRegistry = {
  airtable_webhook: airtableWebhookTrigger,
  calendly_webhook: calendlyWebhookTrigger,
  calendly_invitee_created: calendlyInviteeCreatedTrigger,
  calendly_invitee_canceled: calendlyInviteeCanceledTrigger,
  calendly_routing_form_submitted: calendlyRoutingFormSubmittedTrigger,
  calcom_booking_created: calcomBookingCreatedTrigger,
  calcom_booking_cancelled: calcomBookingCancelledTrigger,
  calcom_booking_rescheduled: calcomBookingRescheduledTrigger,
  calcom_booking_requested: calcomBookingRequestedTrigger,
  calcom_booking_rejected: calcomBookingRejectedTrigger,
  calcom_booking_paid: calcomBookingPaidTrigger,
  calcom_meeting_ended: calcomMeetingEndedTrigger,
  calcom_recording_ready: calcomRecordingReadyTrigger,
  calcom_webhook: calcomWebhookTrigger,
  credential_group_event: credentialGroupEventTrigger,
  generic_webhook: genericWebhookTrigger,
  gmail_poller: gmailPollingTrigger,
  google_calendar_poller: googleCalendarPollingTrigger,
  google_drive_poller: googleDrivePollingTrigger,
  google_sheets_poller: googleSheetsPollingTrigger,
  notion_page_created: notionPageCreatedTrigger,
  notion_page_properties_updated: notionPagePropertiesUpdatedTrigger,
  notion_page_content_updated: notionPageContentUpdatedTrigger,
  notion_page_deleted: notionPageDeletedTrigger,
  notion_database_created: notionDatabaseCreatedTrigger,
  notion_database_schema_updated: notionDatabaseSchemaUpdatedTrigger,
  notion_database_deleted: notionDatabaseDeletedTrigger,
  notion_comment_created: notionCommentCreatedTrigger,
  notion_webhook: notionWebhookTrigger,
  rss_poller: rssPollingTrigger,
  sim_workspace_event: labbaiWorkspaceEventTrigger,
  table_new_row: tableNewRowTrigger,
  telegram_webhook: telegramWebhookTrigger,
  whatsapp_webhook: whatsappWebhookTrigger,
  instagram_webhook: instagramWebhookTrigger,
  google_forms_webhook: googleFormsWebhookTrigger,
  hubspot_poller: hubspotPollingTrigger,
  imap_poller: imapPollingTrigger,
  zoom_meeting_started: zoomMeetingStartedTrigger,
  zoom_meeting_ended: zoomMeetingEndedTrigger,
  zoom_participant_joined: zoomParticipantJoinedTrigger,
  zoom_participant_left: zoomParticipantLeftTrigger,
  zoom_recording_completed: zoomRecordingCompletedTrigger,
  zoom_webhook: zoomWebhookTrigger,
  twilio_sms_received: twilioSmsReceivedTrigger,
  twilio_sms_status: twilioSmsStatusTrigger,
}
