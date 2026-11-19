// `sogliaPronte`/`onSoglia` permettono opzionalmente di segnalare quando un
// primo lotto di immagini è pronto. Il preload continua comunque in background;
// questa soglia non controlla più la schermata iniziale, che resta visibile fino
// a quando l'utente sceglie esplicitamente di entrare nella mappa.
// ottieniDistanza(src), se passata, viene interrogata ad ogni slot libero per
// scegliere l'immagine non ancora avviata più vicina alla camera ATTUALE (non
// quella di partenza): così, se l'utente si sposta prima che il lotto iniziale
// finisca, il resto del caricamento segue dove sta guardando ora invece di
// insistere sull'ordine calcolato all'apertura. Senza questo parametro si
// mantiene il comportamento originale (ordine fisso di `paths`).
export function preloadImages(paths, concorrenza = 6, onDone, sogliaPronte, onSoglia, onImmagineSingola, ottieniDistanza) {
  const cache = {}
  const rimanenti = new Set(paths)
  const totale = paths.length
  let completate = 0
  let sogliaRaggiunta = false
  paths.forEach((src) => { cache[src] = new Image() })
  let attive = 0
  function prossimaSorgente() {
    if (rimanenti.size === 0) return null
    if (!ottieniDistanza) {
      const src = rimanenti.values().next().value
      rimanenti.delete(src)
      return src
    }
    let scelta = null, distanzaMigliore = Infinity
    ottieniDistanza.prepara?.()
    for (const src of rimanenti) {
      const d = ottieniDistanza(src)
      if (d < distanzaMigliore) { distanzaMigliore = d; scelta = src }
    }
    rimanenti.delete(scelta)
    return scelta
  }
  function avviaProssima() {
    if (attive >= concorrenza) return
    const src = prossimaSorgente()
    if (src === null) return
    const img = cache[src]
    attive++
    const fine = () => {
      attive--; completate++
      if (!sogliaRaggiunta && sogliaPronte && completate >= sogliaPronte) {
        sogliaRaggiunta = true
        if (onSoglia) onSoglia()
      }
      if (completate >= totale && onDone) onDone()
      avviaProssima()
    }
    // Senza questo, un'immagine arrivata in background (dopo che l'utente ha smesso
    // di interagire) restava invisibile finché un pan/zoom successivo non richiedeva
    // un nuovo frame: il canvas overlay si ridisegna solo su richiesta, mai in loop continuo.
    img.addEventListener("load", () => { fine(); if (onImmagineSingola) onImmagineSingola() }, { once: true })
    img.addEventListener("error", fine, { once: true })
    img.src = src
    avviaProssima()
  }
  if (totale === 0) {
    if (onSoglia) onSoglia()
    if (onDone) onDone()
  }
  for (let i = 0; i < concorrenza; i++) avviaProssima()
  return cache
}
