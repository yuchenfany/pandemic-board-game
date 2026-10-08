/* global Peer, Room */
// Peer-to-peer transport. The room creator's browser is the host: it owns the Room and
// relays state to guests over WebRTC data channels (PeerJS handles signalling).
'use strict';

const PEER_PREFIX = 'pandemic-otb-v1-';
const PING_MS = 4000;
const TIMEOUT_MS = 15000;
const hostKey = (code) => `pandemic:host:${code}`;

class BaseNet {
  constructor(code) {
    this.code = code;
    this.handlers = {};
    this.status = 'connecting'; // connecting | online | offline
    this.statusText = 'Connecting…';
  }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  fire(ev, data) { (this.handlers[ev] || []).forEach(fn => fn(data)); }
  setStatus(status, text) {
    this.status = status;
    this.statusText = text;
    this.fire('status', { status, text });
  }
}

class HostNet extends BaseNet {
  constructor(code, room) {
    super(code);
    this.room = room;
    this.conns = new Set();
    this.myToken = null;
    this.destroyed = false;
  }

  static savedRoom(code) {
    try { const j = localStorage.getItem(hostKey(code)); return j ? JSON.parse(j) : null; } catch { return null; }
  }
  static forget(code) { try { localStorage.removeItem(hostKey(code)); } catch { /* ignore */ } }

