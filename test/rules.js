// Targeted rule scenarios.
const assert = require('assert');
const E = require('../public/shared/engine');
const D = require('../public/shared/data');

const CITY_NAMES = Object.keys(D.CITIES);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error(`FAIL: ${name}\n`, e); process.exitCode = 1; }
}

// Fresh game with an empty board, chosen roles, player 0 to act.
function fresh(roles, hands = [], challenges = {}) {
  const s = E.createGame({ players: roles.map((role, i) => ({ name: 'P' + i, role })), epidemics: 5, eventCount: 0, challenges });
  CITY_NAMES.forEach(c => s.colors.forEach(col => { s.supply[col] += s.cubes[c][col]; s.cubes[c][col] = 0; }));
  s.players.forEach((p, i) => { s.playerDiscard.push(...p.hand); p.hand = hands[i] || []; });
  s.playerDiscard = s.playerDiscard.filter(c => !s.players.some(p => p.hand.includes(c)));
  s.current = 0;
  s.turn = { phase: 'actions', actionsLeft: roles[0] === 'generalist' ? 5 : 4, actionsTaken: 0, drawsLeft: 0, flags: {} };
  return s;
}
const expectFail = (fn, re) => assert.throws(fn, (e) => e instanceof E.GameError && (!re || re.test(e.message)));

test('drive, direct and charter flights', () => {
  let s = fresh(['scientist', 'medic'], [['Tokyo', 'Austin']]);
  s = E.apply(s, 0, { type: 'move', to: 'Chicago', method: 'drive' });
  assert.strictEqual(s.players[0].location, 'Chicago');
  expectFail(() => E.apply(s, 0, { type: 'move', to: 'Paris', method: 'drive' }));
  s = E.apply(s, 0, { type: 'move', to: 'Tokyo', method: 'direct' });
  assert(!s.players[0].hand.includes('Tokyo'));
  s.players[0].hand.push('Tokyo');
  s = E.apply(s, 0, { type: 'move', to: 'Lima', method: 'charter' });
  assert.strictEqual(s.turn.actionsLeft, 1);
  s = E.apply(s, 0, { type: 'pass' });
  assert.strictEqual(s.turn.phase, 'actions', 'waits for End turn');
  expectFail(() => E.apply(s, 0, { type: 'pass' }), /No actions left/);
  s = E.apply(s, 0, { type: 'endActions' });
  assert.strictEqual(s.turn.phase, 'draw');
});

test('restart turn restores the start of the turn', () => {
  let s = E.createGame({ players: [{ name: 'A', role: 'scientist' }, { name: 'B', role: 'medic' }], epidemics: 4, eventCount: 0 });
  const cur = s.current;
  const start = JSON.stringify({ ...s, turnStart: null, log: null, logCount: null });
  assert.strictEqual(E.view(s).canRestart, false, 'nothing to undo yet');
  s = E.apply(s, cur, { type: 'move', to: 'Chicago', method: 'drive' });
  s = E.apply(s, cur, { type: 'pass' });
  assert.strictEqual(E.view(s).canRestart, true);
  expectFail(() => E.apply(s, 1 - cur, { type: 'restartTurn' }), /not your turn/);
  s = E.apply(s, cur, { type: 'restartTurn' });
  assert.strictEqual(JSON.stringify({ ...s, turnStart: null, log: null, logCount: null }), start);
  assert(/restarted/.test(s.log[s.log.length - 1].msg));
  assert(!('turnStart' in E.view(s)), 'snapshot never sent to clients');
  s = E.apply(s, cur, { type: 'endActions' });
  expectFail(() => E.apply(s, cur, { type: 'restartTurn' }), /Nothing to restart/);
});

test('restart is locked after Forecast reveals cards', () => {
  let s = fresh(['scientist', 'medic'], [['E:forecast']]);
  s.turnStart = JSON.parse(JSON.stringify({ ...s, turnStart: null }));
  s = E.apply(s, 0, { type: 'playEvent', card: 'E:forecast' });
  s = E.apply(s, 0, { type: 'forecastOrder', order: s.interrupt.cards.slice() });
  expectFail(() => E.apply(s, 0, { type: 'restartTurn' }), /Forecast/);
});

