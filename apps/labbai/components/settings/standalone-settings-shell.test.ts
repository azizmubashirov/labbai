/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_SETTINGS_ITEMS,
  ACCOUNT_SETTINGS_PATH_ALIASES,
  parseSettingsPathSection,
} from '@/components/settings/navigation'

describe('standalone settings section resolution', () => {
  it('resolves the legacy account apikeys segment to its canonical section', () => {
    expect(
      parseSettingsPathSection({
        path: '/account/settings/apikeys',
        items: ACCOUNT_SETTINGS_ITEMS,
        defaultSection: 'general',
        aliases: ACCOUNT_SETTINGS_PATH_ALIASES,
      })
    ).toBe('api-keys')
  })

  it('falls back to General for a retired account section', () => {
    expect(
      parseSettingsPathSection({
        path: '/account/settings/billing/credit-usage',
        items: ACCOUNT_SETTINGS_ITEMS,
        defaultSection: 'general',
        aliases: ACCOUNT_SETTINGS_PATH_ALIASES,
      })
    ).toBe('general')
  })
})
