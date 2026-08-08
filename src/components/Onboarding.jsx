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
              <h1 className="onboard-title">A teleprompter that follows you.</h1>
              <p className="onboard-sub">
                Read naturally — pause, breathe, or go off-script. It waits when you do. Your microphone is ready;
                start a rehearsal or try the demo first.
              </p>
              <div className="onboard-actions">
                <button className="btn btn-primary btn-lg" onClick={onSaveKey}>
                  Use microphone
                </button>
                <button className="btn btn-ghost btn-lg" onClick={onWatchDemo}>
                  Try the demo
                </button>
              </div>
              <p className="onboard-note">The demo needs no microphone and runs entirely in the browser.</p>
            </>
          ) : (
            <>
              <div className="onboard-brand">Prompter</div>
              <h1 className="onboard-title">A teleprompter that follows you.</h1>
              <p className="onboard-sub">
                Read naturally — pause, breathe, or go off-script. It waits when you do. Works on iPad, Windows and Mac.
              </p>
              <div className="onboard-actions">
                <button className="btn btn-primary btn-lg" onClick={() => setStep(1)}>
                  Connect my microphone
                </button>
                <button className="btn btn-ghost btn-lg" onClick={() => finish(true)}>
                  Try the demo
                </button>
              </div>
              <p className="onboard-note">
                The <b>Demo reader</b> needs no key — use it to see how the prompter moves before connecting your mic.
              </p>
            </>
          )
        )}

        {step === 1 && (
          <>
            <div className="onboard-step">One quick step</div>
            <h1 className="onboard-title">Connect your microphone</h1>
            <p className="onboard-sub">
              Paste a free Speechmatics key so the prompter can follow your voice. It takes about a minute to get.
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
