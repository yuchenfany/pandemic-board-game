// Room / lobby logic. Runs in the host's browser (and in Node for tests).
// Every request is (token, event, data) -> result; the host is authoritative.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./data.js'));
  else root.Room = factory(root.Engine, root.PData);
}(typeof self !== 'undefined' ? self : this, function (Engine, D) {
  'use strict';
  const MAX_SEATS = 5;

  const cleanName = (n) => String(n || '').trim().slice(0, 20) || 'Player';
  function newToken() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function newCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  }

  class Room {
    constructor(code, saved) {
      this.code = code;
      this.seats = [];
      this.hostToken = null;
      this.config = { epidemics: 5, eventsPerPlayer: 2 };
      this.game = null;
      this.chat = [];
      if (saved) Object.assign(this, saved, { code });
    }

    toJSON() {
      const { code, seats, hostToken, config, game, chat } = this;
      return { code, seats, hostToken, config, game, chat };
    }

    seat(token) { return this.seats.find(s => s.token === token); }
    seatIndex(token) { return this.seats.findIndex(s => s.token === token); }

    setConnected(token, on) {
      const s = this.seat(token);
      if (s) s.connected = on;
    }

    publicRoom() {
      return {
        code: this.code,
        seats: this.seats.map(s => ({ name: s.name, role: s.role, connected: s.connected })),
        host: this.seatIndex(this.hostToken),
        config: this.config,
        started: !!this.game,
        chat: this.chat.slice(-100),
      };
    }

    snapshot(token, gameView) {
      return { room: this.publicRoom(), game: this.game ? (gameView || Engine.view(this.game)) : null, you: this.seatIndex(token) };
    }

    // Returns { ok, token? } or { error }.
    handle(token, ev, data) {
      data = data || {};
      try {
        return this[`on_${ev}`] ? this[`on_${ev}`](token, data) || { ok: true } : { error: 'Unknown request' };
      } catch (e) {
        if (e instanceof Engine.GameError) return { error: e.message };
        if (typeof console !== 'undefined') console.error(e);
        return { error: 'Internal error' };
      }
    }

    on_join(_, { name, token }) {
      let seat = token && this.seat(token);
      if (!seat) {
        if (this.game) return { error: 'Game already started (only existing players can rejoin)' };
        if (this.seats.length >= MAX_SEATS) return { error: 'Room is full (max 5 players)' };
        seat = { token: newToken(), name: cleanName(name), role: null, connected: true };
        this.seats.push(seat);
        if (!this.hostToken) this.hostToken = seat.token;
      }
      seat.connected = true;
      return { ok: true, token: seat.token, code: this.code };
    }

    on_leave(token) {
      const i = this.seatIndex(token);
      if (i < 0 || this.game) return;
      this.seats.splice(i, 1);
      if (!this.seat(this.hostToken) && this.seats[0]) this.hostToken = this.seats[0].token;
    }

    on_pickRole(token, { role }) {
      const seat = this.seat(token);
      if (!seat || this.game) return { error: 'Cannot change role now' };
      if (role && !D.ROLES[role]) return { error: 'Unknown role' };
      if (role && this.seats.some(s => s !== seat && s.role === role)) return { error: 'Role already taken' };
      seat.role = role || null;
    }

    on_config(token, cfg) {
      if (this.game || token !== this.hostToken) return { error: 'Only the host can change settings' };
      const ep = Number(cfg.epidemics), ev = Number(cfg.eventsPerPlayer);
      if ([4, 5, 6, 7].includes(ep)) this.config.epidemics = ep;
      if ([0, 1, 2, 3].includes(ev)) this.config.eventsPerPlayer = ev;
    }

    on_start(token) {
      if (token !== this.hostToken) return { error: 'Only the host can start' };
      if (this.game) return { error: 'Already started' };
      this.game = Engine.createGame({
        players: this.seats.map(s => ({ name: s.name, role: s.role })),
        epidemics: this.config.epidemics,
        eventCount: this.config.eventsPerPlayer * this.seats.length,
      });
    }

    on_backToLobby(token) {
      if (token !== this.hostToken) return { error: 'Only the host can do that' };
      if (this.game && this.game.status === 'playing') return { error: 'Game still in progress' };
      this.game = null;
    }

    on_abandon(token) {
      if (token !== this.hostToken) return { error: 'Only the host can do that' };
      this.game = null;
    }

    on_action(token, action) {
      const i = this.seatIndex(token);
      if (i < 0) return { error: 'You are not in this room' };
      if (!this.game) return { error: 'No game in progress' };
      this.game = Engine.apply(this.game, i, action);
    }

    on_chat(token, { text }) {
      const seat = this.seat(token);
      const msg = String(text || '').trim().slice(0, 300);
      if (!seat || !msg) return;
      this.chat.push({ name: seat.name, text: msg, at: Date.now() });
      if (this.chat.length > 200) this.chat.shift();
    }
  }

  Room.newCode = newCode;
  return Room;
}));
