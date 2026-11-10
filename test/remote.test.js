import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScriptLink, markdownToScript, titleFromDisposition } from '../src/lib/remote.js'

const ID = '16YimkR6cN_tbN8iLC7P6AZiRipdjpseotKZK-pbUDZ0'

test('Google Doc share links become a Markdown export link', () => {
  for (const url of [
    `https://docs.google.com/document/d/${ID}/edit?usp=sharing`,
    `https://docs.google.com/document/u/0/d/${ID}/edit`,
    `docs.google.com/document/d/${ID}`,
  ]) {
    const link = parseScriptLink(url)
    assert.equal(link.kind, 'gdoc')
    assert.equal(link.fetchUrl, `https://docs.google.com/document/d/${ID}/export?format=md`)
  }
})

test('bad and published links give a helpful message', () => {
  assert.match(parseScriptLink('').error, /Paste/)
  assert.match(parseScriptLink('hello there').error, /link/)
  assert.match(parseScriptLink('https://docs.google.com/document/d/e/2PACX-1vabc/pub').error, /Copy link/)
  assert.equal(parseScriptLink('https://example.com/script.txt').kind, 'web')
})

test('Google Docs Markdown becomes plain script text', () => {
  const md = [
    '# **Episode 4** {#episode-4}',
    '',
    '## Intro',
    '',
    'Welcome to **the show**, I’m *Sam*\\.',
    '\\[Cut to camera 2\\]',
    'Visit [our site](https://example.com) for more\\!',
    '',
    '',
    '',
    '* First point',
    '1. Second point',
    '![][image1]',
    '| Video | Audio |',
    '| :---- | :---- |',
    '| Wide shot | Hello everyone |',
    '---',
    'Fish &amp; chips',
    '',
    '[image1]: <data:image/png;base64,AAAA>',
  ].join('\n')

  assert.equal(
    markdownToScript(md),
    [
      '# Episode 4',
      '',
      '## Intro',
      '',
      'Welcome to the show, I’m Sam.',
      '[Cut to camera 2]',
      'Visit our site for more!',
      '',
      'First point',
      'Second point',
      '',
      'Video  Audio',
      'Wide shot  Hello everyone',
      '',
      'Fish & chips',
    ].join('\n'),
  )
})

test('the doc title comes from the download filename', () => {
  assert.equal(titleFromDisposition('attachment; filename="Show.md"; filename*=UTF-8\'\'Week%203%20show.md'), 'Week 3 show')
  assert.equal(titleFromDisposition('attachment; filename="Show.md"'), 'Show')
  assert.equal(titleFromDisposition(null), '')
})

test('a speaker cue’s colon is hidden and not counted', async () => {
  const { parseScript } = await import('../src/lib/parser.js')
  const line = parseScript('[Kiana]: Welcome to the show.').lines[0]
  assert.deepEqual(line.parts.map((p) => [p.kind, p.text.trim()]), [['cue', 'Kiana'], ['text', 'Welcome to the show.']])
  assert.equal(parseScript('Time: 3pm [pause]: then go').lines[0].parts[0].text, 'Time: 3pm ')
})
