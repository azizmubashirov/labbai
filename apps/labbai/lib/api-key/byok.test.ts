/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  hasMockCondition,
  resetDbChainMock,
  resetEnvMock,
  schemaMock,
  setEnv,
} from '@labbai/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptSecret, mockIsOrganizationBYOKEntitled, mockGetRotatingApiKey } = vi.hoisted(
  () => ({
    mockDecryptSecret: vi.fn(),
    mockIsOrganizationBYOKEntitled: vi.fn(),
    mockGetRotatingApiKey: vi.fn(),
  })
)

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@/lib/api-key/byok-entitlement', () => ({
  isOrganizationBYOKEntitledCached: mockIsOrganizationBYOKEntitled,
}))

vi.mock('@/lib/core/config/api-keys', () => ({
  getRotatingApiKey: mockGetRotatingApiKey,
}))

import { getApiKeyWithBYOK, getBYOKKey } from '@/lib/api-key/byok'

/**
 * Rotation counters persist for the process lifetime, so each test uses
 * unique workspace and organization ids to start from fresh cursors.
 */
let testIndex = 0
const uniqueWorkspaceId = () => `workspace-${++testIndex}`
const uniqueOrganizationId = () => `organization-${++testIndex}`

const storedKey = (id: string) => ({ id, encryptedApiKey: `encrypted-${id}` })
const storedOrganizationKey = (organizationId: string, id: string) => ({
  organizationId,
  ...storedKey(id),
})

afterAll(resetDbChainMock)

