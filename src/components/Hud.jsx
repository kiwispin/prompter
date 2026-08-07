import { formatDuration } from '../lib/parser'
import { PHASE } from '../hooks/usePrompter'

const VOICE_LABELS = {
  off: 'Mic off',
  starting: 'Starting mic…',
  listening: '● Listening',
  waiting: 'Waiting for your voice',
  offscript: 'Off-script — holding',
  error: 'Mic error',
}

export default function Hud({ stats, phase, settings, voiceStatus, lastTranscript, totalWords, running }) {
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
      <span className={`chip ${chipClass}`}>{VOICE_LABELS[voiceStatus] || VOICE_LABELS.off}</span>
    ) : settings.mode === 'voice' ? (
      <span className="chip chip-demo">Demo reader</span>
    ) : (
      <span className="chip chip-const">Speed scroll</span>
    )

  return (
    <div className={`hud ${running ? 'hud-live' : ''}`}>
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
        <div className="hud-meta">
          {statusChip}
          {phase === PHASE.PAUSED && <span className="chip chip-paused">Paused</span>}
          {lastTranscript && settings.source === 'mic' && (
            <span className="hud-transcript">“{lastTranscript}”</span>
          )}
        </div>
      </div>
    </div>
  )
}
