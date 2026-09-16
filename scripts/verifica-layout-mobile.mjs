import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import Graph from 'graphology'
import { proporzionaAziende } from '../src/company-layout.js'
import { classificaProdotto, confrontaProdottiClassificati } from '../src/product-taxonomy.js'
const source = readFileSync('src/App.jsx', 'utf8').replace(/\r\n/g, '\n')
const data = name => JSON.parse(readFileSync(`src/data/${name}.json`, 'utf8'))
export function run(width, height, transform = source => source) {
  let prefix = source.slice(0, source.indexOf('function preloadImages')).replace(/^import .*\n/gm, '')
  let layout = source.slice(source.indexOf('    const prodottiPerDesigner = {}'), source.indexOf('    // Se la vista ripristinata'))
  layout = transform(layout)
  const graph = new Graph()
  const sandbox = { proporzionaAziende, classificaProdotto, confrontaProdottiClassificati, window: { innerWidth: width, innerHeight: height }, container: { getBoundingClientRect: () => ({width, height}) }, isMobile: width < 768, graph, animated: {}, designers: data('designers'), prodotti: data('prodotti'), relazioni: data('relazioni'), aziendeData: data('aziende'), immaginiEsistentiArr: data('immagini_esistenti'), coloriImmaginiPrecalcolati: data('colori_immagini') }
  const result = vm.runInNewContext(prefix + layout.replaceAll('import.meta.env.BASE_URL', '"/"') + '\n;({ passoAzFinale, passoAziendeFinale, spanX: X_MAX-X_MIN, designers: posizioniCalcolate.map(p=>[p.d.nome,p.x,p.y]), companies: Object.entries(aziendePosizioniMap).map(([k,p])=>[k,p.x,p.y,p.raggio*(AZIENDE_PRINCIPALI.has(k)?MOLTIPLICATORE_ORBITA_PRINCIPALE_AZ:1)]), designerLabels: etichetteCorrentiDesigner.map(e=>[e.numero,e.y]), companyLabels: etichetteMacroAz.map(e=>[e.numeroCategoria,e.y]) })',sandbox)
  result.nodes = graph.mapNodes((id,a)=>[id,...['x','y','orbitaX','orbitaY','timelineX','timelineY','aziendaOrbitaX','aziendaOrbitaY','aziendaTimelineY','prodottiX','prodottiY'].map(k=>a[k])])
  result.maxOrbitRadius = 0
  graph.forEachNode((_, a) => {
    for (const [x, y, cx, cy] of [[a.orbitaX, a.orbitaY, a.ancoraDesignerX, a.ancoraDesignerY], [a.aziendaOrbitaX, a.aziendaOrbitaY, a.ancoraAziendaX, a.ancoraAziendaY]]) {
      if ([x, y, cx, cy].every(Number.isFinite)) result.maxOrbitRadius = Math.max(result.maxOrbitRadius, Math.hypot(x - cx, y - cy))
    }
  })
  return JSON.parse(JSON.stringify(result))
}
// Esegue il layout reale sui JSON del progetto, incluse tutte le destinazioni
// dei prodotti: cambiare dimensioni della finestra non deve cambiare coordinate.
const desktop = run(1440, 800)
for (const [width, height] of [[844, 390], [768, 1024], [1920, 1080]]) {
  const layout = run(width, height)
  assert.deepEqual(layout, desktop, `Geometria desktop diversa a ${width}x${height}`)
}
const mobile = run(390, 844)
assert.deepEqual(run(640, 800), mobile, 'Geometria mobile diversa fra viewport')
assert.ok(mobile.spanX < desktop.spanX, 'L asse cronologico mobile deve essere piu compatto')
console.log(`Layout stabile per classe viewport: ${desktop.nodes.length} nodi, ${desktop.companies.length} aziende; asse cronologico mobile piu compatto.`)
const height = rows => Math.max(...rows.map(p => p[2])) - Math.min(...rows.map(p => p[2]))
const relativeHeight = height(desktop.companies) / height(desktop.designers)
assert.ok(relativeHeight >= 0.85 && relativeHeight <= 1, 'Companies should be slightly shorter than designers, allowing grid rounding')
const mobileRelativeHeight = height(mobile.companies) / height(mobile.designers)
assert.ok(mobileRelativeHeight >= 0.85 && mobileRelativeHeight <= 1.2, 'Mobile company height outside the intended grid range')
for (const layout of [desktop, mobile]) {
  const y00 = layout.companyLabels.find(([n]) => n === 0)[1]
  const y01Aziende = layout.companyLabels.find(([n]) => n === 1)[1]
  const y01Designer = layout.designerLabels.find(([n]) => n === 1)[1]
  assert.ok(Math.abs(y01Designer - y00) < 1e-8, 'Designer 01 must share the row of company 00')
  assert.ok(Math.abs((y00 - y01Aziende) - layout.passoAziendeFinale * 4) < 1e-8, 'Company 01 must sit four rows below 00')
  for (let i = 0; i < layout.companies.length; i++) for (let j = i + 1; j < layout.companies.length; j++) {
    const [nomeA, xA, yA, rA] = layout.companies[i]
    const [nomeB, xB, yB, rB] = layout.companies[j]
    assert.ok(Math.hypot(xA - xB, yA - yB) >= rA + rB, `Orbite aziende sovrapposte: ${nomeA} / ${nomeB}`)
  }
}
const unit = desktop.passoAzFinale / 3
for (const [, , y] of desktop.companies) assert.ok(Math.abs(y / unit - Math.round(y / unit)) < 1e-8, 'Company off shared grid')
assert.equal(new Set(desktop.companies.map(([, x, y]) => `${x}|${y}`)).size, desktop.companies.length, 'Company centers overlap after grid snap')
const prodottiGriglia = desktop.nodes.filter(([, , , , , , , , , , x, y]) => Number.isFinite(x) && Number.isFinite(y))
assert.equal(prodottiGriglia.length, data('prodotti').length, 'Ogni prodotto deve avere una posizione nella nuova griglia')
assert.equal(new Set(prodottiGriglia.map(([, , , , , , , , , , x, y]) => `${x}|${y}`)).size, prodottiGriglia.length, 'I prodotti non devono sovrapporsi nella griglia')
console.log(`Altezza aziende: desktop ${(relativeHeight * 100).toFixed(1)}%, mobile ${(mobileRelativeHeight * 100).toFixed(1)}% dei designer; centri sulla griglia.`)