describe('getBYOKKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockDecryptSecret.mockImplementation(async (encrypted: string) => ({
      decrypted: encrypted.replace('encrypted-', 'decrypted-'),
    }))
    mockIsOrganizationBYOKEntitled.mockResolvedValue(true)
  })

  it('returns null when no workspaceId is provided', async () => {
    expect(await getBYOKKey(undefined, 'firecrawl')).toBeNull()
    expect(await getBYOKKey(null, 'firecrawl')).toBeNull()
  })

  it('returns null when neither the workspace nor its organization has provider keys', async () => {
    expect(await getBYOKKey(uniqueWorkspaceId(), 'firecrawl')).toBeNull()
    expect(dbChainMockFns.orderBy).toHaveBeenCalledTimes(2)
    expect(mockIsOrganizationBYOKEntitled).not.toHaveBeenCalled()
  })

  it('returns the same key on every call when only one key is stored', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1')])

    for (let call = 0; call < 3; call++) {
      expect(await getBYOKKey(workspaceId, 'firecrawl')).toEqual({
        apiKey: 'decrypted-key-1',
        isBYOK: true,
        scope: 'workspace',
      })
    }
  })

  it('round-robins across multiple keys in creation order', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([
      storedKey('key-1'),
      storedKey('key-2'),
      storedKey('key-3'),
    ])

    const apiKeys = []
    for (let call = 0; call < 4; call++) {
      const result = await getBYOKKey(workspaceId, 'firecrawl')
      apiKeys.push(result?.apiKey)
    }

    expect(apiKeys).toEqual([
      'decrypted-key-1',
      'decrypted-key-2',
      'decrypted-key-3',
      'decrypted-key-1',
    ])
  })

  it('reads the key list fresh from the database on every call', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1')])

    await getBYOKKey(workspaceId, 'firecrawl')
    await getBYOKKey(workspaceId, 'firecrawl')
    await getBYOKKey(workspaceId, 'firecrawl')

    expect(dbChainMockFns.orderBy).toHaveBeenCalledTimes(3)
  })

  it('tracks rotation independently per provider within a workspace', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1'), storedKey('key-2')])

    expect((await getBYOKKey(workspaceId, 'firecrawl'))?.apiKey).toBe('decrypted-key-1')
    expect((await getBYOKKey(workspaceId, 'exa'))?.apiKey).toBe('decrypted-key-1')
    expect((await getBYOKKey(workspaceId, 'firecrawl'))?.apiKey).toBe('decrypted-key-2')
  })

  it('skips a key that fails to decrypt and returns the next one', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1'), storedKey('key-2')])
    mockDecryptSecret.mockImplementation(async (encrypted: string) => {
      if (encrypted === 'encrypted-key-1') {
        throw new Error('corrupt ciphertext')
      }
      return { decrypted: encrypted.replace('encrypted-', 'decrypted-') }
    })

    expect(await getBYOKKey(workspaceId, 'firecrawl')).toEqual({
      apiKey: 'decrypted-key-2',
      isBYOK: true,
      scope: 'workspace',
    })
  })

  it('returns null when every key fails to decrypt', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('key-1'), storedKey('key-2')])
    mockDecryptSecret.mockRejectedValue(new Error('corrupt ciphertext'))

    expect(await getBYOKKey(workspaceId, 'firecrawl')).toBeNull()
    expect(dbChainMockFns.innerJoin).not.toHaveBeenCalled()
    expect(mockIsOrganizationBYOKEntitled).not.toHaveBeenCalled()
  })

  it('returns null when the keys query throws', async () => {
    dbChainMockFns.orderBy.mockRejectedValue(new Error('database unavailable'))

    expect(await getBYOKKey(uniqueWorkspaceId(), 'firecrawl')).toBeNull()
    expect(dbChainMockFns.innerJoin).not.toHaveBeenCalled()
    expect(mockIsOrganizationBYOKEntitled).not.toHaveBeenCalled()
  })

  it('inherits an entitled organization key only after the workspace provider pool is absent', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-key-1')])

    await expect(getBYOKKey(workspaceId, 'firecrawl')).resolves.toEqual({
      apiKey: 'decrypted-org-key-1',
      isBYOK: true,
      scope: 'organization',
    })

    expect(dbChainMockFns.innerJoin).toHaveBeenCalledWith(
      schemaMock.organizationBYOKKeys,
      expect.anything()
    )
    expect(mockIsOrganizationBYOKEntitled).toHaveBeenCalledWith(organizationId)
    expect(mockIsOrganizationBYOKEntitled.mock.invocationCallOrder[0]).toBeLessThan(
      mockDecryptSecret.mock.invocationCallOrder[0]
    )

    const outerWhere = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(
      hasMockCondition(
        outerWhere,
        (node) =>
          node.type === 'eq' && node.left === schemaMock.workspace.id && node.right === workspaceId
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        outerWhere,
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.organizationBYOKKeys.providerId &&
          node.right === 'firecrawl'
      )
    ).toBe(true)
    expect(hasMockCondition(outerWhere, (node) => node.type === 'notExists')).toBe(true)

    const localOverrideWhere = dbChainMockFns.where.mock.calls.at(-2)?.[0]
    expect(
      hasMockCondition(
        localOverrideWhere,
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.workspaceBYOKKeys.workspaceId &&
          node.right === schemaMock.workspace.id
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        localOverrideWhere,
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.workspaceBYOKKeys.providerId &&
          node.right === 'firecrawl'
      )
    ).toBe(true)
  })

  it('uses a nonempty workspace pool exclusively without querying organization keys', async () => {
    const workspaceId = uniqueWorkspaceId()
    dbChainMockFns.orderBy.mockResolvedValue([storedKey('workspace-key')])

    await expect(getBYOKKey(workspaceId, 'firecrawl')).resolves.toEqual({
      apiKey: 'decrypted-workspace-key',
      isBYOK: true,
      scope: 'workspace',
    })

    expect(dbChainMockFns.orderBy).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.innerJoin).not.toHaveBeenCalled()
    expect(mockIsOrganizationBYOKEntitled).not.toHaveBeenCalled()
  })

  it('keeps provider overrides isolated within the same workspace', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([storedKey('workspace-firecrawl')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-exa')])

    await expect(getBYOKKey(workspaceId, 'firecrawl')).resolves.toEqual({
      apiKey: 'decrypted-workspace-firecrawl',
      isBYOK: true,
      scope: 'workspace',
    })
    await expect(getBYOKKey(workspaceId, 'exa')).resolves.toEqual({
      apiKey: 'decrypted-org-exa',
      isBYOK: true,
      scope: 'organization',
    })

    expect(mockIsOrganizationBYOKEntitled).toHaveBeenCalledTimes(1)
    expect(mockIsOrganizationBYOKEntitled).toHaveBeenCalledWith(organizationId)
  })

  it('fails closed before decrypting when organization entitlement is false', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-key')])
    mockIsOrganizationBYOKEntitled.mockResolvedValue(false)

    await expect(getBYOKKey(workspaceId, 'firecrawl')).resolves.toBeNull()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('fails closed before decrypting when organization entitlement throws', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-key')])
    mockIsOrganizationBYOKEntitled.mockRejectedValue(new Error('entitlement unavailable'))

    await expect(getBYOKKey(workspaceId, 'firecrawl')).resolves.toBeNull()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('does not advance organization rotation while entitlement is denied', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    const organizationPool = [
      storedOrganizationKey(organizationId, 'org-key-1'),
      storedOrganizationKey(organizationId, 'org-key-2'),
    ]
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(organizationPool)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(organizationPool)
    mockIsOrganizationBYOKEntitled.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(getBYOKKey(workspaceId, 'firecrawl')).resolves.toBeNull()
    await expect(getBYOKKey(workspaceId, 'firecrawl')).resolves.toEqual({
      apiKey: 'decrypted-org-key-1',
      isBYOK: true,
      scope: 'organization',
    })
  })

  it('returns null when the organization key query throws', async () => {
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('organization keys unavailable'))

    await expect(getBYOKKey(uniqueWorkspaceId(), 'firecrawl')).resolves.toBeNull()
    expect(mockIsOrganizationBYOKEntitled).not.toHaveBeenCalled()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('returns null when every organization key fails to decrypt', async () => {
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        storedOrganizationKey(organizationId, 'org-key-1'),
        storedOrganizationKey(organizationId, 'org-key-2'),
      ])
    mockDecryptSecret.mockRejectedValue(new Error('corrupt organization ciphertext'))

    await expect(getBYOKKey(uniqueWorkspaceId(), 'firecrawl')).resolves.toBeNull()
    expect(mockDecryptSecret).toHaveBeenCalledTimes(2)
  })

  it('shares organization rotation across member workspaces', async () => {
    const organizationId = uniqueOrganizationId()
    const organizationPool = [
      storedOrganizationKey(organizationId, 'org-key-1'),
      storedOrganizationKey(organizationId, 'org-key-2'),
    ]
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(organizationPool)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(organizationPool)

    await expect(getBYOKKey(uniqueWorkspaceId(), 'firecrawl')).resolves.toEqual({
      apiKey: 'decrypted-org-key-1',
      isBYOK: true,
      scope: 'organization',
    })
    await expect(getBYOKKey(uniqueWorkspaceId(), 'firecrawl')).resolves.toEqual({
      apiKey: 'decrypted-org-key-2',
      isBYOK: true,
      scope: 'organization',
    })
  })

  it('keeps workspace and organization rotation counters in separate namespaces', async () => {
    const sharedId = `shared-${++testIndex}`
    const workspacePool = [storedKey('workspace-key-1'), storedKey('workspace-key-2')]
    const organizationPool = [
      storedOrganizationKey(sharedId, 'org-key-1'),
      storedOrganizationKey(sharedId, 'org-key-2'),
    ]
    dbChainMockFns.orderBy
      .mockResolvedValueOnce(workspacePool)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(organizationPool)

    await expect(getBYOKKey(sharedId, 'firecrawl')).resolves.toEqual({
      apiKey: 'decrypted-workspace-key-1',
      isBYOK: true,
      scope: 'workspace',
    })
    await expect(getBYOKKey(uniqueWorkspaceId(), 'firecrawl')).resolves.toEqual({
      apiKey: 'decrypted-org-key-1',
      isBYOK: true,
      scope: 'organization',
    })
  })

  it('reads organization key updates fresh on every resolution', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-key-before')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-key-after')])

    await expect(getBYOKKey(workspaceId, 'firecrawl')).resolves.toEqual({
      apiKey: 'decrypted-org-key-before',
      isBYOK: true,
      scope: 'organization',
    })
    await expect(getBYOKKey(workspaceId, 'firecrawl')).resolves.toEqual({
      apiKey: 'decrypted-org-key-after',
      isBYOK: true,
      scope: 'organization',
    })

    expect(mockIsOrganizationBYOKEntitled).toHaveBeenCalledTimes(2)
  })

  it('rechecks the canonical organization attachment and key rows after a delete or detach', async () => {
    const workspaceId = uniqueWorkspaceId()
    const organizationId = uniqueOrganizationId()
    dbChainMockFns.orderBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedOrganizationKey(organizationId, 'org-key')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await expect(getBYOKKey(workspaceId, 'firecrawl')).resolves.toEqual({
      apiKey: 'decrypted-org-key',
      isBYOK: true,
      scope: 'organization',
    })
    await expect(getBYOKKey(workspaceId, 'firecrawl')).resolves.toBeNull()

    expect(dbChainMockFns.orderBy).toHaveBeenCalledTimes(4)
    expect(mockIsOrganizationBYOKEntitled).toHaveBeenCalledTimes(1)
  })
})

