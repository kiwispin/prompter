export function calculateMeasuredWpm(wordsRead, elapsed, startWord = 0, startElapsed = 0) {
  const measuredWords = Math.max(0, wordsRead - startWord)
  const measuredSeconds = Math.max(0, elapsed - startElapsed)
  if (measuredSeconds <= 1 || measuredWords <= 0) return 0
  return (measuredWords / measuredSeconds) * 60
}
