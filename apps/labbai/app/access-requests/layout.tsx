import type { ReactNode } from 'react'

interface AccessRequestsLayoutProps {
  children: ReactNode
}

export default function AccessRequestsLayout({ children }: AccessRequestsLayoutProps) {
  return <div className='flex min-h-screen flex-col bg-[var(--bg)]'>{children}</div>
}
