/**
 * Protocol smoke test. Starts its own server unless one is already listening:
 *   npm test
 *
 * Covers the paths the browser depends on: join handshake, peer fan-out,
 * one-to-one signal relay, chat log ordering, state broadcast, and the room cap.
 */
import { WebSocket } from 'ws'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PORT = Number(process.env.PORT ?? 8787)
const URL = `ws://localhost:${PORT}/ws`
const ROOM = `test-${Math.random().toString(36).slice(2, 8)}`
const here = dirname(fileURLToPath(import.meta.url))

const listening = () =>
  new Promise((resolve) => {
    const sock = connect(PORT, 'localhost')
    sock.on('connect', () => (sock.destroy(), resolve(true)))
    sock.on('error', () => resolve(false))
  })

async function serve() {
  if (await listening()) return null
  const proc = spawn(process.execPath, [join(here, 'index.js')], {
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

const server = await serve()

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

function client(name, room = ROOM) {
  const ws = new WebSocket(URL)
  const inbox = []
  const waiters = []

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw)
    inbox.push(msg)
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].match(msg)) {
        waiters[i].resolve(msg)
        waiters.splice(i, 1)
      }
    }
  })

  const api = {
    ws,
    inbox,
    send: (payload) => ws.send(JSON.stringify(payload)),
    // Resolve from history first, so a message that already landed still counts.
    wait: (type, timeout = 4000) =>
      new Promise((resolve, reject) => {
        const match = (m) => m.type === type
        const found = inbox.find(match)
        if (found) return resolve(found)
        const timer = setTimeout(() => reject(new Error(`timeout waiting for "${type}"`)), timeout)
        waiters.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m)) })
      }),
    open: () =>
      new Promise((resolve, reject) => {
        ws.once('open', resolve)
        ws.once('error', reject)
      }),
    join: () => api.send({ type: 'join', name, room }),
    close: () => ws.close(),
  }
  return api
}

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

console.log(`\nprotocol test — room "${ROOM}"\n`)

// --- handshake -------------------------------------------------------------
const alice = client('Alice')
await alice.open()
alice.join()
const welcome = await alice.wait('welcome')

check('welcome carries an identity', () => assert.ok(welcome.self.id))
check('welcome carries a colour', () => assert.match(welcome.self.color, /^#[0-9a-f]{6}$/i))
check('first peer sees an empty room', () => assert.equal(welcome.peers.length, 0))
check('welcome carries clock data', () => {
  assert.ok(welcome.startedAt > 0)
  assert.ok(welcome.serverNow > 0)
})
check('join is logged', () => {
  const entry = welcome.log.at(-1)
  assert.equal(entry.kind, 'system')
  assert.equal(entry.event, 'join')
})
check('log stamps elapsed time, not wall clock', () => assert.ok(welcome.log.at(-1).t < 10_000))

// --- second peer -----------------------------------------------------------
const bob = client('Bob')
await bob.open()
bob.join()
const bobWelcome = await bob.wait('welcome')
const announced = await alice.wait('peer-joined')

check('newcomer is told about the existing peer', () => {
  assert.equal(bobWelcome.peers.length, 1)
  assert.equal(bobWelcome.peers[0].id, welcome.self.id)
})
check('newcomer inherits the log', () => assert.ok(bobWelcome.log.length >= 1))
check('existing peer is notified', () => assert.equal(announced.peer.id, bobWelcome.self.id))
check('colours are distinct per peer', () =>
  assert.notEqual(welcome.self.color, bobWelcome.self.color))

// --- signal relay ----------------------------------------------------------
bob.send({ type: 'signal', to: welcome.self.id, data: { description: { type: 'offer', sdp: 'v=0' } } })
const relayed = await alice.wait('signal')

check('signal reaches the addressed peer', () => {
  assert.equal(relayed.from, bobWelcome.self.id)
  assert.equal(relayed.data.description.sdp, 'v=0')
})

const carol = client('Carol')
await carol.open()
carol.join()
await carol.wait('welcome')
await settle()
check('signal is not broadcast to bystanders', () =>
  assert.equal(carol.inbox.filter((m) => m.type === 'signal').length, 0))

// --- chat ------------------------------------------------------------------
alice.send({ type: 'chat', text: '  line 42 looks wrong  ' })
const chat = await bob.wait('chat')

check('chat text is trimmed', () => assert.equal(chat.entry.text, 'line 42 looks wrong'))
check('chat is attributed', () => {
  assert.equal(chat.entry.from, welcome.self.id)
  assert.equal(chat.entry.name, 'Alice')
})
check('chat carries a timecode', () => assert.equal(typeof chat.entry.t, 'number'))

alice.send({ type: 'chat', text: '   ' })
await settle()
check('empty chat is dropped', () =>
  assert.equal(bob.inbox.filter((m) => m.type === 'chat').length, 1))

// --- state -----------------------------------------------------------------
alice.send({ type: 'state', patch: { sharing: true, micOn: false } })
const state = await bob.wait('state')
const sysEntry = await bob.wait('system')

check('state broadcast reflects the patch', () => {
  assert.equal(state.state.sharing, true)
  assert.equal(state.state.micOn, false)
})
check('starting a share is logged', () => assert.equal(sysEntry.entry.event, 'share-start'))

alice.send({ type: 'state', patch: { camOn: true } })
await settle()
check('camera toggles are not logged', () => {
  const events = bob.inbox.filter((m) => m.type === 'system').map((m) => m.entry.event)
  assert.deepEqual(events, ['share-start'])
})

// --- guards ----------------------------------------------------------------
const stranger = client('Stranger')
await stranger.open()
stranger.send({ type: 'chat', text: 'hello?' })
const rejected = await stranger.wait('error')
check('chat before join is rejected', () => assert.equal(rejected.code, 'not_joined'))

const extras = []
for (let i = 0; i < 3; i += 1) {
  const c = client(`Extra${i}`)
  await c.open()
  c.join()
  await c.wait('welcome')
  extras.push(c)
}
const seventh = client('Seventh')
await seventh.open()
seventh.join()
const full = await seventh.wait('error')
check('room cap is enforced at six', () => assert.equal(full.code, 'room_full'))

// --- room codes ------------------------------------------------------------
const blank = client('Blank', '   ')
await blank.open()
blank.join()
const badRoom = await blank.wait('error')
check('blank room code is rejected, not coerced', () => assert.equal(badRoom.code, 'bad_room'))
blank.close()

const shouty = client('Shouty', '  Design-Review!! ')
await shouty.open()
shouty.join()
const shoutyWelcome = await shouty.wait('welcome')
check('room code is normalized', () => assert.equal(shoutyWelcome.room, 'design-review'))
shouty.close()

// --- departure -------------------------------------------------------------
carol.close()
const left = await bob.wait('peer-left')
check('departure is announced', () => assert.equal(left.entry.event, 'leave'))

for (const c of [alice, bob, ...extras]) c.close()
await settle(200)

console.log(`\n${passed} checks passed${process.exitCode ? ' — with failures above' : ''}\n`)
server?.kill()
process.exit(process.exitCode ?? 0)
