import type { ComponentType, SVGProps } from 'react'
import { cn } from '@sim/emcn'
import { InstagramIcon, TelegramIcon, WhatsAppIcon } from '@/components/icons'
import type { InboxChannel } from '@/hooks/queries/inbox'

export const INBOX_CHANNEL_LABELS: Record<InboxChannel, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
}

const CHANNEL_ICONS: Record<InboxChannel, ComponentType<SVGProps<SVGSVGElement>>> = {
  telegram: TelegramIcon,
  whatsapp: WhatsAppIcon,
  instagram: InstagramIcon,
}

interface ChannelIconProps {
  channel: InboxChannel
  className?: string
}

/** The brand mark of the channel a conversation came from. */
export function ChannelIcon({ channel, className }: ChannelIconProps) {
  const Icon = CHANNEL_ICONS[channel]
  return (
    <Icon
      aria-label={INBOX_CHANNEL_LABELS[channel]}
      className={cn('size-[14px] shrink-0', className)}
    />
  )
}
