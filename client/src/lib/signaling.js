/**
 * WebSocket transport with backoff reconnect.
 *
 * The caller is expected to re-send `join` on every `open`, not just the first:
 * the server issues a fresh peer id per socket, so a reconnect re-enters the
 * room as a new participant. Callers must therefore tear down any existing peer
 * mesh when a second `welcome` arrives.
 */
// Same origin by default: the Vite proxy in dev and the Node server in
// production both serve /ws alongside the page. Set VITE_SIGNALING_URL at build
// time when the front end lives somewhere that cannot hold a socket open — a
// static host like Vercel — pointing at wherever signaling actually runs.
const SIGNALING_ORIGIN = (import.meta.env.VITE_SIGNALING_URL ?? '').trim()

export function createSignaling({ onMessage, onStatus }) {
  let ws = null
  let attempt = 0
  let closedByUs = false
  let retryTimer = null

  const url = () => {
    if (SIGNALING_ORIGIN) {
      // Accept either scheme, so the env var can be pasted straight from the
      // host's dashboard: https://signal.example.com → wss://signal.example.com/ws
      const u = new URL(SIGNALING_ORIGIN)
      if (u.protocol === 'https:') u.protocol = 'wss:'
      if (u.protocol === 'http:') u.protocol = 'ws:'
      if (u.pathname === '/') u.pathname = '/ws'
      return u.href
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}/ws`
  }

  const status = (s, detail) => onStatus?.(s, detail)

  function open() {
    clearTimeout(retryTimer)
    closedByUs = false
    status(attempt === 0 ? 'connecting' : 'reconnecting')

    ws = new WebSocket(url())

    ws.onopen = () => {
      attempt = 0
      status('open')
    }

    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      onMessage?.(msg)
    }

    ws.onclose = (ev) => {
      if (closedByUs) return status('closed')
      // 1008 is our policy-violation code: retrying will fail the same way.
      if (ev.code === 1008) return status('rejected', ev.reason)
      attempt += 1
      const delay = Math.min(500 * 2 ** (attempt - 1), 8000)
      status('reconnecting', { attempt, delay })
      retryTimer = setTimeout(open, delay)
    }

    ws.onerror = () => {
      /* onclose always follows; handled there. */
    }
  }

  return {
    connect: open,
    send(payload) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload))
        return true
      }
      return false
    },
    close() {
      closedByUs = true
      clearTimeout(retryTimer)
      ws?.close(1000, 'left')
      ws = null
    },
  }
}
