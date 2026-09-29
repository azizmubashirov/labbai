/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { ExternalDocument } from '@/connectors/types'

vi.mock('@/components/icons', () => ({
  JiraIcon: () => null,
  ConfluenceIcon: () => null,
  GithubIcon: () => null,
  LinearIcon: () => null,
  NotionIcon: () => null,
  GoogleDriveIcon: () => null,
  AirtableIcon: () => null,
  SentryIcon: () => null,
  TypeformIcon: () => null,
  YouTubeIcon: () => null,
  JiraServiceManagementIcon: () => null,
  S3Icon: () => null,
  GoogleFormsIcon: () => null,
  xIcon: () => null,
  GranolaIcon: () => null,
  GreenhouseIcon: () => null,
  FathomIcon: () => null,
  RootlyIcon: () => null,
  AzureIcon: () => null,
}))
vi.mock('@/lib/knowledge/documents/utils', () => ({ VALIDATE_RETRY_OPTIONS: {} }))
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => ({ fetchWithRetry: vi.fn() }))

import { googleDriveConnector } from '@/connectors/google-drive/google-drive'
import { notionConnector } from '@/connectors/notion/notion'
import {
  appendPendingMicrosoftGraphFolders,
  assertMicrosoftGraphNextLink,
  BoundedLines,
  ConnectorFileTooLargeError,
  ConnectorListingScopeUnavailableError,
  decodeMicrosoftGraphTraversalCursor,
  encodeMicrosoftGraphTraversalCursor,
  extractConnectorText,
  hasIndexablePayload,
  htmlToPlainText,
  isIndexableConnectorFile,
  isSkippableMicrosoftGraphFolderError,
  isSkippedDocument,
  MICROSOFT_GRAPH_MAX_CURSOR_ENCODED_BYTES,
  MICROSOFT_GRAPH_MAX_ITEM_ID_BYTES,
  MICROSOFT_GRAPH_MAX_PENDING_FOLDERS,
  markSkipped,
  memberDocumentId,
  PER_MEMBER_LISTING_CONTEXT,
  parseDefaultedUnlimitedSafeInteger,
  pipelineParsedMimeType,
  readBodyWithLimit,
  sizeLimitSkipReason,
  sourceDocumentId,
  takeIndexableWithinCap,
} from '@/connectors/utils'

const ISO_DATE = '2025-06-15T10:30:00.000Z'

describe('member document identity', () => {
  const alice = { ...PER_MEMBER_LISTING_CONTEXT, memberId: 'alice' }
  const bob = { ...PER_MEMBER_LISTING_CONTEXT, memberId: 'bob' }

  it('isolates different member representations of the same source item', () => {
    const aliceId = memberDocumentId('site:document', alice)
    const bobId = memberDocumentId('site:document', bob)
    expect(aliceId).not.toBe(bobId)
    expect(sourceDocumentId(aliceId, alice)).toBe('site:document')
    expect(sourceDocumentId(aliceId, bob)).toBeNull()
    expect(sourceDocumentId(bobId, alice)).toBeNull()
    expect(sourceDocumentId('site:document', alice)).toBeNull()
  })

  it('preserves workspace document identities', () => {
    expect(memberDocumentId('site:document', undefined)).toBe('site:document')
    expect(sourceDocumentId('site:document', undefined)).toBe('site:document')
    expect(memberDocumentId('site:document', { memberId: 'alice' })).toBe('site:document')
  })

  it('encodes member delimiters without changing the source identity', () => {
    const context = { ...PER_MEMBER_LISTING_CONTEXT, memberId: 'alice:team/%' }
    const id = memberDocumentId('calendar:recurring:event', context)
    expect(sourceDocumentId(id, context)).toBe('calendar:recurring:event')
    expect(sourceDocumentId(id, alice)).toBeNull()
    expect(sourceDocumentId('member:alice:', alice)).toBeNull()
  })

  it.each([undefined, '', ' ', 42])(
    'fails closed without a canonical member ID (%s)',
    (memberId) => {
      const context = { ...PER_MEMBER_LISTING_CONTEXT, memberId }
      expect(() => memberDocumentId('document', context)).toThrow('connector member ID')
      expect(() => sourceDocumentId('document', context)).toThrow('connector member ID')
    }
  )
})

