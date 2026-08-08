import { normalizeWord } from './text.js'

export const ALIGNER_STATE = Object.freeze({
  IDLE: 'idle',
  LIVE: 'live',
  PAUSED: 'paused',
  OFFSCRIPT: 'offscript',
  CUED: 'cued',
})

const COMMON = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'had', 'has', 'have', 'he', 'her',
  'his', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'she', 'so',
  'that', 'the', 'their', 'them', 'then', 'there', 'they', 'this', 'to', 'up', 'us', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'will', 'with', 'you', 'your',
])

const STRONG_SIMILARITY = 88
const ASSERTIVE_SIMILARITY = 92

export class ScriptAligner {
  constructor(words, options = {}) {
    this.tokens = (words || []).map((word, index) => ({
      index,
      normal: normalizeWord(typeof word === 'string' ? word : word.lower || word.word),
    }))
    this.window = options.window ?? 12
    this.threshold = options.threshold ?? 82
    this.offscriptAfter = options.offscriptAfter ?? 4
    this.confirmed = 0
    this.provisional = 0
    this.state = ALIGNER_STATE.IDLE
    this.misses = 0
    this.previouslyMatched = false
    this.unmatched = []
    this.wordTimes = []
    this.anchorIndex = new Map()

    for (const token of this.tokens) {
      if (token.normal.length < 4) continue
      const entries = this.anchorIndex.get(token.normal) || []
      entries.push(token.index)
      this.anchorIndex.set(token.normal, entries)
    }
  }

  feedPartial(words) {
    return this.feed(words, { final: false })
  }

  feedFinal(words, endTimes = [], confidences = []) {
    return this.feed(words, { final: true, endTimes, confidences })
  }

  feed(words, { final, endTimes = [], confidences = [] }) {
    if (!words?.length || !this.tokens.length) return this.snapshot(false)

    let position = this.confirmed
    let misses = this.misses
    let previouslyMatched = this.previouslyMatched
    let unmatched = this.unmatched.slice(-8)
    let anyMatch = false
    let changed = false
    let tentative = null

    const commit = (scriptIndex, spokenIndex) => {
      position = scriptIndex + 1
      misses = 0
      previouslyMatched = true
      unmatched = []
      anyMatch = true
      changed = true
      this.state = ALIGNER_STATE.LIVE
      if (final) {
        const time = endTimes[spokenIndex]
        const timestamp = Number.isFinite(time) ? time : performanceNow()
        if (this.wordTimes.length && timestamp < this.wordTimes[this.wordTimes.length - 1]) this.wordTimes = []
        this.wordTimes.push(timestamp)
        if (this.wordTimes.length > 600) this.wordTimes.shift()
      }
    }

    const miss = (word) => {
      misses += 1
      previouslyMatched = false
      unmatched.push(word)
      if (unmatched.length > 8) unmatched.shift()
      if ([ALIGNER_STATE.LIVE, ALIGNER_STATE.PAUSED].includes(this.state) && misses >= this.offscriptAfter) {
        this.state = ALIGNER_STATE.OFFSCRIPT
        changed = true
      }
    }

    for (let spokenIndex = 0; spokenIndex < words.length; spokenIndex += 1) {
      const spoken = normalizeWord(words[spokenIndex])
      if (!spoken) continue

      if (tentative) {
        const continuation = this.find(spoken, tentative.scriptIndex + 1, 3)
        const held = tentative
        tentative = null
        if (continuation) {
          commit(held.scriptIndex, held.spokenIndex)
          commit(continuation.index, spokenIndex)
          continue
        }
        miss(held.word)
      }

      const found = this.find(spoken, position)
      if (!found) {
        miss(spoken)
        if (final && this.state !== ALIGNER_STATE.CUED && misses >= 3) {
          const relocated = this.relocate(unmatched)
          if (relocated) {
            position = relocated.end
            misses = 0
            previouslyMatched = true
            unmatched = []
            anyMatch = true
            changed = true
            this.state = ALIGNER_STATE.LIVE
          }
        }
        continue
      }

      const gap = found.index - position
      if (gap > 2) {
        const confidence = confidences[spokenIndex]
        const assertive =
          found.similarity >= ASSERTIVE_SIMILARITY &&
          spoken.length >= 4 &&
          !COMMON.has(spoken) &&
          (!Number.isFinite(confidence) || confidence >= 0.6)
        if (assertive && this.state !== ALIGNER_STATE.OFFSCRIPT) commit(found.index, spokenIndex)
        else tentative = { scriptIndex: found.index, spokenIndex, word: spoken }
        continue
      }

      const strong = found.similarity >= STRONG_SIMILARITY && spoken.length >= 4
      if (this.state === ALIGNER_STATE.CUED || previouslyMatched || (strong && this.state !== ALIGNER_STATE.OFFSCRIPT)) {
        commit(found.index, spokenIndex)
      } else {
        tentative = { scriptIndex: found.index, spokenIndex, word: spoken }
      }
    }

    if (tentative) miss(tentative.word)

    if (final) {
      this.misses = misses
      this.previouslyMatched = previouslyMatched
      this.unmatched = unmatched
      if (anyMatch && position > this.confirmed) this.confirmed = position
      this.provisional = this.confirmed
    } else {
      this.provisional = anyMatch ? position : this.confirmed
    }
    return this.snapshot(changed)
  }

