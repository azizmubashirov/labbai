'use client'

import { LabbaiWordmark } from '@labbai/emcn'
import Image from 'next/image'
import Link from 'next/link'
import { useBrandConfig } from '@/lib/branding'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'

interface ChatHeaderProps {
  chatConfig: {
    title?: string
    customizations?: {
      headerText?: string
      logoUrl?: string
      imageUrl?: string
      primaryColor?: string
    }
  } | null
}

export function ChatHeader({ chatConfig }: ChatHeaderProps) {
  const brand = useBrandConfig()
  const customImage = chatConfig?.customizations?.imageUrl || chatConfig?.customizations?.logoUrl

  return (
    <nav
      aria-label='Chat navigation'
      className='flex w-full items-center justify-between px-4 pt-3 pb-[21px] sm:px-8 sm:pt-[8.5px] md:px-[44px] md:pt-4'
    >
      <div className='flex items-center gap-[34px]'>
        <div className='flex items-center gap-3'>
          {customImage && (
            <Image
              src={customImage}
              alt={`${chatConfig?.title || 'Chat'} logo`}
              width={24}
              height={24}
              unoptimized
              className='size-6 rounded-md object-cover'
            />
          )}
          <h2 className='text-[var(--text-primary)] text-lg'>
            {chatConfig?.customizations?.headerText || chatConfig?.title || 'Chat'}
          </h2>
        </div>
      </div>

      {!brand.logoUrl && (
        <div className='flex items-center gap-4'>
          <Link href={APP_ENTRY_PATH} aria-label='Labbai home' className='flex items-center'>
            <LabbaiWordmark />
          </Link>
        </div>
      )}
    </nav>
  )
}
