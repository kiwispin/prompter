import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LINE_TEXT, LINE_HEADING, LINE_CUE } from '../lib/parser'

const EYELINE_FRACTION = {
  top: 0.18,
  center: 0.55,
  bottom: 0.85,
}

const FONT_STACK = {
  sans: "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  mono: "'SFMono-Regular', Consolas, 'Roboto Mono', monospace",
  serif: "Georgia, 'Times New Roman', serif",
}

export default function PrompterView({ doc, word, positionRef, totalWords, mode, settings, onManualScroll, running }) {
  const stageRef = useRef(null)
  const linesRef = useRef(null)
  const [activeLine, setActiveLine] = useState(-1)
  // manualRef holds the current translateY while the user is dragging/scrolling
  // by hand; the auto-scroll loop stands down until it's released.
  const manualRef = useRef(null)
  const dragRef = useRef(null)
  const wheelTimerRef = useRef(null)
  const wheelDeltaRef = useRef(0)
  // Authoritative scroll offset (px) shared by rate, mic and manual scrolling.
  const offsetRef = useRef(null)
  // Momentum (px/ms) after a manual flick.
  const momentumRef = useRef({ v: 0, running: false })
  // Rate-driven scroll cache.
  const rateRowKey = useRef(null)
  const ratePxPerWord = useRef(4)
  const prevIdxRef = useRef(-1)

  const { fontSize, lineHeight, sideMargins, fontFamily, matching } = settings

  const activeLineId = useMemo(() => {
    if (word < 0) return -1
    const lineId = doc.wordLine.get(word)
    return lineId == null ? -1 : lineId
  }, [doc, word])

  useEffect(() => setActiveLine(activeLineId), [activeLineId])

  const highlightEnabled = mode === 'constant' ? false : matching !== 'none'

  const clampOffset = useCallback((holder, stage, y) => {
    const maxScroll = holder.scrollHeight - stage.clientHeight
    return Math.max(-maxScroll, Math.min(y, stage.clientHeight))
  }, [])

  // Pick the word nearest the reading line (used after manual scroll).
  const wordAtReadingLine = useCallback(() => {
    const stage = stageRef.current
    const holder = linesRef.current
    if (!stage || !holder) return -1
    const frac = EYELINE_FRACTION[settings.readingPos] ?? 0.5
    const eyelineY = stage.getBoundingClientRect().top + stage.clientHeight * frac
    let best = -1
    let bestDist = Infinity
    for (const el of holder.querySelectorAll('[data-wid]')) {
      const r = el.getBoundingClientRect()
      const d = Math.abs(r.top + r.height / 2 - eyelineY)
      if (d < bestDist) {
        bestDist = d
        best = Number(el.dataset.wid)
      }
    }
    return best
  }, [settings.readingPos])

  const syncAfterManual = useCallback(() => {
    const released = manualRef.current
    manualRef.current = null
    if (released != null) offsetRef.current = released
    const idx = wordAtReadingLine()
    if (idx >= 0 && onManualScroll) onManualScroll(idx)
  }, [wordAtReadingLine, onManualScroll])

  const applyManual = useCallback(
    (dy) => {
      const holder = linesRef.current
      const stage = stageRef.current
      if (!holder || !stage) return dy
      const next = clampOffset(holder, stage, dy)
      manualRef.current = next
      holder.style.transform = `translateY(${next}px)`
      return next
    },
    [clampOffset],
  )

  const onPointerDown = useCallback((e) => {
    if (e.target && e.target.closest && e.target.closest('.toolbar, .hud, .panel, .onboard, .countdown')) return
    if (!e.isPrimary) return
    momentumRef.current.running = false
    dragRef.current = {
      startY: e.clientY,
      prevY: e.clientY,
      prevT: performance.now(),
      v: 0,
      moved: false,
      start: parseManual(linesRef.current),
    }
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    if (!d.moved && Math.abs(e.clientY - d.startY) < 6) return
    d.moved = true
    const now = performance.now()
    const dt = Math.max(8, now - d.prevT)
    const prev = d.prevY
    d.prevY = e.clientY
    d.prevT = now
    const dy = e.clientY - prev
    d.v = dy / dt // px/ms
    applyManual(d.start + (e.clientY - d.startY))
  }, [applyManual])

  const onPointerUp = useCallback(() => {
    const d = dragRef.current
    if (d && d.moved) {
      // Flick detection: launch momentum if we let go while still moving fast.
      if (Math.abs(d.v) > 0.35) {
        momentumRef.current = { v: d.v, running: true }
      } else {
        syncAfterManual()
      }
    }
    dragRef.current = null
  }, [syncAfterManual])

  const onWheel = useCallback(
    (e) => {
      const holder = linesRef.current
      if (!holder) return
      const current = parseManual(holder)
      applyManual(current - e.deltaY)
      wheelDeltaRef.current = e.deltaY
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = setTimeout(() => {
        const delta = wheelDeltaRef.current
        if (Math.abs(delta) > 12) {
          momentumRef.current = { v: -delta / 16, running: true }
        } else {
          syncAfterManual()
        }
      }, 120)
    },
    [applyManual, syncAfterManual],
  )

  // Scroll loop.
  //   Speed scroll + Demo reader -> continuous rate-driven scroll (like a
  //   hardware prompter): the text glides up at a steady pixel rate.
  //   Microphone mode -> pins the word you're on at the reading line and
  //   eases between recognition bursts.
  //   Manual drag / wheel -> direct control with momentum on release.
  //   offsetRef is the single source of truth for the scroll position, so a
  //   manual release never snaps back to the auto position.
  useEffect(() => {
    let raf
    let last = performance.now()
    const ease = 0.25

    const step = () => {
      const stage = stageRef.current
      const holder = linesRef.current
      if (stage && holder) {
        const now = performance.now()
        const dt = Math.min(0.1, (now - last) / 1000)
        last = now
        const frac = EYELINE_FRACTION[settings.readingPos] ?? 0.5
        const eyeline = stage.clientHeight * frac
        const maxScroll = holder.scrollHeight - stage.clientHeight
        const clamp = (y) => Math.max(-maxScroll, Math.min(y, stage.clientHeight))

        // Momentum after a flick.
        if (momentumRef.current.running) {
          const m = momentumRef.current
          m.v *= 0.94
          const next = manualRef.current + m.v * dt * 1000
          const clamped = clamp(next)
          manualRef.current = clamped
          holder.style.transform = `translateY(${clamped}px)`
          if (Math.abs(m.v) < 0.04 || clamped !== next) {
            m.running = false
            syncAfterManual()
          }
          raf = requestAnimationFrame(step)
          return
        }

        // User has hold of the text; keep their position.
        if (manualRef.current != null) {
          raf = requestAnimationFrame(step)
          return
        }

        const isRate = mode === 'constant' || (mode === 'voice' && settings.source === 'demo')

        if (isRate) {
          const pos = positionRef.current
          const idx = Math.max(0, Math.min(totalWords - 1, Math.floor(pos)))
          if (prevIdxRef.current > idx) offsetRef.current = null // restart / moved back
          prevIdxRef.current = idx

          const el0 = holder.querySelector(`[data-wid="${idx}"]`)
          if (offsetRef.current == null && el0) {
            offsetRef.current = eyeline - (el0.offsetTop + el0.offsetHeight / 2)
          }
          if (el0) {
            const rowTop = el0.offsetTop
            if (rateRowKey.current !== rowTop) {
              rateRowKey.current = rowTop
              ratePxPerWord.current = measureRowPxPerWord(holder, idx)
            }
          }
          if (running && ratePxPerWord.current && settings.baselineWpm > 0) {
            offsetRef.current -= (settings.baselineWpm / 60) * ratePxPerWord.current * dt
          }
          if (offsetRef.current != null) holder.style.transform = `translateY(${clamp(offsetRef.current)}px)`
        } else {
          const pos = positionRef.current
          const idx = Math.max(0, Math.min(totalWords - 1, Math.floor(pos)))
          let target = 0
          const el0 = holder.querySelector(`[data-wid="${idx}"]`)
          if (el0) {
            let cy = el0.offsetTop + el0.offsetHeight / 2
            const el1 = holder.querySelector(`[data-wid="${idx + 1}"]`)
            if (el1) {
              const c1 = el1.offsetTop + el1.offsetHeight / 2
              cy += (pos - Math.floor(pos)) * (c1 - cy)
            }
            target = eyeline - cy
          }
          target = clamp(target)
          if (offsetRef.current == null) {
            offsetRef.current = target
          } else {
            offsetRef.current += (target - offsetRef.current) * ease
            if (Math.abs(target - offsetRef.current) < 0.5) offsetRef.current = target
          }
          holder.style.transform = `translateY(${clamp(offsetRef.current)}px)`
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.readingPos, settings.source, doc, mode, positionRef, totalWords, running, syncAfterManual])

  // Force a re-measure pass when display settings change.
  useLayoutEffect(() => {
    setActiveLine(activeLineId)
  }, [fontSize, lineHeight, sideMargins, fontFamily, activeLineId])

  useEffect(
    () => () => {
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
    },
    [],
  )

  const mirrorStyle = useMemo(() => {
    if (!settings.mirror) return {}
    switch (settings.mirrorAxis) {
      case 'h':
        return { transform: 'scaleX(-1)' }
      case 'v':
        return { transform: 'scaleY(-1)' }
      case 'both':
        return { transform: 'scale(-1, -1)' }
      default:
        return {}
    }
  }, [settings.mirror, settings.mirrorAxis])

  const isLineHighlighted = useCallback(
    (line) => highlightEnabled && matching === 'line' && line.type === LINE_TEXT && line.id === activeLine,
    [activeLine, highlightEnabled, matching],
  )

  return (
    <div
      ref={stageRef}
      className="prompter-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{
        '--font-size': `${fontSize}px`,
        '--line-height': lineHeight,
        '--side-margin': `${sideMargins}%`,
        '--font': FONT_STACK[fontFamily] || FONT_STACK.sans,
      }}
    >
      <div className="prompter-mirror" style={mirrorStyle}>
        <div className="prompter-lines" ref={linesRef}>
          {doc.lines.map((line, i) => {
            const lineActive = isLineHighlighted(line)
            return (
              <div
                key={line.type === LINE_TEXT ? line.id : `h-${i}`}
                data-line={line.type === LINE_TEXT ? line.id : undefined}
                className={`pline pline-${line.type}${lineActive ? ' pline-active' : ''}`}
              >
                {line.type === LINE_TEXT ? (
                  line.parts.map((part, pi) =>
                    part.kind === 'cue' ? (
                      <span key={`c${pi}`} className="pcue-inline">
                        [{part.text}]
                      </span>
                    ) : (
                      part.words.map((w) => (
                        <span
                          key={w.index}
                          data-wid={w.index}
                          className={[
                            'pword',
                            highlightEnabled && w.index < word ? 'pword-read' : '',
                            highlightEnabled && matching === 'word' && w.index === word ? 'pword-current' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {w.word}{' '}
                        </span>
                      ))
                    ),
                  )
                ) : line.type === LINE_HEADING ? (
                  <span className="pheading-text">{line.text}</span>
                ) : line.type === LINE_CUE && settings.showCues ? (
                  line.cues.map((c, ci) => (
                    <span key={ci} className="pcue-text">
                      {ci > 0 ? ' ' : ''}[{c}]
                    </span>
                  ))
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
      <EyelineIndicator kind={settings.eyeline} fraction={EYELINE_FRACTION[settings.readingPos] ?? 0.5} />
    </div>
  )
}

function parseManual(holder) {
  if (!holder) return 0
  const t = holder.style.transform
  const m = t && /translateY\((-?[\d.]+)px\)/.exec(t)
  return m ? parseFloat(m[1]) : 0
}

// Pixels scrolled per word for the visual row containing word `idx`:
// (distance to the next row) / (words on this row).
function measureRowPxPerWord(holder, idx) {
  const el0 = holder.querySelector(`[data-wid="${idx}"]`)
  if (!el0) return 4
  const rowTop = el0.offsetTop
  // scan backward to the start of this row
  let start = idx
  while (start > 0) {
    const p = holder.querySelector(`[data-wid="${start - 1}"]`)
    if (!p || p.offsetTop !== rowTop) break
    start--
  }
  // scan forward to the last word of this row
  let end = idx
  while (end < holder.querySelectorAll('[data-wid]').length - 1) {
    const w = holder.querySelector(`[data-wid="${end}"]`)
    const w2 = holder.querySelector(`[data-wid="${end + 1}"]`)
    if (!w2 || w2.offsetTop !== w.offsetTop) break
    end++
  }
  const next = holder.querySelector(`[data-wid="${end + 1}"]`)
  if (!next) return 4
  const words = end - start + 1
  return words > 0 ? (next.offsetTop - rowTop) / words : 4
}

function EyelineIndicator({ kind, fraction }) {
  if (!kind || kind === 'none') return null
  const top = `${fraction * 100}%`
  if (kind === 'arrow') {
    return (
      <div className="eyeline eyeline-arrow" style={{ top }}>
        <span className="eyeline-arrow-mark" />
      </div>
    )
  }
  if (kind === 'line') {
    return <div className="eyeline eyeline-line" style={{ top }} />
  }
  if (kind === 'band') {
    return <div className="eyeline eyeline-band" style={{ top }} />
  }
  return null
}
