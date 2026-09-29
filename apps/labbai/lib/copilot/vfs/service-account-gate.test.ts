/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBlock } = vi.hoisted(() => ({ mockGetBlock: vi.fn() }))
vi.mock('@/blocks', () => ({ getBlock: mockGetBlock }))

import { describeServiceAccountForOAuthProvider } from '@/lib/copilot/vfs/serializers'

describe('describeServiceAccountForOAuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes an ungated provider without consulting the block registry', () => {
    expect(describeServiceAccountForOAuthProvider('notion')).toEqual({
      connectNoun: 'integration secret',
    })
    expect(mockGetBlock).not.toHaveBeenCalled()
  })

  it('returns undefined for a provider with no service-account flow', () => {
    expect(describeServiceAccountForOAuthProvider('wordpress')).toBeUndefined()
  })
})
