import { useEffect } from 'react'

// iPad Safari does not shrink the page when the on-screen keyboard opens: it
// only shrinks (and sometimes pans) the *visual* viewport, so full-height
// panels end up with their lower half hidden behind the keyboard. This hook
// mirrors the visible area into CSS variables (--vv-top, --vv-height) so
// overlays can size themselves to what the user can actually see, and flags
// <html class="keyboard-open"> while a keyboard is taking up space.
const KEYBOARD_THRESHOLD_PX = 120

export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return undefined
    const root = document.documentElement
    let frame = 0
    let wasOpen = false

    const apply = () => {
      frame = 0
      const height = Math.round(vv.height)
      const top = Math.max(0, Math.round(vv.offsetTop))
      const open = window.innerHeight - height > KEYBOARD_THRESHOLD_PX
      root.style.setProperty('--vv-height', `${height}px`)
      root.style.setProperty('--vv-top', `${top}px`)
      root.classList.toggle('keyboard-open', open)

      // When the keyboard appears the focused text box shrinks, and the caret
      // can be left below its new bottom edge. Re-setting the selection makes
      // the browser scroll the caret back into view inside the box.
      if (open && !wasOpen) {
        const el = document.activeElement
        if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && typeof el.setSelectionRange === 'function') {
          requestAnimationFrame(() => {
            try {
              el.setSelectionRange(el.selectionStart, el.selectionEnd, el.selectionDirection || 'none')
            } catch {
              // Some input types (e.g. number) do not support selection.
            }
          })
        }
      }
      wasOpen = open
    }

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply)
    }

    apply()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      root.style.removeProperty('--vv-height')
      root.style.removeProperty('--vv-top')
      root.classList.remove('keyboard-open')
    }
  }, [])
}
