// Parses a script into display lines with word-level tracking metadata.
//
// The original source text is preserved for rendering. Words are tracked in a
// separate flat index, so punctuation and whitespace remain visible without
// affecting recognition or scroll state.

import { hasSentenceBoundary, tokenizeWithRanges } from './text.js'

export const LINE_TEXT = 'text'
export const LINE_HEADING = 'heading'
export const LINE_CUE = 'cue'
export const LINE_BLANK = 'blank'

const BRACKET_RE = /\[[^\]]*\]/g

export function parseScript(raw) {
  const lines = []
  const words = []
  const wordSentence = new Map()
  const sentences = []
  let textLineId = 0
  let sentenceId = 0

  const srcLines = String(raw || '').split(/\r\n|\r|\n/)

  for (const src of srcLines) {
    const trimmed = src.trim()
    if (!trimmed) {
      lines.push({ type: LINE_BLANK, text: '', words: [] })
      continue
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      lines.push({
        type: LINE_HEADING,
        text: trimmed.replace(/^#{1,6}\s+/, ''),
        words: [],
      })
      continue
    }

    const parts = []
    let cursor = 0
    let match
    BRACKET_RE.lastIndex = 0

    while ((match = BRACKET_RE.exec(trimmed)) !== null) {
      const before = trimmed.slice(cursor, match.index)
      if (before.trim()) parts.push({ kind: 'text', text: before, words: [] })
      parts.push({ kind: 'cue', text: match[0].slice(1, -1).trim(), words: [] })
      cursor = match.index + match[0].length
    }

    const after = trimmed.slice(cursor)
    if (after.trim()) parts.push({ kind: 'text', text: after, words: [] })

    const cueParts = parts.filter((part) => part.kind === 'cue')
    const textParts = parts.filter((part) => part.kind === 'text')

    if (textParts.length === 0 && cueParts.length > 0) {
      lines.push({
        type: LINE_CUE,
        text: trimmed,
        cues: cueParts.map((part) => part.text),
        words: [],
      })
      continue
    }

    const lineWords = []
    let lineHasBoundary = false

    for (const part of textParts) {
      const tokens = tokenizeWithRanges(part.text)
      part.words = []

      for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i]
        const word = {
          index: words.length,
          lineId: textLineId,
          sentenceId,
          word: token.value,
          lower: token.lower,
          start: token.start,
          end: token.end,
        }
        words.push(word)
        lineWords.push(word)
        wordSentence.set(word.index, sentenceId)
        part.words.push(word)

        const nextStart = tokens[i + 1]?.start ?? part.text.length
        if (hasSentenceBoundary(part.text.slice(tokens[i].end, nextStart))) {
          lineHasBoundary = true
          sentenceId += 1
        }
      }
    }

    if (lineWords.length) {
      for (const word of lineWords) {
        const existing = sentences[word.sentenceId]
        if (existing) {
          existing.endIndex = word.index
        } else {
          sentences[word.sentenceId] = {
            id: word.sentenceId,
            startIndex: word.index,
            endIndex: word.index,
          }
        }
      }

      // Source lines are useful authoring boundaries even when a line has no
      // terminal punctuation. Do not merge the next paragraph into this one.
      if (!lineHasBoundary) sentenceId += 1
    }

    lines.push({
      type: LINE_TEXT,
      text: trimmed,
      parts,
      words: lineWords,
      id: textLineId,
      startIndex: lineWords.length ? lineWords[0].index : -1,
      endIndex: lineWords.length ? lineWords[lineWords.length - 1].index : -1,
      sentenceStart: lineWords.length ? lineWords[0].sentenceId : -1,
      sentenceEnd: lineWords.length ? lineWords[lineWords.length - 1].sentenceId : -1,
    })
    textLineId += 1
  }

  return {
    raw,
    lines,
    words,
    sentences: sentences.filter(Boolean),
    totalWords: words.length,
    wordLine: buildWordLineLookup(words),
    wordSentence,
  }
}

function buildWordLineLookup(words) {
  const map = new Map()
  for (const word of words) map.set(word.index, word.lineId)
  return map
}

export function secondsForWords(count, wpm) {
  if (!wpm || wpm <= 0) return 0
  return (count / wpm) * 60
}

export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}
