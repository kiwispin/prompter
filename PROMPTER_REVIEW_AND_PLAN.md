# Prompter Review and Implementation Plan

The main problem is not one bad scrolling value—it is that recognition, word highlighting, layout measurement, and visual scrolling are too tightly coupled. That combination explains both the jumping and the recent “not scrolling” behaviour.

## What Promptmatics gets right

From inspecting and measuring the [Promptmatics reference](https://promptmatics.vercel.app/):

- The reading eyeline is fixed. Its default is around 42% of the screen, adjustable in settings.
- It holds the current rendered row steady while the speaker moves through that row.
- Crossing into the next wrapped row triggers one controlled movement of the whole script.
- That movement settles gradually over roughly 1–1.5 seconds. It is not an abrupt per-frame correction.
- Pausing or going off-script leaves the text exactly where it is.
- Spoken words fade back, the current word becomes amber, and upcoming text stays bright.
- Highlighting does not change word dimensions, so it cannot alter wrapping.
- The demo reader appears to use the same row-following presentation model as voice mode.
- A sentence can be tapped to jump there immediately.
- The typography is intentionally restrained: approximately 44px, 1.55 line height, 10% margins, muted headings and cues.
- The top and bottom chrome are compact and supported by gradient veils, preserving readability without large panels obscuring the script.

The important distinction is: “smooth voice scrolling” does not mean continuous drifting. It means stable reading followed by smooth, predictable row-to-row transitions.

## Problems in the current app

### 1. Highlighting can physically reflow the script

The current-word style adds horizontal padding only to the active word. As the highlight moves, word widths change. Near the end of a row, that can push a word onto the next row, changing its `offsetTop`, which then changes the scroll target.

That feedback loop can make the page wobble or jump even when recognition is correct. Promptmatics uses colour emphasis without altering geometry.

### 2. The easing is much too aggressive and frame-rate dependent

Microphone scrolling currently applies 25% of the remaining distance on every animation frame. At 60fps, most movement finishes in a fraction of a second; at lower frame rates it behaves differently.

Promptmatics uses a noticeably longer, calmer settling motion. The app needs a time-based spring or exponential ease using elapsed time, with a maximum velocity and no overshoot.

### 3. “Line-by-line” tracking is functionally broken

A “line” currently means a source-text paragraph, not a wrapped visual row or sentence. The matching code also refuses to advance while recognition remains inside the current source line.

With a long paragraph, it can therefore appear completely frozen, then jump when speech reaches the next paragraph. This likely contributes directly to “it’s not scrolling at all.”

### 4. Demo mode does not demonstrate voice mode

The demo currently uses constant pixel movement. Microphone mode uses row anchoring.

That means the easiest testing path does not exercise the behaviour users actually depend on. Promptmatics’ demo simulates word progress but uses the same presentation mechanics as live voice tracking.

### 5. Recognition advances too eagerly

Every partial and final transcript is immediately offered to the matcher. The matcher:

- Requires exact contiguous words.
- Searches up to 40 words ahead.
- Breaks ties by choosing the furthest match.
- Has no provisional-versus-confirmed cursor.
- Has no partial-transcript stability requirement.
- Cannot recover intelligently from contractions, hyphenation, curly apostrophes, numbers, or minor recognition substitutions.

Repeated phrases can jump forward, while slightly different recognition can fail entirely. The recognition position should be separated from the visual position.

### 6. Script punctuation is discarded when rendering

The parser tracks and renders only matched word tokens. Commas, periods, quotation marks, em dashes and other punctuation between words are lost.

For a teleprompter, punctuation is part of delivery: it communicates pauses, emphasis, and cadence. The displayed script must preserve the original text exactly while separately attaching tracking metadata to words.

### 7. Layout is queried continuously

The scroll loop performs DOM queries every animation frame. Manual positioning can scan every word on the page. Large scripts will become increasingly prone to dropped frames.

Promptmatic-style behaviour is better served by measuring wrapped rows once, caching a word-to-row map, and rebuilding it only after resize, orientation, font, margin, or script changes.

### 8. Scroll state is not safely invalidated

Changing scripts, font size, line height, margins, mirror mode, or viewport dimensions can leave the previous pixel offset in place. The existing “re-measure” effect does not actually clear or rebuild the scroll geometry.

This can cause stale offsets, sudden jumps, or the script remaining outside the expected position.

### 9. Start-up can miss the opening words

The microphone reports “live” before Speechmatics is necessarily ready. Audio sent while the WebSocket is authenticating is discarded. Without a countdown—or with a slow connection—the speaker can start while recognition is not yet listening.

The correct sequence is: connect → recognition ready → countdown → start reading.

### 10. The HUD and highlight are visually heavy

The green current-word block is more distracting than Promptmatics’ amber text treatment, and the bottom HUD occupies a large area over upcoming content.

The current typography defaults are already close to the reference, but the live-reading presentation needs quieter chrome, gradient protection, stronger past/current/future hierarchy, and less obstruction.

## Implementation plan

1. **Create a deterministic rehearsal harness.**

   Feed recorded sequences of partial and final transcripts into the app without requiring a microphone. Cover pauses, repeated phrases, skipped words, off-script remarks, recovery, fast delivery and short lines.

2. **Rebuild the script token model.**

   Preserve punctuation and whitespace exactly. Track words independently from display text. Add sentence boundaries and Unicode-aware normalization.

3. **Separate the three cursors.**

   Maintain:

   - Provisional recognition position.
   - Confirmed script position.
   - Visual row position.

   Partial transcripts may update highlighting cautiously; only stable evidence should move the confirmed cursor and visual row.

4. **Replace matching with position-weighted local alignment.**

   Prefer matches nearest the current position, tolerate small omissions and common transcript variations, accept unique final single-word matches, and enter a broader recovery search only after genuine loss of position.

5. **Build a stable rendered-row map.**

   Measure word rectangles after layout and group them into visual rows. Cache `word → visual row → target offset`. Recalculate with `ResizeObserver` and whenever display settings or the script change.

6. **Replace the microphone scroll controller.**

   Hold the current visual row at the chosen eyeline. When the confirmed row changes, animate toward the next target with time-based smoothing, a velocity cap, and no overshoot. Pauses and off-script speech will leave the target unchanged.

7. **Make demo voice tracking use that same controller.**

   Demo mode will synthesize confirmed words at the selected WPM but otherwise go through the exact microphone presentation path. Constant mode will remain genuinely continuous.

8. **Fix the reading-position model.**

   Use an exact percentage setting rather than only Top/Center/Bottom presets. Retain a true 50% center for the requested behaviour while allowing the Promptmatics-style 42% upper-middle position when preferred.

9. **Make highlighting layout-neutral.**

   Remove active-word padding and background geometry. Use dim read text, amber current text and bright upcoming text, with colour transitions only.

10. **Improve prompter interaction and chrome.**

    Add tap-to-jump by sentence, slimmer live controls, gradient veils, a compact HUD, accurate rolling voice WPM, and clearer Ready/Listening/Holding states.

11. **Harden the voice session.**

    Gate the countdown on recognition readiness, buffer or prevent premature audio loss, handle connection closure properly, and reset matcher state after manual jumps.

12. **Verify before publishing.**

    Test desktop and iPad-sized layouts, 30/60/120Hz rendering, long scripts, long paragraphs, orientation changes, all font settings, start/end positioning, microphone pauses, off-script recovery and manual repositioning. Acceptance will include a stable eyeline, zero highlight-induced reflow, and consistent row transitions independent of frame rate.

## Scope note

Rate limiting will be left alone. Unrelated Promptmatics features such as Smart Rewrite should wait until the core prompter experience is dependable.
