import { useCallback, useMemo, useState } from 'react'
import { load, save, remove, KEYS } from '../lib/storage'
import { WELCOME_SCRIPT } from '../data/welcome'

const DEFAULT_SCRIPT = {
  id: 'welcome',
  name: 'Welcome to Prompter',
  text: WELCOME_SCRIPT,
}

export function useScripts() {
  const [scripts, setScripts] = useState(() => {
    const stored = load(KEYS.scripts, [])
    if (!Array.isArray(stored) || !stored.length) return [DEFAULT_SCRIPT]
    return stored
  })

  const [activeId, setActiveId] = useState(() => {
    const saved = load(KEYS.activeScript, null)
    if (saved) {
      const all = load(KEYS.scripts, [])
      if (all.some((s) => s.id === saved)) return saved
    }
    return scripts[0]?.id || DEFAULT_SCRIPT.id
  })

  const active = useMemo(
    () => scripts.find((s) => s.id === activeId) || scripts[0] || DEFAULT_SCRIPT,
    [scripts, activeId],
  )

  const persist = useCallback((list, active) => {
    save(KEYS.scripts, list)
    if (active) save(KEYS.activeScript, active)
  }, [])

  const newScript = useCallback(
    (name = 'Untitled script') => {
      const id = `s${Date.now().toString(36)}`
      const script = { id, name, text: '' }
      setScripts((prev) => {
        const next = [script, ...prev]
        persist(next, id)
        return next
      })
      setActiveId(id)
      return script
    },
    [persist],
  )

  const saveScript = useCallback(
    (id, text) => {
      setScripts((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, text } : s))
        persist(next, activeId)
        return next
      })
    },
    [persist, activeId],
  )

  const renameScript = useCallback(
    (id, name) => {
      setScripts((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, name } : s))
        persist(next, activeId)
        return next
      })
    },
    [persist, activeId],
  )

  const deleteScript = useCallback(
    (id) => {
      setScripts((prev) => {
        const next = prev.filter((s) => s.id !== id)
        const list = next.length ? next : [DEFAULT_SCRIPT]
        persist(list, null)
        return list
      })
      setActiveId((cur) => {
        if (cur !== id) return cur
        const remaining = scripts.filter((s) => s.id !== id)
        return remaining[0]?.id || DEFAULT_SCRIPT.id
      })
    },
    [persist, scripts],
  )

  const loadScript = useCallback((id) => {
    setActiveId(id)
    save(KEYS.activeScript, id)
  }, [])

  const importScript = useCallback((text) => {
    const id = `s${Date.now().toString(36)}`
    const name = guessName(text)
    const script = { id, name, text }
    setScripts((prev) => {
      const next = [script, ...prev]
      persist(next, id)
      return next
    })
    setActiveId(id)
    return script
  }, [persist])

  return {
    scripts,
    activeId,
    active,
    newScript,
    saveScript,
    renameScript,
    deleteScript,
    loadScript,
    importScript,
  }
}

function guessName(text) {
  const first = (text || '').split(/\r?\n/).find((l) => /^#{1,6}\s+/.test(l.trim()))
  if (first) return first.trim().replace(/^#{1,6}\s+/, '').slice(0, 40)
  return 'Imported script'
}
