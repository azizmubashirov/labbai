/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { USER_FILE_ACCESSIBLE_PROPERTIES } from '@/lib/workflows/types'
import { FunctionBlock } from '@/blocks/blocks/function'

describe('Function block file surface', () => {
  it('has no file configuration fields', () => {
    // Files reach the code by being referenced as <block.file.base64> — the
    // same way every other block output is referenced.
    const ids = FunctionBlock.subBlocks.map((subBlock) => subBlock.id)

    expect(ids).not.toContain('files')
    expect(ids).not.toContain('uploadedFiles')
    expect(ids).not.toContain('collectOutputFiles')
    expect(FunctionBlock.inputs).not.toHaveProperty('files')
    expect(FunctionBlock.inputs).not.toHaveProperty('collectOutputFiles')
  })

  it('is JavaScript-only with no language, sandbox, or files surface', () => {
    const ids = FunctionBlock.subBlocks.map((subBlock) => subBlock.id)

    expect(ids).not.toContain('language')
    expect(ids).not.toContain('sandboxId')
    expect(FunctionBlock.inputs).not.toHaveProperty('language')
    expect(FunctionBlock.inputs).not.toHaveProperty('sandboxId')
    expect(FunctionBlock.outputs).not.toHaveProperty('files')
  })

  it('offers path alongside base64 as a referenceable file property', () => {
    // This is what puts `.path` in the tag dropdown: block-outputs.ts maps the
    // list into `${path}.${prop}` suggestions.
    expect(USER_FILE_ACCESSIBLE_PROPERTIES).toContain('path')
    expect(USER_FILE_ACCESSIBLE_PROPERTIES).toContain('base64')
  })
})
