// Voice commands detected from the live transcript.
//
// To avoid clashing with script words, a command only fires when the ENTIRE
// spoken utterance (minus fillers and trailing politeness like "please") is
// exactly one of the known phrases. The unusual "dinosaur" wake word avoids
// accidental rewinds while reading ordinary script copy.

import { tokenize } from './matcher.js'

const FILLERS = new Set(['um', 'uh', 'er', 'erm', 'hmm', 'mm', 'uhh', 'umm', 'ah', 'ok', 'okay', 'so', 'well', 'like', 'then'])
const TRAILING = new Set(['please', 'thanks', 'thank', 'you'])

const COMMANDS = [
  {
    name: 'rewind',
    phrases: [
      ['dinosaur'],
      ['rewind'],
    ],
  },
]

export function detectCommand(transcript) {
  const words = normalize(transcript)
  if (!words.length) return null
  for (const cmd of COMMANDS) {
    for (const phrase of cmd.phrases) {
      if (sameList(words, phrase)) return cmd.name
    }
  }
  return null
}

function normalize(transcript) {
  let words = tokenize(transcript).filter((w) => !FILLERS.has(w))
  while (words.length && TRAILING.has(words[words.length - 1])) words.pop()
  return words
}

function sameList(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