  find(spoken, position, window = this.window) {
    const limit = Math.min(this.tokens.length, position + window)
    for (let index = position; index < limit; index += 1) {
      const similarity = similarityRatio(spoken, this.tokens[index].normal)
      if (similarity >= this.threshold) return { index, similarity }
    }
    return null
  }

  relocate(unmatched) {
    const recent = unmatched.slice(-6)
    if (recent.length < 3) return null
    let best = null

    for (let offset = 0; offset < Math.min(3, recent.length - 2); offset += 1) {
      const anchor = recent[offset]
      if (anchor.length < 4) continue
      for (const start of (this.anchorIndex.get(anchor) || []).slice(0, 60)) {
        let position = start + 1
        let hits = 1
        let newestMatched = false
        for (let index = offset + 1; index < recent.length; index += 1) {
          const found = this.find(recent[index], position, 2)
          if (found && found.similarity >= STRONG_SIMILARITY) {
            hits += 1
            position = found.index + 1
            newestMatched = index === recent.length - 1
          }
        }

        const distance = Math.abs(start - this.confirmed)
        const forwardNearby = start >= this.confirmed && distance <= 40
        const required = forwardNearby ? 3 : 5
        if (hits >= required && newestMatched && (!best || distance < best.distance)) {
          best = { start, end: position, distance }
        }
      }
    }
    return best
  }

  endUtterance() {
    if (this.state === ALIGNER_STATE.LIVE) this.state = ALIGNER_STATE.PAUSED
    this.misses = 0
    this.unmatched = []
    return this.snapshot(true)
  }

  jumpTo(index) {
    const position = Math.max(0, Math.min(this.tokens.length, Math.floor(index)))
    this.confirmed = position
    this.provisional = position
    this.state = ALIGNER_STATE.CUED
    this.misses = 0
    this.previouslyMatched = true
    this.unmatched = []
    return this.snapshot(true)
  }

  get wpm() {
    if (this.wordTimes.length < 3) return 0
    const latest = this.wordTimes[this.wordTimes.length - 1]
    const recent = this.wordTimes.filter((time) => time >= latest - 20)
    const span = latest - recent[0]
    return recent.length >= 3 && span >= 2 ? ((recent.length - 1) / span) * 60 : 0
  }

  snapshot(changed = true) {
    return {
      confirmed: this.confirmed,
      provisional: this.provisional,
      state: this.state,
      wpm: Math.round(this.wpm),
      changed,
    }
  }
}

export function similarityRatio(left, right) {
  if (left === right) return 100
  if (!left || !right || left.length <= 2 || right.length <= 2) return 0
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) return 0
  const distance = levenshtein(left, right)
  return (1 - distance / Math.max(left.length, right.length)) * 100
}

function levenshtein(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[right.length]
}

function performanceNow() {
  return (globalThis.performance?.now?.() ?? Date.now()) / 1000
}
