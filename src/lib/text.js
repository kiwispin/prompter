// Shared text tokenisation for display and speech matching.
//
// Display text keeps its original punctuation and whitespace. Tracking uses
// these normalized word tokens separately, so highlighting never changes the
// layout of the script.

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu

export function normalizeWord(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^'+|'+$/g, '')
}

export function tokenizeWithRanges(text) {
  const source = String(text || '')
  const tokens = []
  let match

  while ((match = WORD_RE.exec(source)) !== null) {
    tokens.push({
      value: match[0],
      lower: normalizeWord(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return tokens
}

export function tokenize(text) {
  return tokenizeWithRanges(text)
    .map((token) => token.lower)
    .filter(Boolean)
}

export function hasSentenceBoundary(text) {
  return /[.!?](?:['”’"»)]*)?(?:\s|$)/u.test(String(text || ''))
}