test('outbreak chain and outbreak counter', () => {
  let s = fresh(['scientist', 'researcher']);
  s.cubes['Paris'].blue = 3; s.cubes['London'].blue = 3; s.supply.blue -= 6;
  s.infectionDeck.push('Paris');
  s.turn.phase = 'infect';
  s.travelBan = 1; // draw exactly one infection card
  s = E.apply(s, 0, { type: 'infect' });
  assert.strictEqual(s.outbreaks, 2, 'Paris -> London chain');
  assert.strictEqual(s.cubes['Essen'].blue, 2, 'Essen gets one from each');
  assert.strictEqual(s.cubes['Madrid'].blue, 2);
  assert.strictEqual(s.cubes['Paris'].blue, 3);
  assert.strictEqual(s.current, 1, 'turn passed');
});

test('8 outbreaks loses', () => {
  let s = fresh(['scientist', 'researcher']);
  s.outbreaks = 7; s.cubes['Lima'].yellow = 3; s.supply.yellow -= 3;
  s.infectionDeck.push('Lima');
  s.turn.phase = 'infect';
  s = E.apply(s, 0, { type: 'infect' });
  assert.strictEqual(s.status, 'lost');
});

test('quarantine specialist and medic protect', () => {
  let s = fresh(['quarantineSpecialist', 'medic']);
  s.players[1].location = 'Tokyo'; s.cures.red = 'cured';
  s.infectionDeck.push('Tokyo', 'Washington');
  s.turn.phase = 'infect';
  s = E.apply(s, 0, { type: 'infect' });
  assert.strictEqual(s.cubes['Washington'].blue, 0, 'QS adjacent protection');
  assert.strictEqual(s.cubes['Tokyo'].red, 0, 'Medic cured protection');
});

test('cure, medic auto-treat, eradication, win', () => {
  const blue = ['Austin', 'Chicago', 'Montreal', 'Boston', 'Washington'];
  let s = fresh(['scientist', 'medic'], [blue.slice(0, 4)]);
  s.cubes['Paris'].blue = 2; s.supply.blue -= 2; s.players[1].location = 'Paris';
  s.cures.yellow = s.cures.black = 'cured';
  s = E.apply(s, 0, { type: 'cure', color: 'blue', cards: blue.slice(0, 4) });
  assert.strictEqual(s.cubes['Paris'].blue, 0, 'medic removes on cure');
  assert.strictEqual(s.cures.blue, 'eradicated');
  assert.strictEqual(s.rvdColor, 'blue');
  s.players[0].hand = ['Tokyo', 'Seoul', 'Beijing', 'Osaka'];
  s = E.apply(s, 0, { type: 'cure', color: 'red', cards: s.players[0].hand.slice() });
  assert.strictEqual(s.status, 'won');
});

test('non-scientist needs 5; field operative samples', () => {
  const blue = ['Chicago', 'Montreal', 'Boston', 'Washington'];
  let s = fresh(['fieldOperative', 'medic'], [blue.slice()]);
  expectFail(() => E.apply(s, 0, { type: 'cure', color: 'blue', cards: blue }), /exactly 5/);
  s.cubes['Austin'].blue = 3; s.supply.blue -= 3;
  s = E.apply(s, 0, { type: 'fieldSample', color: 'blue' });
  expectFail(() => E.apply(s, 0, { type: 'fieldSample', color: 'blue' }), /Already/);
  s.players[0].samples.blue = 3; s.cubes['Austin'].blue = 0;
  s = E.apply(s, 0, { type: 'cure', color: 'blue', cards: blue.slice(0, 3), useSamples: true });
  assert.strictEqual(s.cures.blue, 'eradicated');
  assert.strictEqual(s.supply.blue, 24);
});

test('epidemic: increase, infect bottom with 3, pause, intensify', () => {
  let s = fresh(['scientist', 'researcher']);
  s.playerDeck.push('Lima', 'EPIDEMIC9');
  const bottom = s.infectionDeck[0];
  s.turn.phase = 'draw';
  s = E.apply(s, 0, { type: 'draw' });
  assert.strictEqual(s.turn.phase, 'epidemic');
  assert.strictEqual(s.rateIdx, 1);
  assert.strictEqual(s.cubes[bottom][D.CITIES[bottom].color], 3);
  assert(s.infectionDiscard.includes(bottom));
  const discards = s.infectionDiscard.length;
  s = E.apply(s, 0, { type: 'continue' });
  assert.strictEqual(s.infectionDiscard.length, 0);
  assert(s.infectionDeck.slice(-discards).includes(bottom));
  assert.strictEqual(s.turn.phase, 'infect');
  assert(s.players[0].hand.includes('Lima'));
});

