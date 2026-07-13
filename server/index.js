import express from 'express';
import { createServer } from 'http';
import Pusher from 'pusher';

const app = express();
const server = createServer(app);

// Pusher server SDK
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '2176141',
  key: process.env.PUSHER_KEY || 'e79b0eb928758744ff45',
  secret: process.env.PUSHER_SECRET || '0a43a005cee4ed40f691',
  cluster: process.env.PUSHER_CLUSTER || 'eu',
  useTLS: true,
});

// Health check
app.get('/', (req, res) => res.send('GChat Signal Server OK'));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Pusher trigger helper
function trigger(roomId, event, data) {
  pusher.trigger(`gchat-room-${roomId}`, event, data).catch(console.error);
}

// In-memory state
const waitingUsers = [];  // { socketId, tags, pusherChannel }
const rooms = new Map();  // roomId -> { user1, user2 }

function generateRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

// Match by shared tags when possible
function findBestMatch(tags) {
  if (!tags || tags.length === 0) {
    return waitingUsers.length > 0 ? waitingUsers[0] : null;
  }
  let best = null;
  let bestScore = -1;
  for (const u of waitingUsers) {
    if (!u.tags || u.tags.length === 0) continue;
    const score = u.tags.filter(t => tags.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = u; }
  }
  return best || (waitingUsers.length > 0 ? waitingUsers[0] : null);
}

function tryMatch() {
  while (waitingUsers.length >= 2) {
    const u1 = waitingUsers.shift();
    const u2 = waitingUsers.shift();
    if (!u1 || !u2) continue;

    const roomId = generateRoomId();
    rooms.set(roomId, { user1: u1, user2: u2 });

    console.log(`[MATCH] ${u1.socketId} <-> ${u2.socketId} room:${roomId}`);

    // Tell both users they matched
    trigger(roomId, 'matched', {
      roomId,
      partnerId: u2.socketId,
      isInitiator: true,
    });
    trigger(roomId, 'matched', {
      roomId,
      partnerId: u1.socketId,
      isInitiator: false,
    });
  }
}

// ── REST API for signaling ──────────────────────────────────────────────────
app.use(express.json());

// Join queue
app.post('/api/join', (req, res) => {
  const { socketId, tags = [] } = req.body;
  if (!socketId) return res.status(400).json({ error: 'socketId required' });

  // Remove if already waiting
  const existingIdx = waitingUsers.findIndex(u => u.socketId === socketId);
  if (existingIdx !== -1) waitingUsers.splice(existingIdx, 1);

  waitingUsers.push({ socketId, tags });
  console.log(`[Q] ${socketId} joined queue (${waitingUsers.length} waiting)`);
  tryMatch();
  res.json({ ok: true, position: waitingUsers.length });
});

// Leave queue
app.post('/api/leave', (req, res) => {
  const { socketId } = req.body;
  const idx = waitingUsers.findIndex(u => u.socketId === socketId);
  if (idx !== -1) waitingUsers.splice(idx, 1);
  res.json({ ok: true });
});

// WebRTC signals
app.post('/api/signal', (req, res) => {
  const { roomId, event, data, targetId } = req.body;
  if (!roomId || !event) return res.status(400).json({ error: 'roomId and event required' });
  trigger(roomId, event, { ...data, fromId: targetId });
  res.json({ ok: true });
});

// Close room
app.post('/api/close', (req, res) => {
  const { roomId } = req.body;
  if (roomId && rooms.has(roomId)) {
    const room = rooms.get(roomId);
    trigger(roomId, 'partner_left', { reason: 'close' });
    rooms.delete(roomId);
    console.log(`[ROOM] ${roomId} closed`);
  }
  res.json({ ok: true });
});

// ── Start ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 GChat Signal Server: http://localhost:${PORT}\n`);
});
