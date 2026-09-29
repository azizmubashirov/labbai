/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { elevenLabsAudioIsolationTool } from '@/tools/elevenlabs/audio-isolation'
import { elevenLabsSpeechToSpeechTool } from '@/tools/elevenlabs/speech-to-speech'
import { parseTool as firecrawlParseTool } from '@/tools/firecrawl/parse'
import { mistralParserTool, mistralParserV3Tool } from '@/tools/mistral/parser'
import { assemblyaiSttTool, assemblyaiSttV2Tool } from '@/tools/stt/assemblyai'
import { deepgramSttTool, deepgramSttV2Tool } from '@/tools/stt/deepgram'
import { elevenLabsSttTool, elevenLabsSttV2Tool } from '@/tools/stt/elevenlabs'
import { geminiSttTool, geminiSttV2Tool } from '@/tools/stt/gemini'
import { whisperSttTool, whisperSttV2Tool } from '@/tools/stt/whisper'
import type { ExecutableToolConfig } from '@/tools/types'
import { visionTool } from '@/tools/vision/tool'

const FILE = {
  key: 'workspace/ws-1/report.pdf',
  path: '/api/files/serve/workspace/ws-1/report.pdf',
  url: 'https://storage.example/report.pdf?signature=private',
  base64: 'raw-inline-field',
  name: 'private-report.pdf',
  size: 42,
  type: 'application/pdf',
}

function selectPrivateInputPaths(
  tool: ExecutableToolConfig,
  params: Record<string, unknown>
): readonly (readonly string[])[] {
  const modelInput = getModelInput(tool)
  if (!modelInput) return []
  if (modelInput.mode === 'private-provenance') return modelInput.inputPaths(params)
  return modelInput.privateInputPaths?.(params) ?? []
}

function getModelInput(tool: ExecutableToolConfig) {
  return tool.operation?.modelInput ?? tool.request?.modelInput
}

function getProjectingModelInput(tool: ExecutableToolConfig) {
  const modelInput = getModelInput(tool)
  expect(modelInput?.mode).toBe('project')
  if (modelInput?.mode !== 'project' || !modelInput.applyProjected) {
    throw new Error(`Expected ${tool.id} to apply projected model input`)
  }
  return modelInput
}

describe('file model-input selectors', () => {
  it.each([
    deepgramSttTool,
    deepgramSttV2Tool,
    assemblyaiSttTool,
    assemblyaiSttV2Tool,
    elevenLabsSttTool,
    elevenLabsSttV2Tool,
    geminiSttTool,
    geminiSttV2Tool,
  ])('$id does not attach private provenance for server-resolved locators', (tool) => {
    expect(selectPrivateInputPaths(tool, { file: FILE, filePath: FILE.url })).toEqual([])
    const modelInput = getModelInput(tool)
    expect(modelInput?.mode).not.toBe('private-provenance')
    if (modelInput?.mode === 'project') {
      expect(modelInput.privateInputPaths).toBeUndefined()
    }
  })

  it('keeps only inline Mistral bytes fail-closed', () => {
    expect(
      selectPrivateInputPaths(mistralParserTool, {
        filePath: 'https://example.com/document.pdf?token=private',
      })
    ).toEqual([])
    expect(
      selectPrivateInputPaths(mistralParserTool, {
        filePath: 'data:application/pdf;base64,c2VjcmV0',
      })
    ).toEqual([['filePath']])
    expect(
      selectPrivateInputPaths(mistralParserV3Tool, {
        file: { ...FILE, base64: 'effective-inline-bytes' },
      })
    ).toEqual([['file', 'base64']])
  })

  it('keeps only inline Vision bytes fail-closed', () => {
    expect(
      selectPrivateInputPaths(visionTool, {
        imageUrl: 'https://example.com/image.png?token=private',
      })
    ).toEqual([])
    expect(
      selectPrivateInputPaths(visionTool, {
        imageUrl: 'data:image/png;base64,c2VjcmV0',
      })
    ).toEqual([['imageUrl']])
    expect(
      selectPrivateInputPaths(visionTool, {
        imageFile: { ...FILE, base64: 'effective-inline-bytes' },
      })
    ).toEqual([['imageFile', 'base64']])
  })

  it('projects the Firecrawl multipart filename without rewriting the stored file', () => {
    const modelInput = getProjectingModelInput(firecrawlParseTool)
    expect(modelInput.select({ file: FILE, formats: ['summary'] })).toEqual({
      formats: [{}],
      file: { name: 'private-report.pdf' },
    })
    expect(
      modelInput.applyProjected(
        { file: FILE, formats: ['summary'] },
        { formats: [{}], file: { name: '{{FILE_NAME}}' } }
      )
    ).toEqual({ formats: ['summary'], file: { ...FILE, name: '{{FILE_NAME}}' } })
  })

  it.each([whisperSttTool, whisperSttV2Tool])(
    '$id projects the multipart filename without rewriting the audio source',
    (tool) => {
      const modelInput = getProjectingModelInput(tool)
      expect(
        modelInput.applyProjected(
          { language: 'en', prompt: 'Hint', audioFile: FILE },
          {
            language: 'en',
            prompt: 'Hint',
            audioFile: { name: '{{FILE_NAME}}' },
          }
        )
      ).toEqual({
        language: 'en',
        prompt: 'Hint',
        audioFile: { ...FILE, name: '{{FILE_NAME}}' },
      })
    }
  )

  it.each([elevenLabsSpeechToSpeechTool, elevenLabsAudioIsolationTool])(
    '$id projects the multipart filename without rewriting the audio source',
    (tool) => {
      const modelInput = getProjectingModelInput(tool)
      expect(modelInput.select({ audioFile: FILE })).toEqual({
        audioFile: { name: 'private-report.pdf' },
      })
      expect(
        modelInput.applyProjected({ audioFile: FILE }, { audioFile: { name: '{{FILE_NAME}}' } })
      ).toEqual({ audioFile: { ...FILE, name: '{{FILE_NAME}}' } })
    }
  )
})
