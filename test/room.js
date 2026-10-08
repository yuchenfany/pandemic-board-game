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
console.log('room tests passed');
