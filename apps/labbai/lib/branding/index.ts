import { defaultBrandConfig } from '@/lib/branding/defaults'
import type { BrandConfig } from '@/lib/branding/types'

export { defaultBrandConfig } from '@/lib/branding/defaults'
export type { BrandConfig, ThemeColors } from '@/lib/branding/types'
export { EMAIL_WORDMARK_SIZE } from '@/lib/branding/wordmark'

/**
 * Returns the product brand configuration. Branding is static: there are no
 * per-instance or per-organization overrides.
 */
export function getBrandConfig(): BrandConfig {
  return defaultBrandConfig
}

/**
 * Client-side accessor for the product brand configuration. Branding is
 * static, so this is a plain function safe to call from components and hooks.
 */
export function useBrandConfig(): BrandConfig {
  return defaultBrandConfig
}
