import { useEffect, useMemo, useRef, useState } from 'react'
import { createLevelMeter, getCamera, getMic, stopTrack, supportsScreenShare } from '../lib/media.js'
import { describeError, normalizeRoomCode, randomRoomCode } from '../lib/format.js'
import { CamOff, CamOn, Check, Copy, MicOff, MicOn, Send } from './Icons.jsx'
import { CopyButton, Video } from './Media.jsx'

const SEGMENTS = 28

/** Broadcast-style VU meter. Segments light left to right, amber near clipping. */
function LevelMeter({ level, active }) {
  const lit = active ? Math.round(level * SEGMENTS) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="eyebrow shrink-0">input</span>
      <div className="flex h-3 flex-1 items-stretch gap-[2px]" role="meter" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Microphone level">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const on = i < lit
          const hot = i > SEGMENTS * 0.8
          return (
            <span
              key={i}
              className="flex-1 transition-opacity duration-75"
              style={{
                background: on ? (hot ? 'var(--color-amber)' : 'var(--color-signal)') : 'var(--color-ink-3)',
                opacity: on ? 1 : 0.55,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function Toggle({ on, onClick, iconOn: IconOn, iconOff: IconOff, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-center gap-2 border px-3 py-2 text-[13px] transition-colors ${
        on
          ? 'border-line-bright bg-ink-3 text-txt-0'
          : 'border-line bg-ink-1 text-txt-2 hover:text-txt-1'
      }`}
      style={{ borderRadius: 3 }}
    >
      {on ? <IconOn width={15} height={15} /> : <IconOff width={15} height={15} className="text-tally" />}
      {label}
    </button>
  )
}

export function Lobby({ onJoin, initialRoom, notice, connecting = false }) {
  const [name, setName] = useState(() => localStorage.getItem('console:name') ?? '')
  const [room, setRoom] = useState(() => initialRoom || randomRoomCode())
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(false)
  const [level, setLevel] = useState(0)
  const [camStream, setCamStream] = useState(null)
  const [deviceError, setDeviceError] = useState(null)

  const micTrack = useRef(null)
  const camTrack = useRef(null)
  const meter = useRef(null)

  // Preview devices are opened here and stopped on unmount; the session opens
  // its own, so there is exactly one prompt per device per page load.
  useEffect(() => {
    let cancelled = false
    if (!micOn) {
      meter.current?.stop()
      meter.current = null
      stopTrack(micTrack.current)
      micTrack.current = null
      setLevel(0)
      return
    }
    ;(async () => {
      try {
        const track = await getMic()
        if (cancelled) return stopTrack(track)
        micTrack.current = track
        meter.current = createLevelMeter(track)
        meter.current?.subscribe(setLevel)
      } catch (err) {
        if (!cancelled) {
          setDeviceError(describeError(err))
          setMicOn(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [micOn])

  useEffect(() => {
    let cancelled = false
    if (!camOn) {
      stopTrack(camTrack.current)
      camTrack.current = null
      setCamStream(null)
      return
    }
    ;(async () => {
      try {
        const track = await getCamera()
        if (cancelled) return stopTrack(track)
        camTrack.current = track
        setCamStream(new MediaStream([track]))
      } catch (err) {
        if (!cancelled) {
          setDeviceError(describeError(err))
          setCamOn(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [camOn])

  useEffect(
    () => () => {
      meter.current?.stop()
      stopTrack(micTrack.current)
      stopTrack(camTrack.current)
    },
    [],
  )

  const canJoin = name.trim().length > 0 && room.trim().length > 0 && !connecting
  const shareSupported = useMemo(supportsScreenShare, [])

  function submit(e) {
    e.preventDefault()
    if (!canJoin) return
    localStorage.setItem('console:name', name.trim())
    // Preview devices stay open until this component unmounts. Releasing them
    // here would leave a dead preview behind if the join is refused.
    onJoin({ name: name.trim(), room: normalizeRoomCode(room), micOn, camOn })
  }

  return (
    <div className="flex min-h-full flex-col bg-ink-0">
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-[15px] font-semibold tracking-tight">Console</span>
          <span className="eyebrow hidden sm:block">shared screen sessions</span>
        </div>
        <span className="eyebrow">{shareSupported ? 'ready' : 'no capture support'}</span>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-5 py-8 lg:flex-row lg:items-center lg:gap-14 lg:py-14">
        {/* Signal check — the hero. */}
        <section className="flex-1">
          <div className="mb-3 flex items-center justify-between">
            <span className="eyebrow">preview / local</span>
            <span className="eyebrow flex items-center gap-1.5">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: 'var(--color-ink-4)' }}
              />
              tally off
            </span>
          </div>

          <div
            className="no-signal relative aspect-video w-full overflow-hidden"
            style={{ borderRadius: 3, boxShadow: '0 0 0 1px var(--color-line)' }}
          >
            {camStream ? (
              <Video stream={camStream} mirror />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="eyebrow">camera off</span>
              </div>
            )}
          </div>

          <div className="mt-4">
            <LevelMeter level={level} active={micOn} />
          </div>
        </section>

        <section className="w-full lg:max-w-[380px]">
          <h1 className="font-display text-[34px] font-semibold leading-[1.08] tracking-tight sm:text-[40px]">
            Share a screen.
            <br />
            <span className="text-txt-2">Keep the thread.</span>
          </h1>
          <p className="mt-3 max-w-[38ch] text-[14px] leading-relaxed text-txt-1">
            Every message is stamped with session time, so “that thing fourteen minutes in” is
            something you can actually find afterwards.
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <label className="block">
              <span className="eyebrow">your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
                autoComplete="nickname"
                placeholder="Ada Lovelace"
                className="mt-1.5 w-full border border-line bg-ink-1 px-3 py-2.5 text-[14px] text-txt-0 placeholder:text-txt-2/70 focus:border-line-bright"
                style={{ borderRadius: 3 }}
              />
            </label>

            <label className="block">
              <span className="eyebrow">session code</span>
              <div className="mt-1.5 flex gap-2">
                <div className="relative flex-1">
                  <input
                    value={room}
                    onChange={(e) => setRoom(normalizeRoomCode(e.target.value))}
                    maxLength={24}
                    placeholder="kf3n2p"
                    className="mono w-full border border-line bg-ink-1 py-2.5 pl-3 pr-10 text-[14px] tracking-[0.12em] text-txt-0 placeholder:text-txt-2/70 focus:border-line-bright"
                    style={{ borderRadius: 3 }}
                  />
                  <CopyButton
                    value={room}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-txt-2 transition-colors hover:text-txt-0"
                  >
                    {(copied) =>
                      copied ? <Check width={15} height={15} className="text-signal" /> : <Copy width={15} height={15} />
                    }
                  </CopyButton>
                </div>
                <button
                  type="button"
                  onClick={() => setRoom(randomRoomCode())}
                  className="eyebrow border border-line bg-ink-1 px-3 text-txt-1 transition-colors hover:border-line-bright hover:text-txt-0"
                  style={{ borderRadius: 3 }}
                >
                  new
                </button>
              </div>
            </label>

            <div className="flex gap-2">
              <Toggle on={micOn} onClick={() => setMicOn((v) => !v)} iconOn={MicOn} iconOff={MicOff} label="Mic" />
              <Toggle on={camOn} onClick={() => setCamOn((v) => !v)} iconOn={CamOn} iconOff={CamOff} label="Camera" />
            </div>

            {(deviceError || notice) && (
              <p className="border-l-2 border-tally bg-tally/5 px-3 py-2 text-[13px] text-txt-1">
                {notice?.text ?? deviceError}
              </p>
            )}

            <button
              type="submit"
              disabled={!canJoin}
              className="flex w-full items-center justify-center gap-2 bg-txt-0 px-4 py-3 text-[14px] font-medium text-ink-0 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              style={{ borderRadius: 3 }}
            >
              {connecting ? 'Connecting' : 'Join session'}
              {!connecting && <Send width={16} height={16} />}
            </button>

            <p className="text-[12px] leading-relaxed text-txt-2">
              Anyone with this code can join. Sessions hold up to six people.
            </p>
          </form>
        </section>
      </main>
    </div>
  )
}
