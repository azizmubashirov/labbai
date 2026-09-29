/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { smtpSendMailTool } from '@/tools/smtp/send_mail'

describe('mail submission operation declarations', () => {
  it.each([smtpSendMailTool])('$id has operation input without HTTP metadata', (tool) => {
    expect(tool.operation.input).toBeTypeOf('function')
    expect('request' in tool).toBe(false)
  })
})
