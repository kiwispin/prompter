import test from 'node:test'
import assert from 'node:assert/strict'
import { ScriptAligner, ALIGNER_STATE, similarityRatio } from '../src/lib/aligner.js'
import { StreamingResampler } from '../src/lib/mic.js'
import { buildStartRecognition, friendlySpeechmaticsError, getTempKey, isTransientSessionLimitError, SpeechmaticsClient, wordsFrom } from '../src/lib/speechmatics.js'
import { offsetForRail, railAnchorForRows, readingRailGap } from '../src/lib/prompterGeometry.js'
import { mirrorTransform } from '../src/lib/mirror.js'
import { detectCommand } from '../src/lib/commands.js'

test('dinosaur rewinds without treating ordinary back speech as a command', () => {
  assert.equal(detectCommand('dinosaur'), 'rewind')
  assert.equal(detectCommand('okay dinosaur please'), 'rewind')
  assert.equal(detectCommand('rewind'), 'rewind')
  assert.equal(detectCommand('back'), null)
  assert.equal(detectCommand('go back'), null)
})

test('mirror transform applies to the complete presentation layer', () => {
  assert.equal(mirrorTransform(false, 'h'), 'none')
  assert.equal(mirrorTransform(true, 'h'), 'scaleX(-1)')
  assert.equal(mirrorTransform(true, 'v'), 'scaleY(-1)')
  assert.equal(mirrorTransform(true, 'both'), 'scale(-1, -1)')
})

test('reading rail is anchored inside the measured ink gap', () => {
  const gap = readingRailGap(48)
  const row = { inkBottom: 344.3 }
  const nextRow = { inkTop: 359.2 }
  const anchor = railAnchorForRows(row, nextRow, gap)
  const offset = offsetForRail(360, anchor, 0)
  assert.equal(gap, 5)
  assert.equal(anchor, 349.3)
  assert.equal(anchor + offset, 360)
  assert.ok(anchor > row.inkBottom)
  assert.ok(anchor + 2 < nextRow.inkTop)
})

test('Speechmatics start message uses the supported enhanced-model field', () => {
  const message = buildStartRecognition({ additionalVocab: ['Promptmatics'] })
  assert.equal(message.transcription_config.operating_point, 'enhanced')
  assert.equal('model' in message.transcription_config, false)
  assert.deepEqual(message.transcription_config.additional_vocab, ['Promptmatics'])
  assert.equal(message.transcription_config.conversation_config.end_of_utterance_silence_trigger, 0.7)
})

test('Speechmatics result parsing preserves timing and confidence', () => {
  assert.deepEqual(
    wordsFrom({
      results: [
        { type: 'word', end_time: 0.4, alternatives: [{ content: 'hello', confidence: 0.92 }] },
        { type: 'punctuation', alternatives: [{ content: '.' }] },
      ],
    }),
    { words: ['hello'], endTimes: [0.4], confidences: [0.92] },
  )
})

test('session concurrency quota errors retry but exhausted credit does not', () => {
  const concurrency = Object.assign(new Error('Concurrent session quota exceeded'), { type: 'quota_exceeded' })
  const funds = Object.assign(new Error('Insufficient funds'), { type: 'insufficient_funds' })
  assert.equal(isTransientSessionLimitError(concurrency), true)
  assert.equal(isTransientSessionLimitError(funds), false)
  assert.match(friendlySpeechmaticsError(concurrency), /earlier rehearsal session/i)
  assert.match(friendlySpeechmaticsError(funds), /no transcription allowance/i)
})

test('intentional client close does not report a failed recognition session', () => {
  const originalWebSocket = globalThis.WebSocket
  let closeArgs
  let closedEvents = 0
  globalThis.WebSocket = { CONNECTING: 0, OPEN: 1 }
  try {
    const client = new SpeechmaticsClient({ onClosed: () => { closedEvents += 1 } })
    client.ws = { readyState: 1, close: (...args) => { closeArgs = args } }
    client.close()
    client.handleClose({ code: 1000 })
    assert.deepEqual(closeArgs, [1000, 'Prompter session ended'])
    assert.equal(closedEvents, 0)
  } finally {
    globalThis.WebSocket = originalWebSocket
  }
})

test('manual API key is used when the configured token proxy fails', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) throw new Error('proxy offline')
    return { ok: true, json: async () => ({ key_value: 'temporary-key' }) }
  }
  try {
    assert.equal(await getTempKey({ apiKey: 'manual-key', tokenProxyUrl: 'https://proxy.test' }), 'temporary-key')
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('streaming resampling is stable across arbitrary input blocks', () => {
  const source = Float32Array.from({ length: 4410 }, (_, index) => Math.sin(index / 13))
  const whole = new StreamingResampler(44100).push(source)
  const chunkedResampler = new StreamingResampler(44100)
  const chunks = [source.subarray(0, 777), source.subarray(777, 3001), source.subarray(3001)]
    .map((chunk) => chunkedResampler.push(chunk))
  const chunked = Float32Array.from(chunks.flatMap((chunk) => [...chunk]))
  assert.ok(Math.abs(whole.length - chunked.length) <= 1)
  for (let index = 0; index < Math.min(whole.length, chunked.length); index += 1) {
    assert.ok(Math.abs(whole[index] - chunked[index]) < 1e-5)
  }
})

test('aligner keeps partial position provisional and permits revisions', () => {
  const aligner = new ScriptAligner(['alpha', 'bravo', 'charlie'])
  assert.equal(aligner.feedPartial(['alpha', 'bravo']).provisional, 2)
  assert.equal(aligner.confirmed, 0)
  assert.equal(aligner.feedPartial(['alpha']).provisional, 1)
  assert.equal(aligner.feedFinal(['alpha', 'bravo'], [0.4, 0.8], [0.9, 0.9]).confirmed, 2)
})

test('aligner tolerates close recognition errors and holds during ad-lib speech', () => {
  assert.ok(similarityRatio('promter', 'prompter') >= 82)
  const aligner = new ScriptAligner(['prompter', 'follows', 'your', 'voice'])
  aligner.feedFinal(['promter', 'follows'])
  for (const word of ['bananas', 'weatherproof', 'kangaroo', 'sideways']) aligner.feedFinal([word])
  assert.equal(aligner.state, ALIGNER_STATE.OFFSCRIPT)
  const resumed = aligner.feedFinal(['your', 'voice'])
  assert.equal(resumed.confirmed, 4)
  assert.equal(resumed.state, ALIGNER_STATE.LIVE)
})
