import fs from "fs"
import path from "path"
import sharp from "sharp"

// Versione "thumbnail" delle immagini, usata SOLO per i pallini disegnati sulla
// mappa (mai per il pannello/galleria di dettaglio, che continuano a usare la
// versione a piena risoluzione in public/immagini). I pallini non superano mai
// ~240px di diametro anche al massimo zoom+dpr, quindi non serve altro.
const DIR_SRC = path.resolve(import.meta.dirname, "..", "public", "immagini")
const DIR_OUT = path.resolve(import.meta.dirname, "..", "public", "immagini_thumb")
const MAX_LATO = 240
const QUALITA = 68

async function main() {
  if (!fs.existsSync(DIR_OUT)) fs.mkdirSync(DIR_OUT, { recursive: true })

  const file = fs.readdirSync(DIR_SRC).filter((f) => /\.(jpe?g|png)$/i.test(f))
  let totalePrima = 0, totaleDopo = 0, saltati = 0, processati = 0

  for (const nome of file) {
    const pSrc = path.join(DIR_SRC, nome)
    const pOut = path.join(DIR_OUT, nome)
    const prima = fs.statSync(pSrc).size
    totalePrima += prima

    // Rigenera solo se manca o se la sorgente è più recente (evita di rifare
    // tutte le migliaia di thumbnail ad ogni build quando cambia una sola foto).
    if (fs.existsSync(pOut) && fs.statSync(pOut).mtimeMs >= fs.statSync(pSrc).mtimeMs) {
      totaleDopo += fs.statSync(pOut).size
      saltati++
      continue
    }

    const inputBuffer = fs.readFileSync(pSrc)
    const buffer = await sharp(inputBuffer)
      .rotate()
      .resize({ width: MAX_LATO, height: MAX_LATO, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: QUALITA, mozjpeg: true })
      .toBuffer()

    fs.writeFileSync(pOut, buffer)
    totaleDopo += buffer.length
    processati++
    if (processati % 100 === 0) console.log(`genera-thumbnail-immagini: ...${processati}/${file.length}`)
  }

  // Rimuove thumbnail orfane (foto cancellata dalla sorgente).
  const validi = new Set(file)
  let rimossi = 0
  for (const nome of fs.readdirSync(DIR_OUT)) {
    if (!validi.has(nome)) { fs.unlinkSync(path.join(DIR_OUT, nome)); rimossi++ }
  }

  if (processati === 0 && rimossi === 0) {
    console.log(`genera-thumbnail-immagini: nessuna novità (${saltati} già ok su ${file.length} totali)`)
    return
  }
  console.log(`genera-thumbnail-immagini: ${processati} generate, ${rimossi} rimosse (${saltati} già ok su ${file.length} totali)`)
  console.log(`genera-thumbnail-immagini: sorgente ${(totalePrima / 1024 / 1024).toFixed(1)} MB -> thumbnail ${(totaleDopo / 1024 / 1024).toFixed(1)} MB`)
}

main()
