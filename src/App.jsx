import { useEffect, useState, useRef } from "react"
import Graph from "graphology"
import Sigma from "sigma"
import designers from "./data/designers.json"
import prodotti from "./data/prodotti.json"
import relazioni from "./data/relazioni.json"
import correnti from "./data/correnti.json"
import immaginiEsistentiArr from "./data/immagini_esistenti.json"

const IMMAGINI_ESISTENTI = new Set(immaginiEsistentiArr)

// Designer con pochi prodotti a catalogo (spesso una singola collaborazione con
// una figura più nota): il loro pallino viene rimpicciolito leggermente, vedi
// STILE.designer_scala_secondario e SOGLIA_DESIGNER_SECONDARIO.
const CONTEGGIO_PRODOTTI_PER_DESIGNER = new Map()
for (const p of prodotti) {
  const ds = Array.isArray(p.designer) ? p.designer : [p.designer]
  for (const d of ds) CONTEGGIO_PRODOTTI_PER_DESIGNER.set(d, (CONTEGGIO_PRODOTTI_PER_DESIGNER.get(d) ?? 0) + 1)
}
const SOGLIA_DESIGNER_SECONDARIO = 2

const STILE = {
  // --- Colori ---
  designer_colore: "#090e54",
  cursore_colore: "#1a2a8a",
  cursore_alone_colore: "#4466dd",
  cursore_raggio: 4,
  cursore_alone_raggio: 14,
  cursore_alone_velocita: 0.12,
  prodotto_colore: "#cccccc",
  bordo_colore: "#222222",
  bordo_spessore: 0.2,
  griglia_pallino_colore: "#d8d8d8",
  griglia_label_colore: "#5a5a5a",
  edge_prodotto_colore: "#cccccc",
  edge_relazione_colore: "#888888",
  sfondo_colore: "#e8e8e8",
  label_sfondo_colore: "#f0f0f0",
  prodotto_multi_bordo: "#999999",

  // --- Label (stile) ---
  label_min: 4,
  label_offset: 12,
  label_designer_peso: "600",
  label_designer_colore: "#222222",
  label_date_peso: "300",
  label_date_colore: "#999999",
  label_prodotto_peso: "300",
  label_prodotto_colore: "#555555",
  label_prodotto_anno_colore: "#aaaaaa",

  // --- Dimensioni fisse ---
  edge_prodotto_size: 0.5,
  edge_relazione_size: 1,
  designer_size: 8,
  prodotto_size: 5,
  // Fattore di scala per i prodotti marcati come "top" (campo prodotti.json:
  // top: true) — permette di dare risalto arbitrario ad alcuni pezzi senza
  // toccare il layout/posizionamento.
  prodotto_scala_top: 1.7,

  // =============================================
  //  ZOOM UNIFICATO (responsive)
  //  Scala logaritmica da lontano (min) a vicino (max).
  //  Tutti i valori in px, riferiti a un viewport di 800px.
  //  Su schermi più piccoli/grandi scalano automaticamente.
  //
  //  zoom_*_min        → dimensione a zoom completamente out
  //  zoom_*_max        → dimensione a zoom completamente in
  //  zoom_label_soglia → punto (0–1) in cui appaiono le label prodotti
  //  zoom_viewport_ref → viewport di riferimento per il ridimensionamento
  // =============================================
  zoom_designer_min: 3,
  zoom_designer_max: 18,
  // Moltiplicatore applicato ai designer con al massimo SOGLIA_DESIGNER_SECONDARIO
  // prodotti a catalogo (vedi CONTEGGIO_PRODOTTI_PER_DESIGNER).
  designer_scala_secondario: 0.5,
  zoom_prodotto_min: 2,
  zoom_prodotto_max: 35,
  // Boost aggiuntivo solo mobile, applicato a prodotti e designer solo
  // nell'ultimo tratto di zoom (da boost_soglia a 1): non tocca il resto della curva.
  boost_mobile_max: 2.7,
  boost_soglia: 0.9,
  // Stesso principio, ma per le etichette (nome prodotto + data): la
  // dimensione di base resta quasi sempre sul minimo (label_min) su mobile,
  // quindi qui il boost deve essere più marcato del solito per essere
  // percepibile, anche se il pallino non cresce altrettanto.
  boost_mobile_label_max: 2.2,
  // Boost aggiuntivo solo mobile, concentrato nella fascia di zoom 15%-80%:
  // sfuma a 0 ai bordi della fascia (nessun salto), picco al centro (~47%).
  // Non tocca desktop, non tocca la distanza pallino-prodotto/designer (quella
  // è un raggio fissato una sola volta in fase di layout, non ricalcolabile
  // solo per una fascia di zoom live senza rifare anche l'hit-test).
  boost_medio_soglia_min: 0.15,
  boost_medio_soglia_max: 0.8,
  boost_medio_label_max: 2.4,
  zoom_label_designer_min: 3,
  zoom_label_designer_max: 18,
  zoom_label_prodotto_max: 14,
  zoom_label_soglia: window.innerWidth < 768 ? 0.65 : 0.4,
  zoom_griglia_min: window.innerWidth < 768 ? 0.9 : 1.5,
  zoom_griglia_max: window.innerWidth < 768 ? 3 : 4,
  zoom_viewport_ref: 800,

  // --- Transizione tra viste ---
  transizione_stagger: 1,
  transizione_durata: 500,

  // --- Ameba correnti (scuole + collettivi) — disegno; il posizionamento che le
  // rende possibili è nella sezione "Layout verticale" più sotto ---
  corrente_raggio_punto_singolo: 20,
  // Margine oltre il raggio reale del pallino: frazione FISSA del raggio corrente del
  // pallino (non un valore interpolato a parte sullo zoom) — così il "di più" attorno a
  // ogni pallino resta sempre proporzionale a quanto è già grande lui stesso, invece di
  // gonfiarsi in modo indipendente e imprevedibile a certi livelli di zoom (a zoom alto
  // il margine finiva quasi quanto il raggio del pallino successivo, inglobando pallini
  // vicini che non c'entravano).
  corrente_margine_fattore: 0.75,
  corrente_irregolarita: 0.4,
  corrente_alpha: 0.045,
  // L'alone (anello) usava globalAlpha=1 a riposo: moltiplicarlo per corrente_hover_boost
  // in hover non cambiava nulla (il canvas blocca globalAlpha oltre 1), quindi l'hover
  // sugli aloni isolati non produceva alcun effetto visibile. Ora ha un'opacità a riposo
  // propria, più leggera, così l'hover ha davvero un salto percepibile.
  corrente_alone_alpha: 0.22,
  corrente_hover_boost: 3,
  corrente_alone_spessore: 2.5,
  corrente_alone_margine: 3,

  // --- Hover / interazione ---
  hover_scala: 2,
  hover_opacita_altri: 0.05,
  lerp_velocita: 0.15,

  // --- Layout verticale deterministico ---
  // Posizione Y = cronologica di base, con due livelli di RIORDINO in cascata (mai la
  // stessa forza): (1) co-progettazione — priorità massima, il designer più anziano del
  // gruppo resta nella propria fascia cronologica, i più giovani vengono inseriti subito
  // dopo con lo scarto minimo (passo_verticale_coprogetto), e questo blocco non viene MAI
  // spezzato dal passo successivo; (2) correnti (scuole/collettivi) — priorità inferiore,
  // applicata DOPO su interi blocchi già formati dal passo 1: blocchi che condividono una
  // corrente vengono avvicinati (mai spezzati), per far sì che le ameba possano racchiudere
  // più designer invece di ridursi quasi sempre ad aloni isolati. I legami (relazioni.json)
  // NON riordinano mai (testato: la chiusura transitiva sui legami arriva a spostare 60-70%
  // dei designer, un mega-gruppo che rompe la diagonale invece di ripararla) — quando però
  // due designer sono GIÀ adiacenti nell'ordine finale e condividono anche un legame
  // diretto, si stringe solo lo spazio verticale fra loro (passo_verticale_legame).
  passo_verticale_base: 30,
  passo_verticale_coprogetto: 6,
  passo_verticale_legame: 18,
  min_distanza_y: 1.6,
  orbita_raggio_base: 3.5,
  orbita_soglia_prodotti: 5,
  orbita_spazio_per_prodotto: 0.55,
  anello_raggio_interno: 1.0,
  anello_raggio_esterno: 3,
  // Raggio dell'orbita di un prodotto in base all'età del designer al momento della
  // progettazione (anno prodotto - anno di nascita): stessa età = stessa distanza dal
  // pallino, per qualsiasi designer, indipendentemente da quanti prodotti abbia in
  // totale. eta_riferimento è il pavimento (età sotto cui il raggio resta quello base,
  // niente prodotti "incollati" al pallino), eta_massima il soffitto (oltre cui non ci
  // si allontana ulteriormente, per non farsi distorcere da rari outlier anagrafici).
  eta_raggio_base: 32,
  eta_riferimento: 25,
  eta_massima: 90,
  eta_unita_per_anno: 1.55,
  eta_soglia_stesso_anno: 6,
  eta_incremento_sovraffollamento: 4.2,
  // Solo su mobile: avvicina i pallini prodotto al designer (schermo piccolo,
  // orbite piene richiedono troppo pan). Non tocca raggioMaxPerDesigner, quindi
  // la spaziatura verticale fra un designer e l'altro resta invariata: cambia
  // solo la distanza pallino-prodotto/pallino-designer.
  orbita_scala_mobile: 0.55,
  // Distanza minima (in unità-grafo) fra due pallini prodotto dello stesso
  // designer: se dopo il posizionamento normale risultano più vicini di così,
  // vengono spinti via l'uno dall'altro finché non lo sono più.
  prodotto_distanza_minima: 5,
  arco_inizio: 0.15,
  arco_fine: 1.85,
  arco_perturbazione: 0.4,
  // Scarto verticale tra prodotti dello stesso anno nella vista timeline: non è
  // legato a nessuna delle costanti di spaziatura sopra (quelle valgono per l'asse Y
  // dei designer), quindi va scalato a mano quando cresce il resto del layout.
  timeline_scarto_stesso_anno: 5,
}

const MACRO_CATEGORIE = {
  illuminazione: ["lampada", "lampadario"],
  sedute: ["sedia", "poltrona", "sgabello", "divano"],
  mobili: ["tavolo", "scrivania", "libreria", "cassettiera", "letto", "carrello", "contenitore", "appendiabiti"],
  oggetti: [],
}

const ORDINE_SETTORI = ["illuminazione", "sedute", "mobili", "oggetti"]

function getMacro(categoria) {
  for (const [macro, cats] of Object.entries(MACRO_CATEGORIE)) {
    if (cats.includes(categoria)) return macro
  }
  return "oggetti"
}

function calcolaSettoriDinamici(lista, arco360 = false) {
  const gruppi = {}
  lista.forEach((p, i) => {
    const m = getMacro(p.categoria)
    if (!gruppi[m]) gruppi[m] = []
    gruppi[m].push({ p, i })
  })
  const settoriPresenti = ORDINE_SETTORI.filter((s) => gruppi[s])
  const totale = lista.length
  const arcoInizio = arco360 ? 0 : Math.PI * STILE.arco_inizio
  const arcoFine = arco360 ? Math.PI * 2 : Math.PI * STILE.arco_fine
  const arcoTotale = arcoFine - arcoInizio
  const settori = {}
  let cursore = arcoInizio
  settoriPresenti.forEach((s) => {
    const n = gruppi[s].length
    const ampiezza = arcoTotale * (n / totale)
    const ordinati = [...gruppi[s]].sort((a, b) => {
      if (a.p.categoria !== b.p.categoria) return a.p.categoria.localeCompare(b.p.categoria)
      return (a.p.anno || 0) - (b.p.anno || 0)
    })
    settori[s] = { inizio: cursore, fine: cursore + ampiezza, prodotti: ordinati }
    cursore += ampiezza
  })
  return settori
}

// Spinge via dai loro vicini i punti (in coordinate assolute, mutate sul
// posto) più vicini di distanzaMinima, per qualche iterazione — risolve le
// sovrapposizioni residue tra prodotti di settori/età diversi che la sola
// suddivisione angolare non copre (in particolare quando le orbite sono
// compresse, es. su mobile, e la stessa separazione angolare corrisponde a
// meno distanza assoluta).
function separaPosizioniSovrapposte(items, distanzaMinima, iterazioni = 4) {
  for (let iter = 0; iter < iterazioni; iter++) {
    let mosso = false
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j]
        const dx = b.orbitaX - a.orbitaX
        const dy = b.orbitaY - a.orbitaY
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < distanzaMinima && dist > 0.0001) {
          mosso = true
          const push = (distanzaMinima - dist) / 2
          const ux = dx / dist, uy = dy / dist
          a.orbitaX -= ux * push; a.orbitaY -= uy * push
          b.orbitaX += ux * push; b.orbitaY += uy * push
        } else if (dist <= 0.0001) {
          // stessa posizione esatta: spinge in una direzione arbitraria ma stabile
          mosso = true
          const push = distanzaMinima / 2
          a.orbitaX -= push; b.orbitaX += push
        }
      }
    }
    if (!mosso) break
  }
}

// Divide l'arco di ogni settore tra i suoi prodotti in proporzione alla
// dimensione del pallino (i prodotti "top", disegnati più grandi, ottengono
// una fetta d'arco più larga), invece di una divisione uniforme che
// lascerebbe i pallini grandi troppo vicini ai vicini.
function calcolaAngoliPerProdotto(settori) {
  const angoli = new Map()
  Object.values(settori).forEach((sett) => {
    const pesi = sett.prodotti.map((g) => (g.p.top ? STILE.prodotto_scala_top : 1))
    const pesoTotale = pesi.reduce((s, w) => s + w, 0) || 1
    let cursore = sett.inizio
    sett.prodotti.forEach((g, idx) => {
      const sliceAngolo = (sett.fine - sett.inizio) * (pesi[idx] / pesoTotale)
      angoli.set(g.p, { centro: cursore + sliceAngolo / 2, sliceAngolo })
      cursore += sliceAngolo
    })
  })
  return angoli
}

const ANNO_MIN = 1830
const ANNO_MAX = 2020
// Base "nominale" della griglia X: viene allargata proporzionalmente a runtime
// (vedi fattoreScalaX più sotto) quando le orbite dei prodotti fanno crescere
// molto l'estensione verticale, per mantenere le proporzioni dell'area di lavoro.
const X_MIN_BASE = -170
const X_MAX_BASE = 170
let X_MIN = X_MIN_BASE
let X_MAX = X_MAX_BASE
const MARGINE_X = 20
const MARGINE_Y = 2
const Y_MIN = -20
const Y_MAX = 20
const MAX_CAMERA_RATIO_BASE = window.innerWidth < 768 ? 0.6 : 1.2
let MAX_CAMERA_RATIO = MAX_CAMERA_RATIO_BASE
// minCameraRatio è una FRAZIONE del bounding box (ratio=1 → tutto il contenuto
// visibile). Se il contenuto cresce in altezza (più designer, orbite più ampie),
// la stessa frazione fissa mostrerebbe uno spicchio di grafo via via più grande,
// vanificando qualunque aumento della spaziatura verticale. Per questo viene
// ricalcolata a runtime (vedi MIN_CAMERA_RATIO_UNITA_VISIBILI più sotto) in modo
// da garantire sempre lo stesso zoom massimo assoluto, indipendente dalla scala
// del contenuto.
const MIN_CAMERA_RATIO_BASE = window.innerWidth < 768 ? 0.02 : 0.05
let MIN_CAMERA_RATIO = MIN_CAMERA_RATIO_BASE
// Unità-grafo (verticali) visibili al massimo zoom-in, a prescindere da quanto
// è alto il contenuto complessivo.
const MIN_CAMERA_RATIO_UNITA_VISIBILI = 40

function annoToX(anno) {
  return X_MIN + ((anno - ANNO_MIN) / (ANNO_MAX - ANNO_MIN)) * (X_MAX - X_MIN)
}

function calcolaRaggio(nProdotti) {
  // Sotto la soglia il raggio resta fisso (evita che i designer con pochi
  // prodotti li abbiano incollati al pallino); oltre la soglia cresce come
  // prima per non affollare i designer con molti prodotti.
  if (nProdotti <= STILE.orbita_soglia_prodotti) return STILE.orbita_raggio_base
  return STILE.orbita_raggio_base + (nProdotti - STILE.orbita_soglia_prodotti) * STILE.orbita_spazio_per_prodotto
}

const NATO_PER_DESIGNER = {}
designers.forEach((d) => { NATO_PER_DESIGNER[d.nome] = d.nato })

function raggioBaseProdotto(anno, nomeDesigner) {
  const nato = NATO_PER_DESIGNER[nomeDesigner]
  const eta = (typeof anno === "number" ? anno : 1900) - (typeof nato === "number" ? nato : 1900)
  const etaEffettiva = Math.min(STILE.eta_massima, Math.max(STILE.eta_riferimento, eta))
  return STILE.eta_raggio_base + (etaEffettiva - STILE.eta_riferimento) * STILE.eta_unita_per_anno
}

// Stesso criterio dei prodotti singoli, ma sull'età MEDIA dei co-progettisti
// (un prodotto co-firmato non orbita attorno a un designer solo).
function raggioBaseProdottoMulti(anno, nomiDesigner) {
  const annoNum = typeof anno === "number" ? anno : 1900
  const etaMedia = nomiDesigner.reduce((s, nome) => {
    const nato = NATO_PER_DESIGNER[nome]
    return s + (annoNum - (typeof nato === "number" ? nato : 1900))
  }, 0) / Math.max(1, nomiDesigner.length)
  const etaEffettiva = Math.min(STILE.eta_massima, Math.max(STILE.eta_riferimento, etaMedia))
  return STILE.eta_raggio_base + (etaEffettiva - STILE.eta_riferimento) * STILE.eta_unita_per_anno
}

function hashStr(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff
  }
  return (hash >>> 0) / 0xffffffff
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

// Monotone chain: inviluppo convesso di un insieme di punti, in ordine antiorario.
function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length < 3) return pts
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

// Ray-casting: test point-in-polygon in JS puro, sulle stesse coordinate schermo già
// usate per disegnare — evita di dipendere da ctx.isPointInPath (che richiede la
// stessa identica matrice di trasformazione attiva sia al disegno che al test).
function puntoInPoligono(poligono, px, py) {
  let dentro = false
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const xi = poligono[i].x, yi = poligono[i].y
    const xj = poligono[j].x, yj = poligono[j].y
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) dentro = !dentro
  }
  return dentro
}

function getDesigners(p) {
  return Array.isArray(p.designer) ? p.designer : [p.designer]
}

function cercaEntita(query, limit = 8) {
  const q = query.toLowerCase()
  return [
    ...designers.filter(d => d.nome.toLowerCase().includes(q)).map(d => ({ tipo: "designer", nome: d.nome })),
    ...prodotti.filter(p => p.nome.toLowerCase().includes(q)).map(p => ({ tipo: "prodotto", nome: p.nome, sub: getDesigners(p).join(", ") })),
  ].slice(0, limit)
}

// Formspree: crea un form su formspree.io, copia l'endpoint generato al posto di YOUR_FORM_ID
const FORMSPREE_ENDPOINT = "https://formspree.io/f/YOUR_FORM_ID"

const SEZIONI_CREDITS = [
  {
    titolo: "Fondazioni e archivi",
    nomi: [
      "Fondazione Achille Castiglioni, Milano",
      "Fondazione Franco Albini, Milano",
      "Fondazione Bruno Munari, Milano",
      "Fondazione Studio Museo Vico Magistretti, Milano",
      "Fondazione Ico e Luisa Parisi, Como",
      "Archivio Carlo Scarpa, Università Iuav di Venezia",
      "Gio Ponti Archives",
      "Museo Casa Mollino, Torino",
      "Triennale Milano — Archivio Enzo Mari",
      "CSAC — Centro Studi e Archivio della Comunicazione, Università di Parma",
      "Vitra Design Museum",
      "MoMA — The Museum of Modern Art, New York",
      "Cooper Hewitt, Smithsonian Design Museum",
    ],
  },
  {
    titolo: "Case d'asta e rivenditori",
    nomi: [
      "Wright, Chicago",
      "Phillips",
      "Sotheby's",
      "Christie's",
      "Bonhams",
      "Cambi Casa d'Aste",
      "Il Ponte Casa d'Aste",
      "Farsetti Arte",
      "Meeting Art",
      "Nilufar Gallery, Milano",
      "1stDibs",
      "Pamono",
    ],
  },
  {
    titolo: "Siti e database specializzati",
    nomi: [
      "Design Index",
      "Design Addict",
      "Domus — archivio storico",
      "MoMA Collection Online",
    ],
  },
]

