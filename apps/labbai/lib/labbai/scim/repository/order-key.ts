import { generateShortId } from '@labbai/utils/id'

const SUFFIX_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * A lexicographically ascending pagination key: zero-padded creation time plus
 * a random suffix, so rows created in the same millisecond still order stably
 * and a provider paging with `startIndex` never sees a row move between pages.
 */
export function nextScimOrderKey(now: Date = new Date()): string {
  return `${now.getTime().toString().padStart(15, '0')}-${generateShortId(10, SUFFIX_ALPHABET)}`
}
