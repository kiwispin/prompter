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
  // Rate-driven scroll state (Speed/Demo modes).
  const ratePosRef = useRef(null)
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
    manualRef.current = null
    const idx = wordAtReadingLine()
    if (idx >= 0 && onManualScroll) onManualScroll(idx)
  }, [wordAtReadingLine, onManualScroll])

  const applyManual = useCallback(
    (dy) => {
      const holder = linesRef.current
      const stage = stageRef.current
      if (!holder || !stage) return
      const next = clampOffset(holder, stage, dy)
      manualRef.current = next
      holder.style.transform = `translateY(${next}px)`
    },
    [clampOffset],
  )

  const onPointerDown = useCallback((e) => {
    if (e.target && e.target.closest && e.target.closest('.toolbar, .hud, .panel, .onboard, .countdown')) return
    if (!e.isPrimary) return
    dragRef.current = { startY: e.clientY, moved: false, start: parseManual(linesRef.current) }
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    if (!d.moved && Math.abs(e.clientY - d.startY) < 6) return
    d.moved = true
    applyManual(d.start + (e.clientY - d.startY))
  }, [applyManual])

  const onPointerUp = useCallback(() => {
    if (dragRef.current && dragRef.current.moved) syncAfterManual()
    dragRef.current = null
  }, [syncAfterManual])

  const onWheel = useCallback(
    (e) => {
      const holder = linesRef.current
      if (!holder) return
      const current = parseManual(holder)
      applyManual(current - e.deltaY)
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = setTimeout(syncAfterManual, 200)
    },
    [applyManual, syncAfterManual],
  )

  // Scroll loop.
  //   Speed scroll + Demo reader -> continuous rate-driven scroll (like a
  //   hardware prompter): the text glides up at a steady pixel rate derived
  //   from the WPM, so motion is perfectly smooth with no row-by-row steps.
  //   Microphone mode -> pins the word you're on at the reading line and
  //   eases between recognition bursts.
  useEffect(() => {
    let raf
    let last = performance.now()
    let current = 0 // eased position (mic mode)
    const ease = 0.25

    const step = () => {
      const stage = stageRef.current
      const holder = linesRef.current
      if (stage && holder) {
        if (manualRef.current != null) {
          last = performance.now()
          raf = requestAnimationFrame(step)
          return
        }
        const now = performance.now()
        const dt = Math.min(0.1, (now - last) / 1000)
        last = now
        const frac = EYELINE_FRACTION[settings.readingPos] ?? 0.5
        const eyeline = stage.clientHeight * frac
        const maxScroll = holder.scrollHeight - stage.clientHeight
        const clamp = (y) => Math.max(-maxScroll, Math.min(y, stage.clientHeight))

        const isRate = mode === 'constant' || (mode === 'voice' && settings.source === 'demo')

        if (isRate) {
          // Continuous rate-driven scroll.
          const pos = positionRef.current
          const idx = Math.max(0, Math.min(totalWords - 1, Math.floor(pos)))
          // Restart/nudge backwards: re-anchor to the pinned top of the word.
          if (prevIdxRef.current > idx) ratePosRef.current = null
          prevIdxRef.current = idx

          const el0 = holder.querySelector(`[data-wid="${idx}"]`)
          if (ratePosRef.current == null && el0) {
            ratePosRef.current = eyeline - (el0.offsetTop + el0.offsetHeight / 2)
          }

          // Measure px-per-word for the current visual row (cached per row).
          if (el0) {
            const rowTop = el0.offsetTop
            if (rateRowKey.current !== rowTop) {
              rateRowKey.current = rowTop
              ratePxPerWord.current = measureRowPxPerWord(holder, idx)
            }
          }

          if (running && ratePxPerWord.current && settings.baselineWpm > 0) {
            ratePosRef.current -= (settings.baselineWpm / 60) * ratePxPerWord.current * dt
          }
          if (ratePosRef.current != null) {
            holder.style.transform = `translateY(${clamp(ratePosRef.current)}px)`
          }
        } else {
          // Mic mode: pin the current word at the reading line.
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
          current += (target - current) * ease
          if (Math.abs(target - current) < 0.5) current = target
          holder.style.transform = `translateY(${clamp(current)}px)`
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.readingPos, settings.source, doc, mode, positionRef, totalWords, running])

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