const CATEGORIA_EN = {
  allestimento: "installation", appendiabiti: "coat stand", architettura: "architecture",
  automobile: "automobile", bollitore: "kettle", bottiglia: "bottle", calcolatrice: "calculator",
  calendario: "calendar", carrello: "trolley", cassettiera: "chest of drawers", cavatappi: "corkscrew",
  contenitore: "storage unit", divano: "sofa", fermacarte: "paperweight", gioco: "game",
  lampada: "lamp", lampadario: "chandelier", letto: "bed", libreria: "bookcase", libro: "book",
  "macchina caffè": "coffee machine", "macchina da cucire": "sewing machine", "macchina da scrivere": "typewriter",
  maniglia: "handle", "sistema di illuminazione": "lighting system", "lampada da terra": "floor lamp",
  orologio: "clock", "piatto decorativo": "decorative plate", poltrona: "armchair",
  portaombrelli: "umbrella stand", portariviste: "magazine rack", posacenere: "ashtray", posate: "cutlery",
  pouf: "pouf", "progetto teorico": "theoretical project", radio: "radio", scrivania: "desk",
  scultura: "sculpture", sedia: "chair", sgabello: "stool", specchio: "mirror", spremiagrumi: "juicer",
  superficie: "surface", tavolo: "table", telefono: "telephone", televisore: "television",
  vaso: "vase", vassoio: "tray", consolle: "console table", tavolino: "side table",
  "libreria modulare": "modular bookcase", toeletta: "dressing table", "lampada da parete": "wall lamp",
  "timer da cucina": "kitchen timer", sveglia: "alarm clock", "macchina utensile": "machine tool",
  "tavolino modulare": "modular side table", "apparecchio per microfilm": "microfilm device",
  "lampada da tavolo": "table lamp", "macchina per caffè espresso": "espresso machine",
  "centro di misura": "measuring center", "centrale polifunzionale": "multifunction control unit",
  "centro di lavorazione": "machining center",
  "codificatore di caratteri magnetici": "magnetic character encoder", "computer da tavolo": "desktop computer",
  microcomputer: "microcomputer", "terminale video": "video terminal", "seduta modulare": "modular seating",
  giradischi: "record player", "divano modulare": "modular sofa", "tavolini modulari": "modular side tables",
  "sistema di sedute": "seating system", "lampada a sospensione": "pendant lamp",
  "registratore a cassette": "cassette recorder", "macchina da scrivere elettronica": "electronic typewriter",
  thermos: "thermos", "tastiera elettronica": "electronic keyboard", "sedia da ufficio": "office chair",
  faretto: "spotlight", rubinetto: "faucet",
  "sedia pieghevole": "folding chair", "scrivania direzionale": "executive desk",
  "letto sovrapponibile": "stackable bed", "poltrona da ufficio": "office armchair",
  "poltrona direzionale": "executive armchair", "sistema di arredi per ufficio": "office furniture system",
  "radio portatile": "portable radio", "sistema modulare di sedute": "modular seating system",
  autoradio: "car radio", "telefono pubblico": "public telephone", "sistema hi-fi": "hi-fi system",
  "calcolatrice elettronica": "electronic calculator", "macchina da scrivere elettrica": "electric typewriter",
  poltroncina: "small armchair",
  "poltrona a dondolo": "rocking chair", divanetto: "loveseat", "chaise longue": "chaise longue",
  "lampada da tavolo e da terra": "table and floor lamp", "sistema di sedute e tavoli": "seating and table system",
  "orologio da polso": "wristwatch", "postazione per home office": "home office workstation",
  "tavolo da lavoro": "work table", "famiglia di lampade": "lamp family",
  "divano letto": "sofa bed", "pouf modulare": "modular pouf", "cucina compatta mobile": "mobile compact kitchen",
  "mobile contenitore": "storage cabinet", "contenitore modulare": "modular storage unit",
  "lampada da giardino": "garden lamp", "servizio di bicchieri": "glass set", bicchiere: "glass",
  "sedia impilabile": "stackable chair", "cucina a isola": "island kitchen", "tavolo da gioco": "game table",
  tappeto: "rug", "sistema di contenitori": "storage system", proiettore: "projector",
  "poltrona modulare": "modular armchair", "carrello contenitore": "storage trolley",
  portaoggetti: "storage tray", "sistema fotografico": "photographic system",
  "seduta trasformabile": "convertible seat", "letto trasformabile": "convertible bed",
  "sistema abitativo": "living system", "condizionatore portatile": "portable air conditioner",
  "set di bicchieri": "glass set", formaggiera: "cheese dish", "servizio da tavola per aereo": "airline tableware set",
  mensola: "shelf",
  "poltrona con pouf": "armchair with pouf", "seduta scultorea": "sculptural seat",
  "collezione di arredi": "furniture collection", "collezione di sedute scultoree": "sculptural seating collection",
  paravento: "folding screen",
  "lampada-scultura": "sculpture lamp", "collezione di vasi": "vase collection", credenza: "sideboard",
  "mobile bar": "bar cabinet", "vaso-scultura": "sculpture vase", "tavolino in mosaico": "mosaic side table",
  fiasca: "flask", "servizio di tazzine": "cup set", "tavolino trasformabile": "convertible side table",
  "oggetto in ceramica": "ceramic object", portalibri: "bookend", oliera: "oil cruet",
  "colonne in mosaico": "mosaic columns", contenitori: "storage units", coppa: "bowl",
  salvadanaio: "money box", "collezione di ceramiche": "ceramics collection",
  "collezione di librerie": "bookcase collection", "collezione di arredi e oggetti": "furniture and object collection",
  comodino: "nightstand", scrittoio: "writing desk",
  "collezione di mobili contenitori": "storage furniture collection", "collezione di vassoi": "tray collection",
  arazzo: "tapestry", "totem in ceramica": "ceramic totem", "collezione di sculture in ceramica": "ceramic sculpture collection",
  "tavolo trasformabile in sedia": "table convertible into a chair", centrotavola: "centerpiece",
  "tavolino portafiori": "flower stand table", "collezione di sculture-arredo in mosaico": "mosaic sculpture-furniture collection",
  macinapepe: "pepper mill", "macchina da caffè filtro": "filter coffee machine",
  "lampada da parete o soffitto": "wall or ceiling lamp", "cavatappi da sommelier": "sommelier corkscrew",
  "scultura in vetro": "glass sculpture", panca: "bench", "alzata pieghevole": "folding cake stand",
  "caffettiera espresso": "espresso coffee maker", "sgabello o tavolino": "stool or side table",
  "orologio da parete": "wall clock", "lavabo a colonna": "pedestal washbasin",
  "sistema di tavolini": "side table system", "padella per uova": "egg pan",
  "servizio da tavola per bambini": "children's tableware set", "famiglia di vasi": "vase family",
  "vaso con coperchio": "lidded vase", "decorazione natalizia": "christmas decoration",
  "set di posate": "cutlery set", bacchette: "chopsticks",
  "set di valigie": "luggage set", "poltrona reclinabile": "reclining armchair", lettino: "daybed",
  "armadio-libreria": "wardrobe-bookcase", "secchiello per ghiaccio": "ice bucket",
  "faretto orientabile": "adjustable spotlight", "sedia per bambini": "children's chair",
  "libreria girevole": "revolving bookcase", "sedia da pranzo e da ufficio": "dining and office chair",
  "sistema per ufficio": "office system", "letto contenitore": "storage bed", porta: "door",
  "sistema di divani": "sofa system", "sistema di arredi componibili": "modular furniture system",
  "sistema di mensole": "shelving system",
  puzzle: "puzzle", "calendario perpetuo da parete": "perpetual wall calendar", scatola: "box",
  "vassoio rettangolare": "rectangular tray", tagliacarte: "letter opener",
  "portamatite e vaschetta portacarte": "pen holder and paper tray",
  "posacenere e centrotavola": "ashtray and centerpiece", portamatite: "pen holder",
  "calendario perpetuo da tavolo": "perpetual desk calendar",
  "appendiabiti, contenitore e portaombrelli": "coat stand, storage unit and umbrella stand",
  "vaso reversibile": "reversible vase", "cestino gettacarte": "wastepaper basket",
  "posate da insalata": "salad servers", "sistema di librerie": "bookcase system",
  "sistema di lampade": "lamp system", "vaschetta portacarte": "paper tray",
  "sistema di mobili modulari": "modular furniture system", "vaso e ciotola": "vase and bowl",
  "kit / progetto per vasi": "vase kit / project", "appendiabiti da terra": "floor coat stand",
  "sedia smontabile": "knock-down chair", "scatola per sale e contenitore multiuso": "salt box and multipurpose container",
  "appendiabiti da parete": "wall coat stand", bacheca: "notice board", schiaccianoci: "nutcracker",
  "sgabello impilabile": "stackable stool",
  "poltrona girevole": "swivel armchair", "tavolo regolabile": "adjustable table", "set di tavolini": "set of side tables",
  "arazzi per testiere letto": "bed headboard tapestries", candelieri: "candlesticks",
  collezione: "collection", "collezione di specchi": "mirror collection", "collezione di specchiere": "dressing mirror collection",
  "collezione di tavoli, tavolini e contenitori": "collection of tables, side tables and storage units",
  "collezione di tavolo, mobile bar e specchi": "collection of table, bar cabinet and mirrors",
  comodini: "nightstands", "consolle bar": "bar console", "consolle specchio": "mirrored console",
  "lampada da parete e da tavolo": "wall and table lamp", lampade: "lamps", "lampade da parete": "wall lamps",
  "lampade da terra e appliques": "floor lamps and wall sconces", "mensola luminosa": "illuminated shelf",
  "mobile TV e audio": "TV and audio cabinet", "mobile buffet": "buffet cabinet", "mobile componibile": "modular cabinet",
  "mobile credenza": "sideboard cabinet", "mobile per impianto audio": "audio system cabinet",
  "oggetti per la tavola": "tableware objects", "pannelli in alluminio serigrafato": "screen-printed aluminum panels",
  "parete decorativa": "decorative wall", "piastrella da rivestimento": "cladding tile", "piastrelle da rivestimento": "cladding tiles",
  "serie di posate e vassoi in argento": "silver cutlery and tray series", "serie di specchi": "mirror series",
  "serie di specchi e tavoli": "mirror and table series", "serie di specchiere e tavoli": "dressing mirror and table series",
  "serie di specchiere in vetro fuso": "fused glass dressing mirror series", "serie di tavoli": "table series",
  "serie di tavoli e specchi": "table and mirror series", "sistema di mobili e tavoli componibili": "modular furniture and table system",
  specchiera: "dressing mirror", "specchiera / tavolo": "dressing mirror / table", "specchiera da bagno": "bathroom mirror",
  "specchiera in vetro soffiato": "blown glass dressing mirror", "specchio da tavolo": "table mirror",
  tappeti: "rugs", "tavoli bassi, ripiani e carrelli": "low tables, shelves and trolleys", tavolini: "side tables",
  "tavolo e sedia": "table and chair", "tavolo scrivania": "desk table", vasi: "vases",
  applique: "wall sconce", "faretto da parete / soffitto": "wall / ceiling spotlight",
  "lampada da esterno": "outdoor lamp", "lampada da parete / soffitto": "wall / ceiling lamp",
  "lampada da parete / tavolo": "wall / table lamp", "lampada scomponibile": "modular lamp",
  plafoniera: "ceiling lamp", "plafoniera / lampada da parete": "ceiling / wall lamp",
  "specchio illuminato": "illuminated mirror", "specchio illuminato / lampada da parete": "illuminated mirror / wall lamp",
  "addizionatrice elettrica": "electric adding machine", "collezione di oggetti da cucina in legno": "wooden kitchenware collection",
  "computer mainframe / console": "mainframe computer / console", cuscino: "cushion", fruttiera: "fruit bowl",
  "libreria / divisorio": "bookcase / room divider", "macchina da scrivere portatile": "portable typewriter",
  macinaspezie: "spice mill", miniatura: "miniature", "oliera / acetiera": "oil and vinegar cruet",
  "piatto da portata": "serving plate", "scultura / vaso in vetro di Murano": "Murano glass sculpture / vase",
  "scultura in vetro di Murano": "Murano glass sculpture", "servizio di piatti": "set of plates",
  "servizio di posate": "cutlery set", "sgabello / tavolino": "stool / side table",
  "specchio con consolle e lampade": "mirror with console and lamps", "specchio/lampada": "mirror/lamp",
  "tavolino alto": "high side table", tessuto: "fabric", "vaso in porcellana": "porcelain vase",
  "vaso in vetro di Murano": "Murano glass vase",
  bicchieri: "glasses", "bollitore elettrico": "electric kettle", "calcolatrice / terminale da ufficio": "calculator / office terminal",
  "caraffa termica": "thermal jug", "collezione di sedute": "seating collection", "collezione di vasi in vetro": "glass vase collection",
  "collezione outdoor": "outdoor collection", "computer portatile": "laptop computer", "famiglia di piccoli elettrodomestici": "small appliance family",
  frullatore: "blender", "frullatore a immersione": "immersion blender", "frullatore personale": "personal blender",
  "lampada a pinza": "clamp lamp", "lampada da parete/soffitto": "wall/ceiling lamp", "lampada da soffitto": "ceiling lamp",
  "lampada per esterni": "outdoor lamp", "macchina per caffè filtro": "filter coffee machine", "macinino per sale, pepe e spezie": "salt, pepper and spice mill",
  montalatte: "milk frother", "oggetto decorativo": "decorative object", "oggetto in vetro": "glass object",
  panchina: "small bench", "pannello acustico modulare": "modular acoustic panel", "pavimento in legno": "wood flooring",
  "personal computer": "personal computer", portagioie: "jewelry box", "postazione scrittoio": "writing desk workstation",
  "sedia per ufficio": "office chair", "set sale e pepe": "salt and pepper set", "sgabello e colonna appendiabiti": "stool and coat stand column",
  "sistema contenitore": "storage system", "sistema di accessori da scrivania": "desktop accessories system",
  "sistema di postazioni di lavoro": "workstation system", "sistema di tavoli": "table system", "sistema informatico": "computer system",
  "spremiagrumi elettrico": "electric citrus juicer", stampante: "printer", "stampante bancaria": "banking printer",
  "tavolo / sistema ufficio": "table / office system", tostapane: "toaster", "vasi in maiolica": "majolica vases", "vaso in vetro": "glass vase",
  "workstation multimediale": "multimedia workstation",
  apribottiglie: "bottle opener", "ciotola / vaso": "bowl / vase", "consolle retroilluminata": "backlit console",
  "poltrona con poggiapiedi": "armchair with ottoman", portastuzzicadenti: "toothpick holder", salsiera: "gravy boat",
  "scaffale / mensola": "shelving / shelf", "serie di arredi": "furniture series",
  "serie di oggetti: posacenere, vaso e lampada": "set of objects: ashtray, vase and lamp",
  armadio: "wardrobe", "armadio / cabina": "wardrobe / cabin", "caffettiera a pressa": "press coffee maker",
  cassapanca: "chest", cassettone: "chest of drawers", "credenza / vetrina": "sideboard / display cabinet",
  "libreria / sistema contenitore": "bookcase / storage system", "libreria componibile": "modular bookcase",
  "pentola / cocotte": "pot / cocotte", "secretaire / mobile contenitore": "secretaire / storage cabinet",
  "sedia per platea teatrale": "theatre auditorium chair", "serie di sedute": "seating series",
  "servizio da tè e caffè": "tea and coffee service", "specchiera in marmo": "marble dressing mirror",
  "tappeto / arazzo": "rug / tapestry", "tavolino / libreria in marmo": "marble side table / bookcase",
  "tavolo in marmo": "marble table", teiera: "teapot",
  "carrello in rattan": "rattan trolley", "ciotola in argento": "silver bowl", "divano in rattan": "rattan sofa",
  "libreria a parete": "wall bookcase", "panca in rattan": "rattan bench", "poltrona bergère": "bergère armchair",
  "poltrona in rattan": "rattan armchair", "poltrona lounge in rattan": "rattan lounge chair", "pouf in rattan": "rattan pouf",
  "sedia con braccioli": "chair with armrests", "sedia in rattan": "rattan chair", "specchio in rattan": "rattan mirror",
  "tavolo / scrittoio": "table / writing desk",
  "lampada da tavolo wireless": "wireless table lamp", "lampada regolabile da tavolo/terra": "adjustable table/floor lamp",
  "pouf / poggiapiedi": "pouf / ottoman", "tavolino regolabile": "adjustable side table",
  "tavolo da pranzo": "dining table", "tavolo da pranzo estensibile": "extendable dining table",
  "candelabro in argento": "silver candelabra", "collezione di utensili da cucina": "kitchen utensils collection",
  "lampada da terra / esterni": "floor / outdoor lamp", "lampada in metallo": "metal lamp", "letto in metallo": "metal bed",
  "poltrona in poliuretano": "polyurethane armchair", "poltrona outdoor": "outdoor armchair",
  "sedia / sistema in rattan": "rattan chair / system", "set di ciotole in argento": "set of silver bowls",
  "tavolino outdoor": "outdoor side table", "tavolo con piano in metallo": "table with metal top",
  "tavolo rettangolare": "rectangular table", "tavolo rotondo": "round table",
}

const TIPO_RELAZIONE_EN = {
  fratelli: "siblings", collaborazione: "collaboration", stesso_periodo: "same period",
  stesso_studio: "same studio", mentore: "mentor", amicizia: "friendship", stesso_settore: "same field",
  successione: "succession", coniugi: "spouses", "fondatori studio BBPR": "BBPR studio founders",
  "padre-figlio": "father-son", "fondatori Azucena": "Azucena founders", "studio condiviso": "shared studio",
}

const TESTI = {
  it: {
    sottotitolo: "Un secolo di oggetti, forme e idee.",
    paragrafo1: "Questa mappa rappresenta un secolo di design occidentale — i suoi protagonisti, le loro opere e i legami invisibili che li uniscono. Ogni nodo è un designer o un oggetto; ogni connessione, una relazione di collaborazione, influenza o formazione.",
    paragrafo2: "La posizione orizzontale segue una cronologia rigorosa, dal 1880 al 1980. Esplorando la mappa si scoprono le grandi concentrazioni del movimento moderno, le filiazioni tra maestri e allievi, e le convergenze tra discipline e nazionalità.",
    cerca: "Cerca...",
    benvenutoDomanda: "Qual è il designer che ha disegnato il mondo in cui vorresti vivere?",
    benvenutoConferma: "Entra",
    designerToggle: "Designer",
    timelineToggle: "Linea del tempo",
    correntiToggleOn: "Correnti progettuali visibili",
    correntiToggleOff: "Correnti progettuali nascoste",
    hoverTooltip: "Hover sui collegamenti — clicca su area vuota per uscire",
    home: "Torna alla vista iniziale",
    sezione: "Sezione",
    menu: "Menu",
    biografia: "Biografia",
    descrizioneLabel: "Descrizione",
    tipologia: "Tipologia",
    azienda: "Azienda",
    aziende: "Aziende",
    legami: "Legami",
    riconoscimenti: "Riconoscimenti",
    periodo: "Periodo",
    esponenti: "Esponenti",
    footerRiga1: "Un secolo di design occidentale, 1880–1980",
    footerRiga2: "Tutti i diritti riservati",
    voci: { domanda: "Intro", manifesto: "Manifesto", contatti: "Contatti", credits: "Credits", contribuisci: "Contribuisci" },
    email: "Email",
    contribCategorie: ["Correzione", "Aggiunta", "Miglioramento o suggerimento"],
    contribDomanda: "Quale modifica vuoi presentare?",
    contribCercaPlaceholder: "Cerca designer o prodotto...",
    contribDescrizionePlaceholder: "Descrivi la modifica proposta...",
    contribEmailPlaceholder: "La tua email",
    invia: "Invia",
    invioInCorso: "Invio in corso...",
    contribOk: "Grazie, la tua segnalazione è stata inviata.",
    contribErrore: "Si è verificato un errore. Riprova più tardi.",
    creditsIntro: "Le immagini e i dati storici presenti in questa mappa provengono da un'ampia rete di fondazioni, archivi, case d'asta e piattaforme specializzate nel design del XX secolo. Di seguito l'elenco delle fonti principali.",
    creditsTitoli: ["Fondazioni e archivi", "Case d'asta e rivenditori", "Siti e database specializzati"],
    creditsChiusura: "Elenco in aggiornamento; eventuali omissioni o correzioni possono essere segnalate tramite la pagina Contribuisci.",
    manifestoParagrafi: [
      "Il francese non è una scelta puramente estetica, ma un atto di posizionamento culturale. Per secoli è stata la lingua degli intellettuali, degli enciclopedisti e di quanti hanno riconosciuto nella conoscenza un patrimonio da ordinare, condividere e rendere accessibile. È nel solco di questa tradizione che nasce il progetto.",
      "Il design del Novecento costituisce uno dei capitoli più densi e articolati della cultura materiale occidentale. La sua conoscenza è affidata a un patrimonio ampio di monografie, archivi, cataloghi e raccolte tematiche, spesso organizzati attorno a singoli autori, aziende, movimenti o prodotti. Le fonti esistono, ma parlano lingue diverse. I frammenti ci sono; manca la mappa. Ne deriva una conoscenza ricca ma discontinua, nella quale risulta complesso ricostruire una visione d'insieme e leggere con immediatezza le relazioni che legano persone, opere, esperienze e contesti differenti.",
      "Comprendere pienamente il percorso di un designer non significa soltanto conoscerne i prodotti, ma collocarne il lavoro all'interno di una rete di relazioni formative, personali, professionali e culturali. Significa osservare l'evoluzione del suo linguaggio nel tempo, riconoscere le influenze ricevute ed esercitate, individuare continuità, trasformazioni e discontinuità. Il singolo autore viene così rappresentato come parte di un sistema più ampio, costruito attraverso incontri, collaborazioni, affinità e contrapposizioni.",
      "L'enciclopedia raccoglie prodotti appartenenti ad autori, periodi e contesti differenti all'interno di un unico spazio visivo. Le relazioni tra maestri e allievi, collaboratori, famiglie, collettivi, aziende e movimenti diventano elementi leggibili. La successione temporale non viene restituita come una semplice sequenza di date, ma come una geografia di esperienze, idee e linguaggi progettuali.",
      "La visualizzazione costituisce, in questo senso, uno strumento di conoscenza. Permette di associare con maggiore immediatezza un'opera al proprio autore, di collocarla nel tempo e di confrontarla con ciò che la precede, la accompagna o ne deriva. Rende visibili traiettorie che, nei tradizionali strumenti di consultazione, restano spesso separate e richiedono la comparazione di fonti autonome e difficilmente sovrapponibili.",
      "Questo strumento ha una finalità prevalentemente divulgativa ed educativa. Si propone come uno strumento agile ma rigoroso per chi studia, insegna, ricerca o desidera avvicinarsi alla storia del design attraverso una lettura accessibile e al tempo stesso stratificata. Non intende sostituire archivi, monografie o cataloghi, ma offrire una struttura capace di metterli in relazione e di orientarne la consultazione.",
      "La sua natura aperta può inoltre favorire la convergenza di conoscenze oggi custodite da fondazioni, aziende, archivi, istituzioni e protagonisti del settore, contribuendo alla costruzione di una narrazione più coesa e condivisa. Un sistema in evoluzione, nel quale patrimoni differenti possano dialogare senza perdere la propria specificità.",
      "Il design non è soltanto un insieme di oggetti desiderabili, né può essere ridotto alla loro dimensione commerciale, simbolica o collezionistica. Ogni prodotto è l'esito di una cultura, di una ricerca, di un sistema produttivo e di una precisa idea dell'abitare e del vivere.",
      "Il design è cultura. È pensiero. È il modo in cui una civiltà dà forma ai propri gesti, ai propri spazi e alla propria quotidianità.",
      "Questa enciclopedia nasce per restituirne la complessità, le relazioni e la profondità storica.",
    ],
  },
  en: {
    sottotitolo: "A century of objects, forms, and ideas.",
    paragrafo1: "This map represents a century of Western design — its protagonists, their works, and the invisible ties that bind them. Each node is a designer or an object; each connection, a relationship of collaboration, influence, or formation.",
    paragrafo2: "The horizontal position follows a rigorous chronology, from 1880 to 1980. Exploring the map reveals the great concentrations of the modern movement, the lineages between masters and students, and the convergences across disciplines and nationalities.",
    cerca: "Search...",
    benvenutoDomanda: "Which designer shaped the world you'd want to live in?",
    benvenutoConferma: "Enter",
    designerToggle: "Designer",
    timelineToggle: "Timeline",
    correntiToggleOn: "Design movements visible",
    correntiToggleOff: "Design movements hidden",
    hoverTooltip: "Hover over the connections — click an empty area to exit",
    home: "Back to initial view",
    sezione: "Section",
    menu: "Menu",
    biografia: "Biography",
    descrizioneLabel: "Description",
    tipologia: "Type",
    azienda: "Company",
    aziende: "Companies",
    legami: "Ties",
    riconoscimenti: "Awards",
    periodo: "Period",
    esponenti: "Members",
    footerRiga1: "A century of Western design, 1880–1980",
    footerRiga2: "All rights reserved",
    voci: { domanda: "Intro", manifesto: "Manifesto", contatti: "Contact", credits: "Credits", contribuisci: "Contribute" },
    email: "Email",
    contribCategorie: ["Correction", "Addition", "Improvement or suggestion"],
    contribDomanda: "What change would you like to submit?",
    contribCercaPlaceholder: "Search designer or product...",
    contribDescrizionePlaceholder: "Describe the proposed change...",
    contribEmailPlaceholder: "Your email",
    invia: "Submit",
    invioInCorso: "Submitting...",
    contribOk: "Thank you, your submission has been sent.",
    contribErrore: "An error occurred. Please try again later.",
    creditsIntro: "The images and historical data featured on this map come from a broad network of foundations, archives, auction houses, and platforms specialized in 20th-century design. Below is a list of the main sources.",
    creditsTitoli: ["Foundations and Archives", "Auction Houses and Dealers", "Specialized Sites and Databases"],
    creditsChiusura: "This list is a work in progress; any omissions or corrections can be reported via the Contribute page.",
    manifestoParagrafi: [
      "French is not a purely aesthetic choice, but an act of cultural positioning. For centuries it was the language of intellectuals, of the encyclopedists, and of all those who recognized knowledge as a heritage to be ordered, shared, and made accessible. It is in the wake of this tradition that this project is born.",
      "Twentieth-century design is one of the richest and most intricate chapters of Western material culture. Our knowledge of it rests on a vast body of monographs, archives, catalogues, and thematic collections, often organized around individual authors, companies, movements, or products. The sources exist, but they speak different languages. The fragments are there; what is missing is the map. The result is a body of knowledge that is rich yet discontinuous, one in which it is difficult to reconstruct an overall view and to immediately read the relationships linking different people, works, experiences, and contexts.",
      "Fully understanding a designer's trajectory means more than knowing their products; it means situating their work within a network of formative, personal, professional, and cultural relationships. It means observing the evolution of their language over time, recognizing the influences they received and exerted, and identifying continuities, transformations, and discontinuities. The individual author is thus represented as part of a larger system, built through encounters, collaborations, affinities, and oppositions.",
      "The encyclopedia gathers products belonging to different authors, periods, and contexts within a single visual space. The relationships between masters and students, collaborators, families, collectives, companies, and movements become legible elements. The chronological sequence is rendered not as a simple succession of dates, but as a geography of experiences, ideas, and design languages.",
      "In this sense, visualization becomes a tool of knowledge. It allows a work to be more immediately linked to its author, placed in time, and compared with what precedes, accompanies, or follows from it. It makes visible trajectories that, in traditional reference tools, often remain separate and require comparing autonomous sources that are difficult to overlay.",
      "This tool serves a primarily educational and outreach purpose. It is conceived as an agile yet rigorous instrument for those who study, teach, research, or simply wish to approach the history of design through a reading that is both accessible and layered. It does not aim to replace archives, monographs, or catalogues, but to offer a structure capable of relating them to one another and guiding their consultation.",
      "Its open nature can also foster the convergence of knowledge currently held by foundations, companies, archives, institutions, and protagonists of the field, contributing to the construction of a more cohesive, shared narrative — an evolving system in which different bodies of heritage can engage with one another without losing their specificity.",
      "Design is not merely a collection of desirable objects, nor can it be reduced to their commercial, symbolic, or collectible dimension. Every product is the outcome of a culture, a body of research, a production system, and a precise idea of dwelling and living.",
      "Design is culture. It is thought. It is the way a civilization gives form to its gestures, its spaces, and its everyday life.",
      "This encyclopedia was created to give back its complexity, its relationships, and its historical depth.",
    ],
  },
}

