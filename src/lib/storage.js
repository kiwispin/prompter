// Tiny localStorage-backed store with graceful failure on iOS private mode etc.

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(key)
  } catch {}
}

export const KEYS = {
  settings: 'prompter.settings.v1',
  scripts: 'prompter.scripts.v1',
  activeScript: 'prompter.activeScript.v1',
  speechmaticsKey: 'prompter.smkey.v1',
  seenOnboarding: 'prompter.onboarded.v1',
}