describe('Notion mapTags', () => {
  const mapTags = notionConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      tags: ['engineering', 'docs'],
      lastModified: ISO_DATE,
      createdTime: '2025-01-01T00:00:00.000Z',
    })

    expect(result).toEqual({
      tags: 'engineering, docs',
      lastModified: new Date(ISO_DATE),
      created: new Date('2025-01-01T00:00:00.000Z'),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips tags when not an array', () => {
    const result = mapTags({ tags: 'single' })
    expect(result).toEqual({})
  })

  it.concurrent('skips lastModified when date is invalid', () => {
    const result = mapTags({ lastModified: 'bad-date' })
    expect(result).toEqual({})
  })

  it.concurrent('skips createdTime when date is invalid', () => {
    const result = mapTags({ createdTime: 'bad-date' })
    expect(result).toEqual({})
  })

  it.concurrent('skips date fields when not strings', () => {
    const result = mapTags({ lastModified: 12345, createdTime: true })
    expect(result).toEqual({})
  })

  it.concurrent('maps createdTime to created key', () => {
    const result = mapTags({ createdTime: ISO_DATE })
    expect(result).toEqual({ created: new Date(ISO_DATE) })
    expect(result).not.toHaveProperty('createdTime')
  })
})

describe('Google Drive mapTags', () => {
  const mapTags = googleDriveConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      owners: ['Alice', 'Bob'],
      originalMimeType: 'application/vnd.google-apps.document',
      modifiedTime: ISO_DATE,
      starred: true,
    })

    expect(result).toEqual({
      owners: 'Alice, Bob',
      fileType: 'Google Doc',
      lastModified: new Date(ISO_DATE),
      starred: true,
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('maps spreadsheet mime type', () => {
    const result = mapTags({ originalMimeType: 'application/vnd.google-apps.spreadsheet' })
    expect(result).toEqual({ fileType: 'Google Sheet' })
  })

  it.concurrent('maps presentation mime type', () => {
    const result = mapTags({ originalMimeType: 'application/vnd.google-apps.presentation' })
    expect(result).toEqual({ fileType: 'Google Slides' })
  })

  it.concurrent('maps text/ mime types to Text File', () => {
    const result = mapTags({ originalMimeType: 'text/plain' })
    expect(result).toEqual({ fileType: 'Text File' })
  })

  it.concurrent('falls back to raw mime type for unknown types', () => {
    const result = mapTags({ originalMimeType: 'application/pdf' })
    expect(result).toEqual({ fileType: 'application/pdf' })
  })

  it.concurrent('skips owners when not an array', () => {
    const result = mapTags({ owners: 'not-an-array' })
    expect(result).toEqual({})
  })

  it.concurrent('skips modifiedTime when date is invalid', () => {
    const result = mapTags({ modifiedTime: 'garbage' })
    expect(result).toEqual({})
  })

  it.concurrent('skips modifiedTime when not a string', () => {
    const result = mapTags({ modifiedTime: 99999 })
    expect(result).toEqual({})
  })

  it.concurrent('maps starred false', () => {
    const result = mapTags({ starred: false })
    expect(result).toEqual({ starred: false })
  })

  it.concurrent('skips starred when not a boolean', () => {
    const result = mapTags({ starred: 'yes' })
    expect(result).toEqual({})
  })

  it.concurrent('maps modifiedTime to lastModified key', () => {
    const result = mapTags({ modifiedTime: ISO_DATE })
    expect(result).toEqual({ lastModified: new Date(ISO_DATE) })
    expect(result).not.toHaveProperty('modifiedTime')
  })

  it.concurrent('maps originalMimeType to fileType key', () => {
    const result = mapTags({ originalMimeType: 'application/vnd.google-apps.document' })
    expect(result).toEqual({ fileType: 'Google Doc' })
    expect(result).not.toHaveProperty('originalMimeType')
  })
})

function streamResponse(chunks: Uint8Array[], onCancel?: () => void): Response {
  let index = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++])
      } else {
        controller.close()
      }
    },
    cancel() {
      onCancel?.()
    },
  })
  return new Response(stream)
}