test('hand limit blocks progress; archivist holds 8', () => {
  let s = fresh(['archivist', 'researcher'], [CITY_NAMES.slice(0, 8), CITY_NAMES.slice(10, 18)]);
  expectFail(() => E.apply(s, 0, { type: 'pass' }), /hand limit/);
  s = E.apply(s, 1, { type: 'discard', card: CITY_NAMES[10] });
  s = E.apply(s, 0, { type: 'pass' });
});

test('share knowledge and researcher', () => {
  let s = fresh(['scientist', 'researcher'], [['Austin', 'Paris'], ['Tokyo']]);
  expectFail(() => E.apply(s, 0, { type: 'share', mode: 'give', other: 1, card: 'Paris' }));
  s = E.apply(s, 0, { type: 'share', mode: 'take', other: 1, card: 'Tokyo' });
  s = E.apply(s, 0, { type: 'share', mode: 'give', other: 1, card: 'Austin' });
  assert.deepStrictEqual(s.players[1].hand, ['Austin']);
});

test('dispatcher, ops expert, troubleshooter, generalist, containment', () => {
  let s = fresh(['dispatcher', 'medic'], [['Tokyo']]);
  s.players[1].location = 'Lima';
  s = E.apply(s, 0, { type: 'move', pawn: 1, to: 'Austin', method: 'dispatch' });
  s = E.apply(s, 0, { type: 'move', pawn: 1, to: 'Tokyo', method: 'direct' });
  assert.strictEqual(s.players[1].location, 'Tokyo');

  s = fresh(['opsExpert', 'medic'], [['Lima']]);
  s = E.apply(s, 0, { type: 'move', to: 'Sydney', method: 'ops', card: 'Lima' });
  assert.strictEqual(s.players[0].location, 'Sydney');
  s = E.apply(s, 0, { type: 'build' });
  assert(s.stations.includes('Sydney'));

  s = fresh(['troubleshooter', 'medic'], [['Cairo']]);
  s = E.apply(s, 0, { type: 'move', to: 'Cairo', method: 'troubleshooter' });
  assert(s.players[0].hand.includes('Cairo'));
  assert.strictEqual(E.view(s).peek.length, 2);

  s = fresh(['generalist', 'medic']);
  assert.strictEqual(s.turn.actionsLeft, 5);

  s = fresh(['containmentSpecialist', 'medic']);
  s.cubes['Chicago'].blue = 3; s.cubes['Chicago'].red = 1; s.supply.blue -= 3; s.supply.red -= 1;
  s = E.apply(s, 0, { type: 'move', to: 'Chicago', method: 'drive' });
  assert.strictEqual(s.cubes['Chicago'].blue, 2);
  assert.strictEqual(s.cubes['Chicago'].red, 1);
});

test('contingency planner, epidemiologist, archivist', () => {
  let s = fresh(['contingencyPlanner', 'epidemiologist'], [[], ['Paris']]);
  s.playerDiscard.push('E:oneQuietNight');
  s = E.apply(s, 0, { type: 'contingencyTake', card: 'E:oneQuietNight' });
  s = E.apply(s, 0, { type: 'playEvent', card: 'E:oneQuietNight', fromStored: true });
  assert(s.quietNight && s.removed.includes('E:oneQuietNight'));

  s = fresh(['epidemiologist', 'scientist'], [[], ['Paris']]);
  s = E.apply(s, 0, { type: 'epidemiologistTake', from: 1, card: 'Paris' });
  assert.strictEqual(s.turn.actionsLeft, 4);
  assert(s.players[0].hand.includes('Paris'));

  s = fresh(['archivist', 'scientist']);
  if (!s.playerDiscard.includes('Austin')) s.playerDiscard.push('Austin');
  s.playerDeck = s.playerDeck.filter(c => c !== 'Austin');
  s = E.apply(s, 0, { type: 'archivistRetrieve' });
  assert(s.players[0].hand.includes('Austin'));
});

