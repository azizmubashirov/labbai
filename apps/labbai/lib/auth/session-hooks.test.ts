/**
 * @vitest-environment node
 */
import { db } from '@labbai/db'
import { resetEnvFlagsMock, setEnvFlags } from '@labbai/testing'
import type { Session } from 'better-auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { isBlocked } = vi.hoisted(() => ({ isBlocked: vi.fn() }))

vi.mock('@/lib/auth/access-control', () => ({
  getAccessControlConfig: async () => ({ blockedEmails: [], blockedSignupDomains: [] }),
  isEmailBlockedByAccessControl: isBlocked,
}))

import { runWithAuthDatabase } from '@/lib/auth/database-context'
import { prepareSessionForCreation } from '@/lib/auth/session-hooks'

const createdAt = new Date('2026-09-08T00:00:00Z')
const session: Session = {
  id: 'session-1',
  userId: 'user-1',
  token: 'session-token',
  createdAt,
  updatedAt: createdAt,
  expiresAt: new Date('2026-10-08T00:00:00Z'),
}

function transactionExecutor() {
  const limit = vi.fn()
  return {
    limit,
    executor: {
      ...db,
      select: vi.fn().mockReturnValue({
        from: () => ({
          where: () => ({ limit }),
          innerJoin: () => ({ where: () => ({ limit }) }),
          leftJoin: () => ({ where: () => ({ limit }) }),
        }),
      }),
    },
  }
}

describe('prepareSessionForCreation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isHosted: true, isAccessControlEnabled: false })
    isBlocked.mockReturnValue(false)
    vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('Global database read inside the auth transaction')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetEnvFlagsMock()
  })

  it('reads an uncommitted signup account without checking out another connection', async () => {
    const { executor, limit } = transactionExecutor()
    limit.mockResolvedValueOnce([{ email: 'new@example.com', suspendedAt: null }])
    limit.mockResolvedValueOnce([])

    await expect(
      runWithAuthDatabase(executor, () => prepareSessionForCreation(session))
    ).resolves.toEqual({ data: session })
    expect(db.select).not.toHaveBeenCalled()
  })

  it('activates the member organization using transaction-scoped reads', async () => {
    const { executor, limit } = transactionExecutor()
    limit.mockResolvedValueOnce([{ email: 'member@example.com', suspendedAt: null }])
    limit.mockResolvedValueOnce([{ organizationId: 'org-1' }])

    await expect(
      runWithAuthDatabase(executor, () => prepareSessionForCreation(session))
    ).resolves.toEqual({
      data: { ...session, activeOrganizationId: 'org-1' },
    })
    expect(limit).toHaveBeenCalledTimes(2)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('still signs in without an organization when the membership read fails', async () => {
    const { executor, limit } = transactionExecutor()
    limit.mockResolvedValueOnce([{ email: 'member@example.com', suspendedAt: null }])
    limit.mockRejectedValueOnce(new Error('connection reset'))

    await expect(
      runWithAuthDatabase(executor, () => prepareSessionForCreation(session))
    ).resolves.toEqual({ data: session })
  })

  it('refuses a suspended account before it can receive a session', async () => {
    const { executor, limit } = transactionExecutor()
    limit.mockResolvedValueOnce([{ email: 'member@example.com', suspendedAt: createdAt }])

    await expect(
      runWithAuthDatabase(executor, () => prepareSessionForCreation(session))
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
    expect(limit).toHaveBeenCalledTimes(1)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('keeps the blocked-email gate outside the optional membership lookup', async () => {
    const { executor, limit } = transactionExecutor()
    limit.mockResolvedValueOnce([{ email: 'blocked@example.com', suspendedAt: null }])
    isBlocked.mockReturnValue(true)

    await expect(
      runWithAuthDatabase(executor, () => prepareSessionForCreation(session))
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
    expect(limit).toHaveBeenCalledTimes(1)
  })
})
