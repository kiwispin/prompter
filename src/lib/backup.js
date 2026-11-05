import { WELCOME_SCRIPT } from '../data/welcome.js'

// A script needs backing up when it has words and has changed since it was
// last exported. The untouched welcome script never does.
export function needsBackup(script) {
  if (!script || !String(script.text || '').trim()) return false
  if (script.id === 'welcome' && script.text === WELCOME_SCRIPT) return false
  if (!script.exportedAt) return true
  return (script.updatedAt || 0) > script.exportedAt
}
