import { useEffect, useState, useRef } from "react"
import Graph from "graphology"
import Sigma from "sigma"
import designers from "./data/designers.json"
import prodotti from "./data/prodotti.json"
import relazioni from "./data/relazioni.json"

const STILE = {
  // --- Colori ---
  designer_colore: "#090e54",
  cursore_colore: "#1a2a8a",
  cursore_alone_colore: "#4466dd",
  cursore_raggio: 4,
  cursore_alone_raggio: 14,
  cursore_alone_velocita: 0.12,
  prodotto_colore: "#cccccc",
  bordo_colore: "#222222",
  bordo_spessore: 0.2,
  griglia_pallino_colore: "#d8d8d8",
  griglia_label_colore: "#aaaaaa",
  edge_prodotto_colore: "#dddddd",
  edge_relazione_colore: "#888888",
  sfondo_colore: "#e8e8e8",
  label_sfondo_colore: "#f0f0f0",
  prodotto_multi_bordo: "#999999",

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
  edge_prodotto_size: 0.5,
  edge_relazione_size: 1,
  designer_size: 8,
  prodotto_size: 5,

  // =============================================
  //  ZOOM UNIFICATO (responsive)
  //  Scala logaritmica da lontano (min) a vicino (max).
  //  Tutti i valori in px, riferiti a un viewport di 800px.
  //  Su schermi più piccoli/grandi scalano automaticamente.
  //
  //  zoom_*_min        → dimensione a zoom completamente out
  //  zoom_*_max        → dimensione a zoom completamente in
  //  zoom_label_soglia → punto (0–1) in cui appaiono le label prodotti
  //  zoom_viewport_ref → viewport di riferimento per il ridimensionamento
  // =============================================
  zoom_designer_min: 3,
  zoom_designer_max: 18,
  zoom_prodotto_min: 2,
  zoom_prodotto_max: 36,
  zoom_label_designer_min: 4,
  zoom_label_designer_max: 14,
  zoom_label_prodotto_max: 10,
  zoom_label_soglia: 0.4,
  zoom_griglia_min: 1.4,
  zoom_griglia_max: 3,
  zoom_viewport_ref: 800,

  // --- Transizione tra viste ---
  transizione_stagger: 4,    // ritardo tra un prodotto e l'altro (ms)
  transizione_durata: 1200,    // durata animazione per prodotto (ms)

  // --- Hover / interazione ---
  hover_scala: 2,
  hover_opacita_altri: 0.05,
  lerp_velocita: 0.15,

  // --- Layout force-directed Y ---
  peso_collettivo: 0.8,
  peso_coprogettazione: 1.0,
  peso_relazione_personale: 1.0,
  peso_relazione_professionale: 0.5,
  peso_scuola: 0.4,
  force_iterazioni: 500,
  force_repulsione: 0.8,
  force_attrazione: 0.8,
  min_distanza_y: 0.5,
  orbita_raggio_min: 0.5,
  orbita_spazio_per_prodotto: 0.08,
  anello_raggio_interno: 1.0,
  anello_raggio_esterno: 2.0,
  arco_inizio: 0.15,
  arco_fine: 1.85,
  arco_perturbazione: 0.4,
}

const MACRO_CATEGORIE = {
  illuminazione: ["lampada", "lampadario"],
  sedute: ["sedia", "poltrona", "sgabello", "divano"],
  mobili: ["tavolo", "scrivania", "libreria", "cassettiera", "letto", "carrello", "contenitore", "appendiabiti"],
  oggetti: [],
}

const ORDINE_SETTORI = ["illuminazione", "sedute", "mobili", "oggetti"]

function getMacro(categoria) {
  for (const [macro, cats] of Object.entries(MACRO_CATEGORIE)) {
    if (cats.includes(categoria)) return macro
  }
  return "oggetti"
}

function calcolaSettoriDinamici(lista, arco360 = false) {
  const gruppi = {}
  lista.forEach((p, i) => {
    const m = getMacro(p.categoria)
    if (!gruppi[m]) gruppi[m] = []
    gruppi[m].push({ p, i })
  })
  const settoriPresenti = ORDINE_SETTORI.filter((s) => gruppi[s])
  const totale = lista.length
  const arcoInizio = arco360 ? 0 : Math.PI * STILE.arco_inizio
  const arcoFine = arco360 ? Math.PI * 2 : Math.PI * STILE.arco_fine
  const arcoTotale = arcoFine - arcoInizio
  const settori = {}
  let cursore = arcoInizio
  settoriPresenti.forEach((s) => {
    const n = gruppi[s].length
    const ampiezza = arcoTotale * (n / totale)
    const ordinati = [...gruppi[s]].sort((a, b) => {
      if (a.p.categoria !== b.p.categoria) return a.p.categoria.localeCompare(b.p.categoria)
      return (a.p.anno || 0) - (b.p.anno || 0)
    })
    settori[s] = { inizio: cursore, fine: cursore + ampiezza, prodotti: ordinati }
    cursore += ampiezza
  })
  return settori
}

