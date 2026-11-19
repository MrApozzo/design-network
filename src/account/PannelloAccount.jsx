import { useEffect, useState } from "react"
import { messaggioErrore } from "./testi-account.js"
import { nomeCompleto } from "./supabase.js"

// Stili condivisi con il resto del menu (vedi renderContribuisciBody in App.jsx).
const FONT = "Roboto, sans-serif"
const MONO = "'Roboto Mono', monospace"
const SERIF = "'Roboto Serif', serif"
const stileInput = { width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", fontFamily: FONT, fontSize: 12, fontWeight: 300, background: "white" }
const stileBottone = { padding: "10px 16px", borderRadius: 20, border: "none", cursor: "pointer", background: "#1a1a1a", color: "white", fontFamily: FONT, fontSize: 12, fontWeight: 500 }
const stileLink = { background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: FONT, fontSize: 11, color: "#888", textDecoration: "underline", textUnderlineOffset: 2, textAlign: "left" }
const stileTitolo = { fontFamily: FONT, fontSize: 10, fontWeight: 600, color: "#aaa", letterSpacing: 1.5, textTransform: "uppercase", margin: "26px 0 10px" }
const stileTesto = { fontFamily: FONT, fontWeight: 300, fontSize: 12, color: "#888", lineHeight: 1.6, margin: 0 }

function Messaggio({ testo, errore }) {
  if (!testo) return null
  return <div role={errore ? "alert" : "status"} style={{ color: errore ? "#c0392b" : "#2a8a4a", fontSize: 11, fontFamily: FONT, lineHeight: 1.5 }}>{testo}</div>
}

// Campo password con "occhio" per mostrare/nascondere il testo.
function CampoPassword({ value, onChange, placeholder, autoComplete, ta }) {
  const [visibile, setVisibile] = useState(false)
  return (
    <div style={{ position: "relative" }}>
      <input type={visibile ? "text" : "password"} required minLength={8} autoComplete={autoComplete}
        value={value} onChange={onChange} placeholder={placeholder} aria-label={placeholder}
        style={{ ...stileInput, paddingRight: 38 }} />
      <button type="button" onClick={() => setVisibile((v) => !v)}
        aria-label={visibile ? ta.nascondiPassword : ta.mostraPassword} title={visibile ? ta.nascondiPassword : ta.mostraPassword}
        style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 6, lineHeight: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {visibile && <path d="M4 20 20 4" />}
        </svg>
      </button>
    </div>
  )
}

// "G" di Google in nero, in linea con la grafica monocromatica del sito.
function IconaGoogle() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#1a1a1a" d="M12.48 10.92v3.28h7.84c-.24 1.84-.85 3.18-1.79 4.13-1.14 1.14-2.92 2.4-6.05 2.4-4.83 0-8.6-3.89-8.6-8.72s3.77-8.72 8.6-8.72c2.6 0 4.5 1.02 5.9 2.33l2.31-2.31C18.75 1.44 16.13 0 12.48 0 5.87 0 .31 5.39.31 12s5.56 12 12.17 12c3.57 0 6.27-1.17 8.38-3.36 2.16-2.16 2.84-5.21 2.84-7.67 0-.76-.05-1.47-.17-2.05H12.48z" />
    </svg>
  )
}