  start() {
    this.setStatus('connecting', 'Opening room…');
    this.peer = new Peer(PEER_PREFIX + this.code, { debug: 1 });
    this.peer.on('open', () => this.setStatus('online', 'Hosting — keep this tab open'));
    this.peer.on('connection', (conn) => this.accept(conn));
    this.peer.on('disconnected', () => {
      if (this.destroyed) return;
      this.setStatus('connecting', 'Lost signalling server, reconnecting…');
      setTimeout(() => !this.destroyed && this.peer.reconnect(), 1500);
    });
    this.peer.on('error', (err) => {
      if (this.destroyed) return;
      if (err.type === 'unavailable-id') {
        // Our previous session (e.g. before a refresh) is still registered; retry shortly.
        this.setStatus('connecting', 'Re-opening room (waiting for old session to expire)…');
        this.peer.destroy();
        setTimeout(() => !this.destroyed && this.start(), 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.setStatus('connecting', 'Network problem, retrying…');
      } else {
        console.warn('peer error', err.type, err);
      }
    });
    clearInterval(this.pinger);
    this.pinger = setInterval(() => this.heartbeat(), PING_MS);
  }

  accept(conn) {
    conn.lastSeen = Date.now();
    conn.on('open', () => this.conns.add(conn));
    conn.on('data', (msg) => {
      conn.lastSeen = Date.now();
      if (!msg || typeof msg !== 'object') return;
      if (msg.ev === 'ping') return;
      let res;
      if (msg.ev === 'join') {
        res = this.room.handle(null, 'join', msg.data);
        if (res.token) conn.token = res.token;
      } else if (!conn.token) {
        res = { error: 'Join the room first' };
      } else {
        res = this.room.handle(conn.token, msg.ev, msg.data);
      }
      if (msg.id != null) conn.send({ re: msg.id, res });
      this.broadcast();
    });
    const drop = () => {
      if (!this.conns.delete(conn)) return;
      if (conn.token && ![...this.conns].some(c => c.token === conn.token)) this.room.setConnected(conn.token, false);
      this.broadcast();
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  heartbeat() {
    const now = Date.now();
    for (const c of this.conns) {
      if (now - c.lastSeen > TIMEOUT_MS) { c.close(); continue; }
      if (c.open) c.send({ ev: 'ping' });
    }
  }

  emit(ev, data, cb) {
    const res = this.room.handle(this.myToken, ev, data);
    if (ev === 'join' && res.token) this.myToken = res.token;
    if (cb) cb(res);
    this.broadcast();
  }

  broadcast() {
    try { localStorage.setItem(hostKey(this.code), JSON.stringify(this.room)); } catch { /* storage full or blocked */ }
    const gameView = this.room.game ? Engine.view(this.room.game) : null;
    this.fire('state', this.room.snapshot(this.myToken, gameView));
    for (const c of this.conns) {
      if (c.open && c.token) c.send({ ev: 'state', data: this.room.snapshot(c.token, gameView) });
    }
  }

  close() {
    this.destroyed = true;
    clearInterval(this.pinger);
    for (const c of this.conns) c.close();
    if (this.peer) this.peer.destroy();
    HostNet.forget(this.code);
  }
}

class GuestNet extends BaseNet {
  constructor(code) {
    super(code);
    this.pending = new Map();
    this.nextId = 1;
    this.joinData = null;
    this.destroyed = false;
    this.everJoined = false;
  }

  // name for a fresh seat, token to reclaim an existing one; cb receives the join result.
  join(joinData, cb) {
    this.joinData = joinData;
    this.onJoined = cb;
    this.connect();
  }

  connect() {
    if (this.destroyed) return;
    this.setStatus('connecting', this.everJoined ? 'Reconnecting to host…' : 'Connecting to host…');
    if (!this.peer || this.peer.destroyed) {
      this.peer = new Peer({ debug: 1 });
      this.peer.on('open', () => this.openConn());
      this.peer.on('error', (err) => {
        if (this.destroyed) return;
        if (err.type === 'peer-unavailable') {
          this.setStatus('offline', `Can't reach the host of room ${this.code}. Is their tab open? Retrying…`);
          this.retry();
        } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
          this.setStatus('offline', 'Network problem, retrying…');
          this.retry();
        } else {
          console.warn('peer error', err.type, err);
        }
      });
      this.peer.on('disconnected', () => !this.destroyed && setTimeout(() => this.peer.reconnect(), 1500));
    } else if (this.peer.open) {
      this.openConn();
    }
  }

  retry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), 4000);
  }

  openConn() {
    if (this.conn) this.conn.close();
    const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true });
    this.conn = conn;
    conn.on('open', () => {
      this.lastSeen = Date.now();
      this.send('join', this.joinData, (res) => {
        if (res.error) { this.setStatus('offline', res.error); if (this.onJoined) this.onJoined(res); return; }
        this.joinData = { token: res.token };
        this.everJoined = true;
        this.setStatus('online', 'Connected');
        if (this.onJoined) this.onJoined(res);
      });
    });
    conn.on('data', (msg) => {
      this.lastSeen = Date.now();
      if (!msg || typeof msg !== 'object') return;
      if (msg.re != null) {
        const cb = this.pending.get(msg.re);
        this.pending.delete(msg.re);
        if (cb) cb(msg.res);
      } else if (msg.ev === 'state') {
        this.fire('state', msg.data);
      }
    });
    conn.on('close', () => {
      if (this.conn !== conn || this.destroyed) return;
      this.setStatus('offline', 'Lost connection to host, reconnecting…');
      this.retry();
    });
    clearInterval(this.pinger);
    this.pinger = setInterval(() => {
      if (this.conn !== conn) return;
      if (conn.open) conn.send({ ev: 'ping' });
      if (Date.now() - this.lastSeen > TIMEOUT_MS && this.status === 'online') {
        this.setStatus('offline', 'Host stopped responding, reconnecting…');
        conn.close();
        this.retry();
      }
    }, PING_MS);
  }

  send(ev, data, cb) {
    if (!this.conn || !this.conn.open) { if (cb) cb({ error: 'Not connected to the host yet' }); return; }
    const id = this.nextId++;
    if (cb) this.pending.set(id, cb);
    this.conn.send({ id, ev, data });
  }

  emit(ev, data, cb) { this.send(ev, data, cb); }

  close() {
    this.destroyed = true;
    clearInterval(this.pinger);
    clearTimeout(this.retryTimer);
    if (this.peer) this.peer.destroy();
  }
}
