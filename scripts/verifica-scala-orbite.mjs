import assert from 'node:assert/strict'
import { run } from './verifica-layout-mobile.mjs'
import { dimensioniGalassia } from '../src/orbit-scale.js'
import { calcolaCameraCompleta, calcolaRatioDettaglio } from '../src/camera-fit.js'

const layout = run(1440, 800)
const xs = [], ys = []
for (const n of layout.nodes) {
  for (const i of [1, 3, 5, 7]) if (Number.isFinite(n[i])) xs.push(n[i])
  for (const i of [2, 4, 6, 8, 9]) if (Number.isFinite(n[i])) ys.push(n[i])
}
for (const [, x, y] of layout.companies) { xs.push(x); ys.push(y) }
const bounds = { x: [Math.min(...xs) - 20, Math.max(...xs) + 20], y: [Math.min(...ys) - 20, Math.max(...ys) + 20] }
const gw = bounds.x[1] - bounds.x[0], gh = bounds.y[1] - bounds.y[0]
for (const [width, height] of [[1440, 800], [390, 844], [844, 390]]) {
  const viewportMin = Math.min(width, height)
  const margins = { left: 34, right: 64, top: 140, bottom: 40 }
  const fit = calcolaCameraCompleta({ bounds, width, height, padding: 30, margins })
  const physicalMin = Math.min((width - margins.left - margins.right) / gw, (height - margins.top - margins.bottom) / gh)
  const minRatio = calcolaRatioDettaglio({ bounds, width, height, padding: 30, margins }, layout.maxOrbitRadius)
  let previousProduct = 0, previousRelative = Infinity
  for (let i = 0; i <= 1000; i++) {
    const zoom = i / 1000
    const physicalScale = physicalMin * (fit.ratio / minRatio) ** zoom
    const sizes = dimensioniGalassia(physicalScale)
    const orbit = physicalScale * layout.maxOrbitRadius
    assert.ok(sizes.product >= previousProduct - 1e-12, 'Product glyph must not shrink on zoom-in')
    assert.ok(sizes.product / orbit <= previousRelative + 1e-12, 'Glyph must become relatively smaller than orbit')
    assert.ok(sizes.center > sizes.product, 'Center must remain prominent')
    assert.ok(2 * orbit <= 0.8 * Math.min(width - margins.left - margins.right, height - margins.top - margins.bottom) + 1e-8, 'Largest centered galaxy fits at maximum zoom')
    previousProduct = sizes.product
    previousRelative = sizes.product / orbit
    if ([0, 500, 1000].includes(i)) console.log(`${width}x${height} ${i/10}%: orbita ${orbit.toFixed(1)}px, prodotto ${sizes.product.toFixed(1)}px, centro ${sizes.center.toFixed(1)}px`)
  }
}
console.log('3003 campioni OK: scala geometrica, gerarchia, crescita sublineare dei prodotti, galassia completa al massimo zoom.')