function ModuloAccesso({ account, ta }) {
  const [modo, setModo] = useState("accedi") // accedi | registrati | recupero
  const [nome, setNome] = useState("")
  const [cognome, setCognome] = useState("")
  const [email, setEmail] = useState("")
  const [email2, setEmail2] = useState("")
  const [password, setPassword] = useState("")
  const [invio, setInvio] = useState(false)
  const [messaggio, setMessaggio] = useState(null)

  const esegui = async (operazione, ok) => {
    setInvio(true); setMessaggio(null)
    const r = await operazione()
    setInvio(false)
    setMessaggio(r.ok ? (ok ? { testo: ok } : null) : { testo: messaggioErrore(ta, r.errore), errore: true })
    return r
  }

  const emailDiverse = modo === "registrati" && email2 !== "" && email.trim().toLowerCase() !== email2.trim().toLowerCase()

  const invia = (e) => {
    e.preventDefault()
    if (modo === "accedi") esegui(() => account.accedi(email, password))
    else if (modo === "registrati") {
      if (email.trim().toLowerCase() !== email2.trim().toLowerCase()) { setMessaggio({ testo: ta.errori.email_diverse, errore: true }); return }
      esegui(() => account.registrati(email.trim(), password, nome, cognome), ta.confermaEmail)
    }
    else esegui(() => account.recuperaPassword(email), ta.controllaEmail)
  }

  const esterni = account.provider?.google ? ["google"] : []

  return (
    <form onSubmit={invia} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={stileTesto}>{ta.perche}</p>
      {modo !== "recupero" && (
        <div style={{ display: "flex", gap: 2, background: "#ececec", borderRadius: 14, padding: 2, alignSelf: "flex-start" }}>
          {["accedi", "registrati"].map((m) => (
            <button key={m} type="button" onClick={() => { setModo(m); setMessaggio(null) }}
              style={{ padding: "4px 12px", border: "none", borderRadius: 12, cursor: "pointer", fontSize: 10, fontFamily: MONO, fontWeight: modo === m ? 600 : 300, color: modo === m ? "#fff" : "#888", background: modo === m ? "#1a1a1a" : "transparent" }}>
              {ta[m]}
            </button>
          ))}
        </div>
      )}
      {modo !== "recupero" && esterni.length > 0 && (
        <>
          {esterni.map((p) => (
            <button key={p} type="button" disabled={invio} onClick={() => esegui(() => account.accediCon(p))}
              style={{ ...stileBottone, background: "#fff", color: "#1a1a1a", border: "1px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 400 }}>
              <IconaGoogle />
              {ta.continuaGoogle}
            </button>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#bbb", fontFamily: FONT, fontSize: 10 }}>
            <span style={{ flex: 1, height: 1, background: "#eee" }} />{ta.oppure}<span style={{ flex: 1, height: 1, background: "#eee" }} />
          </div>
        </>
      )}
      {modo === "registrati" && (
        <div style={{ display: "flex", gap: 8 }}>
          <input type="text" required maxLength={60} autoComplete="given-name" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={ta.nome} aria-label={ta.nome} style={stileInput} />
          <input type="text" required maxLength={60} autoComplete="family-name" value={cognome} onChange={(e) => setCognome(e.target.value)} placeholder={ta.cognome} aria-label={ta.cognome} style={stileInput} />
        </div>
      )}
      <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={ta.email} aria-label={ta.email} style={stileInput} />
      {modo === "registrati" && (
        <div>
          <input type="email" required autoComplete="email" value={email2} onChange={(e) => setEmail2(e.target.value)}
            onPaste={(e) => e.preventDefault()} placeholder={ta.confermaEmailCampo} aria-label={ta.confermaEmailCampo}
            style={{ ...stileInput, borderColor: emailDiverse ? "#c0392b" : "#ddd" }} />
          {emailDiverse && <div style={{ fontFamily: FONT, fontSize: 10, color: "#c0392b", marginTop: 4 }}>{ta.errori.email_diverse}</div>}
        </div>
      )}
      {modo !== "recupero" && (
        <div>
          <CampoPassword value={password} onChange={(e) => setPassword(e.target.value)} placeholder={ta.password} ta={ta}
            autoComplete={modo === "registrati" ? "new-password" : "current-password"} />
          {modo === "registrati" && <div style={{ fontFamily: FONT, fontSize: 10, color: "#aaa", marginTop: 4 }}>{ta.passwordRequisiti}</div>}
        </div>
      )}
      <button type="submit" disabled={invio || emailDiverse} style={{ ...stileBottone, opacity: invio || emailDiverse ? 0.6 : 1 }}>
        {invio ? ta.attendi : modo === "accedi" ? ta.entra : modo === "registrati" ? ta.creaAccount : ta.inviaRecupero}
      </button>
      <Messaggio {...(messaggio || {})} />
      {modo !== "recupero" && (
        <p style={{ ...stileTesto, fontSize: 10, color: "#aaa" }}>
          {ta.privacyPrima}<a href={ta.privacyHref} target="_blank" rel="noopener" style={{ color: "inherit", textUnderlineOffset: 2 }}>{ta.privacyLink}</a>.
        </p>
      )}
      {modo === "accedi" && (
        <>
          <button type="button" style={stileLink} disabled={invio || !email}
            onClick={() => esegui(() => account.linkAccesso(email), ta.controllaEmail)}>{ta.linkAccesso}</button>
          <button type="button" style={stileLink} onClick={() => { setModo("recupero"); setMessaggio(null) }}>{ta.passwordDimenticata}</button>
        </>
      )}
      {modo === "recupero" && (
        <button type="button" style={stileLink} onClick={() => { setModo("accedi"); setMessaggio(null) }}>{ta.tornaAccesso}</button>
      )}
    </form>
  )
}

function ModuloNuovaPassword({ account, ta }) {
  const [password, setPassword] = useState("")
  const [invio, setInvio] = useState(false)
  const [messaggio, setMessaggio] = useState(null)
  return (
    <form style={{ display: "flex", flexDirection: "column", gap: 12 }} onSubmit={async (e) => {
      e.preventDefault(); setInvio(true)
      const r = await account.nuovaPassword(password)
      setInvio(false)
      setMessaggio(r.ok ? { testo: ta.passwordAggiornata } : { testo: messaggioErrore(ta, r.errore), errore: true })
    }}>
      <CampoPassword value={password} onChange={(e) => setPassword(e.target.value)} placeholder={ta.passwordNuova} autoComplete="new-password" ta={ta} />
      <button type="submit" disabled={invio} style={stileBottone}>{invio ? ta.attendi : ta.salvaPassword}</button>
      <Messaggio {...(messaggio || {})} />
    </form>
  )
}

function Revisione({ account, ta }) {
  const [lista, setLista] = useState(null)
  const [errore, setErrore] = useState(null)
  const [punti, setPunti] = useState({})
  const carica = () => account.contributiDaRevisionare().then((r) => {
    if (r.ok) { setLista(r.dati || []); setErrore(null) } else setErrore(messaggioErrore(ta, r.errore))
  })
  useEffect(() => { carica() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const decidi = async (id, approva) => {
    const r = approva
      ? await account.approva(id, punti[id] === "" || punti[id] == null ? null : Number(punti[id]))
      : await account.rifiuta(id)
    if (r.ok) setLista((l) => l.filter((c) => c.id !== id)); else setErrore(messaggioErrore(ta, r.errore))
  }
  return (
    <>
      <div style={{ ...stileTitolo, display: "flex", justifyContent: "space-between" }}>
        <span>{ta.revisione}{lista ? ` (${lista.length})` : ""}</span>
        <button type="button" onClick={carica} style={{ ...stileLink, fontSize: 10, textTransform: "none", letterSpacing: 0 }}>{ta.aggiornaLista}</button>
      </div>
      <Messaggio testo={errore} errore />
      {lista && lista.length === 0 && <p style={stileTesto}>{ta.nessunaRevisione}</p>}
      {lista && lista.map((c) => (
        <div key={c.id} style={{ borderBottom: "1px solid #eee", padding: "10px 0", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: "#aaa" }}>
            #{c.id} · {ta.tipi[c.tipo]}{c.riferimento ? ` · ${c.riferimento}` : ""} · {new Date(c.creato_il).toLocaleDateString()}
          </div>
          <div style={{ ...stileTesto, color: "#555", whiteSpace: "pre-wrap" }}>{c.descrizione}</div>
          {c.fonte && <a href={c.fonte} target="_blank" rel="noopener noreferrer nofollow" style={{ ...stileLink, wordBreak: "break-all" }}>{ta.fonte}</a>}
          {c.foto && (
            <button type="button" style={stileLink} onClick={async () => {
              const r = await account.urlFoto(c.foto)
              if (r.ok) window.open(r.dati.signedUrl, "_blank", "noopener")
            }}>{ta.vediFoto}</button>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="number" min={0} placeholder="auto" aria-label={ta.puntiPersonalizzati} value={punti[c.id] ?? ""}
              onChange={(e) => setPunti((p) => ({ ...p, [c.id]: e.target.value }))} style={{ ...stileInput, width: 70, padding: "5px 8px" }} />
            <span style={{ fontFamily: FONT, fontSize: 10, color: "#aaa" }}>{ta.puntiPersonalizzati}</span>
            <button type="button" onClick={() => decidi(c.id, true)} style={{ ...stileBottone, padding: "6px 12px", fontSize: 11 }}>{ta.approva}</button>
            <button type="button" onClick={() => decidi(c.id, false)} style={{ ...stileBottone, padding: "6px 12px", fontSize: 11, background: "#eee", color: "#555" }}>{ta.rifiuta}</button>
          </div>
        </div>
      ))}
    </>
  )
}

function Profilo({ account, ta, onApriElemento }) {
  const [modificaNome, setModificaNome] = useState(false)
  const [nome, setNome] = useState(account.profilo?.nome || "")
  const [cognome, setCognome] = useState(account.profilo?.cognome || "")
  const preferiti = [...account.preferiti].map((k) => {
    const [tipo, elemento] = k.split("::")
    return { tipo, elemento, nome: elemento.split("|")[0] }
  })
  return (
    <div>
      {modificaNome ? (
        <form style={{ display: "flex", flexDirection: "column", gap: 6 }} onSubmit={async (e) => {
          e.preventDefault(); const r = await account.aggiornaNome(nome, cognome); if (r.ok) setModificaNome(false)
        }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} placeholder={ta.nome} aria-label={ta.nome} style={stileInput} autoFocus />
            <input value={cognome} maxLength={60} onChange={(e) => setCognome(e.target.value)} placeholder={ta.cognome} aria-label={ta.cognome} style={stileInput} />
          </div>
          <button type="submit" style={{ ...stileBottone, padding: "6px 12px", alignSelf: "flex-start" }}>{ta.salva}</button>
        </form>
      ) : (
        <div style={{ fontFamily: SERIF, fontWeight: 500, fontStyle: "italic", fontSize: 16, color: "#1a1a1a" }}>
          {nomeCompleto(account.profilo) || account.utente.email}
          <button type="button" onClick={() => setModificaNome(true)} style={{ ...stileLink, marginLeft: 8, fontStyle: "normal", fontSize: 10 }}>{ta.modifica}</button>
        </div>
      )}
      <div style={{ fontFamily: FONT, fontSize: 11, color: "#aaa", marginTop: 2 }}>{account.utente.email}</div>

      <div style={{ marginTop: 16, display: "inline-flex", alignItems: "baseline", gap: 6, background: "#FF0707", color: "#fff", borderRadius: 20, padding: "4px 14px" }}>
        <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600 }}>{account.profilo?.punti ?? 0}</span>
        <span style={{ fontFamily: MONO, fontSize: 10 }}>{ta.punti}</span>
      </div>

      <div style={stileTitolo}>{ta.preferiti}{preferiti.length ? ` (${preferiti.length})` : ""}</div>
      {preferiti.length === 0 && <p style={stileTesto}>{ta.nessunPreferito}</p>}
      {preferiti.map((p) => (
        <button key={`${p.tipo}::${p.elemento}`} type="button" onClick={() => onApriElemento?.(p.tipo, p.nome)}
          style={{ display: "flex", width: "100%", justifyContent: "space-between", gap: 8, background: "none", border: "none", borderBottom: "1px solid #eee", padding: "9px 0", cursor: "pointer", textAlign: "left" }}>
          <span style={{ fontFamily: FONT, fontSize: 12, color: "#1a1a1a" }}>{p.nome}</span>
          <span style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", textTransform: "uppercase" }}>{ta.tipiElemento[p.tipo]}</span>
        </button>
      ))}

      <div style={stileTitolo}>{ta.contributi}</div>
      {account.contributi.length === 0 && <p style={stileTesto}>{ta.nessunContributo}</p>}
      {account.contributi.map((c) => (
        <div key={c.id} style={{ borderBottom: "1px solid #eee", padding: "9px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontFamily: FONT, fontSize: 12, color: "#1a1a1a" }}>{ta.tipi[c.tipo]}{c.riferimento ? ` · ${c.riferimento}` : ""}</span>
            <span style={{ fontFamily: MONO, fontSize: 10, whiteSpace: "nowrap", color: c.stato === "approvato" ? "#2a8a4a" : c.stato === "rifiutato" ? "#c0392b" : "#aaa" }}>
              {ta.stati[c.stato]}{c.stato === "approvato" && c.punti_assegnati ? ` +${c.punti_assegnati}` : ""}
            </span>
          </div>
          <div style={{ ...stileTesto, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.descrizione}</div>
          {c.nota_revisione && <div style={{ ...stileTesto, fontSize: 11, fontStyle: "italic" }}>{c.nota_revisione}</div>}
        </div>
      ))}

      {account.admin && <Revisione account={account} ta={ta} />}

      <button type="button" onClick={() => account.esci()} style={{ ...stileBottone, marginTop: 24, background: "#eee", color: "#555" }}>{ta.esci}</button>
    </div>
  )
}

export function PannelloAccount({ account, ta, onApriElemento }) {
  useEffect(() => { account.avvia() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!account.configurato) return <p style={stileTesto}>{ta.nonConfigurato}</p>
  if (!account.pronto) return <p style={stileTesto}>{ta.caricamento}</p>
  if (account.recuperoPassword) return <ModuloNuovaPassword account={account} ta={ta} />
  if (!account.utente) return <ModuloAccesso account={account} ta={ta} />
  return <Profilo account={account} ta={ta} onApriElemento={onApriElemento} />
}

// Cuore nei pannelli di designer, prodotti e aziende.
export function BottonePreferito({ account, ta, tipo, elemento, scuro, onRichiediAccesso, dimensione = 18 }) {
  if (!account.configurato || !elemento) return null
  const attivo = account.utente && account.ePreferito(tipo, elemento)
  const etichetta = !account.utente ? ta.accediPerPreferiti : attivo ? ta.rimuoviPreferito : ta.aggiungiPreferito
  const colore = attivo ? "#FF0707" : (scuro ? "#777" : "#bbb")
  return (
    <button type="button" aria-label={etichetta} title={etichetta} aria-pressed={!!attivo}
      onClick={(e) => { e.stopPropagation(); if (!account.utente) onRichiediAccesso?.(); else account.togglePreferito(tipo, elemento) }}
      style={{ background: "none", border: "none", cursor: "pointer", padding: 4, lineHeight: 0, flexShrink: 0 }}>
      <svg width={dimensione} height={dimensione} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.1 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.6 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
          fill={attivo ? colore : "none"} stroke={colore} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
