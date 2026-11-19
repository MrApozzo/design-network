import { chromium } from 'playwright'
import sharp from 'sharp'

const sourceUrl = process.env.OG_SOURCE_URL || 'https://design.encyclopedie-visuelle.com/'
const output = process.env.OG_OUTPUT || 'public/og-design-network.png'
const width = 1200
const height = 630
const gutter = 10
const background = '#e8e8e8'

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  args: [
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-angle=swiftshader-webgl',
  ],
})
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 1 })
page.on('pageerror', (error) => console.error(`Errore pagina: ${error.message}`))
page.on('requestfailed', (request) => console.error(`Richiesta fallita: ${request.url()} — ${request.failure()?.errorText}`))

await page.goto(sourceUrl, { waitUntil: 'networkidle', timeout: 120_000 })
await page.evaluate(() => localStorage.removeItem('dn-camera'))
await page.reload({ waitUntil: 'networkidle', timeout: 120_000 })
await page.waitForTimeout(12_000)

const zoom = page.locator('input[aria-label="Percentuale di zoom"]')
await zoom.waitFor({ state: 'visible', timeout: 30_000 })
if (process.env.OG_DIAGNOSTIC) await page.screenshot({ path: 'og-before-zoom.png' })
const search = page.locator('input[placeholder="Cerca..."]').first()
const mapClip = { x: 400, y: 180, width: 1200, height: 700 }
const shots = []

async function capture() {
  await page.waitForTimeout(1_200)
  shots.push(await page.screenshot({ clip: mapClip }))
}

async function focus(name) {
  await search.fill(name)
  await page.getByRole('button').filter({ hasText: name }).first().click()
  await page.waitForTimeout(2_500)
  await page.keyboard.press('Escape')
  await zoom.fill('75')
  await zoom.press('Enter')
  await page.waitForTimeout(2_500)
}

for (const name of [
  'Achille Castiglioni',
  'Ettore Sottsass',
  'Gae Aulenti',
  'Michele De Lucchi',
  'Vico Magistretti',
  'Alessandro Mendini',
]) {
  await focus(name)
  await capture()
}

if (process.env.OG_DIAGNOSTIC) await page.screenshot({ path: 'og-after-zoom.png' })

await browser.close()

async function tile(buffer, tileWidth, tileHeight) {
  return sharp(buffer)
    .resize(tileWidth, tileHeight, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()
}

const panelWidth = Math.floor((width - gutter * 4) / 3)
const lastPanelWidth = width - panelWidth * 2 - gutter * 4
const panelHeight = Math.floor((height - gutter * 3) / 2)
const lastPanelHeight = height - panelHeight - gutter * 3

const panels = await Promise.all([
  tile(shots[0], panelWidth, panelHeight),
  tile(shots[1], panelWidth, panelHeight),
  tile(shots[2], lastPanelWidth, panelHeight),
  tile(shots[3], panelWidth, lastPanelHeight),
  tile(shots[4], panelWidth, lastPanelHeight),
  tile(shots[5], lastPanelWidth, lastPanelHeight),
])

await sharp({
  create: { width, height, channels: 3, background },
})
  .composite([
    { input: panels[0], left: gutter, top: gutter },
    { input: panels[1], left: panelWidth + gutter * 2, top: gutter },
    { input: panels[2], left: panelWidth * 2 + gutter * 3, top: gutter },
    { input: panels[3], left: gutter, top: panelHeight + gutter * 2 },
    { input: panels[4], left: panelWidth + gutter * 2, top: panelHeight + gutter * 2 },
    { input: panels[5], left: panelWidth * 2 + gutter * 3, top: panelHeight + gutter * 2 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(output)

console.log(`Collage reale salvato in ${output} (${width}×${height}, zoom mappa 75%)`)
