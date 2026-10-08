// Plays many random games through the engine and checks invariants.
const assert = require('assert');
const E = require('../public/shared/engine');
const D = require('../public/shared/data');

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const CITY_NAMES = Object.keys(D.CITIES);

function checkInvariants(s) {
  D.COLORS.forEach(c => {
    const board = CITY_NAMES.reduce((t, city) => t + s.cubes[city][c], 0);
    const samples = s.players.reduce((t, p) => t + p.samples[c], 0);
    assert.strictEqual(board + samples + s.supply[c], 24, `cube conservation ${c}`);
    CITY_NAMES.forEach(city => assert(s.cubes[city][c] >= 0 && s.cubes[city][c] <= 3, `cube range ${city}`));
  });
  const cards = [...s.playerDeck, ...s.playerDiscard, ...s.removed.filter(c => !CITY_NAMES.includes(c)),
    ...s.players.flatMap(p => p.hand), ...s.players.map(p => p.stored).filter(Boolean)];
  assert.strictEqual(new Set(cards).size, cards.length, 'duplicate player card');
  const inf = [...s.infectionDeck, ...s.infectionDiscard, ...s.removed.filter(c => CITY_NAMES.includes(c)),
    ...(s.interrupt ? s.interrupt.cards : [])];
  assert.strictEqual(inf.length, 48, 'infection card count');
  assert.strictEqual(new Set(inf).size, 48, 'duplicate infection card');
  assert(s.stations.length <= 6);
}

function randomEventParams(s, key) {
  const pawn = Math.floor(Math.random() * s.players.length);
  const city = pick(CITY_NAMES);
  const withCubes = CITY_NAMES.flatMap(c => D.COLORS.filter(col => s.cubes[c][col] > 0).map(col => ({ city: c, color: col })));
  switch (key) {
    case 'airlift': return { pawn, to: city };
    case 'governmentGrant': return { city, remove: pick(s.stations) };
    case 'resilientPopulation': return { card: pick(s.infectionDiscard) };
    case 'newAssignment': return { player: pawn, role: pick(Object.keys(D.ROLES).filter(r => !s.players.some(p => p.role === r))) };
    case 'rapidVaccineDeployment': {
      const c = withCubes.find(w => w.color === s.rvdColor);
      return { removals: c ? [{ city: c.city, n: 1 }] : [] };
    }
    case 'reexaminedResearch': return { player: pawn, card: pick(s.playerDiscard.filter(E.isCity)) };
    case 'remoteTreatment': return { removals: [pick(withCubes), pick(withCubes)] };
    case 'specialOrders': return { pawn };
    default: return {};
  }
}

function candidates(s) {
  const out = [];
  if (s.interrupt) {
    return [[s.interrupt.player, { type: 'forecastOrder', order: [...s.interrupt.cards].sort(() => Math.random() - 0.5) }]];
  }
  const over = s.players.map((p, i) => i).filter(i => s.players[i].hand.length > E.handLimit(s.players[i]));
  // Random events from anyone (rarely)
  s.players.forEach((p, i) => {
    [...p.hand.filter(E.isEvent).map(c => ({ c, st: false })), ...(p.stored ? [{ c: p.stored, st: true }] : [])].forEach(({ c, st }) => {
      if (Math.random() < 0.08 || s.rvdColor) out.push([i, { type: 'playEvent', card: c, fromStored: st, params: randomEventParams(s, E.eventKey(c)) }]);
    });
  });
  if (over.length) {
    over.forEach(i => out.push([i, { type: 'discard', card: pick(s.players[i].hand) }]));
    return out;
  }
  const cur = s.current, p = s.players[cur];
  const ph = s.turn.phase;
  if (ph === 'draw') out.push([cur, { type: 'draw' }]);
  if (ph === 'epidemic') out.push([cur, { type: 'continue' }]);
  if (ph === 'infect') out.push([cur, { type: 'infect' }]);
  if (ph !== 'actions') return out;

  // Prefer cure / treat to make games progress
  D.COLORS.forEach(color => {
    const cards = p.hand.filter(c => E.isCity(c) && D.CITIES[c].color === color);
    [false, true].forEach(useSamples => {
      const need = E.cardsNeededForCure(p, useSamples);
      if (cards.length >= need) for (let k = 0; k < 5; k++) out.push([cur, { type: 'cure', color, cards: cards.slice(0, need), useSamples }]);
    });
    if (s.cubes[p.location][color] > 0) {
      out.push([cur, { type: 'treat', color }], [cur, { type: 'treat', color }]);
      out.push([cur, { type: 'fieldSample', color }]);
    }
  });
  s.players.forEach((_, pawn) => {
    CITY_NAMES.forEach(to => {
      E.getMoveOptions(s, cur, pawn, to).forEach(o => {
        out.push([cur, { type: 'move', pawn, to, method: o.method, card: o.cards ? pick(o.cards) : undefined }]);
      });
    });
  });
  E.getShareOptions(s, cur).forEach(o => out.push([cur, { type: 'share', ...o }]));
  out.push([cur, { type: 'build', remove: pick(s.stations) }]);
  out.push([cur, { type: 'pass' }]);
  out.push([cur, { type: 'contingencyTake', card: pick(s.playerDiscard.filter(E.isEvent)) }]);
  out.push([cur, { type: 'archivistRetrieve' }]);
  s.players.forEach((q, i) => q.hand.forEach(c => out.push([cur, { type: 'epidemiologistTake', from: i, card: c }])));
  if (Math.random() < 0.02) out.push([cur, { type: 'endActions' }]);
  return out;
}

function playOne(nPlayers, epidemics) {
  let s = E.createGame({
    players: Array.from({ length: nPlayers }, (_, i) => ({ name: 'P' + i })),
    epidemics,
    eventCount: 13,
  });
  checkInvariants(s);
  let steps = 0;
  while (s.status === 'playing') {
    if (++steps > 20000) throw new Error('game did not terminate');
    const cands = candidates(s);
    assert(cands.length, 'no candidate actions');
    let moved = false;
    for (let tries = 0; tries < 60 && !moved; tries++) {
      const [pid, a] = pick(cands);
      try {
        s = E.apply(s, pid, a);
        moved = true;
      } catch (e) {
        if (!(e instanceof E.GameError)) { console.error(a, e); throw e; }
      }
    }
    if (!moved) {
      // fall back to any always-legal action
      const forced = cands.find(([, a]) => ['draw', 'continue', 'infect', 'pass', 'discard', 'forecastOrder'].includes(a.type));
      assert(forced, 'stuck: ' + JSON.stringify(s.turn) + ' ' + JSON.stringify(cands.slice(0, 3)));
      s = E.apply(s, forced[0], forced[1]);
    }
    checkInvariants(s);
    // view must never leak the deck order
    const v = E.view(s);
    assert(!('playerDeck' in v) && !('infectionDeck' in v));
  }
  return s;
}

const N = Number(process.argv[2] || 300);
const tally = {};
for (let i = 0; i < N; i++) {
  const s = playOne(2 + (i % 4), 4 + (i % 4));
  const key = s.status === 'won' ? 'won' : s.result;
  tally[key] = (tally[key] || 0) + 1;
}
console.log(`Played ${N} random games without errors:`, tally);
