/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildRoundCapPauseMessage,
  isContinueRequest,
  isRoundCapPauseMessage,
} from '@/local-copilot/lib/user-facing-text'

describe('round-cap pause helpers', () => {
  it('recognizes its own pause reply inside a longer assistant message', () => {
    expect(isRoundCapPauseMessage(`Created the workflow.\n\n${buildRoundCapPauseMessage()}`)).toBe(
      true
    )
    expect(isRoundCapPauseMessage('Done. Anything else?')).toBe(false)
  })

  it.each(['Continue', 'continue please', 'Go on', 'yes', 'OK.', 'davom et', 'Продолжай', 'да'])(
    'treats "%s" as a request to continue',
    (message) => {
      expect(isContinueRequest(message)).toBe(true)
    }
  )

  it.each(['Stop', 'build a new workflow', 'hammer time', '', 'continue'.repeat(20)])(
    'does not treat "%s" as a request to continue',
    (message) => {
      expect(isContinueRequest(message)).toBe(false)
    }
  )
})
