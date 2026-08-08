import { useEffect, useState } from 'react'

export default function SettingsPanel({ settings, setSetting, resetSettings, speechmaticsKey, saveSpeechmaticsKey, onClose }) {
  const proxyConfigured = Boolean(settings.tokenProxyUrl)
  return (
    <PanelShell title="Settings" onClose={onClose}>
      <Section title="API keys">
        <KeyRow
          label="Speechmatics"
          auto={proxyConfigured}
          hint={
            proxyConfigured
              ? 'Automatic via token proxy — no key needed on any device. Optional manual key is used as a fallback.'
              : 'Required for live voice tracking — the Demo reader needs no key.'
          }
          value={speechmaticsKey}
          onChange={saveSpeechmaticsKey}
          url="https://portal.speechmatics.com/api-keys"
        />
        <p className="panel-note">
          {proxyConfigured
            ? 'Tokens are minted by your Cloudflare Worker; your key never reaches this device.'
            : 'Your key stays in this browser and is sent only to Speechmatics to mint a short-lived session token. New accounts start with free credit.'}
        </p>

        <ProxyRow value={settings.tokenProxyUrl} onChange={(v) => setSetting('tokenProxyUrl', v)} />
      </Section>

      <Section title="Scrolling">
        <Segmented
          label="Mode"
          options={[
            { value: 'constant', label: 'Constant' },
            { value: 'voice', label: 'Voice Sync' },
          ]}
          value={settings.mode}
          onChange={(v) => setSetting('mode', v)}
        />
        <div className="panel-hint">
          {settings.mode === 'constant'
            ? 'Scrolls at a steady speed, no tracking.'
            : 'Pauses when you pause; follows your voice.'}
        </div>

        {settings.mode === 'voice' && (
          <>
            <Segmented
              label="Source"
              options={[
                { value: 'demo', label: 'Demo reader' },
                { value: 'mic', label: 'Microphone' },
              ]}
              value={settings.source}
              onChange={(v) => setSetting('source', v)}
            />
            <div className="panel-hint">
              {settings.source === 'demo'
                ? 'Simulates a reader at the baseline speed.'
                : settings.tokenProxyUrl
                  ? 'Follows your voice through the configured token service.'
                  : 'Follows your voice. Requires a Speechmatics key.'}
            </div>
            {settings.source === 'mic' && (
              <MicrophoneSelect
                value={settings.micDeviceId || 'default'}
                onChange={(value) => setSetting('micDeviceId', value)}
              />
            )}
          </>
        )}

        <Slider
          label="Baseline speed"
          value={settings.baselineWpm}
          min={70}
          max={400}
          step={5}
          suffix=" wpm"
          onChange={(v) => setSetting('baselineWpm', v)}
        />
        <div className="panel-hint">Pre-set scroll speed. Voice Sync uses this as its fallback pace.</div>

        <Toggle label="Auto-loop" checked={settings.autoLoop} onChange={(v) => setSetting('autoLoop', v)} hint="Restart from the top when the script ends." />

        <Slider
          label="Eyeline position"
          value={settings.eyelinePercent}
          min={18}
          max={85}
          step={1}
          suffix="%"
          onChange={(v) => setSetting('eyelinePercent', v)}
        />
        <div className="panel-hint">
          {settings.mode === 'voice' && settings.source === 'mic'
            ? 'Voice Sync keeps the active rendered row at this eyeline.'
            : 'Choose where the reading line sits during speed scroll or the demo reader.'}
        </div>
        <Segmented
          label="Position preset"
          options={[
            { value: 18, label: 'Top' },
            { value: 50, label: 'Center' },
            { value: 85, label: 'Bottom' },
          ]}
          value={settings.eyelinePercent}
          onChange={(value) => setSetting('eyelinePercent', value)}
        />
      </Section>

      <Section title="Matching">
        {settings.mode === 'constant' ? (
          <div className="panel-hint">Speed scroll glides smoothly — no word tracking or highlight.</div>
        ) : (
          <Segmented
            label="Highlight"
            options={[
              { value: 'none', label: 'None' },
              { value: 'word', label: 'Word-by-word' },
              { value: 'line', label: 'Line-by-line' },
            ]}
            value={settings.matching}
            onChange={(v) => setSetting('matching', v)}
          />
        )}
        <div className="panel-hint">
          {settings.matching === 'none'
            ? 'No tracking highlight — the script just stays put until you speak.'
            : settings.matching === 'word'
              ? 'Tracks each spoken word for the tightest cursor.'
              : 'Highlights the current sentence while spoken words still control the scroll.'}
        </div>
        {settings.mode === 'voice' && settings.source === 'mic' && (
          <Toggle
            label="Voice commands"
            checked={settings.voiceCommands}
            onChange={(v) => setSetting('voiceCommands', v)}
            hint="Say “rewind” or “back” to jump to the top."
          />
        )}
      </Section>

      <Section title="Display">
        <Slider label="Font size" value={settings.fontSize} min={24} max={96} step={1} suffix="px" onChange={(v) => setSetting('fontSize', v)} />
        <Slider label="Line height" value={settings.lineHeight} min={1.1} max={2.2} step={0.05} onChange={(v) => setSetting('lineHeight', v)} />
        <Slider label="Side margins" value={settings.sideMargins} min={0} max={40} step={1} suffix="%" onChange={(v) => setSetting('sideMargins', v)} />

        <Segmented
          label="Font"
          options={[
            { value: 'sans', label: 'Sans Serif' },
            { value: 'serif', label: 'Serif' },
            { value: 'mono', label: 'Mono' },
          ]}
          value={settings.fontFamily}
          onChange={(v) => setSetting('fontFamily', v)}
        />

        <Toggle
          label="Mirror"
          checked={settings.mirror}
          onChange={(v) => {
            setSetting('mirror', v)
            if (v && settings.mirrorAxis === 'none') setSetting('mirrorAxis', 'h')
          }}
          hint="For beam-splitter rigs."
        />
        {settings.mirror && (
          <Segmented
            label="Flip"
            options={[
              { value: 'h', label: 'Flip H' },
              { value: 'v', label: 'Flip V' },
              { value: 'both', label: 'Both' },
            ]}
            value={settings.mirrorAxis}
            onChange={(v) => setSetting('mirrorAxis', v)}
          />
        )}

        <Segmented
          label="Eyeline indicator"
          options={[
            { value: 'none', label: 'None' },
            { value: 'arrow', label: 'Arrow' },
            { value: 'line', label: 'Line' },
            { value: 'band', label: 'Band' },
          ]}
          value={settings.eyeline}
          onChange={(v) => setSetting('eyeline', v)}
        />

        <Toggle label="Show HUD" checked={settings.showHud} onChange={(v) => setSetting('showHud', v)} />
        <Toggle label="Show stage cues" checked={settings.showCues} onChange={(v) => setSetting('showCues', v)} hint="[bracketed] direction notes." />
        <Toggle label="Countdown on start" checked={settings.countdownOnStart} onChange={(v) => setSetting('countdownOnStart', v)} hint="3-2-1 before the script begins." />
      </Section>

      <div className="panel-footer">
        <button className="btn btn-ghost" onClick={resetSettings}>
          Reset settings
        </button>
      </div>
    </PanelShell>
  )
}

