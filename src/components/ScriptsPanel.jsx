import { useMemo, useRef, useState } from 'react'
import { parseScript, secondsForWords, formatDuration } from '../lib/parser'

export default function ScriptsPanel({
  scripts,
  activeId,
  active,
  newScript,
  saveScript,
  renameScript,
  deleteScript,
  loadScript,
  importScript,
  baselineWpm,
  onLoadToPrompter,
  onClose,
}) {
  const [draft, setDraft] = useState(active.text)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [renaming, setRenaming] = useState(null)
  const [nameDraft, setNameDraft] = useState('')
  const fileInputRef = useRef(null)

  const activeDoc = useMemo(() => parseScript(draft), [draft])

  const handleChange = (text) => {
    setDraft(text)
    saveScript(activeId, text)
  }

  const handleLoad = (id) => {
    loadScript(id)
    const s = scripts.find((x) => x.id === id)
    setDraft(s ? s.text : '')
  }

  const finishImport = (text) => {
    if (!text.trim()) return
    const s = importScript(text)
    setDraft(s.text)
    setImportText('')
    setShowImport(false)
    onLoadToPrompter()
    onClose()
  }

  const handleFileImport = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      finishImport(String(reader.result || ''))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleExport = () => {
    const name = (active.name || 'script').trim()
    const safeName = name.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 60) || 'script'
    const blob = new Blob([draft], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="panel-overlay">
      <div className="panel panel-wide">
        <div className="panel-header">
          <h2>Scripts</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4l-6.3 6.3-1.4-1.4 6.3-6.3-6.3-6.3 1.4-1.4 6.3 6.3 6.3-6.3z" />
            </svg>
          </button>
        </div>

        <div className="panel-body scripts-body">
          <div className="scripts-list">
            <div className="scripts-actions">
              <button className="btn btn-primary" onClick={() => handleLoad(newScript().id)}>
                + New
              </button>
              <button className="btn btn-ghost" onClick={() => setShowImport((v) => !v)}>
                Import text
              </button>
              <button className="btn btn-ghost" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
                Import file…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,text/plain"
                style={{ display: 'none' }}
                onChange={handleFileImport}
              />
            </div>

            {showImport && (
              <div className="import-box">
                <textarea
                  className="input"
                  rows={5}
                  placeholder="Paste a script…"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && importText.trim()) {
                      e.preventDefault()
                      finishImport(importText)
                    }
                  }}
                  autoFocus
                />
                <button className="btn btn-primary" disabled={!importText.trim()} onClick={() => finishImport(importText)}>
                  Import
                </button>
              </div>
            )}

            <ul className="script-list">
              {scripts.map((s) => {
                const d = parseScript(s.text)
                const dur = secondsForWords(d.totalWords, baselineWpm)
                return (
                  <li key={s.id} className={`script-item${s.id === activeId ? ' script-item-active' : ''}`}>
                    <button className="script-item-main" onClick={() => handleLoad(s.id)}>
                      <span className="script-item-name">{s.name || 'Untitled'}</span>
                      <span className="script-item-meta">
                        {d.totalWords} words · ~{formatDuration(dur)}
                      </span>
                    </button>
                    {renaming === s.id ? (
                      <input
                        className="input script-rename"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            renameScript(s.id, nameDraft)
                            setRenaming(null)
                          }
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        autoFocus
                      />
                    ) : (
                      <button
                        className="iconbtn"
                        onClick={() => {
                          setRenaming(s.id)
                          setNameDraft(s.name)
                        }}
                        title="Rename"
                        aria-label="Rename"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                          <path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                        </svg>
                      </button>
                    )}
                    {s.id !== 'welcome' && (
                      <button
                        className="iconbtn iconbtn-danger"
                        onClick={() => deleteScript(s.id)}
                        title="Delete"
                        aria-label="Delete"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                          <path d="M6 7h12v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7zm4-4h4a1 1 0 0 1 1 1v1h5v2H4V5h5V4a1 1 0 0 1 1-1z" />
                        </svg>
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="editor">
            <div className="editor-meta">
              <span>
                {activeDoc.totalWords} words · ~{formatDuration(secondsForWords(activeDoc.totalWords, baselineWpm))} at {baselineWpm} wpm
              </span>
              <span className="editor-hint"># Headings shown, never read · [cues] ignored by tracking</span>
            </div>
            <textarea
              className="editor-textarea"
              value={draft}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="Write your script here…&#10;&#10;# A heading&#10;[a stage cue]&#10;The words you will speak."
              spellCheck="true"
            />
            <div className="editor-actions">
              <button className="btn btn-ghost" onClick={handleExport} title="Download this script as a .txt file">
                Export…
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  onLoadToPrompter()
                  onClose()
                }}
              >
                Load to prompter
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
