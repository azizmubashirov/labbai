import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema, userFileSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

export const sttProviders = [
  'whisper',
  'deepgram',
  'elevenlabs',
  'assemblyai',
  'gemini',
  'rubai',
] as const
const MISSING_STT_FIELDS_ERROR = 'Missing required fields: provider and apiKey'

export const sttUserFileSchema = userFileSchema.extend({
  type: z.string().optional().default(''),
})

export const sttUserFileInputSchema = z.union([sttUserFileSchema, z.array(sttUserFileSchema)])

/**
 * Accepts `null` for an optional field and normalizes it to `undefined`. Blocks pass an empty
 * sub-block through as `null`, so a run that leaves an optional field blank (an empty audio URL,
 * no model, no prompt) must not fail validation.
 */
function optionalNullable<T extends z.ZodType>(schema: T) {
  return schema.nullish().transform((value) => value ?? undefined)
}

export const sttOperationInputSchema = z
  .object({
    provider: z
      .string({ error: MISSING_STT_FIELDS_ERROR })
      .min(1, MISSING_STT_FIELDS_ERROR)
      .refine((provider) => sttProviders.includes(provider as (typeof sttProviders)[number]), {
        message: `Invalid provider. Must be one of: ${sttProviders.join(', ')}`,
      }),
    apiKey: z.string({ error: MISSING_STT_FIELDS_ERROR }).optional(),
    model: optionalNullable(z.string()),
    audioFile: optionalNullable(sttUserFileInputSchema),
    audioFileReference: optionalNullable(sttUserFileInputSchema),
    audioUrl: optionalNullable(z.string()),
    language: optionalNullable(z.string()),
    timestamps: optionalNullable(z.enum(['none', 'sentence', 'word'])),
    diarization: optionalNullable(z.boolean()),
    translateToEnglish: optionalNullable(z.boolean()),
    prompt: optionalNullable(z.string()),
    temperature: optionalNullable(z.coerce.number()),
    sentiment: optionalNullable(z.boolean()),
    entityDetection: optionalNullable(z.boolean()),
    piiRedaction: optionalNullable(z.boolean()),
    summarization: optionalNullable(z.boolean()),
    [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
  })
  .passthrough()
  .superRefine((input, ctx) => {
    if (input.provider !== 'rubai' && !input.apiKey) {
      ctx.addIssue({ code: 'custom', path: ['apiKey'], message: MISSING_STT_FIELDS_ERROR })
    }
  })

export type SttOperationInput = z.output<typeof sttOperationInputSchema>
