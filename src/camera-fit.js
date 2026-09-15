// Sigma normalizes both axes by the longest side of the graph bounds.
// Fit that same shared rectangle inside the viewport area left by the UI.
export function calcolaCameraCompleta({ bounds, width, height, padding = 0, margins }) {
  const graphWidth = bounds.x[1] - bounds.x[0]
  const graphHeight = bounds.y[1] - bounds.y[0]
  const dimension = Math.max(graphWidth, graphHeight)
  const viewportRatio = height / width
  const graphRatio = graphHeight / graphWidth
  const correction = (viewportRatio < 1 && graphRatio > 1) || (viewportRatio > 1 && graphRatio < 1)
    ? 1
    : Math.min(Math.max(graphRatio, 1 / graphRatio), Math.max(viewportRatio, 1 / viewportRatio))
  const usableWidth = Math.max(1, width - margins.left - margins.right)
  const usableHeight = Math.max(1, height - margins.top - margins.bottom)
  const pixelsPerUnit = Math.min(usableWidth / graphWidth, usableHeight / graphHeight)
  const normalizedScale = pixelsPerUnit * dimension
  return {
    x: 0.5 - (margins.left - margins.right) / (2 * normalizedScale),
    y: 0.5 + (margins.top - margins.bottom) / (2 * normalizedScale),
    ratio: Math.max(1, Math.min(width, height) - 2 * padding) * correction / normalizedScale,
    angle: 0,
  }
}

// Maximum zoom fits a centered galaxy in 80% of the usable short side.
export function calcolaRatioDettaglio(options, maxRadius) {
  const { bounds, width, height, margins } = options
  const availableWidth = Math.max(1, width - margins.left - margins.right)
  const availableHeight = Math.max(1, height - margins.top - margins.bottom)
  const fitScale = Math.min(availableWidth / (bounds.x[1] - bounds.x[0]), availableHeight / (bounds.y[1] - bounds.y[0]))
  const detailScale = Math.max(fitScale * 1.01, 0.4 * Math.min(availableWidth, availableHeight) / Math.max(1, maxRadius))
  return calcolaCameraCompleta(options).ratio * fitScale / detailScale
}
