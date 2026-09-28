/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type InboxAttachment,
  inboxMessageSummary,
  toInboxAttachmentViews,
} from '@/lib/inbox/attachments'

const photo: InboxAttachment = {
  kind: 'image',
  fileId: 'f1',
  url: null,
  mimeType: 'image/jpeg',
  fileName: null,
}

describe('inboxMessageSummary', () => {
  it('prefers the message text and falls back to the first attachment', () => {
    expect(inboxMessageSummary('Salom', [photo])).toBe('Salom')
    expect(inboxMessageSummary('', [photo])).toBe('Photo')
    expect(inboxMessageSummary('  ', [{ ...photo, kind: 'document', fileName: 'narx.pdf' }])).toBe(
      'Document: narx.pdf'
    )
  })
})

describe('toInboxAttachmentViews', () => {
  it('hides channel media ids and exposes only plain links', () => {
    expect(
      toInboxAttachmentViews([
        photo,
        {
          kind: 'location',
          fileId: null,
          url: 'https://www.google.com/maps?q=1,2',
          mimeType: null,
          fileName: null,
        },
        { kind: 'image', fileId: null, url: null, mimeType: null, fileName: null },
      ])
    ).toEqual([
      {
        index: 0,
        kind: 'image',
        mimeType: 'image/jpeg',
        fileName: null,
        link: null,
        downloadable: true,
      },
      {
        index: 1,
        kind: 'location',
        mimeType: null,
        fileName: null,
        link: 'https://www.google.com/maps?q=1,2',
        downloadable: false,
      },
      { index: 2, kind: 'image', mimeType: null, fileName: null, link: null, downloadable: false },
    ])
  })
})
