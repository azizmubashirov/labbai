import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

export const guardrailsValidationInputSchema = z.object({
  validationType: z.string().optional(),
  input: z.unknown().optional(),
  regex: z.string().optional(),
  knowledgeBaseId: z.string().optional(),
  threshold: z.string().optional(),
  topK: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  workflowId: z.string().optional(),
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
})

export type GuardrailsValidationInput = z.input<typeof guardrailsValidationInputSchema>
