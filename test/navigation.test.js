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
