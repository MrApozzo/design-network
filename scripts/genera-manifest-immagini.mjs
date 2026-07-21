import fs from "fs"
import path from "path"

const DIR = path.resolve(import.meta.dirname, "..", "public", "immagini")
const OUT = path.resolve(import.meta.dirname, "..", "src", "data", "immagini_esistenti.json")

const file = fs.readdirSync(DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
fs.writeFileSync(OUT, JSON.stringify(file) + "\n")
console.log(`genera-manifest-immagini: ${file.length} file elencati in ${path.relative(process.cwd(), OUT)}`)
