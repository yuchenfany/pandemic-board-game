// Multiplayer server: rooms + seats over Socket.IO, authoritative game state via shared/engine.js.
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const Engine = require('./shared/engine');
const D = require('./shared/data');

const PORT = process.env.PORT || 3000;
const MAX_SEATS = 5;
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
const server = http.createServer(app);
const io = new Server(server);

/** code -> { code, hostToken, seats: [{token, name, role, connected}], config, game, chat, touched } */
const rooms = new Map();

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const cleanName = (n) => String(n || '').trim().slice(0, 20) || 'Player';

function publicRoom(room) {
  return {
    code: room.code,
    seats: room.seats.map(s => ({ name: s.name, role: s.role, connected: s.connected })),
    host: room.seats.findIndex(s => s.token === room.hostToken),
    config: room.config,
    started: !!room.game,
    chat: room.chat.slice(-100),
  };
}

function broadcast(room) {
  room.touched = Date.now();
  const payload = { room: publicRoom(room), game: room.game ? Engine.view(room.game) : null };
  for (const [, sock] of io.of('/').sockets) {
    if (sock.data.code === room.code) {
      const you = room.seats.findIndex(s => s.token === sock.data.token);
      sock.emit('state', { ...payload, you });
    }
  }
}

function seatOf(socket) {
  const room = rooms.get(socket.data.code);
  if (!room) return {};
  const idx = room.seats.findIndex(s => s.token === socket.data.token);
  return { room, idx, seat: room.seats[idx] };
}

io.on('connection', (socket) => {
  const reply = (cb, data) => typeof cb === 'function' && cb(data);

  socket.on('create', ({ name } = {}, cb) => {
    const code = newCode();
    const token = crypto.randomUUID();
    const room = {
      code, hostToken: token, seats: [{ token, name: cleanName(name), role: null, connected: true }],
      config: { epidemics: 5, eventsPerPlayer: 2 }, game: null, chat: [], touched: Date.now(),
    };
    rooms.set(code, room);
    socket.data = { code, token };
    reply(cb, { code, token });
    broadcast(room);
  });

  socket.on('join', ({ code, name, token } = {}, cb) => {
    code = String(code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return reply(cb, { error: 'Room not found' });
    let seat = token && room.seats.find(s => s.token === token);
    if (!seat) {
      if (room.game) return reply(cb, { error: 'Game already started (only existing players can rejoin)' });
      if (room.seats.length >= MAX_SEATS) return reply(cb, { error: 'Room is full (max 5 players)' });
      token = crypto.randomUUID();
      seat = { token, name: cleanName(name), role: null, connected: true };
      room.seats.push(seat);
    }
    seat.connected = true;
    socket.data = { code, token: seat.token };
    reply(cb, { code, token: seat.token });
    broadcast(room);
  });

  socket.on('leave', () => {
    const { room, idx } = seatOf(socket);
    if (!room) return;
    if (!room.game) {
      room.seats.splice(idx, 1);
      if (!room.seats.length) { rooms.delete(room.code); return; }
      if (!room.seats.some(s => s.token === room.hostToken)) room.hostToken = room.seats[0].token;
    }
    socket.data = {};
    broadcast(room);
  });

  socket.on('pickRole', ({ role } = {}, cb) => {
    const { room, seat } = seatOf(socket);
    if (!room || room.game) return reply(cb, { error: 'Cannot change role now' });
    if (role && !D.ROLES[role]) return reply(cb, { error: 'Unknown role' });
    if (role && room.seats.some(s => s !== seat && s.role === role)) return reply(cb, { error: 'Role already taken' });
    seat.role = role || null;
    broadcast(room);
  });

  socket.on('config', (config = {}, cb) => {
    const { room, seat } = seatOf(socket);
    if (!room || room.game || seat.token !== room.hostToken) return reply(cb, { error: 'Only the host can change settings' });
    const ep = Number(config.epidemics);
    const ev = Number(config.eventsPerPlayer);
    if ([4, 5, 6, 7].includes(ep)) room.config.epidemics = ep;
    if ([0, 1, 2, 3].includes(ev)) room.config.eventsPerPlayer = ev;
    broadcast(room);
  });

  socket.on('start', (_, cb) => {
    const { room, seat } = seatOf(socket);
    if (!room || seat.token !== room.hostToken) return reply(cb, { error: 'Only the host can start' });
    try {
      room.game = Engine.createGame({
        players: room.seats.map(s => ({ name: s.name, role: s.role })),
        epidemics: room.config.epidemics,
        eventCount: room.config.eventsPerPlayer * room.seats.length,
      });
      broadcast(room);
    } catch (e) {
      reply(cb, { error: e.message });
    }
  });

  socket.on('backToLobby', (_, cb) => {
    const { room, seat } = seatOf(socket);
    if (!room || seat.token !== room.hostToken) return reply(cb, { error: 'Only the host can do that' });
    if (room.game && room.game.status === 'playing') return reply(cb, { error: 'Game still in progress' });
    room.game = null;
    broadcast(room);
  });

  socket.on('action', (action, cb) => {
    const { room, idx } = seatOf(socket);
    if (!room || !room.game) return reply(cb, { error: 'No game in progress' });
    try {
      room.game = Engine.apply(room.game, idx, action);
      reply(cb, { ok: true });
      broadcast(room);
    } catch (e) {
      if (!(e instanceof Engine.GameError)) console.error(e);
      reply(cb, { error: e instanceof Engine.GameError ? e.message : 'Internal error' });
    }
  });

  socket.on('chat', ({ text } = {}) => {
    const { room, seat } = seatOf(socket);
    if (!room || !seat) return;
    const msg = String(text || '').trim().slice(0, 300);
    if (!msg) return;
    room.chat.push({ name: seat.name, text: msg, at: Date.now() });
    if (room.chat.length > 200) room.chat.shift();
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const { room, seat } = seatOf(socket);
    if (!room || !seat) return;
    const stillHere = [...io.of('/').sockets.values()].some(s => s !== socket && s.data.token === seat.token);
    if (!stillHere) seat.connected = false;
    broadcast(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) if (now - room.touched > ROOM_TTL_MS) rooms.delete(code);
}, 60 * 60 * 1000).unref();

server.listen(PORT, () => console.log(`Pandemic server running at http://localhost:${PORT}`));
