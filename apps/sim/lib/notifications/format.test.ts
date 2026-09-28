/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { escapeTelegramHtml, formatNotificationAlert } from '@/lib/notifications/format'

describe('formatNotificationAlert', () => {
  it('lays out title, contact, reason, details, pause and link', () => {
    const text = formatNotificationAlert({
      title: 'Customer wants a person',
      contact: 'Aziz',
      channel: 'whatsapp',
      reason: 'Asked for a manager',
      details: { customer_name: 'Aziz', phone: '+998 90 123 45 67', empty: ' ' },
      pauseMode: 'temporary',
      pauseMinutes: 30,
      conversationUrl: 'https://studio.labbai.uz/workspace/ws/inbox?conversation=c&x=1',
    })

    expect(text.split('\n')[0]).toBe('🔔 <b>Customer wants a person</b>')
    expect(text).toContain('Aziz · WhatsApp')
    expect(text).toContain('<b>Customer name:</b> Aziz')
    expect(text).toContain('<b>Phone:</b> +998 90 123 45 67')
    expect(text).not.toContain('Empty')
    expect(text).toContain("⏸ AI 30 daqiqaga to'xtatildi.")
    expect(text).toContain('href="https://studio.labbai.uz/workspace/ws/inbox?conversation=c&amp;x=1"')
  })

  it('escapes customer text so it cannot break the HTML', () => {
    expect(escapeTelegramHtml('<script>"a" & b</script>')).toBe(
      '&lt;script&gt;&quot;a&quot; &amp; b&lt;/script&gt;'
    )
    const text = formatNotificationAlert({ title: 'T', reason: '</b><a href="x">hi</a>' })
    expect(text).not.toContain('<a href="x">')
  })

  it('keeps long reasons within a Telegram message', () => {
    const text = formatNotificationAlert({ title: 'T', reason: 'x'.repeat(10_000) })
    expect(text.length).toBeLessThan(4096)
  })
})
