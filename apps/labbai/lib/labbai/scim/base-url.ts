import { getBaseUrl } from '@/lib/core/utils/urls'

/** The absolute base URL of the SCIM 2.0 surface, as providers are configured with it. */
export function scimBaseUrl(): string {
  return `${getBaseUrl()}/api/scim/v2`
}
