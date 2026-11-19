import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { messaggioErrore } from "./testi-account.js"

// Elenco iscritti a tutto schermo (solo admin). Montato su document.body:
// la barra laterale usa transform, che intrappolerebbe un position: fixed.
const FONT = "Roboto, sans-serif"
const MONO = "'Roboto Mono', monospace"
const ROSSO = "#c0392b"

const stileBottone = { padding: "7px 14px", borderRadius: 20, border: "none", cursor: "pointer", background: "#1a1a1a", color: "white", fontFamily: FONT, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }
const stileBottoneChiaro = { ...stileBottone, background: "#eee", color: "#555" }
const stileCella = { padding: "10px 12px", borderBottom: "1px solid #eee", fontFamily: FONT, fontSize: 12, fontWeight: 300, color: "#1a1a1a", verticalAlign: "top", whiteSpace: "nowrap" }

const COLONNE = [
  { chiave: "nome", testo: (ta) => ta.nome },
  { chiave: "cognome", testo: (ta) => ta.cognome },
  { chiave: "email", testo: (ta) => ta.email },
  { chiave: "creato_il", testo: (ta) => ta.colIscritto },
  { chiave: "ultimo_accesso", testo: (ta) => ta.colUltimoAccesso },
  { chiave: "metodi", testo: (ta) => ta.colMetodo },
  { chiave: "confermato", testo: (ta) => ta.colConfermata },
  { chiave: "punti", testo: (ta) => ta.colPunti },
]

