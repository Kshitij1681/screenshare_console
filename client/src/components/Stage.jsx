import { PeerTile, Video } from './Media.jsx'

/**
 * The stage gives the shared screen everything it can. When nobody is sharing it
 * falls back to a camera grid, and when nothing is on at all it says what to do
 * rather than sitting empty.
 */
export function Stage({ presenter, presenterStream, peers, self, selfState, localStreams }) {
  if (presenter && presenterStream) {
    return (
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-ink-0 p-2 sm:p-3">
        <div
          className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black"
          style={{ borderRadius: 3, boxShadow: '0 0 0 1px var(--color-line)' }}
        >
          {/* contain, never cover: cropping someone's editor is not acceptable. */}
          <Video stream={presenterStream} contain />
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-2">
            <span className="eyebrow pulse-tally rounded-sm bg-tally px-1.5 py-1 text-[9px] text-ink-0">
              live
            </span>
            <span className="mono rounded-sm bg-ink-0/75 px-2 py-1 text-[11px] text-txt-0">
              {presenter.isSelf ? 'your screen' : `${presenter.name}'s screen`}
            </span>
          </div>
        </div>
      </div>
    )
  }

  const cameras = [
    ...(selfState.camOn && localStreams.cam
      ? [{ id: self?.id, name: self?.name, color: self?.color, stream: localStreams.cam, isSelf: true, state: selfState }]
      : []),
    ...peers.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      stream: p.media.cam?.muted === false ? p.media.cam.stream : null,
      state: p.state,
      conn: p.conn,
      isSelf: false,
    })),
  ]

  const withVideo = cameras.filter((c) => c.stream)

  if (withVideo.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-ink-0 px-6 text-center">
        <span className="eyebrow">stage empty</span>
        <p className="max-w-[42ch] text-[14px] leading-relaxed text-txt-1">
          Share a screen to put it here. Cameras fill the stage when no screen is live.
        </p>
      </div>
    )
  }

  const cols = withVideo.length === 1 ? 1 : withVideo.length <= 4 ? 2 : 3

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-ink-0 p-2 sm:p-3">
      <div
        className="grid h-full auto-rows-fr gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {withVideo.map((c) => (
          <PeerTile key={c.id} {...c} live={false} />
        ))}
      </div>
    </div>
  )
}

/** Filmstrip under the stage: everyone in the room, presenter marked with tally. */
export function PeerRail({ peers, self, selfState, localStreams, presenterId }) {
  const tiles = [
    {
      id: self?.id,
      name: self?.name,
      color: self?.color,
      stream: selfState.camOn ? localStreams.cam : null,
      state: selfState,
      isSelf: true,
    },
    ...peers.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      stream: p.media.cam?.muted === false ? p.media.cam.stream : null,
      state: p.state,
      conn: p.conn,
      isSelf: false,
    })),
  ]

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-line bg-ink-1 px-3 py-2.5">
      {tiles.map((t) => (
        <PeerTile key={t.id} {...t} live={t.id === presenterId} compact />
      ))}
    </div>
  )
}

/** Emoji reactions drifting up over the stage. */
export function ReactionLayer({ reactions }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center" aria-hidden>
      {reactions.map((r, i) => (
        <span
          key={r.key}
          className="float-up absolute text-[26px]"
          style={{ left: `${42 + ((i * 11) % 18)}%` }}
        >
          {r.emoji}
        </span>
      ))}
    </div>
  )
}
