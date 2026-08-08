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

export default function PrompterView({ doc, word, positionRef, totalWords, mode, settings }) {
  const stageRef = useRef(null)
  const linesRef = useRef(null)
  const [activeLine, setActiveLine] = useState(-1)

  const { fontSize, lineHeight, sideMargins, fontFamily, matching } = settings

  const activeLineId = useMemo(() => {
    if (word < 0) return -1
    const lineId = doc.wordLine.get(word)
    return lineId == null ? -1 : lineId
  }, [doc, word])

  useEffect(() => setActiveLine(activeLineId), [activeLineId])

  const highlightEnabled = mode === 'constant' ? false : matching !== 'none'

  // Scroll loop. Pins the line you're reading at the eyeline (reading
  // position), interpolating between the current and next word rows so the
  // text glides smoothly past it like a hardware prompter. Microphone mode
  // eases between recognition bursts; demo/constant track exactly.
  useEffect(() => {
    let raf
    let current = 0
    const ease = 0.25

    const step = () => {
      const stage = stageRef.current
      const holder = linesRef.current
      if (stage && holder) {
        const frac = EYELINE_FRACTION[settings.readingPos] ?? 0.5
        const eyeline = stage.clientHeight * frac
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

        const maxScroll = holder.scrollHeight - stage.clientHeight
        target = Math.max(-maxScroll, Math.min(target, stage.clientHeight))

        if (mode === 'voice' && settings.source === 'mic') {
          current += (target - current) * ease
          if (Math.abs(target - current) < 0.5) current = target
        } else {
          current = target
        }
        current = Math.max(-maxScroll, Math.min(current, stage.clientHeight))
        holder.style.transform = `translateY(${current}px)`
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [settings.readingPos, settings.source, doc, mode, positionRef, totalWords])

  // Force a re-measure pass when display settings change.
  useLayoutEffect(() => {
    setActiveLine(activeLineId)
  }, [fontSize, lineHeight, sideMargins, fontFamily, activeLineId])

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
