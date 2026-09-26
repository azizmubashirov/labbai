import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { airtableHandler } from '@/lib/webhooks/providers/airtable'
import { calcomHandler } from '@/lib/webhooks/providers/calcom'
import { calendlyHandler } from '@/lib/webhooks/providers/calendly'
import { credentialGroupProviderHandler } from '@/lib/webhooks/providers/credential-group'
import { genericHandler } from '@/lib/webhooks/providers/generic'
import { gmailHandler } from '@/lib/webhooks/providers/gmail'
import { googleFormsHandler } from '@/lib/webhooks/providers/google-forms'
import { imapHandler } from '@/lib/webhooks/providers/imap'
import { instagramHandler } from '@/lib/webhooks/providers/instagram'
import { notionHandler } from '@/lib/webhooks/providers/notion'
import { rssHandler } from '@/lib/webhooks/providers/rss'
import { tableProviderHandler } from '@/lib/webhooks/providers/table'
import { telegramHandler } from '@/lib/webhooks/providers/telegram'
import { twilioHandler } from '@/lib/webhooks/providers/twilio'
import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { verifyTokenAuth } from '@/lib/webhooks/providers/utils'
import { whatsappHandler } from '@/lib/webhooks/providers/whatsapp'
import { zoomHandler } from '@/lib/webhooks/providers/zoom'

const logger = createLogger('WebhookProviderRegistry')

const PROVIDER_HANDLERS: Record<string, WebhookProviderHandler> = {
  airtable: airtableHandler,
  calendly: calendlyHandler,
  calcom: calcomHandler,
  'credential-group': credentialGroupProviderHandler,
  generic: genericHandler,
  gmail: gmailHandler,
  google_forms: googleFormsHandler,
  imap: imapHandler,
  instagram: instagramHandler,
  notion: notionHandler,
  rss: rssHandler,
  table: tableProviderHandler,
  telegram: telegramHandler,
  twilio: twilioHandler,
  whatsapp: whatsappHandler,
  zoom: zoomHandler,
}

/**
 * Default handler for unknown/future providers.
 * Uses timing-safe comparison for bearer token validation.
 */
const defaultHandler: WebhookProviderHandler = {
  verifyAuth({ request, requestId, providerConfig }) {
    const token = providerConfig.token
    if (typeof token === 'string') {
      if (!verifyTokenAuth(request, token)) {
        logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
        return new NextResponse('Unauthorized', { status: 401 })
      }
    }
    return null
  },
}

/** Look up the provider handler, falling back to the default bearer token handler. */
export function getProviderHandler(provider: string): WebhookProviderHandler {
  return PROVIDER_HANDLERS[provider] ?? defaultHandler
}
