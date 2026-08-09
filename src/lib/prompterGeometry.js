export function readingRailGap(fontSize) {
  return Math.max(5, Number(fontSize || 0) * 0.1)
}

export function offsetForRail(eyeline, rowBottom, gap) {
  return eyeline - rowBottom - gap
}

export function railAnchorForRows(row, nextRow, gap, lineThickness = 2) {
  const preferred = row.inkBottom + gap
  if (!nextRow) return preferred

  const latestSafe = nextRow.inkTop - gap - lineThickness
  if (preferred <= latestSafe) return preferred

  // Very tight user-selected line heights can leave no padded gap. In that
  // case, split the actual rendered ink gap and rely on paint order to keep
  // the rail behind the glyphs rather than cutting across them.
  return (row.inkBottom + nextRow.inkTop - lineThickness) / 2
}
