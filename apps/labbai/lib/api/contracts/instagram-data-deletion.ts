import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** Longest `signed_request` accepted; Meta's are a few hundred characters. */
export const INSTAGRAM_SIGNED_REQUEST_MAX_LENGTH = 4096

/**
 * The form fields Meta posts to the data deletion callback
 * (`application/x-www-form-urlencoded`). The route reads them from the form body, then verifies
 * `signed_request` against the app secret before trusting anything in it.
 */
export const instagramDataDeletionBodySchema = z.object({
  signed_request: z
    .string({ error: 'signed_request is required' })
    .min(3, 'signed_request is required')
    .max(INSTAGRAM_SIGNED_REQUEST_MAX_LENGTH, 'signed_request is too long'),
})

export type InstagramDataDeletionBody = z.input<typeof instagramDataDeletionBodySchema>

/** What Meta expects back: where the user can check the request, and a code to quote. */
export const instagramDataDeletionResponseSchema = z.object({
  url: z.string().url(),
  confirmation_code: z.string().min(1).max(128),
})

export type InstagramDataDeletionResponse = z.output<typeof instagramDataDeletionResponseSchema>

/**
 * Meta's data deletion request callback for the Instagram app. Public: Meta authenticates it
 * with the HMAC-SHA256 signature inside `signed_request`.
 */
export const instagramDataDeletionContract = defineRouteContract({
  method: 'POST',
  path: '/api/instagram/data-deletion',
  body: instagramDataDeletionBodySchema,
  response: {
    mode: 'json',
    schema: z.union([instagramDataDeletionResponseSchema, z.object({ error: z.string().min(1) })]),
  },
})