test('events: forecast, grant, travel ban, borrowed time, RVD, remote treatment', () => {
  let s = fresh(['scientist', 'medic'], [['E:forecast', 'E:governmentGrant', 'E:commercialTravelBan', 'E:borrowedTime']]);
  const top6 = s.infectionDeck.slice(-6);
  s = E.apply(s, 0, { type: 'playEvent', card: 'E:forecast' });
  expectFail(() => E.apply(s, 0, { type: 'pass' }), /Forecast/);
  s = E.apply(s, 0, { type: 'forecastOrder', order: top6.slice() });
  assert.strictEqual(s.infectionDeck[s.infectionDeck.length - 1], top6[0]);
  s = E.apply(s, 0, { type: 'playEvent', card: 'E:commercialTravelBan' });
  s = E.apply(s, 0, { type: 'playEvent', card: 'E:governmentGrant', params: { city: 'Lima' } });
  s = E.apply(s, 0, { type: 'playEvent', card: 'E:borrowedTime' });
  assert.strictEqual(s.turn.actionsLeft, 6);
  s = E.apply(s, 0, { type: 'endActions' });
  s.playerDeck.push('Tokyo', 'Seoul');
  s = E.apply(s, 0, { type: 'draw' });
  const before = s.infectionDiscard.length;
  s = E.apply(s, 0, { type: 'infect' });
  assert.strictEqual(s.infectionDiscard.length, before + 1, 'travel ban: 1 card');

  const blue = ['Austin', 'Chicago', 'Montreal', 'Boston'];
  s = fresh(['scientist', 'medic'], [blue.slice(), ['E:rapidVaccineDeployment', 'E:remoteTreatment']]);
  s.cubes['Paris'].blue = 3; s.cubes['London'].blue = 2; s.cubes['Lima'].blue = 1; s.supply.blue -= 6;
  s = E.apply(s, 0, { type: 'cure', color: 'blue', cards: blue });
  expectFail(() => E.apply(s, 1, { type: 'playEvent', card: 'E:rapidVaccineDeployment',
    params: { removals: [{ city: 'Paris', n: 3 }, { city: 'Lima', n: 1 }] } }), /connected/);
  s = E.apply(s, 1, { type: 'playEvent', card: 'E:rapidVaccineDeployment',
    params: { removals: [{ city: 'Paris', n: 3 }, { city: 'London', n: 2 }] } });
  s = E.apply(s, 1, { type: 'playEvent', card: 'E:remoteTreatment', params: { removals: [{ city: 'Lima', color: 'blue' }] } });
  assert.strictEqual(s.cures.blue, 'eradicated');
});

test('6 stations max', () => {
  let s = fresh(['opsExpert', 'medic']);
  s.stations = ['Austin', 'Paris', 'Tokyo', 'Lima', 'Cairo', 'Sydney'];
  s.players[0].location = 'Chicago';
  expectFail(() => E.apply(s, 0, { type: 'build' }), /pick one/);
  s = E.apply(s, 0, { type: 'build', remove: 'Sydney' });
  assert(s.stations.includes('Chicago') && !s.stations.includes('Sydney'));
});

test('setup distribution', () => {
  for (let n = 2; n <= 5; n++) {
    const s = E.createGame({ players: Array.from({ length: n }, (_, i) => ({ name: 'P' + i })), epidemics: 6 });
    const total = CITY_NAMES.reduce((t, c) => t + D.COLORS.reduce((u, col) => u + s.cubes[c][col], 0), 0);
    assert.strictEqual(total, 18);
    assert.strictEqual(s.playerDeck.filter(E.isEpidemic).length, 6);
    assert.strictEqual(s.players[0].hand.length, { 2: 4, 3: 3, 4: 2, 5: 2 }[n]);
    assert.strictEqual(new Set(s.players.map(p => p.role)).size, n);
  }
});

// ---------------------------------------------------------------- Virulent Strain
const put = (s, city, color, n) => { s.cubes[city][color] += n; s.supply[color] -= n; };

test('virulent strain: chosen by most cubes, effects apply', () => {
  let s = fresh(['scientist', 'medic'], [], { virulent: true });
  assert(s.playerDeck.filter(E.isEpidemic).every(c => c.startsWith('EPIDEMIC-VS:')), 'VS epidemic cards used');
  put(s, 'Tokyo', 'red', 2); put(s, 'Seoul', 'red', 2);
  s.playerDeck.push('Lima', 'EPIDEMIC-VS:slipperySlope');
  s.infectionDeck = s.infectionDeck.filter(c => c !== 'Lima'); s.infectionDeck.unshift('Lima'); // bottom: Lima (yellow, 3)
  s = E.apply(s, 0, { type: 'endActions' });
  s = E.apply(s, 0, { type: 'draw' });
  assert.strictEqual(s.virulent, 'red', 'red has the most cubes (4 > 3)');
  assert.deepStrictEqual(s.vsEffects, ['slipperySlope']);
  s = E.apply(s, 0, { type: 'continue' });
  // Slippery Slope: red outbreak counts 2
  put(s, 'Osaka', 'red', 3);
  s.infectionDeck.push('Osaka');
  s.travelBan = 1;
  s = E.apply(s, 0, { type: 'infect' });
  assert.strictEqual(s.outbreaks, 2);
});