// onSoglia scatta dopo le prime `sogliaPronte` immagini (le più vicine al centro
// iniziale, essendo `paths` già ordinato per distanza): serve a sbloccare la
// schermata iniziale senza aspettare tutto il catalogo, che con centinaia di
// foto renderebbe l'avvio molto più lento del necessario. Il resto continua a
// caricare in background verso onDone.
function preloadImages(paths, concorrenza = 6, onDone, sogliaPronte, onSoglia) {
  const cache = {}
  const coda = [...paths]
  const totale = paths.length
  let completate = 0
  let sogliaRaggiunta = false
  paths.forEach((src) => { cache[src] = new Image() })
  let attive = 0
  function avviaProssima() {
    if (coda.length === 0 || attive >= concorrenza) return
    const src = coda.shift()
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
    img.addEventListener("load", fine, { once: true })
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

// Scrollbar personalizzata per le liste di risultati (ricerca, contribuisci):
// un binario chiaro staccato dal riquadro dei risultati, con una "pillola"
// grigia più scura che rappresenta la porzione visibile — niente scrollbar
// nativa del browser, che sui vari sistemi operativi ha un aspetto troppo
// standard e non era possibile staccarla dal contenuto.
function ListaConScroll({ children, maxHeight, wrapperStyle, innerStyle, className }) {
  const scrollRef = useRef(null)
  const [thumb, setThumb] = useState(null)

  const aggiorna = () => {
    const el = scrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight <= clientHeight + 1) { setThumb(null); return }
    const h = Math.max(24, (clientHeight / scrollHeight) * clientHeight)
    const top = (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - h)
    setThumb({ top, height: h })
  }

  useEffect(() => { aggiorna() })

  return (
    <div style={{ position: "relative", ...wrapperStyle }}>
      <div ref={scrollRef} onScroll={aggiorna} className={`dn-scroll-hidden ${className || ""}`}
        style={{ maxHeight, overflowY: "auto", ...innerStyle }}>
        {children}
      </div>
      {thumb && (
        <div style={{ position: "absolute", top: 6, bottom: 6, right: -13, width: 4, borderRadius: 2, background: "#f0f0f0" }}>
          <div style={{ position: "absolute", top: thumb.top, height: thumb.height, left: 0, right: 0, borderRadius: 2, background: "#b0b0b0" }} />
        </div>
      )}
    </div>
  )
}

function App() {
  const [popup, setPopup] = useState(null)
  const [pannelloDesigner, setPannelloDesigner] = useState(null)
  const [pannelloVisibile, setPannelloVisibile] = useState(false)
  const [tooltipRelazione, setTooltipRelazione] = useState(null)
  const [tooltipCorrente, setTooltipCorrente] = useState(null)
  const [designerAttivo, setDesignerAttivo] = useState(null)
  const [vistaCorrente, setVistaCorrente] = useState("designer")
  const [animaTransizioneFn, setAnimaTransizioneFn] = useState(null)
  const [ridisegnaFn, setRidisegnaFn] = useState(null)
  const [primaVisita] = useState(() => {
    // Ricompare anche se non è la primissima visita in assoluto, ma sono
    // passati alcuni giorni dall'ultima (soglia media 3.5 giorni).
    const SOGLIA_RIVISITA_MS = 3.5 * 24 * 60 * 60 * 1000
    try {
      const ultimaVisita = parseInt(localStorage.getItem("dn-ultima-visita"), 10)
      const scaduta = !ultimaVisita || Date.now() - ultimaVisita > SOGLIA_RIVISITA_MS
      localStorage.setItem("dn-ultima-visita", String(Date.now()))
      return !localStorage.getItem("dn-camera") || scaduta
    } catch { return true }
  })
  const [schermataIniziale, setSchermataIniziale] = useState(primaVisita)
  const [immaginiPronte, setImmaginiPronte] = useState(false)
  const [rispostaDesigner, setRispostaDesigner] = useState("")
  const inputSchermataInizialeRef = useRef(null)
  const [numLetterePronte, setNumLetterePronte] = useState(0)
  const [cursoreVisibile, setCursoreVisibile] = useState(true)
  const [campoRivelato, setCampoRivelato] = useState(false)

  useEffect(() => {
    if (immaginiPronte) setSchermataIniziale(false)
  }, [immaginiPronte])

  function confermaSchermataIniziale(nomeScelto) {
    const nome = (nomeScelto || rispostaDesigner).trim()
    if (nome) {
      const match = designers.find((d) => d.nome.toLowerCase() === nome.toLowerCase())
        || designers.find((d) => d.nome.toLowerCase().includes(nome.toLowerCase()))
      if (match && centraFn) {
        attesaPosizionamentoRef.current = true
        centraFn(match.nome, "designer", {
          apriPannello: false,
          tPercent: 0.6,
          onFine: () => { attesaPosizionamentoRef.current = false; setChromeVisibile(true) },
        })
      }
    }
    setSchermataIniziale(false)
  }
  const topBarRef = useRef(null)
  const sottotitoloRef = useRef(null)
  const inputRicercaMobileRef = useRef(null)
  const [menuApertoMobile, setMenuApertoMobile] = useState(false)
  const [menuApertoDesktop, setMenuApertoDesktop] = useState(false)
  const [menuVista, setMenuVista] = useState("lista")
  const [contribCategoria, setContribCategoria] = useState("Correzione")
  const [contribTag, setContribTag] = useState(null)
  const [contribRicerca, setContribRicerca] = useState("")
  const [contribDescrizione, setContribDescrizione] = useState("")
  const [contribEmail, setContribEmail] = useState("")
  const [contribStato, setContribStato] = useState("idle")
  const [lingua, setLingua] = useState("it")
  const linguaRef = useRef("it")
  useEffect(() => { linguaRef.current = lingua }, [lingua])
  const t = TESTI[lingua]

  // Animazione "macchina da scrivere" della domanda iniziale: prima qualche
  // lampeggio del cursore (come una barra che ci pensa), poi la frase viene
  // composta lettera per lettera a velocità leggermente irregolare (più
  // naturale di un ritmo perfettamente costante), infine il cursore si ferma
  // e il campo/bottone compaiono — il cursore lampeggiante del campo di testo
  // (che riceve il focus) prende il posto di quello della frase.
  useEffect(() => {
    if (!schermataIniziale) return
    const frase = t.benvenutoDomanda
    let cancellato = false
    const timeouts = []
    const tick = (fn, ms) => { timeouts.push(setTimeout(() => { if (!cancellato) fn() }, ms)) }

    setNumLetterePronte(0)
    setCampoRivelato(false)
    setCursoreVisibile(true)

    const N_LAMPEGGI = 3
    const durataLampeggio = 220
    for (let i = 1; i <= N_LAMPEGGI * 2; i++) {
      tick(() => setCursoreVisibile((v) => !v), durataLampeggio * i)
    }
    let quando = durataLampeggio * N_LAMPEGGI * 2 + 150
    for (let i = 0; i <= frase.length; i++) {
      tick(() => setNumLetterePronte(i), quando)
      const carattere = frase[i]
      const pausaExtra = carattere === " " ? 40 : /[,.\-—]/.test(carattere || "") ? 160 : 0
      quando += 30 + Math.random() * 55 + pausaExtra
    }
    tick(() => setCursoreVisibile(false), quando + 200)
    tick(() => setCampoRivelato(true), quando + 250)

    return () => {
      cancellato = true
      timeouts.forEach(clearTimeout)
    }
  }, [schermataIniziale, t])

  useEffect(() => {
    if (campoRivelato && inputSchermataInizialeRef.current) inputSchermataInizialeRef.current.focus()
  }, [campoRivelato])

  // Ingresso lento e fluido di menu/barra di ricerca in alto: restano
  // invisibili finché la schermata iniziale (se c'è) non è sparita, poi
  // compaiono con una piccola dissolvenza + scorrimento verso il basso. Se la
  // schermata iniziale ha appena centrato la mappa su un designer, aspettiamo
  // che quell'animazione di posizionamento finisca prima di far comparire gli
  // elementi dell'interfaccia (attesaPosizionamentoRef), invece di farli
  // apparire tutti insieme.
  const [chromeVisibile, setChromeVisibile] = useState(false)
  const attesaPosizionamentoRef = useRef(false)
  useEffect(() => {
    if (schermataIniziale) return
    if (attesaPosizionamentoRef.current) return
    const id = setTimeout(() => setChromeVisibile(true), 100)
    return () => clearTimeout(id)
  }, [schermataIniziale])
  const stileIngressoChrome = {
    opacity: chromeVisibile ? 1 : 0,
    transform: chromeVisibile ? "translateY(0)" : "translateY(-10px)",
    transition: "opacity 0.9s ease, transform 0.9s ease",
  }

  const [legameHoverIdx, setLegameHoverIdx] = useState(null)
  const [galleriaIndice, setGalleriaIndice] = useState(0)
  const [galleriaFullscreen, setGalleriaFullscreen] = useState(false)
  const [galleriaOrigin, setGalleriaOrigin] = useState(null)
  const [galleriaAnimata, setGalleriaAnimata] = useState(false)
  const thumbnailRef = useRef(null)
  const touchGalleriaRef = useRef(null)

  function apriGalleriaFullscreen() {
    if (thumbnailRef.current) {
      const r = thumbnailRef.current.getBoundingClientRect()
      setGalleriaOrigin({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    setGalleriaFullscreen(true)
    setGalleriaAnimata(false)
    requestAnimationFrame(() => requestAnimationFrame(() => setGalleriaAnimata(true)))
  }

  function chiudiGalleriaFullscreen() {
    setGalleriaAnimata(false)
    setTimeout(() => setGalleriaFullscreen(false), 280)
  }
  const [aziendaAttiva, setAziendaAttiva] = useState(null)
  const aziendaAttivaRef = useRef(null)
  const aziendaGlobaleRef = useRef(false)
  const [ricerca, setRicerca] = useState("")
  const [nodoEvidenziato, setNodoEvidenziato] = useState(null)
  const nodoEvidenziatoRef = useRef(null)
  const [legameEvidenziato, setLegameEvidenziato] = useState(null)
  const legameEvidenziatoRef = useRef(null)
  const [correntiVisibili, setCorrentiVisibili] = useState(false)
  const correntiVisibiliRef = useRef(false)
  const [centraFn, setCentraFn] = useState(null)
  const [evidenziaLegameFn, setEvidenziaLegameFn] = useState(null)
  const [resetVistaFn, setResetVistaFn] = useState(null)

  useEffect(() => {
    document.body.style.margin = "0"
    document.body.style.padding = "0"
    document.body.style.overflow = "hidden"
    document.body.style.background = STILE.sfondo_colore
    document.documentElement.style.overflow = "hidden"

    // Riparte sempre dalla base nominale: evita che un remount (es. StrictMode)
    // applichi il riscalamento più volte in sequenza.
    X_MIN = X_MIN_BASE
    X_MAX = X_MAX_BASE
    MIN_CAMERA_RATIO = MIN_CAMERA_RATIO_BASE
    MAX_CAMERA_RATIO = MAX_CAMERA_RATIO_BASE

    const isMobile = window.innerWidth < 768
    const container = document.createElement("div")
    container.style.cssText = isMobile
      ? `position:fixed;top:0;right:0;bottom:0;left:0;z-index:1;cursor:none;background:${STILE.sfondo_colore};`
      : `position:fixed;top:0;right:0;bottom:0;left:200px;z-index:1;cursor:none;background:${STILE.sfondo_colore};`
    document.body.appendChild(container)

    const graph = new Graph()
    let cameraRatio = 1
    let nodoHoverAttivo = null
    let prodottoHoverAttivo = null
    let ultimoProdottoHover = null
    let prodottoCliccato = null
    let designerCliccato = null
    let popupCanvas = null
    let primoClickFuoriDesigner = false
    let annoBloccato = null
    let mouseDownPos = null
    let isDragging = false
    let cameraPrimaDiClick = null
    let cameraPrimaLegame = null
    let cameraAnimId = null
    let touchGestureAttiva = false
    let touchWasMultiTouch = false
    let correntiHit = []
    let correnteHoverAttivo = null
    let correnteCliccata = null

    function animaCamera(target, durata, callback) {
      if (cameraAnimId) cancelAnimationFrame(cameraAnimId)
      const start = camera.getState()
      const inizio = performance.now()
      clamping = true
      function step(now) {
        const t = Math.min(1, (now - inizio) / durata)
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        camera.setState({
          x: lerp(start.x, target.x, ease),
          y: lerp(start.y, target.y, ease),
          ratio: lerp(start.ratio, target.ratio, ease),
          angle: start.angle,
        })
        richiediDisegnoOverlay(2)
        if (t < 1) {
          cameraAnimId = requestAnimationFrame(step)
        } else {
          cameraAnimId = null
          clamping = false
          if (callback) callback()
        }
      }
      cameraAnimId = requestAnimationFrame(step)
    }
    const animated = {}
    const dpr = window.devicePixelRatio || 1
    let viewportMin = Math.min(window.innerWidth, window.innerHeight)
    let mouseX = -100, mouseY = -100
    let mouseTrailX = -100, mouseTrailY = -100
    let mouseNelCanvas = false

    let imgCache = {}
    const imgColori = {}

    const prodottiPerDesigner = {}
    const prodottiMultiDesigner = []
    prodotti.forEach((p) => {
      const ds = getDesigners(p)
      if (ds.length > 1) {
        prodottiMultiDesigner.push(p)
      } else {
        const d = ds[0]
        if (!prodottiPerDesigner[d]) prodottiPerDesigner[d] = []
        prodottiPerDesigner[d].push(p)
      }
    })

    // Raggio di ogni prodotto in base all'età del designer alla progettazione (vedi
    // raggioBaseProdotto); se troppi prodotti dello stesso designer cadono sulla
    // stessa età, quell'anello si allarga solo per loro, il minimo necessario per
    // non farli sovrapporre. raggioMaxPerDesigner (il raggio più lontano di ciascun
    // designer, prodotti multi-designer inclusi) serve poi per la spaziatura verticale
    // tra un designer e l'altro.
    const raggioProdottoMap = new Map()
    const raggioMaxPerDesigner = {}
    Object.entries(prodottiPerDesigner).forEach(([nome, lista]) => {
      const gruppiEta = {}
      lista.forEach((p) => {
        const base = raggioBaseProdotto(p.anno, nome)
        const chiave = Math.round(base * 100)
        if (!gruppiEta[chiave]) gruppiEta[chiave] = { base, prodotti: [] }
        gruppiEta[chiave].prodotti.push(p)
      })
      let maxRaggio = STILE.eta_raggio_base
      Object.values(gruppiEta).forEach((g) => {
        const n = g.prodotti.length
        const extra = n > STILE.eta_soglia_stesso_anno ? (n - STILE.eta_soglia_stesso_anno) * STILE.eta_incremento_sovraffollamento : 0
        const raggioFinale = g.base + extra
        g.prodotti.forEach((p) => raggioProdottoMap.set(p, raggioFinale))
        maxRaggio = Math.max(maxRaggio, raggioFinale)
      })
      raggioMaxPerDesigner[nome] = maxRaggio
    })
    prodottiMultiDesigner.forEach((p) => {
      getDesigners(p).forEach((nome) => {
        const base = raggioBaseProdotto(p.anno, nome)
        raggioMaxPerDesigner[nome] = Math.max(raggioMaxPerDesigner[nome] || STILE.eta_raggio_base, base)
      })
    })

    const designerOrdinati = [...designers].sort((a, b) => a.nato - b.nato)

    // Gruppi di co-progettazione (transitivi: se A ha co-progettato con B e B con C,
    // A/B/C finiscono nello stesso gruppo). Priorità massima nel posizionamento: la
    // passata 2 più sotto (correnti) può avvicinare questi blocchi ad altri, ma non li
    // spezza mai.
    const gruppiCoprogetto = {}
    prodotti.forEach((p) => {
      const ds = getDesigners(p)
      if (ds.length < 2) return
      const set = new Set()
      ds.forEach((n) => { if (gruppiCoprogetto[n]) gruppiCoprogetto[n].forEach((x) => set.add(x)) })
      ds.forEach((n) => set.add(n))
      set.forEach((n) => { gruppiCoprogetto[n] = set })
    })

    // Gruppi per corrente (scuole + collettivi condivisi, transitivi come sopra: un
    // designer può fare da ponte fra più correnti, es. Sottsass fra Radical Design e
    // Memphis, e allora i due gruppi confluiscono in uno solo). Priorità inferiore al
    // co-progetto: usati nella passata 2 per avvicinare interi blocchi già formati.
    const correntiMembri = {}
    designers.forEach((d) => {
      ;[...(d.scuole || []), ...(d.collettivi || [])].forEach((nomeCorrente) => {
        if (!correntiMembri[nomeCorrente]) correntiMembri[nomeCorrente] = []
        correntiMembri[nomeCorrente].push(d.nome)
      })
    })
    const gruppiCorrenti = {}
    Object.values(correntiMembri).forEach((membri) => {
      const set = new Set()
      membri.forEach((n) => { if (gruppiCorrenti[n]) gruppiCorrenti[n].forEach((x) => set.add(x)) })
      membri.forEach((n) => set.add(n))
      set.forEach((n) => { gruppiCorrenti[n] = set })
    })

    // Passata 1: ordine cronologico, ma quando incontriamo un designer che appartiene a un
    // gruppo di co-progettazione, inseriamo subito dopo gli altri membri del gruppo
    // (dal più anziano al più giovane) invece di lasciarli nella loro posizione
    // cronologica naturale. Chi lo incontra per primo nel percorso cronologico è per
    // costruzione il più anziano del gruppo, e resta quindi "ancora" nella propria fascia.
    const inseriti = new Set()
    const ordinatoCoprogetto = []
    designerOrdinati.forEach((d) => {
      if (inseriti.has(d.nome)) return
      ordinatoCoprogetto.push(d)
      inseriti.add(d.nome)
      const gruppo = gruppiCoprogetto[d.nome]
      if (gruppo && gruppo.size > 1) {
        const altri = [...gruppo]
          .filter((n) => !inseriti.has(n))
          .map((n) => designers.find((x) => x.nome === n))
          .filter(Boolean)
          .sort((a, b) => a.nato - b.nato)
        altri.forEach((pd) => { ordinatoCoprogetto.push(pd); inseriti.add(pd.nome) })
      }
    })

    // Passata 2: i blocchi della passata 1 (ciascuno già contiguo: un singolo designer o
    // un intero gruppo di co-progettazione) vengono ulteriormente avvicinati quando
    // condividono una corrente. Si spostano sempre blocchi interi, mai singoli designer
    // al loro interno, quindi la garanzia della passata 1 (co-progetto mai spezzato) resta
    // intatta — le correnti possono solo aggiungere vicinanza, mai romperla.
    const blocchi = []
    {
      let i = 0
      while (i < ordinatoCoprogetto.length) {
        const gruppo = gruppiCoprogetto[ordinatoCoprogetto[i].nome]
        let j = i
        if (gruppo && gruppo.size > 1) {
          while (j + 1 < ordinatoCoprogetto.length && gruppiCoprogetto[ordinatoCoprogetto[j + 1].nome] === gruppo) j++
        }
        blocchi.push(ordinatoCoprogetto.slice(i, j + 1))
        i = j + 1
      }
    }
    const blockOf = new Map()
    blocchi.forEach((b) => b.forEach((d) => blockOf.set(d.nome, b)))
    const blocchiVisitati = new Set()
    const ordinato = []
    blocchi.forEach((blocco) => {
      if (blocchiVisitati.has(blocco)) return
      blocchiVisitati.add(blocco)
      ordinato.push(...blocco)
      const daUnire = new Set()
      blocco.forEach((d) => {
        const gc = gruppiCorrenti[d.nome]
        if (!gc) return
        gc.forEach((n) => {
          const altroBlocco = blockOf.get(n)
          if (altroBlocco && !blocchiVisitati.has(altroBlocco)) daUnire.add(altroBlocco)
        })
      })
      ;[...daUnire]
        .sort((a, b) => a[0].nato - b[0].nato)
        .forEach((altroBlocco) => {
          if (blocchiVisitati.has(altroBlocco)) return
          blocchiVisitati.add(altroBlocco)
          ordinato.push(...altroBlocco)
        })
    })

    // Passo verticale: standard tra designer non collegati, ridotto tra membri dello
    // stesso gruppo di affinità — co-progettazione, scuola/stile o collettivo condivisi
    // (li tiene vicini, indipendentemente dal numero di prodotti di ciascuno, per non
    // rompere le "fasce orizzontali" della vista timeline) — ma mai meno dello spazio
    // richiesto dalle orbite reali dei due designer coinvolti, per evitare sovrapposizioni
    // visive. Un unico passaggio cumulativo (anziché calcolare prima le posizioni "ideali"
    // e poi correggerle a parte) garantisce che ogni scarto sia sempre misurato dalla
    // posizione EFFETTIVA del designer precedente: se una coppia con orbite grandi viene
    // spinta più in basso del previsto, la coppia successiva eredita quello spostamento
    // invece di "perdere" lo spazio che le spettava.
    // Legami diretti (relazioni.json), SOLO per stringere lo spazio verticale tra due
    // designer già adiacenti nell'ordine finale: nessuna transitività, nessun riordino.
    // Testato: la chiusura transitiva su relazioni (come per scuole/collettivi) arriva
    // a spostare 150+ designer su 165, un mega-gruppo che rompe la diagonale.
    const legamiDiretti = new Set()
    relazioni.forEach((r) => {
      legamiDiretti.add(`${r.designer_a}|${r.designer_b}`)
      legamiDiretti.add(`${r.designer_b}|${r.designer_a}`)
    })

    let prevY = 0
    let prevRaggio = 0
    const posizioniCalcolate = ordinato.map((d, i) => {
      const raggio = raggioMaxPerDesigner[d.nome] || STILE.eta_raggio_base
      const manuale = d.y !== null && d.y !== undefined
      let y
      if (manuale) {
        y = d.y
      } else if (i === 0) {
        y = 0
      } else {
        const prev = ordinato[i - 1]
        const stessoGruppo = gruppiCoprogetto[d.nome] && gruppiCoprogetto[d.nome] === gruppiCoprogetto[prev.nome]
        const legameDiretto = !stessoGruppo && legamiDiretti.has(`${d.nome}|${prev.nome}`)
        const passoStandard = stessoGruppo ? STILE.passo_verticale_coprogetto
          : legameDiretto ? STILE.passo_verticale_legame
          : STILE.passo_verticale_base
        const minGap = (prevRaggio + raggio) + STILE.min_distanza_y
        y = prevY - Math.max(passoStandard, minGap)
      }
      prevY = y
      prevRaggio = raggio
      return { d, x: annoToX(d.nato), y, manuale, raggio }
    })

    // Se le orbite hanno esteso molto l'area verticale, allarghiamo anche l'asse X
    // PRIMA di creare i nodi (designer e prodotti), così le orbite restano circolari
    // invece di essere distorte da un riscalamento fatto a posteriori. L'ampiezza
    // dell'allargamento è calcolata sull'aspect ratio REALE del contenitore (non su
    // un fattore fisso scollegato dallo schermo): così, qualunque sia la crescita
    // futura dei dati, la vista a zoom minimo continua a riempire il viewport senza
    // margini vuoti. Da notare: questo NON influenza la dimensione dei pallini
    // (calcolaRaggio dipende solo dal numero di prodotti), solo la loro posizione X.
    let contenutoYMinStima = Infinity, contenutoYMaxStima = -Infinity
    posizioniCalcolate.forEach((p) => {
      contenutoYMinStima = Math.min(contenutoYMinStima, p.y - p.raggio)
      contenutoYMaxStima = Math.max(contenutoYMaxStima, p.y + p.raggio)
    })
    if (!Number.isFinite(contenutoYMinStima)) { contenutoYMinStima = Y_MIN; contenutoYMaxStima = Y_MAX }
    const yRangeStimato = Math.max(Y_MAX, contenutoYMaxStima) - Math.min(Y_MIN, contenutoYMinStima)
    const rectIniziale = container.getBoundingClientRect()
    const aspectViewport = rectIniziale.height > 0 ? rectIniziale.width / rectIniziale.height : 1.8
    const yRangeConMargine = yRangeStimato + MARGINE_Y * 2
    const xRangeBase = (X_MAX_BASE - X_MIN_BASE) + MARGINE_X * 2
    const xRangeTarget = yRangeConMargine * aspectViewport
    const fattoreScalaX = Math.max(1, xRangeTarget / xRangeBase)
    if (fattoreScalaX > 1) {
      X_MIN = X_MIN_BASE * fattoreScalaX
      X_MAX = X_MAX_BASE * fattoreScalaX
      posizioniCalcolate.forEach((p) => { p.x = annoToX(p.d.nato) })
    }

    // Passo di allineamento per lo snap fine delle posizioni (indipendente dalla
    // scala di allargamento dell'asse X): se si usasse lo stesso passo, via via
    // più grande, della griglia decorativa di sfondo, l'anti-sovrapposizione qui
    // sotto spingerebbe i designer nati nello stesso anno sempre più lontano dal
    // loro vero anno di nascita quando il contenuto cresce in altezza.
    const passoAllineamento = 1

    // Asse Y: arrotonda alla griglia mantenendo il gap minimo tra orbite adiacenti.
    {
      let snapPrevY = 0
      let snapPrevR = 0
      posizioniCalcolate.forEach((pos, i) => {
        if (pos.manuale) {
          pos.y = Math.round(pos.y / passoAllineamento) * passoAllineamento
          snapPrevY = pos.y; snapPrevR = pos.raggio; return
        }
        if (i === 0) { pos.y = 0; snapPrevY = 0; snapPrevR = pos.raggio; return }
        const minGap = (snapPrevR + pos.raggio) + STILE.min_distanza_y
        const yRounded = Math.round(pos.y / passoAllineamento) * passoAllineamento
        pos.y = (snapPrevY - yRounded >= minGap)
          ? yRounded
          : Math.floor((snapPrevY - minGap) / passoAllineamento) * passoAllineamento
        snapPrevY = pos.y
        snapPrevR = pos.raggio
      })
    }

    // Asse X: i designer nati lo stesso anno (o troppo vicini) vengono
    // raggruppati e distribuiti simmetricamente attorno alla loro posizione
    // media, invece di spingerli in avanti a catena — quella tecnica accumulava
    // una deriva crescente rispetto all'anno reale nei tratti con molte nascite
    // ravvicinate (es. un designer nato nel '31 finiva disegnato anni dopo).
    {
      const byX = [...posizioniCalcolate].sort((a, b) => a.x - b.x)
      let i = 0
      while (i < byX.length) {
        let j = i
        while (j + 1 < byX.length && byX[j + 1].x - byX[j].x < passoAllineamento) j++
        if (j > i) {
          const gruppo = byX.slice(i, j + 1)
          const centro = gruppo.reduce((s, p) => s + p.x, 0) / gruppo.length
          gruppo.forEach((pos, k) => { pos.x = centro + (k - (gruppo.length - 1) / 2) * passoAllineamento })
        }
        i = j + 1
      }
      byX.forEach((pos) => { pos.x = Math.round(pos.x / passoAllineamento) * passoAllineamento })
    }

    posizioniCalcolate.forEach(({ d, x, y }) => {
      graph.addNode(d.nome, {
        label: d.nome, size: STILE.designer_size, x, y,
        color: STILE.designer_colore, tipo: "designer",
        imgSrc: `${import.meta.env.BASE_URL}immagini/${d.foto}`, dati: d,
      })
      animated[d.nome] = { r: STILE.zoom_designer_min, alpha: 1 }
    })

    // Blocchi di co-progettazione nell'ordine finale (stessa partizione contigua usata
    // nella passata 2 sopra). Serve a far ragionare l'ameba alla stessa granularità del
    // posizionamento: un "passeggero" senza quel tag, finito lì solo perché indivisibile
    // dal suo gruppo di co-progetto (es. Naoki Matsunaga accanto a Bonetto, o Joe Colombo
    // trascinato dal co-progetto con Ambrogio Pozzi), non deve spezzare a metà un'ameba
    // che altrimenti sarebbe contigua.
    const blocchiOrdinatoFinale = []
    {
      let i = 0
      while (i < ordinato.length) {
        const gruppo = gruppiCoprogetto[ordinato[i].nome]
        let j = i
        if (gruppo && gruppo.size > 1) {
          while (j + 1 < ordinato.length && gruppiCoprogetto[ordinato[j + 1].nome] === gruppo) j++
        }
        blocchiOrdinatoFinale.push(ordinato.slice(i, j + 1))
        i = j + 1
      }
    }

    // --- Ameba correnti: per ogni corrente, i BLOCCHI che contengono almeno un membro
    // taggato e risultano ADIACENTI formano un'ameba piena ("diagonale"), che include
    // anche gli eventuali passeggeri non taggati (fanno parte dello stesso agglomerato
    // visivo, anche se non compaiono fra gli "esponenti" del pannello). Un solo membro
    // taggato senza altri nelle vicinanze ottiene solo un alone colorato sul suo pallino.
    const correntiBlob = []
    const correntiAloni = []
    Object.entries(correntiMembri).forEach(([nomeCorrente, membri]) => {
      const infoCorrente = correnti.find((c) => c.nome === nomeCorrente)
      if (!infoCorrente) return
      const membriSet = new Set(membri)
      const visitati = new Set()
      blocchiOrdinatoFinale.forEach((blocco, i) => {
        if (visitati.has(blocco) || !blocco.some((d) => membriSet.has(d.nome))) return
        let start = i, end = i
        while (start > 0 && blocchiOrdinatoFinale[start - 1].some((d) => membriSet.has(d.nome))) start--
        while (end < blocchiOrdinatoFinale.length - 1 && blocchiOrdinatoFinale[end + 1].some((d) => membriSet.has(d.nome))) end++
        const blocchiRun = blocchiOrdinatoFinale.slice(start, end + 1)
        blocchiRun.forEach((b) => visitati.add(b))
        const cluster = blocchiRun.flat().map((x) => x.nome)
        const membriTaggati = cluster.filter((n) => membriSet.has(n))
        if (membriTaggati.length > 1) {
          correntiBlob.push({ nomeCorrente, dati: infoCorrente, nodi: cluster })
        } else {
          correntiAloni.push({ nomeCorrente, dati: infoCorrente, nodo: membriTaggati[0] })
        }
      })
    })

    relazioni.forEach((r) => {
      if (graph.hasNode(r.designer_a) && graph.hasNode(r.designer_b)) {
        if (!graph.hasEdge(r.designer_a, r.designer_b) && !graph.hasEdge(r.designer_b, r.designer_a)) {
          graph.addEdge(r.designer_a, r.designer_b, {
            color: "rgba(0,0,0,0)", size: 0,
            tipo: "relazione", attivo: false, dati: r,
          })
        }
      }
    })

    Object.entries(prodottiPerDesigner).forEach(([designer, lista]) => {
      if (!graph.hasNode(designer)) return
      const dx = graph.getNodeAttribute(designer, "x")
      const dy = graph.getNodeAttribute(designer, "y")
      const listaOrdinata = [...lista].sort((a, b) => (a.anno || 0) - (b.anno || 0))
      const settori = calcolaSettoriDinamici(listaOrdinata)
      const angoliProdotti = calcolaAngoliPerProdotto(settori)

      const conteggioPerAnno = {}
      listaOrdinata.forEach((p) => {
        const a = p.anno || 1900
        conteggioPerAnno[a] = (conteggioPerAnno[a] || 0) + 1
      })
      const indiceCorrentePerAnno = {}

      const posizioniProdotti = listaOrdinata.map((p, i) => {
        const { centro, sliceAngolo } = angoliProdotti.get(p)
        const angolo = centro + (hashStr(p.nome) - 0.5) * sliceAngolo * STILE.arco_perturbazione
        const raggio = (raggioProdottoMap.get(p) ?? raggioBaseProdotto(p.anno, designer)) * (isMobile ? STILE.orbita_scala_mobile : 1)
        return {
          p, i,
          orbitaX: dx + Math.cos(angolo) * raggio,
          orbitaY: dy + Math.sin(angolo) * raggio,
        }
      })
      separaPosizioniSovrapposte(posizioniProdotti, STILE.prodotto_distanza_minima)

      posizioniProdotti.forEach(({ p, i, orbitaX, orbitaY }) => {
        const prodottoId = `prodotto:${designer}:${p.nome}:${i}`

        const anno = p.anno || 1900
        const nStessoAnno = conteggioPerAnno[anno]
        const idxAnno = indiceCorrentePerAnno[anno] || 0
        indiceCorrentePerAnno[anno] = idxAnno + 1
        const offsetVerticale = nStessoAnno > 1 ? (idxAnno - (nStessoAnno - 1) / 2) * STILE.timeline_scarto_stesso_anno : 0
        const timelineX = annoToX(anno)
        const timelineY = dy - offsetVerticale

        graph.addNode(prodottoId, {
          label: p.nome, size: STILE.prodotto_size * (p.top ? STILE.prodotto_scala_top : 1),
          x: orbitaX, y: orbitaY,
          color: STILE.prodotto_colore, tipo: "prodotto",
          imgSrc: `${import.meta.env.BASE_URL}immagini/${p.foto}`, dati: p,
          orbitaX, orbitaY, timelineX, timelineY,
        })
        graph.addEdge(designer, prodottoId, {
          color: STILE.edge_prodotto_colore,
          size: STILE.edge_prodotto_size, tipo: "prodotto"
        })
        animated[prodottoId] = { r: STILE.zoom_prodotto_min, alpha: 1 }
      })
    })

    const multiPerGruppo = {}
    prodottiMultiDesigner.forEach((p) => {
      const key = getDesigners(p).sort().join("|")
      if (!multiPerGruppo[key]) multiPerGruppo[key] = []
      multiPerGruppo[key].push(p)
    })

    const gruppiCollettivi = []

    Object.entries(multiPerGruppo).forEach(([key, lista]) => {
      const ds = key.split("|").filter((d) => graph.hasNode(d))
      if (ds.length === 0) return
      const coords = ds.map((d) => ({ x: graph.getNodeAttribute(d, "x"), y: graph.getNodeAttribute(d, "y") }))
      let centroX = coords.reduce((s, c) => s + c.x, 0) / coords.length
      let centroY = coords.reduce((s, c) => s + c.y, 0) / coords.length
      const centroYTimeline = centroY
      const n = lista.length
      const raggioShift = STILE.eta_raggio_base + n * 2 + 1
      if (ds.length === 2) {
        const dx = coords[1].x - coords[0].x
        const dy = coords[1].y - coords[0].y
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        centroX += (-dy / len) * raggioShift
        centroY += (dx / len) * raggioShift
      } else if (ds.length > 2) {
        centroX -= raggioShift
      }

      const dsData = ds.map((nome) => designers.find((d) => d.nome === nome)).filter(Boolean)
      const collettiviComuni = dsData.length > 0 && dsData[0].collettivi
        ? dsData[0].collettivi.filter((c) => dsData.every((d) => d.collettivi && d.collettivi.includes(c)))
        : []
      const nomeGruppo = collettiviComuni[0] || null
      const gruppoNodi = []

      const listaOrdinata = [...lista].sort((a, b) => (a.anno || 0) - (b.anno || 0))

      const gruppiEtaM = {}
      listaOrdinata.forEach((p) => {
        const base = raggioBaseProdottoMulti(p.anno, ds)
        const chiave = Math.round(base * 100)
        if (!gruppiEtaM[chiave]) gruppiEtaM[chiave] = { base, prodotti: [] }
        gruppiEtaM[chiave].prodotti.push(p)
      })
      const raggioProdottoMapM = new Map()
      Object.values(gruppiEtaM).forEach((g) => {
        const nGruppo = g.prodotti.length
        const extra = nGruppo > STILE.eta_soglia_stesso_anno ? (nGruppo - STILE.eta_soglia_stesso_anno) * STILE.eta_incremento_sovraffollamento : 0
        const raggioFinale = g.base + extra
        g.prodotti.forEach((p) => raggioProdottoMapM.set(p, raggioFinale))
      })

      const settoriM = calcolaSettoriDinamici(listaOrdinata, true)
      const angoliProdottiM = calcolaAngoliPerProdotto(settoriM)

      const conteggioPerAnnoM = {}
      listaOrdinata.forEach((p) => {
        const a = p.anno || 1900
        conteggioPerAnnoM[a] = (conteggioPerAnnoM[a] || 0) + 1
      })
      const indiceCorrentePerAnnoM = {}

      const posizioniProdottiM = listaOrdinata.map((p, i) => {
        const { centro, sliceAngolo } = angoliProdottiM.get(p)
        const angolo = centro + (hashStr(p.nome) - 0.5) * sliceAngolo * STILE.arco_perturbazione
        const raggio = (raggioProdottoMapM.get(p) ?? raggioBaseProdottoMulti(p.anno, ds)) * (isMobile ? STILE.orbita_scala_mobile : 1)
        return {
          p, i,
          orbitaX: centroX + Math.cos(angolo) * raggio,
          orbitaY: centroY + Math.sin(angolo) * raggio,
        }
      })
      separaPosizioniSovrapposte(posizioniProdottiM, STILE.prodotto_distanza_minima)

      posizioniProdottiM.forEach(({ p, i, orbitaX, orbitaY }) => {
        const prodottoId = `prodotto:multi:${p.nome}:${i}`

        const anno = p.anno || 1900
        const nStessoAnno = conteggioPerAnnoM[anno]
        const idxAnno = indiceCorrentePerAnnoM[anno] || 0
        indiceCorrentePerAnnoM[anno] = idxAnno + 1
        const offsetVerticale = nStessoAnno > 1 ? (idxAnno - (nStessoAnno - 1) / 2) * STILE.timeline_scarto_stesso_anno : 0
        const timelineX = annoToX(anno)
        const timelineY = centroYTimeline - offsetVerticale

        graph.addNode(prodottoId, {
          label: p.nome, size: STILE.prodotto_size * (p.top ? STILE.prodotto_scala_top : 1),
          x: orbitaX, y: orbitaY,
          color: STILE.prodotto_colore, tipo: "prodotto", multi: true,
          imgSrc: `${import.meta.env.BASE_URL}immagini/${p.foto}`, dati: p,
          orbitaX, orbitaY, timelineX, timelineY,
        })
        ds.forEach((d) => {
          graph.addEdge(d, prodottoId, {
            color: STILE.edge_prodotto_colore,
            size: STILE.edge_prodotto_size, tipo: "prodotto"
          })
        })
        animated[prodottoId] = { r: STILE.zoom_prodotto_min, alpha: 1 }
        if (nomeGruppo) gruppoNodi.push(prodottoId)
      })
      if (nomeGruppo && gruppoNodi.length > 0) {
        gruppiCollettivi.push({ nome: nomeGruppo, nodi: gruppoNodi })
      }
    })

    const renderer = new Sigma(graph, container, {
      renderEdgeLabels: false,
      enableCameraRotation: false,
      maxCameraRatio: MAX_CAMERA_RATIO,
      minCameraRatio: MIN_CAMERA_RATIO,
      zoomingRatio: 1.7,
      zoomDuration: 150,
      inertiaDuration: 5,
      inertiaRatio: 0,
      enableCameraRotation: false,
      nodeReducer: (node, data) => ({
        ...data, hidden: false, label: "",
        highlighted: false,
        color: "rgba(0,0,0,0)",
        borderColor: "rgba(0,0,0,0)",
        size: 0.001,
      }),
      edgeReducer: (edge, data) => ({
        ...data, hidden: true,
      }),
      labelRenderer: () => {},
      hoverRenderer: () => {},
    })

    // Il layout può superare Y_MIN/Y_MAX a causa degli offset cumulativi.
    // Calcoliamo quindi un bounding box reale, evitando che alcuni nodi finiscano
    // fuori dal sistema di coordinate usato da Sigma.
    let contenutoYMin = Infinity
    let contenutoYMax = -Infinity
    graph.forEachNode((node, attr) => {
      contenutoYMin = Math.min(contenutoYMin, attr.y)
      contenutoYMax = Math.max(contenutoYMax, attr.y)
    })
    if (!Number.isFinite(contenutoYMin) || !Number.isFinite(contenutoYMax)) {
      contenutoYMin = Y_MIN
      contenutoYMax = Y_MAX
    }

    const bboxYMin = Math.min(Y_MIN, contenutoYMin) - MARGINE_Y
    const bboxYMax = Math.max(Y_MAX, contenutoYMax) + MARGINE_Y
    renderer.setCustomBBox({
      x: [X_MIN - MARGINE_X, X_MAX + MARGINE_X],
      y: [bboxYMin, bboxYMax],
    })

    // minCameraRatio è relativo al bounding box: se il contenuto è cresciuto in
    // altezza, ricalcoliamo la frazione così da mantenere costante lo zoom massimo
    // assoluto (in unità-grafo), invece di lasciare che lo zoom massimo si "diluisca"
    // proporzionalmente alla crescita del contenuto.
    const bboxAltezza = bboxYMax - bboxYMin
    MIN_CAMERA_RATIO = Math.min(MIN_CAMERA_RATIO_BASE, MIN_CAMERA_RATIO_UNITA_VISIBILI / bboxAltezza)
    renderer.setSetting("minCameraRatio", MIN_CAMERA_RATIO)

    // Precarichiamo le immagini SOLO ora che ogni nodo ha una posizione
    // definitiva, dando priorità a quelle vicine al punto in cui l'utente si
    // troverà appena aperta la mappa (la camera salvata, o il designer di
    // default alla primissima visita), invece di scaricarle tutte insieme
    // nell'ordine arbitrario del json. Chi è vicino al centro iniziale è
    // pronto prima, chi è lontano (zoom out o angoli mai visitati) arriva dopo.
    let rifX = 0, rifY = 0
    let hoRiferimento = false
    try {
      const saved = JSON.parse(localStorage.getItem("dn-camera"))
      if (saved) {
        rifX = (X_MIN - MARGINE_X) + saved.x * ((X_MAX + MARGINE_X) - (X_MIN - MARGINE_X))
        rifY = bboxYMin + saved.y * (bboxYMax - bboxYMin)
        hoRiferimento = true
      }
    } catch {}
    if (!hoRiferimento && graph.hasNode("Achille Castiglioni")) {
      const cAttr = graph.getNodeAttributes("Achille Castiglioni")
      rifX = cAttr.x; rifY = cAttr.y
    }
    const vistiSrc = new Set()
    const nodiConDistanza = []
    graph.forEachNode((node, attr) => {
      if (vistiSrc.has(attr.imgSrc)) return
      vistiSrc.add(attr.imgSrc)
      const dx = attr.x - rifX, dy = attr.y - rifY
      nodiConDistanza.push({ src: attr.imgSrc, d2: dx * dx + dy * dy })
    })
    nodiConDistanza.sort((a, b) => a.d2 - b.d2)
    const imgPaths = nodiConDistanza.map((n) => n.src)

    const campionaColore = (src, img) => {
      try {
        const dim = 24
        const c = document.createElement("canvas")
        c.width = dim; c.height = dim
        const cx = c.getContext("2d")
        cx.drawImage(img, 0, 0, dim, dim)
        const dati = cx.getImageData(0, 0, dim, dim).data
        let r = 0, g = 0, b = 0, conteggio = 0
        for (let i = 0; i < dati.length; i += 4) {
          const pr = dati[i], pg = dati[i + 1], pb = dati[i + 2]
          if (pr > 240 && pg > 240 && pb > 240) continue // ignora il bianco di sfondo
          r += pr; g += pg; b += pb; conteggio++
        }
        if (conteggio === 0) { r = 255; g = 255; b = 255; conteggio = 1 }
        imgColori[src] = `rgb(${Math.round(r / conteggio)},${Math.round(g / conteggio)},${Math.round(b / conteggio)})`
      } catch {}
    }
    // Anche il lotto prioritario può essere lento su reti scadenti: un timeout
    // di sicurezza mostra comunque la mappa entro un tempo massimo, coi
    // pallini non ancora caricati che restano sul colore di base finché la
    // loro immagine arriva (il disegno li gestisce già così).
    let immaginiGiaPronte = false
    const segnalaPronte = () => {
      if (immaginiGiaPronte) return
      immaginiGiaPronte = true
      setImmaginiPronte(true)
    }
    const timeoutPronte = setTimeout(segnalaPronte, 1200)
    imgCache = preloadImages(imgPaths, 6, undefined, 12, segnalaPronte)
    Object.entries(imgCache).forEach(([src, img]) => {
      if (img.complete && img.naturalWidth > 0) campionaColore(src, img)
      else img.addEventListener("load", () => campionaColore(src, img), { once: true })
    })

    // Quando si apre il pannello di un designer, "salta la coda" del preload
    // generale per le foto dei suoi legami: sono le prossime immagini più
    // probabili da mostrare (un click sul legame le usa subito) e altrimenti,
    // se il preload generale non le ha ancora raggiunte, il passaggio risulta
    // a scatti finché non finiscono di caricare.
    function precaricaImmaginiLegami(nomeDesigner) {
      relazioni
        .filter((r) => r.designer_a === nomeDesigner || r.designer_b === nomeDesigner)
        .map((r) => (r.designer_a === nomeDesigner ? r.designer_b : r.designer_a))
        .forEach((nome) => {
          if (!graph.hasNode(nome)) return
          const src = graph.getNodeAttribute(nome, "imgSrc")
          if (!src || (imgCache[src] && imgCache[src].complete)) return
          const img = new Image()
          img.addEventListener("load", () => { campionaColore(src, img); richiediDisegnoOverlay(2) }, { once: true })
          imgCache[src] = img
          img.src = src
        })
    }

    const overlayCanvas = document.createElement("canvas")
    overlayCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10;"
    container.appendChild(overlayCanvas)

    function ridimensionaOverlay() {
      const rect = container.getBoundingClientRect()
      overlayCanvas.width = Math.max(1, Math.round(rect.width * dpr))
      overlayCanvas.height = Math.max(1, Math.round(rect.height * dpr))
      viewportMin = Math.min(rect.width, rect.height)
    }

    ridimensionaOverlay()
    cameraRatio = renderer.getCamera().getState().ratio

    function nodiCollegatiAlHover(nodo) {
      if (!nodo) return new Set()
      const s = new Set()
      s.add(nodo)
      graph.forEachEdge(nodo, (edge, attr, source, target) => {
        if (attr.tipo === "relazione" || attr.tipo === "prodotto") {
          s.add(source); s.add(target)
        }
      })
      return s
    }

    function zoomT() {
      // Riferito ai limiti reali di zoom (MIN/MAX_CAMERA_RATIO), non a una soglia fissa:
      // così t=0 e t=1 corrispondono esattamente allo 0% e al 100% mostrati nella barra
      // di zoom, e tutte le curve di scala (prodotti, designer, griglia) si distribuiscono
      // sull'intero intervallo reale invece di comprimersi/estrapolare vicino a un estremo.
      const ratio = Math.max(MIN_CAMERA_RATIO, Math.min(MAX_CAMERA_RATIO, cameraRatio))
      const logMax = Math.log(MAX_CAMERA_RATIO)
      const logMin = Math.log(MIN_CAMERA_RATIO)
      return (logMax - Math.log(ratio)) / (logMax - logMin)
    }

    // Inversa di zoomT(): converte una percentuale di zoom (0-1) nel ratio di
    // camera corrispondente, sempre coerente con i reali limiti min/max attuali.
    function ratioDaT(t) {
      const logMax = Math.log(MAX_CAMERA_RATIO)
      const logMin = Math.log(MIN_CAMERA_RATIO)
      return Math.exp(logMax - t * (logMax - logMin))
    }

    function vScale() {
      return Math.max(0.5, viewportMin / STILE.zoom_viewport_ref)
    }

    // Boost solo mobile, concentrato nella fascia di zoom 15%-80%: 0 ai bordi,
    // picco al centro (~47%), per non creare salti bruschi entrando/uscendo dalla fascia.
    function boostMedioMobile(t) {
      if (!isMobile) return 0
      const min = STILE.boost_medio_soglia_min, max = STILE.boost_medio_soglia_max
      if (t <= min || t >= max) return 0
      const meta = (min + max) / 2
      const semiAmpiezza = (max - min) / 2
      return 1 - Math.abs(t - meta) / semiAmpiezza
    }

    function calcolaRTarget(node, attr, nodoAttivo) {
      const t = zoomT()
      const vs = vScale()
      if (attr.tipo === "designer") {
        const tCurved = Math.pow(t, 1.2)
        const scalaSecondario = (CONTEGGIO_PRODOTTI_PER_DESIGNER.get(node) ?? 0) <= SOGLIA_DESIGNER_SECONDARIO
          ? STILE.designer_scala_secondario : 1
        let base = lerp(STILE.zoom_designer_min, STILE.zoom_designer_max, tCurved) * vs * scalaSecondario
        if (isMobile && t > STILE.boost_soglia) {
          const tBoost = (t - STILE.boost_soglia) / (1 - STILE.boost_soglia)
          base *= lerp(1, STILE.boost_mobile_max, tBoost)
        }
        const legameRT = legameEvidenziatoRef.current
        if (legameRT && (node === legameRT.a || node === legameRT.b)) return base * STILE.hover_scala
        return node === nodoAttivo ? base * STILE.hover_scala : base
      }
      if (attr.tipo === "prodotto") {
        const tDelayed = Math.max(0, (t - 0.2) / 0.8)
        const scalaTop = attr.dati?.top ? STILE.prodotto_scala_top : 1
        const scalaFoto = IMMAGINI_ESISTENTI.has(attr.dati?.foto) ? 1 : 0.5
        let base = lerp(STILE.zoom_prodotto_min, STILE.zoom_prodotto_max, tDelayed * tDelayed) * vs * scalaTop * scalaFoto
        if (isMobile && t > STILE.boost_soglia) {
          const tBoost = (t - STILE.boost_soglia) / (1 - STILE.boost_soglia)
          base *= lerp(1, STILE.boost_mobile_max, tBoost)
        }
        if (node === prodottoCliccato) return base * 1.2
        if (prodottoCliccato) return base
        if (node === prodottoHoverAttivo) return base * STILE.hover_scala
        return base
      }
      return lerp(STILE.zoom_prodotto_min, STILE.zoom_prodotto_max, Math.pow(t, 1.2)) * vs
    }

    function disegnaTutto() {
      const ctx = overlayCanvas.getContext("2d")
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const w = overlayCanvas.width / dpr
      const h = overlayCanvas.height / dpr

      const t = zoomT()
      const vs = vScale()
      const boostMedio = boostMedioMobile(t)
      const boostMedioLabel = 1 + boostMedio * (STILE.boost_medio_label_max - 1)
      const labelDesignerSize = Math.max(STILE.label_min, lerp(STILE.zoom_label_designer_min, STILE.zoom_label_designer_max, Math.pow(t, 1.2)) * vs) * boostMedioLabel
      const tLabel = Math.max(0, (t - STILE.zoom_label_soglia) / (1 - STILE.zoom_label_soglia))
      const mostraLabelProdotti = t > STILE.zoom_label_soglia
      let labelProdottoSize = mostraLabelProdotti ? Math.max(STILE.label_min, STILE.zoom_label_prodotto_max * tLabel * vs) * boostMedioLabel : 0
      if (isMobile && mostraLabelProdotti && t > STILE.boost_soglia) {
        const tBoostLabel = (t - STILE.boost_soglia) / (1 - STILE.boost_soglia)
        labelProdottoSize *= lerp(1, STILE.boost_mobile_label_max, tBoostLabel)
      }
      const nodoAttivo = designerCliccato || nodoHoverAttivo
      const collegati = nodiCollegatiAlHover(nodoAttivo)
      const hoverAttivo = nodoAttivo !== null

      const tGriglia = Math.pow(Math.min(1, t), 10)
      const grigliaRaggio = lerp(STILE.zoom_griglia_min, STILE.zoom_griglia_max, tGriglia)
      const yGrafoMin = Math.min(Y_MIN, contenutoYMin) - MARGINE_Y
      const yGrafoMax = Math.max(Y_MAX, contenutoYMax) + MARGINE_Y
      const ogniN = t < 0.3 ? 2 : 1
      const grigliaRaggioEffettivo = t < 0.3 ? grigliaRaggio * 0.7 : grigliaRaggio

      const padLati = isMobile ? 10 : 40
      const padSinistra = isMobile ? padLati : Math.max(20, 240 * uiScale - 180)
      const padBasso = isMobile ? 10 : 16
      const padSopra = isMobile
        ? (topBarRef.current ? topBarRef.current.getBoundingClientRect().height + 22 : 100)
        : 110 * uiScale

      ctx.save()
      ctx.beginPath()
      ctx.rect(padSinistra, padSopra, Math.max(0, w - padSinistra - padLati), Math.max(0, h - padSopra - padBasso))
      ctx.clip()

      // Passo fisso in unità-grafo, uguale su X e Y: celle sempre quadrate,
      // indipendenti da quanto si è allargato X_MIN/X_MAX per le orbite.
      // Il ciclo è limitato alla sola area visibile a schermo (+ un margine di 2 unità),
      // altrimenti con X_MIN/X_MAX molto allargati si attraversano decine di migliaia
      // di punti fuori schermo a ogni frame.
      const angoloTL = renderer.viewportToGraph({ x: 0, y: 0 })
      const angoloBR = renderer.viewportToGraph({ x: w, y: h })
      const visXMin = Math.min(angoloTL.x, angoloBR.x) - 2
      const visXMax = Math.max(angoloTL.x, angoloBR.x) + 2
      const visYMin = Math.min(angoloTL.y, angoloBR.y) - 2
      const visYMax = Math.max(angoloTL.y, angoloBR.y) + 2
      const xGrafoMin = Math.max(X_MIN - MARGINE_X, visXMin)
      const xGrafoMax = Math.min(X_MAX + MARGINE_X, visXMax)
      const yGrafoMinVis = Math.max(yGrafoMin, visYMin)
      const yGrafoMaxVis = Math.min(yGrafoMax, visYMax)
      // Se X_MIN/X_MAX si sono allargati per far spazio alle orbite, un'unità grafo
      // corrisponde a una frazione di anno più piccola: allarghiamo il passo della
      // griglia in proporzione, così la densità visiva resta quella di sempre.
      const passoGriglia = Math.max(1, Math.round((X_MAX - X_MIN) / (X_MAX_BASE - X_MIN_BASE)))
      const gxInizio = Math.ceil(xGrafoMin / passoGriglia) * passoGriglia
      const gyInizio = Math.ceil(yGrafoMinVis / passoGriglia) * passoGriglia
      for (let gx = gxInizio; gx <= xGrafoMax; gx += passoGriglia) {
        const gxi = gx / passoGriglia
        if (ogniN > 1 && gxi % ogniN !== 0) continue
        for (let gy = gyInizio; gy <= yGrafoMaxVis; gy += passoGriglia) {
          const gyi = gy / passoGriglia
          if (ogniN > 1 && ((gyi + gxi) % 2 !== 0)) continue
          const screen = renderer.graphToViewport({ x: gx, y: gy })
          if (screen.x < -2 || screen.x > w + 2 || screen.y < -2 || screen.y > h + 2) continue
          ctx.beginPath()
          ctx.arc(screen.x, screen.y, grigliaRaggioEffettivo, 0, Math.PI * 2)
          ctx.fillStyle = STILE.griglia_pallino_colore
          ctx.fill()
        }
      }

      // --- Ameba correnti (scuole + collettivi): sfondo, dietro a tutto il resto.
      // Due trattamenti: macchia piena ("diagonale") per chi ha almeno un altro membro
      // della stessa corrente vicino nell'ordine finale, semplice alone colorato per chi
      // è isolato nella propria corrente (nessuna forma connettiva, solo il colore).
      // Svuotare correntiHit anche a interruttore spento basta a disattivare hover/click
      // altrove (fanno già .find() su un array vuoto), senza dover duplicare il controllo.
      correntiHit = []
      if (correntiVisibiliRef.current) {
      ctx.save()
      ctx.globalCompositeOperation = "multiply"
      correntiBlob.forEach((cb) => {
        const punti = cb.nodi
          .filter((n) => graph.hasNode(n))
          .map((n) => {
            const a = graph.getNodeAttributes(n)
            const p = renderer.graphToViewport({ x: a.x, y: a.y })
            const r = animated[n]?.r ?? STILE.zoom_designer_min
            return { x: p.x, y: p.y, r, n }
          })
        if (punti.length === 0) return

        const path = new Path2D()
        let poligonoHit = null
        let cerchioHit = null
        if (punti.length === 1) {
          path.arc(punti[0].x, punti[0].y, STILE.corrente_raggio_punto_singolo, 0, Math.PI * 2)
          cerchioHit = { x: punti[0].x, y: punti[0].y, r: STILE.corrente_raggio_punto_singolo }
        } else {
          // Inviluppo convesso di campioni presi sul bordo reale di ogni pallino (anziché
          // un poligono coi soli centri espansi dal centroide): abbraccia meglio le orbite
          // vere e, avendo molti più vertici ravvicinati, la successiva lisciatura elimina
          // le punte residue tipiche di cluster piccoli (2-3 designer) e dà un profilo
          // arrotondato "a nuvola" invece che a lente. Il raggio di ogni campione è
          // sbalzato in modo pseudo-casuale ma stabile (hashStr su corrente+nodo+indice,
          // non Math.random) così il profilo resta irregolare senza tremolare da un
          // frame all'altro.
          const CAMPIONI_PER_PUNTO = 12
          const campioni = []
          punti.forEach((p) => {
            const margineBase = p.r * STILE.corrente_margine_fattore
            for (let k = 0; k < CAMPIONI_PER_PUNTO; k++) {
              const ang = (k / CAMPIONI_PER_PUNTO) * Math.PI * 2
              const jitter = hashStr(`${cb.nomeCorrente}|${p.n}|${k}`)
              const raggio = p.r + margineBase * (1 + (jitter - 0.5) * STILE.corrente_irregolarita)
              campioni.push({ x: p.x + Math.cos(ang) * raggio, y: p.y + Math.sin(ang) * raggio })
            }
          })
          const hull = convexHull(campioni)
          const primo = hull[0]
          const ultimo = hull[hull.length - 1]
          path.moveTo((ultimo.x + primo.x) / 2, (ultimo.y + primo.y) / 2)
          for (let i = 0; i < hull.length; i++) {
            const curr = hull[i]
            const next = hull[(i + 1) % hull.length]
            path.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2)
          }
          path.closePath()
          poligonoHit = hull
        }

        const inHover = correnteHoverAttivo === cb
        ctx.globalAlpha = STILE.corrente_alpha * (inHover ? STILE.corrente_hover_boost : 1)
        ctx.fillStyle = cb.dati.colore
        ctx.fill(path)
        correntiHit.push({ dati: cb, poligono: poligonoHit, cerchio: cerchioHit })
      })

      correntiAloni.forEach((al) => {
        if (!graph.hasNode(al.nodo)) return
        const a = graph.getNodeAttributes(al.nodo)
        const p = renderer.graphToViewport({ x: a.x, y: a.y })
        const r = animated[al.nodo]?.r ?? STILE.zoom_designer_min
        const raggioAlone = r + STILE.corrente_alone_margine

        const path = new Path2D()
        path.arc(p.x, p.y, raggioAlone, 0, Math.PI * 2)

        const inHover = correnteHoverAttivo === al
        ctx.globalAlpha = STILE.corrente_alone_alpha * (inHover ? STILE.corrente_hover_boost : 1)
        ctx.strokeStyle = al.dati.colore
        ctx.lineWidth = STILE.corrente_alone_spessore
        ctx.stroke(path)
        correntiHit.push({ dati: al, cerchio: { x: p.x, y: p.y, r: raggioAlone } })
      })
      ctx.restore()
      }

      if (vistaInterna === "timeline") {
        graph.forEachNode((node, attr) => {
          if (attr.tipo !== "designer") return
          const dati = attr.dati
          const morto = dati.morto || 2025
          if (!animated[node]) animated[node] = { r: STILE.zoom_designer_min, alpha: 1 }
          animated[node].vita = lerp(animated[node].vita ?? 0, 1, STILE.lerp_velocita * 0.7)
          const vitaT = animated[node].vita
          const nascitaX = annoToX(dati.nato)
          const vitaEndX = nascitaX + (annoToX(morto) - nascitaX) * vitaT
          const posNascita = renderer.graphToViewport({ x: nascitaX, y: attr.y })
          const posMorte = renderer.graphToViewport({ x: vitaEndX, y: attr.y })
          const r = (animated[node]?.r ?? STILE.zoom_designer_min) * 0.8
          ctx.globalAlpha = 0.06 * vitaT
          ctx.fillStyle = "#000000"
          ctx.beginPath()
          ctx.moveTo(posNascita.x, posNascita.y - r)
          ctx.lineTo(posMorte.x, posMorte.y - r)
          ctx.arc(posMorte.x, posMorte.y, r, -Math.PI / 2, Math.PI / 2)
          ctx.lineTo(posNascita.x, posNascita.y + r)
          ctx.arc(posNascita.x, posNascita.y, r, Math.PI / 2, -Math.PI / 2)
          ctx.closePath()
          ctx.fill()
          ctx.globalAlpha = 1
        })
      } else {
        graph.forEachNode((node, attr) => {
          if (attr.tipo !== "designer" || !animated[node]) return
          if (animated[node].vita > 0.01) {
            animated[node].vita = lerp(animated[node].vita, 0, STILE.lerp_velocita * 0.7)
            const dati = attr.dati
            const morto = dati.morto || 2025
            const vitaT = animated[node].vita
            const nascitaX = annoToX(dati.nato)
            const vitaEndX = nascitaX + (annoToX(morto) - nascitaX) * vitaT
            const posNascita = renderer.graphToViewport({ x: nascitaX, y: attr.y })
            const posMorte = renderer.graphToViewport({ x: vitaEndX, y: attr.y })
            const r = (animated[node]?.r ?? STILE.zoom_designer_min) * 0.8
            ctx.globalAlpha = 0.06 * vitaT
            ctx.fillStyle = "#000000"
            ctx.beginPath()
            ctx.moveTo(posNascita.x, posNascita.y - r)
            ctx.lineTo(posMorte.x, posMorte.y - r)
            ctx.arc(posMorte.x, posMorte.y, r, -Math.PI / 2, Math.PI / 2)
            ctx.lineTo(posNascita.x, posNascita.y + r)
            ctx.arc(posNascita.x, posNascita.y, r, Math.PI / 2, -Math.PI / 2)
            ctx.closePath()
            ctx.fill()
            ctx.globalAlpha = 1
          }
        })
      }

      amoebaAlphaAnimata = lerp(amoebaAlphaAnimata, transizioneAttiva ? 0 : 1, STILE.lerp_velocita)
      gruppiCollettivi.forEach(({ nome, nodi }) => {
        if (amoebaAlphaAnimata < 0.01) return
        const nodiValidi = nodi.filter((n) => graph.hasNode(n))
        if (nodiValidi.length < 2) return

        // Ordine dei vertici stabile, calcolato sulla posizione di destinazione
        // della vista corrente (non su quella live interpolata): durante la
        // transizione i punti possono incrociarsi in angolo rispetto al centro,
        // e ri-ordinare ogni frame causava un giravolta del contorno.
        const ordineStabile = nodiValidi.map((n) => {
          const a = graph.getNodeAttributes(n)
          const tx = vistaInterna === "timeline" ? a.timelineX : a.orbitaX
          const ty = vistaInterna === "timeline" ? a.timelineY : a.orbitaY
          return { n, tx, ty }
        })
        const tcx = ordineStabile.reduce((s, p) => s + p.tx, 0) / ordineStabile.length
        const tcy = ordineStabile.reduce((s, p) => s + p.ty, 0) / ordineStabile.length
        ordineStabile.forEach((p) => { p.angoloStabile = Math.atan2(p.ty - tcy, p.tx - tcx) })
        ordineStabile.sort((a, b) => a.angoloStabile - b.angoloStabile)

        const angolati = ordineStabile.map(({ n }) => {
          const a = graph.getNodeAttributes(n)
          const p = renderer.graphToViewport({ x: a.x, y: a.y })
          const r = animated[n]?.r ?? STILE.zoom_prodotto_min
          return { x: p.x, y: p.y, r }
        })

        const cx = angolati.reduce((s, p) => s + p.x, 0) / angolati.length
        const cy = angolati.reduce((s, p) => s + p.y, 0) / angolati.length

        const espansi = angolati.map((p) => {
          const dx = p.x - cx, dy = p.y - cy
          const dist = Math.sqrt(dx * dx + dy * dy)
          const pad = p.r * 2 + 6
          const scala = (dist + p.r + pad) / Math.max(dist, 0.01)
          return { x: cx + dx * scala, y: cy + dy * scala }
        })

        ctx.globalAlpha = 0.4 * amoebaAlphaAnimata
        ctx.beginPath()
        const primo = espansi[0]
        const ultimo = espansi[espansi.length - 1]
        ctx.moveTo((ultimo.x + primo.x) / 2, (ultimo.y + primo.y) / 2)
        for (let i = 0; i < espansi.length; i++) {
          const curr = espansi[i]
          const next = espansi[(i + 1) % espansi.length]
          ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2)
        }
        ctx.closePath()
        ctx.strokeStyle = "#222222"
        ctx.lineWidth = 0.5
        ctx.stroke()

        const sinistraX = Math.min(...espansi.map((p) => p.x)) - 8
        ctx.font = "300 10px Roboto"
        ctx.fillStyle = "#aaaaaa"
        ctx.textAlign = "right"
        ctx.fillText(nome, sinistraX, cy + 3)
        ctx.globalAlpha = 1
      })

      graph.forEachNode((node, attr) => {
        if (!animated[node]) animated[node] = { r: STILE.zoom_prodotto_min, alpha: 1 }
        const rTarget = calcolaRTarget(node, attr, nodoAttivo)
        let alphaTarget = 1
        const evid = nodoEvidenziatoRef.current
        const azFiltro = aziendaAttivaRef.current
        const designerAttuale = evid || designerCliccato
        const legame = legameEvidenziatoRef.current
        if (legame) {
          alphaTarget = (node === legame.a || node === legame.b) ? 1 : 0.08
        } else if (azFiltro && aziendaGlobaleRef.current) {
          if (attr.tipo === "prodotto") {
            alphaTarget = (attr.dati && (attr.dati.azienda === azFiltro || attr.dati.azienda_attuale === azFiltro)) ? 1 : 0.08
          } else if (attr.tipo === "designer") {
            const haProdottoAzienda = graph.neighbors(node).some(n => {
              const na = graph.getNodeAttribute(n, "dati")
              return na && (na.azienda === azFiltro || na.azienda_attuale === azFiltro)
            })
            alphaTarget = haProdottoAzienda ? 1 : 0.08
          }
        } else if (azFiltro && designerAttuale) {
          if (attr.tipo === "prodotto") {
            const isDelDesigner = graph.hasNode(designerAttuale) && graph.neighbors(designerAttuale).includes(node)
            alphaTarget = (attr.dati && (attr.dati.azienda === azFiltro || attr.dati.azienda_attuale === azFiltro) && isDelDesigner) ? 1 : 0.08
          } else if (attr.tipo === "designer") {
            alphaTarget = node === designerAttuale ? 1 : 0.08
          }
        } else if (evid) {
          const evidTipo = graph.hasNode(evid) ? graph.getNodeAttribute(evid, "tipo") : null
          if (evidTipo === "designer") {
            const evidCollegati = nodiCollegatiAlHover(evid)
            alphaTarget = evidCollegati.has(node) ? 1 : 0.15
          } else {
            const designersDelEvid = graph.hasNode(evid)
              ? graph.neighbors(evid).filter(n => graph.getNodeAttribute(n, "tipo") === "designer")
              : []
            alphaTarget = (node === evid || designersDelEvid.includes(node)) ? 1 : 0.15
          }
        } else if (azFiltro) {
          if (attr.tipo === "prodotto") {
            const isDelDesigner = designerCliccato && graph.hasNode(designerCliccato) && graph.neighbors(designerCliccato).includes(node)
            alphaTarget = (attr.dati && (attr.dati.azienda === azFiltro || attr.dati.azienda_attuale === azFiltro) && isDelDesigner) ? 1 : 0.08
          } else if (attr.tipo === "designer") {
            alphaTarget = node === designerCliccato ? 1 : 0.08
          }
        } else if (prodottoCliccato) {
          const designersDelCliccato = graph.hasNode(prodottoCliccato)
            ? graph.neighbors(prodottoCliccato).filter(n => graph.getNodeAttribute(n, "tipo") === "designer")
            : []
          alphaTarget = (node === prodottoCliccato || designersDelCliccato.includes(node)) ? 1 : 0.1
        } else if (prodottoHoverAttivo) {
          const designersDelProdotto = prodottoHoverAttivo && graph.hasNode(prodottoHoverAttivo)
            ? graph.neighbors(prodottoHoverAttivo).filter(n => graph.getNodeAttribute(n, "tipo") === "designer")
            : []
          alphaTarget = (node === prodottoHoverAttivo || designersDelProdotto.includes(node)) ? 1 : 0.2
        } else if (hoverAttivo) {
          alphaTarget = collegati.has(node) ? 1 : STILE.hover_opacita_altri
        }
        animated[node].r = lerp(animated[node].r, rTarget, STILE.lerp_velocita)
        animated[node].alpha = lerp(animated[node].alpha, alphaTarget, STILE.lerp_velocita)
      })

      graph.forEachEdge((edge, attr, source, target) => {
        const posS = renderer.graphToViewport({ x: graph.getNodeAttribute(source, "x"), y: graph.getNodeAttribute(source, "y") })
        const posT = renderer.graphToViewport({ x: graph.getNodeAttribute(target, "x"), y: graph.getNodeAttribute(target, "y") })

        if (attr.tipo === "relazione") {
          if (attr.attivo) {
            ctx.globalAlpha = 1
            ctx.beginPath()
            ctx.moveTo(posS.x, posS.y)
            ctx.lineTo(posT.x, posT.y)
            ctx.strokeStyle = STILE.edge_relazione_colore
            ctx.lineWidth = STILE.edge_relazione_size
            ctx.setLineDash([5, 5])
            ctx.stroke()
            ctx.setLineDash([])
          }
        }

        if (attr.tipo === "prodotto") {
          let edgeColor = STILE.edge_prodotto_colore
          let edgeWidth = STILE.edge_prodotto_size
          let edgeAlpha = 1
          const prodottoInEvidenza = prodottoCliccato || prodottoHoverAttivo
          if (legameEvidenziatoRef.current) {
            const { a, b } = legameEvidenziatoRef.current
            edgeAlpha = (source === a || target === a || source === b || target === b) ? 1 : 0.05
          } else if (prodottoInEvidenza) {
            if (source === prodottoInEvidenza || target === prodottoInEvidenza) {
              edgeColor = "#000000"
              edgeWidth = 0.5
            } else {
              edgeAlpha = 0
            }
          } else if (hoverAttivo) {
            if (!collegati.has(source) || !collegati.has(target)) {
              edgeAlpha = 0.06
            }
          }
          ctx.globalAlpha = edgeAlpha
          ctx.beginPath()
          ctx.moveTo(posS.x, posS.y)
          const midX = (posS.x + posT.x) / 2
          ctx.bezierCurveTo(midX, posS.y, midX, posT.y, posT.x, posT.y)
          ctx.strokeStyle = edgeColor
          ctx.lineWidth = edgeWidth
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        ctx.globalAlpha = 1
      })

      if (vistaInterna === "timeline") {
        const annoLinea = annoBloccato || (prodottoHoverAttivo && graph.hasNode(prodottoHoverAttivo) ? graph.getNodeAttribute(prodottoHoverAttivo, "dati").anno : null)
        if (annoLinea) {
          const lineaX = renderer.graphToViewport({ x: annoToX(annoLinea), y: 0 }).x
          ctx.beginPath()
          ctx.moveTo(lineaX, 0)
          ctx.lineTo(lineaX, h)
          ctx.strokeStyle = STILE.edge_relazione_colore
          ctx.lineWidth = STILE.edge_relazione_size
          ctx.setLineDash([5, 5])
          ctx.stroke()
          ctx.setLineDash([])
          ctx.font = "600 14px Roboto"
          ctx.fillStyle = "#555"
          ctx.textAlign = "center"
          ctx.fillText(annoLinea, lineaX, 18)
        }
      }

      const nodiProdotti = []
      const nodiDesigner = []
      const inPrimoPiano = prodottoCliccato || ultimoProdottoHover
      graph.forEachNode((node, attr) => {
        if (attr.tipo === "designer") {
          nodiDesigner.push({ node, attr })
        } else {
          nodiProdotti.push({ node, attr })
        }
      })
      nodiProdotti.sort((a, b) => (animated[a.node]?.r ?? STILE.zoom_prodotto_min) - (animated[b.node]?.r ?? STILE.zoom_prodotto_min))
      if (inPrimoPiano) {
        const idx = nodiProdotti.findIndex((n) => n.node === inPrimoPiano)
        if (idx !== -1) {
          const [item] = nodiProdotti.splice(idx, 1)
          nodiProdotti.push(item)
        }
      }
      const nodiFiltrati = [...nodiProdotti, ...nodiDesigner]

      nodiFiltrati.forEach(({ node, attr }) => {
        const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
        const r = animated[node]?.r ?? STILE.zoom_prodotto_min
        const alpha = animated[node]?.alpha ?? 1

        if (pos.x < -r || pos.x > w + r || pos.y < -r || pos.y > h + r) return

        ctx.globalAlpha = alpha
        const img = imgCache[attr.imgSrc]
        const sogliaImg = attr.tipo === "designer" ? 0 : (isMobile ? 6 : 12)
        const haImg = r > sogliaImg && img && img.complete && img.naturalWidth > 0

        if (!haImg) {
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
          ctx.fillStyle = imgColori[attr.imgSrc] || "#ffffff"
          ctx.fill()
        }

        if (haImg) {
          ctx.save()
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
          ctx.clip()
          const iw = img.naturalWidth, ih = img.naturalHeight
          const scale = Math.max(r * 2 / iw, r * 2 / ih)
          const sw = iw * scale, sh = ih * scale
          ctx.drawImage(img, pos.x - sw / 2, pos.y - sh / 2, sw, sh)
          ctx.restore()
        }

        if (attr.tipo === "prodotto" && haImg) {
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
          ctx.strokeStyle = "#ffffff"
          ctx.lineWidth = Math.max(0.5, Math.min(3, r * 0.18))
          ctx.stroke()
        }
        if (attr.tipo === "designer") {
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
          ctx.strokeStyle = "#000000"
          ctx.lineWidth = 0.5
          ctx.stroke()
        }

        if (attr.tipo === "designer") {
          const cognome = attr.dati.cognome || attr.label.split(" ").pop()
          const nome = attr.label.slice(0, attr.label.length - cognome.length).trim()
          const lx = pos.x + r + STILE.label_offset
          const altezzaBlocco = labelDesignerSize * 2 + 5 + (labelDesignerSize - 1)
          const lyStart = pos.y - altezzaBlocco / 2 + labelDesignerSize

          const date = attr.dati.morto ? `${attr.dati.nato} — ${attr.dati.morto}` : `${attr.dati.nato}`
          const pad = 3
          const bgColor = STILE.label_sfondo_colore || STILE.sfondo_colore

          ctx.font = `400 ${labelDesignerSize}px Roboto`
          const wNome = ctx.measureText(nome).width
          ctx.font = `700 ${labelDesignerSize}px Roboto`
          const wCognome = ctx.measureText(cognome).width
          ctx.font = `${STILE.label_date_peso} ${labelDesignerSize - 1}px Roboto`
          const wDate = ctx.measureText(date).width

          let ly = lyStart
          ctx.globalAlpha = 0.85 * alpha
          ctx.fillStyle = bgColor
          ctx.fillRect(lx - pad, ly - labelDesignerSize, wNome + pad * 2, labelDesignerSize + pad)
          ctx.fillRect(lx - pad, ly + 1, wCognome + pad * 2, labelDesignerSize + pad)
          ctx.fillRect(lx - pad, ly + labelDesignerSize + 6, wDate + pad * 2, (labelDesignerSize - 1) + pad)
          ctx.globalAlpha = alpha

          ctx.textAlign = "left"
          ctx.fillStyle = STILE.label_designer_colore
          ctx.font = `400 ${labelDesignerSize}px Roboto`
          ctx.fillText(nome, lx, ly)
          ly += labelDesignerSize + 1
          ctx.font = `700 ${labelDesignerSize}px Roboto`
          ctx.fillText(cognome, lx, ly)
          ly += labelDesignerSize + 5
          ctx.font = `${STILE.label_date_peso} ${labelDesignerSize - 1}px Roboto`
          ctx.fillStyle = STILE.label_date_colore
          ctx.fillText(date, lx, ly)
        }

        if (attr.tipo === "prodotto" && mostraLabelProdotti) {
          ctx.font = `${STILE.label_prodotto_peso} ${labelProdottoSize}px Roboto`
          ctx.fillStyle = STILE.label_prodotto_colore
          ctx.textAlign = "left"
          ctx.fillText(attr.label, pos.x + r + STILE.label_offset, pos.y + labelProdottoSize / 3)
          if (attr.dati.anno) {
            ctx.font = `300 ${labelProdottoSize - 1}px Roboto`
            ctx.fillStyle = STILE.label_prodotto_anno_colore
            ctx.fillText(attr.dati.anno_label || attr.dati.anno, pos.x + r + STILE.label_offset, pos.y + labelProdottoSize / 3 + labelProdottoSize + 1)
          }
        }
        ctx.globalAlpha = 1
      })

      ctx.restore()

      {
        const a0 = renderer.graphToViewport({ x: annoToX(ANNO_MIN), y: 0 })
        const a1 = renderer.graphToViewport({ x: annoToX(ANNO_MAX), y: 0 })
        const pxPerAnno = Math.abs(a1.x - a0.x) / (ANNO_MAX - ANNO_MIN)
        const passoMinPx = isMobile ? 40 : 56
        const passiCandidati = [1, 2, 5, 10, 20, 50]
        let passoAnno = 50
        for (const p of passiCandidati) {
          if (pxPerAnno * p >= passoMinPx) { passoAnno = p; break }
        }
        const assePosY = padSopra - 14
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, w, padSopra)
        ctx.clip()
        ctx.font = isMobile ? "500 11px Roboto" : "500 12px Roboto"
        ctx.fillStyle = isMobile ? "#a8a8a8" : "#6a6a6a"
        ctx.textAlign = "center"
        const annoInizio = Math.ceil(ANNO_MIN / passoAnno) * passoAnno
        for (let anno = annoInizio; anno <= ANNO_MAX; anno += passoAnno) {
          const screen = renderer.graphToViewport({ x: annoToX(anno), y: 0 })
          if (screen.x < padSinistra - 20 || screen.x > w - padLati + 20) continue
          ctx.fillText(anno, screen.x, assePosY)
        }
        ctx.restore()
      }

      if (mouseNelCanvas) {
        const suElemento = !!(prodottoHoverAttivo || nodoHoverAttivo)
        if (suElemento) {
          ctx.globalAlpha = 0.35
          ctx.beginPath()
          ctx.arc(mouseX, mouseY, STILE.cursore_alone_raggio, 0, Math.PI * 2)
          ctx.fillStyle = STILE.cursore_alone_colore
          ctx.fill()
          ctx.globalAlpha = 1
        } else {
          mouseTrailX = lerp(mouseTrailX, mouseX, STILE.cursore_alone_velocita)
          mouseTrailY = lerp(mouseTrailY, mouseY, STILE.cursore_alone_velocita)
          ctx.beginPath()
          ctx.arc(mouseTrailX, mouseTrailY, STILE.cursore_alone_raggio, 0, Math.PI * 2)
          ctx.strokeStyle = STILE.cursore_alone_colore
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(mouseX, mouseY, STILE.cursore_raggio, 0, Math.PI * 2)
          ctx.fillStyle = STILE.cursore_colore
          ctx.fill()
        }
      }

      if (isMobile && popupCanvas) {
        const anchor = renderer.graphToViewport({ x: popupCanvas.gx, y: popupCanvas.gy })
        if (anchor.x > -100 && anchor.x < w + 100 && anchor.y > -100 && anchor.y < h + 100) {
          const pad = 10
          const cardW = 220
          const fontDesc = 10
          const lineHDesc = 13
          ctx.save()
          ctx.font = `300 ${fontDesc}px Roboto`
          const descrizioneCanvas = (linguaRef.current === "en" && popupCanvas.dati.descrizione_en) ? popupCanvas.dati.descrizione_en : (popupCanvas.dati.descrizione || "")
          const words = descrizioneCanvas.split(" ")
          const descLines = []
          let line = ""
          for (const word of words) {
            const test = line ? line + " " + word : word
            if (ctx.measureText(test).width > cardW - pad * 2 && line) { descLines.push(line); line = word }
            else line = test
          }
          if (line) descLines.push(line)
          const cardH = pad + 13 + 4 + 9 + 6 + descLines.length * lineHDesc + pad
          let boxX = Math.max(10, Math.min(w - cardW - 10, anchor.x - cardW / 2))
          let boxY = anchor.y - cardH - 10
          if (boxY < 50) boxY = anchor.y + 10
          ctx.shadowColor = "rgba(0,0,0,0.12)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3
          ctx.fillStyle = "white"
          ctx.beginPath()
          const cr = 10
          ctx.moveTo(boxX + cr, boxY); ctx.lineTo(boxX + cardW - cr, boxY)
          ctx.quadraticCurveTo(boxX + cardW, boxY, boxX + cardW, boxY + cr)
          ctx.lineTo(boxX + cardW, boxY + cardH - cr)
          ctx.quadraticCurveTo(boxX + cardW, boxY + cardH, boxX + cardW - cr, boxY + cardH)
          ctx.lineTo(boxX + cr, boxY + cardH)
          ctx.quadraticCurveTo(boxX, boxY + cardH, boxX, boxY + cardH - cr)
          ctx.lineTo(boxX, boxY + cr)
          ctx.quadraticCurveTo(boxX, boxY, boxX + cr, boxY)
          ctx.closePath(); ctx.fill()
          ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
          let ty = boxY + pad + 11
          ctx.font = "italic 500 11px 'Roboto Serif'"; ctx.fillStyle = "#1a1a1a"; ctx.textAlign = "left"
          ctx.fillText(`${popupCanvas.dati.designer_a} — ${popupCanvas.dati.designer_b}`, boxX + pad, ty)
          ty += 4 + 9
          ctx.font = "600 8px Roboto"; ctx.fillStyle = "#aaa"
          const tipoCanvas = linguaRef.current === "en" ? (TIPO_RELAZIONE_EN[popupCanvas.dati.tipo] || popupCanvas.dati.tipo) : popupCanvas.dati.tipo
          ctx.fillText((tipoCanvas || "").toUpperCase(), boxX + pad, ty)
          ty += 6
          ctx.font = `300 ${fontDesc}px Roboto`; ctx.fillStyle = "#666"
          for (const dl of descLines) { ty += lineHDesc; ctx.fillText(dl, boxX + pad, ty) }
          ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 3, 0, Math.PI * 2)
          ctx.fillStyle = "#888"; ctx.fill()
          ctx.restore()
        }
      }

      ctx.save()
      const tZoomBarra = zoomT()
      const percentualeZoom = Math.round(tZoomBarra * 100)

      const barraLarghezza = 120
      const barraX2 = w - 10
      const barraX1 = barraX2 - barraLarghezza
      const barraY = h - 16

      ctx.strokeStyle = "rgba(0,0,0,0.2)"
      ctx.lineWidth = 2
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.moveTo(barraX1, barraY)
      ctx.lineTo(barraX2, barraY)
      ctx.stroke()

      const marcatoreX = barraX1 + barraLarghezza * tZoomBarra
      ctx.strokeStyle = "rgba(0,0,0,0.6)"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(marcatoreX, barraY - 5)
      ctx.lineTo(marcatoreX, barraY + 5)
      ctx.stroke()

      ctx.font = "600 10px Roboto, sans-serif"
      ctx.fillStyle = "rgba(0,0,0,0.45)"
      ctx.textAlign = "right"
      ctx.textBaseline = "bottom"
      ctx.fillText(`${percentualeZoom}%`, barraX1 - 8, barraY + 4)
      ctx.restore()
    }

    // Il canvas overlay ha una propria animazione. In questo modo il primo frame
    // viene disegnato anche se Sigma ha già completato il suo render iniziale.
    let overlayAnimationFrame = null
    let overlayFramesResidui = 0

    function richiediDisegnoOverlay(frames = 1) {
      overlayFramesResidui = Math.max(overlayFramesResidui, frames)
      if (overlayAnimationFrame !== null) return

      const tick = () => {
        overlayAnimationFrame = null
        disegnaTutto()
        overlayFramesResidui -= 1

        if (overlayFramesResidui > 0) {
          overlayAnimationFrame = requestAnimationFrame(tick)
        }
      }

      overlayAnimationFrame = requestAnimationFrame(tick)
    }

    renderer.on("afterRender", () => {
      richiediDisegnoOverlay(1)
    })

    const camera = renderer.getCamera()
    let clamping = false

    // Pixel-per-unità dipendono solo da ratio + dimensioni contenitore, non da x/y:
    // durante un pan (x/y cambiano, ratio no) restano validi. Cache per evitare
    // di rifare la sonda (più setState + refresh) a ogni evento "updated" durante
    // il drag, che causava lo scatto/rimbalzo mentre l'utente trascinava al bordo.
    let ppuCache = { key: null, ppuX: 0, ppuY: 0 }
    function pixelPerUnita(state, w, h) {
      const key = `${state.ratio}|${w}|${h}`
      if (ppuCache.key === key) return ppuCache
      const rif = renderer.graphToViewport({ x: 0, y: 0 })
      clamping = true
      camera.setState({ x: state.x + 0.01, y: state.y, ratio: state.ratio, angle: state.angle })
      renderer.refresh()
      const rifX = renderer.graphToViewport({ x: 0, y: 0 })
      camera.setState({ x: state.x, y: state.y + 0.01, ratio: state.ratio, angle: state.angle })
      renderer.refresh()
      const rifY = renderer.graphToViewport({ x: 0, y: 0 })
      camera.setState({ x: state.x, y: state.y, ratio: state.ratio, angle: state.angle })
      renderer.refresh()
      clamping = false
      ppuCache = { key, ppuX: (rif.x - rifX.x) / 0.01, ppuY: (rif.y - rifY.y) / 0.01 }
      return ppuCache
    }

    // Clamp preciso in coordinate-grafo: il riquadro visibile non può uscire
    // dall'area dove esistono i pallini di griglia. Ricalcolato dai dati reali
    // a ogni chiamata, quindi resta corretto anche se la griglia cresce
    // (più designer/prodotti => contenutoYMin/Max più ampi).
    function clampCameraAllaGriglia(state) {
      const cRect = container.getBoundingClientRect()
      const w = cRect.width, h = cRect.height
      if (w === 0 || h === 0) return

      renderer.refresh()

      const margineYExtra = 180
      const dataXMin = X_MIN - MARGINE_X, dataXMax = X_MAX + MARGINE_X
      const dataYMin = Math.min(Y_MIN, contenutoYMin) - MARGINE_Y - margineYExtra
      const dataYMax = Math.max(Y_MAX, contenutoYMax) + MARGINE_Y + margineYExtra

      const pTL = renderer.graphToViewport({ x: dataXMin, y: dataYMin })
      const pBR = renderer.graphToViewport({ x: dataXMax, y: dataYMax })
      const bxMin = Math.min(pTL.x, pBR.x), bxMax = Math.max(pTL.x, pBR.x)
      const byMin = Math.min(pTL.y, pBR.y), byMax = Math.max(pTL.y, pBR.y)

      const margineSinistra = isMobile ? 10 : Math.max(20, 240 * uiScale - 180)
      const margineDestra = isMobile ? 10 : 40
      const margineAlto = isMobile
        ? (topBarRef.current ? topBarRef.current.getBoundingClientRect().height + 10 : 100)
        : 170 * uiScale
      const margineBasso = 10

      let shiftX = 0, shiftY = 0
      if (bxMax - bxMin >= w - margineSinistra - margineDestra) {
        if (bxMin > margineSinistra) shiftX = bxMin - margineSinistra
        else if (bxMax < w - margineDestra) shiftX = bxMax - (w - margineDestra)
      } else if (isMobile) {
        const centroDisponibileX = margineSinistra + (w - margineSinistra - margineDestra) / 2
        shiftX = (bxMin + bxMax) / 2 - centroDisponibileX
      } else {
        // Desktop: a zoom ridotto il contenuto entra tutto nella viewport — ancorato in alto a sinistra
        // (subito dopo il margine riservato al menu), non centrato, e non trascinabile oltre quel margine.
        shiftX = bxMin - margineSinistra
      }
      if (byMax - byMin >= h - margineAlto - margineBasso) {
        if (byMin > margineAlto) shiftY = byMin - margineAlto
        else if (byMax < h - margineBasso) shiftY = byMax - (h - margineBasso)
      } else if (isMobile) {
        const centroDisponibileY = margineAlto + (h - margineAlto - margineBasso) / 2
        shiftY = (byMin + byMax) / 2 - centroDisponibileY
      } else {
        shiftY = byMin - margineAlto
      }

      if (Math.abs(shiftX) < 0.5 && Math.abs(shiftY) < 0.5) return

      const { ppuX, ppuY } = pixelPerUnita(state, w, h)

      const nuovaX = ppuX !== 0 ? state.x + shiftX / ppuX : state.x
      const nuovaY = ppuY !== 0 ? state.y + shiftY / ppuY : state.y
      clamping = true
      camera.setState({ x: nuovaX, y: nuovaY, ratio: state.ratio, angle: state.angle })
      clamping = false
    }

    camera.on("updated", (state) => {
      cameraRatio = state.ratio
      if (!clamping && isMobile && designerCliccato && cameraPrimaDiClick) {
        // Movimento manuale della mappa durante navigazione collegamenti: non tornare più alla posizione pre-click
        cameraPrimaDiClick = null
      }
      if (!clamping && !prodottoCliccato && !touchGestureAttiva) {
        clampCameraAllaGriglia(state)
      }

      try { localStorage.setItem("dn-camera", JSON.stringify({ x: state.x, y: state.y, ratio: state.ratio })) } catch {}
      richiediDisegnoOverlay(2)
    })

    const resizeObserver = new ResizeObserver(() => {
      ridimensionaOverlay()
      richiediDisegnoOverlay(2)
    })
    resizeObserver.observe(container)

    Object.values(imgCache).forEach((img) => {
      if (!img.complete) {
        img.addEventListener("load", () => richiediDisegnoOverlay(2), { once: true })
        img.addEventListener("error", () => richiediDisegnoOverlay(1), { once: true })
      }
    })

    // Primo render: ora l'overlay esiste già e l'evento afterRender è collegato.
    renderer.refresh()

    let cameraImpostata = false
    try {
      const saved = JSON.parse(localStorage.getItem("dn-camera"))
      if (saved) { camera.setState({ x: saved.x, y: saved.y, ratio: saved.ratio }); cameraImpostata = true }
    } catch {}

    if (!cameraImpostata) {
      const bboxX = [X_MIN - MARGINE_X, X_MAX + MARGINE_X]
      const bboxY = [Math.min(Y_MIN, contenutoYMin) - MARGINE_Y, Math.max(Y_MAX, contenutoYMax) + MARGINE_Y]
      if (graph.hasNode("Achille Castiglioni")) {
        const cAttr = graph.getNodeAttributes("Achille Castiglioni")
        const cx = (cAttr.x - bboxX[0]) / (bboxX[1] - bboxX[0])
        const cy = (cAttr.y - bboxY[0]) / (bboxY[1] - bboxY[0])
        camera.setState({ ratio: 0.25, x: cx + 0.05, y: cy })
      }
    }
    graph.forEachNode((node, attr) => {
      if (!animated[node]) return
      const nodoAttivo = null
      animated[node].r = calcolaRTarget(node, attr, nodoAttivo)
    })
    richiediDisegnoOverlay(2)

    let vistaInterna = "designer"
    let transizioneAttiva = false
    let amoebaAlphaAnimata = 1

    function raccogliProdotti() {
      const lista = []
      graph.forEachNode((node, attr) => {
        if (attr.tipo === "prodotto") lista.push(node)
      })
      lista.sort((a, b) => {
        const pa = graph.getNodeAttribute(a, "dati")
        const pb = graph.getNodeAttribute(b, "dati")
        return (pa.anno || 0) - (pb.anno || 0)
      })
      return lista
    }

    function animaTransizione(vista) {
      if (transizioneAttiva || vista === vistaInterna) return
      transizioneAttiva = true
      vistaInterna = vista
      annoBloccato = null
      const prodottiList = raccogliProdotti()
      const staggerMs = STILE.transizione_stagger
      const durata = STILE.transizione_durata

      prodottiList.forEach((node, idx) => {
        const attr = graph.getNodeAttributes(node)
        const daX = attr.x
        const daY = attr.y
        const aX = vista === "timeline" ? attr.timelineX : attr.orbitaX
        const aY = vista === "timeline" ? attr.timelineY : attr.orbitaY
        const ritardo = idx * staggerMs
        const inizio = performance.now() + ritardo

        function step(now) {
          const t = Math.min(1, Math.max(0, (now - inizio) / durata))
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
          graph.setNodeAttribute(node, "x", lerp(daX, aX, ease))
          graph.setNodeAttribute(node, "y", lerp(daY, aY, ease))
          richiediDisegnoOverlay(2)
          if (t < 1) {
            requestAnimationFrame(step)
          } else if (idx === prodottiList.length - 1) {
            transizioneAttiva = false
          }
        }
        requestAnimationFrame(step)
      })
    }

    setAnimaTransizioneFn(() => animaTransizione)
    setRidisegnaFn(() => () => richiediDisegnoOverlay(18))
    setCentraFn(() => (cercaNome, tipo, opzioni) => {
      const apriPannello = !opzioni || opzioni.apriPannello !== false
      const tPercent = opzioni && typeof opzioni.tPercent === "number" ? opzioni.tPercent : (tipo === "designer" ? 0.75 : 0.95)
      const onFine = opzioni && opzioni.onFine
      let nodeId = null
      graph.forEachNode((node, attr) => {
        if (nodeId) return
        if (tipo === "designer" && attr.tipo === "designer" && attr.dati.nome === cercaNome) nodeId = node
        if (tipo === "prodotto" && attr.tipo === "prodotto" && attr.dati.nome === cercaNome) nodeId = node
      })
      if (!nodeId || !graph.hasNode(nodeId)) return
      const attr = graph.getNodeAttributes(nodeId)
      const tRatio = ratioDaT(tPercent)
      const cRect = container.getBoundingClientRect()
      const sState = camera.getState()
      const pannelloW = isMobile ? 0 : 340 * uiScale
      const pannelloSx = isMobile ? 0 : Math.max(20, 240 * uiScale - 180)
      const pannelloH = isMobile ? cRect.height * 0.4 : 0
      let topBarH = 0
      if (isMobile && topBarRef.current) topBarH = topBarRef.current.getBoundingClientRect().height
      const centroX = pannelloSx + (cRect.width - pannelloSx - pannelloW) / 2 - pannelloW * 0.25
      const centroY = topBarH + (cRect.height - topBarH - pannelloH) / 2
      clamping = true
      camera.setState({ x: sState.x, y: sState.y, ratio: tRatio, angle: sState.angle })
      renderer.refresh()
      const p0 = renderer.graphToViewport({ x: attr.x, y: attr.y })
      camera.setState({ x: sState.x + 0.01, y: sState.y, ratio: tRatio, angle: sState.angle })
      renderer.refresh()
      const pX = renderer.graphToViewport({ x: attr.x, y: attr.y })
      camera.setState({ x: sState.x, y: sState.y + 0.01, ratio: tRatio, angle: sState.angle })
      renderer.refresh()
      const pY = renderer.graphToViewport({ x: attr.x, y: attr.y })
      const ppuX = (p0.x - pX.x) / 0.01
      const ppuY = (p0.y - pY.y) / 0.01
      const tX = sState.x + (p0.x - centroX) / ppuX
      const tY = sState.y + (p0.y - centroY) / ppuY
      camera.setState(sState)
      renderer.refresh()
      clamping = false
      animaCamera({ ratio: tRatio, x: tX, y: tY }, 600, onFine)
      if (apriPannello) {
        nodoEvidenziatoRef.current = nodeId
        setNodoEvidenziato(nodeId)
        prodottoHoverAttivo = null
        nodoHoverAttivo = null
        legameEvidenziatoRef.current = null; setLegameEvidenziato(null)
        if (tipo === "designer") {
          prodottoCliccato = null
          designerCliccato = nodeId
          setDesignerAttivo(nodeId)
          setPannelloDesigner({ ...attr.dati, _tipo: "designer" }); setAziendaAttiva(null)
          requestAnimationFrame(() => setPannelloVisibile(true))
          graph.forEachEdge((edge, eAttr) => { if (eAttr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
          graph.forEachEdge(nodeId, (edge, eAttr) => { if (eAttr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", true) })
          precaricaImmaginiLegami(nodeId)
        } else {
          designerCliccato = null
          graph.forEachEdge((edge, eAttr) => { if (eAttr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
          prodottoCliccato = nodeId
          ultimoProdottoHover = nodeId
          setPannelloDesigner({ ...attr.dati, _tipo: "prodotto" })
          setGalleriaIndice(0); setGalleriaFullscreen(false)
          requestAnimationFrame(() => setPannelloVisibile(true))
        }
      }
      richiediDisegnoOverlay(18)
    })

    // Inquadra due designer collegati mantenendo il pannello attuale aperto:
    // calcola il ratio minimo che li fa stare entrambi a schermo (con un
    // margine), poi centra la camera sul loro punto medio ed evidenzia sia i
    // due nodi che il collegamento specifico (tutto il resto si affievolisce).
    setEvidenziaLegameFn(() => (nomeA, nomeB) => {
      const giaEvidenziato = legameEvidenziatoRef.current
        && legameEvidenziatoRef.current.a === nomeA && legameEvidenziatoRef.current.b === nomeB
      if (giaEvidenziato) {
        legameEvidenziatoRef.current = null
        setLegameEvidenziato(null)
        graph.forEachEdge((edge, eAttr) => { if (eAttr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
        graph.forEachEdge(nomeA, (edge, eAttr) => { if (eAttr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", true) })
        if (cameraPrimaLegame) { animaCamera(cameraPrimaLegame, 600); cameraPrimaLegame = null }
        richiediDisegnoOverlay(30)
        return
      }
      if (!graph.hasNode(nomeA) || !graph.hasNode(nomeB)) return
      if (!legameEvidenziatoRef.current) cameraPrimaLegame = camera.getState()
      const attrA = graph.getNodeAttributes(nomeA)
      const attrB = graph.getNodeAttributes(nomeB)
      const sState = camera.getState()
      let tRatio = sState.ratio, tX = sState.x, tY = sState.y
      try {
        const cRect = container.getBoundingClientRect()
        if (cRect.width < 1 || cRect.height < 1) throw new Error("container non ancora misurabile")
        const pannelloW = isMobile ? 0 : 340 * uiScale
        const pannelloSx = isMobile ? 0 : Math.max(20, 240 * uiScale - 180)
        const pannelloH = isMobile ? cRect.height * 0.4 : 0
        let topBarH = 0
        if (isMobile && topBarRef.current) topBarH = topBarRef.current.getBoundingClientRect().height
        const areaW = Math.max(80, cRect.width - pannelloSx - pannelloW)
        const areaH = Math.max(80, cRect.height - topBarH - pannelloH)
        const centroX = pannelloSx + areaW / 2 - pannelloW * 0.25
        const centroY = topBarH + areaH / 2

        const { ppuX: ppuXRif, ppuY: ppuYRif } = pixelPerUnita(sState, cRect.width, cRect.height)
        const dxGraph = Math.abs(attrA.x - attrB.x)
        const dyGraph = Math.abs(attrA.y - attrB.y)
        const MARGINE_FIT = 0.85
        const ratioServeX = dxGraph > 0 ? (MARGINE_FIT * dxGraph * Math.abs(ppuXRif) * sState.ratio) / areaW : 0
        const ratioServeY = dyGraph > 0 ? (MARGINE_FIT * dyGraph * Math.abs(ppuYRif) * sState.ratio) / areaH : 0
        let ratioCalcolato = Math.max(ratioServeX, ratioServeY, MIN_CAMERA_RATIO)
        ratioCalcolato = Math.min(ratioCalcolato, MAX_CAMERA_RATIO)

        const midX = (attrA.x + attrB.x) / 2
        const midY = (attrA.y + attrB.y) / 2
        clamping = true
        camera.setState({ x: sState.x, y: sState.y, ratio: ratioCalcolato, angle: sState.angle })
        renderer.refresh()
        const p0 = renderer.graphToViewport({ x: midX, y: midY })
        camera.setState({ x: sState.x + 0.01, y: sState.y, ratio: ratioCalcolato, angle: sState.angle })
        renderer.refresh()
        const pX = renderer.graphToViewport({ x: midX, y: midY })
        camera.setState({ x: sState.x, y: sState.y + 0.01, ratio: ratioCalcolato, angle: sState.angle })
        renderer.refresh()
        const pY = renderer.graphToViewport({ x: midX, y: midY })
        const ppuX = (p0.x - pX.x) / 0.01
        const ppuY = (p0.y - pY.y) / 0.01
        const xCalcolato = sState.x + (p0.x - centroX) / ppuX
        const yCalcolato = sState.y + (p0.y - centroY) / ppuY
        camera.setState(sState)
        renderer.refresh()
        if (Number.isFinite(ratioCalcolato) && Number.isFinite(xCalcolato) && Number.isFinite(yCalcolato)) {
          tRatio = ratioCalcolato; tX = xCalcolato; tY = yCalcolato
        }
      } catch {
        // Se il contenitore non è misurabile in questo istante (capita su mobile
        // appena dopo l'apertura del pannello), evidenziamo comunque il legame
        // senza spostare la camera, invece di propagare l'errore.
      } finally {
        clamping = false
      }

      legameEvidenziatoRef.current = { a: nomeA, b: nomeB }
      setLegameEvidenziato({ a: nomeA, b: nomeB })
      graph.forEachEdge((edge, eAttr) => { if (eAttr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
      graph.forEachEdge(nomeA, (edge, eAttr, source, target) => {
        if (eAttr.tipo === "relazione" && (source === nomeB || target === nomeB)) graph.setEdgeAttribute(edge, "attivo", true)
      })
      animaCamera({ ratio: tRatio, x: tX, y: tY }, 600)
      richiediDisegnoOverlay(30)
    })

    // Deseleziona tutto (prodotto, designer, collegamento evidenziato, filtro
    // azienda, popup) e torna alla vista/camera di prima — usata sia dal click
    // su area vuota che dal tasto Esc.
    function deselezionaTutto() {
      if (cameraPrimaDiClick && prodottoCliccato) {
        animaCamera(cameraPrimaDiClick, 500)
        cameraPrimaDiClick = null
      }
      prodottoHoverAttivo = null; nodoHoverAttivo = null
      designerCliccato = null; prodottoCliccato = null
      annoBloccato = null
      nodoEvidenziatoRef.current = null; setNodoEvidenziato(null)
      legameEvidenziatoRef.current = null; setLegameEvidenziato(null)
      cameraPrimaLegame = null
      primoClickFuoriDesigner = false
      setDesignerAttivo(null)
      setPannelloVisibile(false)
      setTimeout(() => setPannelloDesigner(null), 350)
      aziendaAttivaRef.current = null; setAziendaAttiva(null); aziendaGlobaleRef.current = false
      graph.forEachEdge((edge, attr) => { if (attr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
      setPopup(null); setTooltipRelazione(null)
      correnteCliccata = null; correnteHoverAttivo = null; setTooltipCorrente(null)
      richiediDisegnoOverlay(18)
    }

    // Bottone "home": deseleziona tutto e riporta la camera allo zoom minimo
    // (0%), centrata in orizzontale ma con la parte più in alto del contenuto
    // (i designer più anziani) vicino alla cima dello schermo, invece che il
    // centro verticale di tutta la timeline — utile per ritrovarsi se ci si è
    // persi navigando la mappa.
    setResetVistaFn(() => () => {
      deselezionaTutto()
      const cRect = container.getBoundingClientRect()
      const sState = camera.getState()
      const tRatio = MAX_CAMERA_RATIO
      const midX = (X_MIN + X_MAX) / 2
      const topY = bboxYMax
      let topBarH = 0
      if (isMobile && topBarRef.current) topBarH = topBarRef.current.getBoundingClientRect().height
      const centroX = cRect.width / 2
      const centroY = (isMobile ? topBarH : 170 * uiScale) + 40
      clamping = true
      camera.setState({ x: sState.x, y: sState.y, ratio: tRatio, angle: sState.angle })
      renderer.refresh()
      const p0 = renderer.graphToViewport({ x: midX, y: topY })
      camera.setState({ x: sState.x + 0.01, y: sState.y, ratio: tRatio, angle: sState.angle })
      renderer.refresh()
      const pX = renderer.graphToViewport({ x: midX, y: topY })
      camera.setState({ x: sState.x, y: sState.y + 0.01, ratio: tRatio, angle: sState.angle })
      renderer.refresh()
      const pY = renderer.graphToViewport({ x: midX, y: topY })
      const ppuX = (p0.x - pX.x) / 0.01
      const ppuY = (p0.y - pY.y) / 0.01
      const tX = sState.x + (p0.x - centroX) / ppuX
      const tY = sState.y + (p0.y - centroY) / ppuY
      camera.setState(sState)
      renderer.refresh()
      clamping = false
      animaCamera({ ratio: tRatio, x: tX, y: tY }, 600)
    })

    function handleEscGlobale(e) {
      if (e.key !== "Escape") return
      const qualcosaSelezionato = designerCliccato || prodottoCliccato || nodoEvidenziatoRef.current
        || legameEvidenziatoRef.current || aziendaAttivaRef.current || popupCanvas || correnteCliccata
      if (!qualcosaSelezionato) return
      popupCanvas = null
      deselezionaTutto()
    }
    window.addEventListener("keydown", handleEscGlobale)

    const sigmaCanvas = container
    if (sigmaCanvas) {
      sigmaCanvas.addEventListener("mouseenter", () => { mouseNelCanvas = true })
      sigmaCanvas.addEventListener("mouseleave", () => {
        // Senza questo reset, lo stato di hover (ameba, nodo, prodotto) restava "incollato"
        // all'ultimo elemento sotto al cursore anche dopo che il mouse usciva del tutto
        // dal canvas, perché nessun altro mousemove arrivava più ad aggiornarlo.
        mouseNelCanvas = false
        if (nodoHoverAttivo) {
          graph.forEachEdge((edge, attr) => { if (attr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
          nodoHoverAttivo = null
        }
        prodottoHoverAttivo = null
        correnteHoverAttivo = null
        setTooltipCorrente(null)
        setTooltipRelazione(null)
        richiediDisegnoOverlay(18)
      })

      sigmaCanvas.addEventListener("mousedown", (e) => {
        mouseDownPos = { x: e.clientX, y: e.clientY }
        isDragging = false
      })

      sigmaCanvas.addEventListener("mousemove", (e) => {
        if (mouseDownPos) {
          const dx = Math.abs(e.clientX - mouseDownPos.x)
          const dy = Math.abs(e.clientY - mouseDownPos.y)
          if (dx > 4 || dy > 4) isDragging = true
        }

        const rect = sigmaCanvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        mouseX = mx; mouseY = my
        if (!mouseNelCanvas) { mouseTrailX = mx; mouseTrailY = my; mouseNelCanvas = true }
        richiediDisegnoOverlay(18)

        if (!prodottoCliccato) {
          let prodottoHover = null
          if (zoomT() > STILE.zoom_label_soglia - 0.1 || vistaInterna === "timeline") {
            graph.forEachNode((node, attr) => {
              if (attr.tipo !== "prodotto") return
              const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
              const r = animated[node]?.r ?? STILE.zoom_prodotto_min
              if (Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2) < r) prodottoHover = node
            })
            if (prodottoHover !== prodottoHoverAttivo) { prodottoHoverAttivo = prodottoHover; if (prodottoHover) ultimoProdottoHover = prodottoHover; richiediDisegnoOverlay(18) }
          } else if (prodottoHoverAttivo !== null) { prodottoHoverAttivo = null; richiediDisegnoOverlay(18) }

          if (!designerCliccato) {
            let nodoHover = null
            if (!prodottoHoverAttivo) {
              graph.forEachNode((node, attr) => {
                if (attr.tipo !== "designer") return
                const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
                const r = animated[node]?.r ?? STILE.zoom_designer_min
                if (Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2) < r) nodoHover = node
              })
            }
            if (nodoHover !== nodoHoverAttivo) {
              nodoHoverAttivo = nodoHover
              graph.forEachEdge((edge, attr) => { if (attr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
              if (nodoHover) {
                graph.forEachEdge(nodoHover, (edge, edgeAttr) => {
                  if (edgeAttr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", true)
                })
              }
              richiediDisegnoOverlay(18)
            }
          }
        }

        if (designerCliccato) {
          let relazioneHover = null
          graph.forEachEdge(designerCliccato, (edge, attr, source, target) => {
            if (attr.tipo !== "relazione" || !attr.attivo) return
            const posS = renderer.graphToViewport({ x: graph.getNodeAttribute(source, "x"), y: graph.getNodeAttribute(source, "y") })
            const posT = renderer.graphToViewport({ x: graph.getNodeAttribute(target, "x"), y: graph.getNodeAttribute(target, "y") })
            const dx = posT.x - posS.x, dy = posT.y - posS.y
            const len2 = dx * dx + dy * dy
            if (len2 === 0) return
            const t = Math.max(0, Math.min(1, ((mx - posS.x) * dx + (my - posS.y) * dy) / len2))
            const px = posS.x + t * dx - mx, py = posS.y + t * dy - my
            if (Math.sqrt(px * px + py * py) < 10) {
              const d = attr.dati
              const dOrd = designerCliccato === d.designer_b ? { ...d, designer_a: d.designer_b, designer_b: d.designer_a } : d
              relazioneHover = { dati: dOrd, x: e.clientX, y: e.clientY }
            }
          })
          setTooltipRelazione(relazioneHover)
        } else {
          setTooltipRelazione(null)
        }

        // Ameba correnti: solo se non stiamo già interagendo con nodo/prodotto/designer
        // sopra di esse (sono sfondo, non devono mai rubare hit) e mai su mobile (niente hover reale).
        if (!isMobile && !designerCliccato && !prodottoCliccato && !nodoHoverAttivo && !prodottoHoverAttivo) {
          const trovata = correntiHit.find((h) => {
            if (h.poligono) return puntoInPoligono(h.poligono, mx, my)
            if (h.cerchio) { const dx = mx - h.cerchio.x, dy = my - h.cerchio.y; return dx * dx + dy * dy < h.cerchio.r * h.cerchio.r }
            return false
          })
          const nuovaHover = trovata ? trovata.dati : null
          if (nuovaHover !== correnteHoverAttivo) {
            correnteHoverAttivo = nuovaHover
            richiediDisegnoOverlay(18)
          }
          setTooltipCorrente(nuovaHover ? { dati: nuovaHover.dati, x: e.clientX, y: e.clientY } : null)
        } else if (correnteHoverAttivo) {
          correnteHoverAttivo = null
          setTooltipCorrente(null)
          richiediDisegnoOverlay(18)
        }
      })

      sigmaCanvas.addEventListener("mouseup", (e) => {
        if (isDragging) { mouseDownPos = null; isDragging = false; richiediDisegnoOverlay(3); return }
        mouseDownPos = null; isDragging = false
        popupCanvas = null

        const rect = sigmaCanvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top

        let relazioneCliccata = null
        if (designerCliccato) {
          graph.forEachEdge(designerCliccato, (edge, attr, source, target) => {
            if (attr.tipo !== "relazione") return
            const posS = renderer.graphToViewport({ x: graph.getNodeAttribute(source, "x"), y: graph.getNodeAttribute(source, "y") })
            const posT = renderer.graphToViewport({ x: graph.getNodeAttribute(target, "x"), y: graph.getNodeAttribute(target, "y") })
            const dx = posT.x - posS.x, dy = posT.y - posS.y
            const len2 = dx * dx + dy * dy
            if (len2 === 0) return
            const t = Math.max(0, Math.min(1, ((mx - posS.x) * dx + (my - posS.y) * dy) / len2))
            const px = posS.x + t * dx - mx, py = posS.y + t * dy - my
            if (Math.sqrt(px * px + py * py) < (isMobile ? 18 : 8)) {
              const d = attr.dati
              relazioneCliccata = designerCliccato === d.designer_b ? { ...d, designer_a: d.designer_b, designer_b: d.designer_a } : d
            }
          })
        }
        if (relazioneCliccata) {
          if (isMobile) {
            const cg = renderer.viewportToGraph({ x: mx, y: my })
            popupCanvas = { dati: relazioneCliccata, gx: cg.x, gy: cg.y }
            setPopup({ tipo: "relazione", dati: relazioneCliccata })
            richiediDisegnoOverlay(3)
          } else {
            setPopup({ tipo: "relazione", dati: relazioneCliccata, x: e.clientX, y: e.clientY })
          }
          return
        }

        let trovato = null
        graph.forEachNode((node, attr) => {
          const pos = renderer.graphToViewport({ x: attr.x, y: attr.y })
          const r = animated[node]?.r ?? (attr.tipo === "designer" ? STILE.zoom_designer_min : STILE.zoom_prodotto_min)
          if (Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2) < r) trovato = { node, attr }
        })

        if (trovato) {
          prodottoHoverAttivo = null
          nodoHoverAttivo = null
          legameEvidenziatoRef.current = null; setLegameEvidenziato(null)
          if (trovato.attr.tipo === "designer") {
            prodottoCliccato = null
            if (designerCliccato === trovato.node) {
              if (nodoEvidenziatoRef.current === trovato.node) {
                // State 3 → re-apri pannello
                primoClickFuoriDesigner = false
                nodoEvidenziatoRef.current = null; setNodoEvidenziato(null)
                setDesignerAttivo(trovato.node)
                requestAnimationFrame(() => setPannelloVisibile(true))
              } else {
                // State 2 → chiudi pannello
                primoClickFuoriDesigner = false
                designerCliccato = null
                setDesignerAttivo(null)
                setPannelloVisibile(false)
                setTimeout(() => setPannelloDesigner(null), 350)
                graph.forEachEdge((edge, attr) => { if (attr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
                if (cameraPrimaDiClick) { animaCamera(cameraPrimaDiClick, 500); cameraPrimaDiClick = null }
              }
            } else {
              primoClickFuoriDesigner = false
              const pannelloEraApertoPrima = designerCliccato !== null || prodottoCliccato !== null
              designerCliccato = trovato.node
              setDesignerAttivo(trovato.node)
              nodoEvidenziatoRef.current = null; setNodoEvidenziato(null)
              aziendaAttivaRef.current = null; aziendaGlobaleRef.current = false
              setPannelloDesigner({ ...trovato.attr.dati, _tipo: "designer" }); setAziendaAttiva(null)
              requestAnimationFrame(() => setPannelloVisibile(true))
              graph.forEachEdge((edge, attr) => { if (attr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
              graph.forEachEdge(trovato.node, (edge, edgeAttr) => { if (edgeAttr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", true) })
              precaricaImmaginiLegami(trovato.node)
              cameraPrimaDiClick = camera.getState()
              {
                const pAttr = graph.getNodeAttributes(trovato.node)
                const cRect = container.getBoundingClientRect()
                const sState = camera.getState()
                const tRatio = ratioDaT(0.75)
                const pannelloW = isMobile ? 0 : 340 * uiScale
                const pannelloSx = isMobile ? 0 : Math.max(20, 240 * uiScale - 180)
                const pannelloH = isMobile ? cRect.height * 0.4 : 0
                let topBarH = 0
                if (isMobile && topBarRef.current) {
                  topBarH = topBarRef.current.getBoundingClientRect().height
                  if (!pannelloEraApertoPrima && sottotitoloRef.current) {
                    topBarH -= sottotitoloRef.current.getBoundingClientRect().height
                  }
                }
                const centroX = pannelloSx + (cRect.width - pannelloSx - pannelloW) / 2 - pannelloW * 0.25
                const centroY = topBarH + (cRect.height - topBarH - pannelloH) / 2
                clamping = true
                camera.setState({ x: sState.x, y: sState.y, ratio: tRatio, angle: sState.angle })
                renderer.refresh()
                const p0 = renderer.graphToViewport({ x: pAttr.x, y: pAttr.y })
                camera.setState({ x: sState.x + 0.01, y: sState.y, ratio: tRatio, angle: sState.angle })
                renderer.refresh()
                const pX = renderer.graphToViewport({ x: pAttr.x, y: pAttr.y })
                camera.setState({ x: sState.x, y: sState.y + 0.01, ratio: tRatio, angle: sState.angle })
                renderer.refresh()
                const pY = renderer.graphToViewport({ x: pAttr.x, y: pAttr.y })
                const ppuX = (p0.x - pX.x) / 0.01
                const ppuY = (p0.y - pY.y) / 0.01
                const tX = sState.x + (p0.x - centroX) / ppuX
                const tY = sState.y + (p0.y - centroY) / ppuY
                camera.setState(sState)
                renderer.refresh()
                clamping = false
                animaCamera({ ratio: tRatio, x: tX, y: tY }, 500)
              }
            }
            richiediDisegnoOverlay(18)
          } else {
            if (vistaInterna === "timeline" && trovato.attr.dati && trovato.attr.dati.anno) {
              const anno = trovato.attr.dati.anno
              annoBloccato = annoBloccato === anno ? null : anno
            }
            const pannelloEraApertoPrima = designerCliccato !== null || prodottoCliccato !== null
            designerCliccato = null
            graph.forEachEdge((edge, eAttr) => { if (eAttr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
            prodottoCliccato = trovato.node
            ultimoProdottoHover = trovato.node
            nodoEvidenziatoRef.current = null; setNodoEvidenziato(null)
            aziendaAttivaRef.current = null; setAziendaAttiva(null); aziendaGlobaleRef.current = false
            setPannelloDesigner({ ...trovato.attr.dati, _tipo: "prodotto" })
            setGalleriaIndice(0); setGalleriaFullscreen(false)
            requestAnimationFrame(() => setPannelloVisibile(true))
            cameraPrimaDiClick = camera.getState()
            {
              const pAttr = graph.getNodeAttributes(trovato.node)
              const cRect = container.getBoundingClientRect()
              const sState = camera.getState()
              const tRatio = ratioDaT(0.95)
              const pannelloW = isMobile ? 0 : 340 * uiScale
              const pannelloSx = isMobile ? 0 : Math.max(20, 240 * uiScale - 180)
              const pannelloH = isMobile ? cRect.height * 0.4 : 0
              let topBarH = 0
              if (isMobile && topBarRef.current) {
                topBarH = topBarRef.current.getBoundingClientRect().height
                if (!pannelloEraApertoPrima && sottotitoloRef.current) {
                  topBarH -= sottotitoloRef.current.getBoundingClientRect().height
                }
              }
              const centroX = pannelloSx + (cRect.width - pannelloSx - pannelloW) / 2 - pannelloW * 0.25
              const centroY = topBarH + (cRect.height - topBarH - pannelloH) / 2
              clamping = true
              camera.setState({ x: sState.x, y: sState.y, ratio: tRatio, angle: sState.angle })
              renderer.refresh()
              const p0 = renderer.graphToViewport({ x: pAttr.x, y: pAttr.y })
              camera.setState({ x: sState.x + 0.01, y: sState.y, ratio: tRatio, angle: sState.angle })
              renderer.refresh()
              const pX = renderer.graphToViewport({ x: pAttr.x, y: pAttr.y })
              camera.setState({ x: sState.x, y: sState.y + 0.01, ratio: tRatio, angle: sState.angle })
              renderer.refresh()
              const pY = renderer.graphToViewport({ x: pAttr.x, y: pAttr.y })
              const ppuX = (p0.x - pX.x) / 0.01
              const ppuY = (p0.y - pY.y) / 0.01
              const tX = sState.x + (p0.x - centroX) / ppuX
              const tY = sState.y + (p0.y - centroY) / ppuY
              camera.setState(sState)
              renderer.refresh()
              clamping = false
              animaCamera({ ratio: tRatio, x: tX, y: tY }, 500)
            }
            richiediDisegnoOverlay(18)
          }
        } else {
          const trovataCorrente = correntiHit.find((h) => {
            if (h.poligono) return puntoInPoligono(h.poligono, mx, my)
            if (h.cerchio) { const dx = mx - h.cerchio.x, dy = my - h.cerchio.y; return dx * dx + dy * dy < h.cerchio.r * h.cerchio.r }
            return false
          })
          if (trovataCorrente) {
            const nomeCorrente = trovataCorrente.dati.nomeCorrente
            if (correnteCliccata === nomeCorrente) {
              correnteCliccata = null
              setPannelloVisibile(false)
              setTimeout(() => setPannelloDesigner(null), 350)
            } else {
              correnteCliccata = nomeCorrente
              designerCliccato = null; prodottoCliccato = null
              nodoEvidenziatoRef.current = null; setNodoEvidenziato(null)
              legameEvidenziatoRef.current = null; setLegameEvidenziato(null)
              aziendaAttivaRef.current = null; setAziendaAttiva(null); aziendaGlobaleRef.current = false
              setDesignerAttivo(null)
              graph.forEachEdge((edge, attr) => { if (attr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
              const esponenti = designers
                .filter((d) => [...(d.scuole || []), ...(d.collettivi || [])].includes(nomeCorrente))
                .map((d) => d.nome)
              setPannelloDesigner({ ...trovataCorrente.dati.dati, esponenti, _tipo: "corrente" })
              requestAnimationFrame(() => setPannelloVisibile(true))
            }
            correnteHoverAttivo = null; setTooltipCorrente(null)
            richiediDisegnoOverlay(18)
            return
          }

          const avevaPannello = (designerCliccato !== null || prodottoCliccato !== null) && !primoClickFuoriDesigner
          if (isMobile && avevaPannello) {
            // State 2 → State 3: chiudi pannello, mantieni designer isolato con edges visibili
            const nodoDaEvidenziare = prodottoCliccato || designerCliccato
            primoClickFuoriDesigner = true
            setPannelloVisibile(false)
            setDesignerAttivo(null)
            legameEvidenziatoRef.current = null; setLegameEvidenziato(null)
            if (nodoDaEvidenziare) {
              nodoEvidenziatoRef.current = nodoDaEvidenziare
              setNodoEvidenziato(nodoDaEvidenziare)
              ultimoProdottoHover = prodottoCliccato || ultimoProdottoHover
            }
            prodottoCliccato = null
            richiediDisegnoOverlay(18)
            return
          }
          if (isMobile && primoClickFuoriDesigner) {
            // State 3 → State 1: deseleziona tutto
            primoClickFuoriDesigner = false
            designerCliccato = null
            nodoEvidenziatoRef.current = null; setNodoEvidenziato(null)
            legameEvidenziatoRef.current = null; setLegameEvidenziato(null)
            aziendaAttivaRef.current = null; setAziendaAttiva(null); aziendaGlobaleRef.current = false
            annoBloccato = null
            setPannelloDesigner(null)
            graph.forEachEdge((edge, attr) => { if (attr.tipo === "relazione") graph.setEdgeAttribute(edge, "attivo", false) })
            setPopup(null)
            if (cameraPrimaDiClick) { animaCamera(cameraPrimaDiClick, 500); cameraPrimaDiClick = null }
            richiediDisegnoOverlay(18)
            return
          }
          if (isMobile && nodoEvidenziatoRef.current) {
            ultimoProdottoHover = null
            nodoEvidenziatoRef.current = null; setNodoEvidenziato(null)
            aziendaAttivaRef.current = null; setAziendaAttiva(null); aziendaGlobaleRef.current = false
            annoBloccato = null
            if (cameraPrimaDiClick) { animaCamera(cameraPrimaDiClick, 500); cameraPrimaDiClick = null }
            richiediDisegnoOverlay(18)
            return
          }
          if (isMobile && aziendaAttivaRef.current) {
            aziendaAttivaRef.current = null; setAziendaAttiva(null); aziendaGlobaleRef.current = false
            richiediDisegnoOverlay(18)
            return
          }
          deselezionaTutto()
        }
      })

      let touchStartPos = null
      let touchIsDragging = false
      sigmaCanvas.addEventListener("touchstart", (e) => {
        touchGestureAttiva = true
        if (e.touches.length === 1) {
          touchWasMultiTouch = false
          const t = e.touches[0]
          touchStartPos = { x: t.clientX, y: t.clientY }
          touchIsDragging = false
        } else {
          touchWasMultiTouch = true
        }
      }, { passive: true })
      sigmaCanvas.addEventListener("touchmove", (e) => {
        if (touchStartPos && e.touches[0]) {
          const dx = Math.abs(e.touches[0].clientX - touchStartPos.x)
          const dy = Math.abs(e.touches[0].clientY - touchStartPos.y)
          if (dx > 8 || dy > 8) touchIsDragging = true
        }
      }, { passive: true })
      const fineGestoTouch = (e) => {
        if (e.touches.length === 0 && touchGestureAttiva) {
          touchGestureAttiva = false
          clampCameraAllaGriglia(camera.getState())
        }
      }
      sigmaCanvas.addEventListener("touchend", (e) => {
        fineGestoTouch(e)
        if (touchIsDragging || !touchStartPos || touchWasMultiTouch || e.touches.length !== 0) {
          touchStartPos = null; touchIsDragging = false; return
        }
        const fakeEvent = { clientX: touchStartPos.x, clientY: touchStartPos.y }
        touchStartPos = null; touchIsDragging = false
        sigmaCanvas.dispatchEvent(new MouseEvent("mouseup", {
          clientX: fakeEvent.clientX, clientY: fakeEvent.clientY,
          bubbles: true
        }))
      })
      sigmaCanvas.addEventListener("touchcancel", (e) => {
        fineGestoTouch(e)
        touchStartPos = null; touchIsDragging = false
      })
    }

    return () => {
      window.removeEventListener("keydown", handleEscGlobale)
      resizeObserver.disconnect()
      clearTimeout(timeoutPronte)
      if (overlayAnimationFrame !== null) cancelAnimationFrame(overlayAnimationFrame)
      if (cameraAnimId) cancelAnimationFrame(cameraAnimId)
      renderer.kill()
      if (container.parentNode) container.parentNode.removeChild(container)
      document.body.style.overflow = ""
      document.documentElement.style.overflow = ""
    }
  }, [])

  useEffect(() => {
    if (window.innerWidth >= 768) return
    if (!pannelloVisibile) {
      const bg = STILE.sfondo_colore
      document.documentElement.style.backgroundColor = bg
      document.body.style.backgroundColor = bg
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', bg)
    }
  }, [pannelloVisibile])

  function toggleAzienda(az) {
    const nuova = aziendaAttiva === az ? null : az
    setAziendaAttiva(nuova)
    aziendaAttivaRef.current = nuova
    aziendaGlobaleRef.current = !!(nuova && pannelloDesigner && pannelloDesigner._tipo === "prodotto")
    if (ridisegnaFn) ridisegnaFn()
  }

  function cambiaVista(vista) {
    if (vista === vistaCorrente) return
    setVistaCorrente(vista)
    if (animaTransizioneFn) animaTransizioneFn(vista)
  }

  function chiudiMenu() {
    setMenuApertoMobile(false)
    setMenuApertoDesktop(false)
    setMenuVista("lista")
  }

  function riapriSchermataIniziale() {
    chiudiMenu()
    setRispostaDesigner("")
    setSchermataIniziale(true)
  }

  function inviaContribuzione() {
    setContribStato("invio")
    fetch(FORMSPREE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        categoria: contribCategoria,
        tag: contribTag ? `${contribTag.nome} (${contribTag.tipo})` : "",
        descrizione: contribDescrizione,
        email: contribEmail,
      }),
    })
      .then((res) => {
        if (res.ok) {
          setContribStato("ok")
          setContribCategoria("Correzione"); setContribTag(null); setContribRicerca("")
          setContribDescrizione(""); setContribEmail("")
        } else {
          setContribStato("errore")
        }
      })
      .catch(() => setContribStato("errore"))
  }

  function renderMenuHeader() {
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontFamily: "Roboto, sans-serif", fontSize: 10, fontWeight: 600, color: "#aaa", letterSpacing: 1.5, textTransform: "uppercase" }}>
            {t.sezione}
          </div>
          <div style={{ display: "flex", gap: 2, background: "#ececec", borderRadius: 12, padding: 2 }}>
            {["it", "en"].map((l) => (
              <button key={l} onClick={() => setLingua(l)}
                style={{ padding: "2px 8px", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 9, fontWeight: lingua === l ? 600 : 300, fontFamily: "'Roboto Mono', monospace", color: lingua === l ? "#ffffff" : "#888", background: lingua === l ? "#1a1a1a" : "transparent", transition: "all 0.2s" }}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 18, marginLeft: -7 }}>
          <span style={{
            display: "inline-block", fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 400,
            color: "#ffffff", background: "#FF0707", border: "none", borderRadius: 20, padding: "3px 12px",
          }}>
            Design
          </span>
        </div>
      </>
    )
  }

  function renderMenuFooter() {
    return (
      <div style={{ marginTop: "auto", paddingTop: 24 }}>
        <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 9, color: "#bbb", lineHeight: 1.6 }}>
          © 2026 Design — Encyclopédie Visuelle<br />
          {t.footerRiga1}<br />
          {t.footerRiga2}
        </div>
      </div>
    )
  }

  function renderMenuLista() {
    return (
      <>
        <div style={{ fontFamily: "Roboto, sans-serif", fontSize: 10, fontWeight: 600, color: "#aaa", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>
          {t.menu}
        </div>
        <div onClick={riapriSchermataIniziale}
          style={{ borderBottom: "1px solid #eee", padding: "16px 0", cursor: "pointer" }}>
          <div style={{ fontFamily: "'Roboto Serif', serif", fontStyle: "italic", fontWeight: 400, fontSize: 13, color: "#aaa" }}>
            {t.voci.domanda}
          </div>
        </div>
        {["manifesto", "contatti", "credits", "contribuisci"].map((id) => (
          <div key={id} onClick={() => setMenuVista(id)}
            style={{ borderBottom: "1px solid #eee", padding: "16px 0", cursor: "pointer" }}>
            <div style={{ fontFamily: "'Roboto Mono', monospace", fontWeight: 400, fontSize: 13, color: "#777" }}>
              {t.voci[id]}
            </div>
          </div>
        ))}
      </>
    )
  }

  function renderManifestoBody() {
    return (
      <>
        <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", fontSize: 14, color: "#1a1a1a", marginBottom: 16 }}>
          Design — encyclopédie visuelle 1880–1980
        </div>
        {t.manifestoParagrafi.map((par, i) => (
          <p key={i} style={{ fontFamily: "Roboto, sans-serif", fontWeight: 300, fontSize: 12, color: "#888", lineHeight: 1.6, marginTop: i === 0 ? 0 : 12, marginBottom: 0 }}>
            {par}
          </p>
        ))}
      </>
    )
  }

  function renderContattiBody() {
    // PLACEHOLDER: inserire qui l'indirizzo email di contatto reale — decisione da prendere esplicitamente (privacy), non inventare
    return (
      <div style={{ fontFamily: "Roboto, sans-serif", fontWeight: 300, fontSize: 12, color: "#888", lineHeight: 1.6 }}>
        <div style={{ fontSize: 9, fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>{t.email}</div>
        <div style={{ color: "#ccc", fontStyle: "italic" }}>—</div>
      </div>
    )
  }

  function renderCreditsBody() {
    return (
      <>
        <p style={{ fontFamily: "Roboto, sans-serif", fontWeight: 300, fontSize: 12, color: "#888", lineHeight: 1.6, marginTop: 0 }}>
          {t.creditsIntro}
        </p>
        {SEZIONI_CREDITS.map((sez, i) => (
          <div key={i} style={{ marginBottom: i < SEZIONI_CREDITS.length - 1 ? 22 : 16 }}>
            <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", fontSize: 14, color: "#1a1a1a", marginBottom: 10 }}>
              {t.creditsTitoli[i]}
            </div>
            {sez.nomi.map((nome, j) => (
              <div key={j} style={{ fontFamily: "Roboto, sans-serif", fontWeight: 300, fontSize: 12, color: "#777", lineHeight: 1.9 }}>
                {nome}
              </div>
            ))}
          </div>
        ))}
        <p style={{ fontFamily: "Roboto, sans-serif", fontWeight: 300, fontStyle: "italic", fontSize: 11, color: "#aaa", lineHeight: 1.5 }}>
          {t.creditsChiusura}
        </p>
      </>
    )
  }

  function renderContribuisciBody() {
    const risultatiTag = contribRicerca.length > 1 ? cercaEntita(contribRicerca) : []
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <select value={contribCategoria} onChange={(e) => setContribCategoria(e.target.value)}
          style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, fontWeight: 300, color: "#1a1a1a", padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", background: "white" }}>
          <option>{t.contribCategorie[0]}</option>
          <option>{t.contribCategorie[1]}</option>
          <option>{t.contribCategorie[2]}</option>
        </select>

        <div>
          <label style={{ fontFamily: "Roboto, sans-serif", fontSize: 11, fontWeight: 400, color: "#777", display: "block", marginBottom: 6 }}>
            {t.contribDomanda}
          </label>
          {contribTag ? (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #ddd", borderRadius: 20, padding: "4px 6px 4px 12px" }}>
              <span style={{ fontFamily: "Roboto, sans-serif", fontSize: 12, color: "#1a1a1a" }}>{contribTag.nome}</span>
              <button type="button" onClick={() => setContribTag(null)}
                style={{ border: "none", background: "#eee", borderRadius: "50%", width: 18, height: 18, cursor: "pointer", fontSize: 11, lineHeight: 1 }}>×</button>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <input type="text" value={contribRicerca} onChange={(e) => setContribRicerca(e.target.value)} onBlur={() => setTimeout(() => setContribRicerca(""), 150)} placeholder={t.contribCercaPlaceholder}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", fontFamily: "Roboto, sans-serif", fontSize: 12, fontWeight: 300 }} />
              {risultatiTag.length > 0 && (
                <ListaConScroll maxHeight={200}
                  wrapperStyle={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 1 }}
                  innerStyle={{ background: "white", borderRadius: 15, boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
                  {risultatiTag.map((r, i) => (
                    <button key={i} type="button"
                      onClick={() => { setContribTag({ tipo: r.tipo, nome: r.nome }); setContribRicerca("") }}
                      style={{ display: "block", width: "100%", padding: "8px 12px", border: "none", background: "white", cursor: "pointer", textAlign: "left", fontFamily: "Roboto, sans-serif", fontSize: 12 }}>
                      {r.nome}{r.sub && <span style={{ color: "#999", marginLeft: 6, fontWeight: 300 }}>{r.sub}</span>}
                      <span style={{ fontWeight: 300, color: "#ccc", marginLeft: 6, fontSize: 9, textTransform: "uppercase" }}>{lingua === "en" && r.tipo === "prodotto" ? "product" : r.tipo}</span>
                    </button>
                  ))}
                </ListaConScroll>
              )}
            </div>
          )}
        </div>

        <textarea value={contribDescrizione} onChange={(e) => setContribDescrizione(e.target.value)}
          placeholder={t.contribDescrizionePlaceholder} rows={5}
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontFamily: "Roboto, sans-serif", fontSize: 12, fontWeight: 300, resize: "vertical" }} />

        <input type="email" value={contribEmail} onChange={(e) => setContribEmail(e.target.value)} placeholder={t.contribEmailPlaceholder}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", fontFamily: "Roboto, sans-serif", fontSize: 12, fontWeight: 300 }} />

        <button type="button" onClick={inviaContribuzione} disabled={contribStato === "invio"}
          style={{ padding: "10px 16px", borderRadius: 20, border: "none", cursor: "pointer", background: "#1a1a1a", color: "white", fontFamily: "Roboto, sans-serif", fontSize: 12, fontWeight: 500 }}>
          {contribStato === "invio" ? t.invioInCorso : t.invia}
        </button>
        {contribStato === "ok" && <div style={{ color: "#2a8a4a", fontSize: 11, fontFamily: "Roboto, sans-serif" }}>{t.contribOk}</div>}
        {contribStato === "errore" && <div style={{ color: "#c0392b", fontSize: 11, fontFamily: "Roboto, sans-serif" }}>{t.contribErrore}</div>}
      </div>
    )
  }

  function renderMenuDetail(vista) {
    const titoli = t.voci
    const corpo = {
      manifesto: renderManifestoBody, contatti: renderContattiBody, credits: renderCreditsBody, contribuisci: renderContribuisciBody,
    }[vista]
    return (
      <>
        <div onClick={() => setMenuVista("lista")}
          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 18 }}>
          <span style={{ fontSize: 14, color: "#999" }}>‹</span>
          <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>
            {titoli[vista]}
          </span>
        </div>
        {corpo && corpo()}
      </>
    )
  }

  const uiScale = 0.6 + (window.innerWidth / 1440) * 0.4

  const suggerimentiBenvenuto = rispostaDesigner.trim().length > 1
    ? cercaEntita(rispostaDesigner).filter((r) => r.tipo === "designer")
    : []

  return (
    <>
      <style>{`
        .dn-scroll-hidden { scrollbar-width: none; }
        .dn-scroll-hidden::-webkit-scrollbar { display: none; }
      `}</style>
      {schermataIniziale && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: STILE.sfondo_colore, fontFamily: "Roboto, sans-serif",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: window.innerWidth < 768 ? "24px 36px" : 24, boxSizing: "border-box", textAlign: "center",
        }}>
          <div style={{
            fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic",
            fontSize: window.innerWidth < 768 ? 15 : 17, color: "#1a1a1a", marginBottom: 20, maxWidth: 360, lineHeight: 1.5,
            minHeight: "1.3em",
          }}>
            {t.benvenutoDomanda.slice(0, numLetterePronte)}
            <span style={{ opacity: cursoreVisibile ? 1 : 0 }}>|</span>
          </div>
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", width: "100%",
            opacity: campoRivelato ? 1 : 0,
            transform: campoRivelato ? "translateY(0)" : "translateY(8px)",
            transition: "opacity 0.6s ease, transform 0.6s ease",
            pointerEvents: campoRivelato ? "auto" : "none",
          }}>
            <div style={{ position: "relative", width: "100%", maxWidth: 260 }}>
              <input
                ref={inputSchermataInizialeRef}
                type="text"
                value={rispostaDesigner}
                onChange={(e) => setRispostaDesigner(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confermaSchermataIniziale() }}
                style={{
                  width: "100%", boxSizing: "border-box", padding: "10px 15px", borderRadius: 20,
                  border: "1px solid rgba(0,0,0,0.15)", background: "white", fontSize: 12,
                  fontFamily: "Roboto, sans-serif", outline: "none",
                }}
              />
              {suggerimentiBenvenuto.length > 0 && (
                <ListaConScroll maxHeight={220}
                  wrapperStyle={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 6, zIndex: 10 }}
                  innerStyle={{ background: "white", borderRadius: 18, boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
                  {suggerimentiBenvenuto.map((d, i) => (
                    <button key={i} onClick={() => confermaSchermataIniziale(d.nome)}
                      style={{
                        display: "block", width: "100%", textAlign: "left", padding: "9px 15px",
                        border: "none", background: "white", cursor: "pointer", fontSize: 12,
                        fontFamily: "Roboto, sans-serif", color: "#1a1a1a",
                      }}>
                      {d.nome}
                      <span style={{ fontWeight: 300, color: "#ccc", marginLeft: 6, fontSize: 9, textTransform: "uppercase" }}>{d.tipo}</span>
                    </button>
                  ))}
                </ListaConScroll>
              )}
            </div>
            <button onClick={() => confermaSchermataIniziale()}
              style={{
                marginTop: 16, padding: "8px 22px", borderRadius: 18, border: "none",
                background: "#FF0707", color: "white", fontSize: 11, fontFamily: "'Roboto Mono', monospace",
                cursor: "pointer",
              }}>
              {t.benvenutoConferma}
            </button>
          </div>
        </div>
      )}
      {window.innerWidth < 768 && (
        <div ref={topBarRef} style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 20, padding: "14px 16px",
          background: STILE.sfondo_colore, boxSizing: "border-box", overflowX: "hidden",
          ...stileIngressoChrome,
        }}>
          <div style={{ position: "relative" }}>
            <div
              style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", fontSize: 13, color: "#1a1a1a", letterSpacing: 0.3, lineHeight: 1.3, marginLeft: 9, paddingRight: 36 }}>
              Design — encyclopédie visuelle 1880–1980
            </div>
            <button onClick={() => menuApertoMobile ? chiudiMenu() : setMenuApertoMobile(true)}
              style={{
                position: "absolute", top: "50%", right: 0,
                transform: menuApertoMobile ? "translateY(-50%) rotate(45deg)" : "translateY(-50%) rotate(0deg)",
                width: 28, height: 28, minWidth: 28, borderRadius: "50%", border: "none",
                background: "white", boxShadow: "0 2px 12px rgba(0,0,0,0.1)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                transition: "transform 0.3s ease",
              }}>
              <span style={{ position: "relative", width: 12, height: 12, display: "block" }}>
                <span style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1.5, background: "#1a1a1a", transform: "translateY(-50%)" }} />
                <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1.5, background: "#1a1a1a", transform: "translateX(-50%)" }} />
              </span>
            </button>
          </div>
          <div ref={sottotitoloRef} style={{
            overflow: "hidden", transition: "max-height 0.5s ease, opacity 0.5s ease, margin 0.5s ease",
            maxHeight: (pannelloDesigner || nodoEvidenziato) ? 0 : 60, opacity: (pannelloDesigner || nodoEvidenziato) ? 0 : 1,
            marginTop: (pannelloDesigner || nodoEvidenziato) ? 0 : 4,
          }}>
            <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 400, fontStyle: "italic", fontSize: 13, color: "#1a1a1a", lineHeight: 1.3, marginLeft: 9 }}>
              {t.sottotitolo}
            </div>
          </div>
          <div style={{
            overflow: "hidden", transition: "max-height 0.4s ease, opacity 0.4s ease, margin 0.4s ease",
            maxHeight: (pannelloDesigner || nodoEvidenziato) ? 0 : 400,
            opacity: (pannelloDesigner || nodoEvidenziato) ? 0 : 1,
            marginTop: (pannelloDesigner || nodoEvidenziato) ? 0 : 28,
            marginLeft: -6,
          }}>
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff",
                borderRadius: "50%", padding: 3, boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
                width: 28, height: 28, boxSizing: "border-box", flexShrink: 0,
              }}>
                <button onClick={() => {
                  const nuovo = !correntiVisibiliRef.current
                  correntiVisibiliRef.current = nuovo
                  setCorrentiVisibili(nuovo)
                  if (ridisegnaFn) ridisegnaFn()
                }}
                  title={correntiVisibili ? t.correntiToggleOn : t.correntiToggleOff}
                  style={{
                    width: "100%", height: "100%", borderRadius: "50%", border: "none", margin: 0,
                    background: correntiVisibili ? "#FF0707" : "#ececec", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "background 0.2s",
                  }}>
                  <svg width={11} height={11} viewBox="0 0 16 16" style={{ display: "block" }}>
                    <circle cx="6" cy="6" r="5" fill="none" stroke={correntiVisibili ? "#ffffff" : "#555555"} strokeWidth="1.4" />
                    <circle cx="10" cy="10" r="5" fill="none" stroke={correntiVisibili ? "#ffffff" : "#555555"} strokeWidth="1.4" />
                  </svg>
                </button>
              </div>
              <div style={{ display: "flex", gap: 2, background: "#ffffff", borderRadius: 22, padding: 3, boxShadow: "0 2px 12px rgba(0,0,0,0.1)", height: 28, boxSizing: "border-box", alignItems: "center" }}>
                <button onClick={() => cambiaVista("designer")}
                  style={{ height: "100%", boxSizing: "border-box", padding: "0 12px", border: "none", borderRadius: 18, cursor: "pointer", fontSize: 9, fontWeight: vistaCorrente === "designer" ? 400 : 300, fontFamily: "'Roboto Mono', monospace", color: vistaCorrente === "designer" ? "#ffffff" : "#555555", background: vistaCorrente === "designer" ? "#FF0707" : "#ececec", transition: "all 0.2s", display: "flex", alignItems: "center" }}>
                  {t.designerToggle}
                </button>
                <button onClick={() => cambiaVista("timeline")}
                  style={{ height: "100%", boxSizing: "border-box", padding: "0 12px", border: "none", borderRadius: 18, cursor: "pointer", fontSize: 9, fontWeight: vistaCorrente === "timeline" ? 400 : 300, fontFamily: "'Roboto Mono', monospace", color: vistaCorrente === "timeline" ? "#ffffff" : "#555555", background: vistaCorrente === "timeline" ? "#FF0707" : "#ececec", transition: "all 0.2s", display: "flex", alignItems: "center" }}>
                  {t.timelineToggle}
                </button>
              </div>
              <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                <input ref={inputRicercaMobileRef} type="text" value={ricerca} onChange={(e) => setRicerca(e.target.value)} onBlur={() => setTimeout(() => setRicerca(""), 150)} placeholder={t.cerca}
                  style={{ height: 28, padding: "0 14px", border: "none", borderRadius: 20, fontSize: 9, fontWeight: 300, fontFamily: "'Roboto Mono', monospace", background: "white", boxShadow: "0 2px 12px rgba(0,0,0,0.1)", outline: "none", width: "100%", boxSizing: "border-box", color: "#1a1a1a" }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {window.innerWidth < 768 && ricerca.length > 1 && (() => {
        const risultati = cercaEntita(ricerca)
        if (risultati.length === 0) return null
        const inputRect = inputRicercaMobileRef.current ? inputRicercaMobileRef.current.getBoundingClientRect() : null
        if (!inputRect) return null
        return (
          <ListaConScroll maxHeight={260}
            wrapperStyle={{ position: "fixed", top: inputRect.bottom + 4, left: inputRect.left, width: inputRect.width, zIndex: 30 }}
            innerStyle={{ background: "white", borderRadius: 17, boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
            {risultati.map((r, i) => (
              <button key={i} onClick={() => { setRicerca(""); if (centraFn) centraFn(r.nome, r.tipo) }}
                style={{ display: "block", width: "100%", padding: "10px 14px", border: "none", background: "white", cursor: "pointer", textAlign: "left", fontFamily: "Roboto, sans-serif", fontSize: 11, borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ fontWeight: 500, color: "#1a1a1a" }}>{r.nome}</span>
                {r.sub && <span style={{ fontWeight: 300, color: "#999", marginLeft: 6 }}>{r.sub}</span>}
                <span style={{ fontWeight: 300, color: "#ccc", marginLeft: 6, fontSize: 9, textTransform: "uppercase" }}>{lingua === "en" && r.tipo === "prodotto" ? "product" : r.tipo}</span>
              </button>
            ))}
          </ListaConScroll>
        )
      })()}

      {window.innerWidth < 768 && menuApertoMobile && (
        <div onClick={chiudiMenu}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 25 }} />
      )}

      {window.innerWidth < 768 && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "78%", maxWidth: 320,
          background: "#ffffff", zIndex: 26, boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
          transform: menuApertoMobile ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.35s ease", padding: "24px 22px", boxSizing: "border-box",
          display: "flex", flexDirection: "column", gap: 2, overflowY: "auto",
        }}>
          {menuVista === "lista" && renderMenuHeader()}
          {menuVista === "lista" ? renderMenuLista() : renderMenuDetail(menuVista)}
          {menuVista === "lista" && renderMenuFooter()}
        </div>
      )}

      {window.innerWidth >= 768 && (
        <div style={{
          position: "fixed", top: 0, left: 0, bottom: 0, width: 240 * uiScale,
          padding: `${20 * uiScale}px ${16 * uiScale}px`, boxSizing: "border-box",
          display: "flex", flexDirection: "column", justifyContent: "flex-end",
          zIndex: 20, pointerEvents: "none",
          opacity: chromeVisibile ? 1 : 0,
          transform: `translateX(${chromeVisibile ? 0 : -10}px)`,
          transition: "opacity 0.9s ease, transform 0.9s ease",
        }}>
          <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", fontSize: 13 * uiScale, color: "#1a1a1a", letterSpacing: 0.3, lineHeight: 1.3 }}>
            Design — encyclopédie visuelle 1880–1980
          </div>
          <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 400, fontStyle: "italic", fontSize: 13 * uiScale, color: "#1a1a1a", marginTop: 6 * uiScale, lineHeight: 1.3 }}>
            {t.sottotitolo}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 * uiScale, marginTop: 10 * uiScale, opacity: 1, maxHeight: 300, overflow: "hidden" }}>
            <p style={{ fontFamily: "Roboto, sans-serif", fontWeight: 300, fontSize: 11 * uiScale, color: "#888", lineHeight: 1.35, margin: 0 }}>
              {t.paragrafo1}
            </p>
            <p style={{ fontFamily: "Roboto, sans-serif", fontWeight: 300, fontSize: 11 * uiScale, color: "#888", lineHeight: 1.35, margin: 0 }}>
              {t.paragrafo2}
            </p>
          </div>
        </div>
      )}

      {window.innerWidth >= 768 && (
        <div style={{
          position: "fixed", top: 36 * uiScale, left: "50%",
          transform: `translateX(-50%) translateY(${chromeVisibile ? 0 : -10}px)`,
          opacity: chromeVisibile ? 1 : 0, transition: "opacity 0.9s ease, transform 0.9s ease",
          zIndex: 20, display: "flex", flexDirection: "row", alignItems: "center", gap: 8 * uiScale,
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff",
            borderRadius: "50%", padding: 3, boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
            width: 28 * uiScale, height: 28 * uiScale, boxSizing: "border-box", flexShrink: 0,
          }}>
            <button onClick={() => {
              const nuovo = !correntiVisibiliRef.current
              correntiVisibiliRef.current = nuovo
              setCorrentiVisibili(nuovo)
              if (ridisegnaFn) ridisegnaFn()
            }}
              title={correntiVisibili ? t.correntiToggleOn : t.correntiToggleOff}
              style={{
                width: "100%", height: "100%", borderRadius: "50%", border: "none", margin: 0,
                background: correntiVisibili ? "#FF0707" : "#ececec", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "background 0.2s",
              }}>
              <svg width={11 * uiScale} height={11 * uiScale} viewBox="0 0 16 16" style={{ display: "block" }}>
                <circle cx="6" cy="6" r="5" fill="none" stroke={correntiVisibili ? "#ffffff" : "#555555"} strokeWidth="1.4" />
                <circle cx="10" cy="10" r="5" fill="none" stroke={correntiVisibili ? "#ffffff" : "#555555"} strokeWidth="1.4" />
              </svg>
            </button>
          </div>
          <div style={{ display: "flex", gap: 2, background: "#ffffff", borderRadius: 18 * uiScale, padding: 3, boxShadow: "0 2px 12px rgba(0,0,0,0.1)", height: 28 * uiScale, boxSizing: "border-box" }}>
            <button onClick={() => cambiaVista("designer")}
              style={{ padding: `0 ${11 * uiScale}px`, border: "none", borderRadius: 13 * uiScale, cursor: "pointer", fontSize: 10 * uiScale, fontWeight: vistaCorrente === "designer" ? 400 : 300, fontFamily: "'Roboto Mono', monospace", color: vistaCorrente === "designer" ? "#ffffff" : "#555555", background: vistaCorrente === "designer" ? "#FF0707" : "#ececec", transition: "all 0.2s", display: "flex", alignItems: "center" }}>
              {t.designerToggle}
            </button>
            <button onClick={() => cambiaVista("timeline")}
              style={{ padding: `0 ${11 * uiScale}px`, border: "none", borderRadius: 13 * uiScale, cursor: "pointer", fontSize: 10 * uiScale, fontWeight: vistaCorrente === "timeline" ? 400 : 300, fontFamily: "'Roboto Mono', monospace", color: vistaCorrente === "timeline" ? "#ffffff" : "#555555", background: vistaCorrente === "timeline" ? "#FF0707" : "#ececec", transition: "all 0.2s", display: "flex", alignItems: "center" }}>
              {t.timelineToggle}
            </button>
          </div>
          <div style={{ position: "relative" }}>
            <input type="text" value={ricerca} onChange={(e) => setRicerca(e.target.value)} onBlur={() => setTimeout(() => setRicerca(""), 150)} placeholder={t.cerca}
              style={{ height: 28 * uiScale, boxSizing: "border-box", padding: `0 ${11 * uiScale}px`, border: "none", borderRadius: 14 * uiScale, fontSize: 10 * uiScale, fontWeight: 300, fontFamily: "'Roboto Mono', monospace", background: "white", boxShadow: "0 2px 12px rgba(0,0,0,0.1)", outline: "none", width: 140 * uiScale, color: "#1a1a1a" }} />
            {ricerca.length > 1 && (() => {
              const risultati = cercaEntita(ricerca)
              if (risultati.length === 0) return null
              return (
                <ListaConScroll maxHeight={240}
                  wrapperStyle={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4 }}
                  innerStyle={{ background: "white", borderRadius: 15, boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
                  {risultati.map((r, i) => (
                    <button key={i} onClick={() => { setRicerca(""); if (centraFn) centraFn(r.nome, r.tipo) }}
                      style={{ display: "block", width: "100%", padding: "8px 14px", border: "none", background: "white", cursor: "pointer", textAlign: "left", fontFamily: "Roboto, sans-serif", fontSize: 11, borderBottom: "1px solid #f0f0f0" }}>
                      <span style={{ fontWeight: 500, color: "#1a1a1a" }}>{r.nome}</span>
                      {r.sub && <span style={{ fontWeight: 300, color: "#999", marginLeft: 6 }}>{r.sub}</span>}
                      <span style={{ fontWeight: 300, color: "#ccc", marginLeft: 6, fontSize: 9, textTransform: "uppercase" }}>{lingua === "en" && r.tipo === "prodotto" ? "product" : r.tipo}</span>
                    </button>
                  ))}
                </ListaConScroll>
              )
            })()}
          </div>
        </div>
      )}

      {window.innerWidth >= 768 && (
        <div style={{
          position: "fixed", top: 32 * uiScale, left: 24 * uiScale, zIndex: 210,
          opacity: chromeVisibile ? 1 : 0,
          transform: `translateY(${chromeVisibile ? 0 : -10}px)`,
          transition: "opacity 0.9s ease, transform 0.9s ease",
        }}>
        <button onClick={() => menuApertoDesktop ? chiudiMenu() : setMenuApertoDesktop(true)}
          style={{
            position: "relative",
            width: 36 * uiScale, height: 36 * uiScale, minWidth: 36 * uiScale, borderRadius: "50%", border: "none",
            background: "white", boxShadow: "0 2px 12px rgba(0,0,0,0.1)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
            transform: menuApertoDesktop ? "rotate(45deg)" : "rotate(0deg)",
            transition: "transform 0.3s ease",
          }}>
          <span style={{ position: "relative", width: 14 * uiScale, height: 14 * uiScale, display: "block" }}>
            <span style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1.5, background: "#1a1a1a", transform: "translateY(-50%)" }} />
            <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1.5, background: "#1a1a1a", transform: "translateX(-50%)" }} />
          </span>
        </button>
        </div>
      )}

      {window.innerWidth >= 768 && menuApertoDesktop && (
        <div onClick={chiudiMenu}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.15)", zIndex: 149 }} />
      )}

      {window.innerWidth >= 768 && (
        <div style={{
          position: "fixed", top: 0, left: 0, bottom: 0, width: 340 * uiScale,
          background: "#ffffff", zIndex: 150, boxShadow: "4px 0 32px rgba(0,0,0,0.12)",
          transform: menuApertoDesktop ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          fontFamily: "Roboto, sans-serif",
        }}>
          <div style={{ flex: 1, overflowY: "auto", padding: `${116 * uiScale}px ${28 * uiScale}px ${32 * uiScale}px` }}>
            {menuVista === "lista" && renderMenuHeader()}
            {menuVista === "lista" ? renderMenuLista() : renderMenuDetail(menuVista)}
            {menuVista === "lista" && renderMenuFooter()}
          </div>
        </div>
      )}

      {designerAttivo && (
        <div style={{ position: "fixed", bottom: 64, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.06)", borderRadius: 20, padding: "6px 16px", fontSize: 11, fontWeight: 300, color: "#888", fontFamily: "Roboto, sans-serif", zIndex: 20, pointerEvents: "none" }}>
          {t.hoverTooltip}
        </div>
      )}

      <button onClick={() => resetVistaFn && resetVistaFn()} title={t.home}
        style={{
          position: "fixed", right: 172, bottom: 6, zIndex: 20,
          width: 26, height: 26, minWidth: 26, borderRadius: "50%", border: "none",
          background: "white", boxShadow: "0 2px 12px rgba(0,0,0,0.1)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
        }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9h13v-9" />
        </svg>
      </button>

      {tooltipRelazione && (
        <div style={{ position: "fixed", left: tooltipRelazione.x + 14, top: tooltipRelazione.y - 10, background: "white", borderRadius: 8, padding: "8px 12px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", fontFamily: "Roboto, sans-serif", fontSize: 12, zIndex: 200, pointerEvents: "none", maxWidth: 220 }}>
          <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", color: "#1a1a1a", marginBottom: 4, fontSize: 13 }}>
            {tooltipRelazione.dati.designer_a} — {tooltipRelazione.dati.designer_b}
          </div>
          <div style={{ fontWeight: 600, color: "#444", marginBottom: 4, textTransform: "uppercase", fontSize: 10, letterSpacing: 1 }}>
            {lingua === "en" ? (TIPO_RELAZIONE_EN[tooltipRelazione.dati.tipo] || tooltipRelazione.dati.tipo) : tooltipRelazione.dati.tipo}
          </div>
          <div style={{ fontWeight: 300, color: "#555", lineHeight: 1.4 }}>
            {lingua === "en" ? (tooltipRelazione.dati.descrizione_en || tooltipRelazione.dati.descrizione) : tooltipRelazione.dati.descrizione}
          </div>
        </div>
      )}

      {tooltipCorrente && (
        <div style={{ position: "fixed", left: tooltipCorrente.x + 14, top: tooltipCorrente.y - 10, background: "white", borderRadius: 8, padding: "8px 12px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", fontFamily: "Roboto, sans-serif", fontSize: 12, zIndex: 200, pointerEvents: "none", maxWidth: 220 }}>
          <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", color: "#1a1a1a", marginBottom: 4, fontSize: 13 }}>
            {tooltipCorrente.dati.nome}
          </div>
          <div style={{ fontWeight: 300, color: "#555", lineHeight: 1.4 }}>
            {lingua === "en" ? tooltipCorrente.dati.descrizioneBreve_en : tooltipCorrente.dati.descrizioneBreve}
          </div>
        </div>
      )}

      {pannelloDesigner && pannelloDesigner._tipo === "corrente" && (() => {
        const c = pannelloDesigner
        const chiudi = () => { setPannelloVisibile(false); setTimeout(() => setPannelloDesigner(null), 350) }
        const periodo = c.annoFine ? `${c.annoInizio}–${c.annoFine}` : `${c.annoInizio}–`
        return (
          <div style={{
            position: "fixed", fontFamily: "Roboto, sans-serif", zIndex: 100,
            background: (window.innerWidth < 768 && !pannelloVisibile) ? STILE.sfondo_colore : "#BA0B08",
            display: "flex", flexDirection: "column", overflow: "hidden",
            transition: window.innerWidth < 768
              ? "height 0.35s cubic-bezier(0.4, 0, 0.2, 1)"
              : "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
            ...(window.innerWidth < 768
              ? { left: 0, right: 0, bottom: 0, height: pannelloVisibile ? "40vh" : "0", borderRadius: "16px 16px 0 0", boxShadow: pannelloVisibile ? "0 -4px 32px rgba(0,0,0,0.3)" : "none" }
              : { top: 0, right: 0, bottom: 0, width: 340 * uiScale, boxShadow: "-4px 0 32px rgba(0,0,0,0.3)", transform: pannelloVisibile ? "translateX(0)" : "translateX(100%)" })
          }}>
            <div style={{ flex: 1, overflowY: "auto", padding: window.innerWidth < 768 ? "16px 16px 24px" : "20px 28px 32px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingTop: window.innerWidth < 768 ? 0 : 12 }}>
                <div>
                  <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", fontSize: window.innerWidth < 768 ? 17 : 20, color: "#ffffff", lineHeight: 1.2 }}>
                    {c.nome}
                  </div>
                  <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 400, fontStyle: "italic", fontSize: window.innerWidth < 768 ? 12 : 14, color: "rgba(255,255,255,0.65)", marginTop: 4 }}>
                    {periodo}
                  </div>
                </div>
                <button onClick={chiudi}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "rgba(255,255,255,0.6)", padding: "0 4px", lineHeight: 1 }}>
                  &times;
                </button>
              </div>

              <p style={{ fontSize: window.innerWidth < 768 ? 12 : 13, fontWeight: 300, color: "rgba(255,255,255,0.85)", lineHeight: 1.5, margin: "16px 0 0" }}>
                {lingua === "en" ? c.descrizione_en : c.descrizione}
              </p>

              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                  {t.esponenti}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {(c.esponenti || []).map((nome) => (
                    <div key={nome}
                      style={{ fontFamily: "'Roboto Serif', serif", fontStyle: "italic", fontSize: 13, color: "#ffffff", padding: "3px 0", opacity: 0.9 }}>
                      {nome}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {pannelloDesigner && pannelloDesigner._tipo !== "corrente" && (() => {
        const scuro = pannelloDesigner._tipo === "designer"
        const designerProdotto = pannelloDesigner._tipo === "prodotto"
          ? getDesigners(pannelloDesigner).join(", ")
          : ""
        return (
        <div style={{
          position: "fixed", fontFamily: "Roboto, sans-serif", zIndex: 100,
          background: (window.innerWidth < 768 && !pannelloVisibile) ? STILE.sfondo_colore : (scuro ? "#1a1a1a" : "#ffffff"),
          display: "flex", flexDirection: "column", overflow: "hidden",
          transition: window.innerWidth < 768
            ? "height 0.35s cubic-bezier(0.4, 0, 0.2, 1)"
            : "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
          ...(window.innerWidth < 768
            ? {
              left: 0, right: 0, bottom: 0,
              height: pannelloVisibile ? "40vh" : "0",
              borderRadius: "16px 16px 0 0",
              boxShadow: pannelloVisibile ? `0 -4px 32px rgba(0,0,0,${scuro ? 0.3 : 0.12})` : "none",
            }
            : {
              top: 0, right: 0, bottom: 0, width: 340 * uiScale,
              boxShadow: `-4px 0 32px rgba(0,0,0,${scuro ? 0.3 : 0.12})`,
              transform: pannelloVisibile ? "translateX(0)" : "translateX(100%)",
            })
        }}>
          <div style={{ flex: 1, overflowY: "auto", padding: window.innerWidth < 768 ? "16px 16px 24px" : "20px 28px 32px" }}>
            {window.innerWidth < 768 ? (
              <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
                {(() => {
                  const galleria = [pannelloDesigner.foto, ...(pannelloDesigner.foto_dettaglio || [])]
                  const idx = Math.min(galleriaIndice, galleria.length - 1)
                  return (
                    <div style={{ width: 90, flexShrink: 0 }}>
                      <div ref={thumbnailRef}
                        onTouchStart={(e) => { touchGalleriaRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, gestito: false } }}
                        onTouchEnd={(e) => {
                          const start = touchGalleriaRef.current
                          if (!start) return
                          start.gestito = true
                          const dx = e.changedTouches[0].clientX - start.x
                          const dy = e.changedTouches[0].clientY - start.y
                          if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy)) {
                            if (dx < 0) setGalleriaIndice((idx + 1) % galleria.length)
                            else setGalleriaIndice((idx - 1 + galleria.length) % galleria.length)
                          } else {
                            apriGalleriaFullscreen()
                          }
                        }}
                        onClick={() => { if (!touchGalleriaRef.current || !touchGalleriaRef.current.gestito) apriGalleriaFullscreen() }}
                        style={{ width: 90, height: 90, overflow: "hidden", background: scuro ? "#2a2a2a" : "#f5f5f5", borderRadius: 8, cursor: "pointer" }}>
                        <img src={`${import.meta.env.BASE_URL}immagini/${galleria[idx]}`} alt={pannelloDesigner.nome}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          onError={(e) => { e.target.style.display = "none" }} />
                      </div>
                      {galleria.length > 1 && (
                        <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 5 }}>
                          {galleria.map((_, i) => (
                            <span key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: i === idx ? (scuro ? "#fff" : "#1a1a1a") : (scuro ? "#444" : "#ddd") }} />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", fontSize: 17, color: scuro ? "#fff" : "#1a1a1a", lineHeight: 1.2 }}>
                    {pannelloDesigner.nome}
                  </div>
                  {pannelloDesigner._tipo === "prodotto" && (
                    <div style={{ marginTop: 3 }}>
                      <div style={{ fontFamily: "Roboto, sans-serif", fontWeight: 300, fontSize: 11, color: "#888" }}>{designerProdotto}</div>
                      <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 400, fontStyle: "italic", fontSize: 12, color: "#aaa", marginTop: 1 }}>{pannelloDesigner.anno_label || pannelloDesigner.anno}</div>
                    </div>
                  )}
                  {pannelloDesigner._tipo === "designer" && (
                    <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 400, fontStyle: "italic", fontSize: 12, color: "#888", marginTop: 3 }}>
                      {pannelloDesigner.nato}{pannelloDesigner.morto ? ` — ${pannelloDesigner.morto}` : ""}
                    </div>
                  )}
                  {pannelloDesigner.descrizione && (
                    <p style={{ fontSize: 10, fontWeight: 300, color: "#888", lineHeight: 1.4, margin: "6px 0 0" }}>
                      {lingua === "en" ? (pannelloDesigner.descrizione_en || pannelloDesigner.descrizione) : pannelloDesigner.descrizione}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ padding: "12px 0 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", fontSize: 20, color: scuro ? "#ffffff" : "#1a1a1a", lineHeight: 1.2 }}>
                        {pannelloDesigner.nome}
                      </div>
                      {pannelloDesigner._tipo === "designer" && (
                        <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 400, fontStyle: "italic", fontSize: 14, color: "#888", marginTop: 4 }}>
                          {pannelloDesigner.nato}{pannelloDesigner.morto ? ` — ${pannelloDesigner.morto}` : ""}
                        </div>
                      )}
                      {pannelloDesigner._tipo === "prodotto" && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ fontFamily: "Roboto, sans-serif", fontWeight: 300, fontSize: 12, color: "#888" }}>{designerProdotto}</div>
                          <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 400, fontStyle: "italic", fontSize: 13, color: "#aaa", marginTop: 2 }}>{pannelloDesigner.anno_label || pannelloDesigner.anno}</div>
                        </div>
                      )}
                    </div>
                    <button onClick={() => { setPannelloVisibile(false); setTimeout(() => setPannelloDesigner(null), 350); legameEvidenziatoRef.current = null; setLegameEvidenziato(null); if (ridisegnaFn) ridisegnaFn() }}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: scuro ? "#666" : "#aaa", padding: "0 4px", lineHeight: 1 }}>
                      &times;
                    </button>
                  </div>
                </div>
                {(() => {
                  const galleria = [pannelloDesigner.foto, ...(pannelloDesigner.foto_dettaglio || [])]
                  const idx = Math.min(galleriaIndice, galleria.length - 1)
                  return (
                    <div style={{ marginTop: 20, marginBottom: 24 }}>
                      <div style={{ position: "relative", width: "100%", aspectRatio: "1", overflow: "hidden", background: scuro ? "#2a2a2a" : "#f5f5f5" }}>
                        <img src={`${import.meta.env.BASE_URL}immagini/${galleria[idx]}`} alt={pannelloDesigner.nome}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          onError={(e) => { e.target.style.display = "none" }} />
                        {galleria.length > 1 && (
                          <>
                            <button onClick={() => setGalleriaIndice((idx - 1 + galleria.length) % galleria.length)}
                              style={{ position: "absolute", top: "50%", left: 8, transform: "translateY(-50%)", background: "rgba(0,0,0,0.4)", border: "none", color: "#fff", width: 28, height: 28, borderRadius: "50%", cursor: "pointer", fontSize: 14 }}>‹</button>
                            <button onClick={() => setGalleriaIndice((idx + 1) % galleria.length)}
                              style={{ position: "absolute", top: "50%", right: 8, transform: "translateY(-50%)", background: "rgba(0,0,0,0.4)", border: "none", color: "#fff", width: 28, height: 28, borderRadius: "50%", cursor: "pointer", fontSize: 14 }}>›</button>
                          </>
                        )}
                      </div>
                      {galleria.length > 1 && (
                        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 10 }}>
                          {galleria.map((_, i) => (
                            <button key={i} onClick={() => setGalleriaIndice(i)}
                              style={{ width: 6, height: 6, borderRadius: "50%", border: "none", padding: 0, cursor: "pointer", background: i === idx ? (scuro ? "#fff" : "#1a1a1a") : (scuro ? "#444" : "#ddd") }} />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {pannelloDesigner._tipo === "designer" && pannelloDesigner.bio && (() => {
              const bioTesto = lingua === "en" ? (pannelloDesigner.bio_en || pannelloDesigner.bio) : pannelloDesigner.bio
              return (
              <div style={{ marginBottom: 0, ...(window.innerWidth < 768 ? { marginLeft: 104 } : {}) }}>
                <div style={{ fontSize: 9, fontWeight: 600, color: "#266DD3", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>{t.biografia}</div>
                <div style={{
                  fontSize: window.innerWidth < 768 ? 11 : 13, fontWeight: 300, color: scuro ? "#999" : "#666", lineHeight: 1.6,
                }}>
                  {bioTesto.split(/\n\n+/).map((par, i) => (
                    <p key={i} style={{ margin: i === 0 ? 0 : "10px 0 0" }}>{par}</p>
                  ))}
                </div>
              </div>
              )
            })()}

            {pannelloDesigner._tipo === "designer" && (() => {
              const aziende = [...new Set(prodotti.filter(p => {
                const ds = getDesigners(p)
                return ds.includes(pannelloDesigner.nome)
              }).flatMap(p => [p.azienda, p.azienda_attuale]).filter(Boolean))]
              if (aziende.length === 0) return null
              return (
                <div style={window.innerWidth < 768 ? { marginLeft: 104 } : {}}>
                  <hr style={{ border: "none", borderTop: `1px solid ${scuro ? "#333" : "#eee"}`, margin: "20px 0" }} />
                  <div style={{ fontSize: 9, fontWeight: 600, color: "#266DD3", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>{t.aziende}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {aziende.map((az) => {
                      const attiva = aziendaAttiva === az
                      return (
                        <button key={az} onClick={() => toggleAzienda(az)} style={{
                          fontSize: 11, fontWeight: attiva ? 600 : 400,
                          color: attiva ? "#fff" : (scuro ? "#888" : "#555"),
                          background: attiva ? "#ff6b2b" : "transparent",
                          border: `1px solid ${attiva ? "#ff6b2b" : (scuro ? "#333" : "#ddd")}`,
                          borderRadius: 20, padding: "4px 12px",
                          fontFamily: "Roboto, sans-serif", cursor: "pointer",
                          transition: "all 0.2s",
                        }}>{az}</button>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {pannelloDesigner._tipo === "designer" && (() => {
              const legami = relazioni.filter((r) => r.designer_a === pannelloDesigner.nome || r.designer_b === pannelloDesigner.nome)
              if (legami.length === 0) return null
              return (
                <div style={window.innerWidth < 768 ? { marginLeft: 104 } : {}}>
                  <hr style={{ border: "none", borderTop: `1px solid ${scuro ? "#333" : "#eee"}`, margin: "32px 0 20px" }} />
                  <div style={{ fontSize: 9, fontWeight: 600, color: "#266DD3", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>{t.legami}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {legami.map((r, i) => {
                      const altro = r.designer_a === pannelloDesigner.nome ? r.designer_b : r.designer_a
                      const tipoTesto = (lingua === "en" ? (TIPO_RELAZIONE_EN[r.tipo] || r.tipo) : r.tipo).replace(/_/g, " ")
                      const descrizione = lingua === "en" ? (r.descrizione_en || r.descrizione) : r.descrizione
                      const selezionato = legameEvidenziato && legameEvidenziato.a === pannelloDesigner.nome && legameEvidenziato.b === altro
                      const hoverato = legameHoverIdx === i
                      return (
                        <button key={i}
                          onClick={() => evidenziaLegameFn && evidenziaLegameFn(pannelloDesigner.nome, altro)}
                          onMouseEnter={() => setLegameHoverIdx(i)}
                          onMouseLeave={() => setLegameHoverIdx(null)}
                          style={{
                            display: "block", width: "100%", textAlign: "left",
                            background: selezionato ? "#ffffff" : (hoverato ? (scuro ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)") : "none"),
                            border: "none", outline: "none", cursor: "pointer", fontFamily: "Roboto, sans-serif",
                            padding: "10px 12px", margin: "-10px -12px",
                          }}>
                          <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", fontSize: 13, color: selezionato ? "#000000" : (scuro ? "#fff" : "#1a1a1a") }}>
                            {altro}
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: selezionato ? "#000000" : (scuro ? "#888" : "#aaa"), textTransform: "capitalize", marginTop: 3 }}>
                            {tipoTesto}
                          </div>
                          {descrizione && (
                            <div style={{ fontSize: 11, fontWeight: 300, color: selezionato ? "#000000" : (scuro ? "#999" : "#666"), lineHeight: 1.5, marginTop: 2 }}>
                              {descrizione}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {pannelloDesigner._tipo === "prodotto" && (
              <div style={window.innerWidth < 768 ? { marginLeft: 104 } : {}}>
                {pannelloDesigner.descrizione && !(window.innerWidth < 768) && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>{t.descrizioneLabel}</div>
                    <p style={{ fontSize: 13, fontWeight: 300, color: "#666", lineHeight: 1.6, margin: 0 }}>
                      {lingua === "en" ? (pannelloDesigner.descrizione_en || pannelloDesigner.descrizione) : pannelloDesigner.descrizione}
                    </p>
                  </div>
                )}
                {pannelloDesigner.categoria && (
                  <div>
                    <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "16px 0" }} />
                    <div style={{ fontSize: 9, fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>{t.tipologia}</div>
                    <span style={{ fontSize: 11, fontWeight: 400, color: "#555", border: "1px solid #ddd", borderRadius: 20, padding: "4px 12px", fontFamily: "Roboto, sans-serif" }}>{lingua === "en" ? (CATEGORIA_EN[pannelloDesigner.categoria] || pannelloDesigner.categoria) : pannelloDesigner.categoria}</span>
                  </div>
                )}
                {pannelloDesigner.azienda && (
                  <div>
                    <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "16px 0" }} />
                    <div style={{ fontSize: 9, fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>{t.azienda}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {[pannelloDesigner.azienda, pannelloDesigner.azienda_attuale].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).map((az) => {
                        const attiva = aziendaAttiva === az
                        return (
                          <button key={az} onClick={() => toggleAzienda(az)} style={{
                            fontSize: 11, fontWeight: attiva ? 600 : 400,
                            color: attiva ? "#fff" : "#555",
                            background: attiva ? "#ff6b2b" : "transparent",
                            border: `1px solid ${attiva ? "#ff6b2b" : "#ddd"}`,
                            borderRadius: 20, padding: "4px 12px",
                            fontFamily: "Roboto, sans-serif", cursor: "pointer",
                            transition: "all 0.2s",
                          }}>{az}</button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {pannelloDesigner.riconoscimenti && pannelloDesigner.riconoscimenti.length > 0 && (
                  <div>
                    <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "16px 0" }} />
                    <div style={{ fontSize: 9, fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>{t.riconoscimenti}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {pannelloDesigner.riconoscimenti.map((r, i) => (
                        <div key={i} style={{ fontSize: 12, fontWeight: 300, color: "#555", fontFamily: "Roboto, sans-serif" }}>
                          {r}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )
      })()}

      {galleriaFullscreen && pannelloDesigner && galleriaOrigin && (() => {
        const galleria = [pannelloDesigner.foto, ...(pannelloDesigner.foto_dettaglio || [])]
        const idx = Math.min(galleriaIndice, galleria.length - 1)
        const finaleW = Math.min(window.innerWidth * 0.9, 480)
        const finaleH = Math.min(window.innerHeight * 0.7, 480)
        const frameStyle = galleriaAnimata
          ? { position: "fixed", top: "50%", left: "50%", width: finaleW, height: finaleH, transform: "translate(-50%, -50%)" }
          : { position: "fixed", top: galleriaOrigin.top, left: galleriaOrigin.left, width: galleriaOrigin.width, height: galleriaOrigin.height, transform: "translate(0, 0)" }
        return (
          <div onClick={chiudiGalleriaFullscreen} style={{
            position: "fixed", inset: 0, zIndex: 300,
            background: galleriaAnimata ? "rgba(232,232,232,0.85)" : "rgba(232,232,232,0)",
            backdropFilter: galleriaAnimata ? "blur(4px)" : "blur(0px)",
            transition: "background 0.28s ease, backdrop-filter 0.28s ease",
          }}>
            <div
              onTouchStart={(e) => { touchGalleriaRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, gestito: false } }}
              onTouchEnd={(e) => {
                const start = touchGalleriaRef.current
                if (!start) return
                start.gestito = true
                const dx = e.changedTouches[0].clientX - start.x
                const dy = e.changedTouches[0].clientY - start.y
                if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
                  if (dx < 0) setGalleriaIndice((idx + 1) % galleria.length)
                  else setGalleriaIndice((idx - 1 + galleria.length) % galleria.length)
                }
              }}
              style={{
                ...frameStyle,
                overflow: "hidden",
                borderRadius: galleriaAnimata ? 16 : 8,
                boxShadow: galleriaAnimata ? "0 12px 48px rgba(0,0,0,0.18)" : "none",
                background: "#ffffff",
                transition: "all 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
              }}>
              <img src={`${import.meta.env.BASE_URL}immagini/${galleria[idx]}`} alt={pannelloDesigner.nome}
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
            </div>
            <button onClick={chiudiGalleriaFullscreen}
              style={{ position: "fixed", top: 20, right: 20, background: "none", border: "none", color: "#444", fontSize: 26, cursor: "pointer", lineHeight: 1, opacity: galleriaAnimata ? 1 : 0, transition: "opacity 0.2s ease" }}>
              &times;
            </button>
            {galleria.length > 1 && (
              <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8, opacity: galleriaAnimata ? 1 : 0, transition: "opacity 0.2s ease" }}>
                {galleria.map((_, i) => (
                  <span key={i} onClick={(e) => { e.stopPropagation(); setGalleriaIndice(i) }}
                    style={{ width: 7, height: 7, borderRadius: "50%", cursor: "pointer", background: i === idx ? "#1a1a1a" : "rgba(0,0,0,0.2)" }} />
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {popup && window.innerWidth >= 768 && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 340 * uiScale,
          background: "#1a1a1a", boxShadow: "-4px 0 32px rgba(0,0,0,0.3)",
          fontFamily: "Roboto, sans-serif", zIndex: 100,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ padding: "32px 28px 0", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 500, fontStyle: "italic", fontSize: 20, color: "#ffffff", lineHeight: 1.2 }}>
                  {popup.dati.designer_a} — {popup.dati.designer_b}
                </div>
                <div style={{ fontFamily: "'Roboto Serif', serif", fontWeight: 400, fontStyle: "italic", fontSize: 13, color: "#888", marginTop: 4 }}>
                  {lingua === "en" ? (TIPO_RELAZIONE_EN[popup.dati.tipo] || popup.dati.tipo) : popup.dati.tipo}
                </div>
              </div>
              <button onClick={() => setPopup(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#666", padding: "0 4px", lineHeight: 1 }}>
                &times;
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px 32px" }}>
            <p style={{ fontSize: 13, fontWeight: 300, color: "#999", lineHeight: 1.6, margin: 0 }}>
              {lingua === "en" ? (popup.dati.descrizione_en || popup.dati.descrizione) : popup.dati.descrizione}
            </p>
          </div>
        </div>
      )}
    </>
  )
}

export default App
