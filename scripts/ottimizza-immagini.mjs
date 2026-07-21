import fs from "fs"
import path from "path"
import sharp from "sharp"

const DIR = path.resolve(import.meta.dirname, "..", "public", "immagini")
const MAX_LATO = 1100
const QUALITA = 78

async function main() {
  const file = fs.readdirSync(DIR).filter((f) => /\.(jpe?g|png)$/i.test(f))
  let totalePrima = 0, totaleDopo = 0, saltati = 0, processati = 0

  for (const nome of file) {
    const p = path.join(DIR, nome)
    const prima = fs.statSync(p).size
    totalePrima += prima

    // Legge tutto il file in memoria prima di passarlo a sharp: su Windows,
    // lavorare direttamente sul path tenendo poi aperto lo stesso file in
    // scrittura causa errori EPERM/UNKNOWN per via del lock del filesystem.
    const inputBuffer = fs.readFileSync(p)
    const meta = await sharp(inputBuffer).metadata()
    const lato = Math.max(meta.width || 0, meta.height || 0)

    if (lato <= MAX_LATO && meta.format === "jpeg" && prima < 300 * 1024) {
      // già abbastanza piccola, non vale la pena ricomprimere
      totaleDopo += prima
      saltati++
      continue
    }

    const buffer = await sharp(inputBuffer)
      .rotate() // applica l'orientamento EXIF prima di ridimensionare
      .resize({ width: MAX_LATO, height: MAX_LATO, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: QUALITA, mozjpeg: true })
      .toBuffer()

    if (buffer.length < prima) {
      fs.writeFileSync(p, buffer)
      totaleDopo += buffer.length
    } else {
      totaleDopo += prima
    }
    processati++
    if (processati % 100 === 0) console.log(`ottimizza-immagini: ...${processati}/${file.length}`)
  }

  if (processati === 0) {
    console.log("ottimizza-immagini: nessuna immagine da ottimizzare")
    return
  }
  console.log(`ottimizza-immagini: ${processati} immagini ottimizzate (${saltati} già ok su ${file.length} totali)`)
  console.log(`ottimizza-immagini: ${(totalePrima / 1024 / 1024).toFixed(1)} MB -> ${(totaleDopo / 1024 / 1024).toFixed(1)} MB (-${(100 - (totaleDopo / totalePrima) * 100).toFixed(0)}%)`)
}

main()
