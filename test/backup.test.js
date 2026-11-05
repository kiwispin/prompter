import test from 'node:test'
import assert from 'node:assert/strict'
import { needsBackup } from '../src/lib/backup.js'
import { WELCOME_SCRIPT } from '../src/data/welcome.js'

test('empty scripts and the untouched welcome script need no backup', () => {
  assert.equal(needsBackup({ id: 's1', text: '   ' }), false)
  assert.equal(needsBackup({ id: 'welcome', text: WELCOME_SCRIPT }), false)
})

test('scripts never exported need a backup, including older saved ones', () => {
  assert.equal(needsBackup({ id: 's1', text: 'Hello there' }), true)
  assert.equal(needsBackup({ id: 'welcome', text: 'Edited welcome' }), true)
})

test('exporting clears the flag until the script changes again', () => {
  assert.equal(needsBackup({ id: 's1', text: 'Hi', updatedAt: 100, exportedAt: 200 }), false)
  assert.equal(needsBackup({ id: 's1', text: 'Hi', updatedAt: 300, exportedAt: 200 }), true)
})
