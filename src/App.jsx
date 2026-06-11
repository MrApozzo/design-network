import { useEffect, useState } from "react"
import Graph from "graphology"
import Sigma from "sigma"
import { NodeImageProgram } from "@sigma/node-image"
import forceAtlas2 from "graphology-layout-forceatlas2"
import designers from "./data/designers.json"
import prodotti from "./data/prodotti.json"

function App() {
  const [popup, setPopup] = useState(null)

  useEffect(() => {
    const graph = new Graph()

    const colori = [
      "#e63946", "#2a9d8f", "#e9c46a", "#f4a261",
      "#264653", "#a8dadc", "#457b9d", "#e76f51"
    ]

    designers.forEach((d, i) => {
      graph.addNode(d.nome, {
        label: d.nome,
        size: 18,
        color: colori[i % colori.length],
        tipo: "designer",
        dati: d
      })
    })

    prodotti.forEach((p) => {
      graph.addNode(p.nome, {
        label: p.nome,
        size: 14,
        type: "image",
        image: `/immagini/${p.foto}`,
        color: "#cccccc",
        tipo: "prodotto",
        dati: p
      })
      if (graph.hasNode(p.designer)) {
        graph.addEdge(p.designer, p.nome)
      }
    })

    graph.forEachNode((node) => {
      graph.setNodeAttribute(node, "x", Math.random())
      graph.setNodeAttribute(node, "y", Math.random())
    })

    forceAtlas2.assign(graph, {
      iterations: 200,
      settings: {
        gravity: 1,
        scalingRatio: 10,
        strongGravityMode: true
      }
    })

    const renderer = new Sigma(graph, document.getElementById("container"), {
      renderEdgeLabels: false,
      nodeProgramClasses: {
        image: NodeImageProgram
      },
      nodeImageProgram: {
        padding: 0,
        correctCamPos: true,
        drawingMode: "square"
      }
    })

    renderer.on("clickNode", ({ node }) => {
      const attr = graph.getNodeAttributes(node)
      setPopup({ tipo: attr.tipo, dati: attr.dati, colore: attr.color })
    })

    renderer.on("clickStage", () => setPopup(null))

    return () => renderer.kill()
  }, [])

  return (
    <>
      <div id="container" style={{ width: "100vw", height: "100vh" }} />

      {popup && (
        <div style={{
          position: "fixed", top: 30, right: 30,
          background: "white", borderRadius: 12,
          padding: 24, width: 280,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          fontFamily: "Arial, sans-serif",
          zIndex: 100
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: popup.colore,
            display: "inline-block", marginRight: 8
          }} />
          <strong style={{ fontSize: 16 }}>{popup.dati.nome}</strong>
          <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #eee" }} />

          {popup.tipo === "designer" && (
            <>
              <p style={{ margin: "4px 0", fontSize: 13 }}>
                <strong>Nato:</strong> {popup.dati.nato}
                {popup.dati.morto ? ` — Morto: ${popup.dati.morto}` : ""}
              </p>
              <p style={{ margin: "8px 0", fontSize: 13, color: "#555" }}>
                {popup.dati.bio}
              </p>
            </>
          )}

          {popup.tipo === "prodotto" && (
            <>
              <p style={{ margin: "4px 0", fontSize: 13 }}>
                <strong>Anno:</strong> {popup.dati.anno}
              </p>
              <p style={{ margin: "4px 0", fontSize: 13 }}>
                <strong>Designer:</strong> {popup.dati.designer}
              </p>
              <p style={{ margin: "4px 0", fontSize: 13 }}>
                <strong>Azienda:</strong> {popup.dati.azienda}
              </p>
            </>
          )}

          <button onClick={() => setPopup(null)} style={{
            marginTop: 16, padding: "6px 14px",
            border: "none", borderRadius: 6,
            background: "#2d2d2d", color: "white",
            cursor: "pointer", fontSize: 12
          }}>
            Chiudi
          </button>
        </div>
      )}
    </>
  )
}

export default App