// Greedy matching of recognised speech against the script's flat word list.
//
// To avoid jumping forward on misrecognitions or on words that simply don't
// appear in the script (headings, improvised lines), the cursor only advances
// when a CONTIGUOUS run of at least MIN_RUN spoken words matches contiguous
// script words, inside a bounded window around the current position.
//
// The cursor never moves backwards. The chosen run is the longest one found;
// ties go to the furthest script position.

export const WINDOW_AHEAD = 40 // words we'll search ahead of the cursor
export const WINDOW_BACK = 3 // words we may step back to re-anchor
export const MIN_RUN = 2 // consecutive matches required to advance

export function matchTranscript(spokenWords, scriptLower, fromIndex) {
  if (!spokenWords.length || !scriptLower.length) return -1
  const spoken = spokenWords.filter((w) => !isFiller(w))
  if (!spoken.length) return -1
  const start = Math.max(0, fromIndex - WINDOW_BACK)
  const end = Math.min(scriptLower.length - 1, fromIndex + WINDOW_AHEAD)

  let bestLen = 0
  let bestEnd = -1

  for (let s = 0; s < spoken.length; s++) {
    // Can't beat the current best run from here.
    if (spoken.length - s <= bestLen) break
    for (let j = start; j <= end; j++) {
      if (end - j + 1 <= bestLen) continue
      let k = 0
      while (j + k <= end && s + k < spoken.length && scriptLower[j + k] === spoken[s + k]) {
        k++
      }
      if (k > bestLen || (k === bestLen && j + k - 1 > bestEnd)) {
        bestLen = k
        bestEnd = j + k - 1
      }
    }
  }

  return bestLen >= MIN_RUN ? bestEnd : -1
}

const FILLERS = new Set(['um', 'uh', 'er', 'erm', 'hmm', 'mm', 'uhh', 'umm', 'ah'])

function isFiller(w) {
  const clean = w.replace(/[.,!?;:'"]/g, '').toLowerCase()
  return FILLERS.has(clean)
}

// Tokenise a transcript string into lowercase, punctuation-stripped words.
export function tokenize(transcript) {
  const tokens = []
  const re = /[A-Za-z0-9']+/g
  let m
  while ((m = re.exec(transcript)) !== null) {
    tokens.push(m[0].toLowerCase().replace(/'$/, ''))
  }
  return tokens
}

export function alignTranscript(spokenWords, scriptLower, fromIndex) {
  return matchTranscript(spokenWords, scriptLower, fromIndex)
}
