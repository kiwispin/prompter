import { useCallback, useState } from 'react'
import { load, save, remove, KEYS } from '../lib/storage'
import { TOKEN_PROXY_URL } from '../config'

export const DEFAULT_SETTINGS = {
  mode: 'voice', // 'constant' | 'voice'
  source: 'demo', // 'demo' | 'mic'
  baselineWpm: 150,
  autoLoop: false,
  readingPos: 'center', // 'top' | 'center' | 'bottom'
  matching: 'word', // 'none' | 'word' | 'line'
  voiceCommands: true,
  tokenProxyUrl: TOKEN_PROXY_URL,
  fontSize: 44,
  lineHeight: 1.55,
  sideMargins: 10, // percent 0-40
  fontFamily: 'sans', // 'sans' | 'serif' | 'mono'
  mirror: false,
  mirrorAxis: 'none', // 'none' | 'h' | 'v' | 'both'
  eyeline: 'none', // 'none' | 'arrow' | 'line' | 'band'
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
