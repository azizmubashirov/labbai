/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  canResendEnrollment,
  describeEnrollmentStatus,
  getProviderLabel,
  isOptionSetupIncomplete,
} from '@/components/settings/credential-groups/labels'

describe('credential group labels', () => {
  it('describes enrollment states, with expiry overriding pending states', () => {
    expect(describeEnrollmentStatus({ status: 'completed', expired: false }).label).toBe(
      'Connected'
    )
    expect(describeEnrollmentStatus({ status: 'invited', expired: true }).label).toBe('Expired')
    expect(describeEnrollmentStatus({ status: 'invited', expired: false }).label).toBe('Invited')
    expect(describeEnrollmentStatus({ status: 'delivery_failed', expired: false }).tone).toBe('red')
  })

  it('only resends unfinished requests', () => {
    expect(canResendEnrollment({ status: 'invited' })).toBe(true)
    expect(canResendEnrollment({ status: 'completed' })).toBe(false)
    expect(canResendEnrollment({ status: 'revoked' })).toBe(false)
  })

  it('treats only unfinished configuration as blocking', () => {
    expect(isOptionSetupIncomplete(undefined)).toBe(false)
    expect(isOptionSetupIncomplete({ configurationStatus: 'ready' })).toBe(false)
    expect(isOptionSetupIncomplete({ configurationStatus: 'needs_update' })).toBe(true)
  })

  it('labels managed MCP connectors and unknown providers', () => {
    expect(getProviderLabel('fireflies')).toBe('Fireflies')
    expect(getProviderLabel('gitlab')).toBe('GitLab')
    expect(getProviderLabel('unknown-provider')).toBe('unknown-provider')
  })
})
