import { randomUUID } from 'node:crypto'

export const MAX_PEERS = 6
export const LOG_LIMIT = 250

// One slot per peer, so a name always maps to the same colour in the rail,
// the log, and the tile border.
const PEER_COLORS = ['#4DD8C0', '#7FA8FF', '#C792EA', '#F2A93B', '#FF7A8A', '#69D97A']

const rooms = new Map()

const shortId = () => randomUUID().slice(0, 8)

export function sanitizeName(raw) {
  const clean = String(raw ?? '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 24)
  return clean || 'Guest'
}

/**
 * Room codes get their own sanitizer, deliberately without a fallback value:
 * an empty code must stay empty so the caller can reject it, rather than
 * quietly funnelling everyone into one shared room.
 */
export function sanitizeRoom(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 24)
}

export function sanitizeText(raw) {
  // Newlines survive so multi-line pastes keep their shape in the log.
  return String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 2000)
}

export function defaultState() {
  return { micOn: true, camOn: false, sharing: false, handRaised: false }
}

function claimColor(room) {
  const taken = new Set([...room.peers.values()].map((p) => p.color))
  return PEER_COLORS.find((c) => !taken.has(c)) ?? PEER_COLORS[0]
}

export function getRoom(id) {
  let room = rooms.get(id)
  if (!room) {
    room = { id, startedAt: Date.now(), peers: new Map(), log: [] }
    rooms.set(id, room)
  }
  return room
}

export function elapsed(room) {
  return Date.now() - room.startedAt
}

/** Returns { peer } on success, or { error } if the room cannot take another peer. */
export function addPeer(room, { ws, name }) {
  if (room.peers.size >= MAX_PEERS) {
    return {
      error: { code: 'room_full', message: `This session is capped at ${MAX_PEERS} people.` },
    }
  }
  const peer = {
    id: shortId(),
    name: sanitizeName(name),
    color: claimColor(room),
    state: defaultState(),
    ws,
    alive: true,
    quota: { tokens: 12, refilledAt: Date.now() },
  }
  room.peers.set(peer.id, peer)
  return { peer }
}

export function removePeer(room, peerId) {
  const peer = room.peers.get(peerId)
  room.peers.delete(peerId)
  if (room.peers.size === 0) rooms.delete(room.id)
  return peer
}

/** Public shape of a peer — never leaks the socket or quota bookkeeping. */
export function publicPeer(peer) {
  return { id: peer.id, name: peer.name, color: peer.color, state: peer.state }
}

export function appendLog(room, entry) {
  const full = { id: shortId(), t: elapsed(room), ...entry }
  room.log.push(full)
  if (room.log.length > LOG_LIMIT) room.log.splice(0, room.log.length - LOG_LIMIT)
  return full
}

/** Token bucket: 12 messages in reserve, refilling one per second. */
export function allowMessage(peer) {
  const now = Date.now()
  const refill = Math.floor((now - peer.quota.refilledAt) / 1000)
  if (refill > 0) {
    peer.quota.tokens = Math.min(12, peer.quota.tokens + refill)
    peer.quota.refilledAt = now
  }
  if (peer.quota.tokens <= 0) return false
  peer.quota.tokens -= 1
  return true
}

export function stats() {
  let peers = 0
  for (const room of rooms.values()) peers += room.peers.size
  return { rooms: rooms.size, peers }
}
