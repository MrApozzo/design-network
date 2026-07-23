# Handoff — design-network

Nota per chi (Claude o umano) legge questo file all'inizio di una nuova sessione:
è stato scritto per portare avanti il lavoro su un'altra macchina senza perdere
il contesto di una lunghissima conversazione precedente. Leggilo tutto prima di
toccare `src/App.jsx` o i dati in `src/data/`. Aggiornalo (non sostituirlo con un
riassunto più corto) man mano che il lavoro prosegue, così resta la fonte di
verità aggiornata — non affidarti alla cronologia chat, che su un'altra macchina
non esiste.

Stato a questo commit: `8582468` (ultimo pushato su `main`,
`https://github.com/MrApozzo/design-network.git`). Designer: 166. Prodotti: 1710.
Correnti: 34.

## Cos'è il progetto

App React 19 + Vite 8 + Sigma.js v3 (patchata via patch-package) + graphology,
tutto in un unico file `src/App.jsx` (>4000 righe). Visualizza un secolo di
design occidentale (1880–1980 circa, ma non è un limite rigido: ci sono già
figure contemporanee) come una mappa: asse X = anno di nascita del designer
(cronologia rigorosa, mai alterata), asse Y = posizione di stacking verticale
calcolata deterministicamente (vedi sotto). Ogni designer è un pallino con la
sua foto; i prodotti orbitano intorno al pallino del designer, a una distanza
proporzionale all'età del designer quando li ha progettati.

Dati in `src/data/`: `designers.json`, `prodotti.json`, `relazioni.json`,
`correnti.json`, `aziende.json` (vuoto, per una vista futura non ancora
progettata), `immagini_esistenti.json` (manifest auto-generato, vedi
`scripts/genera-manifest-immagini.mjs`, NON modificarlo a mano).

## COSTANTI PROTETTE — non toccare mai senza che l'utente lo chieda esplicitamente

L'utente ha ribadito più volte, in modo molto fermo, di non toccare:
- `STILE.zoom_designer_min`, `zoom_designer_max`, `zoom_prodotto_min`, `zoom_prodotto_max`
- `STILE.designer_size`, `prodotto_size` (se presenti altrove nel file)
- `STILE.orbita_*` (raggio_base, soglia_prodotti, spazio_per_prodotto, scala_mobile)
- `STILE.eta_*` (raggioBase, riferimento, massima, unita_per_anno, ecc.)
- `separaPosizioniSovrapposte` (funzione)
- `STILE.designer_scala_secondario`

Prima di ogni commit di lavoro sulle ameba/correnti, verificare con:
```
git diff -- src/App.jsx | grep -E "^[-+].*(zoom_designer_min|zoom_designer_max|designer_size|prodotto_size|orbita_|raggioBase|separaPosizioniSovrapposte|designer_scala_secondario)"
```
Se questo comando produce output, fermarsi e capire perché prima di committare:
in passato una modifica non richiesta a queste costanti (`MAX_CAMERA_RATIO`) ha
causato un incidente serio già discusso con l'utente in una sessione precedente
a questa — da qui la sua insistenza.

## Metodologia consolidata in questa sessione (seguirla sempre)

1. **Validare empiricamente PRIMA di scrivere il codice definitivo**: quando si
   propone un nuovo criterio di posizionamento/raggruppamento, scrivere prima
   uno script Node standalone (`node -e "..."`) che replica l'algoritmo sui
   dati REALI (`designers.json`, `prodotti.json`, `correnti.json`), controllare
   le dimensioni dei gruppi risultanti, quanti designer vengono spostati, ecc.
   Solo se i numeri sono ragionevoli si scrive il codice in `App.jsx`. Questo
   ha permesso di scartare due design potenzialmente catastrofici (vedi sotto)
   PRIMA di implementarli per intero.
2. **Dopo ogni modifica a `App.jsx`**: `npm run build` deve passare pulito, poi
   il grep sulle costanti protette (sopra), poi verificare a occhio il diff.
3. **Non committare/pushare senza che l'utente lo chieda esplicitamente**
   ("committa e pusha"). Fare provisional call su dati/algoritmi TBD senza
   chiedere è invece ok e gradito (vedi feedback più sotto) — sono cose
   diverse: i dati/algoritmi si decidono da soli, i commit no.
4. **Niente browser automation su questa macchina** (playwright/chromium-cli
   non funzionano, certificato non verificabile). Per verificare le modifiche:
   `npm run build` + `npm run dev`, e chiedere all'utente di guardare lui
   stesso nel browser — non pretendere di aver "visto" il risultato.
