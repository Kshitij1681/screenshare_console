import { useEffect, useRef, useState } from 'react'
import { initials } from '../lib/format.js'
import { MicOff, Hand } from './Icons.jsx'

/** Attaches a MediaStream to a video element and keeps it attached across swaps. */
function useStream(stream) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream ?? null
    if (stream) el.play?.().catch(() => {})
  }, [stream])
  return ref
}

export function Video({ stream, mirror = false, contain = false, className = '' }) {
  const ref = useStream(stream)
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={`h-full w-full ${contain ? 'object-contain' : 'object-cover'} ${
        mirror ? '-scale-x-100' : ''
      } ${className}`}
    />
  )
}

/**
 * Remote audio lives outside the tile layout on purpose: if these elements
 * unmounted when tiles reflowed, audio would cut out mid-sentence.
 */
export function AudioSink({ peers }) {
  return (
    <div className="sr-only" aria-hidden>
      {peers.map((p) => (
        <RemoteAudio key={p.id} stream={p.media.mic?.stream} />
      ))}
    </div>
  )
}

function RemoteAudio({ stream }) {
  const ref = useStream(stream)
  return <audio ref={ref} autoPlay playsInline />
}

export function Avatar({ name, color, size = 40 }) {
  return (
    <div
      className="mono flex shrink-0 items-center justify-center rounded-full font-medium"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        color,
        background: `color-mix(in oklab, ${color} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 38%, transparent)`,
      }}
    >
      {initials(name)}
    </div>
  )
}

/**
 * One participant. `live` draws the tally border — this source is on air.
 */
export function PeerTile({ name, color, stream, state, isSelf, live, conn, compact = false }) {
  const hasVideo = Boolean(stream)
  const muted = state?.micOn === false

  return (
    <div
      className={`group relative shrink-0 overflow-hidden bg-ink-1 transition-shadow ${
        compact ? 'h-[104px] w-[168px]' : 'aspect-video w-full'
      }`}
      style={{
        borderRadius: 3,
        boxShadow: live
          ? `0 0 0 1px var(--color-tally), 0 0 20px -6px var(--color-tally)`
          : `0 0 0 1px var(--color-line)`,
      }}
    >
      {hasVideo ? (
        <Video stream={stream} mirror={isSelf} />
      ) : (
        <div className="no-signal flex h-full w-full items-center justify-center">
          <Avatar name={name} color={color} size={compact ? 34 : 52} />
        </div>
      )}

      {conn === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-0/55">
          <span className="eyebrow text-amber">connecting</span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-ink-0/90 to-transparent px-2 pb-1.5 pt-6">
        {muted && <MicOff width={12} height={12} className="shrink-0 text-tally" />}
        {state?.handRaised && <Hand width={12} height={12} className="shrink-0 text-amber" />}
        <span className="mono truncate text-[11px] text-txt-0/90">{isSelf ? 'You' : name}</span>
      </div>

      {live && (
        <span className="eyebrow pulse-tally absolute left-2 top-2 rounded-sm bg-tally px-1.5 py-0.5 text-[9px] text-ink-0">
          live
        </span>
      )}
    </div>
  )
}

/** Copy-to-clipboard control used for the session code. */
export function CopyButton({ value, children, className = '' }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
        } catch {
          setCopied(false)
        }
      }}
      className={className}
      aria-label={copied ? 'Copied' : 'Copy session code'}
    >
      {children(copied)}
    </button>
  )
}
