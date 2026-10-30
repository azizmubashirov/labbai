import type { RubaiSttParams, RubaiSttV2Params, SttResponse } from '@/tools/stt/types'
import type { InternalToolConfig } from '@/tools/types'

export const rubaiSttTool: InternalToolConfig<RubaiSttParams, SttResponse> = {
  id: 'stt_rubai',
  name: 'RubaiSTT',
  description: 'Transcribe Uzbek audio to text using RubaiSTT, a model trained on Uzbek speech',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'STT provider (rubai)',
    },
    audioFile: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Audio or video file to transcribe (e.g., OGG, MP3, WAV, M4A)',
    },
    audioFileReference: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Reference to audio/video file from previous blocks',
    },
    audioUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to audio or video file',
    },
  },

  operation: {
    input: (params) => ({
      provider: 'rubai',
      audioFile: params.audioFile,
      audioFileReference: params.audioFileReference,
      audioUrl: params.audioUrl,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error || 'Transcription failed',
        output: {
          transcript: '',
        },
      }
    }

    return {
      success: true,
      output: {
        transcript: data.transcript,
        language: data.language,
        duration: data.duration,
        confidence: data.confidence,
      },
    }
  },

  outputs: {
    transcript: { type: 'string', description: 'Full transcribed text' },
    language: { type: 'string', description: 'Language of the transcript (uz)' },
    duration: { type: 'number', description: 'Audio duration in seconds' },
    confidence: { type: 'number', description: 'Overall confidence score (0-1)' },
  },
}

const rubaiSttV2Params = {
  provider: rubaiSttTool.params.provider,
  audioFile: rubaiSttTool.params.audioFile,
  audioFileReference: rubaiSttTool.params.audioFileReference,
} satisfies InternalToolConfig['params']

export const rubaiSttV2Tool: InternalToolConfig<RubaiSttV2Params, SttResponse> = {
  ...rubaiSttTool,
  id: 'stt_rubai_v2',
  params: rubaiSttV2Params,
  operation: {
    ...rubaiSttTool.operation,
    input: (params) => ({
      provider: 'rubai',
      audioFile: params.audioFile,
      audioFileReference: params.audioFileReference,
    }),
  },
}
