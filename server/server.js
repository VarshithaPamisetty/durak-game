import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { createGame, applyAction, viewFor } from './game.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
app.use(express.static(join(__dirname, '..', 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

/**
 * rooms: Map<code, {
 *   code, hostId, options,
 *   players: [{ id, name }],
 *   sockets: Map<playerId, ws>,
 *   game: state | null,
 *   emptyTimer: Timeout | null
 * }>
 */
const rooms = new Map();
const EMPTY_ROOM_TTL = 1000 * 60 * 10; // keep a disconnected room alive 10 min for reconnects

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function send(ws, type, payload) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}

function broadcastRoom(room) {
  const inGame = !!room.game;
  for (const p of room.players) {
    const ws = room.sockets.get(p.id);
    if (!ws) continue;
    if (inGame) {
      send(ws, 'state', { view: viewFor(room.game, p.id), room: roomSummary(room) });
    } else {
      send(ws, 'lobby', { room: roomSummary(room) });
    }
  }
}

function roomSummary(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    options: room.options,
    started: !!room.game,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: room.sockets.has(p.id),
    })),
  };
}

function scheduleCleanup(room) {
  if (room.emptyTimer) clearTimeout(room.emptyTimer);
  room.emptyTimer = setTimeout(() => {
    if (room.sockets.size === 0) rooms.delete(room.code);
  }, EMPTY_ROOM_TTL);
}

wss.on('connection', (ws) => {
  ws.playerId = null;
  ws.roomCode = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    try {
      handleMessage(ws, msg);
    } catch (err) {
      send(ws, 'error', { message: err.message || 'Server error' });
    }
  });

  ws.on('close', () => {
    const room = ws.roomCode && rooms.get(ws.roomCode);
    if (!room || !ws.playerId) return;
    // Only drop the socket if it's still the current one for this player.
    if (room.sockets.get(ws.playerId) === ws) room.sockets.delete(ws.playerId);

    if (!room.game) {
      // Lobby: remove disconnected non-host players so the list stays clean.
      room.players = room.players.filter((p) => room.sockets.has(p.id) || p.id === room.hostId);
    }
    if (room.sockets.size === 0) {
      scheduleCleanup(room); // grace period for reconnects (refresh, sleep, etc.)
    } else {
      broadcastRoom(room);
    }
  });
});

// Detect dead sockets.
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'create': return onCreate(ws, msg);
    case 'join': return onJoin(ws, msg);
    case 'rejoin': return onRejoin(ws, msg);
    case 'start': return onStart(ws, msg);
    case 'action': return onAction(ws, msg);
    case 'rematch': return onRematch(ws, msg);
    case 'leave': return ws.close();
    default: send(ws, 'error', { message: 'Unknown message type.' });
  }
}

function attach(ws, room, playerId) {
  ws.playerId = playerId;
  ws.roomCode = room.code;
  room.sockets.set(playerId, ws);
  if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = null; }
}

function onCreate(ws, msg) {
  const name = (msg.name || '').trim().slice(0, 20) || 'Player';
  const maxPlayers = clamp(parseInt(msg.maxPlayers, 10) || 4, 2, 6);
  const handSize = clamp(parseInt(msg.handSize, 10) || 6, 1, 12);
  let deckSize = parseInt(msg.deckSize, 10) || 36;
  if (![20, 24, 36, 52].includes(deckSize)) deckSize = 36;

  const code = makeRoomCode();
  const playerId = randomUUID();
  const room = {
    code,
    hostId: playerId,
    options: { maxPlayers, handSize, deckSize, maxAttacks: Math.min(6, handSize) },
    players: [{ id: playerId, name }],
    sockets: new Map(),
    game: null,
    emptyTimer: null,
  };
  rooms.set(code, room);
  attach(ws, room, playerId);
  send(ws, 'joined', { playerId, code, you: { id: playerId, name } });
  broadcastRoom(room);
}

function onJoin(ws, msg) {
  const code = (msg.code || '').trim().toUpperCase();
  const name = (msg.name || '').trim().slice(0, 20) || 'Player';
  const room = rooms.get(code);
  if (!room) return send(ws, 'error', { message: 'Room not found.' });
  if (room.game) return send(ws, 'error', { message: 'Game already started.' });
  if (room.players.length >= room.options.maxPlayers) {
    return send(ws, 'error', { message: 'Room is full.' });
  }
  const playerId = randomUUID();
  room.players.push({ id: playerId, name });
  attach(ws, room, playerId);
  send(ws, 'joined', { playerId, code, you: { id: playerId, name } });
  broadcastRoom(room);
}

function onRejoin(ws, msg) {
  const code = (msg.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return send(ws, 'session-invalid', {});
  const p = room.players.find((x) => x.id === msg.playerId);
  if (!p) return send(ws, 'session-invalid', {});
  attach(ws, room, p.id);
  send(ws, 'joined', { playerId: p.id, code, you: { id: p.id, name: p.name } });
  broadcastRoom(room);
}

function onStart(ws, msg) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  if (ws.playerId !== room.hostId) return send(ws, 'error', { message: 'Only the host can start.' });
  if (room.players.length < 2) return send(ws, 'error', { message: 'Need at least 2 players.' });
  room.game = createGame(room.players, room.options);
  broadcastRoom(room);
}

function onAction(ws, msg) {
  const room = rooms.get(ws.roomCode);
  if (!room || !room.game) return;
  const result = applyAction(room.game, ws.playerId, msg.action || {});
  if (!result.ok) {
    send(ws, 'error', { message: result.error });
    return;
  }
  broadcastRoom(room);
}

function onRematch(ws, msg) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  if (ws.playerId !== room.hostId) return send(ws, 'error', { message: 'Only the host can restart.' });
  room.game = createGame(room.players, room.options);
  broadcastRoom(room);
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

server.listen(PORT, HOST, () => {
  console.log(`\n  Durak server running on ${HOST}:${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://<your-LAN-ip>:${PORT}  (share this with your team)\n`);
});
