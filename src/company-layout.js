// Keep companies slightly shorter than designers, regardless of their width.
// Rebuild with an integer number of shared grid units per company row.
export function proporzionaAziende({ build, designers, unit, initialStep, targetRatio = 0.95, maxRatio = 1, centerOnReference = false }) {
  const extent = rows => {
    if (!rows.length) return { x: 0, y: 0 }
    return {
      x: Math.max(...rows.map(p => p.x)) - Math.min(...rows.map(p => p.x)),
      y: Math.max(...rows.map(p => p.y)) - Math.min(...rows.map(p => p.y)),
    }
  }
  const reference = extent(designers)
  let layout = build(initialStep)
  let step = initialStep
  const initial = extent(Object.values(layout.mappa))
  if (!(reference.x > 0 && reference.y > 0 && initial.x > 0 && initial.y > 0 && unit > 0)) return { ...layout, step }
  const targetHeight = reference.y * targetRatio
  const maxUnits = Math.ceil(initialStep * targetHeight / initial.y / unit) * 2 + 3
  let bestError = Infinity
  for (let count = 1; count <= maxUnits; count++) {
    const candidate = build(count * unit)
    // Co-license partners also land on the same base grid.
    Object.values(candidate.mappa).forEach(p => { p.y = Math.round(p.y / unit) * unit })
    const height = extent(Object.values(candidate.mappa)).y
    if (height > reference.y * maxRatio) continue
    const error = Math.abs(height - targetHeight)
    if (error < bestError) {
      bestError = error
      layout = candidate
      step = count * unit
    }
  }
  if (centerOnReference) {
    const companyRows = Object.values(layout.mappa)
    const referenceCenter = (Math.min(...designers.map(p => p.y)) + Math.max(...designers.map(p => p.y))) / 2
    const companyCenter = (Math.min(...companyRows.map(p => p.y)) + Math.max(...companyRows.map(p => p.y))) / 2
    const shift = Math.round((referenceCenter - companyCenter) / unit) * unit
    companyRows.forEach(p => { p.y += shift })
    ;[...layout.etichetteMacro, ...layout.etichetteSotto].forEach(et => {
      if (Number.isFinite(et.y)) et.y += shift
      if (Number.isFinite(et.yBottom)) et.yBottom += shift
    })
  }
  return { ...layout, step }
}
