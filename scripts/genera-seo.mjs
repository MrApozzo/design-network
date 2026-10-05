import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const DATA = join(ROOT, 'src', 'data')
const ORIGIN = 'https://design.encyclopedie-visuelle.com'
const SITE_NAME = 'Design Network'
const DEFAULT_DESCRIPTION = 'Esplora designer, oggetti, aziende e correnti attraverso una mappa interattiva della storia del design.'

const load = async (name) => JSON.parse(await readFile(join(DATA, `${name}.json`), 'utf8'))
const [designers, prodotti, aziende, correnti] = await Promise.all([
  load('designers'), load('prodotti'), load('aziende'), load('correnti'),
])

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const clean = (value = '') => String(value).replace(/\s+/g, ' ').trim()
const shorten = (value, max = 158) => {
  const text = clean(value)
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}
const slugBase = (value) => {
  const slug = String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'voce'
  // Evita i nomi di dispositivo riservati da Windows anche quando la build
  // viene poi pubblicata su un filesystem Linux (per esempio il prodotto Nul).
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(slug) ? `voce-${slug}` : slug
}
const asList = (value) => Array.isArray(value) ? value : value ? [value] : []
const yearRange = (start, end) => [start, end].filter(Boolean).join('–')
const url = (path) => `${ORIGIN}${path}`
const imageUrl = (file) => file ? url(`/immagini/${encodeURIComponent(file)}`) : url('/og-design-network.png')

function assignSlugs(items) {
  const used = new Map()
  return items.map((item) => {
    const base = slugBase(item.nome)
    const count = (used.get(base) || 0) + 1
    used.set(base, count)
    return count === 1 ? base : `${base}-${count}`
  })
}

const designerSlugs = assignSlugs(designers)
const prodottoSlugs = assignSlugs(prodotti)
const aziendaSlugs = assignSlugs(aziende)
const correnteSlugs = assignSlugs(correnti)
const firstIndexByName = (items) => new Map(items.map((item, index) => [item.nome, index]))
const designerByName = firstIndexByName(designers)
const aziendaByName = firstIndexByName(aziende)
const correnteByName = firstIndexByName(correnti)

const css = `
:root{color-scheme:light;font-family:Roboto,Arial,sans-serif;background:#e8e8e8;color:#171717}
*{box-sizing:border-box}body{margin:0}a{color:inherit}header,main,footer{width:min(920px,calc(100% - 40px));margin:auto}
header{display:flex;justify-content:space-between;align-items:center;padding:24px 0;border-bottom:1px solid #bbb}
.brand{text-decoration:none;font-weight:700}.map-link,.pill{border:1px solid #aaa;border-radius:999px;padding:8px 13px;text-decoration:none}
main{padding:64px 0 80px}h1{font-family:Georgia,serif;font-size:clamp(42px,8vw,86px);font-weight:400;line-height:.95;margin:0 0 24px}
.eyebrow{text-transform:uppercase;letter-spacing:.13em;font-size:12px;color:#666;margin-bottom:18px}.lead{font-family:Georgia,serif;font-size:22px;line-height:1.55;max-width:760px}
.facts{display:flex;flex-wrap:wrap;gap:10px;margin:28px 0 46px}.content{font-size:17px;line-height:1.75;max-width:760px}.content p{white-space:pre-line}
h2{font-family:Georgia,serif;font-size:30px;font-weight:400;margin-top:56px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;padding:0;list-style:none}
.grid a{display:block;background:#f4f2ee;border-radius:8px;padding:15px;text-decoration:none}.grid small{display:block;color:#666;margin-top:5px}
.hero{width:100%;max-height:520px;object-fit:contain;object-position:left center;margin:20px 0 34px}footer{padding:25px 0 40px;border-top:1px solid #bbb;color:#666;font-size:13px}
@media(max-width:600px){header{align-items:flex-start;gap:18px}main{padding-top:42px}.map-link{font-size:12px}h1{font-size:48px}}
`

function jsonLd(data) {
  return JSON.stringify(data).replaceAll('<', '\\u003c')
}

function layout({ title, description, canonical, type, image, body, schema }) {
  const fullTitle = title === SITE_NAME ? `${SITE_NAME} — Mappa interattiva della storia del design` : `${title} | ${SITE_NAME}`
  const safeDescription = shorten(description || DEFAULT_DESCRIPTION)
  const imageAbsolute = image || url('/og-design-network.png')
  return `<!doctype html>
<html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title><meta name="description" content="${esc(safeDescription)}"><meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${esc(canonical)}"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="article"><meta property="og:locale" content="it_IT"><meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(fullTitle)}"><meta property="og:description" content="${esc(safeDescription)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="${esc(imageAbsolute)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(fullTitle)}"><meta name="twitter:description" content="${esc(safeDescription)}"><meta name="twitter:image" content="${esc(imageAbsolute)}">
<style>${css}</style><script type="application/ld+json">${jsonLd(schema)}</script></head>
<body><header><a class="brand" href="/">Design Network</a><a class="map-link" href="/">Apri la mappa interattiva</a></header>
<main><div class="eyebrow">${esc(type)}</div>${body}</main>
<footer>Design Network — Archivio visuale della storia del design</footer></body></html>`
}

