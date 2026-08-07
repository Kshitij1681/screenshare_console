/**
 * Split-deployment test: the bundle is served from one origin and signaling runs
 * on another, which is the shape you get hosting the client on Vercel.
 *
 *   node e2e/split-deploy.test.mjs
 *
 * Three things only break in this topology, so they are what this covers:
 * VITE_SIGNALING_URL reaching the built bundle, the http→ws rewrite in
 * signaling.js, and ALLOWED_ORIGINS on a cross-origin handshake. The static
 * host stands in for Vercel — same SPA rewrite as vercel.json, no proxy.
 */
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const SIGNAL_PORT = 8801
const STATIC_PORT = 8802
const STATIC_ORIGIN = `http://localhost:${STATIC_PORT}`
const SIGNAL_ORIGIN = `http://localhost:${SIGNAL_PORT}`
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'client', 'dist-split')
const ROOM = `split${Math.floor(Math.random() * 1e4)}`

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

const listening = (port) =>
  new Promise((resolve) => {
    const sock = connect(port, 'localhost')
    sock.on('connect', () => (sock.destroy(), resolve(true)))
    sock.on('error', () => resolve(false))
  })

async function waitFor(port) {
  for (let i = 0; i < 60; i += 1) {
    if (await listening(port)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`nothing came up on ${port}`)
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

/** Dumb static host with an SPA fallback — mirrors the rewrite in vercel.json. */
function staticHost() {
  return createServer(async (req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0])
    for (const candidate of [join(OUT, rel), join(OUT, 'index.html')]) {
      try {
        const body = await readFile(candidate)
        res.writeHead(200, { 'content-type': TYPES[extname(candidate)] ?? 'application/octet-stream' })
        return res.end(body)
      } catch {
        /* fall through to index.html */
      }
    }
    res.writeHead(404).end('not found')
  })
}

console.log(`\nsplit-deploy e2e — room "${ROOM}"\n`)

// A separate outDir keeps the normal same-origin build in client/dist intact.
execFileSync('npx', ['vite', 'build', '--outDir', 'dist-split'], {
  cwd: join(ROOT, 'client'),
  env: { ...process.env, VITE_SIGNALING_URL: SIGNAL_ORIGIN },
  stdio: 'ignore',
  shell: true,
})

const bundle = execFileSync('node', [
  '-e',
  `const fs=require('fs'),p=require('path');const d=p.join(${JSON.stringify(OUT)},'assets');` +
    `process.stdout.write(fs.readdirSync(d).filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(p.join(d,f),'utf8')).join(''))`,
]).toString()
check('the signaling override is baked into the bundle', () =>
  assert.ok(bundle.includes(`localhost:${SIGNAL_PORT}`)),
)

const signaling = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(SIGNAL_PORT), ALLOWED_ORIGINS: STATIC_ORIGIN },
  stdio: 'ignore',
})
const host = staticHost()
host.listen(STATIC_PORT)
await Promise.all([waitFor(SIGNAL_PORT), waitFor(STATIC_PORT)])

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--no-sandbox',
    '--window-size=1280,800',
  ],
  defaultViewport: { width: 1280, height: 800 },
})

async function joinFrom(name) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto(STATIC_ORIGIN, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[placeholder="Ada Lovelace"]')
  for (const [sel, val] of [
    ['input[placeholder="Ada Lovelace"]', name],
    ['input[placeholder="kf3n2p"]', ROOM],
  ]) {
    await page.click(sel, { clickCount: 3 })
    await page.type(sel, val)
  }
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Camera')?.click()
  })
  await page.click('button[type=submit]')
  await page.waitForSelector('textarea[aria-label="Message the session"]', { timeout: 25_000 })
  return { page, name, errors }
}

try {
  const alice = await joinFrom('Alice')
  const bob = await joinFrom('Bob')

  // The console only renders once `welcome` has come back over the socket, so
  // its presence on a page served from another origin is the real assertion.
  const opened = await Promise.all(
    [alice.page, bob.page].map((p) =>
      p.evaluate(() => ({
        origin: location.origin,
        inSession: !!document.querySelector('textarea[aria-label="Message the session"]'),
      })),
    ),
  )
  check('both peers joined from the static origin, not the signaling one', () => {
    for (const o of opened) {
      assert.equal(o.origin, STATIC_ORIGIN)
      assert.equal(o.inSession, true)
    }
  })

  let mediaErr = null
  try {
    await Promise.all(
      [alice.page, bob.page].map((p) =>
        p.waitForFunction(
          () => [...document.querySelectorAll('video')].filter((v) => v.videoWidth > 0).length >= 2,
          { timeout: 45_000, polling: 500 },
        ),
      ),
    )
  } catch (err) {
    mediaErr = err.message
  }
  check('media decodes on both peers across the split', () =>
    assert.equal(mediaErr, null, mediaErr ?? ''),
  )

  await bob.page.type('textarea[aria-label="Message the session"]', 'across two origins')
  await bob.page.keyboard.press('Enter')
  let chatErr = null
  try {
    await alice.page.waitForFunction(
      () => document.body.innerText.includes('across two origins'),
      { timeout: 15_000, polling: 400 },
    )
  } catch (err) {
    chatErr = err.message
  }
  check('chat crosses the split', () => assert.equal(chatErr, null, chatErr ?? ''))

  // The refused case: a page on an origin the server was not told about.
  const refused = await browser.newPage()
  await refused.goto(SIGNAL_ORIGIN, { waitUntil: 'domcontentloaded' }).catch(() => {})
  const blocked = await refused.evaluate(
    (url) =>
      new Promise((resolve) => {
        const ws = new WebSocket(url)
        ws.onopen = () => (ws.close(), resolve(false))
        ws.onerror = () => resolve(true)
        setTimeout(() => resolve(false), 5000)
      }),
    `ws://localhost:${SIGNAL_PORT}/ws`,
  )
  check('an unlisted origin is turned away', () => assert.equal(blocked, true))
  await refused.close()

  const errors = [...alice.errors, ...bob.errors]
  check('no runtime errors in either page', () => assert.deepEqual(errors, []))
} finally {
  await browser.close()
  host.close()
  signaling.kill()
}

console.log(`\n${passed} checks passed${process.exitCode ? ' — with failures above' : ''}\n`)
process.exit(process.exitCode ?? 0)
