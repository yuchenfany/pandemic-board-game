// Lobby / room logic scenarios (the code the host's browser runs).
const assert = require('assert');
const Room = require('../public/shared/room');

const r = new Room('ABCD');
const a = r.handle(null, 'join', { name: 'Alice' });
const b = r.handle(null, 'join', { name: 'Bob' });
assert(a.token && b.token && a.token !== b.token);
assert.strictEqual(r.hostToken, a.token, 'first joiner hosts');
assert(r.handle(b.token, 'config', { epidemics: 6 }).error, 'only host configures');
assert(r.handle(a.token, 'config', { epidemics: 6 }).ok);
assert(r.handle(a.token, 'config', { challenges: { mutation: true } }).ok);
assert.deepStrictEqual(r.config.challenges, { virulent: false, mutation: true });
assert(r.handle(a.token, 'config', { excludedRoles: ['generalist', 'bogus', 'generalist'] }).ok);
assert.deepStrictEqual(r.config.excludedRoles, ['generalist'], 'excluded roles are validated and de-duplicated');
assert(r.handle(b.token, 'config', { excludedRoles: [] }).error, 'only host excludes roles');
assert(r.handle(a.token, 'pickRole', { role: 'medic' }).ok);
assert(r.handle(b.token, 'pickRole', { role: 'medic' }).error, 'role taken');
assert(r.handle(b.token, 'start').error, 'only host starts');
assert(r.handle(a.token, 'start').ok);
assert.strictEqual(r.game.players[0].role, 'medic');
assert.strictEqual(r.game.epidemics, 6);
assert(r.game.challenges.mutation && r.game.colors.includes('purple'));
assert(r.handle(null, 'join', { name: 'Late' }).error, 'no new seats after start');
assert.strictEqual(r.handle(null, 'join', { token: b.token }).token, b.token, 'rejoin by token');

const cur = r.game.current;
const [curTok, otherTok] = cur === 0 ? [a.token, b.token] : [b.token, a.token];
assert(r.handle(otherTok, 'action', { type: 'pass' }).error);
assert(r.handle(curTok, 'action', { type: 'pass' }).ok);
assert.strictEqual(r.game.turn.actionsTaken, 1);

// Snapshot hides decks and serialises/restores cleanly (host refresh)
const snap = r.snapshot(b.token);
assert.strictEqual(snap.you, 1);
assert(!snap.game.playerDeck && !snap.game.infectionDeck);
const restored = new Room('ABCD', JSON.parse(JSON.stringify(r)));
assert.deepStrictEqual(restored.game, r.game);
assert(restored.handle(curTok, 'action', { type: 'pass' }).ok);

assert(r.handle(a.token, 'chat', { text: 'hi' }).ok);
assert.strictEqual(r.chat.length, 1);

// Hotseat: one device controls several seats.
const h = new Room('HOTS');
const ha = h.handle(null, 'join', { name: 'Ann' });
const hg = h.handle(null, 'join', { name: 'Guest' });
assert(h.handle(ha.token, 'addLocal', { name: 'Ben' }).ok);
assert(h.handle(ha.token, 'addLocal', { name: 'Cat' }).ok);
assert.deepStrictEqual(h.snapshot(ha.token).mine, [0, 2, 3]);
assert.deepStrictEqual(h.snapshot(hg.token).mine, [1]);
assert.strictEqual(h.publicRoom().seats[2].owner, 0);
assert(h.handle(ha.token, 'pickRole', { role: 'scientist', seat: 2 }).ok);
assert.strictEqual(h.seats[2].role, 'scientist');
assert(h.handle(hg.token, 'pickRole', { role: 'medic', seat: 2 }).error, "can't pick for another device's player");
assert(h.handle(hg.token, 'removeLocal', { seat: 3 }).error);
assert(h.handle(ha.token, 'removeLocal', { seat: 3 }).ok);
assert.strictEqual(h.seats.length, 3);
h.setConnected(ha.token, false);
assert(!h.seats[2].connected, 'hotseat players go offline with their device');
h.setConnected(ha.token, true);
assert(h.handle(ha.token, 'start').ok);
const hc = h.game.current;
const ctl = hc === 1 ? hg.token : ha.token;
assert(h.handle(hg.token === ctl ? ha.token : hg.token, 'action', { type: 'pass', as: hc }).error, 'cannot act as a seat you do not control');
assert(h.handle(ctl, 'action', { type: 'pass', as: hc }).ok);
assert.strictEqual(h.game.turn.actionsTaken, 1);
h.handle(ha.token, 'abandon');
h.handle(ha.token, 'leave');
assert.deepStrictEqual(h.seats.map(x => x.name), ['Guest'], 'leaving takes your hotseat players with you');
assert.strictEqual(h.hostToken, hg.token, 'host passes to a real (non-hotseat) seat');
console.log('room tests passed');