const cards = (items) => items.length ? `<ul class="grid">${items.map(({ href, title, note }) => `<li><a href="${esc(href)}">${esc(title)}${note ? `<small>${esc(note)}</small>` : ''}</a></li>`).join('')}</ul>` : ''
const paragraph = (text) => clean(text) ? `<div class="content"><p>${esc(text)}</p></div>` : ''
const hero = (foto, alt) => foto ? `<img class="hero" src="/immagini/${esc(encodeURIComponent(foto))}" alt="${esc(alt)}" loading="eager">` : ''

const pages = []
function addPage(path, html) { pages.push({ path, html }) }
const entityLink = (kind, index, slugs) => `/${kind}/${slugs[index]}/`
const mapLink = (kind, slug) => `/#${kind}-${slug}`

designers.forEach((item, index) => {
  const path = entityLink('designer', index, designerSlugs)
  const relatedProducts = prodotti.flatMap((p, i) => asList(p.designer).includes(item.nome) ? [{ href: entityLink('prodotto', i, prodottoSlugs), title: p.nome, note: [p.anno, p.azienda].filter(Boolean).join(' · ') }] : [])
  const movements = [...asList(item.scuole), ...asList(item.collettivi)].flatMap((name) => correnteByName.has(name) ? [{ href: entityLink('corrente', correnteByName.get(name), correnteSlugs), title: name }] : [])
  const life = yearRange(item.nato, item.morto)
  const description = item.bio || `${item.nome}, designer${life ? ` (${life})` : ''}: opere e relazioni nella storia del design.`
  const body = `<h1>${esc(item.nome)}</h1><p><a class="pill" href="${mapLink('designer', designerSlugs[index])}">Vedi ${esc(item.nome)} nella mappa</a></p>${hero(item.foto, item.nome)}<div class="facts">${life ? `<span class="pill">${esc(life)}</span>` : ''}</div>${paragraph(item.bio)}${movements.length ? `<h2>Correnti e gruppi</h2>${cards(movements)}` : ''}${relatedProducts.length ? `<h2>Opere e prodotti</h2>${cards(relatedProducts)}` : ''}`
  addPage(path, layout({ title: item.nome, description, canonical: url(path), type: 'Designer', image: imageUrl(item.foto), body, schema: { '@context': 'https://schema.org', '@type': 'Person', name: item.nome, birthDate: item.nato ? String(item.nato) : undefined, deathDate: item.morto ? String(item.morto) : undefined, description: clean(item.bio), image: item.foto ? imageUrl(item.foto) : undefined, url: url(path) } }))
})

prodotti.forEach((item, index) => {
  const path = entityLink('prodotto', index, prodottoSlugs)
  const creators = asList(item.designer)
  const creatorCards = creators.flatMap((name) => designerByName.has(name) ? [{ href: entityLink('designer', designerByName.get(name), designerSlugs), title: name }] : [])
  const companyCards = item.azienda && aziendaByName.has(item.azienda) ? [{ href: entityLink('azienda', aziendaByName.get(item.azienda), aziendaSlugs), title: item.azienda }] : []
  const facts = [item.anno_label || item.anno, item.categoria, item.azienda].filter(Boolean)
  const description = item.descrizione || `${item.nome}${item.anno ? ` (${item.anno})` : ''}, ${item.categoria || 'oggetto di design'}${creators.length ? ` di ${creators.join(', ')}` : ''}${item.azienda ? ` per ${item.azienda}` : ''}.`
  const body = `<h1>${esc(item.nome)}</h1><p><a class="pill" href="${mapLink('prodotto', prodottoSlugs[index])}">Vedi ${esc(item.nome)} nella mappa</a></p>${hero(item.foto, item.nome)}<div class="facts">${facts.map((fact) => `<span class="pill">${esc(fact)}</span>`).join('')}</div>${paragraph(description)}${creatorCards.length ? `<h2>Designer</h2>${cards(creatorCards)}` : ''}${companyCards.length ? `<h2>Azienda</h2>${cards(companyCards)}` : ''}`
  addPage(path, layout({ title: item.nome, description, canonical: url(path), type: 'Oggetto di design', image: imageUrl(item.foto), body, schema: { '@context': 'https://schema.org', '@type': ['Product', 'CreativeWork'], name: item.nome, dateCreated: item.anno ? String(item.anno) : undefined, category: item.categoria, genre: item.categoria, creator: creators.map((name) => ({ '@type': 'Person', name })), manufacturer: item.azienda ? { '@type': 'Organization', name: item.azienda } : undefined, image: item.foto ? imageUrl(item.foto) : undefined, description: clean(description), url: url(path) } }))
})

