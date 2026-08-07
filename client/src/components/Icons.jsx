/* Line icons at a single 1.6px weight, matching the hairline rules. */

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export const MicOn = (p) => (
  <svg {...base} {...p}>
    <path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3Z" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
)

export const MicOff = (p) => (
  <svg {...base} {...p}>
    <path d="M9 9v3a3 3 0 0 0 4.6 2.5M15 11.5V7a3 3 0 0 0-5.1-2.1" />
    <path d="M5 11a7 7 0 0 0 10.7 6M19 11v1M12 18v3" />
    <path d="m4 3 16 18" />
  </svg>
)

export const CamOn = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="6" width="12" height="12" rx="2" />
    <path d="m15 11 6-3.5v9L15 13z" />
  </svg>
)

export const CamOff = (p) => (
  <svg {...base} {...p}>
    <path d="M3 8v8a2 2 0 0 0 2 2h8M15 12.5V16M15 8.5 21 5v9" />
    <path d="m4 3 16 18" />
  </svg>
)

export const Screen = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="1.5" />
    <path d="M9 20h6M12 16.5V20" />
    <path d="m12 8-2.5 2.5M12 8l2.5 2.5M12 8v5" />
  </svg>
)

export const ScreenStop = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="1.5" />
    <path d="M9 20h6M12 16.5V20" />
    <path d="M9.5 10.5h5" />
  </svg>
)

export const Hand = (p) => (
  <svg {...base} {...p}>
    <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11m0 0V4.5a1.5 1.5 0 0 1 3 0V11m0 0V6.5a1.5 1.5 0 0 1 3 0V13a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 5 13.5V11a1.5 1.5 0 0 1 3 0" />
  </svg>
)

export const Leave = (p) => (
  <svg {...base} {...p}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 8 6 12l4 4M6 12h9" />
  </svg>
)

export const Send = (p) => (
  <svg {...base} {...p}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
)

export const Copy = (p) => (
  <svg {...base} {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </svg>
)

export const Check = (p) => (
  <svg {...base} {...p}>
    <path d="m5 13 4.5 4.5L19 7" />
  </svg>
)

export const Collapse = (p) => (
  <svg {...base} {...p}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export const Log = (p) => (
  <svg {...base} {...p}>
    <path d="M4 6h10M4 12h16M4 18h7" />
  </svg>
)

export const Pin = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3v7M8.5 10h7l1.5 4H7z" />
    <path d="M12 14v7" />
  </svg>
)
