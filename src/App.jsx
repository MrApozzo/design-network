import { useEffect, useState } from "react"
import Graph from "graphology"
import Sigma from "sigma"
import designers from "./data/designers.json"
import prodotti from "./data/prodotti.json"
import relazioni from "./data/relazioni.json"

const STILE = {
  // --- Colori ---
  designer_colore: "#090e54",
  prodotto_colore: "#cccccc",
  bordo_colore: "#222222",
  bordo_spessore: 0.2,
  griglia_pallino_colore: "#e0e0e0",
  griglia_label_colore: "#aaaaaa",
  edge_prodotto_colore: "#dddddd",
  edge_relazione_colore: "#888888",
  sfondo_colore: "#f5f5f0",

  // --- Label (stile) ---
  label_min: 5,
  label_offset: 12,
  label_designer_peso: "600",
  label_designer_colore: "#222222",
  label_date_peso: "300",
  label_date_colore: "#999999",
  label_prodotto_peso: "300",
  label_prodotto_colore: "#555555",
  label_prodotto_anno_colore: "#aaaaaa",

  // --- Dimensioni fisse ---
  l1_griglia_pallino_raggio: 1.2,
  l2_griglia_pallino_raggio: 5,
  edge_prodotto_size: 0.5,
  edge_relazione_size: 1,
  designer_size: 8,
  prodotto_size: 5,

  // =============================================
  //  ZOOM A 2 LIVELLI
  //  soglia = camera ratio sotto cui scatta il livello 2
  //  transizione graduale (lerp) tra i due livelli
  // =============================================
  zoom_soglia: 0.2,

  // Livello 1 (lontano, ratio >= zoom_soglia)
  l1_designer_px: 6,         // raggio pallino designer (px)
  l1_prodotto_px: 4,         // raggio pallino prodotto (px)
  l1_label_designer: 8,      // font size label designer (px)
  l1_label_prodotto: 0,      // font size label prodotto (0 = nascosto)

  // Livello 2 (vicino, ratio < zoom_soglia)
  l2_designer_px: 18,        // raggio pallino designer (px)
  l2_prodotto_px: 36,        // raggio pallino prodotto (px)
  l2_label_designer: 14,     // font size label designer (px)
  l2_label_prodotto: 10,     // font size label prodotto (px)

  // --- Transizione tra viste ---
  transizione_stagger: 4,    // ritardo tra un prodotto e l'altro (ms)
  transizione_durata: 1200,    // durata animazione per prodotto (ms)

  // --- Scala base (compensazione zoom automatica) ---
  scala_nodi_max: 2,
  scala_testo_max: 1.5,

  // --- Hover / interazione ---
  hover_scala: 2,
  hover_opacita_altri: 0.05,
  lerp_velocita: 0.15,

  // --- Layout force-directed Y ---
  peso_collettivo: 0.8,
  peso_coprogettazione: 0.9,
  peso_relazione_personale: 1.0,
  peso_relazione_professionale: 0.5,
  peso_scuola: 0.4,
  force_iterazioni: 200,
  force_repulsione: 4.0,
  force_attrazione: 0.1,
  min_distanza_y: 5.0,
  orbita_raggio_min: 0.3,
  orbita_spazio_per_prodotto: 0.08,
  anello_raggio_interno: 0.8,
  anello_raggio_esterno: 1.6,
  arco_inizio: 0.15,
  arco_fine: 1.85,
  arco_perturbazione: 0.6,
}

const ANNO_MIN = 1880
const ANNO_MAX = 2020
const X_MIN = -60
const X_MAX = 60
const DECENNI = [1880,1890,1900,1910,1920,1930,1940,1950,1960,1970,1980,1990,2000,2010,2020]
const ANNI_SINGOLI = Array.from({length: (2020-1880)+1}, (_, i) => 1880 + i)
const MARGINE_X = 2
const MARGINE_Y = 2
const Y_MIN = -20
const Y_MAX = 20
const MAX_CAMERA_RATIO = 1.2
const MIN_CAMERA_RATIO = 0.05

function annoToX(anno) {
  return X_MIN + ((anno - ANNO_MIN) / (ANNO_MAX - ANNO_MIN)) * (X_MAX - X_MIN)
}

function calcolaRaggio(nProdotti) {
  return STILE.orbita_raggio_min + nProdotti * STILE.orbita_spazio_per_prodotto
}

function hashStr(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff
  }
  return (hash >>> 0) / 0xffffffff
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function getDesigners(p) {
  return Array.isArray(p.designer) ? p.designer : [p.designer]
}

function preloadImages(paths) {
  const cache = {}
  paths.forEach((src) => {
    const img = new Image()
    img.src = src
    cache[src] = img
  })
  return cache
}

