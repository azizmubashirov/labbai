/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { InstagramAutoReplyEvent } from '@/lib/api/contracts/instagram-auto-reply'
import {
  buildThreadTimeline,
  formatRecordingTime,
  voiceFileName,
} from '@/app/workspace/[workspaceId]/inbox/utils'
import type { InboxMessage } from '@/hooks/queries/inbox'

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

function message(id: string, at: string): InboxMessage {
  return {
    id,
    conversationId: 'conversation-1',
    author: 'customer',
    operatorName: null,
    text: id,
    attachments: [],
    status: 'received',
    error: null,
    createdAt: new Date(at),
  }
}

function autoReply(id: string, at: string): InstagramAutoReplyEvent {
  return {
    id,
    ruleId: 'rule-1',
    igAccountId: 'ig-1',
    sourceId: `comment-${id}`,
    triggerType: 'comment',
    mediaId: 'media-1',
    fromId: 'igsid-1',
    fromUsername: 'customer',
    text: 'price?',
    outcome: 'replied',
    publicReplyId: null,
    dmSent: true,
    dmStage: null,
    error: null,
    createdAt: new Date(at),
    updatedAt: new Date(at),
  }
}

function describeTimeline(items: ReturnType<typeof buildThreadTimeline>): string[] {
  return items.map((item) => `${item.kind}:${item.id}`)
}

describe('buildThreadTimeline', () => {
  const messages = [message('m1', '2026-11-10T10:00:00Z'), message('m2', '2026-11-10T12:00:00Z')]

  it('keeps messages alone when there are no auto-replies', () => {
    expect(
      describeTimeline(buildThreadTimeline({ messages, events: [], hasEarlierMessages: false }))
    ).toEqual(['message:m1', 'message:m2'])
  })

  it('places auto-replies between messages by time, whatever order they arrive in', () => {
    const events = [
      autoReply('e2', '2026-11-10T13:00:00Z'),
      autoReply('e1', '2026-11-10T11:00:00Z'),
      autoReply('e0', '2026-11-10T09:00:00Z'),
    ]
    expect(
      describeTimeline(buildThreadTimeline({ messages, events, hasEarlierMessages: false }))
    ).toEqual(['auto_reply:e0', 'message:m1', 'auto_reply:e1', 'message:m2', 'auto_reply:e2'])
  })

  it('holds back auto-replies older than the loaded messages while earlier ones are unloaded', () => {
    const events = [
      autoReply('e1', '2026-11-10T11:00:00Z'),
      autoReply('e0', '2026-11-10T09:00:00Z'),
    ]
    expect(
      describeTimeline(buildThreadTimeline({ messages, events, hasEarlierMessages: true }))
    ).toEqual(['message:m1', 'auto_reply:e1', 'message:m2'])
  })

  it('shows auto-replies of a contact who never sent a message', () => {
    expect(
      describeTimeline(
        buildThreadTimeline({
          messages: [],
          events: [autoReply('e1', '2026-11-10T11:00:00Z')],
          hasEarlierMessages: false,
        })
      )
    ).toEqual(['auto_reply:e1'])
  })
})
