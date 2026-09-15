---
name: run-design-network
description: Avvia e pilota design-network (Vite + React + Sigma.js su canvas) con Chromium headless via Playwright, per verificare visivamente modifiche estetiche, di layout o di animazione. Usare quando viene chiesto di far partire l'app, fare uno screenshot, o controllare che una modifica funzioni davvero nel browser (non solo nei test numerici in scripts/verifica-*.mjs).
---

design-network è una single-page app (Vite dev server, porta 5173 di default). L'interfaccia vera è disegnata su un `<canvas>` (Sigma.js + overlay canvas 2D), quindi non basta controllare il DOM: serve uno screenshot per valutare l'aspetto.

## Prerequisiti

Playwright + Chromium sono già installati come devDependency (`npm install -D playwright` + `npx playwright install chromium` già eseguiti). Se mancano su una macchina nuova:

```bash
npm install -D playwright
npx playwright install chromium
```

## Dev server

```bash
npm run dev &
timeout 30 bash -c 'until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done'
```

Per fermarlo: trovare il processo sulla porta 5173 e ucciderlo (su Windows via `netstat`/`taskkill`, oppure semplicemente chiudere il terminale in cui gira).

## Pilotarla: il driver REPL

`.claude/skills/run-design-network/driver.mjs` è un REPL: legge comandi da stdin, uno per riga, e li esegue in sequenza (anche via heredoc/pipe, non solo interattivo).

```bash
node .claude/skills/run-design-network/driver.mjs <<'EOF'
launch
nav http://localhost:5173
sleep 5500
eval document.querySelector('#dn-benvenuto-cerca').value = 'zzz_no_match_zzz'
click-text Entra
sleep 1000
click-title Linea del tempo
sleep 550
ss timeline-mid
console --errors
quit
EOF
```

Screenshot salvati in `.claude/skills/run-design-network/screenshots/` (override con `SCREENSHOT_DIR`).

### Comandi

| comando | cosa fa |
|---|---|
| `launch` | apre Chromium headless |
| `nav [url]` | naviga (default `http://localhost:5173`) |
| `ss [nome]` | screenshot dell'intera pagina |
| `ss-canvas [nome]` | screenshot ritagliato solo sull'ultimo `<canvas>` |
| `click <selettore-css>` | click DOM |
| `click-text <testo>` | click sul primo elemento il cui testo contiene `<testo>` |
| `click-title <testo>` | click su `[title="<testo>"]` — molti controlli qui sono bottoni circolari identificati da `title`, non da testo visibile |
| `wait <selettore>` | aspetta un selettore (10s timeout) |
| `sleep <ms>` | pausa (utile per animazioni con timing preciso) |
| `eval <js>` | esegue JS nella pagina, stampa il risultato JSON |
| `text [selettore]` | stampa `innerText` |
| `console [--errors]` | stampa i messaggi console accumulati (tutti, o solo errori) |
| `quit` | chiude il browser ed esce |

## Gotcha di questa app

- **`waitUntil: 'networkidle' non si stabilizza mai`** — il canvas WebGL/Sigma e il caricamento delle ~1250 immagini dei designer mantengono attività di rete continua. Il driver usa `waitUntil: 'load'`; per aspettare che qualcosa sia pronto usare `wait <selettore>` o `sleep`, non affidarsi a networkidle.
- **Schermata iniziale (typewriter + suggerimenti)**: all'avvio c'è una schermata con una domanda scritta lettera per lettera (~5-6s prima che campo e bottone "Entra" diventino cliccabili — il tempo dipende dalla lunghezza della frase e ha un `Math.random()` per lettera, quindi non è fisso al ms). Aspettare almeno 5.5s prima di interagire, o meglio aspettare che il campo abbia `pointer-events` diverso da `none`.
- **La tendina dei suggerimenti copre il bottone "Entra"**: appena il campo ricerca prende il focus, se è vuoto mostra TUTTI i designer come suggerimenti in una lista assoluta sopra il bottone, intercettando il click. Scrivere qualcosa di sicuramente senza corrispondenze (es. `zzz_no_match_zzz`) nel campo prima di cliccare "Entra" per chiudere la tendina.
- **I toggle principali (Aziende/Designer/Linea del tempo) si identificano per `title`, non per testo visibile** — sono bottoni circolari con solo un'icona SVG dentro. La lingua di default è italiano: il toggle timeline ha `title="Linea del tempo"` (non "Timeline", che è solo la stringa inglese).
- **Le righe orizzontali chiare per ogni designer in vista timeline sono intenzionali** (la "linea vita", nascita→morte, `globalAlpha` fisso a 0.06): non sono i collegamenti designer/azienda→prodotto e non devono sparire con il toggle timeline — è un elemento del design, non un bug.

## Certificato TLS (nota storica)

In passato `npx playwright install` falliva con `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, causato dal filtro HTTPS di Avast (driver `aswMonFltProxy`, visibile in `env | grep -i proxy` come `SSLKEYLOGFILE`). Al momento della stesura di questa skill il download funziona senza intervenire su Avast o su `NODE_EXTRA_CA_CERTS` — se dovesse ripresentarsi, quella è la causa più probabile da controllare per prima.
