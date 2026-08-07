// Greedy matching of recognised speech against the script's flat word list.
//
// The cursor never moves backwards. For each spoken word we search forward a
// limited window for the nearest script word that matches; unmatched spoken
// words (insertions / errors) are skipped. Returns the index of the furthest
// matched script word, or -1 if nothing matched.

export const LOOKAHEAD = 60 // words
export const BACKTRACK = 3 // words

export function matchTranscript(spokenWords, scriptLower, fromIndex) {
  if (!spokenWords.length || !scriptLower.length) return -1
  let cur = fromIndex
  let best = -1

  for (let s = 0; s < spokenWords.length; s++) {
    const spoken = spokenWords[s]
    if (cur >= scriptLower.length) break

    // Trim common filler so recognition noise doesn't stall tracking.
    if (isFiller(spoken)) continue

    let found = -1
    const limit = Math.min(scriptLower.length - 1, cur + LOOKAHEAD)
    for (let j = cur; j <= limit; j++) {
      if (scriptLower[j] === spoken) {
        found = j
        break
      }
    }
    // Overshot correction: check a couple words back.
    if (found < 0) {
      for (let j = Math.max(0, cur - BACKTRACK); j < cur; j++) {
        if (scriptLower[j] === spoken) {
          found = j
          break
        }
      }
    }

    if (found >= 0) {
      cur = found + 1
      best = found
    }
    // else: skip this spoken word entirely.
  }

  return best
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

// Compute a word-wise Levenshtein-style alignment that keeps the cursor
// stable when partial transcripts revise earlier words. 'fromIndex' is the
// currently locked word; we only allow movement forward.
export function alignTranscript(spokenWords, scriptLower, fromIndex) {
  return matchTranscript(spokenWords, scriptLower, fromIndex)
}