aziende.forEach((item, index) => {
  const path = entityLink('azienda', index, aziendaSlugs)
  const relatedProducts = prodotti.flatMap((p, i) => [p.azienda, p.azienda_attuale].includes(item.nome) ? [{ href: entityLink('prodotto', i, prodottoSlugs), title: p.nome, note: [p.anno, ...asList(p.designer)].filter(Boolean).join(' · ') }] : [])
  const facts = [item.paese, item.fondata ? `Fondata nel ${item.fondata}` : '', item.settore].filter(Boolean)
  const description = item.descrizione || `${item.nome}: azienda attiva nella storia del design${item.paese ? ` in ${item.paese}` : ''}.`
  const body = `<h1>${esc(item.nome)}</h1><p><a class="pill" href="${mapLink('azienda', aziendaSlugs[index])}">Vedi ${esc(item.nome)} nella mappa</a></p><div class="facts">${facts.map((fact) => `<span class="pill">${esc(fact)}</span>`).join('')}</div>${paragraph(item.descrizione)}${relatedProducts.length ? `<h2>Prodotti</h2>${cards(relatedProducts)}` : ''}`
  addPage(path, layout({ title: item.nome, description, canonical: url(path), type: 'Azienda', body, schema: { '@context': 'https://schema.org', '@type': 'Organization', name: item.nome, foundingDate: item.fondata ? String(item.fondata) : undefined, description: clean(description), address: item.paese ? { '@type': 'PostalAddress', addressCountry: item.paese } : undefined, url: url(path) } }))
})

correnti.forEach((item, index) => {
  const path = entityLink('corrente', index, correnteSlugs)
  const members = designers.flatMap((d, i) => [...asList(d.scuole), ...asList(d.collettivi)].includes(item.nome) ? [{ href: entityLink('designer', i, designerSlugs), title: d.nome, note: yearRange(d.nato, d.morto) }] : [])
  const period = yearRange(item.annoInizio, item.annoFine)
  const description = item.descrizione || item.descrizioneBreve || `${item.nome}: corrente o gruppo nella storia del design.`
  const body = `<h1>${esc(item.nome)}</h1>${period ? `<div class="facts"><span class="pill">${esc(period)}</span></div>` : ''}${paragraph(description)}${members.length ? `<h2>Designer collegati</h2>${cards(members)}` : ''}`
  addPage(path, layout({ title: item.nome, description, canonical: url(path), type: 'Corrente o gruppo', body, schema: { '@context': 'https://schema.org', '@type': 'DefinedTerm', name: item.nome, description: clean(description), url: url(path) } }))
})

const allSections = [
  ['Designer', designers.map((d, i) => ({ href: entityLink('designer', i, designerSlugs), title: d.nome, note: yearRange(d.nato, d.morto) }))],
  ['Oggetti', prodotti.map((p, i) => ({ href: entityLink('prodotto', i, prodottoSlugs), title: p.nome, note: [p.anno, ...asList(p.designer)].filter(Boolean).join(' · ') }))],
  ['Aziende', aziende.map((a, i) => ({ href: entityLink('azienda', i, aziendaSlugs), title: a.nome, note: a.paese }))],
  ['Correnti e gruppi', correnti.map((c, i) => ({ href: entityLink('corrente', i, correnteSlugs), title: c.nome, note: yearRange(c.annoInizio, c.annoFine) }))],
]
const catalogBody = `<h1>Archivio del design</h1><p class="lead">Designer, oggetti, aziende, correnti e gruppi raccontati attraverso le loro relazioni.</p>${allSections.map(([title, items]) => `<h2 id="${slugBase(title)}">${title} <small>(${items.length})</small></h2>${cards(items)}`).join('')}`
addPage('/esplora/', layout({ title: 'Archivio del design', description: DEFAULT_DESCRIPTION, canonical: url('/esplora/'), type: 'Indice', body: catalogBody, schema: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Archivio del design', description: DEFAULT_DESCRIPTION, url: url('/esplora/') } }))

await Promise.all(pages.map(async ({ path, html }) => {
  const output = join(DIST, path.slice(1), 'index.html')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, html, 'utf8')
}))

const today = new Date().toISOString().slice(0, 10)
const sitemapPaths = ['/', ...pages.map(({ path }) => path)]
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapPaths.map((path) => `  <url><loc>${esc(url(path))}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`
await writeFile(join(DIST, 'sitemap.xml'), sitemap, 'utf8')
await writeFile(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${url('/sitemap.xml')}\n`, 'utf8')
await copyFile(join(ROOT, 'public', 'og-design-network.png'), join(DIST, 'og-design-network.png'))
console.log(`SEO: generate ${pages.length} pagine indicizzabili e sitemap con ${sitemapPaths.length} URL.`)
