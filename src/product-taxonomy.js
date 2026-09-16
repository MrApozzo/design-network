const REGOLE = [
  ["Sedute modulari", /sistema.*sedut|sedut.*modular|sistema di sedute/],
  ["Sedie", /\b(sedia|sedie|seggiola|seduta)\b/],
  ["Poltrone", /\b(poltrona|poltrone|poltroncina|berg[eè]re|chaise longue|pouf|poggiapiedi)\b/],
  ["Divani", /\b(divano|divani|divanetto)\b/],
  ["Panche", /\b(panca|panche|panchina|cassapanca)\b/],
  ["Sgabelli", /\bsgabell/],
  ["Tavoli", /\b(tavolo|tavoli|scrivania|scrittoio|consolle)\b/],
  ["Tavolini", /\b(tavolino|tavolini)\b/],
  ["Illuminazione", /lamp|plafoniera|applique|faretto|illuminazione/],
  ["Vasi", /vas[oi]|scultur.*(vetro|ceramica|mosaico)|oggett.*vetro|totem.*ceramica/],
  ["Specchi", /specchi|specchier/],
  ["Contenitori", /contenitor|mobile|credenza|madia|armadio|cassett|libreria|mensola|scaffale|comodino|secretaire/],
  ["Letti", /\b(letto|letti|lettino)\b/],
  ["Tavola e cucina", /piatt|posat|bicchier|tazz|teier|caff|bollitor|pentol|padella|vasso|caraffa|fiasca|bottiglia|coppa|oliera|salsiera|fruttiera|ciotol|centrotavola|posacenere|servizio da|oggetti per la tavola|cucina|toast|frullator|spremiagrumi|cavatappi|apribottiglie|macina|montalatte|thermos|formaggiera|scolapasta|saliera|pepiera|bacchette|schiaccianoci|secchiello/],
  ["Tecnologia", /computer|informatic|workstation|calcolatric|addizionatrice|telefono|televis|radio|hi-fi|giradischi|stampante|terminale|tastiera|fax|proiettore|fotografic|macchina da scrivere|microfilm|codificatore|elettronica/],
  ["Macchine", /macchina utensile|macchina da cucire|centro di misura|centrale polifunzionale|centro di lavorazione|condizionatore/],
  ["Bagno", /lavabo|sanitari|rubinetto|scopino/],
  ["Accessori", /orolog|sveglia|appendiabiti|maniglia|portaombrelli|portariviste|portamatite|portaoggetti|portagioie|portalibri|portacarte|portastuzzicadenti|scatola|cestino|tagliacarte|salvadanaio|decorazione|valigie|calendario|timer|candeliere|candelabro|candelieri|miniatura|scaletta|carrello|libro/],
  ["Tessili e superfici", /tappet|arazz|tessuto|cuscino|piastrell|pavimento|superficie|pannello|parete decorativa|vetrata/],
  ["Architettura e sistemi", /architettura|allestimento|sistema abitativo|porta\b|progetto teorico/],
  ["Sistemi d'arredo", /sistema|postazione|serie di arredi/],
  ["Collezioni", /collezione|serie di sedute|famiglia di/],
  ["Oggetti decorativi", /scultura|oggetto|colonne in mosaico|bacheca|paravento|pannelli in alluminio/],
  ["Giochi", /gioco|puzzle/],
]

const SEMPLICI = new Set([
  "sedia", "sedie", "poltrona", "poltrone", "divano", "divani", "sgabello",
  "tavolo", "tavolino", "letto", "specchio", "vaso", "vasi", "libreria",
])

const ORDINE_CATEGORIE = [
  "Sedie", "Poltrone", "Divani", "Sgabelli", "Panche", "Sedute modulari",
  "Tavoli", "Tavolini", "Contenitori", "Letti", "Illuminazione", "Vasi",
  "Specchi", "Tavola e cucina", "Accessori", "Tessili e superfici", "Tecnologia",
  "Macchine", "Bagno", "Sistemi d'arredo", "Architettura e sistemi",
  "Oggetti decorativi", "Collezioni", "Giochi",
]
const INDICE_CATEGORIA = new Map(ORDINE_CATEGORIE.map((categoria, indice) => [categoria, indice]))

function titolo(testo) {
  return String(testo || "Altro").trim().replace(/^./, c => c.toUpperCase())
}

export function classificaProdotto(prodotto) {
  const originale = String(prodotto.categoria || "Altro").trim()
  const normalizzata = originale.toLocaleLowerCase("it")
  const regola = REGOLE.find(([, re]) => re.test(normalizzata))
  const categoria = regola?.[0] || titolo(originale)
  const sottocategoria = SEMPLICI.has(normalizzata) || categoria.toLocaleLowerCase("it") === normalizzata
    ? null
    : titolo(originale)
  return { categoria, sottocategoria }
}

export function confrontaProdottiClassificati(a, b, getDesigners) {
  const ca = classificaProdotto(a), cb = classificaProdotto(b)
  return (INDICE_CATEGORIA.get(ca.categoria) ?? 999) - (INDICE_CATEGORIA.get(cb.categoria) ?? 999)
    || ca.categoria.localeCompare(cb.categoria, "it")
    || (ca.sottocategoria || "").localeCompare(cb.sottocategoria || "", "it")
    || (getDesigners(a)[0] || "").localeCompare(getDesigners(b)[0] || "", "it")
    || (a.anno || 0) - (b.anno || 0)
    || a.nome.localeCompare(b.nome, "it")
}