5. **Quando l'utente segnala un bug UI/interazione**, non accontentarsi della
   prima ipotesi plausibile: se lui insiste "bug 100%" dopo un primo fix,
   prendere sul serio il segnale e cercare una spiegazione più a fondo/più
   robusta (vedi storia dell'hover delle ameba più sotto — il primo fix era
   corretto ma incompleto).
6. **Quando l'utente pone una domanda tecnica diretta ("perché X non succede
   Y?"), rispondere con la spiegazione REALE del meccanismo** (con numeri,
   verificati sui dati), non con una scusa generica. L'utente apprezza molto
   questo stile (vedi episodio Rietveld/De Stijl più sotto).

## Preferenze di lavoro dell'utente

- Quando dà una lista di punti, li affronta uno alla volta ("punto punto").
- Per scelte di dati/curatela TBD (valori placeholder, criteri non ancora
  decisi), preferisce che si faccia una scelta provvisoria ragionevole e si
  proceda, segnalandola brevemente — non bloccarsi con AskUserQuestion per
  questo genere di cose a basso rischio/reversibili.
- Per scelte ARCHITETTURALI con conseguenze ad ampio raggio (es. cosa deve
  influenzare il posizionamento verticale dei designer), invece vuole essere
  consultato con numeri concreti prima di procedere — vedi sotto la storia
  delle correnti, dove sono stati fatti 2 giri di AskUserQuestion con numeri
  reali prima di convergere sul design finale.
- Aggiunta di designer/prodotti storici: sempre verificati (WebSearch quando
  serve), mai inventati. Schema designer: `{ nome, nato, morto, bio, bio_en,
  foto, y, scuole, collettivi, cognome }`. Schema prodotto: `{ nome, anno,
  designer (stringa o array), azienda, categoria, foto }`.
- `y` è quasi sempre `null` (posizione automatica); viene valorizzato a mano
  solo in rari casi eccezionali già esistenti nel dataset.

## La feature "correnti progettuali" (ameba) — storia completa e stato attuale

### Cos'è visivamente

Macchie colorate semi-trasparenti ("ameba") che racchiudono i designer che
condividono una corrente (scuola di pensiero o collettivo, campi `scuole` e
`collettivi` in `designers.json`, multi-valore: un designer può appartenere a
più correnti). Due trattamenti:
- **Ameba piena** ("blob"): quando 2+ membri della stessa corrente sono
  adiacenti nell'ordine finale di stacking verticale.
- **Alone**: un anello colorato sul singolo pallino, quando il designer non ha
  nessun altro membro della sua corrente vicino (o è l'unico membro esistente
  della corrente nel dataset attuale — vedi episodio Rietveld sotto).

### Le 3 versioni scartate PRIMA di quella attuale (perché è importante saperlo)

- **v1** (implementata e poi tolta): ameba come livello puramente visivo,
  clustering per sola vicinanza spaziale. L'utente l'ha rifiutata: "sembrano
  pallini autonomi", non ameba che racchiudono davvero più designer.
- **v2** (solo simulata via script, mai scritta in App.jsx per intero): usare
  scuole/collettivi come criterio di RIPOSIZIONAMENTO diretto (come
  co-progettazione). Risultato empirico: un designer come Sottsass fa da ponte
  fra 4 correnti diverse (Design Radicale, Postmodernismo, Memphis, Studio
  Alchimia), quindi l'unione transitiva produceva un mega-gruppo di 59
  designer su 165. Scartata.
- **v3** ("legami + co-progettazione come riposizionamento combinato"): testato
  anche l'uso di `relazioni.json` (legami personali/professionali) come
  criterio di riposizionamento, sia transitivo (71/165 in un unico gruppo) sia
  "un salto solo, non transitivo" (spostava comunque 155/165 designer dalla
  cronologia pura). Scartata: il mondo del design italiano di metà '900 è una
  rete troppo densamente interconnessa perché QUALSIASI relazione ampia
  funzioni come criterio di riposizionamento senza esplodere.

### Design finale accettato (quello attuale, in `App.jsx`)

Tre livelli di priorità nel posizionamento verticale, **mai la stessa forza**:

