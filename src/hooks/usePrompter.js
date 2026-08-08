import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseScript } from '../lib/parser'
import { matchTranscriptDetailed, tokenize } from '../lib/matcher'
import { detectCommand } from '../lib/commands'
import { SpeechmaticsClient } from '../lib/speechmatics'
import { startMic } from '../lib/mic'
import { calculateMeasuredWpm } from '../lib/stats'

export const PHASE = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  COUNTDOWN: 'countdown',
  RUNNING: 'running',
  PAUSED: 'paused',
  ENDED: 'ended',
}

export function usePrompter({ raw, settings, speechmaticsKey, onSourceFallback }) {
  const tokenProxyUrl = settings.tokenProxyUrl
  const doc = useMemo(() => parseScript(raw), [raw])
  const totalWords = doc.totalWords
  const scriptLower = useMemo(() => doc.words.map((w) => w.lower), [doc])

  // Always-fresh refs so stable callbacks never read stale script data.
  const scriptLowerRef = useRef(scriptLower)
  useEffect(() => {
    scriptLowerRef.current = scriptLower
  }, [scriptLower])

  const positionRef = useRef(0) // float words completed (0..totalWords)
  const wordRef = useRef(-1)
  const [word, setWord] = useState(-1)
  const [phase, setPhase] = useState(PHASE.IDLE)
  const [count, setCount] = useState(0)
  const [micStatus, setMicStatus] = useState('off') // off|connecting|live|error
  const [sttStatus, setSttStatus] = useState('off') // off|auth|connecting|recording|stopped|error
  const [voiceStatus, setVoiceStatus] = useState('off') // off|starting|listening|waiting|offscript|error
  const [error, setError] = useState(null)
  const [notice, setNoticeState] = useState(null)
  const [lastTranscript, setLastTranscript] = useState('')
  const [stats, setStats] = useState({ elapsed: 0, remaining: 0, progress: 0, wordsRead: 0, wpm: 0 })

  const elapsedRef = useRef(0)
  const statsStartWordRef = useRef(0)
  const statsStartElapsedRef = useRef(0)
  const sessionRef = useRef(null)
  const startAttemptRef = useRef(0)
  const timersRef = useRef([])
  const phaseRef = useRef(PHASE.IDLE)
  const noticeTimerRef = useRef(null)
  const lastTranscriptAtRef = useRef(0)
  const lastAdvanceAtRef = useRef(0)
  const voiceStatusRef = useRef('off')
  const pendingMatchRef = useRef(null)
  const wakeLockRef = useRef(null)

  const flashNotice = useCallback((msg) => {
    setNoticeState(msg)
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => setNoticeState(null), 3200)
  }, [])

  // Mirror of values the rAF loop needs, kept in a ref to avoid re-subscribing.
  const engine = useRef({})
  useEffect(() => {
    engine.current = {
      phase,
      mode: settings.mode,
      source: settings.source,
      baselineWpm: settings.baselineWpm,
      autoLoop: settings.autoLoop,
      matching: settings.matching,
      voiceCommands: settings.voiceCommands,
      totalWords,
      countdownOnStart: settings.countdownOnStart,
    }
    phaseRef.current = phase
  }, [phase, settings, totalWords])

  // Reset when the script changes.
  useEffect(() => {
    startAttemptRef.current += 1
    stopSession()
    positionRef.current = 0
    wordRef.current = -1
    elapsedRef.current = 0
    statsStartWordRef.current = 0
    statsStartElapsedRef.current = 0
    setWord(-1)
    setPhase(PHASE.IDLE)
    setStats({ elapsed: 0, remaining: (totalWords / (settings.baselineWpm || 150)) * 60, progress: 0, wordsRead: 0, wpm: 0 })
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw])

  const syncWord = useCallback(() => {
    const w = Math.max(-1, Math.min(totalWords - 1, Math.floor(positionRef.current)))
    if (w !== wordRef.current) {
      wordRef.current = w
      setWord(w)
    }
  }, [totalWords])

  const refreshStats = useCallback(() => {
    const pos = positionRef.current
    const baselineWpm = engine.current.baselineWpm || 150
    const wordsRead = Math.max(0, Math.min(totalWords, Math.floor(pos)))
    const remaining = Math.max(0, totalWords - wordsRead)
    const measuredWpm = calculateMeasuredWpm(
      wordsRead,
      elapsedRef.current,
      statsStartWordRef.current,
      statsStartElapsedRef.current,
    )
    const wpm = engine.current.mode === 'voice' && engine.current.source === 'mic' && measuredWpm > 0 ? measuredWpm : baselineWpm
    setStats({
      elapsed: elapsedRef.current,
      remaining: (remaining / wpm) * 60,
      progress: totalWords ? wordsRead / totalWords : 0,
      wordsRead,
      wpm: Math.round(wpm),
    })
  }, [totalWords])

  // Keep the screen awake during a rehearsal where the browser supports it.
  useEffect(() => {
    if (phase !== PHASE.RUNNING || typeof navigator === 'undefined' || !navigator.wakeLock) return undefined

    let cancelled = false
    const requestWakeLock = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          await lock.release()
        } else {
          wakeLockRef.current = lock
          lock.addEventListener('release', () => {
            if (wakeLockRef.current === lock) wakeLockRef.current = null
          })
        }
      } catch {
        // Wake Lock is optional; the rehearsal continues without it.
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) requestWakeLock()
    }

    requestWakeLock()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      const lock = wakeLockRef.current
      wakeLockRef.current = null
      lock?.release().catch(() => {})
    }
  }, [phase])

  const handleEnd = useCallback(() => {
    if (phaseRef.current !== PHASE.RUNNING) return
    const { autoLoop, countdownOnStart } = engine.current
    if (autoLoop) {
      beginRestart(countdownOnStart)
    } else {
      setPhase(PHASE.ENDED)
    }
  }, [])

  // Main rAF engine loop — always running.
  useEffect(() => {
    let raf
    let last = performance.now()
    let endHandled = false
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const e = engine.current

      if (e.phase === PHASE.RUNNING) {
        elapsedRef.current += dt
        const auto = e.mode === 'constant' || (e.mode === 'voice' && e.source === 'demo')
        if (auto && e.baselineWpm > 0) {
          positionRef.current += (e.baselineWpm / 60) * dt
        }
        if (positionRef.current >= e.totalWords && e.totalWords > 0) {
          positionRef.current = e.totalWords
          if (!endHandled) {
            endHandled = true
            syncWord()
            refreshStats()
            handleEnd()
          }
        } else {
          endHandled = false
          syncWord()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [syncWord, refreshStats, handleEnd])

  // Periodic stats + voice-status refresh while active.
  useEffect(() => {
    if (phase === PHASE.RUNNING || phase === PHASE.COUNTDOWN || phase === PHASE.CONNECTING) {
      const id = setInterval(() => {
        refreshStats()
        const now = Date.now()
        let vs = 'off'
        if (settings.source === 'mic') {
          if (micStatus === 'error' || sttStatus === 'error') vs = 'error'
          else if (micStatus !== 'live' || sttStatus !== 'recording') vs = 'starting'
          else if (now - lastTranscriptAtRef.current > 2200) vs = 'waiting'
          else if (now - lastAdvanceAtRef.current > 1500) vs = 'offscript'
          else vs = 'listening'
        }
        if (vs !== voiceStatusRef.current) {
          voiceStatusRef.current = vs
          setVoiceStatus(vs)
        }
      }, 500)
      return () => clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, refreshStats, settings.source, micStatus, sttStatus])

  const resetPosition = useCallback(() => {
    positionRef.current = 0
    wordRef.current = -1
    elapsedRef.current = 0
    statsStartWordRef.current = 0
    statsStartElapsedRef.current = 0
    pendingMatchRef.current = null
    lastAdvanceAtRef.current = Date.now()
    setWord(-1)
    refreshStats()
  }, [refreshStats])

  const runCountdown = useCallback(() => {
    setPhase(PHASE.COUNTDOWN)
    setCount(3)
    let i = 3
    const ticker = setInterval(() => {
      i -= 1
      if (i <= 0) {
        clearInterval(ticker)
        setCount(0)
        resetPosition()
        setPhase(PHASE.RUNNING)
      } else {
        setCount(i)
      }
    }, 1000)
    timersRef.current.push(ticker)
  }, [resetPosition])

  function stopSession() {
    const s = sessionRef.current
    if (s) {
      s.mic && s.mic.stop()
      s.client && s.client.stop()
      s.client && s.client.close()
      sessionRef.current = null
    }
    setMicStatus('off')
    setSttStatus('off')
    voiceStatusRef.current = 'off'
    setVoiceStatus('off')
  }

  function beginRestart(withCountdown) {
    if (withCountdown) {
      runCountdown()
    } else {
      resetPosition()
      setPhase(PHASE.RUNNING)
    }
  }

  const applyTranscript = useCallback((t, { final = false } = {}) => {
    if (engine.current.voiceCommands !== false) {
      const cmd = detectCommand(t)
      if (cmd === 'rewind') {
        clearTimers()
        positionRef.current = 0
        wordRef.current = -1
        elapsedRef.current = 0
        statsStartWordRef.current = 0
        statsStartElapsedRef.current = 0
        pendingMatchRef.current = null
        lastAdvanceAtRef.current = Date.now()
        setWord(-1)
        if (phaseRef.current !== PHASE.RUNNING) setPhase(PHASE.IDLE)
        flashNotice('Rewound to the start')
        return
      }
    }
    if (phaseRef.current !== PHASE.RUNNING) return
    const spoken = tokenize(t)
    if (!spoken.length) return
    const scriptLower = scriptLowerRef.current
    const from = Math.max(0, Math.floor(positionRef.current))
    const match = matchTranscriptDetailed(spoken, scriptLower, from, { final })
    if (!match) {
      if (final) pendingMatchRef.current = null
      return
    }

    const candidateKey = `${match.start}:${match.end}`
    const pending = pendingMatchRef.current
    const candidateCount = pending && pending.key === candidateKey ? pending.count + 1 : 1
    pendingMatchRef.current = { key: candidateKey, count: candidateCount }

    // Partials are useful for responsiveness but should not move the page on
    // one ambiguous word. Final results, longer runs, or repeated partials are
    // strong enough evidence to commit.
    const shouldCommit = final || match.length >= 3 || candidateCount >= 2
    if (!shouldCommit) return

    const target = match.end + 1
    if (target > positionRef.current) {
      positionRef.current = target
      lastAdvanceAtRef.current = Date.now()
      syncWord()
    }
  }, [syncWord])

  const startVoiceSession = useCallback(async (attemptId) => {
    if (!speechmaticsKey && !tokenProxyUrl) {
      setError('Add your Speechmatics key in Settings to follow your voice — switched to the Demo reader.')
      onSourceFallback && onSourceFallback()
      return false
    }
    const client = new SpeechmaticsClient({
      apiKey: speechmaticsKey,
      tokenProxyUrl,
      language: 'en',
      model: 'enhanced',
      onPartial: (t) => {
        if (startAttemptRef.current !== attemptId) return
        lastTranscriptAtRef.current = Date.now()
        setLastTranscript(t)
        applyTranscript(t, { final: false })
      },
      onFinal: (t) => {
        if (startAttemptRef.current !== attemptId) return
        lastTranscriptAtRef.current = Date.now()
        setLastTranscript(t)
        applyTranscript(t, { final: true })
      },
      onStatus: (st) => {
        if (startAttemptRef.current === attemptId) setSttStatus(st)
      },
      onError: (err) => {
        if (startAttemptRef.current !== attemptId) return
        setError(err.message || 'Speechmatics error')
        setSttStatus('error')
      },
    })

    let mic
    let clientReady = false
    try {
      setMicStatus('connecting')
      voiceStatusRef.current = 'starting'
      setVoiceStatus('starting')
      lastTranscriptAtRef.current = Date.now()
      lastAdvanceAtRef.current = Date.now()
      mic = await startMic(
        (pcm) => {
          if (clientReady) client.sendAudio(pcm)
        },
        (st) => {
          if (startAttemptRef.current === attemptId) setMicStatus(st === 'live' ? 'live' : 'off')
        },
      )
      if (startAttemptRef.current !== attemptId) {
        mic.stop()
        client.close()
        return false
      }
      sessionRef.current = { mic, client }
      await client.start()
      if (startAttemptRef.current !== attemptId || sessionRef.current?.client !== client) {
        mic.stop()
        client.close()
        return false
      }
      clientReady = true
      return true
    } catch (err) {
      if (startAttemptRef.current !== attemptId) return false
      setError(`${err.message || 'Could not start microphone'} — switched to the Demo reader.`)
      setMicStatus('error')
      mic && mic.stop()
      client.close()
      sessionRef.current = null
      onSourceFallback && onSourceFallback()
      return false
    }
  }, [speechmaticsKey, tokenProxyUrl, applyTranscript, onSourceFallback])

  const start = useCallback(async () => {
    if ([PHASE.CONNECTING, PHASE.COUNTDOWN, PHASE.RUNNING].includes(phaseRef.current)) return
    if (totalWords === 0) {
      setError('Add some words to your script first.')
      return
    }
    setError(null)

    const e = engine.current
    const atStart = positionRef.current <= 0
    const attemptId = startAttemptRef.current + 1
    startAttemptRef.current = attemptId

    if (e.mode === 'voice' && e.source === 'mic') {
      phaseRef.current = PHASE.CONNECTING
      setPhase(PHASE.CONNECTING)
      const ready = await startVoiceSession(attemptId)
      if (!ready || startAttemptRef.current !== attemptId) {
        if (startAttemptRef.current === attemptId) {
          phaseRef.current = PHASE.IDLE
          setPhase(PHASE.IDLE)
        }
        return
      }
    }

    if (atStart && e.countdownOnStart) {
      runCountdown()
    } else {
      statsStartWordRef.current = Math.max(0, Math.floor(positionRef.current))
      statsStartElapsedRef.current = elapsedRef.current
      setPhase(PHASE.RUNNING)
    }
  }, [totalWords, runCountdown, startVoiceSession])

  const stop = useCallback(() => {
    startAttemptRef.current += 1
    clearTimers()
    stopSession()
    if (positionRef.current >= engine.current.totalWords) {
      setPhase(PHASE.ENDED)
    } else {
      setPhase(positionRef.current > 0 ? PHASE.PAUSED : PHASE.IDLE)
    }
  }, [])

  const toggle = useCallback(() => {
    if ([PHASE.CONNECTING, PHASE.COUNTDOWN, PHASE.RUNNING].includes(phaseRef.current)) stop()
    else start()
  }, [start, stop])

  const restart = useCallback(() => {
    if (phaseRef.current === PHASE.CONNECTING) {
      startAttemptRef.current += 1
      stopSession()
    }
    clearTimers()
    const { countdownOnStart } = engine.current
    if (countdownOnStart && phaseRef.current === PHASE.RUNNING) {
      beginRestart(true)
    } else {
      resetPosition()
      setPhase(PHASE.IDLE)
    }
  }, [resetPosition])

  const nudge = useCallback(
    (delta) => {
      const activePhase = phaseRef.current
      if (activePhase === PHASE.CONNECTING || activePhase === PHASE.COUNTDOWN || delta === 0) {
        startAttemptRef.current += 1
        clearTimers()
        stopSession()
      }
      positionRef.current = Math.max(0, Math.min(totalWords, positionRef.current + delta))
      if (delta === 0) elapsedRef.current = 0
      statsStartWordRef.current = Math.floor(positionRef.current)
      statsStartElapsedRef.current = elapsedRef.current
      pendingMatchRef.current = null
      lastAdvanceAtRef.current = Date.now()
      if (activePhase !== PHASE.RUNNING || delta === 0) setPhase(PHASE.IDLE)
      syncWord()
      refreshStats()
    },
    [totalWords, syncWord, refreshStats],
  )

  // Jump the reading position to a specific word (used by manual scroll).
  const setPosition = useCallback(
    (idx) => {
      clearTimers()
      const i = Math.max(0, Math.min(totalWords - 1, Math.floor(idx)))
      positionRef.current = i
      wordRef.current = i
      statsStartWordRef.current = i
      statsStartElapsedRef.current = elapsedRef.current
      pendingMatchRef.current = null
      lastAdvanceAtRef.current = Date.now()
      if (phaseRef.current === PHASE.COUNTDOWN || phaseRef.current === PHASE.CONNECTING) {
        startAttemptRef.current += 1
        stopSession()
        setCount(0)
        setPhase(PHASE.IDLE)
      }
      setWord(i)
      refreshStats()
    },
    [totalWords, refreshStats],
  )

  function clearTimers() {
    timersRef.current.forEach(clearInterval)
    timersRef.current = []
  }

  useEffect(() => () => {
    startAttemptRef.current += 1
    clearTimers()
    stopSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    doc,
    word,
    positionRef,
    totalWords,
    phase,
    count,
    micStatus,
    sttStatus,
    voiceStatus,
    error,
    notice,
    lastTranscript,
    stats,
    start,
    stop,
    toggle,
    restart,
    nudge,
    setPosition,
    clearError: () => setError(null),
    setError,
  }
}
