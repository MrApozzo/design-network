import { useEffect, useState } from "react"
import Graph from "graphology"
import Sigma from "sigma"
import designers from "./data/designers.json"
import prodotti from "./data/prodotti.json"
import relazioni from "./data/relazioni.json"

// ═══════════════════════════════════════════════
// CONFIGURAZIONE VISIVA — modifica qui
// ═══════════════════════════════════════════════

const STILE = {
  designer_size: 8,
  prodotto_size: 5,
  bordo_colore: "#222222",
  bordo_spessore: 0.5,
  designer_colore: "#090e54",
  prodotto_colore: "#cccccc",
  label_base: 6,
  label_min: 3,
  label_offset: 10,
  label_designer_peso: "600",
  label_date_peso: "300",
  label_prodotto_peso: "300",
  label_designer_colore: "#222222",
  label_date_colore: "#999999",
  label_prodotto_colore: "#555555",
  edge_prodotto_colore: "#dddddd",
  edge_prodotto_size: 1,
  edge_relazione_colore: "#888888",
  edge_relazione_size: 1.5,
  griglia_colore: "#e0e0e0",
  griglia_label_colore: "#aaaaaa",
  prodotto_raggio: 0.5,
  diagonale_inclinazione: 0.4,
  min_distanza_y: 0.6,
  // Hover
  hover_scala: 1.4,
  hover_opacita_altri: 0.2,
}

const ANNO_MIN = 1900
const ANNO_MAX = 2000
const X_MIN = -10
const X_MAX = 10
const DECENNI = [1900,1910,1920,1930,1940,1950,1960,1970,1980,1990,2000]
const FASCE = [
  { label: "A", y: 4 },
  { label: "B", y: 2 },
  { label: "C", y: 0 },
  { label: "D", y: -2 },
  { label: "E", y: -4 },
]
const MARGINE_X = 2
const MARGINE_Y = 1.5
const FASCE_Y_MAX = Math.max(...FASCE.map((f) => f.y))
const FASCE_Y_MIN = Math.min(...FASCE.map((f) => f.y))
const MAX_CAMERA_RATIO = 1.5
const ZOOM_SOGLIA_PRODOTTI = 0.5

