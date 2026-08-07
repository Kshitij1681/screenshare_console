import { CamOff, CamOn, Hand, Leave, MicOff, MicOn, Screen, ScreenStop } from './Icons.jsx'

const REACTIONS = ['👍', '🎉', '👀', '❓']

function Control({ label, active, danger, onClick, children, disabled }) {
  const tone = danger
    ? 'border-tally/50 bg-tally/10 text-tally hover:bg-tally/20'
    : active
      ? 'border-line-bright bg-ink-3 text-txt-0'
      : 'border-line bg-ink-1 text-txt-1 hover:border-line-bright hover:text-txt-0'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={danger ? undefined : active}
      aria-label={label}
      title={label}
      className={`flex h-10 items-center gap-2 border px-3 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}
      style={{ borderRadius: 3 }}
    >
      {children}
    </button>
  )
}

export function ControlBar({ state, onMic, onCam, onShare, onHand, onReact, onLeave, shareSupported }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line bg-ink-1 px-3 py-2.5">
      <Control label={state.micOn ? 'Mute microphone' : 'Unmute microphone'} active={state.micOn} onClick={() => onMic(!state.micOn)}>
        {state.micOn ? <MicOn /> : <MicOff className="text-tally" />}
        <span className="hidden sm:inline">{state.micOn ? 'Mic' : 'Muted'}</span>
      </Control>

      <Control label={state.camOn ? 'Turn camera off' : 'Turn camera on'} active={state.camOn} onClick={() => onCam(!state.camOn)}>
        {state.camOn ? <CamOn /> : <CamOff />}
        <span className="hidden sm:inline">Camera</span>
      </Control>

      <Control
        label={state.sharing ? 'Stop sharing your screen' : 'Share your screen'}
        active={state.sharing}
        danger={state.sharing}
        disabled={!shareSupported}
        onClick={onShare}
      >
        {state.sharing ? <ScreenStop /> : <Screen />}
        <span className="hidden sm:inline">{state.sharing ? 'Stop share' : 'Share'}</span>
      </Control>

      <Control label={state.handRaised ? 'Lower hand' : 'Raise hand'} active={state.handRaised} onClick={onHand}>
        <Hand className={state.handRaised ? 'text-amber' : undefined} />
      </Control>

      <div className="ml-1 hidden items-center gap-1 border-l border-line pl-2 sm:flex">
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            aria-label={`React ${emoji}`}
            className="flex h-9 w-9 items-center justify-center text-[16px] transition-transform hover:scale-115"
            style={{ borderRadius: 3 }}
          >
            {emoji}
          </button>
        ))}
      </div>

      <div className="ml-auto">
        <Control label="Leave session" danger onClick={onLeave}>
          <Leave />
          <span className="hidden sm:inline">Leave</span>
        </Control>
      </div>
    </div>
  )
}
