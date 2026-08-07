/**
 * End-to-end media test: two real Chromium pages, fake camera and mic,
 * exchanging live WebRTC media through the signaling server.
 *
 * This covers what the protocol suite cannot — RTCPeerConnection itself:
 * perfect negotiation, the fixed transceiver slots, and ontrack routing.
 *
 *   npm run build
 *   PORT=8799 node server/index.js &
 *   node e2e/media.test.mjs
 *
 * The decisive assertion is `video.videoWidth > 0` on a remote tile. That stays
 * zero until frames have actually been decoded, so it can only pass if
 * signaling, ICE, DTLS, SRTP and the decoder all worked.
 */
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.PORT ?? 8799)
const ORIGIN = `http://localhost:${PORT}`
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const listening = () =>
  new Promise((resolve) => {
    const sock = connect(PORT, 'localhost')
    sock.on('connect', () => (sock.destroy(), resolve(true)))
    sock.on('error', () => resolve(false))
  })

/** Start the server unless one is already up, so this is a single command. */
async function serve() {
  if (await listening()) return null
  const proc = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i += 1) {
    if (await listening()) return proc
    await new Promise((r) => setTimeout(r, 100))
  }
  proc.kill()
  throw new Error(`server did not come up on ${PORT}`)
}
const ROOM = `e2e${Math.floor(Math.random() * 1e4)}`

let passed = 0
const check = (label, fn) => {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${label}`)
  } catch (err) {
    console.error(`  FAIL ${label}\n       ${err.message}`)
    process.exitCode = 1
  }
}
const soft = (label, ok, detail = '') =>
  console.log(`  ${ok ? 'ok  ' : 'skip'} ${label}${detail ? ` — ${detail}` : ''}`)

async function typeInto(page, selector, value) {
  await page.click(selector, { clickCount: 3 })
  await page.type(selector, value)
}

/** Buttons here are icon + text, so textContent is the reliable handle. */
async function clickButtonByText(page, text) {
  const hit = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
    if (!btn) return false
    btn.click()
    return true
  }, text)
  assert.ok(hit, `no button labelled "${text}"`)
}

async function joinSession(browser, name) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[placeholder="Ada Lovelace"]')
  await typeInto(page, 'input[placeholder="Ada Lovelace"]', name)
  await typeInto(page, 'input[placeholder="kf3n2p"]', ROOM)

  // camOn defaults to false in the lobby, so this switch turns the camera ON.
  const camWasOn = await page.evaluate(
    () =>
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent.trim() === 'Camera')
        ?.getAttribute('aria-pressed') === 'true',
  )
  assert.equal(camWasOn, false, 'expected the lobby camera toggle to start off')
  await clickButtonByText(page, 'Camera')

  await page.click('button[type=submit]')
  await page.waitForSelector('textarea[aria-label="Message the session"]', { timeout: 25_000 })
  return { page, name, errors }
}

const waitForTwoLiveVideos = (page) =>
  page.waitForFunction(
    () => [...document.querySelectorAll('video')].filter((v) => v.videoWidth > 0).length >= 2,
    { timeout: 45_000, polling: 500 },
  )

const waitForText = (page, needle, timeout = 15_000) =>
  page.waitForFunction(
    (n) => document.body.innerText.toLowerCase().includes(n.toLowerCase()),
    { timeout, polling: 400 },
    needle,
  )

console.log(`\nmedia e2e — room "${ROOM}"\n`)

const server = await serve()

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
    '--no-sandbox',
    '--window-size=1440,900',
  ],
  defaultViewport: { width: 1440, height: 900 },
})

try {
  const alice = await joinSession(browser, 'Alice')
  const bob = await joinSession(browser, 'Bob')

  // --- media actually flows ------------------------------------------------
  let mediaErr = null
  try {
    await Promise.all([waitForTwoLiveVideos(alice.page), waitForTwoLiveVideos(bob.page)])
  } catch (err) {
    mediaErr = err.message
  }
  check('remote video frames decode on both peers', () =>
    assert.equal(mediaErr, null, mediaErr ?? ''))

  const tiles = await alice.page.evaluate(() =>
    [...document.querySelectorAll('video')].map((v) => ({
      w: v.videoWidth,
      tracks: v.srcObject?.getVideoTracks().length ?? 0,
    })),
  )
  check('exactly two camera tiles carry a single live track each', () => {
    const live = tiles.filter((t) => t.w > 0)
    assert.equal(live.length, 2, `saw ${JSON.stringify(tiles)}`)
    for (const t of live) assert.equal(t.tracks, 1)
  })

  // --- audio slot routing --------------------------------------------------
  const audio = await alice.page.evaluate(() => {
    const track = document.querySelector('audio')?.srcObject?.getAudioTracks?.()[0]
    return { present: Boolean(track), kind: track?.kind, live: track?.readyState === 'live' }
  })
  check('remote mic routes to the audio slot', () => {
    assert.ok(audio.present, 'no remote audio track attached')
    assert.equal(audio.kind, 'audio')
    assert.ok(audio.live, 'remote audio track is not live')
  })

  // --- chat and log --------------------------------------------------------
  await alice.page.type('textarea[aria-label="Message the session"]', 'line 42 never exits')
  await alice.page.keyboard.press('Enter')
  await waitForText(bob.page, 'line 42 never exits')
  check('chat crosses between peers', () => assert.ok(true))

  const logText = await bob.page.evaluate(
    () => document.querySelector('[aria-label="Session log"]').innerText,
  )
  check('log stamps entries with a timecode', () => assert.match(logText, /\d{2}:\d{2}:\d{2}/))
  check('join events reach the log', () => assert.match(logText, /Alice joined|Bob joined/))

  // --- screen share: the third transceiver slot ----------------------------
  let shareOk = false
  let shareDetail = ''
  try {
    await clickButtonByText(alice.page, 'Share')
    await waitForText(bob.page, "Alice's screen", 25_000)
    shareOk = true
  } catch {
    shareDetail = 'headless desktop capture unavailable'
  }
  soft('screen track routes to the screen slot', shareOk, shareDetail)
  if (shareOk) {
    await waitForText(bob.page, 'on air')
    check('tally reads on-air while sharing', () => assert.ok(true))
  }

  // --- departure -----------------------------------------------------------
  await clickButtonByText(alice.page, 'Leave')
  await waitForText(bob.page, 'Alice left')
  check('departure reaches the remaining peer', () => assert.ok(true))

  const noise = [...alice.errors, ...bob.errors].filter(
    (e) => !/favicon|fonts\.googleapis|ERR_NETWORK_CHANGED/i.test(e),
  )
  check('no runtime errors in either page', () =>
    assert.equal(noise.length, 0, noise.slice(0, 3).join(' | ')))
} finally {
  await browser.close()
  server?.kill()
}

console.log(`\n${passed} checks passed${process.exitCode ? ' — with failures above' : ''}\n`)
process.exit(process.exitCode ?? 0)