1. **Co-progettazione** (`gruppiCoprogetto`, invariato dall'app originale):
   priorità massima. Se A e B hanno firmato insieme un prodotto, il loro
   gruppo (transitivo: A-B, B-C ⇒ A,B,C insieme) resta sempre contiguo, mai
   spezzato da nient'altro. Passo verticale più stretto
   (`passo_verticale_coprogetto = 6`).
2. **Correnti** (`gruppiCorrenti`, NUOVO in questa sessione — vedi sotto):
   priorità inferiore, applicata DOPO. Union-find transitivo su
   scuole+collettivi: se un designer appartiene a più correnti che si
   toccano (es. tramite Sottsass), quelle correnti confluiscono in un unico
   "super-gruppo" di posizionamento. **Decisione esplicita dell'utente**: ha
   scelto la versione "tutte le correnti, transitivo completo" pur sapendo
   che produce gruppi grandi (fino a 113/165 designer in un unico blocco,
   spanning 108 anni) — l'ha vista in anteprima e le è piaciuta. Ha anche
   detto esplicitamente: "è normale che ci siano più designer italiani [nel
   grande blocco], poi verranno uniformati" — cioè si aspetta che il dataset
   si internazionalizzi/diversifichi nel tempo e il mega-blocco diventi
   relativamente meno dominante.
   L'algoritmo esatto (in `App.jsx`, cercare `passata 2`): i blocchi di
   co-progettazione (mai spezzati) vengono raggruppati per corrente
   condivisa e inseriti uno dopo l'altro nell'ordine finale, ordinati per
   anno di nascita dell'anchor di ciascun blocco.
3. **Legami diretti** (`relazioni.json`): NON riposizionano mai (provato
   catastrofico, vedi v3 sopra). Stringono solo lo spazio verticale fra due
   designer GIÀ adiacenti nell'ordine finale (`passo_verticale_legame = 18`,
   via tra il passo base 30 e quello di co-progetto 6).

Rilevamento visivo del blob (DOPO che la posizione è definitiva): ragiona a
livello di **blocco di co-progettazione**, non di singolo designer — un
designer non taggato che è finito lì solo perché indivisibile dal suo gruppo
di co-progetto (es. Naoki Matsunaga accanto a Bonetto, o Joe Colombo trascinato
dal co-progetto con Ambrogio Pozzi) non spezza più a metà un'ameba altrimenti
contigua. Questo è stato un bug reale, diagnosticato e corretto in questa
sessione (vedi sotto "bug trovati e corretti", voce 1).

### Episodio Rietveld/De Stijl (esempio di come rispondere a domande dirette)

L'utente ha chiesto: "Rietveld ha solo un alone, perché non un'ameba?" Risposta
verificata sui dati: De Stijl aveva UN SOLO membro nel dataset (Rietveld
stesso) — l'algoritmo non ha "sbagliato" a non spostarlo, semplicemente non
c'era nessun altro con cui formare un'ameba. Soluzione: aggiunto **Theo van
Doesburg** (1883–1931, cofondatore di De Stijl, teorico, painter) come
designer minore (2 prodotti verificati: vetrata per Villa De Lange 1917,
interni del Café de l'Aubette a Strasburgo 1928 con Jean Arp e Sophie
Taeuber-Arp), portando De Stijl a 2 membri — Rietveld ora forma un'ameba vera.

### Colori delle correnti

`src/data/correnti.json` ha 34 entry (`{ nome, annoInizio, annoFine, colore,
descrizioneBreve(+en), descrizione(+en) }`). I colori NON sono più la palette
HSL generica del primo tentativo: sono stati ricampionati da un pixel VIVIDO
reale (alta saturazione, non bianco/nero) trovato nelle foto esistenti su
disco di designer/prodotti di ciascuna corrente, con sharp (già in
devDependencies). Script usato (temporaneo, non nel repo — va riscritto se
serve rifare il campionamento): per ogni corrente raccoglie tutte le foto
esistenti (controllate contro `immagini_esistenti.json`, MOLTE foto
referenziate nei json non esistono ancora su disco — è normale) dei suoi
membri, campiona 12 punti sul bordo di ogni pallino per foto, e sceglie
greedily colori con hue a distanza ≥10° da quelli già assegnati (soglia
scelta perché con 34 correnti su 360° la spaziatura media possibile è
~10.6°: una soglia più larga, tipo 35°, si esaurisce dopo le prime 8-9
assegnazioni). Fallback su una palette vivida fissa (rosso/verde/blu/ecc.)
per le correnti senza nessuna foto disponibile. **I colori sono statici,
scritti nel json, NON rigenerati a runtime/refresh** — l'utente lo ha chiesto
esplicitamente e la risposta è confermata.

### Bug trovati e corretti in questa sessione

1. **Blob spezzato da passeggeri di co-progetto**: vedi sopra ("rilevamento
   visivo del blob"). Diagnosticato con dati reali (Bonetto/Sambonet/Mazza
   interrotti da Naoki Matsunaga e Joe Colombo). Corretto ragionando a livello
   di blocco invece che di designer singolo.
2. **`mouseleave` non azzerava lo stato di hover**: quando il mouse usciva dal
   canvas, `correnteHoverAttivo`/`nodoHoverAttivo`/`prodottoHoverAttivo` e i
   tooltip restavano "incollati" all'ultimo stato, perché nessun altro
   `mousemove` arrivava più ad aggiornarli. Corretto azzerando tutto
   esplicitamente nel listener `mouseleave`.
