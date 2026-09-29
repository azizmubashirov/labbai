import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  adminV1IdParamsSchema,
  adminV1ListResponseSchema,
  adminV1PaginationQuerySchema,
  adminV1SingleResponseSchema,
} from '@/lib/api/contracts/v1/admin/shared'

export const adminV1UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminV1ListUsersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/users',
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1UserSchema),
  },
})

export const adminV1GetUserContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/users/[id]',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1UserSchema),
  },
})

export type AdminV1ListUsersResponse = ContractJsonResponse<typeof adminV1ListUsersContract>
export type AdminV1GetUserResponse = ContractJsonResponse<typeof adminV1GetUserContract>
