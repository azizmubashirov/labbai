/**
 * Configuration constants for tokenization functionality
 */

import type { ProviderTokenizationConfig } from '@/lib/tokenization/types'

export const TOKENIZATION_CONFIG = {
  /** Labbai: OpenAI is the only LLM provider; any other id uses `fallback`. */
  providers: {
    openai: {
      avgCharsPerToken: 4,
      confidence: 'high',
      supportedMethods: ['heuristic', 'fallback'],
    },
  } satisfies Record<string, ProviderTokenizationConfig>,

  fallback: {
    avgCharsPerToken: 4,
    confidence: 'low',
    supportedMethods: ['fallback'],
  } satisfies ProviderTokenizationConfig,

  defaults: {
    model: 'gpt-5-mini',
    provider: 'openai',
  },
} as const

export const LLM_BLOCK_TYPES = ['agent', 'router', 'evaluator'] as const

export const MIN_TEXT_LENGTH_FOR_ESTIMATION = 1
export const MAX_PREVIEW_LENGTH = 100
