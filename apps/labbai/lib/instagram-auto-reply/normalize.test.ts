/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { normalizeAutoReplyText } from '@/lib/instagram-auto-reply/normalize'

describe('normalizeAutoReplyText', () => {
  it('unifies every Uzbek apostrophe variant to an ASCII apostrophe', () => {
    const variants = ["o'zbek", 'o‘zbek', 'o’zbek', 'oʻzbek', 'oʼzbek', 'o`zbek', 'Oʻzbek']
    for (const variant of variants) {
      expect(normalizeAutoReplyText(variant)).toBe("o'zbek")
    }
    expect(normalizeAutoReplyText('Gʻalaba maʼlumot')).toBe("g'alaba ma'lumot")
  })

  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeAutoReplyText('  Narxi   QANCHA??!  \n\t Iltimos, javob bering.  ')).toBe(
      'narxi qancha iltimos javob bering'
    )
    expect(normalizeAutoReplyText('link-ni yuboring (tez)')).toBe('link ni yuboring tez')
  })

  it('strips emoji, including joined sequences, skin tones, and keycaps', () => {
    expect(normalizeAutoReplyText('🔥🔥 narx 👍🏽')).toBe('narx')
    expect(normalizeAutoReplyText('❤️‍🔥kerak❤️')).toBe('kerak')
    expect(normalizeAutoReplyText('1️⃣ variant')).toBe('1 variant')
    expect(normalizeAutoReplyText('👍👍👍')).toBe('')
  })

  it('keeps apostrophes inside words but drops quoting apostrophes', () => {
    expect(normalizeAutoReplyText("'narx' 'so‘m'")).toBe("narx so'm")
    expect(normalizeAutoReplyText("ma'lumot'")).toBe("ma'lumot")
  })

  it('keeps Cyrillic letters and digits', () => {
    expect(normalizeAutoReplyText('Цена 100$?')).toBe('цена 100')
  })
})
