/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sttOperationInputSchema } from '@/lib/internal/stt/schema'

const voiceFile = {
  id: 'voice-1',
  name: 'voice.oga',
  size: 2048,
  type: 'audio/ogg',
  key: 'workspace/ws-1/voice.oga',
}

describe('sttOperationInputSchema', () => {
  it('accepts a file-only run whose blank optional fields arrive as null', () => {
    const parsed = sttOperationInputSchema.safeParse({
      provider: 'rubai',
      audioFile: null,
      audioFileReference: voiceFile,
      audioUrl: null,
      model: null,
      language: null,
      timestamps: null,
      diarization: null,
      translateToEnglish: null,
      prompt: null,
      temperature: null,
      sentiment: null,
      entityDetection: null,
      piiRedaction: null,
      summarization: null,
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toMatchObject({ provider: 'rubai', audioFileReference: voiceFile })
    expect(parsed.data?.audioUrl).toBeUndefined()
    expect(parsed.data?.audioFile).toBeUndefined()
    expect(parsed.data?.model).toBeUndefined()
    expect(parsed.data?.temperature).toBeUndefined()
  })

  it('still rejects a present field with the wrong type', () => {
    const parsed = sttOperationInputSchema.safeParse({
      provider: 'rubai',
      audioFileReference: voiceFile,
      audioUrl: 42,
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.path).toEqual(['audioUrl'])
  })

  it('still requires an API key for providers other than rubai', () => {
    const parsed = sttOperationInputSchema.safeParse({
      provider: 'whisper',
      apiKey: null,
      audioFileReference: voiceFile,
    })

    expect(parsed.success).toBe(false)
  })
})
