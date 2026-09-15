import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { calcolaCameraCompleta, calcolaRatioDettaglio } from '../src/camera-fit.js'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createNormalizationFunction: normalize, getCorrectionRatio: correction } = require('../node_modules/sigma/dist/normalization-aed467cc.cjs.prod.js')

// Esegue il codice reale: zoom out anticipa i contenuti; bbox e limiti
// restano condivisi e la camera non si muove dopo la panoramica.
const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const bboxStart = source.indexOf('    function parametriInquadratura()')
const bboxEnd = source.indexOf('    impostaBBoxCondiviso()', bboxStart + 1)
const transitionStart = source.indexOf('    function animaTransizione(')
const transitionEnd = source.indexOf('    setAnimaTransizioneFn', transitionStart)
const gridStart = source.indexOf('      {\n        const a0g')
const gridEnd = source.indexOf('\n\n      ctx.save()', gridStart)
assert.ok(bboxStart > 0 && bboxEnd > bboxStart && transitionEnd > transitionStart && gridEnd > gridStart)
let cases = 0
for (const [width, height] of [[1440, 900], [390, 844]]) {
  for (const reverse of [false, true]) {
    for (const timeline of [false, true]) {
      for (const ratio of [0.03, 0.6, 1.2]) {
        for (const empty of [false, true]) {
          const camera = { x: 0.32, y: 0.71, ratio, angle: 0 }
          const product = { x: 10, y: -100, orbitaX: 10, orbitaY: -100, aziendaOrbitaX: 70, aziendaOrbitaY: -300, timelineX: 50, timelineY: -100, aziendaTimelineY: -300 }
          let pending = [], bbox, locked = false, dots = [], alphaStack = [], now = 1
          const viewport = { width, height }
          const context = {
            calcolaCameraCompleta, calcolaRatioDettaglio, raggioMassimoOrbitaCondivisa: 220, topBarRef: { current: null },
            bboxXMin: -1000, bboxXMax: 1000, limitiMappa: { yMin: -9000, yMax: 500 },
            cameraAnimId: null, interrompiZoomVista: null, clamping: false, cancelAnimationFrame() {},
            X_MIN: -1000, X_MAX: 1000, MARGINE_X: 0, Y_MIN: 0, Y_MAX: 0, MARGINE_Y: 10,
            contenutoYMinDesigner: -1200, contenutoYMaxDesigner: 100,
            contenutoYMinAziende: -9000, contenutoYMaxAziende: 500,
            bboxYMin: 0, bboxYMax: 0, ppuCache: {}, fattoreCropCumulativo: 1,
            MIN_CAMERA_RATIO_UNITA_VISIBILI: 10, MIN_CAMERA_RATIO: 0, MAX_CAMERA_RATIO: 0,
            correctionRatioSigma: (w, h, gw, gh) => correction({ width: w, height: h }, { width: gw, height: gh }),
            container: { getBoundingClientRect: () => viewport },
            renderer: {
              getStagePadding: () => 30,
              setCustomBBox(value) { assert.equal(locked, false, 'BBox changed during toggle'); bbox = value },
              setSetting() { assert.equal(locked, false, 'Zoom limits changed during toggle') },
              graphToViewport(point) {
                const n = normalize(bbox)(point)
                const scale = (Math.min(width, height) - 60) * correction(viewport, { width: 2000, height: bbox.y[1] - bbox.y[0] }) / camera.ratio
                return { x: width / 2 + (n.x - camera.x) * scale, y: height / 2 - (n.y - camera.y) * scale }
              },
              viewportToGraph(point) {
                const scale = (Math.min(width, height) - 60) * correction(viewport, { width: 2000, height: bbox.y[1] - bbox.y[0] }) / camera.ratio
                return normalize(bbox).inverse({ x: camera.x + (point.x - width / 2) / scale, y: camera.y - (point.y - height / 2) / scale })
              },
            },
            camera: { getState: () => ({ ...camera }), setState: value => Object.assign(camera, value) },
            graph: { getNodeAttributes: () => product, setNodeAttribute: (_, key, value) => { product[key] = value } },
            transizioneAttiva: false, modelloVista: reverse ? 'aziende' : 'designer', timelineVista: timeline,
            vistaInterna: '', annoBloccato: null, designerAlphaAnimata: 1, aziendaAlphaAnimata: 0,
            crossfadeVistaInizio: 0, crossfadeVistaDaDesigner: 0, crossfadeVistaDaAzienda: 0,
            crossfadeEtichetteInizio: 0, crossfadeEtichetteDa: 0, etichetteAzAlphaAnimata: 0,
            CROSSFADE_ETICHETTE_RITARDO_MS: 1850,
            performance: { now: () => now }, requestAnimationFrame: cb => pending.push(cb),
            raccogliProdotti: () => empty ? [] : ['p'], richiediDisegnoOverlay() {},
            STILE: { transizione_stagger: 1, transizione_durata: 500, griglia_pallino_colore: '#d8d8d8' },
            lerp: (a, b, t) => a + (b - a) * t,
            w: width, h: height, isMobile: width < 768, t: 0.4,
            ANNO_MIN: -1000, ANNO_MAX: 1000, annoToX: v => v, UNITA_GRIGLIA_CONDIVISA: 10, grigliaRaggio: 2,
            ctx: {
              globalAlpha: 1, save() { alphaStack.push(this.globalAlpha) }, restore() { this.globalAlpha = alphaStack.pop() },
              beginPath() {}, fill() {}, arc(x, y, r) { dots.push([x, y, r, this.globalAlpha]) },
            },
          }
          const sandbox = vm.createContext(context)
          vm.runInContext(source.slice(bboxStart, bboxEnd), sandbox)
          vm.runInContext('impostaBBoxCondiviso()', sandbox)
          locked = true
          function drawGrid() {
            dots = []
            vm.runInContext(source.slice(gridStart, gridEnd), sandbox)
            return dots
          }
          let finalGrid, finalCamera
          const initialPosition = [product.x, product.y]
          const initialBBox = JSON.stringify(bbox)
          const target = reverse ? 'designer' : 'aziende'
          vm.runInContext(source.slice(transitionStart, transitionEnd), sandbox)
          vm.runInContext(`animaTransizione("${target}", ${timeline})`, sandbox)
          for (now = 1; now <= 1601; now += 20) {
            const callbacks = pending
            pending = []
            callbacks.forEach(cb => cb(now))
            if (now < 680) {
              assert.deepEqual([product.x, product.y], initialPosition, 'Contents started too early')
              assert.notEqual(context.modelloVista, target)
            }
            if (now === 801) assert.equal(context.modelloVista, target, 'Contents must overlap zoom out')
            if (now >= 961) {
              if (!finalGrid) { finalGrid = drawGrid(); finalCamera = { ...camera } }
              assert.deepEqual(drawGrid(), finalGrid, 'Grid moved after overview')
              assert.deepEqual(camera, finalCamera, 'Camera moved after overview')
            }
            assert.equal(JSON.stringify(bbox), initialBBox)
          }
          const fit = vm.runInContext('cameraCompleta()', sandbox)
          for (const key of ['x', 'y', 'ratio']) assert.ok(Math.abs(camera[key] - fit[key]) < 1e-10)
          assert.equal(camera.ratio, context.MAX_CAMERA_RATIO)
          for (const x of bbox.x) for (const y of bbox.y) {
            const point = context.renderer.graphToViewport({ x, y })
            assert.ok(point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height, 'Whole map must fit')
          }
          assert.equal(context.transizioneAttiva, false)
          assert.equal(context.modelloVista, target)
          if (!empty) {
            assert.equal(product.x, timeline ? product.timelineX : reverse ? product.orbitaX : product.aziendaOrbitaX)
            assert.equal(product.y, timeline ? reverse ? product.timelineY : product.aziendaTimelineY : reverse ? product.orbitaY : product.aziendaOrbitaY)
          }
          cases++
        }
      }
    }
  }
}
console.log(`${cases} casi OK: zoom out, anticipo contenuti, fit completo, griglia stabile dopo lo zoom; prodotti a destinazione. Desktop/mobile, entrambe le direzioni, orbite/timeline, tre zoom e catalogo vuoto.`)

