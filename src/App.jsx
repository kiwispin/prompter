import { useCallback, useEffect, useRef, useState } from 'react'
import PrompterView from './components/PrompterView'
import Toolbar from './components/Toolbar'
import Hud from './components/Hud'
import SettingsPanel from './components/SettingsPanel'
import ScriptsPanel from './components/ScriptsPanel'
import Onboarding from './components/Onboarding'
import { useSettings } from './hooks/useSettings'
import { useScripts, needsBackup } from './hooks/useScripts'
import { useKeyboardInset } from './hooks/useKeyboardInset'
import { usePrompter, PHASE } from './hooks/usePrompter'
import { load, save, KEYS } from './lib/storage'
import { mirrorTransform } from './lib/mirror'

export default function App() {
  const { settings, setSetting, resetSettings, speechmaticsKey, saveSpeechmaticsKey } = useSettings()
  const scripts = useScripts()
  useKeyboardInset()
  const prompter = usePrompter({
    raw: scripts.active.text,
    settings,
    speechmaticsKey,
  })

  const [showSettings, setShowSettings] = useState(false)
  const [showScripts, setShowScripts] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(() => !load(KEYS.seenOnboarding, false))
  const [chromeHidden, setChromeHidden] = useState(false)
  const [toast, setToast] = useState(null)
  const rootRef = useRef(null)

  const running = prompter.phase === PHASE.RUNNING
  const busy = prompter.phase === PHASE.COUNTDOWN || prompter.phase === PHASE.CONNECTING
  const presentationStyle = {
    transform: mirrorTransform(settings.mirror, settings.mirrorAxis),
  }

  // Onboarding actions
  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false)
    save(KEYS.seenOnboarding, true)
  }, [])

  const watchDemo = useCallback(() => {
    setSetting('mode', 'voice')
    setSetting('source', 'demo')
    dismissOnboarding()
    setTimeout(() => prompter.start(), 120)
  }, [dismissOnboarding, prompter, setSetting])

  // After saving a key, select microphone mode so the next start uses it.
  const useMicrophone = useCallback(() => {
    setSetting('mode', 'voice')
    setSetting('source', 'mic')
    dismissOnboarding()
  }, [dismissOnboarding, setSetting])

  const toggleMirror = useCallback(() => {
    const next = !settings.mirror
    setSetting('mirror', next)
    if (next && settings.mirrorAxis === 'none') setSetting('mirrorAxis', 'h')
  }, [setSetting, settings.mirror, settings.mirrorAxis])

  // Ask the browser not to clear this site's storage (scripts live there).
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {})
  }, [])

  // Gentle backup reminder on open, at most every few days, when a script has
  // gone unexported for over a day since its last edit.
  const backupCheckedRef = useRef(false)
  useEffect(() => {
    if (backupCheckedRef.current || showOnboarding) return
    backupCheckedRef.current = true
    const DAY = 24 * 60 * 60 * 1000
    const now = Date.now()
    if (now - load(KEYS.backupReminderAt, 0) < 3 * DAY) return
    const stale = scripts.scripts.some((s) => needsBackup(s) && now - (s.updatedAt || 0) > DAY)
    if (!stale) return
    save(KEYS.backupReminderAt, now)
    setToast('Some scripts aren’t backed up. Open Scripts and tap Export to save a copy.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOnboarding])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 9000)
    return () => clearTimeout(t)
  }, [toast])

  // Error toast
  useEffect(() => {
    if (!prompter.error) return
    setToast(prompter.error)
    prompter.clearError()
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [prompter.error, prompter])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return
      const k = e.key.toLowerCase()
      if (k === ' ') {
        e.preventDefault()
        if (showOnboarding) return
        if ([PHASE.CONNECTING, PHASE.COUNTDOWN, PHASE.RUNNING].includes(prompter.phase)) prompter.stop()
        else prompter.start()
      } else if (k === 'r') {
        prompter.restart()
      } else if (k === 'arrowup') {
        e.preventDefault()
        prompter.nudge(-1)
      } else if (k === 'arrowdown') {
        e.preventDefault()
        prompter.nudge(1)
      } else if (k === 'pagedown' || k === 'arrowright') {
        // Presentation clickers and foot pedals send these: step a sentence.
        e.preventDefault()
        prompter.stepSentence(1)
      } else if (k === 'pageup' || k === 'arrowleft') {
        e.preventDefault()
        prompter.stepSentence(-1)
      } else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Number keys jump to that segment: "go again from segment 3".
        const segment = prompter.segments[Number(e.key) - 1]
        if (segment) prompter.setPosition(segment.startIndex)
      } else if (k === 's') {
        setShowSettings((v) => !v)
      } else if (k === ',') {
        setShowSettings((v) => !v)
      } else if (k === 'e') {
        setShowScripts((v) => !v)
      } else if (k === 'm') {
        toggleMirror()
      } else if (e.key === '?') {
        setShowOnboarding(true)
      } else if (k === 'f') {
        toggleFullscreen()
      } else if (k === 'h') {
        setSetting('showHud', !settings.showHud)
      } else if (k === 'escape') {
        setShowSettings(false)
        setShowScripts(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOnboarding, prompter.phase, settings.showHud, prompter])

  function toggleFullscreen() {
    const el = rootRef.current
    if (!el) return
    const isFs = document.fullscreenElement || document.webkitFullscreenElement
    try {
      if (isFs) {
        if (document.exitFullscreen) document.exitFullscreen()
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen()
      } else {
        const req = el.requestFullscreen || el.webkitRequestFullscreen
        if (req) req.call(el).catch(() => setChromeHidden((v) => !v))
        else setChromeHidden((v) => !v)
      }
    } catch {
      setChromeHidden((v) => !v)
    }
  }

  const loadAndStart = useCallback(() => {
    // Reset first so a script loaded while paused or running begins cleanly.
    prompter.nudge(0)
    setTimeout(() => prompter.start(), 0)
  }, [prompter.nudge, prompter.start])

  return (
    <div ref={rootRef} className={`app${chromeHidden ? ' chrome-hidden' : ''}`}>
      <div className="presentation-layer" style={presentationStyle} data-mirror-axis={settings.mirror ? settings.mirrorAxis : 'none'}>
        <PrompterView doc={prompter.doc} word={prompter.word} positionRef={prompter.positionRef} totalWords={prompter.totalWords} mode={settings.mode} settings={settings} onManualScroll={prompter.setPosition} running={running} voiceStatus={prompter.voiceStatus} wpm={prompter.stats.wpm} />

        {!chromeHidden && (
          <>
            <Toolbar
              phase={prompter.phase}
              running={running}
              activeName={scripts.active.name}
              onToggle={() => (running || busy ? prompter.stop() : prompter.start())}
              onRestart={prompter.restart}
              onOpenSettings={() => setShowSettings(true)}
              onOpenScripts={() => setShowScripts(true)}
              onToggleFullscreen={toggleFullscreen}
              onToggleMirror={toggleMirror}
              onOpenTour={() => setShowOnboarding(true)}
              mirror={settings.mirror}
              hasVoiceConfig={Boolean(speechmaticsKey || settings.tokenProxyUrl)}
              onUseVoice={useMicrophone}
              micStatus={prompter.micStatus}
              voiceStatus={prompter.voiceStatus}
              mode={settings.mode}
              source={settings.source}
              segments={prompter.segments}
              word={prompter.word}
              onJumpSegment={(segment) => prompter.setPosition(segment.startIndex)}
            />
            <Hud
              stats={prompter.stats}
              phase={prompter.phase}
              settings={settings}
              voiceStatus={prompter.voiceStatus}
              lastTranscript={prompter.lastTranscript}
              totalWords={prompter.doc.totalWords}
              running={running}
              hasKey={Boolean(speechmaticsKey || settings.tokenProxyUrl)}
            />
          </>
        )}

        {prompter.phase === PHASE.COUNTDOWN && (
          <div className="countdown">
            <span className="countdown-num" key={prompter.count}>
              {prompter.count === 0 ? 'Go' : prompter.count}
            </span>
          </div>
        )}
      </div>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          setSetting={setSetting}
          resetSettings={resetSettings}
          speechmaticsKey={speechmaticsKey}
          saveSpeechmaticsKey={saveSpeechmaticsKey}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showScripts && (
        <ScriptsPanel
          scripts={scripts.scripts}
          activeId={scripts.activeId}
          active={scripts.active}
          newScript={scripts.newScript}
          saveScript={scripts.saveScript}
          renameScript={scripts.renameScript}
          deleteScript={scripts.deleteScript}
          loadScript={scripts.loadScript}
          importScript={scripts.importScript}
          markExported={scripts.markExported}
          baselineWpm={settings.baselineWpm}
          onLoadToPrompter={() => {
            prompter.nudge(0)
          }}
          onLoadAndStart={loadAndStart}
          onClose={() => setShowScripts(false)}
        />
      )}

      {showOnboarding && (
        <Onboarding
          speechmaticsKey={speechmaticsKey}
          saveSpeechmaticsKey={saveSpeechmaticsKey}
          onDone={dismissOnboarding}
          onWatchDemo={watchDemo}
          onSaveKey={useMicrophone}
          tokenProxyUrl={settings.tokenProxyUrl}
        />
      )}

      {toast && (
        <div className="toast">
          <span className="toast-msg">{toast}</span>
          <button className="toast-close" onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      )}

      {prompter.notice && (
        <div className="toast toast-notice">
          <span className="toast-msg">{prompter.notice}</span>
        </div>
      )}
    </div>
  )
}
