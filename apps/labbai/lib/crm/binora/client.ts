import { getErrorMessage } from '@labbai/utils/errors'
import { toRecord } from '@labbai/utils/object'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { type BinoraEvent, signBinoraRequest } from '@/lib/crm/binora/protocol'

/** Short on purpose: a slow CRM must cost a retry, never hold an Inbox write or a worker. */
const BINORA_TIMEOUT_MS = 10_000

/** Binora answers with a small JSON object; anything larger is not Binora. */
const BINORA_MAX_RESPONSE_BYTES = 256 * 1024

const USER_AGENT = 'Labbai-CRM/1.0'

/** Binora could not be reached or did not accept the request. */
export class BinoraRequestError extends Error {
  /** HTTP status Binora answered with; null when it was not reached at all. */
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'BinoraRequestError'
    this.status = status
  }

  /**
   * Binora refused this exact request for good (a malformed event): retrying the same body
   * cannot succeed. Signature, missing-channel and rate errors are the link's, not the event's.
   */
  get isPermanentRejection(): boolean {
    return this.status === 400 || this.status === 413 || this.status === 422
  }
}

/** The channel address a link stores, without a trailing slash or a pasted `/events`. */
export function normalizeBinoraBaseUrl(value: string): string {
  let url = value.trim().replace(/\/+$/, '')
  for (const suffix of ['/events', '/connect']) {
    if (url.endsWith(suffix)) url = url.slice(0, -suffix.length)
  }
  return url
}

async function postToBinora(
  baseUrl: string,
  secret: string,
  path: 'connect' | 'events',
  payload: unknown
): Promise<Record<string, unknown>> {
  const body = JSON.stringify(payload)
  let response: Awaited<ReturnType<typeof secureFetchWithValidation>>
  try {
    response = await secureFetchWithValidation(
      `${baseUrl}/${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          ...signBinoraRequest(secret, body),
        },
        body,
        timeout: BINORA_TIMEOUT_MS,
        maxRedirects: 0,
        maxResponseBytes: BINORA_MAX_RESPONSE_BYTES,
        profile: 'configuredEndpoint',
      },
      'Binora address'
    )
  } catch (error) {
    throw new BinoraRequestError(`Binora is not reachable: ${getErrorMessage(error)}`, null)
  }

  let data: Record<string, unknown> = {}
  try {
    data = toRecord(await response.json())
  } catch {
    data = {}
  }
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : ''
    throw new BinoraRequestError(
      `Binora answered HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      response.status
    )
  }
  return data
}

/** What Binora reports about the channel on a successful handshake. */
export interface BinoraConnectResult {
  channelName: string | null
  pipelineName: string | null
}

/** Runs the signed handshake and tells Binora where operator replies go. */
export async function connectBinoraChannel(params: {
  baseUrl: string
  secret: string
  callbackUrl: string
  agentName: string
}): Promise<BinoraConnectResult> {
  const data = await postToBinora(params.baseUrl, params.secret, 'connect', {
    callbackUrl: params.callbackUrl,
    agentName: params.agentName,
  })
  return {
    channelName: typeof data.channel === 'string' && data.channel ? data.channel : null,
    pipelineName: typeof data.pipeline === 'string' && data.pipeline ? data.pipeline : null,
  }
}

/** Reports one message or state change of a mirrored chat. */
export async function postBinoraEvent(params: {
  baseUrl: string
  secret: string
  event: BinoraEvent
}): Promise<void> {
  await postToBinora(params.baseUrl, params.secret, 'events', params.event)
}
