#!/usr/bin/env node
// Sincronizza automaticamente il campo "foto_dettaglio" di ogni prodotto in
// prodotti.json con le immagini extra presenti su disco. Convenzione: se un
// prodotto ha foto "nomefile.jpg", le foto aggiuntive si chiamano
// "nomefile2.jpg", "nomefile3.jpg", ecc. (stessa estensione, numerazione
// progressiva senza salti a partire da 2). Così aggiungere un'immagine con
// quel nome basta a farla comparire nello slider del prodotto, senza dover
// ricordarsi di modificare il json a mano.

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const IMMAGINI_DIR = path.join(ROOT, "public", "immagini")
const PRODOTTI_PATH = path.join(ROOT, "src", "data", "prodotti.json")

const fileEsistenti = new Set(fs.readdirSync(IMMAGINI_DIR))

function trovaFotoDettaglio(fotoPrincipale) {
  const match = fotoPrincipale.match(/^(.*?)(\.[^.]+)$/)
  if (!match) return []
  const [, base, ext] = match
  const dettagli = []
  let n = 2
  while (fileEsistenti.has(`${base}${n}${ext}`)) {
    dettagli.push(`${base}${n}${ext}`)
    n++
  }
  return dettagli
}

const prodotti = JSON.parse(fs.readFileSync(PRODOTTI_PATH, "utf8"))
let modificati = 0

for (const prodotto of prodotti) {
  const dettagli = trovaFotoDettaglio(prodotto.foto)
  const attuali = prodotto.foto_dettaglio || []
  const cambiato = dettagli.length !== attuali.length || dettagli.some((f, i) => f !== attuali[i])
  if (!cambiato) continue
  modificati++
  if (dettagli.length > 0) {
    prodotto.foto_dettaglio = dettagli
  } else {
    delete prodotto.foto_dettaglio
  }
}

if (modificati > 0) {
  fs.writeFileSync(PRODOTTI_PATH, JSON.stringify(prodotti, null, 2) + "\n")
  console.log(`sync-foto-dettaglio: aggiornati ${modificati} prodotti in prodotti.json`)
} else {
  console.log("sync-foto-dettaglio: nessuna modifica necessaria")
}
