/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  createSourceLabelMetadata,
  describeSearchSource,
  normalizeSourceSelectionLabels,
  readSourceSelectionLabels,
  SOURCE_LABELS_KEY,
  searchSourceIdentity,
} from '@/lib/labbai-search/source-identity'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'

describe('Search source identity', () => {
  it('uses selected folder names without changing deduplication identity', () => {
    const config = { folderId: ['folder-b', 'folder-a'] }
    const sourceLabels = createSourceLabelMetadata(googleDriveConnectorMeta, config, {
      folderId: [
        { id: 'folder-a', label: 'Engineering' },
        { id: 'folder-b', label: 'Company docs' },
      ],
    })
    const labeledConfig = { ...config, [SOURCE_LABELS_KEY]: sourceLabels }
    expect(describeSearchSource(googleDriveConnectorMeta, labeledConfig)).toBe(
      'Engineering · Company docs'
    )
    expect(searchSourceIdentity(googleDriveConnectorMeta, labeledConfig)).toBe(
      searchSourceIdentity(googleDriveConnectorMeta, config)
    )
  })

  it('drops saved labels when selections or source settings change', () => {
    const config = { folderId: ['folder-a'], fileType: 'documents' }
    const labeledConfig = {
      ...config,
      [SOURCE_LABELS_KEY]: createSourceLabelMetadata(googleDriveConnectorMeta, config, {
        folderId: [{ id: 'folder-a', label: 'Engineering' }],
      }),
    }
    for (const changed of [{ folderId: ['folder-b'] }, { fileType: 'spreadsheets' }]) {
      expect(describeSearchSource(googleDriveConnectorMeta, { ...labeledConfig, ...changed })).toBe(
        '1 folder selected'
      )
    }
  })

  it('rejects mismatched or partial label sets even when the config identity matches', () => {
    const config = { folderId: ['folder-a', 'folder-b'] }
    for (const options of [
      [{ id: 'folder-a', label: 'Engineering' }],
      [{ id: 'other-folder', label: 'Unrelated docs' }],
    ]) {
      expect(
        describeSearchSource(googleDriveConnectorMeta, {
          ...config,
          [SOURCE_LABELS_KEY]: {
            identity: searchSourceIdentity(googleDriveConnectorMeta, config),
            fields: { folderId: options },
          },
        })
      ).toBe('2 folders selected')
    }
  })

  it('bounds metadata, rejects ID-only labels, and never reads secret config fields as labels', () => {
    for (const options of [
      [{ id: 'folder-a', label: 'folder-a' }],
      [{ id: 'folder-a', label: 'x'.repeat(161) }],
      [{ id: 'folder-a', label: 'Unsafe\nlabel' }],
      Array.from({ length: 51 }, (_, index) => ({
        id: `folder-${index}`,
        label: `Folder ${index}`,
      })),
    ]) {
      expect(normalizeSourceSelectionLabels({ folderId: options })).toEqual({})
    }
    const config = { folderId: ['folder-a'], apiKey: 'secret' }
    const metadata = createSourceLabelMetadata(googleDriveConnectorMeta, config, {
      folderId: [{ id: 'folder-a', label: 'Engineering', secret: 'do not persist' }],
      apiKey: [{ id: 'secret', label: 'do not display' }],
    })
    expect(metadata?.fields).toEqual({ folderId: [{ id: 'folder-a', label: 'Engineering' }] })
    expect(
      readSourceSelectionLabels(googleDriveConnectorMeta, { ...config, _sourceLabels: {} })
    ).toEqual({})
    expect(
      describeSearchSource(googleDriveConnectorMeta, { ...config, _sourceLabels: metadata })
    ).toBe('Engineering')
  })
})
