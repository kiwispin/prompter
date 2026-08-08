// Position-aware matching of recognized speech against the script.
//
// Matching is deliberately monotonic. It prefers the nearest plausible match
// to the current cursor, which prevents repeated words later in a script from
// winning simply because they are farther ahead.

import { normalizeWord, tokenize as tokenizeText } from './text.js'

export const WINDOW_AHEAD = 32
export const WINDOW_BACK = 4
export const MIN_RUN = 2

export function matchTranscript(spokenWords, scriptLower, fromIndex, options = {}) {
  return matchTranscriptDetailed(spokenWords, scriptLower, fromIndex, options)?.end ?? -1
}

export function matchTranscriptDetailed(spokenWords, scriptLower, fromIndex, options = {}) {
  if (!spokenWords?.length || !scriptLower?.length) return null

  const spoken = spokenWords
    .map((word) => (typeof word === 'string' ? word : word.lower || word.value || ''))
    .map((word) => normalizeWord(word))
    .filter((word) => word && !isFiller(word))

  if (!spoken.length) return null

  const cursor = Math.max(0, Math.floor(fromIndex || 0))
  const start = Math.max(0, cursor - WINDOW_BACK)
  const lookAhead = options.final ? WINDOW_AHEAD + 12 : WINDOW_AHEAD
  const end = Math.min(scriptLower.length - 1, cursor + lookAhead)
  let best = null

  for (let spokenStart = 0; spokenStart < spoken.length; spokenStart += 1) {
    for (let scriptStart = start; scriptStart <= end; scriptStart += 1) {
      let length = 0
      while (
        scriptStart + length <= end &&
        spokenStart + length < spoken.length &&
        equivalent(spoken[spokenStart + length], scriptLower[scriptStart + length])
      ) {
        length += 1
      }

      if (length < MIN_RUN) {
        if (!options.final || length !== 1) continue
        const occurrences = scriptLower
          .slice(start, end + 1)
          .filter((word) => equivalent(spoken[spokenStart], word)).length
        if (occurrences > 1 && scriptStart > cursor + 4) continue
      }

      const candidate = {
        start: scriptStart,
        end: scriptStart + length - 1,
        length,
        distance: Math.abs(scriptStart - cursor),
        score: length * 100 - Math.abs(scriptStart - cursor) * 2,
      }

      if (
        !best ||
        candidate.score > best.score ||
        (candidate.score === best.score && candidate.distance < best.distance)
      ) {
        best = candidate
      }
    }
  }

  return best
}

export function tokenize(transcript) {
  return tokenizeText(transcript)
}

export function alignTranscript(spokenWords, scriptLower, fromIndex, options = {}) {
  return matchTranscript(spokenWords, scriptLower, fromIndex, options)
}

const FILLERS = new Set(['um', 'uh', 'er', 'erm', 'hmm', 'mm', 'uhh', 'umm', 'ah'])

function isFiller(word) {
  return FILLERS.has(String(word).replace(/[.,!?;:'”’"]+/g, '').toLowerCase())
}

function equivalent(a, b) {
  const left = String(a).replace(/[’‘]/g, "'").replace(/^'+|'+$/g, '')
  const right = String(b).replace(/[’‘]/g, "'").replace(/^'+|'+$/g, '')
  return left === right
}
