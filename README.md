# Design Network

Mappa interattiva del design, realizzata con React, Vite, Sigma.js e graphology.

## Regola di navigazione: Designer e Aziende

Prova attuale: **orbite e centri seguono esattamente la griglia durante lo zoom**. Crescono piu lentamente soltanto le dimensioni dei simboli prodotto, per lasciare progressivamente spazio fra gli oggetti. Il massimo zoom viene calcolato per mantenere l'orbita della galassia maggiore, se centrata, entro l'80% del lato corto utile. Non ci sono espansioni/compressioni delle orbite indipendenti dalla camera.

Le due viste condividono **lo stesso spazio di coordinate, la stessa griglia e la stessa scala X/Y**. Cambiare vista non deve mai deformare, riscalare o ricentrare separatamente i due layout.

**Mobile e desktop usano la stessa geometria dei contenuti.** Le coordinate non dipendono dalle dimensioni della finestra: il layout usa una proporzione di riferimento fissa di 1,8 e le orbite hanno gli stessi raggi sui due dispositivi. Lo schermo modifica l'inquadratura e lo zoom, non la distribuzione dei nodi. Verifica sui dati reali: `node scripts/verifica-layout-mobile.mjs`.

- **0% di zoom = intera mappa visibile**, calcolato dinamicamente sui contenuti di entrambe le viste e sullo spazio disponibile nella finestra, esclusi i controlli. **100% = massimo ingrandimento**.
- Al cambio Designer/Aziende, prima si esegue uno zoom out verso questa unica panoramica condivisa.
- La transizione dei contenuti parte poco prima della fine dello zoom out (attualmente al 72% dei 950 ms), per sovrapporre dolcemente le animazioni.
- Il cambio dei contenuti non modifica bounding box, proporzioni o target della camera. Dopo lo zoom out, la griglia rimane ferma mentre i prodotti completano il movimento.
- Home usa la stessa panoramica. Il resize ricalcola il fit; non esistono panoramiche diverse per Designer e Aziende.

Contesto completo, vincoli e cronologia: [HANDOFF.md](HANDOFF.md). Le decisioni piu recenti prevalgono sulle descrizioni storiche. Verifica: `node scripts/verifica-transizione-camera.mjs`; build: `npm run build`.

## Note del template React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
