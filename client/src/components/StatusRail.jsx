import { useEffect, useState } from 'react'
import { signalBars, timecode } from '../lib/format.js'
import { Check, Copy, Log } from './Icons.jsx'
import { CopyButton } from './Media.jsx'

/** Live session clock. Driven off the server's start time plus a clock offset. */
function Timecode({ clock }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  const elapsed = clock.startedAt ? now + clock.offset - clock.startedAt : 0
  return (
    <span className="mono text-[13px] tabular-nums text-txt-0" aria-label="Session elapsed time">
      {timecode(elapsed)}
    </span>
  )
}

/** Worst signal across peers, shown as three bars. */
function SignalMeter({ peers }) {
  const readings = peers.map((p) => signalBars(p.stats ?? {})).filter((b) => b > 0)
  const bars = readings.length ? Math.min(...readings) : 0
  const color = bars >= 3 ? 'var(--color-signal)' : bars === 2 ? 'var(--color-amber)' : 'var(--color-tally)'
  const label = bars === 0 ? 'no data' : bars >= 3 ? 'good' : bars === 2 ? 'fair' : 'poor'

  return (
    <span className="flex items-center gap-2" title={`Connection ${label}`}>
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[5, 8, 11].map((h, i) => (
          <span
            key={h}
            className="w-[3px] rounded-sm transition-colors"
            style={{ height: h, background: i < bars ? color : 'var(--color-ink-4)' }}
          />
        ))}
      </span>
      <span className="eyebrow">{label}</span>
    </span>
  )
}

export function StatusRail({ room, clock, peers, capacity, live, logOpen, onToggleLog }) {
  const count = peers.length + 1

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-ink-1 px-3 sm:px-4">
      <span className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${live ? 'pulse-tally' : ''}`}
          style={{ background: live ? 'var(--color-tally)' : 'var(--color-ink-4)' }}
          aria-hidden
        />
        <span className="eyebrow" style={{ color: live ? 'var(--color-tally)' : undefined }}>
          {live ? 'on air' : 'standby'}
        </span>
      </span>

      <span className="h-4 w-px bg-line" aria-hidden />

      <CopyButton
        value={room}
        className="group flex items-center gap-1.5 text-txt-1 transition-colors hover:text-txt-0"
      >
        {(copied) => (
          <>
            <span className="mono text-[12px] tracking-[0.1em]">{room}</span>
            {copied ? (
              <Check width={13} height={13} className="text-signal" />
            ) : (
              <Copy width={13} height={13} className="opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </>
        )}
      </CopyButton>

      <span className="h-4 w-px bg-line" aria-hidden />
      <Timecode clock={clock} />

      <div className="ml-auto flex items-center gap-3 sm:gap-4">
        <span className="hidden sm:block">
          <SignalMeter peers={peers} />
        </span>
        <span className="mono text-[12px] text-txt-1">
          {count}
          <span className="text-txt-2">/{capacity}</span>
        </span>
        <button
          type="button"
          onClick={onToggleLog}
          aria-pressed={logOpen}
          aria-label={logOpen ? 'Hide session log' : 'Show session log'}
          className={`flex h-7 w-7 items-center justify-center border transition-colors lg:hidden ${
            logOpen ? 'border-line-bright bg-ink-3 text-txt-0' : 'border-line text-txt-2'
          }`}
          style={{ borderRadius: 3 }}
        >
          <Log width={15} height={15} />
        </button>
      </div>
    </header>
  )
}