test('virulent strain: complex molecular structure, government interference, chronic, rate effect', () => {
  const reds = ['Tokyo', 'Seoul', 'Beijing', 'Osaka', 'Taipei'];
  let s = fresh(['scientist', 'medic'], [reds.slice()], { virulent: true });
  s.virulent = 'red'; s.vsEffects = ['complexMolecularStructure', 'governmentInterference', 'chronicEffect', 'rateEffect'];
  assert.strictEqual(E.cardsNeededForCure(s, s.players[0], 'red', false), 5, 'scientist needs 4+1');
  expectFail(() => E.apply(s, 0, { type: 'cure', color: 'red', cards: reds.slice(0, 4) }), /exactly 5/);
  // Government interference
  put(s, 'Austin', 'red', 2);
  expectFail(() => E.apply(s, 0, { type: 'move', to: 'Chicago', method: 'drive' }), /Government Interference/);
  s = E.apply(s, 0, { type: 'treat', color: 'red' });
  s = E.apply(s, 0, { type: 'move', to: 'Chicago', method: 'drive' });
  // Chronic: red city with no red cubes gets 2; Rate Effect draws 1 extra
  s = E.apply(s, 0, { type: 'endActions' });
  s.playerDeck.push('Lima', 'Bogota');
  s = E.apply(s, 0, { type: 'draw' });
  s.infectionDeck = s.infectionDeck.filter(c => !['Manila', 'Cairo', 'Lagos', 'Paris'].includes(c));
  s.infectionDeck.push('Paris', 'Lagos', 'Cairo', 'Manila'); // top: Manila (red), Cairo, then Lagos (the extra), Paris untouched
  s = E.apply(s, 0, { type: 'infect' });
  assert.strictEqual(s.cubes['Manila'].red, 2, 'chronic effect');
  assert.strictEqual(s.cubes['Cairo'].black, 1);
  assert.strictEqual(s.cubes['Lagos'].yellow, 1, 'rate effect extra card');
  assert.strictEqual(s.cubes['Paris'].blue, 0);
});

test('virulent strain: immediate effects', () => {
  let s = fresh(['scientist', 'medic'], [], { virulent: true });
  s.virulent = 'blue';
  put(s, 'Paris', 'blue', 1); put(s, 'Essen', 'blue', 1); put(s, 'Milan', 'blue', 2);
  s.playerDeck.push('Lima', 'EPIDEMIC-VS:uncountedPopulations');
  s.infectionDeck = s.infectionDeck.filter(c => c !== 'Sydney'); s.infectionDeck.unshift('Sydney');
  s = E.apply(s, 0, { type: 'endActions' });
  s = E.apply(s, 0, { type: 'draw' });
  assert.strictEqual(s.cubes['Paris'].blue, 2); assert.strictEqual(s.cubes['Essen'].blue, 2); assert.strictEqual(s.cubes['Milan'].blue, 2);

  s = fresh(['scientist', 'medic'], [], { virulent: true });
  s.virulent = 'red';
  s.playerDeck.push('Lima', 'EPIDEMIC-VS:unacceptableLoss');
  s.infectionDeck = s.infectionDeck.filter(c => c !== 'Sydney'); s.infectionDeck.unshift('Sydney');
  s = E.apply(s, 0, { type: 'endActions' });
  s = E.apply(s, 0, { type: 'draw' });
  assert.strictEqual(s.boxed.red, 4);
  assert.strictEqual(s.supply.red, 24 - 3 - 4);

  s = fresh(['scientist', 'medic'], [], { virulent: true });
  s.virulent = 'blue'; s.cures.blue = 'eradicated';
  s.infectionDiscard = ['Paris', 'Cairo'];
  s.playerDeck.push('Lima', 'EPIDEMIC-VS:hiddenPocket');
  s.infectionDeck = s.infectionDeck.filter(c => !['Sydney', 'Paris', 'Cairo'].includes(c)); s.infectionDeck.unshift('Sydney');
  s = E.apply(s, 0, { type: 'endActions' });
  s = E.apply(s, 0, { type: 'draw' });
  assert.strictEqual(s.cures.blue, 'cured', 'no longer eradicated');
  assert.strictEqual(s.cubes['Paris'].blue, 1);
});

