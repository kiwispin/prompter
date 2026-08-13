export function mirrorTransform(enabled, axis) {
  if (!enabled) return 'none'
  if (axis === 'v') return 'scaleY(-1)'
  if (axis === 'both') return 'scale(-1, -1)'
  return 'scaleX(-1)'
}
