/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@labbai/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resend: vi.fn(), sendGrid: vi.fn(), smtp: vi.fn() }))
vi.mock('@/lib/internal/smtp/operations', () => ({ executeSmtpSend: mocks.smtp }))

import { executeSmtpTool } from '@/lib/internal/smtp/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(toolId: string, input: unknown, userId = 'user-1') {
  return {
    toolId,
    input,
    headers: new Headers(),
    context: { ...createExecutionContext({ workflowId: 'workflow-1' }), userId },
    requestId: 'request-1',
  } as InternalToolOperationCall
}

describe('mail submission handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resend.mockResolvedValue({ success: true, data: { id: 'resend-1' } })
    mocks.sendGrid.mockResolvedValue({ success: true, output: { success: true } })
    mocks.smtp.mockResolvedValue({ success: true, messageId: 'smtp-1' })
  })

  it.each([['smtp_send_mail', executeSmtpTool]])(
    'authenticates %s before parsing',
    async (toolId, execute) => {
      const response = await execute(request(toolId, null, ''))
      expect(response.status).toBe(401)
      expect(mocks.resend).not.toHaveBeenCalled()
      expect(mocks.sendGrid).not.toHaveBeenCalled()
      expect(mocks.smtp).not.toHaveBeenCalled()
    }
  )
})
