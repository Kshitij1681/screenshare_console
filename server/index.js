import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import {
  MAX_PEERS,
  addPeer,
  allowMessage,
  appendLog,
  defaultState,
  elapsed,
  getRoom,
  publicPeer,
  removePeer,
  sanitizeName,
  sanitizeRoom,
  sanitizeText,
  stats,
} from "./rooms.js";

const PORT = Number(process.env.PORT ?? 9000);
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../client/dist");

// When the front end is hosted apart from signaling — a static host like Vercel
// serving the build while this process runs elsewhere — the socket arrives
// cross-origin. Browsers do not apply CORS to WebSocket handshakes, so the check
// has to happen here. Unset means allow any origin, which is right for local dev.
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

function originAllowed(origin) {
  if (ALLOWED_ORIGINS.length === 0) return true;
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ""));
}

const app = express();
app.get("/healthz", (req, res) => {
  const origin = req.get("origin");
  if (origin && originAllowed(origin)) res.set("Access-Control-Allow-Origin", origin);
  res.json({ ok: true, ...stats() });
});
// Serving the built client is optional; in dev, Vite owns the front end.
app.use(express.static(clientDist));
app.get("*", (_req, res, next) => {
  res.sendFile(path.join(clientDist, "index.html"), (err) => (err ? next() : undefined));
});

const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 256 * 1024,
  verifyClient: ({ origin }) => originAllowed(origin),
});

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(room, payload, { except } = {}) {
  for (const peer of room.peers.values()) {
    if (peer.id === except) continue;
    send(peer.ws, payload);
  }
}

wss.on("connection", (ws) => {
  // Populated by the first valid `join`; until then the socket can do nothing else.
  let session = null;
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  const fail = (code, message) => {
    send(ws, { type: "error", code, message });
    ws.close(1008, code);
  };

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return fail("bad_json", "Message was not valid JSON.");
    }
    if (!msg || typeof msg.type !== "string") return fail("bad_shape", "Message needs a type.");

    if (msg.type === "join") {
      if (session) return fail("already_joined", "This socket already joined a session.");
      const roomId = sanitizeRoom(msg.room);
      if (!roomId) return fail("bad_room", "A session code is required.");

      const room = getRoom(roomId);
      const { peer, error } = addPeer(room, { ws, name: msg.name });
      if (error) return fail(error.code, error.message);
      session = { room, peer };

      const joined = appendLog(room, { kind: "system", event: "join", name: peer.name, color: peer.color });
      send(ws, {
        type: "welcome",
        self: publicPeer(peer),
        room: roomId,
        capacity: MAX_PEERS,
        startedAt: room.startedAt,
        serverNow: Date.now(),
        elapsed: elapsed(room),
        peers: [...room.peers.values()].filter((p) => p.id !== peer.id).map(publicPeer),
        log: room.log,
      });
      broadcast(room, { type: "peer-joined", peer: publicPeer(peer), entry: joined }, { except: peer.id });
      return;
    }

    if (!session) return fail("not_joined", "Join a session before sending anything else.");
    const { room, peer } = session;

    switch (msg.type) {
      // Opaque SDP/ICE payload, relayed to exactly one peer.
      case "signal": {
        const target = room.peers.get(msg.to);
        if (!target || target.id === peer.id) return;
        send(target.ws, { type: "signal", from: peer.id, data: msg.data });
        return;
      }

      case "chat": {
        const text = sanitizeText(msg.text);
        if (!text) return;
        if (!allowMessage(peer)) {
          send(ws, { type: "error", code: "rate_limited", message: "Slow down a moment." });
          return;
        }
        const entry = appendLog(room, {
          kind: "chat",
          from: peer.id,
          name: peer.name,
          color: peer.color,
          text,
        });
        broadcast(room, { type: "chat", entry });
        return;
      }

      case "state": {
        const patch = msg.patch ?? {};
        const next = { ...peer.state };
        for (const key of Object.keys(defaultState())) {
          if (typeof patch[key] === "boolean") next[key] = patch[key];
        }
        const startedSharing = !peer.state.sharing && next.sharing;
        const stoppedSharing = peer.state.sharing && !next.sharing;
        const raisedHand = !peer.state.handRaised && next.handRaised;
        peer.state = next;

        broadcast(room, { type: "state", id: peer.id, state: next });

        // Only share and hand changes are worth a line in the log; mic and
        // camera toggles would drown it.
        const event = startedSharing ? "share-start" : stoppedSharing ? "share-stop" : raisedHand ? "hand" : null;
        if (event) {
          const entry = appendLog(room, { kind: "system", event, name: peer.name, color: peer.color });
          broadcast(room, { type: "system", entry });
        }
        return;
      }

      case "typing": {
        broadcast(room, { type: "typing", id: peer.id, typing: msg.typing === true }, { except: peer.id });
        return;
      }

      case "reaction": {
        const emoji = sanitizeText(msg.emoji).slice(0, 8);
        if (!emoji || !allowMessage(peer)) return;
        broadcast(room, { type: "reaction", id: peer.id, name: peer.name, emoji, at: Date.now() });
        return;
      }

      default:
        return;
    }
  });

  ws.on("close", () => {
    if (!session) return;
    const { room, peer } = session;
    session = null;
    removePeer(room, peer.id);
    if (room.peers.size === 0) return;
    const entry = appendLog(room, { kind: "system", event: "leave", name: peer.name, color: peer.color });
    broadcast(room, { type: "peer-left", id: peer.id, entry });
  });

  ws.on("error", () => ws.terminate());
});

// Drop sockets that stop answering, so peers do not linger in the rail.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`[console] signaling on ws://localhost:${PORT}/ws`);
});