// Verifica del fit con mappe larghe/alte/quadrate e finestre ruotate.
for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
  for (const [gw, gh] of [[12000, 2000], [2000, 12000], [5000, 5000]]) {
    const bounds = { x: [-100, gw - 100], y: [-gh, 0] }
    const margins = { left: 34, right: 64, top: 150, bottom: 40 }
    const fit = calcolaCameraCompleta({ bounds, width, height, margins, padding: 30 })
    const scale = (Math.min(width, height) - 60) * correction({ width, height }, { width: gw, height: gh }) / fit.ratio
    const xs = [], ys = []
    for (const x of bounds.x) for (const y of bounds.y) {
      const point = normalize(bounds)({ x, y })
      xs.push(width / 2 + (point.x - fit.x) * scale)
      ys.push(height / 2 - (point.y - fit.y) * scale)
    }
    assert.ok(Math.min(...xs) >= margins.left - 1e-8 && Math.max(...xs) <= width - margins.right + 1e-8)
    assert.ok(Math.min(...ys) >= margins.top - 1e-8 && Math.max(...ys) <= height - margins.bottom + 1e-8)
    const slackX = width - margins.left - margins.right - (Math.max(...xs) - Math.min(...xs))
    const slackY = height - margins.top - margins.bottom - (Math.max(...ys) - Math.min(...ys))
    assert.ok(Math.min(Math.abs(slackX), Math.abs(slackY)) < 1e-8, 'Fit must use all available width or height')
  }
}
console.log('9 fit OK: contenuto completo entro i margini UI, senza riduzione arbitraria.')
