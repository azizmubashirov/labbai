import { NextResponse } from 'next/server'
import { speechTokenContract } from '@/lib/api/contracts/media/speech'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { NoWorkspaceAccessError } from '@/lib/core/application/workspace-authorization'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  createSpeechToken,
  SpeechTokenError,
  speechTokenOperation,
} from '@/lib/speech/application/create-token'

export const dynamic = 'force-dynamic'

export const POST = defineInternalJsonRoute({
  contract: speechTokenContract,
  auth: internalSessionAuth,
  operation: speechTokenOperation,
  rateLimit: internalRateLimits.none({
    reason: 'Voice tokens are not rate limited: Labbai has no plan-based limits.',
  }),
  parseOptions: {
    maxBodyBytes: 16 * 1024,
    validationErrorResponse: () =>
      NextResponse.json(
        { error: 'Workspace or organization context is required.' },
        { status: 400 }
      ),
  },
  errorPolicy: {
    project(error) {
      if (error instanceof SpeechTokenError) {
        const status = { usage_limit: 402, unconfigured: 503, provider_failed: 502 }[error.reason]
        return internalErrorResponse(status, { error: error.message, scope: error.scope })
      }
      const classified = asOrchestrationError(error)
      if (error instanceof NoWorkspaceAccessError || classified?.code === 'not_found') {
        return internalErrorResponse(400, {
          error: 'Workspace or organization context is required.',
        })
      }
      return null
    },
    unhandled: () => internalErrorResponse(500, { error: 'Failed to generate speech token' }),
  },
  mapInput: ({ body }) => body,
  useCase: createSpeechToken,
})