function PanelShell({ title, onClose, children }) {
  return (
    <div className="panel-overlay">
      <div className="panel">
        <div className="panel-header">
          <h2>{title}</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4l-6.3 6.3-1.4-1.4 6.3-6.3-6.3-6.3 1.4-1.4 6.3 6.3 6.3-6.3z" />
            </svg>
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  )
}

export function Section({ title, children }) {
  return (
    <div className="panel-section">
      <h3 className="panel-section-title">{title}</h3>
      <div className="panel-section-body">{children}</div>
    </div>
  )
}

function KeyRow({ label, hint, value, onChange, url, auto }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const present = Boolean(value)

  const save = () => {
    onChange(draft)
    setEditing(false)
  }

  return (
    <div className="keyrow">
      <div className="keyrow-head">
        <span className="keyrow-label">{label}</span>
        <span className={`chip chip-sm ${auto ? 'chip-demo' : present ? 'chip-demo' : 'chip-paused'}`}>
          {auto ? 'Auto' : present ? 'Set' : 'Missing'}
        </span>
      </div>
      {!editing ? (
        <div className="keyrow-actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              setDraft(value || '')
              setEditing(true)
            }}
          >
            Edit
          </button>
          {present && (
            <button className="btn btn-ghost" onClick={() => onChange('')}>
              Clear
            </button>
          )}
        </div>
      ) : (
        <div className="keyrow-edit">
          <input
            type="password"
            className="input"
            placeholder="Paste your API key"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <div className="keyrow-actions">
            <button className="btn btn-primary" onClick={save}>
              Save
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <p className="panel-note">{hint} {url && <a href={url} target="_blank" rel="noreferrer">Get a free key ↗</a>}</p>
    </div>
  )
}

function ProxyRow({ value, onChange }) {
  const [draft, setDraft] = useState(value || '')

  return (
    <div className="keyrow">
      <div className="keyrow-head">
        <span className="keyrow-label">Token proxy URL</span>
        <span className={`chip chip-sm ${value ? 'chip-demo' : 'chip-paused'}`}>{value ? 'Set' : 'Optional'}</span>
      </div>
      <div className="keyrow-edit">
        <input
          type="url"
          className="input"
          placeholder="https://prompter-token.<you>.workers.dev"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onChange(draft.trim())}
        />
      </div>
      <p className="panel-note">
        Advanced: a Cloudflare Worker that mints Speechmatics tokens, so devices never need your key. Leave empty to
        use the key above.
      </p>
    </div>
  )
}

function Segmented({ label, options, value, onChange }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented">
        {options.map((o) => (
          <button
            key={o.value}
            className={`seg-btn${o.value === value ? ' seg-btn-active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, step, suffix = '', onChange }) {
  return (
    <div className="field">
      <div className="field-row">
        <span className="field-label">{label}</span>
        <span className="field-value">
          {Number(value.toFixed(2))}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

function MicrophoneSelect({ value, onChange }) {
  const [devices, setDevices] = useState([])

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const all = await navigator.mediaDevices?.enumerateDevices?.()
        if (active) setDevices((all || []).filter((device) => device.kind === 'audioinput' && device.deviceId !== 'default'))
      } catch {
        if (active) setDevices([])
      }
    }
    refresh()
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
    return () => {
      active = false
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh)
    }
  }, [])

  return (
    <label className="field">
      <span className="field-label">Microphone</span>
      <select className="input field-select" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="default">System default</option>
        {devices.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Microphone ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  )
}

function Toggle({ label, checked, onChange, hint }) {
  return (
    <div className="field field-toggle">
      <div className="toggle-main">
        <span className="field-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        className={`switch${checked ? ' switch-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  )
}
