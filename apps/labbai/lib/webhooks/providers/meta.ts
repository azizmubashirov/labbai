import { db, workflowDeploymentVersion } from '@labbai/db'
import { webhook, workflow } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { safeCompare } from '@labbai/security/compare'
import { hmacSha256Hex } from '@labbai/security/hmac'
import { toError } from '@labbai/utils/errors'
import { isRecordLike } from '@labbai/utils/object'
import { and, eq, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { resolveBackgroundWebhookEnv } from '@/lib/webhooks/env-resolver'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'

const logger = createLogger('WebhookProvider:Meta')

/** Meta platforms whose webhooks share the `hub.*` handshake and `X-Hub-Signature-256` signing. */
export type MetaWebhookProvider = 'whatsapp' | 'instagram'

const PROVIDER_LABELS: Record<MetaWebhookProvider, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
}

/** Validates a Meta `X-Hub-Signature-256` header (`sha256=<hex>`) against the raw request body. */
export function validateMetaSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!signature.startsWith('sha256=')) {
      logger.warn('Meta webhook signature has invalid format')
      return false
    }
    return safeCompare(hmacSha256Hex(body, secret), signature.substring(7))
  } catch (error) {
    logger.error('Error validating Meta webhook signature:', error)
    return false
  }
}

/**
 * Checks a POST against the app secret stored on the trigger. Returns a 401 response when the
 * secret is missing or the signature does not match, or null when the request is authentic.
 */
export function verifyMetaWebhookAuth(
  provider: MetaWebhookProvider,
  request: Request,
  rawBody: string,
  requestId: string,
  providerConfig: Record<string, unknown>
): NextResponse | null {
  const label = PROVIDER_LABELS[provider]
  const appSecret = typeof providerConfig.appSecret === 'string' ? providerConfig.appSecret : ''
  if (!appSecret) {
    logger.warn(`[${requestId}] ${label} webhook missing appSecret in providerConfig`)
    return new NextResponse(`Unauthorized - ${label} app secret not configured`, { status: 401 })
  }

  const signature = request.headers.get('x-hub-signature-256')
  if (!signature) {
    logger.warn(`[${requestId}] ${label} webhook missing signature header`)
    return new NextResponse(`Unauthorized - Missing ${label} signature`, { status: 401 })
  }

  if (!validateMetaSignature(appSecret, signature, rawBody)) {
    logger.warn(`[${requestId}] ${label} signature verification failed`)
    return new NextResponse(`Unauthorized - Invalid ${label} signature`, { status: 401 })
  }

  return null
}

/**
 * Resolves `{{VAR}}` references in a stored verify token against the same background env the
 * signed delivery is checked with, so a token kept in workspace secrets passes the handshake.
 * Returns an empty string when a reference cannot be resolved, which fails the comparison.
 */
async function resolveVerificationToken(
  configuredToken: string,
  row: { workflowOwnerId: string; workspaceId: string | null },
  requestId: string
): Promise<string> {
  if (!configuredToken.includes('{{')) return configuredToken
  try {
    const envVars = await resolveBackgroundWebhookEnv(
      row.workflowOwnerId,
      row.workspaceId ?? undefined
    )
    const resolved = resolveEnvVarReferences(configuredToken, envVars)
    return typeof resolved === 'string' && !resolved.includes('{{') ? resolved : ''
  } catch (error) {
    logger.warn(`[${requestId}] Failed to resolve Meta webhook verify token`, {
      error: toError(error).message,
    })
    return ''
  }
}

/**
 * Answers Meta's subscription handshake (`GET ?hub.mode=subscribe&hub.verify_token&hub.challenge`)
 * by matching the token against the active webhooks of `provider` on `path`. Returns null when
 * the request is not a handshake, or when no webhook on the path expects a token, so ownership of
 * foreign `hub.*` parameters stays with whoever owns the path.
 */
export async function handleMetaVerification(
  provider: MetaWebhookProvider,
  request: NextRequest,
  requestId: string,
  path: string
): Promise<NextResponse | null> {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  if (!mode || !token || !challenge) return null

  logger.info(`[${requestId}] ${provider} verification request received for path: ${path}`)
  if (mode !== 'subscribe') {
    logger.warn(`[${requestId}] Invalid ${provider} verification mode: ${mode}`)
    return new NextResponse('Invalid mode', { status: 400 })
  }

  const rows = await db
    .select({ webhook, workflowOwnerId: workflow.userId, workspaceId: workflow.workspaceId })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .leftJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.workflowId, webhook.workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .where(
      and(
        eq(webhook.provider, provider),
        eq(webhook.path, path),
        eq(webhook.isActive, true),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )

  let candidates = 0
  for (const row of rows) {
    const providerConfig = isRecordLike(row.webhook.providerConfig)
      ? (row.webhook.providerConfig as Record<string, unknown>)
      : {}
    const configuredToken = providerConfig.verificationToken
    if (typeof configuredToken !== 'string' || !configuredToken) continue
    candidates++
    const verificationToken = await resolveVerificationToken(configuredToken, row, requestId)
    if (verificationToken && safeCompare(token, verificationToken)) {
      logger.info(
        `[${requestId}] ${provider} verification successful for webhook ${row.webhook.id}`
      )
      return new NextResponse(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }
  }

  if (candidates === 0) return null

  logger.warn(`[${requestId}] No matching ${provider} verification token found`)
  return new NextResponse('Verification failed', { status: 403 })
}
