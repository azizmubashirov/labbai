import { Container, Link, Section } from '@react-email/components'
import { baseStyles, colors, spacing } from '@/components/emails/_styles'
import { getBrandConfig } from '@/lib/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface EmailFooterProps {
  baseUrl?: string
  messageId?: string
  /**
   * Whether to show unsubscribe link. Defaults to true.
   * Set to false for transactional emails where unsubscribe doesn't apply.
   */
  showUnsubscribe?: boolean
}

/**
 * Email footer component styled to match Stripe's email design.
 * Sits in the gray area below the main white card.
 *
 * For non-transactional emails, the unsubscribe link uses placeholders
 * {{UNSUBSCRIBE_TOKEN}} and {{UNSUBSCRIBE_EMAIL}} which are replaced
 * by the mailer when sending.
 */
export function EmailFooter({
  baseUrl = getBaseUrl(),
  messageId,
  showUnsubscribe = true,
}: EmailFooterProps) {
  const brand = getBrandConfig()
  const footerLinks = [
    ...(brand.privacyUrl ? [{ label: 'Privacy Policy', href: brand.privacyUrl }] : []),
    ...(brand.termsUrl ? [{ label: 'Terms of Service', href: brand.termsUrl }] : []),
    ...(showUnsubscribe
      ? [
          {
            label: 'Unsubscribe',
            href: `${baseUrl}/unsubscribe?token={{UNSUBSCRIBE_TOKEN}}&email={{UNSUBSCRIBE_EMAIL}}`,
          },
        ]
      : []),
  ]

  return (
    <Section
      style={{
        backgroundColor: colors.footerBg,
        width: '100%',
      }}
    >
      <Container style={{ maxWidth: `${spacing.containerWidth}px`, margin: '0 auto' }}>
        <table
          cellPadding={0}
          cellSpacing={0}
          border={0}
          width='100%'
          style={{ minWidth: `${spacing.containerWidth}px` }}
        >
          <tbody>
            <tr>
              <td style={baseStyles.spacer} height={32}>
                &nbsp;
              </td>
            </tr>

            <tr>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
              <td style={baseStyles.footerText}>{brand.name}</td>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
            </tr>

            <tr>
              <td style={baseStyles.spacer} height={8}>
                &nbsp;
              </td>
            </tr>

            {brand.supportEmail && (
              <>
                <tr>
                  <td style={baseStyles.gutter} width={spacing.gutter}>
                    &nbsp;
                  </td>
                  <td style={baseStyles.footerText}>
                    Questions?{' '}
                    {/*
                      A raw anchor, not `<Link>`: react-email's Link hardcodes
                      target="_blank", which on a mailto: opens a blank tab beside
                      the compose window in most webmail clients.
                    */}
                    <a href={`mailto:${brand.supportEmail}`} style={baseStyles.footerLink}>
                      {brand.supportEmail}
                    </a>
                  </td>
                  <td style={baseStyles.gutter} width={spacing.gutter}>
                    &nbsp;
                  </td>
                </tr>

                <tr>
                  <td style={baseStyles.spacer} height={8}>
                    &nbsp;
                  </td>
                </tr>
              </>
            )}

            {messageId && (
              <>
                <tr>
                  <td style={baseStyles.gutter} width={spacing.gutter}>
                    &nbsp;
                  </td>
                  <td style={baseStyles.footerText}>
                    Need to refer to this message? Use this ID: {messageId}
                  </td>
                  <td style={baseStyles.gutter} width={spacing.gutter}>
                    &nbsp;
                  </td>
                </tr>
                <tr>
                  <td style={baseStyles.spacer} height={8}>
                    &nbsp;
                  </td>
                </tr>
              </>
            )}

            <tr>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
              <td style={baseStyles.footerText}>
                {footerLinks.map(({ label, href }, index) => (
                  <span key={label}>
                    {index > 0 && ' • '}
                    <Link href={href} style={baseStyles.footerLink} rel='noopener noreferrer'>
                      {label}
                    </Link>
                  </span>
                ))}
              </td>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
            </tr>

            <tr>
              <td style={baseStyles.spacer} height={16}>
                &nbsp;
              </td>
            </tr>
            <tr>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
              <td style={baseStyles.footerText}>
                © {new Date().getFullYear()} {brand.name}, All Rights Reserved
              </td>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
            </tr>

            <tr>
              <td style={baseStyles.spacer} height={32}>
                &nbsp;
              </td>
            </tr>
          </tbody>
        </table>
      </Container>
    </Section>
  )
}

export default EmailFooter