function annoToX(anno) {
  return X_MIN + ((anno - ANNO_MIN) / (ANNO_MAX - ANNO_MIN)) * (X_MAX - X_MIN)
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

  useEffect(() => {
    const graph = new Graph()
    let cameraRatio = 1
    let nodoHoverAttivo = null

    const imgPaths = [
      ...designers.map((d) => `/immagini/${d.foto}`),
      ...prodotti.map((p) => `/immagini/${p.foto}`),
    ]
    const imgCache = preloadImages(imgPaths)

    const designerOrdinati = [...designers].sort((a, b) => a.nato - b.nato)

    const posizioniCalcolate = designerOrdinati.map((d) => {
      const x = annoToX(d.nato)
      const yDiagonale = -(x * STILE.diagonale_inclinazione)
      return {
        d,
        x,
        y: d.y !== null && d.y !== undefined ? d.y : yDiagonale,
        manuale: d.y !== null && d.y !== undefined,
      }
    })

    let offsetCumulativo = 0
    for (let i = 1; i < posizioniCalcolate.length; i++) {
      const prev = posizioniCalcolate[i - 1]
      const curr = posizioniCalcolate[i]
      if (!curr.manuale) curr.y -= offsetCumulativo
      const distX = Math.abs(curr.x - prev.x)
      const distY = Math.abs(curr.y - prev.y)
      if (distX < 2.5 && distY < STILE.min_distanza_y) {
        const delta = STILE.min_distanza_y - distY
        if (!curr.manuale) {
          curr.y -= delta
          offsetCumulativo += delta
        }
      }
    }

    posizioniCalcolate.forEach(({ d, x, y }) => {
      graph.addNode(d.nome, {
        label: d.nome,
        size: STILE.designer_size,
        x,
        y,
        color: STILE.designer_colore,
        tipo: "designer",
        imgSrc: `/immagini/${d.foto}`,
        dati: d,
      })
    })

    relazioni.forEach((r) => {
      if (graph.hasNode(r.designer_a) && graph.hasNode(r.designer_b)) {
        if (!graph.hasEdge(r.designer_a, r.designer_b) && !graph.hasEdge(r.designer_b, r.designer_a)) {
          graph.addEdge(r.designer_a, r.designer_b, {
            color: "rgba(0,0,0,0)",
            size: 0,
            tipo: "relazione",
            attivo: false,
          })
        }
      }
    })

    const prodottiPerDesigner = {}
    prodotti.forEach((p) => {
      if (!prodottiPerDesigner[p.designer]) prodottiPerDesigner[p.designer] = []
      prodottiPerDesigner[p.designer].push(p)
    })

    Object.entries(prodottiPerDesigner).forEach(([designer, lista]) => {
      if (!graph.hasNode(designer)) return
      const dx = graph.getNodeAttribute(designer, "x")
      const dy = graph.getNodeAttribute(designer, "y")
      const n = lista.length

      lista.forEach((p, i) => {
        const angolo = (Math.PI / (n + 1)) * (i + 1) + Math.PI / 2
        const ox = Math.cos(angolo) * STILE.prodotto_raggio
        const oy = Math.sin(angolo) * STILE.prodotto_raggio
        graph.addNode(p.nome, {
          label: p.nome,
          size: STILE.prodotto_size,
          x: dx + ox,
          y: dy + oy,
          color: STILE.prodotto_colore,
          tipo: "prodotto",
          imgSrc: `/immagini/${p.foto}`,
          dati: p,
          hideLabel: true
        })
        graph.addEdge(designer, p.nome, {
          color: STILE.edge_prodotto_colore,
          size: STILE.edge_prodotto_size,
          tipo: "prodotto"
        })
      })
    })

    const renderer = new Sigma(graph, document.getElementById("container"), {
      renderEdgeLabels: false,
      maxCameraRatio: MAX_CAMERA_RATIO,
      // Disabilita hover nativo di Sigma
      nodeReducer: (node, data) => ({ 
      ...data, 
      hidden: false,
      label: "",
      highlighted: false,
      color: "rgba(0,0,0,0)",
      borderColor: "rgba(0,0,0,0)",
      size: 0.001,
    }),

      labelRenderer: () => {},
      hoverRenderer: () => {}, // disabilita il tooltip hover di Sigma
    })

    renderer.setCustomBBox({
      x: [X_MIN - MARGINE_X, X_MAX + MARGINE_X],
      y: [FASCE_Y_MIN - MARGINE_Y, FASCE_Y_MAX + MARGINE_Y],
    })
    renderer.refresh()
    cameraRatio = renderer.getCamera().ratio

    const container = document.getElementById("container")
    container.style.position = "relative"

    const nodoCanvas = document.createElement("canvas")
    nodoCanvas.id = "nodo-layer"
    nodoCanvas.width = container.offsetWidth
    nodoCanvas.height = container.offsetHeight
    nodoCanvas.style.cssText = `
      position: absolute; top: 0; left: 0;
      pointer-events: none; z-index: 2;
    `
    container.appendChild(nodoCanvas)

    const gCanvas = document.createElement("canvas")
    gCanvas.id = "griglia-layer"
    gCanvas.width = container.offsetWidth
    gCanvas.height = container.offsetHeight
    gCanvas.style.cssText = `
      position: absolute; top: 0; left: 0;
      pointer-events: none; z-index: 0;
    `
    container.appendChild(gCanvas)

    // Calcola nodi collegati al hover
    function nodiCollegatiAlHover(nodo) {
      if (!nodo) return new Set()
      const collegati = new Set()
      collegati.add(nodo)
      graph.forEachEdge(nodo, (edge, attr, source, target) => {
        if (attr.tipo === "relazione") {
          collegati.add(source)
          collegati.add(target)
        }
        if (attr.tipo === "prodotto") {
          collegati.add(source)
          collegati.add(target)
        }
      })
      return collegati
    }

    function disegnaTutto() {
      const ctx = nodoCanvas.getContext("2d")
      ctx.clearRect(0, 0, nodoCanvas.width, nodoCanvas.height)

      const labelSize = Math.max(STILE.label_min, STILE.label_base / cameraRatio)
      const mostraLabelProdotti = cameraRatio < ZOOM_SOGLIA_PRODOTTI
      const collegati = nodiCollegatiAlHover(nodoHoverAttivo)
      const hoverAttivo = nodoHoverAttivo !== null

      // Relazioni attive
      graph.forEachEdge((edge, attr, source, target) => {
        if (attr.tipo !== "relazione" || !attr.attivo) return
        const posS = renderer.graphToViewport({
          x: graph.getNodeAttribute(source, "x"),
          y: graph.getNodeAttribute(source, "y")
        })
        const posT = renderer.graphToViewport({
          x: graph.getNodeAttribute(target, "x"),
          y: graph.getNodeAttribute(target, "y")
        })
        ctx.beginPath()
        ctx.moveTo(posS.x, posS.y)
        ctx.lineTo(posT.x, posT.y)
        ctx.strokeStyle = STILE.edge_relazione_colore
        ctx.lineWidth = STILE.edge_relazione_size
        ctx.setLineDash([])
        ctx.stroke()
      })

      // Nodi
      graph.forEachNode((node, attr) => {
        const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
        const isHover = node === nodoHoverAttivo
        const isCollegato = collegati.has(node)
        const opaco = hoverAttivo && !isCollegato

        // Scala il nodo hover
        const scala = isHover ? STILE.hover_scala : 1
        const r = (attr.size / cameraRatio) * scala

        // Opacità
        ctx.globalAlpha = opaco ? STILE.hover_opacita_altri : 1

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
        ctx.strokeStyle = STILE.bordo_colore
        ctx.lineWidth = STILE.bordo_spessore
        ctx.stroke()

        if (attr.tipo === "designer") {
          ctx.font = `${STILE.label_designer_peso} ${labelSize}px Roboto`
          ctx.fillStyle = STILE.label_designer_colore
          ctx.textAlign = "left"
          ctx.fillText(attr.label, pos.x + r + STILE.label_offset, pos.y + labelSize / 3)

          const date = attr.dati.morto
            ? `${attr.dati.nato} — ${attr.dati.morto}`
            : `${attr.dati.nato}`
          ctx.font = `${STILE.label_date_peso} ${labelSize - 2}px Roboto`
          ctx.fillStyle = STILE.label_date_colore
          ctx.fillText(date, pos.x + r + STILE.label_offset, pos.y + labelSize / 3 + labelSize + 2)
        }

        if (attr.tipo === "prodotto" && mostraLabelProdotti) {
          ctx.font = `${STILE.label_prodotto_peso} ${labelSize}px Roboto`
          ctx.fillStyle = STILE.label_prodotto_colore
          ctx.textAlign = "left"
          ctx.fillText(attr.label, pos.x + r + STILE.label_offset, pos.y + labelSize / 3)
        }

        ctx.globalAlpha = 1
      })
    }

    function disegnaGriglia() {
      const ctx = gCanvas.getContext("2d")
      const w = gCanvas.width
      const h = gCanvas.height
      ctx.clearRect(0, 0, w, h)

      ctx.strokeStyle = STILE.griglia_colore
      ctx.lineWidth = 1
      ctx.setLineDash([4, 6])
      ctx.fillStyle = STILE.griglia_label_colore

      DECENNI.forEach((anno) => {
        const gx = annoToX(anno)
        const screen = renderer.graphToViewport({ x: gx, y: 0 })
        ctx.beginPath()
        ctx.moveTo(screen.x, 40)
        ctx.lineTo(screen.x, h - 20)
        ctx.stroke()
        ctx.font = "300 10px Roboto"
        ctx.textAlign = "center"
        ctx.fillText(anno, screen.x, 30)
      })

      FASCE.forEach((fascia) => {
        const screen = renderer.graphToViewport({ x: 0, y: fascia.y })
        ctx.beginPath()
        ctx.moveTo(40, screen.y)
        ctx.lineTo(w - 20, screen.y)
        ctx.stroke()
        ctx.font = "300 10px Roboto"
        ctx.textAlign = "right"
        ctx.fillText(fascia.label, 32, screen.y + 4)
      })

      ctx.setLineDash([])
    }

    renderer.on("afterRender", () => {
      disegnaTutto()
      disegnaGriglia()
    })

    const camera = renderer.getCamera()
    camera.on("updated", () => {
      cameraRatio = camera.ratio
      renderer.refresh()
    })

    const sigmaCanvas = container.querySelector("canvas.sigma-mouse")
    if (sigmaCanvas) {
      sigmaCanvas.addEventListener("click", (e) => {
        const rect = sigmaCanvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top

        let trovato = null
        graph.forEachNode((node, attr) => {
          const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
          const r = attr.size / cameraRatio
          const dist = Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2)
          if (dist < r) trovato = { node, attr }
        })

        if (trovato) {
          setPopup({ tipo: trovato.attr.tipo, dati: trovato.attr.dati, colore: trovato.attr.color })
        } else {
          setPopup(null)
        }
      })

      sigmaCanvas.addEventListener("mousemove", (e) => {
        const rect = sigmaCanvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top

        let nodoHover = null
        graph.forEachNode((node, attr) => {
          if (attr.tipo !== "designer") return
          const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
          const r = attr.size / cameraRatio
          const dist = Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2)
          if (dist < r) nodoHover = node
        })

        nodoHoverAttivo = nodoHover

        // Spegni tutte le relazioni
        graph.forEachEdge((edge, attr) => {
          if (attr.tipo === "relazione") {
            graph.setEdgeAttribute(edge, "attivo", false)
          }
        })

        // Accendi solo quelle del nodo hover
        if (nodoHover) {
          graph.forEachEdge(nodoHover, (edge, edgeAttr) => {
            if (edgeAttr.tipo === "relazione") {
              graph.setEdgeAttribute(edge, "attivo", true)
            }
          })
        }

        renderer.refresh()
      })
    }

    return () => renderer.kill()
  }, [])

  return (
    <>
      <div style={{
        position: "fixed", top: 20, left: 24,
        fontFamily: "Roboto, sans-serif",
        zIndex: 10, pointerEvents: "none"
      }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: "#1a1a1a", letterSpacing: 1 }}>
          Design italiano
        </div>
        <div style={{ fontSize: 12, fontWeight: 300, color: "#888888", marginTop: 2 }}>
          Designer e prodotti — 1900/2000
        </div>
      </div>

      <div id="container" style={{ width: "100vw", height: "100vh" }} />

      {popup && (
        <div style={{
          position: "fixed", top: 30, right: 30,
          background: "white", borderRadius: 12,
          padding: 24, width: 280,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          fontFamily: "Roboto, sans-serif",
          zIndex: 100
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: popup.colore,
            display: "inline-block", marginRight: 8
          }} />
          <strong style={{ fontSize: 15, fontWeight: 600 }}>{popup.dati.nome}</strong>
          <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #eee" }} />

          {popup.tipo === "designer" && (
            <>
              <p style={{ margin: "4px 0", fontSize: 12, fontWeight: 300 }}>
                <span style={{ fontWeight: 600 }}>Nato:</span> {popup.dati.nato}
                {popup.dati.morto ? ` — Morto: ${popup.dati.morto}` : ""}
              </p>
              <p style={{ margin: "8px 0", fontSize: 12, fontWeight: 300, color: "#555" }}>
                {popup.dati.bio}
              </p>
            </>
          )}

          {popup.tipo === "prodotto" && (
            <>
              <p style={{ margin: "4px 0", fontSize: 12, fontWeight: 300 }}>
                <span style={{ fontWeight: 600 }}>Anno:</span> {popup.dati.anno}
              </p>
              <p style={{ margin: "4px 0", fontSize: 12, fontWeight: 300 }}>
                <span style={{ fontWeight: 600 }}>Designer:</span> {popup.dati.designer}
              </p>
              <p style={{ margin: "4px 0", fontSize: 12, fontWeight: 300 }}>
                <span style={{ fontWeight: 600 }}>Azienda:</span> {popup.dati.azienda}
              </p>
            </>
          )}

          <button onClick={() => setPopup(null)} style={{
            marginTop: 16, padding: "6px 14px",
            border: "none", borderRadius: 6,
            background: "#2d2d2d", color: "white",
            cursor: "pointer", fontSize: 12,
            fontFamily: "Roboto, sans-serif",
            fontWeight: 300
          }}>
            Chiudi
          </button>
        </div>
      )}
    </>
  )
}

export default App