// Percorsi delle pagine SEO statiche (generate da scripts/genera-seo.mjs):
// gli slug devono restare identici a quelli dello script.
import designers from "./data/designers.json"
import prodotti from "./data/prodotti.json"
import aziendeData from "./data/aziende.json"

export function seoSlugBase(value) {
  const slug = String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "voce"
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(slug) ? `voce-${slug}` : slug
}

export function seoSlugs(items) {
  const usati = new Map()
  return items.map((item) => {
    const base = seoSlugBase(item.nome)
    const numero = (usati.get(base) || 0) + 1
    usati.set(base, numero)
    return numero === 1 ? base : `${base}-${numero}`
  })
}

export const SEO_ENTITA = {
  designer: { items: designers, slugs: seoSlugs(designers) },
  prodotto: { items: prodotti, slugs: seoSlugs(prodotti) },
  azienda: { items: aziendeData, slugs: seoSlugs(aziendeData) },
}

export function indiceEntitaSeo(tipo, dati) {
  const gruppo = SEO_ENTITA[tipo]
  if (!gruppo) return -1
  return gruppo.items.findIndex((item) => item.nome === dati.nome
    && (tipo !== "prodotto" || item.foto === dati.foto))
}

export function percorsoEntitaSeo(tipo, dati) {
  const indice = indiceEntitaSeo(tipo, dati)
  return indice >= 0 ? `/${tipo}/${SEO_ENTITA[tipo].slugs[indice]}/` : "/esplora/"
}