const ANNO_MIN = 1880
const ANNO_MAX = 2020
const X_MIN = -120
const X_MAX = 120
const DECENNI = [1880,1890,1900,1910,1920,1930,1940,1950,1960,1970,1980,1990,2000,2010,2020]
const ANNI_SINGOLI = Array.from({length: (2020-1880)+1}, (_, i) => 1880 + i)
const MARGINE_X = 2
const MARGINE_Y = 2
const Y_MIN = -20
const Y_MAX = 20
const MAX_CAMERA_RATIO = window.innerWidth < 768 ? 0.6 : 1.2
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
  const [ridisegnaFn, setRidisegnaFn] = useState(null)
  const [haInteragito, setHaInteragito] = useState(false)
  const [bioEspansa, setBioEspansa] = useState(false)
  const [aziendaAttiva, setAziendaAttiva] = useState(null)
  const aziendaAttivaRef = useRef(null)
  const haInteragitoRef = useRef(false)

  useEffect(() => {
    document.body.style.margin = "0"
    document.body.style.padding = "0"
    document.body.style.overflow = "hidden"
    document.body.style.background = STILE.sfondo_colore
    document.documentElement.style.overflow = "hidden"

    const isMobile = window.innerWidth < 768
    const container = document.createElement("div")
    container.style.cssText = isMobile
      ? "position:fixed;top:0;right:0;bottom:0;left:0;z-index:1;cursor:none;"
      : "position:fixed;top:0;right:0;bottom:0;left:200px;z-index:1;cursor:none;"
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
    const dpr = window.devicePixelRatio || 1
    let viewportMin = Math.min(window.innerWidth, window.innerHeight)
    let mouseX = -100, mouseY = -100
    let mouseTrailX = -100, mouseTrailY = -100
    let mouseNelCanvas = false

    const imgPaths = [
      ...designers.map((d) => `${import.meta.env.BASE_URL}immagini/${d.foto}`),
      ...prodotti.map((p) => `${import.meta.env.BASE_URL}immagini/${p.foto}`),
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

    const multiCount = {}
    prodotti.forEach((p) => {
      const ds = getDesigners(p)
      if (ds.length < 2) return
      const key = ds.sort().join("|")
      multiCount[key] = (multiCount[key] || 0) + 1
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

          const nMulti = multiCount[key] || 0
          const extraMulti = nMulti > 0 ? calcolaRaggio(nMulti) * 1.5 * STILE.anello_raggio_esterno : 0
          const minDist = (a.raggio + b.raggio) * STILE.anello_raggio_esterno + STILE.min_distanza_y + extraMulti
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

    const coprogettiGruppi = {}
    prodotti.forEach((p) => {
      const ds = getDesigners(p)
      if (ds.length < 2) return
      const key = ds.sort().join("|")
      if (!coprogettiGruppi[key]) coprogettiGruppi[key] = ds
    })
    const vincolato = {}
    Object.values(coprogettiGruppi).forEach((gruppo) => {
      gruppo.forEach((nome) => {
        if (!vincolato[nome]) vincolato[nome] = new Set()
        gruppo.forEach((altro) => { if (altro !== nome) vincolato[nome].add(altro) })
      })
    })
    Object.values(collettiviMap).forEach((membri) => {
      membri.forEach((nome) => {
        if (!vincolato[nome]) vincolato[nome] = new Set()
        membri.forEach((altro) => { if (altro !== nome) vincolato[nome].add(altro) })
      })
    })

    posizioniCalcolate.sort((a, b) => b.y - a.y)
    const inseriti = new Set()
    const ordinato = []
    posizioniCalcolate.forEach((p) => {
      if (inseriti.has(p.d.nome)) return
      ordinato.push(p)
      inseriti.add(p.d.nome)
      if (vincolato[p.d.nome]) {
        vincolato[p.d.nome].forEach((partner) => {
          if (inseriti.has(partner)) return
          const pp = posizioniCalcolate.find((q) => q.d.nome === partner)
          if (pp) { ordinato.push(pp); inseriti.add(partner) }
        })
      }
    })

    for (let i = 1; i < ordinato.length; i++) {
      const prev = ordinato[i - 1]
      const curr = ordinato[i]
      if (curr.manuale) continue
      const minGap = (prev.raggio + curr.raggio) * STILE.anello_raggio_esterno + STILE.min_distanza_y
      if (prev.y - curr.y < minGap) {
        curr.y = prev.y - minGap
      }
    }

    ordinato.forEach((p, i) => {
      const idx = posizioniCalcolate.indexOf(p)
      if (idx !== -1) posizioniCalcolate[idx] = p
    })

    posizioniCalcolate.forEach(({ d, x, y }) => {
      graph.addNode(d.nome, {
        label: d.nome, size: STILE.designer_size, x, y,
        color: STILE.designer_colore, tipo: "designer",
        imgSrc: `${import.meta.env.BASE_URL}immagini/${d.foto}`, dati: d,
      })
      animated[d.nome] = { r: STILE.zoom_designer_min, alpha: 1 }
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
      const settori = calcolaSettoriDinamici(listaOrdinata)

      const conteggioPerAnno = {}
      listaOrdinata.forEach((p) => {
        const a = p.anno || 1900
        conteggioPerAnno[a] = (conteggioPerAnno[a] || 0) + 1
      })
      const indiceCorrentePerAnno = {}

      listaOrdinata.forEach((p, i) => {
        const macro = getMacro(p.categoria)
        const sett = settori[macro]
        const idxInSettore = sett.prodotti.findIndex((g) => g.i === i)
        const nInSettore = sett.prodotti.length
        const sliceAngolo = (sett.fine - sett.inizio) / Math.max(1, nInSettore)
        const angolo = sett.inizio + sliceAngolo * idxInSettore + sliceAngolo * 0.5 + (hashStr(p.nome) - 0.5) * sliceAngolo * STILE.arco_perturbazione

        const t = annoMax === annoMin ? 0.5 : (p.anno - annoMin) / (annoMax - annoMin)
        const raggio = raggioMax * (STILE.anello_raggio_interno + t * (STILE.anello_raggio_esterno - STILE.anello_raggio_interno))

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
          imgSrc: `${import.meta.env.BASE_URL}immagini/${p.foto}`, dati: p,
          orbitaX, orbitaY, timelineX, timelineY,
        })
        graph.addEdge(designer, prodottoId, {
          color: STILE.edge_prodotto_colore,
          size: STILE.edge_prodotto_size, tipo: "prodotto"
        })
        animated[prodottoId] = { r: STILE.zoom_prodotto_min, alpha: 1 }
      })
    })

    const multiPerGruppo = {}
    prodottiMultiDesigner.forEach((p) => {
      const key = getDesigners(p).sort().join("|")
      if (!multiPerGruppo[key]) multiPerGruppo[key] = []
      multiPerGruppo[key].push(p)
    })

    const gruppiCollettivi = []

    Object.entries(multiPerGruppo).forEach(([key, lista]) => {
      const ds = key.split("|").filter((d) => graph.hasNode(d))
      if (ds.length === 0) return
      const coords = ds.map((d) => ({ x: graph.getNodeAttribute(d, "x"), y: graph.getNodeAttribute(d, "y") }))
      let centroX = coords.reduce((s, c) => s + c.x, 0) / coords.length
      let centroY = coords.reduce((s, c) => s + c.y, 0) / coords.length
      const n = lista.length
      const raggioShift = calcolaRaggio(n) * STILE.anello_raggio_esterno + 1
      if (ds.length === 2) {
        const dx = coords[1].x - coords[0].x
        const dy = coords[1].y - coords[0].y
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        centroX += (-dy / len) * raggioShift
        centroY += (dx / len) * raggioShift
      } else if (ds.length > 2) {
        centroX -= raggioShift
      }

      const dsData = ds.map((nome) => designers.find((d) => d.nome === nome)).filter(Boolean)
      const collettiviComuni = dsData.length > 0 && dsData[0].collettivi
        ? dsData[0].collettivi.filter((c) => dsData.every((d) => d.collettivi && d.collettivi.includes(c)))
        : []
      const nomeGruppo = collettiviComuni[0] || null
      const gruppoNodi = []

      const raggioMax = calcolaRaggio(n)
      const listaOrdinata = [...lista].sort((a, b) => (a.anno || 0) - (b.anno || 0))
      const annoMin = listaOrdinata[0]?.anno || 1900
      const annoMax = listaOrdinata[listaOrdinata.length - 1]?.anno || 1980

      const settoriM = calcolaSettoriDinamici(listaOrdinata, true)

      listaOrdinata.forEach((p, i) => {
        const macro = getMacro(p.categoria)
        const sett = settoriM[macro]
        const idxInSettore = sett.prodotti.findIndex((g) => g.i === i)
        const nInSettore = sett.prodotti.length
        const sliceAngolo = (sett.fine - sett.inizio) / Math.max(1, nInSettore)
        const angolo = sett.inizio + sliceAngolo * idxInSettore + sliceAngolo * 0.5 + (hashStr(p.nome) - 0.5) * sliceAngolo * STILE.arco_perturbazione

        const t = annoMax === annoMin ? 0.5 : (p.anno - annoMin) / (annoMax - annoMin)
        const raggio = raggioMax * (STILE.anello_raggio_interno + t * (STILE.anello_raggio_esterno - STILE.anello_raggio_interno))

        const prodottoId = `prodotto:multi:${p.nome}:${i}`
        const orbitaX = centroX + Math.cos(angolo) * raggio
        const orbitaY = centroY + Math.sin(angolo) * raggio
        const timelineX = annoToX(p.anno || 1900)
        const timelineY = centroY

        graph.addNode(prodottoId, {
          label: p.nome, size: STILE.prodotto_size,
          x: orbitaX, y: orbitaY,
          color: STILE.prodotto_colore, tipo: "prodotto", multi: true,
          imgSrc: `${import.meta.env.BASE_URL}immagini/${p.foto}`, dati: p,
          orbitaX, orbitaY, timelineX, timelineY,
        })
        ds.forEach((d) => {
          graph.addEdge(d, prodottoId, {
            color: STILE.edge_prodotto_colore,
            size: STILE.edge_prodotto_size, tipo: "prodotto"
          })
        })
        animated[prodottoId] = { r: STILE.zoom_prodotto_min, alpha: 1 }
        if (nomeGruppo) gruppoNodi.push(prodottoId)
      })
      if (nomeGruppo && gruppoNodi.length > 0) {
        gruppiCollettivi.push({ nome: nomeGruppo, nodi: gruppoNodi })
      }
    })

    const renderer = new Sigma(graph, container, {
      renderEdgeLabels: false,
      maxCameraRatio: MAX_CAMERA_RATIO,
      minCameraRatio: MIN_CAMERA_RATIO,
      zoomingRatio: 1.7,
      zoomDuration: 150,
      inertiaDuration: 5,
      inertiaRatio: 0.2,  
      enableCameraRotation: false,
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
      overlayCanvas.width = Math.max(1, Math.round(rect.width * dpr))
      overlayCanvas.height = Math.max(1, Math.round(rect.height * dpr))
      viewportMin = Math.min(rect.width, rect.height)
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

    function zoomT() {
      const ratio = Math.max(MIN_CAMERA_RATIO, Math.min(MAX_CAMERA_RATIO, cameraRatio))
      const logMax = Math.log(MAX_CAMERA_RATIO)
      const logMin = Math.log(MIN_CAMERA_RATIO)
      return (logMax - Math.log(ratio)) / (logMax - logMin)
    }

    function vScale() {
      return Math.max(0.5, viewportMin / STILE.zoom_viewport_ref)
    }

    function calcolaRTarget(node, attr, nodoAttivo) {
      const t = zoomT()
      const vs = vScale()
      if (attr.tipo === "designer") {
        const tCurved = Math.pow(t, 1.2)
        const base = lerp(STILE.zoom_designer_min, STILE.zoom_designer_max, tCurved) * vs
        return node === nodoAttivo ? base * STILE.hover_scala : base
      }
      if (attr.tipo === "prodotto") {
        const tDelayed = Math.max(0, (t - 0.2) / 0.8)
        const base = lerp(STILE.zoom_prodotto_min, STILE.zoom_prodotto_max, tDelayed * tDelayed) * vs
        if (node === prodottoCliccato) return base * 1.2
        if (node === prodottoHoverAttivo) return base * STILE.hover_scala
        return base
      }
      return lerp(STILE.zoom_prodotto_min, STILE.zoom_prodotto_max, Math.pow(t, 1.2)) * vs
    }

    function disegnaTutto() {
      const ctx = overlayCanvas.getContext("2d")
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const w = overlayCanvas.width / dpr
      const h = overlayCanvas.height / dpr

      const t = zoomT()
      const vs = vScale()
      const labelDesignerSize = Math.max(STILE.label_min, lerp(STILE.zoom_label_designer_min, STILE.zoom_label_designer_max, Math.pow(t, 1.2)) * vs)
      const tLabel = Math.max(0, (t - STILE.zoom_label_soglia) / (1 - STILE.zoom_label_soglia))
      const mostraLabelProdotti = t > STILE.zoom_label_soglia
      const labelProdottoSize = mostraLabelProdotti ? Math.max(STILE.label_min, STILE.zoom_label_prodotto_max * tLabel * vs) : 0
      const nodoAttivo = designerCliccato || nodoHoverAttivo
      const collegati = nodiCollegatiAlHover(nodoAttivo)
      const hoverAttivo = nodoAttivo !== null

      const grigliaRaggio = lerp(STILE.zoom_griglia_min, STILE.zoom_griglia_max, t)
      const yGrafoMin = Math.min(Y_MIN, contenutoYMin) - MARGINE_Y
      const yGrafoMax = Math.max(Y_MAX, contenutoYMax) + MARGINE_Y
      const ogniN = t < 0.3 ? 2 : 1
      const grigliaRaggioEffettivo = t < 0.3 ? grigliaRaggio * 0.7 : grigliaRaggio
      ANNI_SINGOLI.forEach((anno, ai) => {
        if (ogniN > 1 && ai % ogniN !== 0) return
        const gx = annoToX(anno)
        for (let gy = Math.ceil(yGrafoMin); gy <= Math.floor(yGrafoMax); gy++) {
          if (ogniN > 1 && ((gy + ai) % 2 !== 0)) continue
          const screen = renderer.graphToViewport({ x: gx, y: gy })
          if (screen.x < -2 || screen.x > w + 2 || screen.y < -2 || screen.y > h + 2) continue
          ctx.beginPath()
          ctx.arc(screen.x, screen.y, grigliaRaggioEffettivo, 0, Math.PI * 2)
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

      if (vistaInterna === "timeline") {
        graph.forEachNode((node, attr) => {
          if (attr.tipo !== "designer") return
          const dati = attr.dati
          const morto = dati.morto || 2025
          if (!animated[node]) animated[node] = { r: STILE.zoom_designer_min, alpha: 1 }
          animated[node].vita = lerp(animated[node].vita ?? 0, 1, STILE.lerp_velocita * 0.7)
          const vitaT = animated[node].vita
          const nascitaX = annoToX(dati.nato)
          const vitaEndX = nascitaX + (annoToX(morto) - nascitaX) * vitaT
          const posNascita = renderer.graphToViewport({ x: nascitaX, y: attr.y })
          const posMorte = renderer.graphToViewport({ x: vitaEndX, y: attr.y })
          const r = (animated[node]?.r ?? STILE.zoom_designer_min) * 0.8
          ctx.globalAlpha = 0.06 * vitaT
          ctx.fillStyle = "#000000"
          ctx.beginPath()
          ctx.moveTo(posNascita.x, posNascita.y - r)
          ctx.lineTo(posMorte.x, posMorte.y - r)
          ctx.arc(posMorte.x, posMorte.y, r, -Math.PI / 2, Math.PI / 2)
          ctx.lineTo(posNascita.x, posNascita.y + r)
          ctx.arc(posNascita.x, posNascita.y, r, Math.PI / 2, -Math.PI / 2)
          ctx.closePath()
          ctx.fill()
          ctx.globalAlpha = 1
        })
      } else {
        graph.forEachNode((node, attr) => {
          if (attr.tipo !== "designer" || !animated[node]) return
          if (animated[node].vita > 0.01) {
            animated[node].vita = lerp(animated[node].vita, 0, STILE.lerp_velocita * 0.7)
            const dati = attr.dati
            const morto = dati.morto || 2025
            const vitaT = animated[node].vita
            const nascitaX = annoToX(dati.nato)
            const vitaEndX = nascitaX + (annoToX(morto) - nascitaX) * vitaT
            const posNascita = renderer.graphToViewport({ x: nascitaX, y: attr.y })
            const posMorte = renderer.graphToViewport({ x: vitaEndX, y: attr.y })
            const r = (animated[node]?.r ?? STILE.zoom_designer_min) * 0.8
            ctx.globalAlpha = 0.06 * vitaT
            ctx.fillStyle = "#000000"
            ctx.beginPath()
            ctx.moveTo(posNascita.x, posNascita.y - r)
            ctx.lineTo(posMorte.x, posMorte.y - r)
            ctx.arc(posMorte.x, posMorte.y, r, -Math.PI / 2, Math.PI / 2)
            ctx.lineTo(posNascita.x, posNascita.y + r)
            ctx.arc(posNascita.x, posNascita.y, r, Math.PI / 2, -Math.PI / 2)
            ctx.closePath()
            ctx.fill()
            ctx.globalAlpha = 1
          }
        })
      }

      gruppiCollettivi.forEach(({ nome, nodi }) => {
        const punti = nodi
          .filter((n) => graph.hasNode(n))
          .map((n) => {
            const a = graph.getNodeAttributes(n)
            const p = renderer.graphToViewport({ x: a.x, y: a.y })
            const r = animated[n]?.r ?? STILE.zoom_prodotto_min
            return { x: p.x, y: p.y, r }
          })
        if (punti.length < 2) return

        const cx = punti.reduce((s, p) => s + p.x, 0) / punti.length
        const cy = punti.reduce((s, p) => s + p.y, 0) / punti.length
        const pad = 20

        const angolati = punti.map((p) => ({
          ...p,
          angolo: Math.atan2(p.y - cy, p.x - cx),
        }))
        angolati.sort((a, b) => a.angolo - b.angolo)

        const espansi = angolati.map((p) => {
          const dx = p.x - cx, dy = p.y - cy
          const dist = Math.sqrt(dx * dx + dy * dy)
          const scala = (dist + p.r + pad) / Math.max(dist, 0.01)
          return { x: cx + dx * scala, y: cy + dy * scala }
        })

        ctx.globalAlpha = 0.4
        ctx.beginPath()
        const primo = espansi[0]
        const ultimo = espansi[espansi.length - 1]
        ctx.moveTo((ultimo.x + primo.x) / 2, (ultimo.y + primo.y) / 2)
        for (let i = 0; i < espansi.length; i++) {
          const curr = espansi[i]
          const next = espansi[(i + 1) % espansi.length]
          ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2)
        }
        ctx.closePath()
        ctx.strokeStyle = "#222222"
        ctx.lineWidth = 0.5
        ctx.stroke()

        const sinistraX = Math.min(...espansi.map((p) => p.x)) - 8
        ctx.font = "300 10px Roboto"
        ctx.fillStyle = "#aaaaaa"
        ctx.textAlign = "right"
        ctx.fillText(nome, sinistraX, cy + 3)
        ctx.globalAlpha = 1
      })

      graph.forEachNode((node, attr) => {
        if (!animated[node]) animated[node] = { r: STILE.zoom_prodotto_min, alpha: 1 }
        const rTarget = calcolaRTarget(node, attr, nodoAttivo)
        let alphaTarget = 1
        const azFiltro = aziendaAttivaRef.current
        if (azFiltro) {
          if (attr.tipo === "prodotto") {
            alphaTarget = attr.dati && attr.dati.azienda === azFiltro ? 1 : 0.1
          } else if (attr.tipo === "designer") {
            alphaTarget = 1
          }
        } else if (vistaInterna === "timeline" && annoBloccato) {
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
          const prodottoNode = graph.getNodeAttribute(source, "tipo") === "prodotto" ? source : target
          const nDesigners = graph.neighbors(prodottoNode).filter(n => graph.getNodeAttribute(n, "tipo") === "designer").length
          if (vistaInterna === "timeline" && nDesigners > 1) {
            const midX = (posS.x + posT.x) / 2
            ctx.bezierCurveTo(midX, posS.y, midX, posT.y, posT.x, posT.y)
          } else {
            ctx.lineTo(posT.x, posT.y)
          }
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
      const prodottoInPrimoPiano = prodottoCliccato || prodottoHoverAttivo
      const nodiFiltrati = prodottoInPrimoPiano
        ? [...nodiDesigner, ...nodiProdotti]
        : [...nodiProdotti, ...nodiDesigner]

      nodiFiltrati.forEach(({ node, attr }) => {
        const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
        const r = animated[node]?.r ?? STILE.zoom_prodotto_min
        const alpha = animated[node]?.alpha ?? 1

        ctx.globalAlpha = alpha
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
        ctx.fillStyle = attr.tipo === "designer" ? STILE.designer_colore : "#ffffff"
        ctx.fill()
        ctx.save()
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
        ctx.clip()
        const img = imgCache[attr.imgSrc]
        if (img && img.complete && img.naturalWidth > 0) {
          const iw = img.naturalWidth, ih = img.naturalHeight
          const scale = Math.max(r * 2 / iw, r * 2 / ih)
          const sw = iw * scale, sh = ih * scale
          ctx.drawImage(img, pos.x - sw / 2, pos.y - sh / 2, sw, sh)
        } else {
          ctx.fillStyle = "#ffffff"
          ctx.fill()
        }
        ctx.restore()

        if (attr.tipo === "prodotto") {
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
          ctx.strokeStyle = "#ffffff"
          ctx.lineWidth = 3
          ctx.stroke()
        }
        if (attr.tipo === "designer") {
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
          ctx.strokeStyle = "#000000"
          ctx.lineWidth = 2
          ctx.stroke()
        }

        if (attr.tipo === "designer") {
          const parti = attr.label.split(" ")
          const cognome = parti.pop()
          const nome = parti.join(" ")
          const lx = pos.x + r + STILE.label_offset
          const altezzaBlocco = labelDesignerSize * 2 + 5 + (labelDesignerSize - 1)
          const lyStart = pos.y - altezzaBlocco / 2 + labelDesignerSize

          const date = attr.dati.morto ? `${attr.dati.nato} — ${attr.dati.morto}` : `${attr.dati.nato}`
          const pad = 3
          const bgColor = STILE.label_sfondo_colore || STILE.sfondo_colore

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
            ctx.fillText(attr.dati.anno_label || attr.dati.anno, pos.x + r + STILE.label_offset, pos.y + labelProdottoSize / 3 + labelProdottoSize + 1)
          }
        }
        ctx.globalAlpha = 1
      })

      if (mouseNelCanvas) {
        mouseTrailX = lerp(mouseTrailX, mouseX, STILE.cursore_alone_velocita)
        mouseTrailY = lerp(mouseTrailY, mouseY, STILE.cursore_alone_velocita)
        const suElemento = !!(prodottoHoverAttivo || nodoHoverAttivo)
        if (suElemento) {
          ctx.globalAlpha = 0.35
          ctx.beginPath()
          ctx.arc(mouseTrailX, mouseTrailY, STILE.cursore_alone_raggio, 0, Math.PI * 2)
          ctx.fillStyle = STILE.cursore_alone_colore
          ctx.fill()
          ctx.globalAlpha = 1
        } else {
          ctx.beginPath()
          ctx.arc(mouseTrailX, mouseTrailY, STILE.cursore_alone_raggio, 0, Math.PI * 2)
          ctx.strokeStyle = STILE.cursore_alone_colore
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(mouseX, mouseY, STILE.cursore_raggio, 0, Math.PI * 2)
          ctx.fillStyle = STILE.cursore_colore
          ctx.fill()
        }
      }
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
      if (!clamping) {
        const r = state.ratio
        const xLo = Math.min(0.5, r / 2)
        const xHi = Math.max(0.5, 1 - r / 2)
        const yLo = Math.min(0.5, r / 2)
        const yHi = Math.max(0.5, 1 - r / 2)
        const cx = Math.max(xLo, Math.min(xHi, state.x))
        const cy = Math.max(yLo, Math.min(yHi, state.y))
        if (Math.abs(cx - state.x) > 0.001 || Math.abs(cy - state.y) > 0.001) {
          clamping = true
          camera.setState({ x: cx, y: cy })
          clamping = false
        }
      }

      if (isMobile) {
        const zoomOut = state.ratio > MAX_CAMERA_RATIO * 0.85
        if (zoomOut && haInteragitoRef.current) { haInteragitoRef.current = false; setHaInteragito(false) }
        else if (!zoomOut && !haInteragitoRef.current) { haInteragitoRef.current = true; setHaInteragito(true) }
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
    renderer.refresh()

    let cameraImpostata = false
    try {
      const saved = JSON.parse(localStorage.getItem("dn-camera"))
      if (saved) { camera.setState({ x: saved.x, y: saved.y, ratio: saved.ratio }); cameraImpostata = true }
    } catch {}

    if (!cameraImpostata) {
      const bboxX = [X_MIN - MARGINE_X, X_MAX + MARGINE_X]
      const bboxY = [Math.min(Y_MIN, contenutoYMin) - MARGINE_Y, Math.max(Y_MAX, contenutoYMax) + MARGINE_Y]
      if (graph.hasNode("Achille Castiglioni")) {
        const cAttr = graph.getNodeAttributes("Achille Castiglioni")
        const cx = (cAttr.x - bboxX[0]) / (bboxX[1] - bboxX[0])
        const cy = (cAttr.y - bboxY[0]) / (bboxY[1] - bboxY[0])
        camera.setState({ ratio: 0.25, x: cx + 0.05, y: cy })
      }
    }
    graph.forEachNode((node, attr) => {
      if (!animated[node]) return
      const nodoAttivo = null
      animated[node].r = calcolaRTarget(node, attr, nodoAttivo)
    })
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
    setRidisegnaFn(() => () => richiediDisegnoOverlay(18))

    const sigmaCanvas = container
    if (sigmaCanvas) {
      sigmaCanvas.addEventListener("mouseenter", () => { mouseNelCanvas = true })
      sigmaCanvas.addEventListener("mouseleave", () => { mouseNelCanvas = false; richiediDisegnoOverlay(18) })

      sigmaCanvas.addEventListener("mousedown", (e) => {
        mouseDownPos = { x: e.clientX, y: e.clientY }
        isDragging = false
        if (isMobile && !haInteragitoRef.current) { haInteragitoRef.current = true; setHaInteragito(true) }
      })
      sigmaCanvas.addEventListener("wheel", () => {
        if (isMobile && !haInteragitoRef.current) { haInteragitoRef.current = true; setHaInteragito(true) }
      }, { passive: true })

      sigmaCanvas.addEventListener("mousemove", (e) => {
        if (mouseDownPos) {
          const dx = Math.abs(e.clientX - mouseDownPos.x)
          const dy = Math.abs(e.clientY - mouseDownPos.y)
          if (dx > 4 || dy > 4) isDragging = true
        }

        const rect = sigmaCanvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        mouseX = mx; mouseY = my
        if (!mouseNelCanvas) { mouseTrailX = mx; mouseTrailY = my; mouseNelCanvas = true }
        richiediDisegnoOverlay(18)

        let prodottoHover = null
        if (zoomT() > STILE.zoom_label_soglia - 0.1 || vistaInterna === "timeline") {
          graph.forEachNode((node, attr) => {
            if (attr.tipo !== "prodotto") return
            const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
            const r = animated[node]?.r ?? STILE.zoom_prodotto_min
            if (Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2) < r) prodottoHover = node
          })
          if (prodottoHover !== prodottoHoverAttivo) { prodottoHoverAttivo = prodottoHover; if (prodottoHover) ultimoProdottoHover = prodottoHover; richiediDisegnoOverlay(18) }
        } else if (prodottoHoverAttivo !== null) { prodottoHoverAttivo = null; richiediDisegnoOverlay(18) }

        if (!designerCliccato) {
          let nodoHover = null
          if (!prodottoHoverAttivo) {
            graph.forEachNode((node, attr) => {
              if (attr.tipo !== "designer") return
              const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
              const r = animated[node]?.r ?? STILE.zoom_designer_min
              if (Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2) < r) nodoHover = node
            })
          }
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
            if (Math.sqrt(px * px + py * py) < 10) {
              const d = attr.dati
              const dOrd = designerCliccato === d.designer_b ? { ...d, designer_a: d.designer_b, designer_b: d.designer_a } : d
              relazioneHover = { dati: dOrd, x: e.clientX, y: e.clientY }
            }
          })
          setTooltipRelazione(relazioneHover)
        } else {
          setTooltipRelazione(null)
        }
      })

      sigmaCanvas.addEventListener("mouseup", (e) => {
        if (isDragging) { mouseDownPos = null; isDragging = false; richiediDisegnoOverlay(3); return }
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
            if (Math.sqrt(px * px + py * py) < 8) {
              const d = attr.dati
              relazioneCliccata = designerCliccato === d.designer_b ? { ...d, designer_a: d.designer_b, designer_b: d.designer_a } : d
            }
          })
        }
        if (relazioneCliccata) { setPopup({ tipo: "relazione", dati: relazioneCliccata, colore: "#888888" }); return }

        let trovato = null
        graph.forEachNode((node, attr) => {
          const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
          const r = animated[node]?.r ?? (attr.tipo === "designer" ? STILE.zoom_designer_min : STILE.zoom_prodotto_min)
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
              setPannelloDesigner({ ...trovato.attr.dati, _tipo: "designer" }); setBioEspansa(false); setAziendaAttiva(null)
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
            setPannelloDesigner({ ...trovato.attr.dati, _tipo: "prodotto" })
            requestAnimationFrame(() => setPannelloVisibile(true))
            richiediDisegnoOverlay(18)
          }
        } else {
          const avevaPannello = designerCliccato !== null
          designerCliccato = null; prodottoCliccato = null
          annoBloccato = null
          setDesignerAttivo(null)
          if (isMobile && aziendaAttivaRef.current && avevaPannello) {
            setPannelloVisibile(false)
            setTimeout(() => setPannelloDesigner(null), 350)
          } else if (isMobile && aziendaAttivaRef.current) {
            aziendaAttivaRef.current = null; setAziendaAttiva(null)
            richiediDisegnoOverlay(18)
          } else {
            setPannelloVisibile(false)
            setTimeout(() => setPannelloDesigner(null), 350)
            aziendaAttivaRef.current = null; setAziendaAttiva(null)
          }
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

  function toggleAzienda(az) {
    const nuova = aziendaAttiva === az ? null : az
    setAziendaAttiva(nuova)
    aziendaAttivaRef.current = nuova
    if (ridisegnaFn) ridisegnaFn()
  }

  function cambiaVista(vista) {
    if (vista === vistaCorrente) return
    setVistaCorrente(vista)
    if (animaTransizioneFn) animaTransizioneFn(vista)
  }

  const uiScale = 0.6 + (window.innerWidth / 1440) * 0.4

  return (
    <>
      <div style={{
        position: "fixed", zIndex: 20, pointerEvents: "none", boxSizing: "border-box",
        ...(window.innerWidth < 768
          ? { top: 0, left: 0, right: 0, padding: "16px 20px", background: STILE.sfondo_colore }
          : { top: 0, left: 0, bottom: 0, width: 240 * uiScale, padding: `${20 * uiScale}px ${16 * uiScale}px`, display: "flex", flexDirection: "column", justifyContent: "flex-end" })
      }}>
        <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", fontSize: 13 * uiScale, color: "#1a1a1a", letterSpacing: 0.3, lineHeight: 1.3 }}>
          Design — encyclopédie visuelle 1880–1980
        </div>
        <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 400, fontStyle: "italic", fontSize: 13 * uiScale, color: "#1a1a1a", marginTop: 6 * uiScale, lineHeight: 1.3 }}>
          Un secolo di oggetti, forme e idee.
        </div>
        <div style={{
          display: "flex", flexDirection: "column", gap: 8 * uiScale, marginTop: 10 * uiScale,
          opacity: (haInteragito && window.innerWidth < 768) ? 0 : 1, maxHeight: (haInteragito && window.innerWidth < 768) ? 0 : 300,
          overflow: "hidden", transition: "opacity 0.6s ease, max-height 0.6s ease",
        }}>
          <p style={{ fontFamily: "Roboto, sans-serif", fontWeight: 300, fontSize: 11 * uiScale, color: "#888", lineHeight: 1.35, margin: 0 }}>
            Questa mappa rappresenta un secolo di design occidentale — i suoi protagonisti, le loro opere e i legami invisibili che li uniscono. Ogni nodo è un designer o un oggetto; ogni connessione, una relazione di collaborazione, influenza o formazione.
          </p>
          <p style={{ fontFamily: "Roboto, sans-serif", fontWeight: 300, fontSize: 11 * uiScale, color: "#888", lineHeight: 1.35, margin: 0 }}>
            La posizione orizzontale segue una cronologia rigorosa, dal 1880 al 1980. Esplorando la mappa si scoprono le grandi concentrazioni del movimento moderno, le filiazioni tra maestri e allievi, e le convergenze tra discipline e nazionalità.
          </p>
        </div>
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

      {pannelloDesigner && (() => {
        const scuro = pannelloDesigner._tipo === "designer"
        const designerProdotto = pannelloDesigner._tipo === "prodotto"
          ? getDesigners(pannelloDesigner).join(", ")
          : ""
        return (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 340 * uiScale,
          background: scuro ? "#1a1a1a" : "#ffffff",
          boxShadow: `-4px 0 32px rgba(0,0,0,${scuro ? 0.3 : 0.12})`,
          fontFamily: "Roboto, sans-serif", zIndex: 100,
          transform: pannelloVisibile ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ padding: "32px 28px 0", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", fontSize: 20, color: scuro ? "#ffffff" : "#1a1a1a", lineHeight: 1.2 }}>
                  {pannelloDesigner.nome}
                </div>
                <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 400, fontStyle: "italic", fontSize: 14, color: "#888", marginTop: 4 }}>
                  {pannelloDesigner._tipo === "designer"
                    ? `${pannelloDesigner.nato}${pannelloDesigner.morto ? ` — ${pannelloDesigner.morto}` : ""}`
                    : `${pannelloDesigner.anno || ""}${designerProdotto ? ` — ${designerProdotto}` : ""}`
                  }
                </div>
              </div>
              <button onClick={() => { setPannelloVisibile(false); setTimeout(() => setPannelloDesigner(null), 350) }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: scuro ? "#666" : "#aaa", padding: "0 4px", lineHeight: 1 }}>
                &times;
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px 32px" }}>
            <div style={{
              width: "100%", aspectRatio: "1", overflow: "hidden",
              background: scuro ? "#2a2a2a" : "#f5f5f5", marginBottom: 24,
            }}>
              <img src={`${import.meta.env.BASE_URL}immagini/${pannelloDesigner.foto}`} alt={pannelloDesigner.nome}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onError={(e) => { e.target.style.display = "none" }} />
            </div>

            {pannelloDesigner._tipo === "designer" && pannelloDesigner.bio && (
              <div style={{ marginBottom: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 600, color: scuro ? "#555" : "#aaa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>Biografia</div>
                <p style={{
                  fontSize: 13, fontWeight: 300, color: scuro ? "#999" : "#666", lineHeight: 1.6, margin: 0,
                  maxHeight: bioEspansa ? "none" : "4.8em", overflow: "hidden",
                }}>
                  {pannelloDesigner.bio}
                </p>
                {pannelloDesigner.bio.length > 150 && (
                  <button onClick={() => setBioEspansa(!bioEspansa)} style={{
                    background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 6,
                    fontSize: 11, fontWeight: 400, color: scuro ? "#666" : "#aaa", fontFamily: "Roboto, sans-serif",
                  }}>
                    {bioEspansa ? "— Riduci" : "+ Leggi tutto"}
                  </button>
                )}
              </div>
            )}

            {pannelloDesigner._tipo === "designer" && (() => {
              const aziende = [...new Set(prodotti.filter(p => {
                const ds = getDesigners(p)
                return ds.includes(pannelloDesigner.nome)
              }).map(p => p.azienda).filter(Boolean))]
              if (aziende.length === 0) return null
              return (
                <div>
                  <hr style={{ border: "none", borderTop: `1px solid ${scuro ? "#333" : "#eee"}`, margin: "20px 0" }} />
                  <div style={{ fontSize: 9, fontWeight: 600, color: scuro ? "#555" : "#aaa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>Aziende</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {aziende.map((az) => {
                      const attiva = aziendaAttiva === az
                      return (
                        <button key={az} onClick={() => toggleAzienda(az)} style={{
                          fontSize: 11, fontWeight: attiva ? 600 : 400,
                          color: attiva ? "#fff" : (scuro ? "#888" : "#555"),
                          background: attiva ? "#ff6b2b" : "transparent",
                          border: `1px solid ${attiva ? "#ff6b2b" : (scuro ? "#333" : "#ddd")}`,
                          borderRadius: 20, padding: "4px 12px",
                          fontFamily: "Roboto, sans-serif", cursor: "pointer",
                          transition: "all 0.2s",
                        }}>{az}</button>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {pannelloDesigner._tipo === "prodotto" && (
              <div style={{ fontSize: 13, fontWeight: 300, color: "#555", lineHeight: 1.6 }}>
                {pannelloDesigner.azienda && <p style={{ margin: "0 0 8px" }}>{pannelloDesigner.azienda}</p>}
                {pannelloDesigner.categoria && <p style={{ margin: 0, color: "#888", fontStyle: "italic" }}>{pannelloDesigner.categoria}</p>}
              </div>
            )}
          </div>
        </div>
        )
      })()}

      {popup && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 340 * uiScale,
          background: "#1a1a1a", boxShadow: "-4px 0 32px rgba(0,0,0,0.3)",
          fontFamily: "Roboto, sans-serif", zIndex: 100,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ padding: "32px 28px 0", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", fontSize: 20, color: "#ffffff", lineHeight: 1.2 }}>
                  {popup.dati.designer_a} — {popup.dati.designer_b}
                </div>
                <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 400, fontStyle: "italic", fontSize: 13, color: "#888", marginTop: 4 }}>
                  {popup.dati.tipo}
                </div>
              </div>
              <button onClick={() => setPopup(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#666", padding: "0 4px", lineHeight: 1 }}>
                &times;
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px 32px" }}>
            <p style={{ fontSize: 13, fontWeight: 300, color: "#999", lineHeight: 1.6, margin: 0 }}>
              {popup.dati.descrizione}
            </p>
          </div>
        </div>
      )}
    </>
  )
}

export default App
