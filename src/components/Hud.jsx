import { formatDuration } from '../lib/parser'
import { PHASE } from '../hooks/usePrompter'

const VOICE_LABELS = {
  off: 'Mic off',
  starting: 'Starting mic...',
  listening: 'Listening',
  waiting: 'Waiting for your voice',
  offscript: 'Off-script — holding',
  error: 'Mic error',
}

export default function Hud({ stats, phase, settings, voiceStatus, lastTranscript, totalWords, running, hasKey }) {
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
      <span className="chip chip-status chip-paused">{hasKey ? 'Demo reader — voice available' : 'Demo reader'}</span>
    ) : (
      <span className="chip chip-status chip-const">Speed scroll</span>
    )

  return (
    <div
      className={`hud ${running ? 'hud-live' : ''}`}
      title={lastTranscript && settings.source === 'mic' ? lastTranscript : undefined}
    >
      <div className="hud-statusbar">
        <div className="hud-status-main" aria-live="polite">
          {statusChip}
        </div>
        {phase === PHASE.PAUSED && <span className="chip chip-sm chip-paused">Paused</span>}
        {phase === PHASE.ENDED && <span className="chip chip-sm chip-paused">Finished</span>}
      </div>

      <div className="hud-stats">
        <HudStat label="WPM" value={stats.wpm || settings.baselineWpm} />
        <HudStat label="Elapsed" value={formatDuration(stats.elapsed)} />
        <HudStat label="Remaining" value={`~${formatDuration(stats.remaining)}`} />
      </div>

      <div className="hud-bottom">
        <div className="hud-progress">
          <div className="hud-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="hud-count">{stats.wordsRead}/{totalWords}</span>
      </div>
    </div>
  )
}

function HudStat({ label, value }) {
  return (
    <div className="hud-stat">
      <span className="hud-label">{label}</span>
      <span className="hud-value">{value}</span>
    </div>
  )
}
