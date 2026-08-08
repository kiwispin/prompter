import { useState } from 'react'
import { PHASE } from '../hooks/usePrompter'

export default function Toolbar({
  phase,
  running,
  activeName,
  onToggle,
  onRestart,
  onOpenSettings,
  onOpenScripts,
  onToggleFullscreen,
  onToggleMirror,
  onOpenTour,
  mirror,
  mode,
  source,
  hasVoiceConfig,
}) {
  const [showVoiceNudge, setShowVoiceNudge] = useState(true)
  const engaged = running || phase === PHASE.CONNECTING || phase === PHASE.COUNTDOWN
  const state = getState(phase)

  return (
    <header className="toolbar">
      <div className="toolbar-identity">
        <span className="toolbar-mark" aria-hidden="true">
          <span />
        </span>
        <span className="toolbar-brand">
          <strong>Prompter</strong>
          <small>{mode === 'voice' && source === 'mic' ? 'Voice reader' : mode === 'voice' ? 'Demo reader' : 'Speed reader'}</small>
        </span>
        <span className="toolbar-title">{activeName}</span>
      </div>

      <div className="toolbar-actions">
        {mode === 'voice' && source !== 'mic' && showVoiceNudge && (
          <span className="toolbar-nudge">
            <button className="toolbar-nudge-main" onClick={onOpenSettings}>
              <Icon name="sparkles" size={12} />
              {hasVoiceConfig ? 'Switch to your voice' : 'Add your key to use your voice'}
            </button>
            <button className="toolbar-nudge-close" onClick={() => setShowVoiceNudge(false)} aria-label="Dismiss voice prompt">
              <Icon name="close" size={12} />
            </button>
          </span>
        )}

        <span className={`toolbar-state toolbar-state-${state.kind}`} aria-live="polite">
          <span className="toolbar-state-dot" />
          {state.label}
        </span>

        <ToolbarButton icon="script" label="Scripts" title="Scripts (E)" onClick={onOpenScripts} />
        <ToolbarButton icon="mirror" label="Mirror" title="Mirror (M)" onClick={onToggleMirror} active={mirror} />
        <ToolbarButton icon="restart" label="Restart" title="Restart (R)" onClick={onRestart} />
        <ToolbarButton icon="fullscreen" label="Fullscreen" title="Fullscreen (F)" onClick={onToggleFullscreen} />
        <ToolbarButton icon="settings" label="Settings" title="Settings (,)" onClick={onOpenSettings} />
        <ToolbarButton icon="help" label="Guided tour" title="Guided tour (?)" onClick={onOpenTour} />

        <button className={`toolbar-primary${engaged ? ' toolbar-primary-live' : ''}`} onClick={onToggle} title="Start/Stop (Space)">
          <Icon name={engaged ? 'pause' : 'play'} size={14} />
          <span>{engaged ? 'Stop' : 'Start'}</span>
        </button>
      </div>
    </header>
  )
}

function getState(phase) {
  if (phase === PHASE.CONNECTING) return { label: 'Starting', kind: 'busy' }
  if (phase === PHASE.COUNTDOWN) return { label: 'Ready', kind: 'busy' }
  if (phase === PHASE.RUNNING) return { label: 'Live', kind: 'live' }
  if (phase === PHASE.PAUSED) return { label: 'Paused', kind: 'paused' }
  if (phase === PHASE.ENDED) return { label: 'Finished', kind: 'paused' }
  return { label: 'Idle', kind: 'idle' }
}

function ToolbarButton({ icon, label, title, onClick, active = false }) {
  return (
    <button
      className={`iconbtn toolbar-btn toolbar-btn-${icon}${active ? ' toolbar-btn-active' : ''}`}
      onClick={onClick}
      title={title}
      aria-label={label}
      aria-pressed={icon === 'mirror' ? active : undefined}
    >
      <Icon name={icon} />
    </button>
  )
}

function Icon({ name, size = 16 }) {
  const paths = {
    play: <polygon points="6 3 20 12 6 21 6 3" />,
    pause: (
      <>
        <rect x="14" y="4" width="4" height="16" rx="1" />
        <rect x="6" y="4" width="4" height="16" rx="1" />
      </>
    ),
    script: (
      <>
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="M10 9H8M16 13H8M16 17H8" />
      </>
    ),
    mirror: (
      <>
        <path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3" />
        <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
        <path d="M12 20v2M12 14v2M12 8v2M12 2v2" />
      </>
    ),
    restart: (
      <>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </>
    ),
    fullscreen: (
      <>
        <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3" />
        <path d="M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
      </>
    ),
    settings: (
      <>
        <path d="M20 7h-9M14 17H5" />
        <circle cx="17" cy="17" r="3" />
        <circle cx="7" cy="7" r="3" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z" />
        <path d="M5 3v4M19 17v4M3 5h4M17 19h4" />
      </>
    ),
    close: <path d="M18 6 6 18M6 6l12 12" />,
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
