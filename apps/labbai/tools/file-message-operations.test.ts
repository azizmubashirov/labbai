/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@labbai/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operations = vi.hoisted(() => ({
  pipedrive: vi.fn(),
}))

vi.mock('@/lib/internal/pipedrive/operations', () => ({
  executePipedriveGetFiles: operations.pipedrive,
}))

import { PipedriveOperationError } from '@/lib/internal/pipedrive/errors'
import { executePipedriveTool } from '@/lib/internal/pipedrive/execute-tool'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'
import { pipedriveGetFilesTool } from '@/tools/pipedrive/get_files'

const CASES: Array<{
  execute: InternalToolOperationHandler
  input: Record<string, unknown>
  operation: ReturnType<typeof vi.fn>
  toolId: string
}> = [
  {
    toolId: 'pipedrive_get_files',
    execute: executePipedriveTool,
    operation: operations.pipedrive,
    input: { accessToken: 'token', downloadFiles: false },
  },
]

function request(
  toolId: string,
  input: unknown,
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId,
    input,
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('file and message operation declarations', () => {
  it.each([pipedriveGetFilesTool])(
    '$id uses typed operation input without HTTP metadata',
    (tool) => {
      expect(tool.operation.input).toBeTypeOf('function')
      expect('request' in tool).toBe(false)
    }
  )
})

describe('file and message direct handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const operation of Object.values(operations)) {
      operation.mockResolvedValue({ success: true, output: {} })
    }
  })

  it.each(CASES)('dispatches $toolId with trusted context and cancellation', async (testCase) => {
    const controller = new AbortController()
    const response = await testCase.execute(
      request(testCase.toolId, testCase.input, { signal: controller.signal })
    )

    expect(response.status).toBe(200)
    expect(testCase.operation).toHaveBeenCalledWith(
      expect.objectContaining(testCase.input),
      expect.objectContaining({ requestId: 'request-1', signal: controller.signal })
    )
  })

  it.each(CASES)('authenticates $toolId before operation input parsing', async (testCase) => {
    const response = await testCase.execute(
      request(testCase.toolId, null, { context: createExecutionContext() })
    )

    expect(response.status).toBe(401)
    expect(testCase.operation).not.toHaveBeenCalled()
  })

  it.each(CASES)('does no $toolId provider work after cancellation', async (testCase) => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      testCase.execute(request(testCase.toolId, testCase.input, { signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(testCase.operation).not.toHaveBeenCalled()
  })

  it.each([[CASES[0], new PipedriveOperationError('pipedrive failure', 400)]])(
    'preserves exact $0.toolId operation error status and body',
    async (testCase, error) => {
      testCase.operation.mockRejectedValueOnce(error)
      const response = await testCase.execute(request(testCase.toolId, testCase.input))

      expect(response.status).toBe(error.status)
      await expect(response.json()).resolves.toEqual({ success: false, error: error.message })
    }
  )
})
