import { createServer } from '"'"'http'"'"';
import { Server } from '"'"'socket.io'"'"';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: '"'"'*'"'"', methods: ['"'"'GET'"'"', '"'"'POST'"'"'] },
});

const waitingUsers = [];
const rooms = new Map();
const socketToRoom = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

// Match by shared tags when possible, otherwise random
function findMatch(tags) {
  if (!tags || tags.length === 0) {
    return waitingUsers.length > 0 ? waitingUsers[0] : null;
  }
  // Find user with most overlap
  let best = null;
  let bestScore = -1;
  for (const u of waitingUsers) {
    if (!u.tags) continue;
    const score = u.tags.filter(t => tags.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = u; }
  }
  return best || (waitingUsers.length > 0 ? waitingUsers[0] : null);
}

io.on('"'"'connection'"'"', (socket) => {
  console.log(`[+] ${socket.id}`);

  socket.on('"'"'join_queue'"'"', ({ tags = [] } = {}) => {
    if (socketToRoom.has(socket.id)) leaveRoom(socket, '"'"'rejoin'"'"');
    socket.tags = tags;
    waitingUsers.push(socket);
    console.log(`[Q] ${socket.id} queue:${waitingUsers.length} tags:${tags.join('"'"','"'"')}`);
    tryMatch();
  });

  socket.on('"'"'leave_queue'"'"', () => {
    const i = waitingUsers.findIndex(s => s.id === socket.id);
    if (i !== -1) waitingUsers.splice(i, 1);
    socket.emit('"'"'left_queue'"'"');
  });

  socket.on('"'"'signal_offer'"'"', ({ targetId, offer }) =>
    io.to(targetId).emit('"'"'signal_offer'"'"', { offer, fromId: socket.id })
  );
  socket.on('"'"'signal_answer'"'"', ({ targetId, answer }) =>
    io.to(targetId).emit('"'"'signal_answer'"'"', { answer, fromId: socket.id })
  );
  socket.on('"'"'signal_ice'"'"', ({ targetId, candidate }) =>
    io.to(targetId).emit('"'"'signal_ice'"'"', { candidate, fromId: socket.id })
  );

  socket.on('"'"'send_message'"'"', ({ text }) => {
    const rid = socketToRoom.get(socket.id);
    if (!rid) return;
    const room = rooms.get(rid);
    const other = room.user1 === socket.id ? room.user2 : room.user1;
    io.to(other).emit('"'"'receive_message'"'"', { text, fromId: socket.id });
  });

  socket.on('"'"'skip'"'"', () => {
    const rid = socketToRoom.get(socket.id);
    if (!rid) return;
    const room = rooms.get(rid);
    const other = room.user1 === socket.id ? room.user2 : room.user1;
    io.to(other).emit('"'"'partner_skipped'"'"');
    rooms.delete(rid);
    socketToRoom.delete(socket.id);
    socketToRoom.delete(other);
    const otherSock = io.sockets.sockets.get(other);
    if (otherSock) {
      otherSock.emit('"'"'skipped_back_to_queue'"'"');
      waitingUsers.push(otherSock);
      tryMatch();
    }
  });

  socket.on('"'"'disconnect'"'"', () => {
    removeFromQueue(socket);
    leaveRoom(socket, '"'"'disconnect'"'"');
  });
});

function tryMatch() {
  while (waitingUsers.length >= 2) {
    const u1 = waitingUsers.shift();
    const u2 = waitingUsers.shift();
    if (!u1.connected || !u2.connected) {
      if (u1.connected) waitingUsers.unshift(u1);
      if (u2.connected) waitingUsers.unshift(u2);
      continue;
    }
    const rid = generateRoomId();
    rooms.set(rid, { user1: u1.id, user2: u2.id });
    socketToRoom.set(u1.id, rid);
    socketToRoom.set(u2.id, rid);
    u1.join(rid); u2.join(rid);
    console.log(`[MATCH] ${u1.id} <-> ${u2.id}`);
    u1.emit('"'"'matched'"'"', { roomId: rid, partnerId: u2.id, isInitiator: true });
    u2.emit('"'"'matched'"'"', { roomId: rid, partnerId: u1.id, isInitiator: false });
  }
}

function removeFromQueue(s) {
  const i = waitingUsers.findIndex(x => x.id === s.id);
  if (i !== -1) waitingUsers.splice(i, 1);
}

function leaveRoom(s, reason = '"'"'leave'"'"') {
  const rid = socketToRoom.get(s.id);
  if (!rid) return;
  const room = rooms.get(rid);
  if (!room) return;
  const other = room.user1 === s.id ? room.user2 : room.user1;
  rooms.delete(rid);
  socketToRoom.delete(s.id);
  socketToRoom.delete(other);
  s.leave(rid);
  io.to(other).emit('"'"'partner_left'"'"', { reason });
  console.log(`[ROOM] ${rid} closed (${reason})`);
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`\n🚀 Server: http://localhost:${PORT}\n`));
