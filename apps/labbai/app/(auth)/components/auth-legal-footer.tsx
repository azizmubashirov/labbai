'use client'

import { useBrandConfig } from '@/lib/branding'
import { AuthTextLink } from '@/app/(auth)/components/auth-text-link'

interface AuthLegalFooterProps {
  /** The gerund describing the consent action, e.g. "signing in". */
  action: string
}

/**
 * The "By {action}, you agree to our Terms / Privacy" fine print shared by the
 * login and signup pages. Renders only the documents this deployment has
 * configured (`NEXT_PUBLIC_TERMS_URL`, `NEXT_PUBLIC_PRIVACY_URL`), and nothing
 * when neither is set.
 */
export function AuthLegalFooter({ action }: AuthLegalFooterProps) {
  const { termsUrl, privacyUrl } = useBrandConfig()
  if (!termsUrl && !privacyUrl) return null

  return (
    <p className='text-center text-[var(--text-muted)] text-caption leading-relaxed'>
      By {action}, you agree to our{' '}
      {termsUrl && (
        <AuthTextLink href={termsUrl} external>
          Terms of Service
        </AuthTextLink>
      )}
      {termsUrl && privacyUrl && ' and '}
      {privacyUrl && (
        <AuthTextLink href={privacyUrl} external>
          Privacy Policy
        </AuthTextLink>
      )}
    </p>
  )
}
