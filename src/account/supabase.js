// Client Supabase caricato su richiesta.
//
// URL e chiave pubblica ("anon key") arrivano dalle variabili di build
// VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (in locale: file .env.local;
// in produzione: variabili del repository GitHub, vedi deploy.yml). La anon
// key è pubblica per progetto: la sicurezza dei dati è affidata alle regole
// Row Level Security in supabase/schema.sql.
//
// Senza variabili il sito funziona come prima e le funzioni account restano
// nascoste. La libreria (~50 KB compressi) non entra nel caricamento
// iniziale della mappa: viene scaricata solo se serve.

const URL_SUPABASE = import.meta.env.VITE_SUPABASE_URL
const CHIAVE_SUPABASE = import.meta.env.VITE_SUPABASE_ANON_KEY

export const accountConfigurato = Boolean(URL_SUPABASE && CHIAVE_SUPABASE)

let clientPromessa = null

export function ottieniClient() {
  if (!accountConfigurato) return Promise.resolve(null)
  if (!clientPromessa) {
    clientPromessa = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(URL_SUPABASE, CHIAVE_SUPABASE, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }))
  }
  return clientPromessa
}

// Vero se nel browser c'è già una sessione salvata (utente che torna) o se
// l'URL contiene il ritorno da un link email: in quei casi conviene caricare
// subito il client invece di aspettare che l'utente apra il pannello.
export function sessioneProbabile() {
  if (!accountConfigurato) return false
  if (/[#&?](access_token|code|error_description)=/.test(window.location.href)) return true
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) return true
    }
  } catch { /* storage non disponibile */ }
  return false
}

// Chiave stabile di un elemento nei preferiti. I prodotti possono avere nomi
// uguali, quindi si aggiunge il file della foto (come per le pagine SEO).
export function chiaveElemento(tipo, dati) {
  if (!dati) return null
  return tipo === "prodotto" ? `${dati.nome}|${dati.foto || ""}` : dati.nome
}
