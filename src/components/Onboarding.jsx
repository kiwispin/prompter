import { useState } from 'react'

export default function Onboarding({ speechmaticsKey, saveSpeechmaticsKey, onDone, onWatchDemo, onSaveKey, tokenProxyUrl }) {
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState(speechmaticsKey || '')
  const autoKey = Boolean(tokenProxyUrl)

  const finish = (demo) => {
    saveSpeechmaticsKey(draft)
    if (demo) onWatchDemo()
    else onSaveKey()
  }

  return (
    <div className="onboard-overlay">
      <div className="onboard-card">
        {step === 0 && (
          autoKey ? (
            <>
              <div className="onboard-brand">Prompter</div>
              <h1 className="onboard-title">Ready to prompt.</h1>
              <p className="onboard-sub">
                Your Speechmatics access is already configured for this site — no key needed on any device.
                Pick up the mic and read, or watch the demo first.
              </p>
              <div className="onboard-actions">
                <button className="btn btn-primary btn-lg" onClick={onSaveKey}>
                  Start with microphone
                </button>
                <button className="btn btn-ghost btn-lg" onClick={onWatchDemo}>
                  Watch the demo
                </button>
              </div>
              <p className="onboard-note">
                If you'd rather test without the mic first, the <b>Demo reader</b> needs nothing.
              </p>
            </>
          ) : (
            <>
              <div className="onboard-brand">Prompter</div>
              <h1 className="onboard-title">The words move when you speak.</h1>
              <p className="onboard-sub">
                Read your script out loud and it scrolls with you. Pause, and it waits. Works on iPad, Windows and Mac — all in the browser.
              </p>
              <div className="onboard-actions">
                <button className="btn btn-primary btn-lg" onClick={() => setStep(1)}>
                  Add my free key
                </button>
                <button className="btn btn-ghost btn-lg" onClick={() => finish(true)}>
                  Watch the demo
                </button>
              </div>
              <p className="onboard-note">
                Want to try it first? The <b>Demo reader</b> needs no key — a fake voice reads the script so you can see how it moves.
              </p>
            </>
          )
        )}

        {step === 1 && (
          <>
            <div className="onboard-step">One quick step</div>
            <h1 className="onboard-title">Add your free key so the app can hear you</h1>
            <p className="onboard-sub">
              To follow your voice, the app sends what you say to <b>Speechmatics</b>. You need a free key from them first — it takes about a minute to get. Paste it below.
            </p>
            <input
              type="password"
              className="input input-lg"
              placeholder="Paste your Speechmatics API key"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
            <div className="onboard-actions">
              <button className="btn btn-primary btn-lg" onClick={() => finish(false)} disabled={!draft.trim()}>
                Save &amp; use microphone
              </button>
              <button className="btn btn-ghost btn-lg" onClick={() => setStep(0)}>
                Back
              </button>
            </div>
            <p className="onboard-note">
              Your key stays in this browser and is sent only to Speechmatics.
              <a href="https://portal.speechmatics.com/api-keys" target="_blank" rel="noreferrer"> Get a free key ↗</a>
            </p>
          </>
        )}

        <button className="onboard-skip" onClick={() => onDone()}>
          Skip for now
        </button>
      </div>
    </div>
  )
}