// ---------------------------------------------------------------- Mutation
test('mutation: setup', () => {
  const s = E.createGame({ players: [{ name: 'A' }, { name: 'B' }], epidemics: 5, challenges: { mutation: true } });
  assert.strictEqual(s.supply.purple, 12);
  assert.strictEqual(s.infectionDiscard.filter(E.isMutationCard).length, 2);
  assert.strictEqual(s.playerDeck.filter(E.isMutationEvent).length, 3);
});

test('mutation: mutation card, double infection, mutation events, purple cure and win', () => {
  let s = fresh(['scientist', 'medic'], [], { mutation: true });
  s.infectionDiscard = [];
  s.infectionDeck = s.infectionDeck.filter(c => !['Lima', 'Cairo'].includes(c));
  s.infectionDeck.unshift('Lima'); // bottom
  s.infectionDeck.push('Cairo', 'MUTATION1'); // top: mutation card, then Cairo
  put(s, 'Cairo', 'purple', 1);
  s = E.apply(s, 0, { type: 'endActions' });
  s.playerDeck.push('Bogota', 'ME:intensifies');
  s = E.apply(s, 0, { type: 'draw' });
  assert(s.playerDiscard.includes('ME:intensifies') && !s.players[0].hand.includes('ME:intensifies'));
  s = E.apply(s, 0, { type: 'infect' });
  assert.strictEqual(s.cubes['Lima'].purple, 1, 'mutation card: bottom card gets purple');
  assert.strictEqual(s.cubes['Lima'].yellow, 0, 'and not its own color');
  assert.strictEqual(s.cubes['Cairo'].purple, 2, 'purple city infected: +1 purple');
  assert.strictEqual(s.cubes['Cairo'].black, 1, 'and +1 own color');

  // Purple cure: 4 cards (scientist) of any color, at least one from a city with purple cubes
  s = fresh(['scientist', 'medic'], [['Paris', 'Tokyo', 'Lagos', 'Delhi']], { mutation: true });
  expectFail(() => E.apply(s, 0, { type: 'cure', color: 'purple', cards: ['Paris', 'Tokyo', 'Lagos', 'Delhi'] }), /purple cubes/);
  put(s, 'Delhi', 'purple', 1);
  s.cures.blue = s.cures.yellow = s.cures.black = s.cures.red = 'cured';
  s = E.apply(s, 0, { type: 'cure', color: 'purple', cards: ['Paris', 'Tokyo', 'Lagos', 'Delhi'] });
  assert.strictEqual(s.status, 'won');

  // Win with 4 cures and no purple on the board
  s = fresh(['scientist', 'medic'], [], { mutation: true });
  s.cures.blue = s.cures.yellow = s.cures.black = 'cured';
  s.players[0].hand = ['Tokyo', 'Seoul', 'Beijing', 'Osaka'];
  s = E.apply(s, 0, { type: 'cure', color: 'red', cards: s.players[0].hand.slice() });
  assert.strictEqual(s.status, 'won');
});

test('events: travel ban any time, mobile hospital only when driving, resilient population vs mutation', () => {
  let s = fresh(['scientist', 'medic'], [[], ['E:commercialTravelBan', 'E:mobileHospital', 'E:resilientPopulation']], { mutation: true });
  s = E.apply(s, 0, { type: 'pass' });
  s = E.apply(s, 1, { type: 'playEvent', card: 'E:commercialTravelBan' });
  assert.strictEqual(s.travelBan, 0, "lasts until the current player's next turn");
  s = E.apply(s, 1, { type: 'playEvent', card: 'E:mobileHospital' });
  put(s, 'Chicago', 'blue', 2); put(s, 'Lima', 'yellow', 1);
  s.players[0].hand.push('Lima');
  s = E.apply(s, 0, { type: 'move', to: 'Chicago', method: 'drive' });
  assert.strictEqual(s.cubes['Chicago'].blue, 1, 'drive: removes a cube');
  s = E.apply(s, 0, { type: 'move', to: 'Lima', method: 'direct' });
  assert.strictEqual(s.cubes['Lima'].yellow, 1, 'flight: no removal');
  s.infectionDiscard.push('MUTATION1');
  s.infectionDeck = s.infectionDeck.filter(c => c !== 'MUTATION1');
  expectFail(() => E.apply(s, 1, { type: 'playEvent', card: 'E:resilientPopulation', params: { card: 'MUTATION1' } }), /Mutation/);
});

console.log(`${passed} rule tests passed`);
