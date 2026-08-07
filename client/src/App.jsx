import { useEffect, useState } from 'react'
import { useSession } from './lib/useSession.js'
import { normalizeRoomCode } from './lib/format.js'
import { Lobby } from './components/Lobby.jsx'
import { SessionView } from './components/SessionView.jsx'

/** Session code lives in the URL hash so a link is all you need to share. */
function readHash() {
  return normalizeRoomCode(location.hash.replace(/^#\/?/, ''))
}

export default function App() {
  const session = useSession()
  const { phase, join, setMic, setCam, room } = session
  const [initialRoom] = useState(readHash)
  const [pending, setPending] = useState(null)

  useEffect(() => {
    if (phase === 'live' && room) history.replaceState(null, '', `#${room}`)
  }, [phase, room])

  // Carry the lobby's device choices into the session once the socket is live.
  useEffect(() => {
    if (phase !== 'live' || !pending) return
    setMic(pending.micOn)
    if (pending.camOn) setCam(true)
    setPending(null)
  }, [phase, pending, setMic, setCam])

  if (phase === 'ended') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 bg-ink-0 px-6 text-center">
        <span className="eyebrow">session closed</span>
        <h1 className="font-display text-[26px] font-semibold tracking-tight">You left the session.</h1>
        <button
          type="button"
          onClick={() => location.reload()}
          className="bg-txt-0 px-4 py-2.5 text-[14px] font-medium text-ink-0 transition-opacity hover:opacity-90"
          style={{ borderRadius: 3 }}
        >
          Rejoin
        </button>
      </div>
    )
  }

  if (phase === 'live') return <SessionView session={session} />

  return (
    <Lobby
      initialRoom={initialRoom}
      notice={session.notice}
      connecting={phase === 'joining'}
      onJoin={(opts) => {
        setPending(opts)
        join(opts)
      }}
    />
  )
}
