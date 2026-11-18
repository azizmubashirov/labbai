'use client'

import type { InstagramAutoReplyMediaStats } from '@/lib/api/contracts/instagram-auto-reply'
import { MediaThumbnail } from '@/app/workspace/[workspaceId]/instagram/components/media-thumbnails'
import { formatClickThroughRate } from '@/app/workspace/[workspaceId]/instagram/utils'

const HEADER_CELL = 'px-2 pb-2 text-left font-normal text-[var(--text-muted)] text-caption'
const NUMBER_HEADER_CELL = 'px-2 pb-2 text-right font-normal text-[var(--text-muted)] text-caption'
const NUMBER_CELL = 'px-2 py-1.5 text-right text-[var(--text-body)] text-small tabular-nums'

interface MediaStatsTableProps {
  /** Accessible name of the table, e.g. "Top posts". */
  label: string
  media: readonly InstagramAutoReplyMediaStats[]
}

/**
 * Per-post results: thumbnail, comments matched, DMs sent, link clicks, and click-through rate
 * (clicks per DM sent). Thumbnails come from the surrounding `InstagramMediaThumbnails`.
 */
export function MediaStatsTable({ label, media }: MediaStatsTableProps) {
  return (
    <table aria-label={label} className='w-full border-collapse'>
      <thead>
        <tr>
          <th scope='col' className={HEADER_CELL}>
            Post
          </th>
          <th scope='col' className={NUMBER_HEADER_CELL}>
            Comments matched
          </th>
          <th scope='col' className={NUMBER_HEADER_CELL}>
            DMs sent
          </th>
          <th scope='col' className={NUMBER_HEADER_CELL}>
            Clicks
          </th>
          <th scope='col' className={NUMBER_HEADER_CELL}>
            CTR
          </th>
        </tr>
      </thead>
      <tbody>
        {media.map((row) => (
          <tr key={row.mediaId} className='border-[var(--border)] border-t'>
            <td className='px-2 py-1.5'>
              <MediaThumbnail mediaId={row.mediaId} />
            </td>
            <td className={NUMBER_CELL}>{row.matched}</td>
            <td className={NUMBER_CELL}>{row.dmSent}</td>
            <td className={NUMBER_CELL}>{row.clicks}</td>
            <td className={NUMBER_CELL}>{formatClickThroughRate(row.clicks, row.dmSent)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
