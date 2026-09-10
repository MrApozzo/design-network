import fs from "fs"
import path from "path"
import sharp from "sharp"

// Precalcola il colore medio di ogni thumbnail (usato come sfondo del pallino
// mentre l'immagine vera carica, o al posto di quest'ultima quando manca).
// Prima veniva ricalcolato nel browser via canvas/getImageData per TUTTE le
// ~1250 immagini ad ogni singolo caricamento della pagina (anche un refresh):
// il colore di un'immagine non cambia mai, quindi ha senso calcolarlo una
// volta qui in pipeline. Stesso identico algoritmo di campionaColore in
// App.jsx (resize 24x24 che ignora l'aspect ratio, esclude i pixel quasi
// bianchi di sfondo) così i valori restano coerenti con quelli storici.
const DIR_THUMB = path.resolve(import.meta.dirname, "..", "public", "immagini_thumb")
const OUT = path.resolve(import.meta.dirname, "..", "src", "data", "colori_immagini.json")
const DIM = 24

async function calcolaColoreMedio(pThumb) {
  const { data, info } = await sharp(pThumb)
    .resize(DIM, DIM, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const canali = info.channels
  let r = 0, g = 0, b = 0, conteggio = 0
  for (let i = 0; i < data.length; i += canali) {
    const pr = data[i], pg = data[i + 1], pb = data[i + 2]
    if (pr > 240 && pg > 240 && pb > 240) continue
    r += pr; g += pg; b += pb; conteggio++
  }
  if (conteggio === 0) { r = 255; g = 255; b = 255; conteggio = 1 }
  return `rgb(${Math.round(r / conteggio)},${Math.round(g / conteggio)},${Math.round(b / conteggio)})`
}

async function main() {
  const file = fs.readdirSync(DIR_THUMB).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  const esistenti = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf-8")) : {}
  const outMtime = fs.existsSync(OUT) ? fs.statSync(OUT).mtimeMs : 0
  const risultato = {}
  let processati = 0, saltati = 0

  for (const nome of file) {
    const pThumb = path.join(DIR_THUMB, nome)
    if (esistenti[nome] && fs.statSync(pThumb).mtimeMs <= outMtime) {
      risultato[nome] = esistenti[nome]
      saltati++
      continue
    }
    risultato[nome] = await calcolaColoreMedio(pThumb)
    processati++
    if (processati % 200 === 0) console.log(`genera-colori-immagini: ...${processati} calcolati`)
  }

  if (processati === 0) {
    console.log(`genera-colori-immagini: nessuna novità (${saltati} già ok su ${file.length} totali)`)
    return
  }
  fs.writeFileSync(OUT, JSON.stringify(risultato) + "\n")
  console.log(`genera-colori-immagini: ${processati} calcolati, ${saltati} già ok (${file.length} totali)`)
}

main()
