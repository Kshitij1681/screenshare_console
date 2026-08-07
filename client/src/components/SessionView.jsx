import { useEffect, useMemo, useState } from 'react'
import { supportsScreenShare } from '../lib/media.js'
import { AudioSink } from './Media.jsx'
import { PeerRail, ReactionLayer, Stage } from './Stage.jsx'
import { SessionLog } from './SessionLog.jsx'
import { ControlBar } from './ControlBar.jsx'
import { StatusRail } from './StatusRail.jsx'
import { Collapse } from './Icons.jsx'

export function SessionView({ session }) {
  const {
    self,
    selfState,
    room,
    capacity,
    peers,
    log,
    typingNames,
    reactions,
    clock,
    notice,
    localStreams,
    presenter,
    dismissNotice,
    setMic,
    setCam,
    toggleShare,
    toggleHand,
    leave,
    sendChat,
    notifyTyping,
    react,
  } = session

  // Docked by default on wide screens. Below that it is an overlay, so opening
  // it on join would bury the stage before anyone has seen it.
  const [logOpen, setLogOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const shareSupported = useMemo(supportsScreenShare, [])

  const presenterStream = presenter?.isSelf
    ? localStreams.screen
    : (peers.find((p) => p.id === presenter?.id)?.media.screen?.muted === false
        ? peers.find((p) => p.id === presenter?.id).media.screen.stream
        : null)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(dismissNotice, 6000)
    return () => clearTimeout(t)
  }, [notice, dismissNotice])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ink-0">
      <StatusRail
        room={room}
        clock={clock}
        peers={peers}
        capacity={capacity}
        live={Boolean(presenter)}
        logOpen={logOpen}
        onToggleLog={() => setLogOpen((v) => !v)}
      />

      {notice && (
        <div
          role="status"
          className={`flex shrink-0 items-center gap-2 border-b px-4 py-2 text-[13px] ${
            notice.tone === 'error'
              ? 'border-tally/40 bg-tally/10 text-txt-0'
              : 'border-amber/40 bg-amber/10 text-txt-0'
          }`}
        >
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={dismissNotice} className="eyebrow hover:text-txt-0">
            dismiss
          </button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <Stage
            presenter={presenter}
            presenterStream={presenterStream}
            peers={peers}
            self={self}
            selfState={selfState}
            localStreams={localStreams}
          />
          <ReactionLayer reactions={reactions} />
          {/* The rail is redundant while cameras already fill the stage. */}
          {presenter && (
            <PeerRail
              peers={peers}
              self={self}
              selfState={selfState}
              localStreams={localStreams}
              presenterId={presenter.id}
            />
          )}
          <ControlBar
            state={selfState}
            shareSupported={shareSupported}
            onMic={setMic}
            onCam={setCam}
            onShare={toggleShare}
            onHand={toggleHand}
            onReact={react}
            onLeave={leave}
          />
        </div>

        {/* Docked beside the stage on wide screens, an overlay sheet below.
            Anchored to the row, not the viewport, so the notice banner cannot
            push it out of alignment. */}
        <aside
          className={`flex w-full max-w-full flex-col border-line bg-ink-1 lg:w-[336px] lg:shrink-0 lg:border-l ${
            logOpen ? 'absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden'
          } lg:flex`}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-4">
            <span className="eyebrow">session log</span>
            <button
              type="button"
              onClick={() => setLogOpen(false)}
              aria-label="Hide session log"
              className="text-txt-2 transition-colors hover:text-txt-0 lg:hidden"
            >
              <Collapse width={16} height={16} />
            </button>
          </div>
          <SessionLog
            log={log}
            selfId={self?.id}
            typingNames={typingNames}
            onSend={sendChat}
            onTyping={notifyTyping}
          />
        </aside>
      </div>

      <AudioSink peers={peers} />
    </div>
  )
}
