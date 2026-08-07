import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { systemText, timecode } from '../lib/format.js'
import { Send } from './Icons.jsx'

/**
 * The session log. Chat and system events share one timeline, and every line is
 * stamped with elapsed session time rather than wall clock — "00:14:22" is the
 * coordinate people actually use when referring back to something.
 */

function Stamp({ t }) {
  return (
    <span className="mono shrink-0 select-none text-[11px] leading-5 text-txt-2/70 tabular-nums">
      {timecode(t)}
    </span>
  )
}

function SystemLine({ entry }) {
  return (
    <li className="flex gap-3 px-4 py-1">
      <Stamp t={entry.t} />
      <span className="flex items-center gap-1.5 text-[12px] leading-5 text-txt-2">
        <span className="inline-block h-1 w-1 shrink-0 rounded-full" style={{ background: entry.color }} />
        {systemText(entry)}
      </span>
    </li>
  )
}

function ChatLine({ entry, isSelf, showAuthor }) {
  return (
    <li className={`flex gap-3 px-4 ${showAuthor ? 'pt-2.5' : 'pt-0.5'}`}>
      <Stamp t={entry.t} />
      <div className="min-w-0 flex-1">
        {showAuthor && (
          <span
            className="mono block text-[11px] font-medium leading-5"
            style={{ color: isSelf ? 'var(--color-txt-1)' : entry.color }}
          >
            {isSelf ? 'you' : entry.name}
          </span>
        )}
        <p className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.55] text-txt-0/95">
          {entry.text}
        </p>
      </div>
    </li>
  )
}

function TypingLine({ names }) {
  if (names.length === 0) return null
  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : `${names.length} people are typing`
  return (
    <li className="flex gap-3 px-4 py-1.5">
      <span className="mono shrink-0 text-[11px] leading-5 text-txt-2/40">··:··:··</span>
      <span className="text-[12px] leading-5 text-txt-2 italic">{label}</span>
    </li>
  )
}

export function SessionLog({ log, selfId, typingNames, onSend, onTyping }) {
  const [draft, setDraft] = useState('')
  const scroller = useRef(null)
  const pinned = useRef(true)
  const textarea = useRef(null)

  // Only auto-scroll when the reader is already at the bottom, so scrolling
  // back through the log is not yanked away by new messages.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [log, typingNames])

  useEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [draft])

  function submit() {
    if (onSend(draft)) setDraft('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
        className="min-h-0 flex-1 overflow-y-auto py-3"
        aria-live="polite"
        aria-label="Session log"
      >
        {log.length === 0 && (
          <li className="px-4 py-6">
            <p className="text-[13px] leading-relaxed text-txt-2">
              Nothing logged yet. Messages and session events land here, stamped with the time they
              happened.
            </p>
          </li>
        )}

        {log.map((entry, i) => {
          if (entry.kind === 'system') return <SystemLine key={entry.id} entry={entry} />
          const prev = log[i - 1]
          const showAuthor =
            !prev || prev.kind !== 'chat' || prev.from !== entry.from || entry.t - prev.t > 120_000
          return (
            <ChatLine
              key={entry.id}
              entry={entry}
              isSelf={entry.from === selfId}
              showAuthor={showAuthor}
            />
          )
        })}

        <TypingLine names={typingNames} />
      </ul>

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textarea}
            value={draft}
            rows={1}
            onChange={(e) => {
              setDraft(e.target.value)
              if (e.target.value.trim()) onTyping()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="Message the session"
            aria-label="Message the session"
            className="max-h-[132px] min-h-[40px] flex-1 resize-none border border-line bg-ink-1 px-3 py-2.5 text-[13.5px] leading-[1.5] text-txt-0 placeholder:text-txt-2/70 focus:border-line-bright"
            style={{ borderRadius: 3 }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center border border-line bg-ink-2 text-txt-1 transition-colors hover:border-line-bright hover:text-txt-0 disabled:opacity-30"
            style={{ borderRadius: 3 }}
          >
            <Send width={16} height={16} />
          </button>
        </div>
        <p className="eyebrow mt-2 px-0.5">enter to send · shift+enter for a new line</p>
      </div>
    </div>
  )
}
