import { useState } from 'react'
import { formatDuration } from '../lib/parser'
import { PHASE } from '../hooks/usePrompter'

const VOICE_LABELS = {
  off: 'Mic off',
  starting: 'Starting mic...',
  listening: 'Listening',
  waiting: 'Waiting for your voice',
  offscript: 'Off-script - holding',
  error: 'Mic error',
}

export default function Hud({ stats, phase, settings, voiceStatus, lastTranscript, totalWords, running, hasKey }) {
  const [compact, setCompact] = useState(false)

  if (!settings.showHud) return null
  const pct = Math.round(stats.progress * 100)

  const chipClass =
    voiceStatus === 'error'
      ? 'chip-error'
      : voiceStatus === 'waiting' || voiceStatus === 'offscript'
        ? 'chip-paused'
        : voiceStatus === 'listening'
          ? 'chip-voice'
          : 'chip-off'

  const statusChip =
    settings.mode === 'voice' && settings.source === 'mic' ? (
      <span className={`chip chip-status ${chipClass}`}>{VOICE_LABELS[voiceStatus] || VOICE_LABELS.off}</span>
    ) : settings.mode === 'voice' ? (
      <span className="chip chip-status chip-paused">{hasKey ? 'Demo - switch Source to Mic' : 'Demo reader'}</span>
    ) : (
      <span className="chip chip-status chip-const">Speed scroll</span>
    )

  return (
    <div className={`hud ${running ? 'hud-live' : ''}${compact ? ' hud-compact' : ''}`}>
      <div className="hud-statusbar">
        <div className="hud-status-main" aria-live="polite">
          {statusChip}
        </div>
        {phase === PHASE.PAUSED && <span className="chip chip-sm chip-paused">Paused</span>}
        {phase === PHASE.ENDED && <span className="chip chip-sm chip-paused">Finished</span>}
        <button
          className="hud-toggle"
          onClick={() => setCompact((value) => !value)}
          aria-label={compact ? 'Show HUD details' : 'Minimize HUD'}
          title={compact ? 'Show HUD details' : 'Minimize HUD'}
        >
          {compact ? '+' : '−'}
        </button>
      </div>

      {!compact && (
        <>
          <div className="hud-stats">
            <div className="hud-stat">
              <span className="hud-label">WPM</span>
              <span className="hud-value">{settings.baselineWpm}</span>
            </div>
            <div className="hud-stat">
              <span className="hud-label">Elapsed</span>
              <span className="hud-value">{formatDuration(stats.elapsed)}</span>
            </div>
            <div className="hud-stat">
              <span className="hud-label">Remaining</span>
              <span className="hud-value">~{formatDuration(stats.remaining)}</span>
            </div>
            <div className="hud-stat">
              <span className="hud-label">Progress</span>
              <span className="hud-value">
                {stats.wordsRead}/{totalWords}
              </span>
            </div>
          </div>

          <div className="hud-bottom">
            <div className="hud-progress">
              <div className="hud-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            {lastTranscript && settings.source === 'mic' && <div className="hud-transcript">“{lastTranscript}”</div>}
          </div>
        </>
      )}
    </div>
  )
}
