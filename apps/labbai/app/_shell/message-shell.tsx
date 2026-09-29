import type { ReactNode } from 'react'
import { LogoShell } from '@/app/_shell/logo-shell'

interface MessageShellProps {
  title: string
  description: ReactNode
  /** Optional action row (a Chip CTA). Omitted on terminal, no-action screens. */
  children?: ReactNode
}

/**
 * Minimal-chrome frame for short standalone status pages (OAuth return and error
 * screens). Uses the same {@link LogoShell} frame and type scale as the global 404
 * and the public file-share gates.
 */
export function MessageShell({ title, description, children }: MessageShellProps) {
  return (
    <LogoShell center>
      <div className='flex w-full max-w-[410px] flex-col items-center gap-3 text-center'>
        <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
          {title}
        </h1>
        <p className='text-[var(--text-muted)] text-lg'>{description}</p>
        {children ? <div className='mt-3 flex items-center gap-2'>{children}</div> : null}
      </div>
    </LogoShell>
  )
}
