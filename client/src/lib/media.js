/** Device acquisition, kept separate so the session hook stays about state. */

export async function getMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  return stream.getAudioTracks()[0] ?? null
}

export async function getCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  })
  const track = stream.getVideoTracks()[0] ?? null
  // Faces tolerate blur far better than they tolerate stutter.
  if (track && 'contentHint' in track) track.contentHint = 'motion'
  return track
}

export async function getScreen() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 60 } },
    audio: false,
  })
  const track = stream.getVideoTracks()[0] ?? null
  // These sessions are for reading code, so keep text legible over smoothness.
  if (track && 'contentHint' in track) track.contentHint = 'detail'
  return track
}

export function stopTrack(track) {
  try {
    track?.stop()
  } catch {
    /* already ended */
  }
}

export function supportsScreenShare() {
  return typeof navigator?.mediaDevices?.getDisplayMedia === 'function'
}

/**
 * Mic level meter, 0–1, driven by requestAnimationFrame. Used for the signal
 * check in the lobby and the speaking ring on tiles.
 */
export function createLevelMeter(track) {
  if (!track) return null
  const Ctx = window.AudioContext ?? window.webkitAudioContext
  if (!Ctx) return null

  const ctx = new Ctx()
  const source = ctx.createMediaStreamSource(new MediaStream([track]))
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.75
  source.connect(analyser)

  const buffer = new Uint8Array(analyser.frequencyBinCount)
  let frame = 0
  let stopped = false

  return {
    subscribe(cb) {
      const tick = () => {
        if (stopped) return
        analyser.getByteFrequencyData(buffer)
        let sum = 0
        for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i]
        const rms = Math.sqrt(sum / buffer.length) / 255
        cb(Math.min(1, rms * 2.6))
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(frame)
    },
    stop() {
      stopped = true
      cancelAnimationFrame(frame)
      source.disconnect()
      ctx.close().catch(() => {})
    },
  }
}
