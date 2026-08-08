import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { LINE_CUE, LINE_HEADING, LINE_TEXT } from '../lib/parser'

const EYELINE_PRESETS = { top: 0.18, center: 0.5, bottom: 0.85 }
const FONT_STACK = {
  sans: "'Inter Tight', 'Arial Narrow', 'Segoe UI', sans-serif",
  mono: "'SFMono-Regular', Consolas, 'Roboto Mono', monospace",
  serif: "Georgia, 'Times New Roman', serif",
}

export default function PrompterView({ doc, word, positionRef, totalWords, mode, settings, onManualScroll, running }) {
  const stageRef = useRef(null)
  const linesRef = useRef(null)
  const manualRef = useRef(null)
  const dragRef = useRef(null)
  const clickSuppressionRef = useRef(false)
  const offsetRef = useRef(null)
  const momentumRef = useRef({ v: 0, running: false })
  const previousIndexRef = useRef(-1)
  const geometryRef = useRef({ rows: [], wordToRow: new Map() })

  const { fontSize, lineHeight, sideMargins, fontFamily, matching } = settings
  const eyelineFraction = useMemo(() => {
    if (Number.isFinite(settings.eyelinePercent)) {
      return Math.max(0.12, Math.min(0.88, settings.eyelinePercent / 100))
    }
    return EYELINE_PRESETS[settings.readingPos] ?? EYELINE_PRESETS.center
  }, [settings.eyelinePercent, settings.readingPos])

  const activeSentenceId = useMemo(() => {
    if (word < 0) return -1
    return doc.wordSentence.get(word) ?? -1
  }, [doc, word])

  const highlightEnabled = mode !== 'constant' && matching !== 'none'

  const clampOffset = useCallback((y) => {
    const stage = stageRef.current
    const holder = linesRef.current
    if (!stage || !holder) return y
    const maxScroll = Math.max(0, holder.scrollHeight - stage.clientHeight)
    return Math.max(-maxScroll, Math.min(y, stage.clientHeight))
  }, [])

  const currentIndex = useCallback(() => {
    if (!totalWords) return -1
    return Math.max(0, Math.min(totalWords - 1, Math.floor(positionRef.current)))
  }, [positionRef, totalWords])

  const targetForIndex = useCallback(
    (index) => {
      const stage = stageRef.current
      const geometry = geometryRef.current
      if (!stage || index < 0) return 0
      const rowIndex = geometry.wordToRow.get(index)
      const row = rowIndex == null ? null : geometry.rows[rowIndex]
      if (!row) return 0
      return clampOffset(stage.clientHeight * eyelineFraction - row.center)
    },
    [clampOffset, eyelineFraction],
  )

  const targetForPosition = useCallback(
    (position) => {
      const stage = stageRef.current
      const geometry = geometryRef.current
      if (!stage || !geometry.rows.length || position < 0) return 0

      const index = Math.max(0, Math.min(totalWords - 1, Math.floor(position)))
      const rowIndex = geometry.wordToRow.get(index)
      const row = rowIndex == null ? null : geometry.rows[rowIndex]
      if (!row) return targetForIndex(index)

      const next = geometry.rows[rowIndex + 1]
      const wordCount = Math.max(1, row.endIndex - row.startIndex + 1)
      const progress = Math.max(0, Math.min(1, (position - row.startIndex) / wordCount))
      const nextCenter = next?.center ?? row.center + (row.bottom - row.top)
      const contentCenter = row.center + (nextCenter - row.center) * progress
      return clampOffset(stage.clientHeight * eyelineFraction - contentCenter)
    },
    [clampOffset, eyelineFraction, targetForIndex, totalWords],
  )

  const measureGeometry = useCallback(() => {
    const holder = linesRef.current
    if (!holder) return

    const rowMap = new Map()
    const rows = []
    const wordEls = [...holder.querySelectorAll('[data-wid]')]

    for (const el of wordEls) {
      const index = Number(el.dataset.wid)
      const top = el.offsetTop
      const bottom = top + el.offsetHeight
      let row = rows[rows.length - 1]

      if (!row || Math.abs(row.top - top) > 1) {
        row = { top, bottom, startIndex: index, endIndex: index, center: 0 }
        rows.push(row)
      } else {
        row.bottom = Math.max(row.bottom, bottom)
        row.endIndex = index
      }

      row.center = (row.top + row.bottom) / 2
      rowMap.set(index, rows.length - 1)
    }

    const current = currentIndex()
    geometryRef.current = {
      rows,
      wordToRow: rowMap,
    }

    // Re-anchor immediately after a layout change. The next voice update will
    // resume the normal eased movement from this valid geometry.
    offsetRef.current = current >= 0 ? targetForIndex(current) : 0
    if (holder) holder.style.transform = `translateY(${clampOffset(offsetRef.current)}px)`
  }, [clampOffset, currentIndex, targetForIndex])

  useLayoutEffect(() => {
    let frame
    offsetRef.current = null
    previousIndexRef.current = -1
    geometryRef.current = { rows: [], wordToRow: new Map() }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measureGeometry)
    }

    schedule()
    const stage = stageRef.current
    const holder = linesRef.current
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    if (observer && stage && holder) {
      observer.observe(stage)
      observer.observe(holder)
    }

    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [doc, fontSize, lineHeight, sideMargins, fontFamily, mode, eyelineFraction, measureGeometry])

  const wordAtReadingLine = useCallback(() => {
    const stage = stageRef.current
    const geometry = geometryRef.current
    if (!stage || !geometry.rows.length) return -1

    const eyeline = stage.clientHeight * eyelineFraction
    const offset = manualRef.current ?? offsetRef.current ?? 0
    let best = geometry.rows[0]
    let bestDistance = Infinity

    for (const row of geometry.rows) {
      const distance = Math.abs(row.center + offset - eyeline)
      if (distance < bestDistance) {
        best = row
        bestDistance = distance
      }
    }

    return best.startIndex
  }, [eyelineFraction])

  const syncAfterManual = useCallback(() => {
    const released = manualRef.current
    manualRef.current = null
    if (released != null) offsetRef.current = released
    const index = wordAtReadingLine()
    if (index >= 0) onManualScroll?.(index)
  }, [onManualScroll, wordAtReadingLine])

  const applyManual = useCallback(
    (value) => {
      const holder = linesRef.current
      if (!holder) return value
      const next = clampOffset(value)
      manualRef.current = next
      holder.style.transform = `translateY(${next}px)`
      return next
    },
    [clampOffset],
  )

  const onPointerDown = useCallback((event) => {
    if (event.target?.closest?.('.toolbar, .hud, .panel, .onboard, .countdown')) return
    if (!event.isPrimary) return

    momentumRef.current.running = false
    const currentOffset = offsetRef.current ?? parseManual(linesRef.current)
    dragRef.current = {
      startY: event.clientY,
      previousY: event.clientY,
      previousTime: performance.now(),
      velocity: 0,
      moved: false,
      startOffset: currentOffset,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (event) => {
      const drag = dragRef.current
      if (!drag) return
      if (!drag.moved && Math.abs(event.clientY - drag.startY) < 6) return

      drag.moved = true
      const now = performance.now()
      const dt = Math.max(8, now - drag.previousTime)
      const dy = event.clientY - drag.previousY
      drag.previousY = event.clientY
      drag.previousTime = now
      drag.velocity = dy / dt
      applyManual(drag.startOffset + event.clientY - drag.startY)
    },
    [applyManual],
  )

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current
    if (drag?.moved) {
      clickSuppressionRef.current = true
      if (Math.abs(drag.velocity) > 0.35) {
        momentumRef.current = { v: drag.velocity, running: true }
      } else {
        syncAfterManual()
      }
    }
    dragRef.current = null
  }, [syncAfterManual])

  const onWheel = useCallback(
    (event) => {
      event.preventDefault()
      let delta = event.deltaY
      if (event.deltaMode === 1) delta *= 16

      const momentum = momentumRef.current
      if (!momentum.running) {
        momentum.running = true
        momentum.v = 0
      }
      momentum.v = Math.max(-1.2, Math.min(1.2, momentum.v + (-delta * 0.5) / 240))
      if (manualRef.current == null) manualRef.current = offsetRef.current ?? 0
    },
    [],
  )

  const onLineClick = useCallback(
    (event) => {
      if (clickSuppressionRef.current) {
        clickSuppressionRef.current = false
        return
      }
      const sentenceId = Number(event.target.closest?.('[data-sentence]')?.dataset.sentence)
      const sentence = Number.isFinite(sentenceId) ? doc.sentences.find((item) => item.id === sentenceId) : null
      const start = sentence?.startIndex ?? Number(event.currentTarget.dataset.startIndex)
      if (Number.isFinite(start) && start >= 0) onManualScroll?.(start)
    },
    [doc, onManualScroll],
  )

  useEffect(() => {
    let raf
    let last = performance.now()
    const tau = 0.36

    const step = (now) => {
      const stage = stageRef.current
      const holder = linesRef.current
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
      last = now

      if (stage && holder) {
        // The prompter owns movement through transforms. Prevent focus or
        // automation scrollIntoView calls from introducing a second offset.
        if (stage.scrollTop !== 0) stage.scrollTop = 0
        const momentum = momentumRef.current
        if (momentum.running) {
          momentum.v *= Math.pow(0.93, dt * 60)
          const next = (manualRef.current ?? offsetRef.current ?? 0) + momentum.v * dt * 1000
          const clamped = clampOffset(next)
          manualRef.current = clamped
          holder.style.transform = `translateY(${clamped}px)`

          if (Math.abs(momentum.v) < 0.02 || clamped !== next) {
            momentum.running = false
            syncAfterManual()
          }
        } else if (manualRef.current == null) {
          const index = currentIndex()
          const previousIndex = previousIndexRef.current
          if (previousIndex > index && mode === 'constant') offsetRef.current = null
          previousIndexRef.current = index

          if (mode === 'constant') {
            offsetRef.current = targetForPosition(positionRef.current)
          } else {
            if (offsetRef.current == null) offsetRef.current = targetForIndex(index)
            const target = targetForIndex(index)
            const alpha = 1 - Math.exp(-dt / tau)
            const distance = target - offsetRef.current
            const maxStep = 260 * dt
            const stepDistance = Math.max(-maxStep, Math.min(maxStep, distance * alpha))
            offsetRef.current += stepDistance
            if (Math.abs(target - offsetRef.current) < 0.35) offsetRef.current = target
          }

          holder.style.transform = `translateY(${clampOffset(offsetRef.current ?? 0)}px)`
        }
      }

      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [clampOffset, currentIndex, mode, positionRef, syncAfterManual, targetForIndex, targetForPosition])

  const mirrorStyle = useMemo(() => {
    if (!settings.mirror) return {}
    if (settings.mirrorAxis === 'h') return { transform: 'scaleX(-1)' }
    if (settings.mirrorAxis === 'v') return { transform: 'scaleY(-1)' }
    if (settings.mirrorAxis === 'both') return { transform: 'scale(-1, -1)' }
    return {}
  }, [settings.mirror, settings.mirrorAxis])

  const stageStyle = {
    '--font-size': `${fontSize}px`,
    '--line-height': lineHeight,
    '--side-margin': `${sideMargins}%`,
    '--font': FONT_STACK[fontFamily] || FONT_STACK.sans,
  }

  const linesStyle = {
    '--bottom-space': `${Math.max(12, (1 - eyelineFraction) * 100)}vh`,
  }

  return (
    <div
      ref={stageRef}
      className="prompter-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={stageStyle}
    >
      <div className="prompter-mirror" style={mirrorStyle}>
        <div className="prompter-lines" ref={linesRef} style={linesStyle}>
          {doc.lines.map((line, lineIndex) => {
            return (
              <div
                key={line.type === LINE_TEXT ? line.id : `line-${lineIndex}`}
                data-line={line.type === LINE_TEXT ? line.id : undefined}
                data-start-index={line.type === LINE_TEXT ? line.startIndex : undefined}
                className={`pline pline-${line.type}`}
                onClick={line.type === LINE_TEXT ? onLineClick : undefined}
              >
                {line.type === LINE_TEXT ? (
                  line.parts.map((part, partIndex) =>
                    part.kind === 'cue' ? (
                      settings.showCues ? (
                        <span key={`cue-${partIndex}`} className="pcue-inline">
                          [{part.text}]
                        </span>
                      ) : null
                    ) : (
                      renderTextPart(part, word, activeSentenceId, highlightEnabled, matching, `part-${partIndex}`)
                    ),
                  )
                ) : line.type === LINE_HEADING ? (
                  <span className="pheading-text">{line.text}</span>
                ) : line.type === LINE_CUE && settings.showCues ? (
                  line.cues.map((cue, cueIndex) => (
                    <span key={cueIndex} className="pcue-text">
                      {cueIndex > 0 ? ' ' : ''}[{cue}]
                    </span>
                  ))
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
      <EyelineIndicator kind={settings.eyeline} fraction={eyelineFraction} running={running} />
    </div>
  )
}

function renderTextPart(part, currentWord, activeSentenceId, highlightEnabled, matching, keyPrefix) {
  const nodes = []
  let cursor = 0

  for (const word of part.words) {
    if (word.start > cursor) nodes.push(<span key={`${keyPrefix}-text-${cursor}`}>{part.text.slice(cursor, word.start)}</span>)

    const classes = [
      'pword',
      highlightEnabled && word.index < currentWord ? 'pword-read' : '',
      highlightEnabled && matching === 'word' && word.index === currentWord ? 'pword-current' : '',
      highlightEnabled && matching === 'line' && word.sentenceId === activeSentenceId ? 'pword-sentence-current' : '',
    ]
      .filter(Boolean)
      .join(' ')

    nodes.push(
      <span key={word.index} data-wid={word.index} data-sentence={word.sentenceId} className={classes}>
        {part.text.slice(word.start, word.end)}
      </span>,
    )
    cursor = word.end
  }

  if (cursor < part.text.length) nodes.push(<span key={`${keyPrefix}-text-${cursor}`}>{part.text.slice(cursor)}</span>)
  return nodes
}

function parseManual(holder) {
  const transform = holder?.style.transform || ''
  const match = /translateY\((-?[\d.]+)px\)/.exec(transform)
  return match ? parseFloat(match[1]) : 0
}

function EyelineIndicator({ kind, fraction, running }) {
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
    return (
      <div className={`eyeline eyeline-line${running ? ' eyeline-live' : ''}`} style={{ top }}>
        <span className="eyeline-cap eyeline-cap-left" />
        <span className="eyeline-cap eyeline-cap-right" />
      </div>
    )
  }
  if (kind === 'band') return <div className="eyeline eyeline-band" style={{ top }} />
  return null
}