3. **Alone con `globalAlpha=1` fisso**: l'hover moltiplicava per
   `corrente_hover_boost` ma il canvas blocca `globalAlpha` a 1, quindi
   l'hover sugli aloni non produceva NESSUN cambiamento visibile. Corretto con
   un'opacità a riposo propria (`corrente_alone_alpha`), boostata su hover.
4. **Hit-test dell'hover "a caso"** (il bug più serio, segnalato con forza
   dall'utente: "come se hoverasse punti a caso e non in base al mouse"):
   l'hit-test usava `ctx.isPointInPath(path, mx, my)`, che dipende dall'avere
   la STESSA identica matrice di trasformazione del canvas attiva sia al
   disegno che al test — fragile e difficile da garantire con certezza
   assoluta leggendo solo il codice. Sostituito con un test geometrico puro
   in JS (ray-casting punto-in-poligono per i blob, distanza-al-quadrato per
   gli aloni/cerchi singoli), che lavora direttamente sulle stesse coordinate
   schermo già calcolate per il disegno, bypassando completamente il canvas
   per la parte di hit-test. Vedi funzione `puntoInPoligono` e `convexHull`
   vicino alla cima del file. Dopo questo fix l'utente ha confermato che
   l'hover funziona.
5. **Padding dell'ameba sproporzionato a zoom alto**: il margine era
   interpolato su una curva zoom (`lerp(10,16,t)`) INDIPENDENTE dalla curva
   di crescita del raggio del pallino stesso (`lerp(3,18, t^1.2)`) — le due
   curve non erano proporzionali, quindi il rapporto margine/pallino cambiava
   in modo imprevedibile a seconda dello zoom (a zoom alto il margine finiva
   quasi quanto il raggio del pallino successivo, inglobando pallini vicini
   che non c'entravano). Corretto rendendo il margine una frazione FISSA
   (`corrente_margine_fattore = 0.75`) del raggio CORRENTE del pallino, quindi
   sempre proporzionale, mai indipendente.

### Forma del blob (tecnica)

Inviluppo convesso (`convexHull`, monotone chain) di campioni presi sul bordo
reale di ogni pallino (12 campioni per pallino, non sui soli centri espansi
dal centroide come nel v1) — abbraccia meglio le orbite vere. Il raggio di
ogni campione ha un jitter pseudo-casuale ma STABILE (basato su `hashStr` di
corrente+nodo+indice, non `Math.random`) così il profilo resta irregolare
("a nuvola", non "a lente") senza tremolare da un frame all'altro
(`corrente_irregolarita = 0.4`).

## UI aggiunta in questa sessione

- **Toggle visibilità correnti**: bottone circolare a sinistra del pill
  Designer/Timeline (sia desktop che mobile), stato in
  `correntiVisibili`/`correntiVisibiliRef` (pattern dual state+ref, come
  `aziendaAttivaRef` ecc., per essere leggibile dentro il closure imperativo
  del canvas). Tecnica: stesso identico pattern del pill Designer/Timeline
  (contenitore bianco esterno con padding 3px + bottone colorato interno),
  NON un CSS `border` separato — questo garantisce che il cerchio rosso sia
  esattamente della stessa dimensione del pallino rosso "Designer" attivo, e
  che il "bordo bianco" sia visivamente identico (stessa tecnica, non solo
  stesso colore). Icona: due cerchi SVG sovrapposti, colore `#555555` (grigio,
  come il testo dei pill quando inattivi) quando spento, bianco quando acceso
  (fill dello sfondo `#E11408`).
  Spegnere il toggle azzera `correntiHit` (l'array di hit-test), disattivando
  automaticamente hover/click senza bisogno di controlli duplicati altrove.
- **Colore accento del sito**: `#F34213` → `#CF2B10` → **`#E11408`** (attuale,
  "rosso signal" più saturo e puro, meno arancio). Sostituito in TUTTI i punti
  in cui era usato (8 occorrenze: pill Designer/Timeline, badge, bottone
  correnti). Se serve ricambiarlo, cercare `#E11408` nel file (nessun altro
  uso di quell'hex).

## Domande aperte / possibili prossimi passi

- L'utente potrebbe voler continuare ad affinare le ameba (colori, sub-blob
  dentro il mega-diagonale italiano, altre correnti da aggiungere man mano che
  il dataset si internazionalizza).
- `aziende.json` è vuoto: vista futura non ancora progettata (raggruppare gli
  stessi nodi per azienda produttrice invece che per designer).
- Nessun criterio ancora definito per estendere ulteriormente le correnti a
  designer/movimenti non italiani in modo sistematico — per ora si procede
  aggiungendone quando emerge un caso concreto (come Rietveld/van Doesburg).
