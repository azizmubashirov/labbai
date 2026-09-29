import { z } from 'zod'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const authProviderStatusResponseSchema = z.object({
  githubAvailable: z.boolean(),
  googleAvailable: z.boolean(),
  microsoftAvailable: z.boolean(),
  registrationDisabled: z.boolean(),
})

export const getAuthProvidersContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/providers',
  response: {
    mode: 'json',
    schema: authProviderStatusResponseSchema,
  },
})

export type AuthProviderStatusResponse = ContractJsonResponse<typeof getAuthProvidersContract>
