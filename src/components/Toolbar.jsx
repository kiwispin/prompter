import { PHASE } from '../hooks/usePrompter'

export default function Toolbar({
  phase,
  running,
  activeName,
  onToggle,
  onRestart,
  onNudge,
  onOpenSettings,
  onOpenScripts,
  onToggleFullscreen,
  micStatus,
  voiceStatus,
  mode,
  source,
}) {
  const voiceLabel = {
    off: 'Mic off',
    starting: 'Starting mic...',
    listening: 'Listening',
    waiting: 'Waiting for your voice',
    offscript: 'Off-script - holding',
    error: 'Mic error',
  }[voiceStatus] || (micStatus === 'live' ? 'Listening' : 'Mic off')

  const voiceClass =
    voiceStatus === 'error'
      ? 'chip-error'
      : voiceStatus === 'waiting' || voiceStatus === 'offscript'
        ? 'chip-paused'
        : voiceStatus === 'listening'
          ? 'chip-live'
          : 'chip-off'

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <ToolbarButton icon={running ? 'pause' : 'play'} label={running ? 'Pause' : 'Play'} title="Play/Pause (Space)" onClick={onToggle} />
        <ToolbarButton icon="restart" label="Restart" title="Restart (R)" onClick={onRestart} />
        <span className="toolbar-divider" />
        <ToolbarButton icon="back" label="Back" title="Back a few words (Arrow Up)" onClick={() => onNudge(-3)} />
        <ToolbarButton icon="forward" label="Skip" title="Skip a few words (Arrow Down)" onClick={() => onNudge(3)} />
      </div>

      <div className="toolbar-center">
        <span className="toolbar-title">{activeName}</span>
        {mode === 'voice' && source === 'mic' && (
          <span className={`chip chip-sm toolbar-voice-chip ${voiceClass}`} aria-live="polite">
            {voiceLabel}
          </span>
        )}
        {phase === PHASE.PAUSED && <span className="chip chip-sm chip-paused">Paused</span>}
        {phase === PHASE.ENDED && <span className="chip chip-sm chip-paused">Finished</span>}
      </div>

      <div className="toolbar-right">
        <ToolbarButton icon="fullscreen" label="Fullscreen" title="Fullscreen (F)" onClick={onToggleFullscreen} />
        <ToolbarButton icon="script" label="Scripts" title="Scripts" onClick={onOpenScripts} />
        <ToolbarButton icon="gear" label="Settings" title="Settings (S)" onClick={onOpenSettings} />
      </div>
    </div>
  )
}

function ToolbarButton({ icon, label, title, onClick }) {
  return (
    <button className="iconbtn toolbar-btn" onClick={onClick} title={title} aria-label={label}>
      <Icon name={icon} />
      <span className="toolbar-btn-label">{label}</span>
    </button>
  )
}

function Icon({ name }) {
  const paths = {
    play: <path d="M8 5v14l11-7z" />,
    pause: <path d="M6 5h4v14H6zm8 0h4v14h-4z" />,
    restart: <path d="M12 5V2L7 6l5 4V7c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z" />,
    back: <path d="M15 18V6l-8 6z" />,
    forward: <path d="M9 18V6l8 6z" />,
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
    script: <path d="M6 2h9l5 5v15H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm9 1.5V8h4.5L15 3.5zM8 12h8v1.5H8zm0 3h8v1.5H8zm0 3h5v1.5H8z" />,
    fullscreen: <path d="M5 5h5v2H7v3H5V5zm9 0h5v5h-2V7h-3V5zm-9 9h2v3h3v2H5v-5zm11 0h2v5h-5v-2h3v-3z" />,
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      {name === 'play' ? paths.play : name === 'pause' ? paths.pause : paths[name]}
    </svg>
  )
}