describe('readBodyWithLimit', () => {
  it('returns the full buffer when the streamed body is within the cap', async () => {
    const chunk = new Uint8Array(1024).fill(65)
    const result = await readBodyWithLimit(streamResponse([chunk, chunk]), 4096)
    expect(result).not.toBeNull()
    expect(result?.byteLength).toBe(2048)
  })

  it('returns the buffer when the body is exactly at the cap', async () => {
    const chunk = new Uint8Array(1024).fill(65)
    const result = await readBodyWithLimit(streamResponse([chunk, chunk]), 2048)
    expect(result?.byteLength).toBe(2048)
  })

  it('returns null as soon as the streamed cap is exceeded', async () => {
    const chunk = new Uint8Array(1024).fill(65)
    const onCancel = vi.fn()
    const result = await readBodyWithLimit(
      streamResponse([chunk, chunk, chunk, chunk], onCancel),
      2048
    )
    expect(result).toBeNull()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not materialize a bodyless response whose size is unknown', async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array(5000).buffer)
    // double-cast-allowed: minimal response stub exercising the no-stream branch
    const unknownSize = {
      body: null,
      arrayBuffer,
    } as unknown as Response
    expect(await readBodyWithLimit(unknownSize, 4096)).toBeNull()
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('uses a trusted content length to bound a bodyless response fallback', async () => {
    // double-cast-allowed: minimal response stub exercising the no-stream branch
    const within = {
      body: null,
      headers: new Headers({ 'content-length': '100' }),
      arrayBuffer: async () => new Uint8Array(100).buffer,
    } as unknown as Response
    expect((await readBodyWithLimit(within, 4096))?.byteLength).toBe(100)
  })
})

describe('Microsoft Graph traversal cursors', () => {
  it('round-trips canonical cursors and accepts the former OneDrive JSON shape', () => {
    const state = {
      folderStack: ['folder-a', 'folder-b'],
      currentFolder: 'folder-current',
      nextLink: 'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=abc',
    }

    expect(
      decodeMicrosoftGraphTraversalCursor(
        encodeMicrosoftGraphTraversalCursor(state, 'OneDrive'),
        'OneDrive'
      )
    ).toEqual(state)
    expect(decodeMicrosoftGraphTraversalCursor(JSON.stringify(state), 'OneDrive')).toEqual(state)
  })

  it('rejects off-origin continuation URLs before they can receive a bearer token', () => {
    expect(() => assertMicrosoftGraphNextLink('https://evil.example/steal')).toThrow(
      /non-Microsoft Graph/
    )
    expect(() =>
      decodeMicrosoftGraphTraversalCursor(
        Buffer.from(
          JSON.stringify({
            folderStack: [],
            nextLink: 'https://evil.example/steal',
          })
        ).toString('base64'),
        'SharePoint'
      )
    ).toThrow(/non-Microsoft Graph/)
  })

  it('rejects invalid and oversized cursor members', () => {
    const encode = (state: unknown) => Buffer.from(JSON.stringify(state)).toString('base64')

    expect(() =>
      decodeMicrosoftGraphTraversalCursor(encode({ folderStack: [42] }), 'OneDrive')
    ).toThrow(/must be a string/)
    expect(() =>
      decodeMicrosoftGraphTraversalCursor(
        encode({ folderStack: ['x'.repeat(MICROSOFT_GRAPH_MAX_ITEM_ID_BYTES + 1)] }),
        'OneDrive'
      )
    ).toThrow(/size limit/)
    expect(() =>
      decodeMicrosoftGraphTraversalCursor(
        'x'.repeat(MICROSOFT_GRAPH_MAX_CURSOR_ENCODED_BYTES + 1),
        'OneDrive'
      )
    ).toThrow(/encoded state exceeds/)
  })

  it('enforces the pending-folder cap before mutating traversal state', () => {
    const pending = Array.from(
      { length: MICROSOFT_GRAPH_MAX_PENDING_FOLDERS },
      (_, index) => `folder-${index}`
    )

    expect(() => appendPendingMicrosoftGraphFolders(pending, ['overflow'], 'OneDrive')).toThrow(
      /Narrow the connector/
    )
    expect(pending).toHaveLength(MICROSOFT_GRAPH_MAX_PENDING_FOLDERS)
    expect(pending).not.toContain('overflow')
  })
})

describe('markSkipped', () => {
  const stub: ExternalDocument = {
    externalId: 'file-1',
    title: 'big.csv',
    content: 'should be cleared',
    contentDeferred: true,
    mimeType: 'text/csv',
    sourceUrl: 'https://example.com/big.csv',
    contentHash: 'hash-1',
    metadata: { fileSize: 20_000_000, path: '/big.csv' },
  }

  it('clears content and flags the stub as skipped while preserving identity', () => {
    const skipped = markSkipped(stub, sizeLimitSkipReason(10 * 1024 * 1024))
    expect(skipped.content).toBe('')
    expect(skipped.contentDeferred).toBe(false)
    expect(skipped.skippedReason).toBe('File exceeds the 10MB size limit and was not indexed')
    // Identity/metadata preserved so change detection + tags still work.
    expect(skipped.externalId).toBe('file-1')
    expect(skipped.contentHash).toBe('hash-1')
    expect(skipped.sourceUrl).toBe('https://example.com/big.csv')
    expect(skipped.metadata).toEqual({ fileSize: 20_000_000, path: '/big.csv' })
  })

  it('does not mutate the original stub', () => {
    markSkipped(stub, 'too big')
    expect(stub.content).toBe('should be cleared')
    expect(stub.skippedReason).toBeUndefined()
  })
})

describe('ConnectorFileTooLargeError', () => {
  it('carries the limit and is catchable by type', () => {
    const error = new ConnectorFileTooLargeError(100 * 1024 * 1024)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ConnectorFileTooLargeError)
    expect(error.limitBytes).toBe(100 * 1024 * 1024)
    expect(error.message).toContain('100MB')
  })
})

describe('isSkippedDocument', () => {
  const base: ExternalDocument = {
    externalId: 'f1',
    title: 'f1',
    content: '',
    contentDeferred: false,
    mimeType: 'text/plain',
    contentHash: 'h',
    metadata: {},
  }

  it('is true only for a markSkipped stub', () => {
    expect(isSkippedDocument(base)).toBe(false)
    expect(isSkippedDocument(markSkipped(base, 'too big'))).toBe(true)
  })
})

describe('takeIndexableWithinCap', () => {
  const skip = (id: number) => ({ id, skip: true })
  const file = (id: number) => ({ id, skip: false })
  const isSkip = (i: { skip: boolean }) => i.skip

  it('passes everything through when the cap is unlimited', () => {
    const res = takeIndexableWithinCap([file(1), skip(2), file(3)], isSkip, 0, 0)
    expect(res.documents).toHaveLength(3)
    expect(res.indexableCount).toBe(2)
    expect(res.capReached).toBe(false)
  })

  it('does not count skipped items against the cap', () => {
    const res = takeIndexableWithinCap([skip(1), skip(2), file(3), file(4), file(5)], isSkip, 2, 0)
    // both skips + the first two files emitted; the third file is beyond the cap
    expect(res.documents.map((i) => i.id)).toEqual([1, 2, 3, 4])
    expect(res.indexableCount).toBe(2)
    expect(res.capReached).toBe(true)
  })

  it('keeps emitting indexable docs even when oversized files crowd the front', () => {
    // Regression guard: an oversized prefix must not starve the indexable budget.
    const res = takeIndexableWithinCap([skip(1), skip(2), skip(3), file(4), file(5)], isSkip, 2, 0)
    expect(res.documents.map((i) => i.id)).toEqual([1, 2, 3, 4, 5])
    expect(res.indexableCount).toBe(2)
    expect(res.capReached).toBe(true)
  })

  it('stops once the indexable quota is met, dropping trailing items', () => {
    const res = takeIndexableWithinCap([file(1), file(2), file(3), file(4)], isSkip, 2, 0)
    expect(res.documents.map((i) => i.id)).toEqual([1, 2])
    expect(res.indexableCount).toBe(2)
    expect(res.capReached).toBe(true)
  })

  it('accounts for indexable docs already counted on previous pages', () => {
    const res = takeIndexableWithinCap([file(1), file(2), file(3)], isSkip, 5, 4)
    // only one indexable slot remains (5 - 4)
    expect(res.documents.map((i) => i.id)).toEqual([1])
    expect(res.indexableCount).toBe(1)
    expect(res.capReached).toBe(true)
  })

  it('emits nothing once the cap is already reached', () => {
    const res = takeIndexableWithinCap([skip(1), file(2)], isSkip, 3, 3)
    expect(res.documents).toHaveLength(0)
    expect(res.indexableCount).toBe(0)
    expect(res.capReached).toBe(true)
  })
})

describe('htmlToPlainText entity decoding', () => {
  it('decodes decimal numeric references', () => {
    expect(htmlToPlainText('<p>Labbai&#8217;s docs &#8211; part &#8230;</p>')).toBe(
      'Labbai’s docs – part …'
    )
  })

  it('decodes hex numeric references, case-insensitively', () => {
    expect(htmlToPlainText('<p>&#x2019;&#X2013;</p>')).toBe('’–')
  })

  it('decodes astral-plane code points as a surrogate pair', () => {
    expect(htmlToPlainText('<p>&#128512;</p>')).toBe('\u{1F600}')
  })

  it('still decodes the named entities it always handled', () => {
    expect(htmlToPlainText('<p>&lt;a&gt; &quot;b&quot; &#39;c&#39; d&amp;e&nbsp;f</p>')).toBe(
      '<a> "b" \'c\' d&e f'
    )
  })

  it('does not double-decode an escaped entity', () => {
    expect(htmlToPlainText('<p>&amp;#8217;</p>')).toBe('&#8217;')
  })

  it('does not double-decode a numerically escaped ampersand into a named entity', () => {
    expect(htmlToPlainText('<p>&#38;amp; &#x26;lt;</p>')).toBe('&amp; &lt;')
  })

  it('remaps windows-1252 C1 references the way a browser renders them', () => {
    expect(htmlToPlainText('<p>Labbai&#146;s &#147;docs&#148; &#151; part &#133;</p>')).toBe(
      'Labbai’s “docs” — part …'
    )
  })

  it('leaves NUL and other control references as literal text', () => {
    expect(htmlToPlainText('<p>a&#0;b&#1;c&#x7f;d</p>')).toBe('a&#0;b&#1;c&#x7f;d')
  })

  it('decodes whitespace references and folds them into the whitespace collapse', () => {
    expect(htmlToPlainText('<p>a&#10;&#9;b</p>')).toBe('a b')
  })

  it('leaves malformed and out-of-range references as literal text', () => {
    expect(htmlToPlainText('<p>&#1114112; &#xD800; &#; &#x;</p>')).toBe(
      '&#1114112; &#xD800; &#; &#x;'
    )
  })

  it('leaves an unknown named entity untouched', () => {
    expect(htmlToPlainText('<p>&copy; &notreal;</p>')).toBe('&copy; &notreal;')
  })
})

describe('isIndexableConnectorFile', () => {
  it('accepts the Office and PDF formats the knowledge base can parse', () => {
    for (const name of ['sop.pdf', 'sop.doc', 'sop.docx', 'sheet.xls', 'sheet.xlsx', 'deck.pptx']) {
      expect(isIndexableConnectorFile(name)).toBe(true)
    }
  })

  it('refuses legacy .ppt up front because no parser reads it', () => {
    expect(isIndexableConnectorFile('deck.ppt')).toBe(false)
  })

  it('still accepts the plain-text formats connectors already synced', () => {
    for (const name of ['a.txt', 'a.md', 'a.html', 'a.htm', 'a.csv', 'a.log', 'a.tsv', 'a.rst']) {
      expect(isIndexableConnectorFile(name)).toBe(true)
    }
  })

  /**
   * A document library holds the whole family, not just the headline extension:
   * macro-enabled and template variants are the same OOXML packages, `xlsb` is the
   * binary workbook, and the OpenDocument trio covers LibreOffice/Google exports.
   */
  it('accepts macro-enabled, template, binary and OpenDocument variants', () => {
    for (const name of [
      'report.docm',
      'letterhead.dotx',
      'model.xlsm',
      'model.xlsb',
      'budget.xltx',
      'deck.pptm',
      'brand.potx',
      'notes.odt',
      'sheet.ods',
      'slides.odp',
    ]) {
      expect(isIndexableConnectorFile(name)).toBe(true)
    }
  })

  it('rejects formats with no text to extract', () => {
    for (const name of ['logo.png', 'clip.mp4', 'archive.zip', 'binary.exe']) {
      expect(isIndexableConnectorFile(name)).toBe(false)
    }
  })

  /**
   * No bundled library extracts RTF. `DocParser`'s plaintext branch would accept
   * it and pass its control words through as prose, so it stays out of the set and
   * is reported as an unsupported extension instead.
   */
  it('rejects rtf rather than indexing its control words as prose', () => {
    expect(isIndexableConnectorFile('policy.rtf')).toBe(false)
  })

  it('rejects a name with no extension, and one ending in a bare dot', () => {
    expect(isIndexableConnectorFile('README')).toBe(false)
    expect(isIndexableConnectorFile('trailing.')).toBe(false)
  })

  it('ignores extension case', () => {
    expect(isIndexableConnectorFile('SOP.DOCX')).toBe(true)
  })
})

describe('extractConnectorText', () => {
  it('decodes a text format as UTF-8', () => {
    expect(extractConnectorText(Buffer.from('a,b'), 'data.csv')).toBe('a,b')
  })

  it('reduces HTML to plain text', () => {
    expect(extractConnectorText(Buffer.from('<p>Hello&nbsp;world</p>'), 'page.htm')).toBe(
      'Hello world'
    )
  })

  it('leaves whitespace-only content alone for the caller to reject', () => {
    expect(extractConnectorText(Buffer.from('   '), 'blank.txt')).toBe('   ')
  })

  it('decodes a Latin-1 file as Windows-1252 instead of indexing mojibake', () => {
    expect(extractConnectorText(Buffer.from('Caf\xe9 \xa3 42', 'latin1'), 'notes.txt')).toBe(
      'Café £ 42'
    )
  })

  it('strips a UTF-8 BOM', () => {
    expect(
      extractConnectorText(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b')]),
        'data.csv'
      )
    ).toBe('a,b')
  })

  it('decodes UTF-16 with a BOM', () => {
    expect(
      extractConnectorText(
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<p>Hällo</p>', 'utf16le')]),
        'page.html'
      )
    ).toBe('Hällo')
  })
})

describe('pipelineParsedMimeType', () => {
  /**
   * A format the shared parsers handle is delivered to them verbatim. Extracting
   * it here would strand the document on a weaker parser — notably skipping the
   * OCR the pipeline routes PDFs through — and discard the original bytes.
   */
  it.each([
    ['Report.pdf', 'application/pdf'],
    ['Deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['Book.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
    ['Notes.odt', 'application/vnd.oasis.opendocument.text'],
    ['Legacy.doc', 'application/msword'],
  ])('hands %s to the pipeline as %s', (fileName, mimeType) => {
    expect(pipelineParsedMimeType(fileName)).toBe(mimeType)
  })

  it('leaves text formats to the connector', () => {
    for (const name of ['notes.txt', 'data.csv', 'page.htm', 'feed.xml', 'rows.tsv']) {
      expect(pipelineParsedMimeType(name)).toBeUndefined()
    }
  })

  /** Derived from the extension, so a mislabelled source cannot misroute a PDF. */
  it('is case-insensitive and ignores unknown formats', () => {
    expect(pipelineParsedMimeType('REPORT.PDF')).toBe('application/pdf')
    expect(pipelineParsedMimeType('archive.zip')).toBeUndefined()
    expect(pipelineParsedMimeType('README')).toBeUndefined()
  })
})

describe('hasIndexablePayload', () => {
  const bytes = (value: string) => ({
    bytes: Buffer.from(value),
    fileName: 'Report.pdf',
    mimeType: 'application/pdf',
  })

  it('accepts a source file with bytes', () => {
    expect(hasIndexablePayload({ content: '', sourceFile: bytes('%PDF') })).toBe(true)
  })

  it('accepts extracted text', () => {
    expect(hasIndexablePayload({ content: 'notes' })).toBe(true)
  })

  /**
   * Observed in production: a zero-byte PDF was stored and shipped to OCR, which
   * answered `400 Bad Request` — an external call billed to discover the file was
   * empty, reported as an API fault rather than as an empty file. Before source
   * files existed this was dropped at the empty-content check.
   */
  it('rejects a zero-byte source file rather than sending it to OCR', () => {
    expect(hasIndexablePayload({ content: '', sourceFile: bytes('') })).toBe(false)
  })

  it('rejects blank text', () => {
    expect(hasIndexablePayload({ content: '   ' })).toBe(false)
  })
})

describe('parseDefaultedUnlimitedSafeInteger', () => {
  const ERROR = 'bad cap'

  it.each([undefined, null, '', '   '])('keeps the default for a blank field (%j)', (value) => {
    expect(parseDefaultedUnlimitedSafeInteger(value, 500, ERROR)).toBe(500)
  })

  it('reads an explicit 0 as unlimited', () => {
    expect(parseDefaultedUnlimitedSafeInteger(0, 500, ERROR)).toBe(0)
    expect(parseDefaultedUnlimitedSafeInteger('0', 500, ERROR)).toBe(0)
  })

  it('parses a set cap and rejects a malformed one', () => {
    expect(parseDefaultedUnlimitedSafeInteger(' 200 ', 500, ERROR)).toBe(200)
    expect(() => parseDefaultedUnlimitedSafeInteger('many', 500, ERROR)).toThrow(ERROR)
    expect(() => parseDefaultedUnlimitedSafeInteger(-1, 500, ERROR)).toThrow(ERROR)
  })
})

describe('isSkippableMicrosoftGraphFolderError', () => {
  const unreachable = new ConnectorListingScopeUnavailableError('folder', 403)
  const perMember = { ...PER_MEMBER_LISTING_CONTEXT }

  it('skips an unreachable descendant folder under a per-member listing', () => {
    expect(isSkippableMicrosoftGraphFolderError(unreachable, perMember, false)).toBe(true)
  })

  it('never skips the configured root', () => {
    expect(isSkippableMicrosoftGraphFolderError(unreachable, perMember, true)).toBe(false)
  })

  it('never skips under a shared credential', () => {
    expect(isSkippableMicrosoftGraphFolderError(unreachable, {}, false)).toBe(false)
    expect(isSkippableMicrosoftGraphFolderError(unreachable, undefined, false)).toBe(false)
  })

  it('never skips a fault the engine should retry', () => {
    expect(isSkippableMicrosoftGraphFolderError(new Error('500'), perMember, false)).toBe(false)
  })
})

describe('BoundedLines', () => {
  it('joins everything when the text fits', () => {
    const lines = new BoundedLines(64)
    expect(lines.push('Subject: hi', '')).toBe(true)
    expect(lines.push('--- a ---', 'body')).toBe(true)
    expect(lines.join()).toBe('Subject: hi\n\n--- a ---\nbody')
  })

  it('refuses a record that would cross the ceiling, whole, and says so in the output', () => {
    const lines = new BoundedLines(20)
    expect(lines.push('first')).toBe(true)
    expect(lines.push('--- header ---', 'a long body')).toBe(false)
    expect(lines.push('x')).toBe(false)
    expect(lines.join()).toBe('first\n[Truncated: the indexed text reached the size limit]')
  })

  it('counts encoded bytes, not characters', () => {
    const lines = new BoundedLines(6)
    expect(lines.push('éé')).toBe(true)
    expect(lines.push('é')).toBe(false)
  })

  describe('keeping the last records', () => {
    it('lets the oldest records go so the newest fit, under a header that stays', () => {
      const lines = new BoundedLines(24, 'last')
      lines.pin('# room')
      expect(lines.push('one')).toBe(true)
      expect(lines.push('two')).toBe(true)
      expect(lines.push('three')).toBe(true)
      expect(lines.push('four')).toBe(true)
      expect(lines.count).toBe(3)
      expect(lines.join()).toBe(
        '# room\n[Truncated: earlier text was left out to fit the size limit]\ntwo\nthree\nfour'
      )
    })

    it('refuses only a record that cannot fit on its own and carries on', () => {
      const lines = new BoundedLines(12, 'last')
      expect(lines.push('a very long record')).toBe(false)
      expect(lines.push('short')).toBe(true)
      expect(lines.push('next')).toBe(true)
      expect(lines.count).toBe(2)
      expect(lines.join()).toBe(
        '[Truncated: earlier text was left out to fit the size limit]\nshort\nnext'
      )
    })

    it('joins the header and records plainly when everything fits', () => {
      const lines = new BoundedLines(64, 'last')
      lines.pin('# room', '')
      lines.push('hello')
      expect(lines.join()).toBe('# room\n\nhello')
    })
  })
})
