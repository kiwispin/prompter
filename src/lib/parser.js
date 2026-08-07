// Parses a script into display lines with word-level tracking metadata.
//
// Line types:
//   'heading'  — starts with `#` (or `##` etc). Displayed, never read/tracked.
//   'cue'      — a line made up entirely of [brackets] (one or many). Displayed
//                as a direction, ignored by tracking.
//   'text'     — spoken content. Inline [brackets] are shown as cues but never
//                tracked. Its words are tracked.
//
// Words across text lines form a single flat list; each word knows its global
// index and which line it belongs to.

export const LINE_TEXT = 'text'
export const LINE_HEADING = 'heading'
export const LINE_CUE = 'cue'
export const LINE_BLANK = 'blank'

const WORD_RE = /[\w'’\u2019-]+/g
const BRACKET_RE = /\[[^\]]*\]/g

export function parseScript(raw) {
  const lines = []
  const words = []
  let textLineId = 0

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

    // Split the line into cue segments and spoken text segments.
    const parts = []
    let cursor = 0
    let match
    while ((match = BRACKET_RE.exec(trimmed)) !== null) {
      const before = trimmed.slice(cursor, match.index)
      if (before.trim()) {
        parts.push({ kind: 'text', text: before, words: [] })
      }
      parts.push({ kind: 'cue', text: match[0].slice(1, -1).trim(), words: [] })
      cursor = match.index + match[0].length
    }
    const after = trimmed.slice(cursor)
    if (after.trim()) {
      parts.push({ kind: 'text', text: after, words: [] })
    }

    const cueParts = parts.filter((p) => p.kind === 'cue')
    const textParts = parts.filter((p) => p.kind === 'text')

    // A line that is only brackets is a stage cue.
    if (textParts.length === 0 && cueParts.length > 0) {
      lines.push({
        type: LINE_CUE,
        text: trimmed,
        cues: cueParts.map((p) => p.text),
        words: [],
      })
      continue
    }

    // Otherwise it's spoken content; collect tracked words from text parts.
    const lineWords = []
    for (const part of textParts) {
      let wmatch
      while ((wmatch = WORD_RE.exec(part.text)) !== null) {
        const w = {
          index: words.length,
          lineId: textLineId,
          word: wmatch[0],
          lower: wmatch[0].toLowerCase(),
        }
        part.words.push(w)
        lineWords.push(w)
        words.push(w)
      }
    }

    lines.push({
      type: LINE_TEXT,
      text: trimmed,
      parts,
      words: lineWords,
      id: textLineId,
      startIndex: lineWords.length ? lineWords[0].index : -1,
      endIndex: lineWords.length ? lineWords[lineWords.length - 1].index : -1,
    })
    textLineId++
  }

  return {
    raw,
    lines,
    words,
    totalWords: words.length,
    // Flat lookup from global word index -> line id
    wordLine: buildWordLineLookup(words),
  }
}

function buildWordLineLookup(words) {
  const map = new Map()
  for (const w of words) map.set(w.index, w.lineId)
  return map
}

// Estimated reading time in seconds for a chunk of words at wpm.
export function secondsForWords(count, wpm) {
  if (!wpm || wpm <= 0) return 0
  return (count / wpm) * 60
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}
