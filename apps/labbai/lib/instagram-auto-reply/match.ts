import type { InstagramAutoReplyKeywordMode, InstagramAutoReplyMediaScope } from '@labbai/db/schema'
import { normalizeAutoReplyText } from '@/lib/instagram-auto-reply/normalize'

/**
 * Whether a normalized keyword occurs in normalized text as a whole word or a whole phrase.
 * Both sides are space-separated after normalization, so padding them with spaces turns the
 * check into a word-boundary match: "narx" matches "narx qancha" but not "narxi".
 */
function containsPhrase(normalizedText: string, normalizedKeyword: string): boolean {
  return ` ${normalizedText} `.includes(` ${normalizedKeyword} `)
}

/**
 * Whether a comment's text satisfies a rule's keywords.
 *
 * - `any`: every comment matches, keywords are ignored.
 * - `include`: at least one keyword occurs as a whole word or phrase.
 * - `exclude`: none of the keywords occurs.
 *
 * Keywords are normalized like the text, so case, Uzbek apostrophe variants, punctuation, and
 * emoji never decide a match. A keyword that normalizes to nothing (an emoji-only keyword) never
 * occurs, so it cannot make `include` match or `exclude` reject.
 *
 * @param normalizedText - Output of {@link normalizeAutoReplyText} for the comment.
 */
export function matchesKeywords(
  mode: InstagramAutoReplyKeywordMode,
  keywords: readonly string[],
  normalizedText: string
): boolean {
  if (mode === 'any') return true
  const occurs = keywords.some((keyword) => {
    const normalizedKeyword = normalizeAutoReplyText(keyword)
    return normalizedKeyword.length > 0 && containsPhrase(normalizedText, normalizedKeyword)
  })
  return mode === 'include' ? occurs : !occurs
}

/** The media fields of a rule that decide which posts it applies to. */
export interface InstagramAutoReplyMediaTarget {
  mediaScope: InstagramAutoReplyMediaScope
  mediaIds: readonly string[]
  nextMediaArmedAt: Date | null
  nextMediaId: string | null
}

/**
 * Whether a rule applies to a comment's post, without any network call.
 *
 * - `match` / `no-match`: decided.
 * - `resolve-next`: a `'next'` rule armed at go-live whose post is not known yet; the caller
 *   resolves it from the account's media once and asks again with the stored id.
 *
 * A `'next'` rule that was never armed matches nothing. A comment without a media id matches only
 * `any`.
 */
export function matchMediaScope(
  rule: InstagramAutoReplyMediaTarget,
  mediaId: string | null
): 'match' | 'no-match' | 'resolve-next' {
  switch (rule.mediaScope) {
    case 'any':
      return 'match'
    case 'specific':
      return mediaId !== null && rule.mediaIds.includes(mediaId) ? 'match' : 'no-match'
    case 'next':
      if (mediaId === null) return 'no-match'
      if (rule.nextMediaId !== null) return rule.nextMediaId === mediaId ? 'match' : 'no-match'
      return rule.nextMediaArmedAt ? 'resolve-next' : 'no-match'
  }
}

/** A post on the account as listed by Graph, reduced to what `'next'` resolution needs. */
export interface InstagramAutoReplyMediaStamp {
  id: string
  /** Graph's ISO 8601 timestamp, e.g. `2026-11-18T10:00:00+0000`. */
  timestamp: string | null
}

/**
 * Parses a Graph timestamp. Graph writes the offset without a colon (`+0000`), which is not in
 * the ECMAScript date-time format, so it is rewritten to `+00:00` before parsing.
 */
export function parseGraphTimestamp(value: string): number | null {
  const parsed = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The post a `'next'` rule resolves to: the earliest media created strictly after the rule was
 * armed. Media without a readable timestamp are ignored. Null when nothing was published since.
 */
export function pickNextMedia(
  media: readonly InstagramAutoReplyMediaStamp[],
  armedAt: Date
): string | null {
  let best: { id: string; at: number } | null = null
  for (const item of media) {
    const at = item.timestamp ? parseGraphTimestamp(item.timestamp) : null
    if (at === null || at <= armedAt.getTime()) continue
    if (!best || at < best.at) best = { id: item.id, at }
  }
  return best?.id ?? null
}
