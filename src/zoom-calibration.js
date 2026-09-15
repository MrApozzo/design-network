// Punti manuali: moltiplicatori rispetto alla scala visiva di base.
// Gli estremi sono provvisori; 50%: il primo punto da valutare.
export const PUNTI_ZOOM = [
  { zoom: 0, orbit: 1, center: 1, product: 1, label: 1, categoryLabel: 1, designerLabel: 1, productLabelAlpha: 0 },
  { zoom: 0.5, orbit: 2.9296875, center: 1.65, product: 1.5, label: 1.5, categoryLabel: 0.8, designerLabel: 2.9296875, productLabelAlpha: 0 },
  { zoom: 1, orbit: 1, center: 1, product: 1, label: 1, categoryLabel: 1, designerLabel: 1, productLabelAlpha: 1 },
]

// Interpolazione cubica comune: continua anche nella derivata ai punti manuali.
export function fattoriTaraturaZoom(zoom, attiva = true) {
  if (!attiva) return { orbit: 1, center: 1, product: 1, label: 1, categoryLabel: 1, designerLabel: 1, productLabelAlpha: 1 }
  const t = Math.max(0, Math.min(1, zoom))
  const i = PUNTI_ZOOM.findIndex((p, i) => i > 0 && t <= p.zoom)
  const a = PUNTI_ZOOM[Math.max(1, i) - 1], b = PUNTI_ZOOM[Math.max(1, i)]
  const u = (t - a.zoom) / (b.zoom - a.zoom)
  const f = u * u * (3 - 2 * u)
  return Object.fromEntries(["orbit", "center", "product", "label", "designerLabel", "categoryLabel", "productLabelAlpha"].map(k => [k, a[k] + (b[k] - a[k]) * f]))
}
