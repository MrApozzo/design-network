// REPL driver per design-network (Vite + Sigma.js su canvas).
// Pilota Chromium headless via Playwright: nav -> wait -> azione -> screenshot.
// Uso: node .claude/skills/run-design-network/driver.mjs
import { chromium } from 'playwright'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(HERE, 'screenshots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

let browser = null
let page = null
const consoleLog = []

const COMMANDS = {
  async launch() {
    if (browser) return console.log('already launched')
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.on('console', msg => consoleLog.push({ type: msg.type(), text: msg.text() }))
    page.on('pageerror', err => consoleLog.push({ type: 'pageerror', text: err.message }))
    console.log('launched.')
  },

  async nav(url) {
    if (!page) return console.log('ERROR: launch first')
    // 'networkidle' non si stabilizza mai: WebGL/canvas e il caricamento
    // progressivo delle immagini mantengono attività di rete continua.
    await page.goto(url || 'http://localhost:5173', { waitUntil: 'load', timeout: 30_000 })
    console.log('nav ->', page.url())
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first')
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    await page.screenshot({ path: f })
    console.log('screenshot:', f)
  },

  async 'ss-canvas'(name) {
    if (!page) return console.log('ERROR: launch first')
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    await page.locator('canvas').last().screenshot({ path: f })
    console.log('screenshot:', f)
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first')
    try { await page.click(sel, { timeout: 5000 }); console.log('click', sel, '-> OK') }
    catch (e) { console.log('click', sel, '-> ERROR:', e.message) }
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first')
    try { await page.getByText(text, { exact: false }).first().click({ timeout: 5000 }); console.log('click-text', JSON.stringify(text), '-> OK') }
    catch (e) { console.log('click-text', JSON.stringify(text), '-> ERROR:', e.message) }
  },

  async 'click-title'(text) {
    // Molti controlli qui sono bottoni circolari identificati da title="...", non da testo visibile.
    if (!page) return console.log('ERROR: launch first')
    try { await page.click(`[title="${text}"]`, { timeout: 5000 }); console.log('click-title', JSON.stringify(text), '-> OK') }
    catch (e) { console.log('click-title', JSON.stringify(text), '-> ERROR:', e.message) }
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first')
    try { await page.waitForSelector(sel, { timeout: 10_000 }); console.log('found:', sel) }
    catch { console.log('TIMEOUT:', sel) }
  },

  async sleep(ms) {
    await new Promise(r => setTimeout(r, Number(ms) || 500))
    console.log('slept', ms || 500, 'ms')
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first')
    try { console.log(JSON.stringify(await page.evaluate(expr))) }
    catch (e) { console.log('ERROR:', e.message) }
  },

  // React controlla gli input: `eval el.value = '...'` non scatena onChange.
  // fill/type passano dalla pipeline reale di input di Playwright.
  async fill(args) {
    if (!page) return console.log('ERROR: launch first')
    const sp = args.indexOf(' ')
    const sel = sp === -1 ? args : args.slice(0, sp)
    const value = sp === -1 ? '' : args.slice(sp + 1)
    try { await page.fill(sel, value, { timeout: 5000 }); console.log('fill', sel, '->', JSON.stringify(value)) }
    catch (e) { console.log('fill', sel, '-> ERROR:', e.message) }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first')
    console.log(await page.evaluate(s => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null))
  },

  'console'(filter) {
    const rows = filter === '--errors' ? consoleLog.filter(l => l.type === 'error' || l.type === 'pageerror') : consoleLog
    if (!rows.length) return console.log('(nessun messaggio)')
    for (const r of rows) console.log(`[${r.type}] ${r.text}`)
  },

  async quit() { if (browser) await browser.close().catch(() => {}); browser = null; page = null },
  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')) },
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'driver> ' })
// Le righe arrivano tutte insieme via heredoc/pipe: readline le emette in
// sequenza sincrona senza attendere l'handler async precedente, quindi una
// coda esplicita è necessaria per non eseguire i comandi in parallelo.
// Con input non interattivo (heredoc/pipe) readline si chiude da solo subito
// dopo l'ultima riga letta, ben prima che la coda dei comandi abbia finito
// di eseguirli: rl.prompt() dopo quel punto lancia ERR_USE_AFTER_CLOSE. Senza
// un catch per riga, quel rifiuto si propaga lungo la catena di .then() e
// interrompe silenziosamente tutti i comandi successivi al primo.
const safePrompt = () => { try { rl.prompt() } catch { /* rl già chiuso: normale in modalità pipe */ } }

let queue = Promise.resolve()
let quitting = false
rl.on('line', line => {
  queue = queue.then(async () => {
    const [cmd, ...rest] = line.trim().split(/\s+/)
    if (!cmd) return safePrompt()
    const fn = COMMANDS[cmd]
    if (!fn) { console.log('unknown:', cmd, '- try: help'); return safePrompt() }
    try { await fn(rest.join(' ')) } catch (e) { console.log('ERROR:', e.message) }
    if (cmd === 'quit') { quitting = true; rl.close() }
    else safePrompt()
  }).catch(e => console.log('DRIVER ERROR:', e.message))
})
// Niente process.exit() esplicito: su Windows può troncare lo stdout ancora
// da scaricare su una pipe. Si lascia che il loop eventi si svuoti da solo
// una volta chiuso il browser.
rl.on('close', async () => { await queue.catch(() => {}); if (!quitting) await COMMANDS.quit() })

console.log('design-network driver - "help" per i comandi, "launch" per iniziare')
rl.prompt()
