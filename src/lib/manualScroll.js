export const MANUAL_SCROLL_RESUME_DELAY_MS = 280

export function createManualScrollBias(releasedOffset, automaticOffset, anchorPosition, releasedAt) {
  const value = releasedOffset - automaticOffset
  if (!Number.isFinite(value) || Math.abs(value) < 0.2) return null

  return {
    value,
    anchorPosition,
    releasedAt,
    releasing: false,
  }
}

export function updateManualScrollBias(
  bias,
  { running, continuous, position, now, dt, delayMs = MANUAL_SCROLL_RESUME_DELAY_MS, decayRate = 4 },
) {
  if (!bias) return null
  if (!running) return bias

  const shouldRelease = continuous
    ? now - bias.releasedAt >= delayMs
    : position > bias.anchorPosition
  if (!bias.releasing && !shouldRelease) return bias

  const value = bias.value * Math.exp(-decayRate * Math.max(0, dt))
  if (Math.abs(value) < 0.2) return null
  return { ...bias, value, releasing: true }
}
