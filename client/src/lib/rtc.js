/**
 * Full-mesh peer connections: every participant dials every other participant.
 * Fine to about six people, which is why the server caps the room there.
 *
 * Two decisions worth knowing about before changing anything here.
 *
 * 1. Fixed transceiver slots, owned by one side. Each connection carries exactly
 *    three transceivers in a fixed order — mic, camera, screen — and only the
 *    peer with the lower id creates them. The other adopts the ones the offer
 *    brings with it. Both sides calling addTransceiver does not pair the m-lines
 *    up; it produces six, and every incoming track then lands in a transceiver
 *    the receiver has no reference to. Roles are therefore resolved by m-line
 *    position rather than object identity. Turning a camera on or starting a
 *    share stays a plain `replaceTrack` on an existing sender: no new SDP.
 *
 * 2. Perfect negotiation. Both sides may fire negotiationneeded at once, so the
 *    peer with the higher id is "polite" and yields; the impolite one ignores
 *    the colliding offer. Deterministic without a coin flip.
 */

const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

const ROLES = ['mic', 'cam', 'screen']

export function createMesh({ selfId, send, onTrack, onStatus, onStats }) {
  const peers = new Map()
  /** Latest local tracks, replayed onto any peer that joins later. */
  let published = { mic: null, cam: null, screen: null }
  let statsTimer = null

  function ensurePeer(id) {
    const existing = peers.get(id)
    if (existing) return existing

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' })
    // Exactly one side builds the slots, or the m-lines double up.
    const owner = selfId < id
    const rec = {
      id,
      pc,
      polite: selfId > id,
      owner,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      lastBytes: 0,
      lastSampleAt: 0,
    }
    peers.set(id, rec)

    if (owner) {
      rec.tx = {
        mic: pc.addTransceiver('audio', { direction: 'sendrecv' }),
        cam: pc.addTransceiver('video', { direction: 'sendrecv' }),
        screen: pc.addTransceiver('video', { direction: 'sendrecv' }),
      }
    }

    pc.onnegotiationneeded = async () => {
      try {
        rec.makingOffer = true
        await pc.setLocalDescription()
        send({ to: id, data: { description: pc.localDescription } })
      } catch (err) {
        console.warn('[rtc] offer failed', id, err)
      } finally {
        rec.makingOffer = false
      }
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) send({ to: id, data: { candidate } })
    }

    pc.ontrack = (ev) => {
      const role = roleOf(rec, ev.transceiver)
      if (!role) return
      const stream = new MediaStream([ev.track])
      const report = () => onTrack?.(id, role, { stream, muted: ev.track.muted })
      // replaceTrack(null) on the far side mutes rather than ends the track,
      // so mute state is how we learn a camera or share actually stopped.
      ev.track.onmute = report
      ev.track.onunmute = report
      ev.track.onended = () => onTrack?.(id, role, null)
      report()
    }

    pc.onconnectionstatechange = () => {
      onStatus?.(id, pc.connectionState)
      // Let one side own the recovery attempt, or both restart at once.
      if (pc.connectionState === 'failed' && !rec.polite) pc.restartIce()
    }

    // Replay whatever we are already sending onto the new connection.
    applyPublished(rec)
    return rec
  }

  /**
   * Slots are identified by m-line order, which both sides agree on once the
   * offer is applied. `mid` is null until then, so fall back to creation order.
   */
  function slots(rec) {
    if (rec.tx) return rec.tx
    const tx = rec.pc.getTransceivers()
    if (tx.length < 3) return null
    rec.tx = { mic: tx[0], cam: tx[1], screen: tx[2] }
    return rec.tx
  }

  function roleOf(rec, transceiver) {
    const tx = slots(rec)
    return tx ? ROLES.find((r) => tx[r] === transceiver) : null
  }

  function applyPublished(rec) {
    const tx = slots(rec)
    if (!tx) return
    for (const role of ROLES) {
      tx[role].sender.replaceTrack(published[role] ?? null).catch(() => {})
    }
  }

  async function handleSignal(from, data) {
    if (!data) return
    const rec = ensurePeer(from)
    const { pc } = rec

    try {
      if (data.description) {
        const ready =
          !rec.makingOffer && (pc.signalingState === 'stable' || rec.settingRemoteAnswer)
        const collision = data.description.type === 'offer' && !ready

        rec.ignoreOffer = !rec.polite && collision
        if (rec.ignoreOffer) return

        rec.settingRemoteAnswer = data.description.type === 'answer'
        // Passing an offer while we hold one rolls ours back implicitly.
        await pc.setRemoteDescription(data.description)
        rec.settingRemoteAnswer = false

        if (data.description.type === 'offer') {
          // Transceivers created from a remote offer arrive recvonly. Upgrade
          // them and attach our tracks now, so the answer we are about to build
          // already advertises sendrecv and no second round trip is needed.
          const tx = slots(rec)
          if (tx) {
            for (const role of ROLES) {
              if (tx[role].direction !== 'sendrecv') tx[role].direction = 'sendrecv'
            }
            applyPublished(rec)
          }
          await pc.setLocalDescription()
          send({ to: from, data: { description: pc.localDescription } })
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate)
        } catch (err) {
          if (!rec.ignoreOffer) throw err
        }
      }
    } catch (err) {
      console.warn('[rtc] signal failed', from, err)
    }
  }

  /** Swap local tracks across every connection without touching SDP. */
  function publish(next) {
    published = { ...published, ...next }
    for (const rec of peers.values()) applyPublished(rec)
  }

  function drop(id) {
    const rec = peers.get(id)
    if (!rec) return
    rec.pc.onnegotiationneeded = null
    rec.pc.onicecandidate = null
    rec.pc.ontrack = null
    rec.pc.onconnectionstatechange = null
    rec.pc.close()
    peers.delete(id)
  }

  async function sample(rec) {
    const report = await rec.pc.getStats()
    let rtt = null
    let lost = 0
    let received = 0
    let bytes = 0

    report.forEach((s) => {
      if (s.type === 'candidate-pair' && s.nominated && s.currentRoundTripTime != null) {
        rtt = s.currentRoundTripTime
      }
      if (s.type === 'inbound-rtp') {
        lost += s.packetsLost ?? 0
        received += s.packetsReceived ?? 0
        bytes += s.bytesReceived ?? 0
      }
    })

    const now = performance.now()
    const seconds = rec.lastSampleAt ? (now - rec.lastSampleAt) / 1000 : 0
    const kbps = seconds > 0 ? Math.max(0, ((bytes - rec.lastBytes) * 8) / 1000 / seconds) : 0
    rec.lastBytes = bytes
    rec.lastSampleAt = now

    const packets = lost + received
    return {
      rtt,
      packetsLostRatio: packets > 0 ? lost / packets : 0,
      kbps: Math.round(kbps),
    }
  }

  function startStats(intervalMs = 2000) {
    stopStats()
    statsTimer = setInterval(async () => {
      for (const rec of peers.values()) {
        try {
          onStats?.(rec.id, await sample(rec))
        } catch {
          /* connection closed mid-sample */
        }
      }
    }, intervalMs)
  }

  function stopStats() {
    clearInterval(statsTimer)
    statsTimer = null
  }

  return {
    ensurePeer,
    handleSignal,
    publish,
    drop,
    startStats,
    stopStats,
    destroy() {
      stopStats()
      for (const id of [...peers.keys()]) drop(id)
      published = { mic: null, cam: null, screen: null }
    },
  }
}
