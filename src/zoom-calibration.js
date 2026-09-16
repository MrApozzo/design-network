// Punti manuali: moltiplicatori rispetto alla scala visiva di base.
// Gli estremi sono provvisori; 50%: il primo punto da valutare.
export const PUNTI_ZOOM = [
  { zoom: 0, orbit: 1, center: 1, product: 1, label: 1, categoryLabel: 1, designerLabel: 1, productLabelAlpha: 0, categoryLine: 1, gridDot: 1, edgeWidth: 1, topLabel: 1 },
  { zoom: 0.3, orbit: 2.35, center: 1.9, product: 1.45, label: 1.7, categoryLabel: 0.85, designerLabel: 2.8, productLabelAlpha: 0, categoryLine: 1, gridDot: 1, edgeWidth: 1, topLabel: 1.12 },
  { zoom: 0.5, orbit: 2.9296875, center: 1.65, product: 1.5, label: 1.5, categoryLabel: 0.8, designerLabel: 2.9296875, productLabelAlpha: 0, categoryLine: 1, gridDot: 1, edgeWidth: 1, topLabel: 1 },
  { zoom: 1, orbit: 1, center: 1, product: 1, label: 1, categoryLabel: 1, designerLabel: 1, productLabelAlpha: 1, categoryLine: 1, gridDot: 1, edgeWidth: 1, topLabel: 1 },
]

// Mobile: a 0% categorie -10% e nomi -22%; nomi al 55% al punto 50%; al 100% orbite +72.8%, centri -27.75%, nomi +44%.
export const PUNTI_ZOOM_MOBILE = PUNTI_ZOOM.map(p => ({ ...p, ...(p.zoom === 0 ? { categoryLabel: 0.6, designerLabel: 0.78, center: 0.8, gridDot: 1.1, edgeWidth: 0.4, topLabel: 0.9, categoryLine: 0.45 } : {}), ...(p.zoom === 0.5 ? { designerLabel: p.designerLabel * 0.55, categoryLabel: p.categoryLabel * 0.6, categoryLine: 0.6 } : {}), ...(p.zoom === 1 ? { orbit: 1.728, center: 0.7225, designerLabel: 1.44, gridDot: 0.8 } : {}) }))

// Interpolazione cubica comune: continua anche nella derivata ai punti manuali.
export function fattoriTaraturaZoom(zoom, attiva = true, mobile = false) {
  if (!attiva) return { orbit: 1, center: 1, product: 1, label: 1, categoryLabel: 1, designerLabel: 1, productLabelAlpha: 1, categoryLine: 1, gridDot: 1, edgeWidth: 1, topLabel: 1 }
  const t = Math.max(0, Math.min(1, zoom))
  const punti = mobile ? PUNTI_ZOOM_MOBILE : PUNTI_ZOOM
  const i = punti.findIndex((p, i) => i > 0 && t <= p.zoom)
  const a = punti[Math.max(1, i) - 1], b = punti[Math.max(1, i)]
  const u = (t - a.zoom) / (b.zoom - a.zoom)
  const f = u * u * (3 - 2 * u)
  return Object.fromEntries(["orbit", "center", "product", "label", "designerLabel", "categoryLabel", "productLabelAlpha", "categoryLine", "gridDot", "edgeWidth", "topLabel"].map(k => [k, a[k] + (b[k] - a[k]) * f]))
}
