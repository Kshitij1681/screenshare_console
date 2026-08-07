/** Elapsed session time, always HH:MM:SS so columns of them stay aligned. */
export function timecode(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

export function initials(name) {
  const parts = String(name).trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

/** Six-character session codes, ambiguous glyphs removed. */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function randomRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

export function normalizeRoomCode(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 24)
}

const SYSTEM_COPY = {
  join: (name) => `${name} joined`,
  leave: (name) => `${name} left`,
  'share-start': (name) => `${name} started sharing`,
  'share-stop': (name) => `${name} stopped sharing`,
  hand: (name) => `${name} raised a hand`,
}

export function systemText(entry) {
  const write = SYSTEM_COPY[entry.event]
  return write ? write(entry.name) : `${entry.name} ${entry.event}`
}

/** Round-trip time to a 0–3 bar reading for the signal meter. */
export function signalBars({ rtt, packetsLostRatio }) {
  if (rtt == null) return 0
  if (rtt > 0.4 || packetsLostRatio > 0.08) return 1
  if (rtt > 0.18 || packetsLostRatio > 0.03) return 2
  return 3
}

export function describeError(err) {
  if (!err) return null
  switch (err.name) {
    case 'NotAllowedError':
      return 'Permission denied. Allow access in your browser, then try again.'
    case 'NotFoundError':
      return 'No matching device found.'
    case 'NotReadableError':
      return 'The device is already in use by another app.'
    case 'OverconstrainedError':
      return 'No device matches the requested quality.'
    default:
      return err.message || 'Something went wrong reaching your devices.'
  }
}
