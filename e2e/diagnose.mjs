/**
 * Diagnostic harness. Wraps RTCPeerConnection before app code loads so we can
 * inspect live connection state without touching the source, and echoes every
 * console message from both pages.
 */
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const ORIGIN = `http://localhost:${process.env.PORT ?? 8799}`
const ROOM = `dbg${Math.floor(Math.random() * 1e4)}`

const spy = () => {
  window.__pcs = []
  const Orig = window.RTCPeerConnection
  window.RTCPeerConnection = function (...args) {
    const pc = new Orig(...args)
    window.__pcs.push(pc)
    pc.addEventListener('negotiationneeded', () => console.log('[spy] negotiationneeded'))
    pc.addEventListener('track', (e) => console.log('[spy] track', e.track.kind, e.transceiver.mid))
    pc.addEventListener('iceconnectionstatechange', () =>
      console.log('[spy] ice', pc.iceConnectionState),
    )
    pc.addEventListener('signalingstatechange', () => console.log('[spy] sig', pc.signalingState))
    return pc
  }
  window.RTCPeerConnection.prototype = Orig.prototype
}

const dump = () =>
  (window.__pcs ?? []).map((pc) => ({
    signaling: pc.signalingState,
    conn: pc.connectionState,
    ice: pc.iceConnectionState,
    transceivers: pc.getTransceivers().map((t) => ({
      mid: t.mid,
      dir: t.direction,
      current: t.currentDirection,
      send: t.sender.track?.kind ?? null,
      recv: t.receiver.track?.kind ?? null,
      recvMuted: t.receiver.track?.muted ?? null,
    })),
  }))

async function open(browser, name) {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(spy)
  page.on('console', (m) => console.log(`  [${name}] ${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => console.log(`  [${name}] pageerror: ${e.message}`))
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[placeholder="Ada Lovelace"]')
  await page.click('input[placeholder="Ada Lovelace"]', { clickCount: 3 })
  await page.type('input[placeholder="Ada Lovelace"]', name)
  await page.click('input[placeholder="kf3n2p"]', { clickCount: 3 })
  await page.type('input[placeholder="kf3n2p"]', ROOM)
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Camera').click(),
  )
  await page.click('button[type=submit]')
  await page.waitForSelector('textarea[aria-label="Message the session"]', { timeout: 20_000 })
  return page
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--no-sandbox',
  ],
})

const NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank']
const count = Math.min(Number(process.argv[2] ?? 2), NAMES.length)

console.log(`\ndiagnostic — room "${ROOM}", ${count} peers\n`)
const pages = []
for (const name of NAMES.slice(0, count)) {
  pages.push([name.toUpperCase(), await open(browser, name)])
  console.log(`  --- ${name} in ---`)
}
console.log('  --- waiting 12s ---\n')
await new Promise((r) => setTimeout(r, 12_000))

for (const [name, page] of pages) {
  console.log(`\n=== ${name} ===`)
  console.log(JSON.stringify(await page.evaluate(dump), null, 2))
  console.log(
    'videos:',
    JSON.stringify(
      await page.evaluate(() =>
        [...document.querySelectorAll('video')].map((v) => v.videoWidth),
      ),
    ),
  )
}

await browser.close()
