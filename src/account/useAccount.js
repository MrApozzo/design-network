import { useCallback, useEffect, useRef, useState } from "react"
import { accountConfigurato, ottieniClient, sessioneProbabile, providerAttivi } from "./supabase.js"

const TIPI_CONTRIBUTO = ["correzione", "aggiunta", "suggerimento"]

// Stato dell'account e operazioni su Supabase, in un unico hook usato da App.
// Ogni operazione restituisce { ok, errore } invece di lanciare eccezioni,
// così l'interfaccia può mostrare il messaggio senza try/catch sparsi.
export function useAccount() {
  const [stato, setStato] = useState(() => ({
    configurato: accountConfigurato,
    pronto: !accountConfigurato,
    utente: null,
    profilo: null,
    preferiti: new Set(),
    contributi: [],
    recuperoPassword: false,
    provider: { google: false, apple: false },
  }))
  const clientRef = useRef(null)
  const avviatoRef = useRef(false)

  const aggiorna = (patch) => setStato((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }))

  const caricaDatiUtente = useCallback(async (client, utente) => {
    if (!utente) {
      aggiorna({ utente: null, profilo: null, preferiti: new Set(), contributi: [], pronto: true })
      return
    }
    const [profilo, preferiti, contributi] = await Promise.all([
      client.from("profili").select("id, nome, cognome, punti, ruolo").eq("id", utente.id).maybeSingle(),
      client.from("preferiti").select("tipo, elemento, creato_il").order("creato_il", { ascending: false }),
      client.from("contributi").select("id, tipo, riferimento_tipo, riferimento, descrizione, stato, punti_assegnati, nota_revisione, creato_il")
        .eq("utente_id", utente.id).order("creato_il", { ascending: false }).limit(50),
    ])
    aggiorna({
      utente,
      profilo: profilo.data || { id: utente.id, nome: utente.user_metadata?.nome || "", cognome: utente.user_metadata?.cognome || "", punti: 0, ruolo: "utente" },
      preferiti: new Set((preferiti.data || []).map((p) => `${p.tipo}::${p.elemento}`)),
      contributi: contributi.data || [],
      pronto: true,
    })
  }, [])

  // Avvia il client (una volta sola) e si mette in ascolto dei cambi di sessione.
  const avvia = useCallback(async () => {
    if (!accountConfigurato) return null
    if (clientRef.current) return clientRef.current
    const client = await ottieniClient()
    clientRef.current = client
    if (!avviatoRef.current) {
      avviatoRef.current = true
      client.auth.onAuthStateChange((evento, sessione) => {
        if (evento === "PASSWORD_RECOVERY") aggiorna({ recuperoPassword: true })
        // Le query vanno fuori dal callback (raccomandazione Supabase).
        setTimeout(() => caricaDatiUtente(client, sessione?.user ?? null), 0)
      })
      const { data } = await client.auth.getSession()
      await caricaDatiUtente(client, data.session?.user ?? null)
    }
    return client
  }, [caricaDatiUtente])

  // Quali accessi esterni (Google, Apple) sono attivi nel progetto: i pulsanti
  // compaiono da soli quando un provider viene abilitato su Supabase.
  useEffect(() => {
    if (!accountConfigurato) return
    providerAttivi().then((provider) => aggiorna({ provider }))
  }, [])

  useEffect(() => {
    if (!accountConfigurato) return
    if (sessioneProbabile()) { avvia(); return }
    // Nessuna sessione salvata: il client si carica a pagina ferma, senza
    // pesare sull'apertura della mappa.
    const id = (window.requestIdleCallback || ((f) => setTimeout(f, 3000)))(() => avvia())
    return () => (window.cancelIdleCallback || clearTimeout)(id)
  }, [avvia])

  const esegui = async (operazione) => {
    const client = await avvia()
    if (!client) return { ok: false, errore: "non_configurato" }
    try {
      const risultato = await operazione(client)
      if (risultato?.error) return { ok: false, errore: risultato.error.message }
      return { ok: true, dati: risultato?.data }
    } catch (e) {
      return { ok: false, errore: e?.message || String(e) }
    }
  }

  const ritorno = () => window.location.origin + window.location.pathname

  const registrati = (email, password, nome, cognome) => esegui((c) =>
    c.auth.signUp({ email, password, options: { data: { nome: nome.trim().slice(0, 60), cognome: cognome.trim().slice(0, 60) }, emailRedirectTo: ritorno() } }))
  const accediCon = (provider) => esegui((c) => c.auth.signInWithOAuth({ provider, options: { redirectTo: ritorno() } }))
  const accedi = (email, password) => esegui((c) => c.auth.signInWithPassword({ email, password }))
  const linkAccesso = (email) => esegui((c) => c.auth.signInWithOtp({ email, options: { emailRedirectTo: ritorno(), shouldCreateUser: false } }))
  const recuperaPassword = (email) => esegui((c) => c.auth.resetPasswordForEmail(email, { redirectTo: ritorno() }))
  const nuovaPassword = async (password) => {
    const r = await esegui((c) => c.auth.updateUser({ password }))
    if (r.ok) aggiorna({ recuperoPassword: false })
    return r
  }
  const esci = () => esegui((c) => c.auth.signOut())

  const aggiornaNome = async (nome, cognome) => {
    const valori = { nome: nome.trim().slice(0, 60), cognome: cognome.trim().slice(0, 60) }
    const r = await esegui((c) => c.from("profili").update(valori).eq("id", stato.utente.id))
    if (r.ok) aggiorna((s) => ({ profilo: { ...s.profilo, ...valori } }))
    return r
  }

  const ePreferito = (tipo, elemento) => stato.preferiti.has(`${tipo}::${elemento}`)

  const togglePreferito = async (tipo, elemento) => {
    if (!stato.utente || !elemento) return { ok: false, errore: "non_autenticato" }
    const chiave = `${tipo}::${elemento}`
    const giaPresente = stato.preferiti.has(chiave)
    // Aggiornamento ottimistico: il cuore cambia subito, si annulla se il server rifiuta.
    const applica = (presente) => aggiorna((s) => {
      const nuovi = new Set(s.preferiti)
      if (presente) nuovi.add(chiave); else nuovi.delete(chiave)
      return { preferiti: nuovi }
    })
    applica(!giaPresente)
    const r = await esegui((c) => giaPresente
      ? c.from("preferiti").delete().match({ utente_id: stato.utente.id, tipo, elemento })
      : c.from("preferiti").insert({ tipo, elemento }))
    if (!r.ok) applica(giaPresente)
    return r
  }

  const inviaContributo = async ({ indiceCategoria, riferimento, descrizione, fonte, file }) => {
    if (!stato.utente) return { ok: false, errore: "non_autenticato" }
    const client = await avvia()
    let foto = null
    if (file) {
      const estensione = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "")
      foto = `${stato.utente.id}/${Date.now()}.${estensione}`
      const up = await client.storage.from("contributi").upload(foto, file, { contentType: file.type, upsert: false })
      if (up.error) return { ok: false, errore: up.error.message }
    }
    const r = await esegui((c) => c.from("contributi").insert({
      tipo: TIPI_CONTRIBUTO[indiceCategoria] || "correzione",
      riferimento_tipo: riferimento?.tipo || null,
      riferimento: riferimento?.nome || null,
      descrizione: descrizione.trim(),
      fonte: fonte?.trim() || null,
      foto,
    }).select("id, tipo, riferimento_tipo, riferimento, descrizione, stato, punti_assegnati, nota_revisione, creato_il").single())
    if (r.ok && r.dati) aggiorna((s) => ({ contributi: [r.dati, ...s.contributi] }))
    return r
  }

  // --- Revisione (solo admin: le funzioni SQL lo verificano comunque) ---
  const contributiDaRevisionare = () => esegui((c) => c.from("contributi")
    .select("id, utente_id, tipo, riferimento_tipo, riferimento, descrizione, fonte, foto, creato_il")
    .eq("stato", "in_attesa").order("creato_il", { ascending: true }).limit(100))
  const urlFoto = (percorso) => esegui((c) => c.storage.from("contributi").createSignedUrl(percorso, 3600))
  const approva = (id, punti) => esegui((c) => c.rpc("approva_contributo", { contributo: id, punti_override: punti ?? null }))
  const rifiuta = (id, nota) => esegui((c) => c.rpc("rifiuta_contributo", { contributo: id, nota: nota || null }))
  const regolePunti = () => esegui((c) => c.from("regole_punti").select("tipo, punti"))

  return {
    ...stato,
    admin: stato.profilo?.ruolo === "admin",
    avvia, registrati, accedi, accediCon, linkAccesso, recuperaPassword, nuovaPassword, esci, aggiornaNome,
    ePreferito, togglePreferito, inviaContributo,
    contributiDaRevisionare, urlFoto, approva, rifiuta, regolePunti,
  }
}
