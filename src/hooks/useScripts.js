import { useCallback, useMemo, useState } from 'react'
import { load, save, remove, KEYS } from '../lib/storage'
import { WELCOME_SCRIPT } from '../data/welcome'

const DEFAULT_SCRIPT = {
  id: 'welcome',
  name: 'Welcome to Prompter',
  text: WELCOME_SCRIPT,
}

export { needsBackup } from '../lib/backup.js'

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
      const script = { id, name, text: '', updatedAt: Date.now() }
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
        const next = prev.map((s) => (s.id === id ? { ...s, text, updatedAt: Date.now() } : s))
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

  const markExported = useCallback(
    (id) => {
      setScripts((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, exportedAt: Date.now() } : s))
        persist(next, activeId)
        return next
      })
    },
    [persist, activeId],
  )

  // Scripts imported from a file already have a copy on disk.
  const importScript = useCallback((text, { fromFile = false } = {}) => {
    const id = `s${Date.now().toString(36)}`
    const name = guessName(text)
    const now = Date.now()
    const script = { id, name, text, updatedAt: now, ...(fromFile ? { exportedAt: now } : {}) }
    setScripts((prev) => {
      const next = [script, ...prev]
      persist(next, id)
      return next
    })
    setActiveId(id)
    return script
  }, [persist])

  // A script loaded from a link keeps its source so it can be refreshed. The
  // doc itself is the backup, so it counts as backed up when fetched.
  const importFromLink = useCallback(({ text, title, source }) => {
    const id = `s${Date.now().toString(36)}`
    const now = Date.now()
    const script = {
      id,
      name: (title || guessName(text)).slice(0, 60),
      text,
      source,
      updatedAt: now,
      fetchedAt: now,
      exportedAt: now,
    }
    setScripts((prev) => {
      const next = [script, ...prev]
      persist(next, id)
      return next
    })
    setActiveId(id)
    return script
  }, [persist])

  const refreshFromLink = useCallback(
    (id, { text }) => {
      const now = Date.now()
      setScripts((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, text, updatedAt: now, fetchedAt: now, exportedAt: now } : s))
        persist(next, activeId)
        return next
      })
    },
    [persist, activeId],
  )

  return {
    scripts,
    importFromLink,
    refreshFromLink,
    activeId,
    active,
    newScript,
    saveScript,
    renameScript,
    deleteScript,
    loadScript,
    importScript,
    markExported,
  }
}

function guessName(text) {
  const first = (text || '').split(/\r?\n/).find((l) => /^#{1,6}\s+/.test(l.trim()))
  if (first) return first.trim().replace(/^#{1,6}\s+/, '').slice(0, 40)
  return 'Imported script'
}
