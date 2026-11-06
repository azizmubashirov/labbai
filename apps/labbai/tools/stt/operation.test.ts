/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sttOperationInputSchema } from '@/lib/internal/stt/schema'
import { assemblyaiSttTool, assemblyaiSttV2Tool } from '@/tools/stt/assemblyai'
import { deepgramSttTool, deepgramSttV2Tool } from '@/tools/stt/deepgram'
import { elevenLabsSttTool, elevenLabsSttV2Tool } from '@/tools/stt/elevenlabs'
import { geminiSttTool, geminiSttV2Tool } from '@/tools/stt/gemini'
import { rubaiSttTool, rubaiSttV2Tool } from '@/tools/stt/rubai'
import { whisperSttTool, whisperSttV2Tool } from '@/tools/stt/whisper'

const tools = [
  assemblyaiSttTool,
  assemblyaiSttV2Tool,
  deepgramSttTool,
  deepgramSttV2Tool,
  elevenLabsSttTool,
  elevenLabsSttV2Tool,
  geminiSttTool,
  geminiSttV2Tool,
  rubaiSttTool,
  rubaiSttV2Tool,
  whisperSttTool,
  whisperSttV2Tool,
]

describe('STT internal operations', () => {
  it('declares every STT tool as an operation without HTTP-shaped metadata', () => {
    for (const tool of tools) {
      expect(tool.operation.input).toBeTypeOf('function')
      expect(tool).not.toHaveProperty('request')
      expect(tool.operation).not.toHaveProperty('transport')
      expect(tool.operation).not.toHaveProperty('url')
      expect(tool.operation).not.toHaveProperty('method')
      expect(tool.operation).not.toHaveProperty('headers')
      expect(tool.operation).not.toHaveProperty('body')
    }
  })

  it('materializes provider defaults without serializing trusted execution context', () => {
    const input = whisperSttTool.operation.input({
      provider: 'whisper',
      apiKey: 'key',
      audioUrl: 'https://example.com/audio.mp3',
      language: '',
      timestamps: undefined,
      translateToEnglish: undefined,
    })

    expect(input).toMatchObject({
      provider: 'whisper',
      apiKey: 'key',
      audioUrl: 'https://example.com/audio.mp3',
      language: 'auto',
      timestamps: 'none',
      translateToEnglish: false,
    })
    expect(input).not.toHaveProperty('workspaceId')
    expect(input).not.toHaveProperty('workflowId')
    expect(input).not.toHaveProperty('executionId')
  })

  it('keeps v2 inputs file-only', () => {
    const input = deepgramSttV2Tool.operation.input({
      provider: 'deepgram',
      apiKey: 'key',
      audioFile: {
        id: 'audio-1',
        name: 'audio.mp3',
        size: 5,
        type: 'audio/mpeg',
        key: 'workspace/ws-1/audio.mp3',
      },
    })

    expect(input).not.toHaveProperty('audioUrl')
  })

  it('passes a legacy file-only run with an empty URL field through validation', () => {
    const voiceFile = {
      id: 'voice-1',
      name: 'voice.oga',
      size: 2048,
      type: 'audio/ogg',
      key: 'workspace/ws-1/voice.oga',
    }
    const legacyTools = [
      assemblyaiSttTool,
      deepgramSttTool,
      elevenLabsSttTool,
      geminiSttTool,
      rubaiSttTool,
      whisperSttTool,
    ]

    for (const tool of legacyTools) {
      const input = tool.operation.input({
        provider: tool.id.replace('stt_', ''),
        apiKey: 'key',
        audioFileReference: voiceFile,
        audioUrl: null,
        model: null,
        language: null,
        prompt: null,
        temperature: null,
      } as unknown as Parameters<typeof tool.operation.input>[0])

      const parsed = sttOperationInputSchema.safeParse(input)
      expect(parsed.success, tool.id).toBe(true)
      expect(parsed.data?.audioUrl).toBeUndefined()
    }
  })
})
