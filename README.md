# Console

Multi-user screen sharing with a session log, for small technical working sessions —
pair debugging, code review, design critique. 2–6 people, peer-to-peer video.

## Run it

```bash
npm run install:all   # once
npm run dev
```

Client on `http://localhost:5173`, signaling server on `:8787`. Open the client in
two tabs, join the same session code, and share a screen from one of them.

The session code lives in the URL hash (`#design-review`), so a link is all you
need to send someone.

```bash
npm run build         # client → client/dist
npm start             # serves that build + signaling from :8787
npm test              # protocol suite — starts its own server
npm run test:e2e      # two real browsers exchanging live media
```

## How it works

**Signaling** (`server/index.js`) is a WebSocket relay. It routes SDP and ICE
between named peers, holds the last 200 log entries so late joiners get history,
and owns the session clock. It never touches media.

**Media** (`client/src/lib/rtc.js`) is a full mesh — each peer dials every other
peer, which is why the room caps at six.

Each peer connection carries exactly three transceivers in a fixed order:

| slot | mid | carries |
|------|-----|---------|
| 0 | `"0"` | microphone |
| 1 | `"1"` | camera |
| 2 | `"2"` | screen |

**Only the lower-id peer creates them.** The other adopts the transceivers the
offer brings with it, upgrades them from `recvonly` to `sendrecv`, and attaches
its own tracks before building the answer — so there is no extra round trip. If
both sides called `addTransceiver` you would get six m-lines, not three, and
every inbound track would land somewhere the receiver can't identify.

Roles resolve by m-line position, which both sides agree on once the offer is
applied. Muting, turning the camera off, and starting a share are then
`replaceTrack` calls on an existing sender, so **no toggle triggers
renegotiation** — the usual source of mid-call stalls.

Negotiation uses the [perfect negotiation][pn] pattern for later changes.
Politeness is derived by comparing peer IDs, so both sides independently agree
on who yields.

[pn]: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation

## The session log

Chat and system events share one timeline, and every line is stamped with
**elapsed session time** rather than wall clock:

```
00:00:00  Aya joined
00:04:03  aya   line 42 — that retry loop never exits
00:04:31  you   scroll up, the guard is above the fence
00:06:12  Aya started sharing
```

In a working session the useful coordinate is "fourteen minutes in," not
"9:41 PM." Timecodes come from the server, so they're consistent for everyone
regardless of clock skew.

## Design

Video engineering gear, not a meeting app. Graphite surfaces, hairline rules
instead of floating cards, monospace for anything that is data.

Two colors carry meaning and appear nowhere else:

- **`--tally` `#FF3B2F`** — the tally light. On air, the border on whoever holds
  the floor, Leave.
- **`--signal` `#4DD8C0`** — signal health and focus rings.

Type is Inter Tight (UI), JetBrains Mono (data), Inter (chat body). All tokens
live in `client/src/styles.css`.

The screen share renders `object-fit: contain`, never `cover` — cropping
someone's editor to fill a tile defeats the point.

## Verified

- `npm run build` — clean
- 24 protocol checks: join handshake, peer fan-out, targeted signal relay
  (confirmed bystanders receive nothing), chat trimming and attribution, state
  broadcast, log timecodes, room cap, room-code normalization, departure
- Client and server room-code normalization cross-checked on nine inputs,
  including 24-char truncation

- 9 media checks in two real Chromium instances with fake capture devices
  (`npm run test:e2e`): remote frames actually decoding on both sides, one live
  track per tile, mic routed to the audio slot, screen track routed to the screen
  slot, tally reading on-air while sharing, chat and join/leave crossing the
  wire, and zero runtime errors in either page
- Four-peer mesh spot-checked via `npm run diagnose 4` — every tile decoding

This suite caught a real defect: both peers called `addTransceiver`, so m-lines
never paired and each side ended up with six transceivers instead of three. All
inbound media landed on remote-created transceivers that role lookup couldn't
match, and every track was silently dropped — with `connectionState` reporting
`connected` and no error thrown. Slots are now created by the lower-id peer only
and adopted from the offer by the other; roles resolve by m-line position.

**Still unverified:** NAT traversal beyond STUN. Roughly 10–15% of real-world
network pairs need a TURN relay, and there is none configured. The e2e run is
loopback, so it never exercises that path.

## Deploying

The mesh works without a TURN server only when peers can reach each other
directly. Roughly 10–15% of real-world connections need a relay, so add TURN
credentials in `client/src/lib/rtc.js` before putting this in front of anyone:

```js
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:your-turn-host:3478', username: '…', credential: '…' },
]
```

Two other things to know before this faces the internet. **There is no
authentication** — anyone with a session code joins, and codes are guessable, so
put auth in front of `join` if sessions are sensitive. And the log is held in
memory only: restarting the server clears every session.
