import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScript } from '../src/lib/parser.js'
import { matchTranscript, matchTranscriptDetailed, tokenize } from '../src/lib/matcher.js'

test('parser preserves punctuation while indexing words separately', () => {
  const doc = parseScript("Hello, world! Don't lose off-script cues.")

  assert.equal(doc.lines[0].text, "Hello, world! Don't lose off-script cues.")
  assert.deepEqual(doc.words.map((word) => word.word), [
    'Hello',
    'world',
    "Don't",
    'lose',
    'off',
    'script',
    'cues',
  ])
  assert.equal(doc.wordSentence.get(0), 0)
  assert.equal(doc.wordSentence.get(1), 0)
  assert.equal(doc.wordSentence.get(2), 1)
  assert.equal(doc.words[0].start, 0)
  assert.equal(doc.words[0].end, 5)
})

test('tokenization normalizes curly apostrophes and punctuation independently', () => {
  assert.deepEqual(tokenize("That’s fine — really."), ["that's", 'fine', 'really'])
})

test('matching prefers the nearest plausible occurrence', () => {
  const script = ['we', 'go', 'back', 'then', 'we', 'go', 'back']
  const result = matchTranscriptDetailed(tokenize('we go back'), script, 4, { final: true })

  assert.deepEqual(result, {
    start: 4,
    end: 6,
    length: 3,
    distance: 0,
    score: 300,
  })
})

test('partial one-word matches do not move the cursor without final evidence', () => {
  const script = ['hello', 'there']

  assert.equal(matchTranscript(tokenize('hello'), script, 0), -1)
  assert.equal(matchTranscript(tokenize('hello'), script, 0, { final: true }), 0)
})
