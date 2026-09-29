import type { ReactNode } from 'react'
import { LogoPage, LabbaiWordmark } from '@labbai/emcn'

/**
 * Logo-only page frame shared by status pages and public interfaces. Interfaces
 * default to light tokens; status pages inherit the active theme.
 *
 * Children decide their own layout: pass `center` for a single centered column
 * (404 message, simple gates); omit it for full-width content (the live chat
 * overlay, which covers this frame entirely). An optional `footer`
 * slot renders pinned at the bottom.
 */
interface LogoShellProps {
  children: ReactNode
  /** Center content in the viewport (for short messages / forms). Default: full-width. */
  center?: boolean
  /** Optional footer rendered after the content (e.g. a support footer). */
  footer?: ReactNode
  /** Status pages follow the active theme; public interfaces retain their light appearance. */
  theme?: 'light' | 'inherit'
}

export function LogoShell({ children, center = false, footer, theme = 'light' }: LogoShellProps) {
  return (
    <LogoPage
      center={center}
      theme={theme}
      footer={footer}
      logo={
        <a href='/' aria-label='Home' className='flex h-[30px] items-center'>
          <LabbaiWordmark />
        </a>
      }
    >
      {children}
    </LogoPage>
  )
}
