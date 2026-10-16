// Sigma normalizes both axes by the longest side of the graph bounds.
// Fit that same shared rectangle inside the viewport area left by the UI.
export function calcolaCameraCompleta({ bounds, width, height, padding = 0, margins, fitAxis = "both", contentBounds = bounds }) {
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
  const contentWidth = contentBounds.x[1] - contentBounds.x[0]
  const contentHeight = contentBounds.y[1] - contentBounds.y[0]
  const pixelsPerUnit = fitAxis === "height"
    ? usableHeight / contentHeight
    : Math.min(usableWidth / contentWidth, usableHeight / contentHeight)
  const normalizedScale = pixelsPerUnit * dimension
  // Content can lie outside Sigma's shared bounds. Keep its normalization
  // and correction ratio, and centre only the requested view's contents.
  const offsetX = contentBounds === bounds ? 0 : ((contentBounds.x[0] + contentBounds.x[1]) / 2 - (bounds.x[0] + bounds.x[1]) / 2) / dimension
  const offsetY = contentBounds === bounds ? 0 : ((contentBounds.y[0] + contentBounds.y[1]) / 2 - (bounds.y[0] + bounds.y[1]) / 2) / dimension
  return {
    x: 0.5 + offsetX - (margins.left - margins.right) / (2 * normalizedScale),
    y: 0.5 + offsetY + (margins.top - margins.bottom) / (2 * normalizedScale),
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
