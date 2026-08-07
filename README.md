# Console

Multi-user screen sharing with a session log, for small technical working sessions —
pair debugging, code review, design critique. 2–6 people, peer-to-peer video.

## Run it

```bash
npm run install:all   # once
npm run dev
```

Client on `http://localhost:5173`, signaling server on `:9000`. Open the client in
two tabs, join the same session code, and share a screen from one of them.

The session code lives in the URL hash (`#design-review`), so a link is all you
need to send someone.

```bash
npm run build         # client → client/dist
npm start             # serves that build + signaling from :9000
npm test              # protocol suite — starts its own server
npm run test:e2e      # two real browsers exchanging live media
npm run test:deploy   # the split-origin topology you get on Vercel
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
- 3 origin-allowlist checks against a separately configured server: listed
  origin accepted, unlisted refused, missing `Origin` refused
- Client and server room-code normalization cross-checked on nine inputs,
  including 24-char truncation

- 9 media checks in two real Chromium instances with fake capture devices
  (`npm run test:e2e`): remote frames actually decoding on both sides, one live
  track per tile, mic routed to the audio slot, screen track routed to the screen
  slot, tally reading on-air while sharing, chat and join/leave crossing the
  wire, and zero runtime errors in either page
- Four-peer mesh spot-checked via `npm run diagnose 4` — every tile decoding
- 6 split-origin checks (`npm run test:deploy`): the bundle served from one
  origin, signaling on another with `ALLOWED_ORIGINS` set, media decoding and
  chat crossing between two peers, and a page on an unlisted origin refused.
  This is the Vercel topology rehearsed locally, so the deploy steps below are
  tested rather than assumed

This suite caught a real defect: both peers called `addTransceiver`, so m-lines
never paired and each side ended up with six transceivers instead of three. All
inbound media landed on remote-created transceivers that role lookup couldn't
match, and every track was silently dropped — with `connectionState` reporting
`connected` and no error thrown. Slots are now created by the lower-id peer only
and adopted from the offer by the other; roles resolve by m-line position.

**Still unverified:** NAT traversal beyond STUN. Roughly 10–15% of real-world
network pairs need a TURN relay, and there is none configured. Every test here
runs on one machine — the split-origin suite proves the two-host *wiring* (build
variable, `ws` rewrite, origin allowlist), not that two peers behind real NATs
can reach each other. That still needs TURN and two actual networks.

## Deploying

This is two deployables, not one: a static bundle and a long-lived WebSocket
process. **Vercel can host the first but not the second** — its functions are
request-scoped and cannot hold a socket open for the length of a session. So the
front end goes to Vercel and `server/` goes somewhere that runs a persistent
Node process (Render, Railway, Fly, a VM).

**1. Signaling, on a host that keeps processes alive.** Root directory `server`,
start command `npm start`. It reads `PORT` from the environment. Set
`ALLOWED_ORIGINS` to your Vercel URL — browsers do not apply CORS to WebSocket
handshakes, so without this the relay accepts sockets from any page on the
internet:

```
ALLOWED_ORIGINS=https://your-app.vercel.app
```

Comma-separate to add preview domains. Leaving it unset allows every origin,
which is the right default for local dev and the wrong one in production.

**2. Client, on Vercel.** `vercel.json` already pins the build (`client/dist`,
with an SPA rewrite so `#session-code` links resolve). Import the repo and add
one environment variable:

```
VITE_SIGNALING_URL=https://your-signaling-host.example.com
```

`client/src/lib/signaling.js` rewrites that to `wss://…/ws`. Unset, the client
talks to its own origin, so `npm run dev` and `npm start` keep working untouched.
It is a build-time variable: changing it needs a redeploy, not just a restart.

Both halves must be HTTPS. `getDisplayMedia` and `getUserMedia` only exist in a
secure context, and an `https:` page is not allowed to open a plain `ws:` socket
— it will be blocked as mixed content, so the signaling host needs a real
certificate rather than a bare IP.

`npm run test:deploy` rehearses exactly this arrangement on localhost, so you can
confirm both variables are right before pointing anyone at the deployed URL.

**TURN is still required for real users.** The mesh connects without a relay only
when peers can reach each other directly. Roughly 10–15% of real-world
connections cannot, so add TURN credentials in `client/src/lib/rtc.js` before
putting this in front of anyone:

```js
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:your-turn-host:3478', username: '…', credential: '…' },
]
```

Static credentials in that file ship inside the bundle and are readable by
anyone who loads the page, which lets strangers relay traffic on your account.
For anything beyond a private test, have the signaling server hand out
short-lived HMAC-derived credentials instead and fetch them before dialling.

Two other things to know before this faces the internet. **There is no
authentication** — anyone with a session code joins, and codes are guessable, so
put auth in front of `join` if sessions are sensitive. And the log is held in
memory only: restarting the server clears every session, and it does not survive
running more than one signaling instance — keep it to a single process, or move
room state out of memory first.
