import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseScript } from '../lib/parser'
import { detectCommand } from '../lib/commands'
import { friendlySpeechmaticsError, isReusableRecognitionSession, isTransientSessionLimitError, SpeechmaticsClient } from '../lib/speechmatics'
import { startMic } from '../lib/mic'
import { calculateMeasuredWpm } from '../lib/stats'
import { ALIGNER_STATE, ScriptAligner } from '../lib/aligner'
import { buildSegments, findOpening, findRunStart, sentenceStepTarget } from '../lib/navigation'
import { tokenize } from '../lib/text'

export const PHASE = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  COUNTDOWN: 'countdown',
  RUNNING: 'running',
  PAUSED: 'paused',
  ENDED: 'ended',
}

// A live mic session left waiting between takes closes after this long:
// longer after a take ends (time for a chat before "dinosaur"), shorter once
// a jump has armed following and nobody has started reading.
const ENDED_RELEASE_MS = 5 * 60 * 1000
const ARMED_RELEASE_MS = 2 * 60 * 1000

export function usePrompter({ raw, settings, speechmaticsKey }) {
  const tokenProxyUrl = settings.tokenProxyUrl
  const doc = useMemo(() => parseScript(raw), [raw])
  const totalWords = doc.totalWords
  const scriptLower = useMemo(() => doc.words.map((w) => w.lower), [doc])
  const segments = useMemo(() => buildSegments(doc), [doc])
  const docRef = useRef(doc)
  docRef.current = doc

  // Always-fresh refs so stable callbacks never read stale script data.
  const scriptLowerRef = useRef(scriptLower)
  const alignerRef = useRef(new ScriptAligner(doc.words))
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
  const finishedSessionTimerRef = useRef(null)
  // True while following is armed but nobody has spoken yet: the clock and
  // WPM wait for the first matched word.
  const holdClockRef = useRef(false)
  const armedAtRef = useRef(0)
  // Recent words heard while finished or waiting to go again.
  const heardRef = useRef([])

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
    if (phase !== PHASE.RUNNING) holdClockRef.current = false
  }, [phase, settings, totalWords])

  // Reset when the script changes.
  useEffect(() => {
    startAttemptRef.current += 1
    stopSession()
    alignerRef.current = new ScriptAligner(doc.words)
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
    const { autoLoop, countdownOnStart, mode, source } = engine.current
    if (autoLoop) {
      beginRestart(countdownOnStart)
    } else {
      phaseRef.current = PHASE.ENDED
      setPhase(PHASE.ENDED)
      // Keep one live recognition session available between repeated takes.
      // Saying the opening words, "dinosaur", Restart or tapping a line picks
      // it straight back up; it expires if the finished screen is left idle,
      // avoiding both concurrent-session leaks and needless usage.
      if (mode === 'voice' && source === 'mic' && isReusableRecognitionSession(sessionRef.current)) {
        heardRef.current = []
        scheduleIdleRelease(ENDED_RELEASE_MS)
      }
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
        if (!holdClockRef.current) elapsedRef.current += dt
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
        // A timer may have just closed the session; don't revive its status.
        if (![PHASE.RUNNING, PHASE.COUNTDOWN, PHASE.CONNECTING].includes(phaseRef.current)) return
        refreshStats()
        const now = Date.now()
        let vs = 'off'
        if (settings.source === 'mic') {
          if (micStatus === 'error' || sttStatus === 'error') vs = 'error'
          else if (micStatus !== 'live' || sttStatus !== 'recording') vs = 'starting'
          else if (alignerRef.current.state === ALIGNER_STATE.OFFSCRIPT) vs = 'offscript'
          else if (alignerRef.current.state === ALIGNER_STATE.PAUSED) vs = 'waiting'
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
    alignerRef.current.jumpTo(0)
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

  function clearFinishedSessionTimer() {
    if (!finishedSessionTimerRef.current) return
    clearTimeout(finishedSessionTimerRef.current)
    finishedSessionTimerRef.current = null
  }

  // Close a live session nobody is using: after the end of a take, or when
  // following was armed by a jump but nobody started reading.
  function scheduleIdleRelease(ms = ARMED_RELEASE_MS) {
    clearFinishedSessionTimer()
    finishedSessionTimerRef.current = setTimeout(() => {
      finishedSessionTimerRef.current = null
      const idle = phaseRef.current === PHASE.ENDED || (phaseRef.current === PHASE.RUNNING && holdClockRef.current)
      if (!idle) return
      startAttemptRef.current += 1
      holdClockRef.current = false
      stopSession()
      const next = positionRef.current >= engine.current.totalWords ? PHASE.ENDED : positionRef.current > 0 ? PHASE.PAUSED : PHASE.IDLE
      phaseRef.current = next
      setPhase(next)
    }, ms)
  }

  // While the mic is still live (between takes), any jump means "go from
  // here": keep following, but hold the clock until the first word lands.
  // Without a live session (paused, constant or demo mode) nothing changes.
  function armFollowing({ fresh = false } = {}) {
    const e = engine.current
    if (e.mode !== 'voice' || e.source !== 'mic' || !isReusableRecognitionSession(sessionRef.current)) return false
    // A countdown in progress has already been cancelled by the jump.
    if (phaseRef.current === PHASE.CONNECTING) return false
    if (phaseRef.current === PHASE.RUNNING && !fresh) return true
    setCount(0)
    holdClockRef.current = true
    armedAtRef.current = Math.max(0, Math.floor(positionRef.current))
    heardRef.current = []
    phaseRef.current = PHASE.RUNNING
    setPhase(PHASE.RUNNING)
    scheduleIdleRelease()
    return true
  }

  function jumpToTop() {
    clearTimers()
    positionRef.current = 0
    wordRef.current = -1
    elapsedRef.current = 0
    statsStartWordRef.current = 0
    statsStartElapsedRef.current = 0
    pendingMatchRef.current = null
    lastAdvanceAtRef.current = Date.now()
    alignerRef.current.jumpTo(0)
    setWord(-1)
  }

  useEffect(() => {
    if (settings.mode === 'voice' && settings.source === 'mic') return
    if (!sessionRef.current) return
    startAttemptRef.current += 1
    clearFinishedSessionTimer()
    stopSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode, settings.source])

  // iPad browsers can freeze or cache a page without unmounting React. Close
  // the realtime socket as soon as the page is no longer visible so an old
  // rehearsal cannot occupy a Speechmatics concurrency slot.
  useEffect(() => {
    const releaseHiddenSession = (event) => {
      if (document.visibilityState !== 'hidden' && event?.type === 'visibilitychange') return
      const activePhase = [PHASE.CONNECTING, PHASE.COUNTDOWN, PHASE.RUNNING].includes(phaseRef.current)
      if (!sessionRef.current && !activePhase) return
      startAttemptRef.current += 1
      clearTimers()
      clearFinishedSessionTimer()
      stopSession()
      const nextPhase = positionRef.current > 0 ? PHASE.PAUSED : PHASE.IDLE
      phaseRef.current = nextPhase
      setPhase(nextPhase)
    }

    window.addEventListener('pagehide', releaseHiddenSession)
    document.addEventListener('visibilitychange', releaseHiddenSession)
    document.addEventListener('freeze', releaseHiddenSession)
    return () => {
      window.removeEventListener('pagehide', releaseHiddenSession)
      document.removeEventListener('visibilitychange', releaseHiddenSession)
      document.removeEventListener('freeze', releaseHiddenSession)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function beginRestart(withCountdown) {
    if (withCountdown) {
      runCountdown()
    } else {
      resetPosition()
      setPhase(PHASE.RUNNING)
    }
  }

  const applyRecognition = useCallback((words, { final = false, endTimes = [], confidences = [] } = {}) => {
    const transcript = words.join(' ')
    if (engine.current.voiceCommands !== false) {
      const cmd = final ? detectCommand(transcript) : null
      if (cmd === 'rewind') {
        jumpToTop()
        if (!armFollowing({ fresh: true }) && phaseRef.current !== PHASE.RUNNING) setPhase(PHASE.IDLE)
        flashNotice('Rewound to the start')
        return
      }
      if (cmd === 'back') {
        const target = sentenceStepTarget(docRef.current, positionRef.current, -1)
        if (target != null) {
          clearTimers()
          positionRef.current = target
          wordRef.current = target
          statsStartWordRef.current = target
          statsStartElapsedRef.current = elapsedRef.current
          pendingMatchRef.current = null
          lastAdvanceAtRef.current = Date.now()
          alignerRef.current.jumpTo(target)
          setWord(target)
          armFollowing()
          flashNotice('Back a sentence')
        }
        return
      }
    }
    // Finished, but the talent has started the script again: go with them.
    // heardRef holds recent final words; the current chunk may be a partial.
    if (phaseRef.current === PHASE.ENDED && words.length && isReusableRecognitionSession(sessionRef.current)) {
      const fresh = words.flatMap((w) => tokenize(w))
      const heard = [...heardRef.current, ...fresh]
      const earlier = heardRef.current.length
      if (final) heardRef.current = heard.slice(-12)
      const at = findOpening(heard, scriptLowerRef.current)
      if (at < 0) return
      jumpToTop()
      if (!armFollowing({ fresh: true })) return
      // Opening words that arrived in an earlier chunk still count.
      heardRef.current = heard.slice(Math.min(at, earlier), earlier)
      flashNotice('Going again from the top')
    }
    if (phaseRef.current !== PHASE.RUNNING) return
    if (!words.length) return
    // Waiting to go again: only start once a run of script words is heard,
    // then follow from the start of that run. Room chatter is ignored.
    if (holdClockRef.current) {
      const fresh = words.flatMap((w) => tokenize(w))
      const heard = [...heardRef.current, ...fresh]
      const earlier = heardRef.current.length
      if (final) heardRef.current = heard.slice(-12)
      const at = findRunStart(heard, scriptLowerRef.current, armedAtRef.current)
      if (at < 0) return
      holdClockRef.current = false
      heardRef.current = []
      clearFinishedSessionTimer()
      statsStartWordRef.current = armedAtRef.current
      statsStartElapsedRef.current = elapsedRef.current
      const aligner = alignerRef.current
      aligner.jumpTo(armedAtRef.current)
      // Earlier final chunks are settled; the current chunk keeps its own
      // final/partial status so a later final can still correct a partial.
      if (at < earlier) aligner.feedFinal(heard.slice(at, earlier))
      const current = fresh.slice(Math.max(0, at - earlier))
      const started = final ? aligner.feedFinal(current) : aligner.feedPartial(current)
      positionRef.current = started.provisional
      lastAdvanceAtRef.current = Date.now()
      syncWord()
      return
    }
    const result = final
      ? alignerRef.current.feedFinal(words, endTimes, confidences)
      : alignerRef.current.feedPartial(words)
    const target = result.provisional
    if (target !== positionRef.current) {
      positionRef.current = target
      lastAdvanceAtRef.current = Date.now()
      syncWord()
    }

    const nextVoiceStatus =
      result.state === ALIGNER_STATE.OFFSCRIPT
        ? 'offscript'
        : result.state === ALIGNER_STATE.PAUSED
          ? 'waiting'
          : result.state === ALIGNER_STATE.LIVE
            ? 'listening'
            : voiceStatusRef.current
    if (nextVoiceStatus !== voiceStatusRef.current) {
      voiceStatusRef.current = nextVoiceStatus
      setVoiceStatus(nextVoiceStatus)
    }
  }, [syncWord])

  const startVoiceSession = useCallback(async (attemptId) => {
    if (!speechmaticsKey && !tokenProxyUrl) {
      setError('Add your Speechmatics key in Settings to follow your voice.')
      voiceStatusRef.current = 'error'
      setVoiceStatus('error')
      return false
    }
    let mic
    let client
    let clientReady = false
    let fatalHandled = false
    const failLiveSession = (message) => {
      if (startAttemptRef.current !== attemptId || fatalHandled) return
      fatalHandled = true
      setError(friendlySpeechmaticsError(message instanceof Error ? message : new Error(message)))
      setSttStatus('error')
      setMicStatus('error')
      voiceStatusRef.current = 'error'
      setVoiceStatus('error')
      mic?.stop()
      client?.close()
      sessionRef.current = null
      phaseRef.current = positionRef.current > 0 ? PHASE.PAUSED : PHASE.IDLE
      setPhase(phaseRef.current)
    }

    const additionalVocab = [...new Set(scriptLowerRef.current.filter((token) => token.length >= 4))].slice(0, 500)
    const createClient = () => {
      let instance
      instance = new SpeechmaticsClient({
        apiKey: speechmaticsKey,
        tokenProxyUrl,
        language: 'en',
        model: 'enhanced',
        additionalVocab,
        onPartial: (t) => {
          if (startAttemptRef.current !== attemptId) return
          lastTranscriptAtRef.current = Date.now()
          setLastTranscript(t)
        },
        onFinal: (t) => {
          if (startAttemptRef.current !== attemptId) return
          lastTranscriptAtRef.current = Date.now()
          setLastTranscript(t)
        },
        onPartialResult: ({ words }) => applyRecognition(words, { final: false }),
        onFinalResult: ({ words, endTimes, confidences }) => applyRecognition(words, { final: true, endTimes, confidences }),
        onEndOfUtterance: () => {
          if (startAttemptRef.current !== attemptId) return
          const result = alignerRef.current.endUtterance()
          if (result.state === ALIGNER_STATE.PAUSED) {
            voiceStatusRef.current = 'waiting'
            setVoiceStatus('waiting')
          }
        },
        onStatus: (st) => {
          if (startAttemptRef.current === attemptId) setSttStatus(st)
        },
        onError: (err) => {
          if (clientReady && sessionRef.current?.client === instance) failLiveSession(err)
        },
        onClosed: (event) => {
          if (clientReady && sessionRef.current?.client === instance && [PHASE.CONNECTING, PHASE.COUNTDOWN, PHASE.RUNNING].includes(phaseRef.current)) {
            failLiveSession(event?.code ? `Speechmatics connection closed (${event.code}).` : 'Speechmatics connection closed.')
          }
        },
      })
      return instance
    }

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
        { deviceId: settings.micDeviceId },
      )
      if (startAttemptRef.current !== attemptId) {
        mic.stop()
        client?.close()
        return false
      }
      const retryDelays = [0, 1500, 3500, 6500]
      let lastStartError
      for (let retry = 0; retry < retryDelays.length; retry += 1) {
        if (retryDelays[retry]) {
          flashNotice(`Earlier rehearsal still closing — retrying (${retry + 1}/${retryDelays.length})`)
          await new Promise((resolve) => setTimeout(resolve, retryDelays[retry]))
        }
        if (startAttemptRef.current !== attemptId) {
          mic.stop()
          return false
        }
        client = createClient()
        sessionRef.current = { mic, client }
        try {
          await client.start()
          lastStartError = null
          break
        } catch (error) {
          lastStartError = error
          client.close()
          if (!isTransientSessionLimitError(error) || retry === retryDelays.length - 1) throw error
        }
      }
      if (lastStartError) throw lastStartError
      if (startAttemptRef.current !== attemptId || sessionRef.current?.client !== client) {
        mic.stop()
        client.close()
        return false
      }
      clientReady = true
      return true
    } catch (err) {
      if (startAttemptRef.current !== attemptId || fatalHandled) return false
      const permissionBlocked = err?.name === 'NotAllowedError' || /permission|denied|not allowed/i.test(err?.message || '')
      setError(
        permissionBlocked
          ? 'Microphone access is blocked. Allow microphone access for this site in your browser, then press Start again.'
          : friendlySpeechmaticsError(err),
      )
      setMicStatus('error')
      voiceStatusRef.current = 'error'
      setVoiceStatus('error')
      mic && mic.stop()
      client?.close()
      sessionRef.current = null
      return false
    }
  }, [speechmaticsKey, tokenProxyUrl, applyRecognition, flashNotice, settings.micDeviceId])

  const start = useCallback(async () => {
    if ([PHASE.CONNECTING, PHASE.COUNTDOWN, PHASE.RUNNING].includes(phaseRef.current)) return
    if (totalWords === 0) {
      setError('Add some words to your script first.')
      return
    }
    setError(null)
    clearFinishedSessionTimer()

    const e = engine.current
    if (positionRef.current >= totalWords) resetPosition()
    const atStart = positionRef.current <= 0
    const reuseVoiceSession = e.mode === 'voice' && e.source === 'mic' && isReusableRecognitionSession(sessionRef.current)
    const attemptId = reuseVoiceSession ? startAttemptRef.current : startAttemptRef.current + 1
    if (!reuseVoiceSession) startAttemptRef.current = attemptId

    if (e.mode === 'voice' && e.source === 'mic' && !reuseVoiceSession) {
      // A stale non-recording object must never be overwritten: close it
      // before creating a replacement so repeated takes cannot leak slots.
      if (sessionRef.current) stopSession()
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
  }, [totalWords, resetPosition, runCountdown, startVoiceSession])

  const stop = useCallback(() => {
    startAttemptRef.current += 1
    clearTimers()
    clearFinishedSessionTimer()
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
    clearFinishedSessionTimer()
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
      if (!armFollowing({ fresh: true })) setPhase(PHASE.IDLE)
    }
  }, [resetPosition])

  const nudge = useCallback(
    (delta) => {
      const activePhase = phaseRef.current
      if (activePhase === PHASE.CONNECTING || activePhase === PHASE.COUNTDOWN || delta === 0) {
        startAttemptRef.current += 1
        clearTimers()
        clearFinishedSessionTimer()
        stopSession()
      }
      positionRef.current = Math.max(0, Math.min(totalWords, positionRef.current + delta))
      if (delta === 0) elapsedRef.current = 0
      statsStartWordRef.current = Math.floor(positionRef.current)
      statsStartElapsedRef.current = elapsedRef.current
      pendingMatchRef.current = null
      lastAdvanceAtRef.current = Date.now()
      alignerRef.current.jumpTo(positionRef.current)
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
      alignerRef.current.jumpTo(i)
      if (phaseRef.current === PHASE.COUNTDOWN || phaseRef.current === PHASE.CONNECTING) {
        startAttemptRef.current += 1
        stopSession()
        setCount(0)
        setPhase(PHASE.IDLE)
      }
      setWord(i)
      armFollowing()
      refreshStats()
    },
    [totalWords, refreshStats],
  )

  // Clicker keys: step to the next sentence, or back (see sentenceStepTarget).
  const stepSentence = useCallback(
    (direction) => {
      const target = sentenceStepTarget(doc, Math.max(0, positionRef.current), direction)
      if (target != null) setPosition(target)
    },
    [doc, setPosition],
  )

  function clearTimers() {
    timersRef.current.forEach(clearInterval)
    timersRef.current = []
  }

  useEffect(() => () => {
    startAttemptRef.current += 1
    clearTimers()
    clearFinishedSessionTimer()
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
    stepSentence,
    segments,
    clearError: () => setError(null),
    setError,
  }
}
