import { useCallback, useState } from 'react'
import { load, save, remove, KEYS } from '../lib/storage'
import { TOKEN_PROXY_URL } from '../config'

export const DEFAULT_SETTINGS = {
  uiVersion: 2,
  mode: 'voice', // 'constant' | 'voice'
  source: 'demo', // 'demo' | 'mic'
  baselineWpm: 150,
  autoLoop: false,
  readingPos: 'center', // 'top' | 'center' | 'bottom'
  eyelinePercent: 50,
  matching: 'word', // 'none' | 'word' | 'line'
  voiceCommands: true,
  tokenProxyUrl: TOKEN_PROXY_URL,
  fontSize: 44,
  lineHeight: 1.55,
  sideMargins: 10, // percent 0-40
  fontFamily: 'sans', // 'sans' | 'serif' | 'mono'
  mirror: false,
  mirrorAxis: 'none', // 'none' | 'h' | 'v' | 'both'
  eyeline: 'line', // 'none' | 'arrow' | 'line' | 'band'
  showHud: true,
  showCues: true,
  countdownOnStart: true,
}

function migrate(stored) {
  const s = { ...stored }
  // Older versions used a boolean "highlight" toggle.
  if (typeof s.highlight === 'boolean') {
    if (!s.highlight && s.matching !== 'none') s.matching = 'none'
    delete s.highlight
  }
  if (!Number.isFinite(s.eyelinePercent)) {
    s.eyelinePercent = { top: 18, center: 50, bottom: 85 }[s.readingPos] ?? DEFAULT_SETTINGS.eyelinePercent
  }
  if (!s.uiVersion || s.uiVersion < 2) {
    if (!s.eyeline || s.eyeline === 'none') s.eyeline = 'line'
    s.uiVersion = 2
  }
  return s
}

export function useSettings() {
  const [settings, setSettings] = useState(() => ({
    ...DEFAULT_SETTINGS,
    ...migrate(load(KEYS.settings, {})),
  }))

  const setSetting = useCallback((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      save(KEYS.settings, next)
      return next
    })
  }, [])

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    save(KEYS.settings, DEFAULT_SETTINGS)
  }, [])

  const [speechmaticsKey, setSpeechmaticsKey] = useState(() =>
    load(KEYS.speechmaticsKey, ''),
  )

  const saveSpeechmaticsKey = useCallback((key) => {
    const trimmed = (key || '').trim()
    setSpeechmaticsKey(trimmed)
    if (trimmed) save(KEYS.speechmaticsKey, trimmed)
    else remove(KEYS.speechmaticsKey)
  }, [])

  return {
    settings,
    setSetting,
    resetSettings,
    speechmaticsKey,
    saveSpeechmaticsKey,
  }
}
