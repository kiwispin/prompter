import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScript } from '../src/lib/parser.js'
import { buildSegments, segmentAt, sentenceStepTarget } from '../src/lib/navigation.js'

const doc = parseScript(`# Episode 4

## Cold open

One two three four. Five six seven eight.

# Weather

Sunny today. Rain tomorrow and later.

# Sport

Football results.`)

test('segments come from top-level headings and start at their first word', () => {
  const segments = buildSegments(doc)
  assert.deepEqual(segments.map((s) => [s.number, s.title, s.startIndex]), [
    [1, 'Episode 4', 0],
    [2, 'Weather', 8],
    [3, 'Sport', 14],
  ])
  assert.equal(segmentAt(segments, 10).title, 'Weather')
})

test('a script with only subheadings still gets segments', () => {
  const segments = buildSegments(parseScript('## A\n\nHello there.\n\n## B\n\nGoodbye now.'))
  assert.deepEqual(segments.map((s) => s.title), ['A', 'B'])
})

test('stepping back repeats the current sentence, or the previous one near its start', () => {
  // Sentences: [0-3] "One two three four." [4-7] "Five six seven eight."
  assert.equal(sentenceStepTarget(doc, 6, -1), 4)
  assert.equal(sentenceStepTarget(doc, 4, -1), 0)
  assert.equal(sentenceStepTarget(doc, 5, -1), 0)
  assert.equal(sentenceStepTarget(doc, 0, -1), 0)
  assert.equal(sentenceStepTarget(doc, 1, 1), 4)
})

test('going again is spotted from the script’s opening words', async () => {
  const { findOpening } = await import('../src/lib/navigation.js')
  const script = ['welcome', 'to', 'the', 'week', 'that', 'was']
  assert.equal(findOpening(['okay', 'welcome', 'to', 'the', 'week'], script), 1)
  assert.equal(findOpening(['welcome', 'to', 'the'], script), -1)
  assert.equal(findOpening(['thanks', 'everyone', 'see', 'you', 'next', 'week'], script), -1)
  assert.equal(findOpening(['hi', 'there'], ['hi', 'there']), -1)
})

test('a take only starts on a run of script words, not stray chatter', async () => {
  const { findRunStart } = await import('../src/lib/navigation.js')
  const script = ['good', 'morning', 'and', 'welcome', 'to', 'the', 'show', 'this', 'is']
  assert.equal(findRunStart(['and'], script, 0), -1)
  assert.equal(findRunStart(['okay', 'and', 'quiet', 'please'], script, 0), -1)
  assert.equal(findRunStart(['good', 'morning', 'and'], script, 0), 0)
  assert.equal(findRunStart(['could', 'morning', 'and', 'welcome'], script, 0), 1) // misheard first word
  assert.equal(findRunStart(['this', 'is'], script, 7), 0) // fewer words left than a run
  assert.equal(findRunStart(['the', 'show', 'this'], script, 0), -1) // too far ahead of the start
})
