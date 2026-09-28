/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { formatRecordingTime, voiceFileName } from '@/app/workspace/[workspaceId]/inbox/utils'

describe('voiceFileName', () => {
  it('names a recording after the format the browser recorded', () => {
    expect(voiceFileName('audio/ogg;codecs=opus')).toBe('voice.ogg')
    expect(voiceFileName('audio/webm; codecs=opus')).toBe('voice.webm')
    expect(voiceFileName('audio/mp4')).toBe('voice.m4a')
    expect(voiceFileName('audio/unknown')).toBe('voice.webm')
  })
})

describe('formatRecordingTime', () => {
  it('shows minutes and zero-padded seconds', () => {
    expect(formatRecordingTime(0)).toBe('0:00')
    expect(formatRecordingTime(9_999)).toBe('0:09')
    expect(formatRecordingTime(75_000)).toBe('1:15')
  })
})

