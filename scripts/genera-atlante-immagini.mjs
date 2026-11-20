import fs from "fs"
import path from "path"
import crypto from "crypto"
import sharp from "sharp"

// Atlante delle miniature: tutte le foto dei pallini (designer, prodotti,
// loghi delle aziende) impacchettate in pochi fogli WebP, così la mappa le
// carica con 4 richieste invece di ~1500. Ogni cella è un quadrato ritagliato
// al centro ("cover"), esattamente come il pallino rotondo ritaglia la foto.
// Le celle bastano per i pallini piccoli e medi; quando un pallino diventa più
// grande della cella, la mappa carica solo per lui la miniatura singola da
// public/immagini_thumb (vedi App.jsx, immagineNodo).
const RADICE = path.resolve(import.meta.dirname, "..")
const DIR_THUMB = path.join(RADICE, "public", "immagini_thumb")
const DIR_OUT = path.join(RADICE, "public", "atlante")
const FILE_MAPPA = path.join(RADICE, "src", "data", "atlante.json")
const CELLA = 96
const FOGLI = 4
const QUALITA = 72

async function main() {
  const file = fs.readdirSync(DIR_THUMB).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()
  const perFoglio = Math.ceil(file.length / FOGLI)
  const colonne = Math.ceil(Math.sqrt(perFoglio))

  // Il nome del foglio contiene un hash del contenuto: cambia solo quando
  // cambiano le foto, quindi il browser può tenerlo in cache a lungo.
  const hash = crypto.createHash("sha1")
  for (const f of file) hash.update(f).update(String(fs.statSync(path.join(DIR_THUMB, f)).size))
  const versione = hash.digest("hex").slice(0, 10)

  const precedente = fs.existsSync(FILE_MAPPA) ? JSON.parse(fs.readFileSync(FILE_MAPPA, "utf8")) : null
  if (precedente?.versione === versione && precedente.fogli.every((f) => fs.existsSync(path.join(RADICE, "public", f)))) {
    console.log(`genera-atlante-immagini: invariato (${file.length} miniature, versione ${versione})`)
    return
  }

  fs.mkdirSync(DIR_OUT, { recursive: true })
  for (const vecchio of fs.readdirSync(DIR_OUT)) fs.rmSync(path.join(DIR_OUT, vecchio))

  const celle = {}
  const fogli = []
  let byteTotali = 0
  for (let s = 0; s < FOGLI; s++) {
    const gruppo = file.slice(s * perFoglio, (s + 1) * perFoglio)
    if (gruppo.length === 0) break
    const righe = Math.ceil(gruppo.length / colonne)
    const composizione = await Promise.all(gruppo.map(async (nome, i) => {
      const x = (i % colonne) * CELLA
      const y = Math.floor(i / colonne) * CELLA
      celle[nome] = [s, x, y]
      const input = await sharp(path.join(DIR_THUMB, nome))
        .resize(CELLA, CELLA, { fit: "cover", position: "centre" })
        .flatten({ background: "#ffffff" })
        .toBuffer()
      return { input, left: x, top: y }
    }))
    const nomeFoglio = `atlante/atlante-${versione}-${s}.webp`
    const buffer = await sharp({ create: { width: colonne * CELLA, height: righe * CELLA, channels: 3, background: "#ffffff" } })
      .composite(composizione)
      .webp({ quality: QUALITA, effort: 5 })
      .toBuffer()
    fs.writeFileSync(path.join(RADICE, "public", nomeFoglio), buffer)
    fogli.push(nomeFoglio)
    byteTotali += buffer.length
  }

  fs.writeFileSync(FILE_MAPPA, JSON.stringify({ versione, cella: CELLA, fogli, celle }) + "\n")
  console.log(`genera-atlante-immagini: ${file.length} miniature in ${fogli.length} fogli da ${colonne} colonne, ${(byteTotali / 1024 / 1024).toFixed(2)} MB`)
}

main().catch((e) => { console.error(e); process.exit(1) })