function App() {
  const [popup, setPopup] = useState(null)
  const [pannelloDesigner, setPannelloDesigner] = useState(null)
  const [pannelloVisibile, setPannelloVisibile] = useState(false)
  const [tooltipRelazione, setTooltipRelazione] = useState(null)
  const [designerAttivo, setDesignerAttivo] = useState(null)
  const [vistaCorrente, setVistaCorrente] = useState("designer")
  const [animaTransizioneFn, setAnimaTransizioneFn] = useState(null)

  useEffect(() => {
    document.body.style.margin = "0"
    document.body.style.padding = "0"
    document.body.style.overflow = "hidden"
    document.documentElement.style.overflow = "hidden"

    const container = document.createElement("div")
    container.style.cssText = "position:fixed;inset:0;z-index:1;"
    document.body.appendChild(container)

    const graph = new Graph()
    let cameraRatio = 1
    let nodoHoverAttivo = null
    let prodottoHoverAttivo = null
    let ultimoProdottoHover = null
    let prodottoCliccato = null
    let designerCliccato = null
    let annoBloccato = null
    let mouseDownPos = null
    let isDragging = false
    const animated = {}

    const imgPaths = [
      ...designers.map((d) => `/immagini/${d.foto}`),
      ...prodotti.map((p) => `/immagini/${p.foto}`),
    ]
    const imgCache = preloadImages(imgPaths)

    const nProdottiPerDesigner = {}
    prodotti.forEach((p) => {
      getDesigners(p).forEach((d) => {
        nProdottiPerDesigner[d] = (nProdottiPerDesigner[d] || 0) + 1
      })
    })

    const designerOrdinati = [...designers].sort((a, b) => a.nato - b.nato)

    const pesiCoppie = {}
    function aggiungiPeso(a, b, peso) {
      if (a === b) return
      const key = [a, b].sort().join("|")
      pesiCoppie[key] = (pesiCoppie[key] || 0) + peso
    }

    relazioni.forEach((r) => {
      const peso = r.categoria === "personale" ? STILE.peso_relazione_personale : STILE.peso_relazione_professionale
      aggiungiPeso(r.designer_a, r.designer_b, peso)
    })

    prodotti.forEach((p) => {
      const ds = getDesigners(p)
      for (let a = 0; a < ds.length; a++)
        for (let b = a + 1; b < ds.length; b++)
          aggiungiPeso(ds[a], ds[b], STILE.peso_coprogettazione)
    })

    const scuoleMap = {}
    const collettiviMap = {}
    designers.forEach((d) => {
      ;(d.scuole || []).forEach((s) => {
        if (!scuoleMap[s]) scuoleMap[s] = []
        scuoleMap[s].push(d.nome)
      })
      ;(d.collettivi || []).forEach((c) => {
        if (!collettiviMap[c]) collettiviMap[c] = []
        collettiviMap[c].push(d.nome)
      })
    })
    Object.values(scuoleMap).forEach((membri) => {
      for (let a = 0; a < membri.length; a++)
        for (let b = a + 1; b < membri.length; b++)
          aggiungiPeso(membri[a], membri[b], STILE.peso_scuola)
    })
    Object.values(collettiviMap).forEach((membri) => {
      for (let a = 0; a < membri.length; a++)
        for (let b = a + 1; b < membri.length; b++)
          aggiungiPeso(membri[a], membri[b], STILE.peso_collettivo)
    })

    const posizioniCalcolate = designerOrdinati.map((d, i) => ({
      d,
      x: annoToX(d.nato),
      y: (d.y !== null && d.y !== undefined) ? d.y : (designerOrdinati.length / 2 - i) * 0.5,
      manuale: d.y !== null && d.y !== undefined,
      raggio: calcolaRaggio(nProdottiPerDesigner[d.nome] || 0),
    }))

    for (let iter = 0; iter < STILE.force_iterazioni; iter++) {
      const forze = posizioniCalcolate.map(() => 0)
      for (let i = 0; i < posizioniCalcolate.length; i++) {
        if (posizioniCalcolate[i].manuale) continue
        for (let j = 0; j < posizioniCalcolate.length; j++) {
          if (i === j) continue
          const a = posizioniCalcolate[i]
          const b = posizioniCalcolate[j]
          const dy = a.y - b.y
          const dist = Math.abs(dy) || 0.01

          const key = [a.d.nome, b.d.nome].sort().join("|")
          const peso = pesiCoppie[key] || 0
          if (peso > 0) {
            forze[i] -= STILE.force_attrazione * peso * dy / dist
          }

          const minDist = (a.raggio + b.raggio) * STILE.anello_raggio_esterno + STILE.min_distanza_y
          if (dist < minDist) {
            const repulsione = STILE.force_repulsione * (minDist - dist) / minDist
            forze[i] += dy > 0 ? repulsione : -repulsione
          }
        }
      }
      for (let i = 0; i < posizioniCalcolate.length; i++) {
        if (!posizioniCalcolate[i].manuale) {
          posizioniCalcolate[i].y += forze[i] * 0.1
        }
      }
    }

    posizioniCalcolate.forEach(({ d, x, y }) => {
      graph.addNode(d.nome, {
        label: d.nome, size: STILE.designer_size, x, y,
        color: STILE.designer_colore, tipo: "designer",
        imgSrc: `/immagini/${d.foto}`, dati: d,
      })
      animated[d.nome] = { r: STILE.l1_designer_px, alpha: 1 }
    })

    relazioni.forEach((r) => {
      if (graph.hasNode(r.designer_a) && graph.hasNode(r.designer_b)) {
        if (!graph.hasEdge(r.designer_a, r.designer_b) && !graph.hasEdge(r.designer_b, r.designer_a)) {
          graph.addEdge(r.designer_a, r.designer_b, {
            color: "rgba(0,0,0,0)", size: 0,
            tipo: "relazione", attivo: false, dati: r,
          })
        }
      }
    })

    const prodottiPerDesigner = {}
    const prodottiMultiDesigner = []
    prodotti.forEach((p) => {
      const ds = getDesigners(p)
      if (ds.length > 1) {
        prodottiMultiDesigner.push(p)
      } else {
        const d = ds[0]
        if (!prodottiPerDesigner[d]) prodottiPerDesigner[d] = []
        prodottiPerDesigner[d].push(p)
      }
    })

    Object.entries(prodottiPerDesigner).forEach(([designer, lista]) => {
      if (!graph.hasNode(designer)) return
      const dx = graph.getNodeAttribute(designer, "x")
      const dy = graph.getNodeAttribute(designer, "y")
      const n = lista.length
      const raggioMax = calcolaRaggio(n)
      const listaOrdinata = [...lista].sort((a, b) => (a.anno || 0) - (b.anno || 0))
      const annoMin = listaOrdinata[0]?.anno || 1900
      const annoMax = listaOrdinata[listaOrdinata.length - 1]?.anno || 1980
      const arcoInizio = Math.PI * STILE.arco_inizio
      const arcoFine = Math.PI * STILE.arco_fine
      const sliceAngolo = (arcoFine - arcoInizio) / n
      const indiciAngolari = listaOrdinata.map((_, i) => i)
      indiciAngolari.sort((a, b) => hashStr(listaOrdinata[a].nome) - hashStr(listaOrdinata[b].nome))

      const conteggioPerAnno = {}
      listaOrdinata.forEach((p) => {
        const a = p.anno || 1900
        conteggioPerAnno[a] = (conteggioPerAnno[a] || 0) + 1
      })
      const indiceCorrentePerAnno = {}

      listaOrdinata.forEach((p, i) => {
        const t = annoMax === annoMin ? 0.5 : (p.anno - annoMin) / (annoMax - annoMin)
        const raggio = raggioMax * (STILE.anello_raggio_interno + t * (STILE.anello_raggio_esterno - STILE.anello_raggio_interno))
        const posAng = indiciAngolari.indexOf(i)
        const angolo = arcoInizio + sliceAngolo * posAng + sliceAngolo * 0.5 + (hashStr(p.nome) - 0.5) * sliceAngolo * STILE.arco_perturbazione

        const prodottoId = `prodotto:${designer}:${p.nome}:${i}`

        const orbitaX = dx + Math.cos(angolo) * raggio
        const orbitaY = dy + Math.sin(angolo) * raggio

        const anno = p.anno || 1900
        const nStessoAnno = conteggioPerAnno[anno]
        const idxAnno = indiceCorrentePerAnno[anno] || 0
        indiceCorrentePerAnno[anno] = idxAnno + 1
        const offset45 = nStessoAnno > 1 ? (idxAnno - (nStessoAnno - 1) / 2) * 0.5 : 0
        const timelineX = annoToX(anno) + offset45
        const timelineY = dy - offset45

        graph.addNode(prodottoId, {
          label: p.nome, size: STILE.prodotto_size,
          x: orbitaX, y: orbitaY,
          color: STILE.prodotto_colore, tipo: "prodotto",
          imgSrc: `/immagini/${p.foto}`, dati: p,
          orbitaX, orbitaY, timelineX, timelineY,
        })
        graph.addEdge(designer, prodottoId, {
          color: STILE.edge_prodotto_colore,
          size: STILE.edge_prodotto_size, tipo: "prodotto"
        })
        animated[prodottoId] = { r: STILE.l1_prodotto_px, alpha: 1 }
      })
    })

    const multiPerGruppo = {}
    prodottiMultiDesigner.forEach((p) => {
      const key = getDesigners(p).sort().join("|")
      if (!multiPerGruppo[key]) multiPerGruppo[key] = []
      multiPerGruppo[key].push(p)
    })

    Object.entries(multiPerGruppo).forEach(([key, lista]) => {
      const ds = key.split("|").filter((d) => graph.hasNode(d))
      if (ds.length === 0) return
      const coords = ds.map((d) => ({ x: graph.getNodeAttribute(d, "x"), y: graph.getNodeAttribute(d, "y") }))
      const centroX = coords.reduce((s, c) => s + c.x, 0) / coords.length - 3
      const centroY = coords.reduce((s, c) => s + c.y, 0) / coords.length

      const n = lista.length
      const raggioMax = calcolaRaggio(n)
      const listaOrdinata = [...lista].sort((a, b) => (a.anno || 0) - (b.anno || 0))
      const annoMin = listaOrdinata[0]?.anno || 1900
      const annoMax = listaOrdinata[listaOrdinata.length - 1]?.anno || 1980
      const arcoInizio = Math.PI * STILE.arco_inizio
      const arcoFine = Math.PI * STILE.arco_fine
      const sliceAngolo = (arcoFine - arcoInizio) / n
      const indiciAngolari = listaOrdinata.map((_, i) => i)
      indiciAngolari.sort((a, b) => hashStr(listaOrdinata[a].nome) - hashStr(listaOrdinata[b].nome))

      listaOrdinata.forEach((p, i) => {
        const t = annoMax === annoMin ? 0.5 : (p.anno - annoMin) / (annoMax - annoMin)
        const raggio = raggioMax * (STILE.anello_raggio_interno + t * (STILE.anello_raggio_esterno - STILE.anello_raggio_interno))
        const posAng = indiciAngolari.indexOf(i)
        const angolo = arcoInizio + sliceAngolo * posAng + sliceAngolo * 0.5 + (hashStr(p.nome) - 0.5) * sliceAngolo * STILE.arco_perturbazione

        const prodottoId = `prodotto:multi:${p.nome}:${i}`
        const orbitaX = centroX + Math.cos(angolo) * raggio
        const orbitaY = centroY + Math.sin(angolo) * raggio
        const timelineX = annoToX(p.anno || 1900)
        const timelineY = centroY

        graph.addNode(prodottoId, {
          label: p.nome, size: STILE.prodotto_size,
          x: orbitaX, y: orbitaY,
          color: STILE.prodotto_colore, tipo: "prodotto",
          imgSrc: `/immagini/${p.foto}`, dati: p,
          orbitaX, orbitaY, timelineX, timelineY,
        })
        ds.forEach((d) => {
          graph.addEdge(d, prodottoId, {
            color: STILE.edge_prodotto_colore,
            size: STILE.edge_prodotto_size, tipo: "prodotto"
          })
        })
        animated[prodottoId] = { r: STILE.l1_prodotto_px, alpha: 1 }
      })
    })

    const renderer = new Sigma(graph, container, {
      renderEdgeLabels: false,
      maxCameraRatio: MAX_CAMERA_RATIO,
      minCameraRatio: MIN_CAMERA_RATIO,
      nodeReducer: (node, data) => ({
        ...data, hidden: false, label: "",
        highlighted: false,
        color: "rgba(0,0,0,0)",
        borderColor: "rgba(0,0,0,0)",
        size: 0.001,
      }),
      edgeReducer: (edge, data) => ({
        ...data, hidden: true,
      }),
      labelRenderer: () => {},
      hoverRenderer: () => {},
    })

    // Il layout può superare Y_MIN/Y_MAX a causa degli offset cumulativi.
    // Calcoliamo quindi un bounding box reale, evitando che alcuni nodi finiscano
    // fuori dal sistema di coordinate usato da Sigma.
    let contenutoYMin = Infinity
    let contenutoYMax = -Infinity
    graph.forEachNode((node, attr) => {
      contenutoYMin = Math.min(contenutoYMin, attr.y)
      contenutoYMax = Math.max(contenutoYMax, attr.y)
    })
    if (!Number.isFinite(contenutoYMin) || !Number.isFinite(contenutoYMax)) {
      contenutoYMin = Y_MIN
      contenutoYMax = Y_MAX
    }

    renderer.setCustomBBox({
      x: [X_MIN - MARGINE_X, X_MAX + MARGINE_X],
      y: [Math.min(Y_MIN, contenutoYMin) - MARGINE_Y, Math.max(Y_MAX, contenutoYMax) + MARGINE_Y],
    })

    const overlayCanvas = document.createElement("canvas")
    overlayCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10;"
    container.appendChild(overlayCanvas)

    function ridimensionaOverlay() {
      const rect = container.getBoundingClientRect()
      overlayCanvas.width = Math.max(1, Math.round(rect.width))
      overlayCanvas.height = Math.max(1, Math.round(rect.height))
    }

    ridimensionaOverlay()
    cameraRatio = renderer.getCamera().getState().ratio

    function nodiCollegatiAlHover(nodo) {
      if (!nodo) return new Set()
      const s = new Set()
      s.add(nodo)
      graph.forEachEdge(nodo, (edge, attr, source, target) => {
        if (attr.tipo === "relazione" || attr.tipo === "prodotto") {
          s.add(source); s.add(target)
        }
      })
      return s
    }

    function scalaNodi() {
      const ratio = Math.max(MIN_CAMERA_RATIO, Math.min(MAX_CAMERA_RATIO, cameraRatio))
      return Math.min(1 / ratio, STILE.scala_nodi_max)
    }

    function scalaTesto() {
      const ratio = Math.max(MIN_CAMERA_RATIO, Math.min(MAX_CAMERA_RATIO, cameraRatio))
      return Math.min(1 / ratio, STILE.scala_testo_max)
    }

    function zoomT() {
      if (cameraRatio >= STILE.zoom_soglia) return 0
      return Math.min(1, (STILE.zoom_soglia - cameraRatio) / (STILE.zoom_soglia - MIN_CAMERA_RATIO))
    }

    function calcolaRTarget(node, attr, nodoAttivo) {
      const s = scalaNodi()
      const t = zoomT()
      if (attr.tipo === "designer") {
        const base = lerp(STILE.l1_designer_px, STILE.l2_designer_px, t) * s
        return node === nodoAttivo ? base * STILE.hover_scala : base
      }
      if (attr.tipo === "prodotto") {
        const base = lerp(STILE.l1_prodotto_px, STILE.l2_prodotto_px, t) * s
        if (node === prodottoCliccato) return base * 1.2
        if (node === prodottoHoverAttivo) return base * STILE.hover_scala
        return base
      }
      return lerp(STILE.l1_prodotto_px, STILE.l2_prodotto_px, t) * s
    }

    function disegnaTutto() {
      const ctx = overlayCanvas.getContext("2d")
      const w = overlayCanvas.width
      const h = overlayCanvas.height
      ctx.clearRect(0, 0, w, h)

      const st = scalaTesto()
      const t = zoomT()
      const labelDesignerSize = Math.max(STILE.label_min, lerp(STILE.l1_label_designer, STILE.l2_label_designer, t) * st)
      const labelProdottoBase = lerp(STILE.l1_label_prodotto, STILE.l2_label_prodotto, t)
      const mostraLabelProdotti = labelProdottoBase > 0.5
      const labelProdottoSize = mostraLabelProdotti ? Math.max(STILE.label_min, labelProdottoBase * st) : 0
      const nodoAttivo = designerCliccato || nodoHoverAttivo
      const collegati = nodiCollegatiAlHover(nodoAttivo)
      const hoverAttivo = nodoAttivo !== null

      const sn = scalaNodi()
      const grigliaRaggio = lerp(STILE.l1_griglia_pallino_raggio, STILE.l2_griglia_pallino_raggio, t)
      const yGrafoMin = Math.min(Y_MIN, contenutoYMin) - MARGINE_Y
      const yGrafoMax = Math.max(Y_MAX, contenutoYMax) + MARGINE_Y
      ANNI_SINGOLI.forEach((anno) => {
        const gx = annoToX(anno)
        for (let gy = Math.ceil(yGrafoMin); gy <= Math.floor(yGrafoMax); gy++) {
          const screen = renderer.graphToViewport({ x: gx, y: gy })
          if (screen.x < -2 || screen.x > w + 2 || screen.y < -2 || screen.y > h + 2) continue
          ctx.beginPath()
          ctx.arc(screen.x, screen.y, grigliaRaggio, 0, Math.PI * 2)
          ctx.fillStyle = STILE.griglia_pallino_colore
          ctx.fill()
        }
      })

      DECENNI.forEach((anno) => {
        const screen = renderer.graphToViewport({ x: annoToX(anno), y: 0 })
        ctx.font = "300 10px Roboto"
        ctx.fillStyle = STILE.griglia_label_colore
        ctx.textAlign = "center"
        ctx.fillText(anno, screen.x, 30)
      })

      graph.forEachNode((node, attr) => {
        if (!animated[node]) animated[node] = { r: STILE.l1_prodotto_px, alpha: 1 }
        const rTarget = calcolaRTarget(node, attr, nodoAttivo)
        let alphaTarget = 1
        if (vistaInterna === "timeline" && annoBloccato) {
          if (attr.tipo === "prodotto") {
            alphaTarget = attr.dati && attr.dati.anno === annoBloccato ? 1 : 0.2
          } else if (attr.tipo === "designer") {
            const haProdottoAnno = graph.neighbors(node).some(n => {
              const na = graph.getNodeAttribute(n, "dati")
              return na && na.anno === annoBloccato
            })
            alphaTarget = haProdottoAnno ? 1 : 0.2
          }
        } else if (prodottoHoverAttivo) {
          const designersDelProdotto = prodottoHoverAttivo && graph.hasNode(prodottoHoverAttivo)
            ? graph.neighbors(prodottoHoverAttivo).filter(n => graph.getNodeAttribute(n, "tipo") === "designer")
            : []
          alphaTarget = (node === prodottoHoverAttivo || designersDelProdotto.includes(node)) ? 1 : 0.2
        } else if (hoverAttivo) {
          alphaTarget = collegati.has(node) ? 1 : STILE.hover_opacita_altri
        }
        animated[node].r = lerp(animated[node].r, rTarget, STILE.lerp_velocita)
        animated[node].alpha = lerp(animated[node].alpha, alphaTarget, STILE.lerp_velocita)
      })

      graph.forEachEdge((edge, attr, source, target) => {
        const posS = renderer.graphToViewport({ x: graph.getNodeAttribute(source, "x"), y: graph.getNodeAttribute(source, "y") })
        const posT = renderer.graphToViewport({ x: graph.getNodeAttribute(target, "x"), y: graph.getNodeAttribute(target, "y") })

        if (attr.tipo === "relazione" && attr.attivo) {
          ctx.globalAlpha = 1
          ctx.beginPath()
          ctx.moveTo(posS.x, posS.y)
          ctx.lineTo(posT.x, posT.y)
          ctx.strokeStyle = STILE.edge_relazione_colore
          ctx.lineWidth = STILE.edge_relazione_size
          ctx.setLineDash([5, 5])
          ctx.stroke()
          ctx.setLineDash([])
        }

        if (attr.tipo === "prodotto") {
          let edgeColor = STILE.edge_prodotto_colore
          let edgeWidth = STILE.edge_prodotto_size
          let edgeAlpha = 1
          if (prodottoHoverAttivo) {
            if (source === prodottoHoverAttivo || target === prodottoHoverAttivo) {
              edgeColor = "#000000"
              edgeWidth = 0.5
            } else {
              edgeAlpha = 0
            }
          } else if (hoverAttivo) {
            if (!collegati.has(source) || !collegati.has(target)) {
              edgeAlpha = 0.06
            }
          }
          ctx.globalAlpha = edgeAlpha
          ctx.beginPath()
          ctx.moveTo(posS.x, posS.y)
          ctx.lineTo(posT.x, posT.y)
          ctx.strokeStyle = edgeColor
          ctx.lineWidth = edgeWidth
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        ctx.globalAlpha = 1
      })

      if (vistaInterna === "timeline") {
        const annoLinea = annoBloccato || (prodottoHoverAttivo && graph.hasNode(prodottoHoverAttivo) ? graph.getNodeAttribute(prodottoHoverAttivo, "dati").anno : null)
        if (annoLinea) {
          const lineaX = renderer.graphToViewport({ x: annoToX(annoLinea), y: 0 }).x
          ctx.beginPath()
          ctx.moveTo(lineaX, 0)
          ctx.lineTo(lineaX, h)
          ctx.strokeStyle = STILE.edge_relazione_colore
          ctx.lineWidth = STILE.edge_relazione_size
          ctx.setLineDash([5, 5])
          ctx.stroke()
          ctx.setLineDash([])
          ctx.font = "600 14px Roboto"
          ctx.fillStyle = "#555"
          ctx.textAlign = "center"
          ctx.fillText(annoLinea, lineaX, 18)
        }
      }

      const nodiProdotti = []
      const nodiDesigner = []
      const inPrimoPiano = prodottoCliccato || ultimoProdottoHover
      graph.forEachNode((node, attr) => {
        if (attr.tipo === "designer") {
          nodiDesigner.push({ node, attr })
        } else {
          nodiProdotti.push({ node, attr })
        }
      })
      if (inPrimoPiano) {
        const idx = nodiProdotti.findIndex((n) => n.node === inPrimoPiano)
        if (idx !== -1) {
          const [item] = nodiProdotti.splice(idx, 1)
          nodiProdotti.push(item)
        }
      }
      const nodiFiltrati = [...nodiProdotti, ...nodiDesigner]

      nodiFiltrati.forEach(({ node, attr }) => {
        const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
        const r = animated[node]?.r ?? STILE.l1_prodotto_px
        const alpha = animated[node]?.alpha ?? 1
        const isAttivo = node === nodoAttivo

        ctx.globalAlpha = alpha
        ctx.save()
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
        ctx.clip()
        const img = imgCache[attr.imgSrc]
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, pos.x - r, pos.y - r, r * 2, r * 2)
        } else {
          ctx.fillStyle = attr.color
          ctx.fill()
        }
        ctx.restore()

        ctx.beginPath()
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
        ctx.strokeStyle = isAttivo && attr.tipo === "designer" ? "#000000" : STILE.bordo_colore
        ctx.lineWidth = isAttivo && attr.tipo === "designer" ? 1.5 : STILE.bordo_spessore
        ctx.stroke()

        if (attr.tipo === "designer") {
          const parti = attr.label.split(" ")
          const cognome = parti.pop()
          const nome = parti.join(" ")
          const lx = pos.x + r + STILE.label_offset
          const altezzaBlocco = labelDesignerSize * 2 + 5 + (labelDesignerSize - 1)
          const lyStart = pos.y - altezzaBlocco / 2 + labelDesignerSize

          const date = attr.dati.morto ? `${attr.dati.nato} — ${attr.dati.morto}` : `${attr.dati.nato}`
          const pad = 3
          const bgColor = STILE.sfondo_colore || "#f5f5f0"

          ctx.font = `400 ${labelDesignerSize}px Roboto`
          const wNome = ctx.measureText(nome).width
          ctx.font = `700 ${labelDesignerSize}px Roboto`
          const wCognome = ctx.measureText(cognome).width
          ctx.font = `${STILE.label_date_peso} ${labelDesignerSize - 1}px Roboto`
          const wDate = ctx.measureText(date).width

          let ly = lyStart
          ctx.globalAlpha = 0.85 * alpha
          ctx.fillStyle = bgColor
          ctx.fillRect(lx - pad, ly - labelDesignerSize, wNome + pad * 2, labelDesignerSize + pad)
          ctx.fillRect(lx - pad, ly + 1, wCognome + pad * 2, labelDesignerSize + pad)
          ctx.fillRect(lx - pad, ly + labelDesignerSize + 6, wDate + pad * 2, (labelDesignerSize - 1) + pad)
          ctx.globalAlpha = alpha

          ctx.textAlign = "left"
          ctx.fillStyle = STILE.label_designer_colore
          ctx.font = `400 ${labelDesignerSize}px Roboto`
          ctx.fillText(nome, lx, ly)
          ly += labelDesignerSize + 1
          ctx.font = `700 ${labelDesignerSize}px Roboto`
          ctx.fillText(cognome, lx, ly)
          ly += labelDesignerSize + 5
          ctx.font = `${STILE.label_date_peso} ${labelDesignerSize - 1}px Roboto`
          ctx.fillStyle = STILE.label_date_colore
          ctx.fillText(date, lx, ly)
        }

        if (attr.tipo === "prodotto" && mostraLabelProdotti) {
          ctx.font = `${STILE.label_prodotto_peso} ${labelProdottoSize}px Roboto`
          ctx.fillStyle = STILE.label_prodotto_colore
          ctx.textAlign = "left"
          ctx.fillText(attr.label, pos.x + r + STILE.label_offset, pos.y + labelProdottoSize / 3)
          if (attr.dati.anno) {
            ctx.font = `300 ${labelProdottoSize - 1}px Roboto`
            ctx.fillStyle = STILE.label_prodotto_anno_colore
            ctx.fillText(attr.dati.anno, pos.x + r + STILE.label_offset, pos.y + labelProdottoSize / 3 + labelProdottoSize + 1)
          }
        }
        ctx.globalAlpha = 1
      })
    }

    // Il canvas overlay ha una propria animazione. In questo modo il primo frame
    // viene disegnato anche se Sigma ha già completato il suo render iniziale.
    let overlayAnimationFrame = null
    let overlayFramesResidui = 0

    function richiediDisegnoOverlay(frames = 1) {
      overlayFramesResidui = Math.max(overlayFramesResidui, frames)
      if (overlayAnimationFrame !== null) return

      const tick = () => {
        overlayAnimationFrame = null
        disegnaTutto()
        overlayFramesResidui -= 1

        if (overlayFramesResidui > 0) {
          overlayAnimationFrame = requestAnimationFrame(tick)
        }
      }

      overlayAnimationFrame = requestAnimationFrame(tick)
    }

    renderer.on("afterRender", () => {
      richiediDisegnoOverlay(1)
    })

    const camera = renderer.getCamera()
    let clamping = false
    camera.on("updated", (state) => {
      cameraRatio = state.ratio
      if (clamping) { richiediDisegnoOverlay(2); return }

      const r = state.ratio
      const pad = 0.05
      const xLo = Math.min(0.5, r / 2 - pad)
      const xHi = Math.max(0.5, 1 - r / 2 + pad)
      const yLo = Math.min(0.5, r / 2 - pad)
      const yHi = Math.max(0.5, 1 - r / 2 + pad)
      const cx = Math.max(xLo, Math.min(xHi, state.x))
      const cy = Math.max(yLo, Math.min(yHi, state.y))

      if (cx !== state.x || cy !== state.y) {
        clamping = true
        camera.setState({ x: cx, y: cy })
        clamping = false
      }

      try { localStorage.setItem("dn-camera", JSON.stringify({ x: state.x, y: state.y, ratio: state.ratio })) } catch {}
      richiediDisegnoOverlay(2)
    })

    const resizeObserver = new ResizeObserver(() => {
      ridimensionaOverlay()
      richiediDisegnoOverlay(2)
    })
    resizeObserver.observe(container)

    Object.values(imgCache).forEach((img) => {
      if (!img.complete) {
        img.addEventListener("load", () => richiediDisegnoOverlay(2), { once: true })
        img.addEventListener("error", () => richiediDisegnoOverlay(1), { once: true })
      }
    })

    // Primo render: ora l'overlay esiste già e l'evento afterRender è collegato.
    try {
      const saved = JSON.parse(localStorage.getItem("dn-camera"))
      if (saved) camera.setState({ x: saved.x, y: saved.y, ratio: saved.ratio })
    } catch {}
    renderer.refresh()
    richiediDisegnoOverlay(2)

    let vistaInterna = "designer"
    let transizioneAttiva = false

    function raccogliProdotti() {
      const lista = []
      graph.forEachNode((node, attr) => {
        if (attr.tipo === "prodotto") lista.push(node)
      })
      lista.sort((a, b) => {
        const pa = graph.getNodeAttribute(a, "dati")
        const pb = graph.getNodeAttribute(b, "dati")
        return (pa.anno || 0) - (pb.anno || 0)
      })
      return lista
    }

    function animaTransizione(vista) {
      if (transizioneAttiva || vista === vistaInterna) return
      transizioneAttiva = true
      vistaInterna = vista
      annoBloccato = null
      const prodottiList = raccogliProdotti()
      const staggerMs = STILE.transizione_stagger
      const durata = STILE.transizione_durata

      prodottiList.forEach((node, idx) => {
        const attr = graph.getNodeAttributes(node)
        const daX = attr.x
        const daY = attr.y
        const aX = vista === "timeline" ? attr.timelineX : attr.orbitaX
        const aY = vista === "timeline" ? attr.timelineY : attr.orbitaY
        const ritardo = idx * staggerMs
        const inizio = performance.now() + ritardo

        function step(now) {
          const t = Math.min(1, Math.max(0, (now - inizio) / durata))
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
          graph.setNodeAttribute(node, "x", lerp(daX, aX, ease))
          graph.setNodeAttribute(node, "y", lerp(daY, aY, ease))
          richiediDisegnoOverlay(2)
          if (t < 1) {
            requestAnimationFrame(step)
          } else if (idx === prodottiList.length - 1) {
            transizioneAttiva = false
          }
        }
        requestAnimationFrame(step)
      })
    }

    setAnimaTransizioneFn(() => animaTransizione)

    const sigmaCanvas = container
    if (sigmaCanvas) {
      sigmaCanvas.addEventListener("mousedown", (e) => {
        mouseDownPos = { x: e.clientX, y: e.clientY }
        isDragging = false
      })

      sigmaCanvas.addEventListener("mousemove", (e) => {
        if (mouseDownPos) {
          const dx = Math.abs(e.clientX - mouseDownPos.x)
          const dy = Math.abs(e.clientY - mouseDownPos.y)
          if (dx > 4 || dy > 4) isDragging = true
        }

        const rect = sigmaCanvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top

        if (!designerCliccato) {
          let nodoHover = null
          graph.forEachNode((node, attr) => {
            if (attr.tipo !== "designer") return
            const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
            const r = animated[node]?.r ?? STILE.l1_designer_px
            if (Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2) < r) nodoHover = node
          })
          if (nodoHover !== nodoHoverAttivo) {
            nodoHoverAttivo = nodoHover
            graph.forEachEdge((edge, attr) => { if (attr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
            if (nodoHover) {
              graph.forEachEdge(nodoHover, (edge, edgeAttr) => {
                if (edgeAttr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", true)
              })
            }
            richiediDisegnoOverlay(18)
          }
        }

        if (designerCliccato) {
          let relazioneHover = null
          graph.forEachEdge(designerCliccato, (edge, attr, source, target) => {
            if (attr.tipo !== "relazione" || !attr.attivo) return
            const posS = renderer.graphToViewport({ x: graph.getNodeAttribute(source, "x"), y: graph.getNodeAttribute(source, "y") })
            const posT = renderer.graphToViewport({ x: graph.getNodeAttribute(target, "x"), y: graph.getNodeAttribute(target, "y") })
            const dx = posT.x - posS.x, dy = posT.y - posS.y
            const len2 = dx * dx + dy * dy
            if (len2 === 0) return
            const t = Math.max(0, Math.min(1, ((mx - posS.x) * dx + (my - posS.y) * dy) / len2))
            const px = posS.x + t * dx - mx, py = posS.y + t * dy - my
            if (Math.sqrt(px * px + py * py) < 10) relazioneHover = { dati: attr.dati, x: e.clientX, y: e.clientY }
          })
          setTooltipRelazione(relazioneHover)
        } else {
          setTooltipRelazione(null)
        }

        if (cameraRatio < STILE.zoom_soglia || vistaInterna === "timeline") {
          let prodottoHover = null
          graph.forEachNode((node, attr) => {
            if (attr.tipo !== "prodotto") return
            const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
            const r = animated[node]?.r ?? STILE.l1_prodotto_px
            if (Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2) < r) prodottoHover = node
          })
          if (prodottoHover !== prodottoHoverAttivo) { prodottoHoverAttivo = prodottoHover; if (prodottoHover) ultimoProdottoHover = prodottoHover; richiediDisegnoOverlay(18) }
        } else if (prodottoHoverAttivo !== null) { prodottoHoverAttivo = null; richiediDisegnoOverlay(18) }
      })

      sigmaCanvas.addEventListener("mouseup", (e) => {
        if (isDragging) { mouseDownPos = null; isDragging = false; return }
        mouseDownPos = null; isDragging = false

        const rect = sigmaCanvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top

        let relazioneCliccata = null
        if (designerCliccato) {
          graph.forEachEdge(designerCliccato, (edge, attr, source, target) => {
            if (attr.tipo !== "relazione") return
            const posS = renderer.graphToViewport({ x: graph.getNodeAttribute(source, "x"), y: graph.getNodeAttribute(source, "y") })
            const posT = renderer.graphToViewport({ x: graph.getNodeAttribute(target, "x"), y: graph.getNodeAttribute(target, "y") })
            const dx = posT.x - posS.x, dy = posT.y - posS.y
            const len2 = dx * dx + dy * dy
            if (len2 === 0) return
            const t = Math.max(0, Math.min(1, ((mx - posS.x) * dx + (my - posS.y) * dy) / len2))
            const px = posS.x + t * dx - mx, py = posS.y + t * dy - my
            if (Math.sqrt(px * px + py * py) < 8) relazioneCliccata = attr.dati
          })
        }
        if (relazioneCliccata) { setPopup({ tipo: "relazione", dati: relazioneCliccata, colore: "#888888" }); return }

        let trovato = null
        graph.forEachNode((node, attr) => {
          const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
          const r = animated[node]?.r ?? (attr.tipo === "designer" ? STILE.l1_designer_px : STILE.l1_prodotto_px)
          if (Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2) < r) trovato = { node, attr }
        })

        if (trovato) {
          if (trovato.attr.tipo === "designer") {
            prodottoCliccato = null
            if (designerCliccato === trovato.node) {
              designerCliccato = null
              setDesignerAttivo(null)
              setPannelloVisibile(false)
              setTimeout(() => setPannelloDesigner(null), 350)
              graph.forEachEdge((edge, attr) => { if (attr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
            } else {
              designerCliccato = trovato.node
              setDesignerAttivo(trovato.node)
              setPannelloDesigner(trovato.attr.dati)
              requestAnimationFrame(() => setPannelloVisibile(true))
              graph.forEachEdge((edge, attr) => { if (attr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
              graph.forEachEdge(trovato.node, (edge, edgeAttr) => { if (edgeAttr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", true) })
            }
            richiediDisegnoOverlay(18)
          } else {
            if (vistaInterna === "timeline" && trovato.attr.dati && trovato.attr.dati.anno) {
              const anno = trovato.attr.dati.anno
              annoBloccato = annoBloccato === anno ? null : anno
            }
            prodottoCliccato = trovato.node
            setPopup({ tipo: trovato.attr.tipo, dati: trovato.attr.dati, colore: trovato.attr.color })
            richiediDisegnoOverlay(18)
          }
        } else {
          designerCliccato = null; prodottoCliccato = null
          annoBloccato = null
          setDesignerAttivo(null)
          setPannelloVisibile(false)
          setTimeout(() => setPannelloDesigner(null), 350)
          graph.forEachEdge((edge, attr) => { if (attr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
          setPopup(null); setTooltipRelazione(null)
          richiediDisegnoOverlay(18)
        }
      })
    }

    return () => {
      resizeObserver.disconnect()
      if (overlayAnimationFrame !== null) cancelAnimationFrame(overlayAnimationFrame)
      renderer.kill()
      if (container.parentNode) container.parentNode.removeChild(container)
      document.body.style.overflow = ""
      document.documentElement.style.overflow = ""
    }
  }, [])

  function cambiaVista(vista) {
    if (vista === vistaCorrente) return
    setVistaCorrente(vista)
    if (animaTransizioneFn) animaTransizioneFn(vista)
  }

  return (
    <>
      <div style={{ position: "fixed", top: 20, left: 24, fontFamily: "Roboto, sans-serif", zIndex: 20, pointerEvents: "none" }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: "#1a1a1a", letterSpacing: 1 }}>Design italiano</div>
        <div style={{ fontSize: 12, fontWeight: 300, color: "#888888", marginTop: 2 }}>Designer e prodotti — 1880/1980</div>
      </div>

      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 20, fontFamily: "Roboto, sans-serif", display: "flex", gap: 0, background: "white", borderRadius: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.1)", overflow: "hidden" }}>
        <button onClick={() => cambiaVista("designer")}
          style={{ padding: "8px 18px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: vistaCorrente === "designer" ? 600 : 300, fontFamily: "Roboto, sans-serif", color: vistaCorrente === "designer" ? "#1a1a1a" : "#999", background: vistaCorrente === "designer" ? "#f0f0f0" : "white", transition: "all 0.2s" }}>
          Designer
        </button>
        <button onClick={() => cambiaVista("timeline")}
          style={{ padding: "8px 18px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: vistaCorrente === "timeline" ? 600 : 300, fontFamily: "Roboto, sans-serif", color: vistaCorrente === "timeline" ? "#1a1a1a" : "#999", background: vistaCorrente === "timeline" ? "#f0f0f0" : "white", transition: "all 0.2s" }}>
          Linea del tempo
        </button>
      </div>

      {designerAttivo && (
        <div style={{ position: "fixed", bottom: 64, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.06)", borderRadius: 20, padding: "6px 16px", fontSize: 11, fontWeight: 300, color: "#888", fontFamily: "Roboto, sans-serif", zIndex: 20, pointerEvents: "none" }}>
          Hover sui collegamenti — clicca su area vuota per uscire
        </div>
      )}

      {tooltipRelazione && (
        <div style={{ position: "fixed", left: tooltipRelazione.x + 14, top: tooltipRelazione.y - 10, background: "white", borderRadius: 8, padding: "8px 12px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", fontFamily: "Roboto, sans-serif", fontSize: 12, zIndex: 200, pointerEvents: "none", maxWidth: 220 }}>
          <div style={{ fontWeight: 600, color: "#222", marginBottom: 4, fontSize: 12 }}>
            {tooltipRelazione.dati.designer_a} — {tooltipRelazione.dati.designer_b}
          </div>
          <div style={{ fontWeight: 600, color: "#444", marginBottom: 4, textTransform: "uppercase", fontSize: 10, letterSpacing: 1 }}>
            {tooltipRelazione.dati.tipo}
          </div>
          <div style={{ fontWeight: 300, color: "#555", lineHeight: 1.4 }}>
            {tooltipRelazione.dati.descrizione}
          </div>
        </div>
      )}

      {pannelloDesigner && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 340,
          background: "white", boxShadow: "-4px 0 32px rgba(0,0,0,0.12)",
          fontFamily: "Roboto, sans-serif", zIndex: 100,
          transform: pannelloVisibile ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ padding: "32px 28px 0", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 600, color: "#1a1a1a", lineHeight: 1.2 }}>{pannelloDesigner.nome}</div>
                <div style={{ fontSize: 13, fontWeight: 300, color: "#999", marginTop: 4 }}>
                  {pannelloDesigner.nato}{pannelloDesigner.morto ? ` — ${pannelloDesigner.morto}` : ""}
                </div>
              </div>
              <button onClick={() => { setPannelloVisibile(false); setTimeout(() => setPannelloDesigner(null), 350) }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#aaa", padding: "0 4px", lineHeight: 1 }}>
                &times;
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px 32px" }}>
            <div style={{
              width: "100%", aspectRatio: "1", borderRadius: 12, overflow: "hidden",
              background: "#f5f5f5", marginBottom: 20,
            }}>
              <img src={`/immagini/${pannelloDesigner.foto}`} alt={pannelloDesigner.nome}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onError={(e) => { e.target.style.display = "none" }} />
            </div>
            <p style={{ fontSize: 13, fontWeight: 300, color: "#555", lineHeight: 1.6, margin: 0 }}>
              {pannelloDesigner.bio}
            </p>
          </div>
        </div>
      )}

      {popup && (
        <div style={{ position: "fixed", top: 30, right: 30, background: "white", borderRadius: 12, padding: 24, width: 280, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", fontFamily: "Roboto, sans-serif", zIndex: 100 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: popup.colore, display: "inline-block", marginRight: 8 }} />
          <strong style={{ fontSize: 15, fontWeight: 600 }}>
            {popup.tipo === "relazione" ? `${popup.dati.designer_a} — ${popup.dati.designer_b}` : popup.dati.nome}
          </strong>
          <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #eee" }} />
          {popup.tipo === "relazione" && (
            <>
              <p style={{ margin: "4px 0", fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>{popup.dati.tipo}</p>
              <p style={{ margin: "8px 0", fontSize: 12, fontWeight: 300, color: "#555" }}>{popup.dati.descrizione}</p>
            </>
          )}
          {popup.tipo === "prodotto" && (
            <>
              <p style={{ margin: "4px 0", fontSize: 12, fontWeight: 300 }}><span style={{ fontWeight: 600 }}>Anno:</span> {popup.dati.anno}</p>
              <p style={{ margin: "4px 0", fontSize: 12, fontWeight: 300 }}><span style={{ fontWeight: 600 }}>Designer:</span> {popup.dati.designer}</p>
              <p style={{ margin: "4px 0", fontSize: 12, fontWeight: 300 }}><span style={{ fontWeight: 600 }}>Azienda:</span> {popup.dati.azienda}</p>
            </>
          )}
          <button onClick={() => setPopup(null)} style={{ marginTop: 16, padding: "6px 14px", border: "none", borderRadius: 6, background: "#2d2d2d", color: "white", cursor: "pointer", fontSize: 12, fontFamily: "Roboto, sans-serif", fontWeight: 300 }}>
            Chiudi
          </button>
        </div>
      )}
    </>
  )
}

export default App