describe('getApiKeyWithBYOK (OpenAI only)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns the platform OpenAI key without touching BYOK', async () => {
    mockGetRotatingApiKey.mockReturnValue('sk-platform')

    await expect(
      getApiKeyWithBYOK('openai', 'gpt-5-mini', uniqueWorkspaceId(), 'user-key')
    ).resolves.toEqual({ apiKey: 'sk-platform', isBYOK: false })
    expect(mockGetRotatingApiKey).toHaveBeenCalledWith('openai')
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('throws a clear error when no OpenAI key is configured', async () => {
    mockGetRotatingApiKey.mockImplementation(() => {
      throw new Error('No API keys configured for rotation.')
    })

    await expect(getApiKeyWithBYOK('openai', 'gpt-5-mini', null)).rejects.toThrow('OPENAI_API_KEY')
  })

  it('rejects every other provider, even with a caller-supplied key', async () => {
    mockGetRotatingApiKey.mockReturnValue('sk-platform')

    for (const provider of ['anthropic', 'google', 'ollama', 'bedrock', 'azure-openai']) {
      await expect(getApiKeyWithBYOK(provider, 'some-model', null, 'user-key')).rejects.toThrow(
        `Provider "${provider}" is not available`
      )
    }
    expect(mockGetRotatingApiKey).not.toHaveBeenCalled()
  })

  describe('Cloudflare mode', () => {
    afterEach(resetEnvMock)

    it('returns the cloudflare placeholder key, never the token, billed to the workspace', async () => {
      setEnv({ CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'cf-token' })

      const result = await getApiKeyWithBYOK('cloudflare', 'anthropic/claude-sonnet-5', null)

      expect(result).toEqual({ apiKey: 'cloudflare-unified-billing', isBYOK: false })
      expect(JSON.stringify(result)).not.toContain('cf-token')
      expect(mockGetRotatingApiKey).not.toHaveBeenCalled()
    })

    it('needs no OpenAI key for openai either (gateway placeholder)', async () => {
      setEnv({ CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'cf-token' })

      await expect(getApiKeyWithBYOK('openai', 'gpt-5-mini', null)).resolves.toEqual({
        apiKey: 'cloudflare-ai-gateway',
        isBYOK: false,
      })
      expect(mockGetRotatingApiKey).not.toHaveBeenCalled()
    })

    it('rejects cloudflare outside Cloudflare mode', async () => {
      setEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: undefined })

      await expect(getApiKeyWithBYOK('cloudflare', 'anthropic/claude-sonnet-5', null)).rejects.toThrow(
        'Provider "cloudflare" is not available'
      )
    })
  })
})
