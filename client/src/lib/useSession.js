import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSignaling } from './signaling.js'
import { createMesh } from './rtc.js'
import { getCamera, getMic, getScreen, stopTrack } from './media.js'
import { describeError } from './format.js'

const EMPTY_MEDIA = { mic: null, cam: null, screen: null }

/**
 * Owns the whole session: transport, peer mesh, local devices, and the log.
 *
 * Devices are acquired in the lobby and carried into the session, so joining
 * never triggers a second permission prompt.
 */
export function useSession() {
  const [phase, setPhase] = useState('lobby') // lobby | joining | live | ended
  const [link, setLink] = useState('idle')
  const [self, setSelf] = useState(null)
  const [room, setRoom] = useState('')
  const [capacity, setCapacity] = useState(6)
  const [peers, setPeers] = useState(() => new Map())
  const [log, setLog] = useState([])
  const [typing, setTyping] = useState(() => new Set())
  const [reactions, setReactions] = useState([])
  const [clock, setClock] = useState({ startedAt: 0, offset: 0 })
  const [notice, setNotice] = useState(null)
  const [devices, setDevices] = useState({ micOn: false, camOn: false })
  const [sharing, setSharing] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const [localStreams, setLocalStreams] = useState({ cam: null, screen: null })

  const sig = useRef(null)
  const mesh = useRef(null)
  const tracks = useRef({ mic: null, cam: null, screen: null })
  const typingTimer = useRef({ sentAt: 0, idle: null })

  const patchPeer = useCallback((id, patch) => {
    setPeers((prev) => {
      const cur = prev.get(id)
      if (!cur) return prev
      const next = new Map(prev)
      next.set(id, { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) })
      return next
    })
  }, [])

  const publishLocal = useCallback(() => {
    mesh.current?.publish({ ...tracks.current })
  }, [])

  const sendState = useCallback((patch) => {
    sig.current?.send({ type: 'state', patch })
  }, [])

  /* ---------- devices ---------- */

  const setMic = useCallback(
    async (on) => {
      try {
        if (on && !tracks.current.mic) tracks.current.mic = await getMic()
        if (tracks.current.mic) tracks.current.mic.enabled = on
        setDevices((d) => ({ ...d, micOn: on }))
        publishLocal()
        sendState({ micOn: on })
      } catch (err) {
        setNotice({ tone: 'error', text: describeError(err) })
      }
    },
    [publishLocal, sendState],
  )

  const setCam = useCallback(
    async (on) => {
      try {
        if (on) {
          if (!tracks.current.cam) tracks.current.cam = await getCamera()
          setLocalStreams((s) => ({ ...s, cam: new MediaStream([tracks.current.cam]) }))
        } else {
          stopTrack(tracks.current.cam)
          tracks.current.cam = null
          setLocalStreams((s) => ({ ...s, cam: null }))
        }
        setDevices((d) => ({ ...d, camOn: on }))
        publishLocal()
        sendState({ camOn: on })
      } catch (err) {
        setNotice({ tone: 'error', text: describeError(err) })
      }
    },
    [publishLocal, sendState],
  )

  const stopShare = useCallback(() => {
    stopTrack(tracks.current.screen)
    tracks.current.screen = null
    setLocalStreams((s) => ({ ...s, screen: null }))
    setSharing(false)
    publishLocal()
    sendState({ sharing: false })
  }, [publishLocal, sendState])

  const startShare = useCallback(async () => {
    try {
      const track = await getScreen()
      if (!track) return
      tracks.current.screen = track
      // The browser's own "Stop sharing" bar bypasses our UI entirely.
      track.addEventListener('ended', stopShare, { once: true })
      setLocalStreams((s) => ({ ...s, screen: new MediaStream([track]) }))
      setSharing(true)
      publishLocal()
      sendState({ sharing: true })
    } catch (err) {
      // Cancelling the picker is a normal outcome, not a failure worth showing.
      if (err?.name !== 'NotAllowedError') setNotice({ tone: 'error', text: describeError(err) })
    }
  }, [publishLocal, sendState, stopShare])

  const toggleShare = useCallback(() => (sharing ? stopShare() : startShare()), [sharing, startShare, stopShare])

  const toggleHand = useCallback(() => {
    setHandRaised((prev) => {
      const next = !prev
      sendState({ handRaised: next })
      return next
    })
  }, [sendState])

  /* ---------- inbound messages ---------- */

  const handleMessage = useCallback(
    (msg) => {
      switch (msg.type) {
        case 'welcome': {
          setSelf(msg.self)
          setRoom(msg.room)
          setCapacity(msg.capacity)
          setLog(msg.log ?? [])
          // Trust the server's clock for the session timecode.
          setClock({ startedAt: msg.startedAt, offset: msg.serverNow - Date.now() })
          setPeers(
            new Map(
              (msg.peers ?? []).map((p) => [p.id, { ...p, media: { ...EMPTY_MEDIA }, conn: 'new', stats: null }]),
            ),
          )
          setPhase('live')

          // A reconnect replays `join` and lands here again with a fresh peer
          // id, so tear down the previous mesh or its connections leak and the
          // old identity keeps sending.
          mesh.current?.destroy()
          mesh.current = createMesh({
            selfId: msg.self.id,
            send: ({ to, data }) => sig.current?.send({ type: 'signal', to, data }),
            onTrack: (id, role, payload) => patchPeer(id, (p) => ({ ...p, media: { ...p.media, [role]: payload } })),
            onStatus: (id, conn) => patchPeer(id, { conn }),
            onStats: (id, stats) => patchPeer(id, { stats }),
          })
          mesh.current.startStats()
          publishLocal()
          for (const p of msg.peers ?? []) mesh.current.ensurePeer(p.id)
          return
        }

        case 'peer-joined': {
          setPeers((prev) => {
            const next = new Map(prev)
            next.set(msg.peer.id, { ...msg.peer, media: { ...EMPTY_MEDIA }, conn: 'new', stats: null })
            return next
          })
          if (msg.entry) setLog((l) => [...l, msg.entry])
          // The newcomer dials us; creating the connection here readies the slots.
          mesh.current?.ensurePeer(msg.peer.id)
          return
        }

        case 'peer-left': {
          mesh.current?.drop(msg.id)
          setPeers((prev) => {
            const next = new Map(prev)
            next.delete(msg.id)
            return next
          })
          setTyping((prev) => {
            if (!prev.has(msg.id)) return prev
            const next = new Set(prev)
            next.delete(msg.id)
            return next
          })
          if (msg.entry) setLog((l) => [...l, msg.entry])
          return
        }

        case 'signal':
          mesh.current?.handleSignal(msg.from, msg.data)
          return

        case 'chat':
        case 'system':
          setLog((l) => [...l, msg.entry])
          return

        case 'state':
          patchPeer(msg.id, { state: msg.state })
          return

        case 'typing':
          setTyping((prev) => {
            const next = new Set(prev)
            if (msg.typing) next.add(msg.id)
            else next.delete(msg.id)
            return next
          })
          return

        case 'reaction': {
          const key = `${msg.id}-${msg.at}-${Math.random().toString(36).slice(2, 7)}`
          setReactions((prev) => [...prev, { key, ...msg }])
          setTimeout(() => setReactions((prev) => prev.filter((r) => r.key !== key)), 2600)
          return
        }

        case 'error':
          setNotice({ tone: 'error', text: msg.message })
          return

        default:
          return
      }
    },
    [patchPeer, publishLocal],
  )

  /* ---------- join / leave ---------- */

  const join = useCallback(
    ({ name, room: roomCode }) => {
      setPhase('joining')
      setNotice(null)
      sig.current = createSignaling({
        onMessage: handleMessage,
        onStatus: (status, detail) => {
          setLink(status)
          if (status === 'open') {
            sig.current.send({ type: 'join', name, room: roomCode })
          } else if (status === 'rejected') {
            setPhase('lobby')
            setNotice({ tone: 'error', text: detail || 'The session refused the connection.' })
          } else if (status === 'reconnecting' && detail?.attempt > 1) {
            setNotice({ tone: 'warn', text: 'Connection dropped. Retrying.' })
          }
        },
      })
      sig.current.connect()
    },
    [handleMessage],
  )

  const leave = useCallback(() => {
    mesh.current?.destroy()
    mesh.current = null
    sig.current?.close()
    sig.current = null
    for (const key of ['mic', 'cam', 'screen']) {
      stopTrack(tracks.current[key])
      tracks.current[key] = null
    }
    setLocalStreams({ cam: null, screen: null })
    setPeers(new Map())
    setTyping(new Set())
    setSharing(false)
    setHandRaised(false)
    setDevices({ micOn: false, camOn: false })
    setPhase('ended')
  }, [])

  useEffect(
    () => () => {
      mesh.current?.destroy()
      sig.current?.close()
      for (const key of ['mic', 'cam', 'screen']) stopTrack(tracks.current[key])
    },
    [],
  )

  /* ---------- chat ---------- */

  const sendChat = useCallback((text) => {
    const clean = text.trim()
    if (!clean) return false
    sig.current?.send({ type: 'chat', text: clean })
    sig.current?.send({ type: 'typing', typing: false })
    typingTimer.current.sentAt = 0
    clearTimeout(typingTimer.current.idle)
    return true
  }, [])

  // Send `typing: true` at most every two seconds, and always retract it.
  const notifyTyping = useCallback(() => {
    const now = Date.now()
    if (now - typingTimer.current.sentAt > 2000) {
      sig.current?.send({ type: 'typing', typing: true })
      typingTimer.current.sentAt = now
    }
    clearTimeout(typingTimer.current.idle)
    typingTimer.current.idle = setTimeout(() => {
      sig.current?.send({ type: 'typing', typing: false })
      typingTimer.current.sentAt = 0
    }, 2500)
  }, [])

  const react = useCallback((emoji) => sig.current?.send({ type: 'reaction', emoji }), [])

  /* ---------- derived ---------- */

  const peerList = useMemo(() => [...peers.values()], [peers])

  const presenter = useMemo(() => {
    if (sharing) return { id: self?.id, name: self?.name, color: self?.color, isSelf: true }
    const p = peerList.find((x) => x.state?.sharing)
    return p ? { ...p, isSelf: false } : null
  }, [peerList, sharing, self])

  const typingNames = useMemo(
    () => peerList.filter((p) => typing.has(p.id)).map((p) => p.name),
    [peerList, typing],
  )

  const selfState = useMemo(
    () => ({ ...devices, sharing, handRaised }),
    [devices, sharing, handRaised],
  )

  return {
    phase,
    link,
    self,
    selfState,
    room,
    capacity,
    peers: peerList,
    log,
    typingNames,
    reactions,
    clock,
    notice,
    localStreams,
    presenter,
    dismissNotice: () => setNotice(null),
    setMic,
    setCam,
    toggleShare,
    toggleHand,
    join,
    leave,
    sendChat,
    notifyTyping,
    react,
  }
}
