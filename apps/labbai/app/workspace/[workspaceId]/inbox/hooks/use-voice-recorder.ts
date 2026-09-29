'use client'

import { useEffect, useRef, useState } from 'react'

/** Longest voice message the reply box records; recording stops and sends on its own after it. */
export const INBOX_VOICE_MAX_DURATION_MS = 5 * 60 * 1000

/**
 * Recording formats in order of preference. OGG/Opus (Firefox) is what Telegram and WhatsApp play
 * as a voice note, so it needs no conversion; Chrome records WebM/Opus and Safari MP4/AAC, which
 * the server converts.
 */
const RECORDING_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'] as const

const TIMER_TICK_MS = 250

export type VoiceRecorderError = 'unsupported' | 'microphone-blocked' | 'microphone-unavailable'

/** Why the microphone could not be opened, from a `getUserMedia` rejection. */
function classifyMicrophoneError(error: unknown): VoiceRecorderError {
  const name = (error as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'microphone-blocked'
  }
  return 'microphone-unavailable'
}

function pickRecordingType(): string | undefined {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
}

interface RecordingSession {
  recorder: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
  /** False when the operator cancelled: the recording is thrown away instead of sent. */
  keep: boolean
  timer: ReturnType<typeof setInterval>
}

interface UseVoiceRecorderOptions {
  /** Receives the finished recording when the operator stops it (or the time limit is hit). */
  onRecorded: (recording: Blob) => void
  onError: (error: VoiceRecorderError) => void
}

/** Tap-to-record voice messages with the browser's MediaRecorder. */
export function useVoiceRecorder({ onRecorded, onError }: UseVoiceRecorderOptions) {
  const sessionRef = useRef<RecordingSession | null>(null)
  const callbacksRef = useRef({ onRecorded, onError })
  callbacksRef.current = { onRecorded, onError }
  const [isRecording, setIsRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)

  const finish = (keep: boolean) => {
    const session = sessionRef.current
    if (!session) return
    session.keep = keep
    clearInterval(session.timer)
    if (session.recorder.state !== 'inactive') {
      session.recorder.stop()
      return
    }
    session.stream.getTracks().forEach((track) => track.stop())
    sessionRef.current = null
    setIsRecording(false)
  }

  /** Stops the microphone if the reply box goes away mid-recording. */
  useEffect(
    () => () => {
      const session = sessionRef.current
      if (!session) return
      session.keep = false
      clearInterval(session.timer)
      if (session.recorder.state !== 'inactive') session.recorder.stop()
      session.stream.getTracks().forEach((track) => track.stop())
      sessionRef.current = null
    },
    []
  )

  const start = async () => {
    if (sessionRef.current) return
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      callbacksRef.current.onError('unsupported')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      callbacksRef.current.onError(classifyMicrophoneError(error))
      return
    }

    const mimeType = pickRecordingType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const startedAt = Date.now()
    const session: RecordingSession = {
      recorder,
      stream,
      chunks: [],
      keep: true,
      timer: setInterval(() => {
        const elapsed = Date.now() - startedAt
        setElapsedMs(elapsed)
        if (elapsed >= INBOX_VOICE_MAX_DURATION_MS) finish(true)
      }, TIMER_TICK_MS),
    }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) session.chunks.push(event.data)
    }
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      clearInterval(session.timer)
      if (sessionRef.current === session) sessionRef.current = null
      setIsRecording(false)
      setElapsedMs(0)
      if (!session.keep || session.chunks.length === 0) return
      const type = recorder.mimeType || mimeType || 'audio/webm'
      callbacksRef.current.onRecorded(new Blob(session.chunks, { type }))
    }

    sessionRef.current = session
    recorder.start()
    setElapsedMs(0)
    setIsRecording(true)
  }

  return {
    isRecording,
    elapsedMs,
    start,
    /** Stops recording and hands the recording to `onRecorded`. */
    stop: () => finish(true),
    /** Stops recording and discards it. */
    cancel: () => finish(false),
  }
}