const dataOra = (d, ta) => d
  ? new Date(d).toLocaleString(ta.locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : ta.maiAcceduto

function esportaCsv(righe, ta) {
  const campi = ["nome", "cognome", "email", "creato_il", "ultimo_accesso", "metodi", "confermato", "punti", "ruolo"]
  const cella = (v) => `"${String(Array.isArray(v) ? v.join(" ") : v ?? "").replace(/"/g, '""')}"`
  const csv = [campi.join(","), ...righe.map((r) => campi.map((c) => cella(r[c])).join(","))].join("\r\n")
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
  const a = Object.assign(document.createElement("a"), { href: url, download: `${ta.fileCsv}-${new Date().toISOString().slice(0, 10)}.csv` })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function TabellaIscritti({ account, ta, onChiudi }) {
  const [lista, setLista] = useState(null)
  const [errore, setErrore] = useState(null)
  const [cerca, setCerca] = useState("")
  const [ordine, setOrdine] = useState({ chiave: "creato_il", verso: -1 })
  const [daEliminare, setDaEliminare] = useState(null)
  const [invio, setInvio] = useState(false)
  const [caricatoIl, setCaricatoIl] = useState(0)

  const carica = () => account.iscritti().then((r) => {
    if (r.ok) { setLista(r.dati || []); setCaricatoIl(Date.now()); setErrore(null) } else setErrore(messaggioErrore(ta, r.errore))
  })
  useEffect(() => { carica() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const tasto = (e) => { if (e.key === "Escape") onChiudi() }
    window.addEventListener("keydown", tasto)
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { window.removeEventListener("keydown", tasto); document.body.style.overflow = overflow }
  }, [onChiudi])

  const righe = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    const filtrate = (lista || []).filter((u) => !q || [u.nome, u.cognome, u.email].some((v) => (v || "").toLowerCase().includes(q)))
    const valore = (u) => {
      const v = u[ordine.chiave]
      if (Array.isArray(v)) return v.join(",")
      if (typeof v === "boolean") return v ? 1 : 0
      return v ?? ""
    }
    return [...filtrate].sort((a, b) => {
      const va = valore(a), vb = valore(b)
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), ta.locale)) * ordine.verso
    })
  }, [lista, cerca, ordine, ta.locale])

  const settimana = useMemo(() => {
    const limite = caricatoIl - 7 * 864e5
    return (lista || []).filter((u) => new Date(u.creato_il).getTime() >= limite).length
  }, [lista, caricatoIl])

  const elimina = async (id) => {
    setInvio(true)
    const r = await account.eliminaUtente(id)
    setInvio(false); setDaEliminare(null)
    if (r.ok) setLista((l) => l.filter((u) => u.id !== id)); else setErrore(messaggioErrore(ta, r.errore))
  }

  const ordina = (chiave) => setOrdine((o) => ({ chiave, verso: o.chiave === chiave ? -o.verso : (chiave === "creato_il" || chiave === "ultimo_accesso" || chiave === "punti" ? -1 : 1) }))

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={ta.iscritti}
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.25)", display: "flex", padding: "min(24px, 3vw)" }}
      onClick={onChiudi}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ flex: 1, minWidth: 0, background: "#fff", borderRadius: 14, boxShadow: "0 12px 48px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: FONT }}>

        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "18px 22px", borderBottom: "1px solid #eee" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginRight: "auto" }}>
            <span style={{ fontSize: 18, fontWeight: 600, color: "#1a1a1a" }}>{ta.iscritti}</span>
            {lista && (
              <span style={{ fontFamily: MONO, fontSize: 11, color: "#888" }}>
                {ta.totale(lista.length)} · {ta.ultimi7(settimana)}
              </span>
            )}
          </div>
          <input type="search" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder={ta.cercaIscritti} aria-label={ta.cercaIscritti}
            style={{ width: 240, maxWidth: "100%", padding: "7px 12px", borderRadius: 8, border: "1px solid #ddd", fontFamily: FONT, fontSize: 12, fontWeight: 300 }} />
          <button type="button" onClick={carica} style={stileBottoneChiaro}>{ta.aggiornaLista}</button>
          <button type="button" disabled={!righe.length} onClick={() => esportaCsv(righe, ta)} style={{ ...stileBottoneChiaro, opacity: righe.length ? 1 : 0.5 }}>{ta.esportaCsv}</button>
          <button type="button" onClick={onChiudi} aria-label={ta.chiudi} title={ta.chiudi}
            style={{ ...stileBottoneChiaro, width: 32, height: 32, padding: 0, fontSize: 16, lineHeight: "32px" }}>×</button>
        </div>

        {errore && <div role="alert" style={{ padding: "10px 22px", color: ROSSO, fontSize: 12 }}>{errore}</div>}

        <div style={{ flex: 1, overflow: "auto" }}>
          {!lista && !errore && <p style={{ padding: 22, fontSize: 12, color: "#888" }}>{ta.caricamento}</p>}
          {lista && righe.length === 0 && <p style={{ padding: 22, fontSize: 12, color: "#888" }}>{cerca ? ta.nessunRisultato : ta.nessunIscritto}</p>}
          {righe.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {COLONNE.map((c) => (
                    <th key={c.chiave} scope="col" aria-sort={ordine.chiave === c.chiave ? (ordine.verso > 0 ? "ascending" : "descending") : "none"}
                      style={{ position: "sticky", top: 0, background: "#fafafa", borderBottom: "1px solid #e4e4e4", padding: 0, textAlign: c.chiave === "punti" ? "right" : "left", zIndex: 1 }}>
                      <button type="button" onClick={() => ordina(c.chiave)}
                        style={{ width: "100%", textAlign: "inherit", background: "none", border: "none", cursor: "pointer", padding: "10px 12px", fontFamily: FONT, fontSize: 10, fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", color: ordine.chiave === c.chiave ? "#1a1a1a" : "#999", whiteSpace: "nowrap" }}>
                        {c.testo(ta)}{ordine.chiave === c.chiave ? (ordine.verso > 0 ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                  <th scope="col" style={{ position: "sticky", top: 0, background: "#fafafa", borderBottom: "1px solid #e4e4e4", zIndex: 1 }}><span style={{ position: "absolute", left: -9999 }}>{ta.azioni}</span></th>
                </tr>
              </thead>
              <tbody>
                {righe.map((u) => {
                  const proprio = u.id === account.utente.id
                  const nome = [u.nome, u.cognome].filter(Boolean).join(" ") || u.email
                  return (
                    <tr key={u.id} style={{ background: daEliminare === u.id ? "#fdf1f0" : undefined }}>
                      <td style={stileCella}>{u.nome || "—"}{u.ruolo === "admin" && <span style={{ marginLeft: 6, fontFamily: MONO, fontSize: 9, color: "#fff", background: "#1a1a1a", borderRadius: 8, padding: "1px 6px" }}>admin</span>}</td>
                      <td style={stileCella}>{u.cognome || "—"}</td>
                      <td style={{ ...stileCella, whiteSpace: "normal", wordBreak: "break-all", minWidth: 180 }}><a href={`mailto:${u.email}`} style={{ color: "inherit", textUnderlineOffset: 2 }}>{u.email}</a></td>
                      <td style={{ ...stileCella, fontFamily: MONO, fontSize: 11 }}>{dataOra(u.creato_il, ta)}</td>
                      <td style={{ ...stileCella, fontFamily: MONO, fontSize: 11, color: u.ultimo_accesso ? "#1a1a1a" : "#bbb" }}>{dataOra(u.ultimo_accesso, ta)}</td>
                      <td style={stileCella}>{(u.metodi || []).map((m) => ta.metodi[m] || m).join(" + ") || "—"}</td>
                      <td style={{ ...stileCella, color: u.confermato ? "#2a8a4a" : ROSSO }}>{u.confermato ? ta.si : ta.no}</td>
                      <td style={{ ...stileCella, fontFamily: MONO, textAlign: "right" }}>{u.punti}</td>
                      <td style={{ ...stileCella, textAlign: "right" }}>
                        {proprio ? null : daEliminare === u.id ? (
                          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                            <span style={{ color: ROSSO, fontSize: 11, whiteSpace: "normal", maxWidth: 220, textAlign: "left" }}>{ta.confermaEliminaUtente(nome)}</span>
                            <button type="button" disabled={invio} onClick={() => elimina(u.id)} style={{ ...stileBottone, background: ROSSO, padding: "5px 12px", fontSize: 11 }}>{invio ? ta.attendi : ta.elimina}</button>
                            <button type="button" onClick={() => setDaEliminare(null)} style={{ ...stileBottoneChiaro, padding: "5px 12px", fontSize: 11 }}>{ta.annulla}</button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setDaEliminare(u.id)}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: FONT, fontSize: 11, color: "#999", textDecoration: "underline", textUnderlineOffset: 2 }}>{ta.elimina}</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
