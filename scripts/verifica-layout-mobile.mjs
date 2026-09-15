import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import Graph from 'graphology'
const source = readFileSync('src/App.jsx', 'utf8').replace(/\r\n/g, '\n')
const data = name => JSON.parse(readFileSync(`src/data/${name}.json`, 'utf8'))
export function run(width, height, transform = source => source) {
  let prefix = source.slice(0, source.indexOf('function preloadImages')).replace(/^import .*\n/gm, '')
  let layout = source.slice(source.indexOf('    const prodottiPerDesigner = {}'), source.indexOf('    // Se la vista ripristinata'))
  layout = transform(layout)
  const graph = new Graph()
  const sandbox = { window: { innerWidth: width, innerHeight: height }, container: { getBoundingClientRect: () => ({width, height}) }, isMobile: width < 768, graph, animated: {}, designers: data('designers'), prodotti: data('prodotti'), relazioni: data('relazioni'), aziendeData: data('aziende'), immaginiEsistentiArr: data('immagini_esistenti'), coloriImmaginiPrecalcolati: data('colori_immagini') }
  const result = vm.runInNewContext(prefix + layout.replaceAll('import.meta.env.BASE_URL', '"/"') + '\n;({ passoAzFinale, spanX: X_MAX-X_MIN, designers: posizioniCalcolate.map(p=>[p.d.nome,p.x,p.y]), companies: Object.entries(aziendePosizioniMap).map(([k,p])=>[k,p.x,p.y]) })',sandbox)
  result.nodes = graph.mapNodes((id,a)=>[id,...['x','y','orbitaX','orbitaY','timelineX','timelineY','aziendaOrbitaX','aziendaOrbitaY','aziendaTimelineY'].map(k=>a[k])])
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
for (const [width, height] of [[390, 844], [844, 390], [768, 1024], [1920, 1080], [640, 800]]) {
  const layout = run(width, height)
  assert.deepEqual(layout, desktop, `Geometria diversa a ${width}x${height}`)
}
console.log(`Layout identico in 6 viewport: ${desktop.nodes.length} nodi, ${desktop.companies.length} aziende, tutte le coordinate di orbite/timeline e passo condiviso.`)
