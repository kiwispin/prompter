// Script navigation helpers shared by clicker keys, voice commands and the
// segment list. Word indexes refer to parseScript(...).words.

import { LINE_HEADING, LINE_TEXT } from './parser.js'

// Where a sentence step should land, or null when there is nowhere to go.
// Going back from deep inside a sentence returns to its start; from its first
// two words (or just after finishing it) it goes to the sentence before, so
// "back a sentence" repeats what was just read.
export function sentenceStepTarget(doc, index, direction) {
  const sentences = doc?.sentences || []
  if (!doc?.totalWords || !sentences.length) return null
  const i = Math.max(0, Math.min(doc.totalWords - 1, Math.floor(index)))
  const currentId = doc.wordSentence.get(i) ?? 0
  const at = sentences.findIndex((s) => s.id === currentId)
  if (at < 0) return null
  if (direction > 0) return sentences[at + 1]?.startIndex ?? null
  if (i - sentences[at].startIndex > 1) return sentences[at].startIndex
  return sentences[at - 1]?.startIndex ?? sentences[at].startIndex
}

// Numbered segments from the script's top-level headings (the smallest # level
// used), each starting at the first spoken word after it.
export function buildSegments(doc) {
  const lines = doc?.lines || []
  const headings = []
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n]
    if (line.type !== LINE_HEADING) continue
    const next = lines.slice(n + 1).find((l) => l.type === LINE_TEXT && l.startIndex >= 0)
    if (next) headings.push({ title: line.text, level: line.level || 1, startIndex: next.startIndex })
  }
  if (!headings.length) return []
  const top = Math.min(...headings.map((h) => h.level))
  const segments = headings.filter((h) => h.level === top)
  return segments.map((s, k) => ({
    number: k + 1,
    title: s.title,
    startIndex: s.startIndex,
    endIndex: (segments[k + 1]?.startIndex ?? doc.totalWords) - 1,
  }))
}

// The segment containing a word index, or null before the first segment.
export function segmentAt(segments, index) {
  let found = null
  for (const s of segments) if (index >= s.startIndex) found = s
  return found
}

// After the end of a take, hearing the script's opening words means the talent
// is going again. Needs at least three opening words so a short script can't
// restart on a stray "hello".
export const OPENING_WORDS = 4

// Returns where the opening starts in the heard words, or -1.
export function findOpening(heard, scriptWords, count = OPENING_WORDS) {
  const opening = scriptWords.slice(0, count)
  if (opening.length < 3 || heard.length < opening.length) return -1
  for (let i = 0; i + opening.length <= heard.length; i++) {
    if (opening.every((w, j) => heard[i + j] === w)) return i
  }
  return -1
}

// While waiting to go again, a take only starts once the talent has said a
// short run of script words in a row from where it is waiting, so a stray
// "and" from the room can't start it. Any run within the first few words
// counts, so a misheard first word still gets going. Returns where the run
// starts in the heard words, or -1.
export function findRunStart(heard, scriptWords, from, run = 3, window = 6) {
  const need = Math.min(run, scriptWords.length - from)
  if (need <= 0) return -1
  const lastStart = Math.min(from + window - need, scriptWords.length - need)
  for (let s = from; s <= lastStart; s++) {
    for (let i = 0; i + need <= heard.length; i++) {
      let ok = true
      for (let j = 0; j < need; j++) {
        if (heard[i + j] !== scriptWords[s + j]) {
          ok = false
          break
        }
      }
      if (ok) return i
    }
  }
  return -1
}
