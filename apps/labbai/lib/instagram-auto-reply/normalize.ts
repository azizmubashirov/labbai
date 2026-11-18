/**
 * Apostrophe look-alikes Uzbek Latin text is typed with: ASCII `'`, the curly quotes `‘` and `’`,
 * the modifier letters `ʻ` (o‘, g‘) and `ʼ` (tutuq belgisi), and the backtick. They all become `'`
 * so "o‘zbek", "oʻzbek" and "o'zbek" compare equal.
 */
const APOSTROPHE_VARIANTS = /['‘’ʻʼ`]/g

/**
 * Emoji and the invisible parts of emoji sequences: pictographs, skin-tone modifiers, variation
 * selectors, the keycap mark, and the zero-width joiner. Removed before the word filter because
 * variation selectors and the keycap are combining marks it would otherwise keep.
 */
const EMOJI_PARTS = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0E|\uFE0F|\u20E3|\u200D/gu

/** Anything that is not a letter, a combining mark, a digit, an apostrophe, or whitespace. */
const NON_WORD_CHARACTERS = /[^\p{L}\p{M}\p{N}'\s]/gu

/** An apostrophe that is not between two word characters is quoting, not spelling. */
const LOOSE_APOSTROPHES = /(?<![\p{L}\p{M}\p{N}])'|'(?![\p{L}\p{N}])/gu

const WHITESPACE_RUNS = /\s+/g

/**
 * Brings comment text and keywords to one comparable form: Unicode-compatibility folded,
 * lowercased, Uzbek apostrophe variants unified to `'`, punctuation and emoji replaced by spaces,
 * apostrophes kept only inside words, and whitespace collapsed to single spaces.
 *
 * @example normalizeAutoReplyText('Narxi QANCHA?? 🔥 O‘zbekcha') === "narxi qancha o'zbekcha"
 */
export function normalizeAutoReplyText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(APOSTROPHE_VARIANTS, "'")
    .replace(EMOJI_PARTS, ' ')
    .replace(NON_WORD_CHARACTERS, ' ')
    .replace(LOOSE_APOSTROPHES, ' ')
    .replace(WHITESPACE_RUNS, ' ')
    .trim()
}
