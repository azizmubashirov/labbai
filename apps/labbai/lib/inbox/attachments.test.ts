/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  INBOX_OPERATOR_FILE_MAX_BYTES,
  type InboxAttachment,
  inboxMessageSummary,
  inboxOutgoingKind,
  inboxOutgoingSizeError,
  isChannelVoiceFormat,
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

describe('operator files', () => {
  it('serves a stored operator file through the Inbox and keeps its key private', () => {
    const [view] = toInboxAttachmentViews([
      {
        kind: 'voice',
        fileId: null,
        url: null,
        mimeType: 'audio/ogg',
        fileName: 'voice.ogg',
        storageKey: 'workspace/ws/inbox/c1/1-a-voice.ogg',
      },
    ])
    expect(view).toEqual({
      index: 0,
      kind: 'voice',
      mimeType: 'audio/ogg',
      fileName: 'voice.ogg',
      link: null,
      downloadable: true,
    })
  })

  it('sends JPEG/PNG as photos, recordings as voice notes, and the rest as files', () => {
    expect(inboxOutgoingKind('image/jpeg', false)).toBe('image')
    expect(inboxOutgoingKind('IMAGE/PNG', false)).toBe('image')
    expect(inboxOutgoingKind('image/heic', false)).toBe('document')
    expect(inboxOutgoingKind('application/pdf', false)).toBe('document')
    expect(inboxOutgoingKind('audio/webm;codecs=opus', true)).toBe('voice')
  })

  it('applies the Inbox cap and each channel photo limit', () => {
    const sixMb = 6 * 1024 * 1024
    expect(inboxOutgoingSizeError('telegram', 'image', sixMb)).toBeNull()
    expect(inboxOutgoingSizeError('instagram', 'image', sixMb)).toBeNull()
    expect(inboxOutgoingSizeError('whatsapp', 'image', sixMb)).toBe(
      'WhatsApp accepts photos up to 5 MB.'
    )
    expect(inboxOutgoingSizeError('whatsapp', 'document', sixMb)).toBeNull()
    expect(inboxOutgoingSizeError('telegram', 'document', INBOX_OPERATOR_FILE_MAX_BYTES + 1)).toBe(
      'Files up to 7 MB can be sent from the Inbox.'
    )
    expect(inboxOutgoingSizeError('telegram', 'voice', 0)).toBe('The file is empty.')
  })

  it('knows which recordings each channel plays as a voice note', () => {
    expect(isChannelVoiceFormat('telegram', 'audio/ogg; codecs=opus')).toBe(true)
    expect(isChannelVoiceFormat('whatsapp', 'audio/webm;codecs=opus')).toBe(false)
    expect(isChannelVoiceFormat('instagram', 'audio/mp4')).toBe(true)
    expect(isChannelVoiceFormat('instagram', 'audio/ogg')).toBe(false)
  })
})
