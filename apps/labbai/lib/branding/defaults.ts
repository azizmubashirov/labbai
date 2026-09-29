import type { BrandConfig } from '@/lib/branding/types'
import { getEnv } from '@/lib/core/config/env'

/**
 * Default brand configuration values
 */
export const defaultBrandConfig: BrandConfig = {
  name: 'Labbai',
  logoUrl: undefined,
  wordmarkUrl: undefined,
  faviconUrl: undefined,
  customCssUrl: undefined,
  supportEmail: undefined,
  documentationUrl: undefined,
  termsUrl: getEnv('NEXT_PUBLIC_TERMS_URL'),
  privacyUrl: getEnv('NEXT_PUBLIC_PRIVACY_URL'),
  theme: {
    primaryColor: '#33c482',
    primaryHoverColor: '#2dac72',
    accentColor: '#33b4ff',
    accentHoverColor: '#29a0e8',
    backgroundColor: '#0c0c0c',
  },
  isWhitelabeled: false,
}
