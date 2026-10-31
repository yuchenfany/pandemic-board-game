// Pandemic rules engine (base game + On the Brink roles, events, Virulent Strain and Mutation challenges).
// Pure state-in / state-out; runs in the host's browser (authoritative) and in every browser (move hints).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.Engine = factory(root.PData);
}(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';
  const { CITIES, ADJ, COLORS, ROLES, EVENTS, VIRULENT, MUTATION_EVENTS, SEQUENCES, SEQ_BY_ID } = D;
  const CITY_NAMES = Object.keys(CITIES);
  const RATES = [2, 2, 2, 3, 3, 4, 4];
  const HAND_SIZE = { 2: 4, 3: 3, 4: 2, 5: 2 };
  const MAX_OUTBREAKS = 8;
  const CUBES_PER_COLOR = 24;
  const PURPLE_CUBES = 12;
  const MAX_STATIONS = 6;
  const FORECAST_COUNT = 6;

  class GameError extends Error {}
  const fail = (msg) => { throw new GameError(msg); };

  // Card ids: city name | 'E:<event>' | 'EPIDEMIC<n>' | 'EPIDEMIC-VS:<effect>' | 'ME:<mutation event>' (player deck)
  //           city name | 'MUTATION<n>' (infection deck)
  const isCity = (c) => typeof c === 'string' && !!CITIES[c];
  const isEvent = (c) => typeof c === 'string' && c.startsWith('E:');
  const isEpidemic = (c) => typeof c === 'string' && c.startsWith('EPIDEMIC');
  const isMutationEvent = (c) => typeof c === 'string' && c.startsWith('ME:');
  const isMutationCard = (c) => typeof c === 'string' && c.startsWith('MUTATION');
  const vsKeyOf = (c) => (typeof c === 'string' && c.startsWith('EPIDEMIC-VS:') ? c.slice(12) : null);
  const eventKey = (c) => c.slice(2);
  function cardName(c) {
    if (isEvent(c)) return EVENTS[eventKey(c)].name;
    if (isMutationEvent(c)) return MUTATION_EVENTS[c.slice(3)].name;
    if (isMutationCard(c)) return 'Mutation';
    if (vsKeyOf(c)) return `Epidemic: ${VIRULENT[vsKeyOf(c)].name}`;
    if (isEpidemic(c)) return 'Epidemic';
    return c;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const removeOne = (arr, item) => {
    const i = arr.indexOf(item);
    if (i < 0) return false;
    arr.splice(i, 1);
    return true;
  };

  function log(s, msg) {
    s.logCount = (s.logCount || 0) + 1;
    s.log.push({ turn: s.turnNo, msg });
    if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
  }

  const zeroCubes = (colors) => Object.fromEntries(colors.map(c => [c, 0]));
  const vsOn = (s, key) => !!s.virulent && (s.vsEffects || []).includes(key);

  // Lasting/reminder events (Improved Sanitation, Infection Zone Ban, Sequencing Breakthrough).
  const REMINDER_EVENTS = { improvedSanitation: true, infectionZoneBan: true, sequencingBreakthrough: true };
  const hasActive = (s, key) => (s.activeEvents || []).some(e => e.key === key);
  // When a reminder event ends, its card finally goes to the discard pile (or out of the game if it was stored).
  function disposeEventCard(s, e) {
    if (e.disp === 'removed') s.removed.push(e.card);
    else s.playerDiscard.push(e.card);
  }
  function expireEvents(s, pred) {
    if (!s.activeEvents) return;
    s.activeEvents = s.activeEvents.filter(e => {
      if (!pred(e)) return true;
      disposeEventCard(s, e);
      log(s, `${EVENTS[e.key].name} has ended.`);
      return false;
    });
  }

  // ---------------------------------------------------------------- setup

  // excludedRoles: roles a "Random" player can't be given (players may still pick them).
  // customEvents: also shuffle the custom events (New Route, Border Closure) into the deck.
  function createGame({ players, epidemics = 5, eventCount, challenges = {}, excludedRoles = [], customEvents = false, mode = 'coop' }) {
    const n = players.length;
    const solo = mode === 'solo';
    if (solo) { if (n !== 1) fail('The solo game is for 1 player'); }
    else if (n < 2 || n > 5) fail('Pandemic needs 2 to 5 players');
    if (epidemics < 4 || epidemics > 7) fail('Epidemics must be 4-7');
    const mutation = !!challenges.mutation, virulent = !!challenges.virulent;
    const worldwidePanic = mutation && !!challenges.worldwidePanic;
    const lab = !!challenges.lab;
    const purpleCubes = worldwidePanic ? 24 : PURPLE_CUBES;

    const roleKeys = Object.keys(ROLES);
    const chosen = players.map(p => p.role).filter(Boolean);
    if (new Set(chosen).size !== chosen.length) fail('Two players picked the same role');
    chosen.forEach(r => { if (!ROLES[r]) fail(`Unknown role ${r}`); });
    // The Field Operative is not used in the Lab challenge (its samples clash with lab samples).
    // The solo game also sets aside the Dispatcher, Researcher, Epidemiologist and Local Liaison.
    const modeExcluded = (lab ? ['fieldOperative'] : [])
      .concat(solo ? ['dispatcher', 'researcher', 'epidemiologist', 'localLiaison'] : []);
    const freeRoles = shuffle(roleKeys.filter(r => !chosen.includes(r) && !excludedRoles.includes(r) && !modeExcluded.includes(r)));
    if (players.filter(p => !p.role).length > freeRoles.length) fail('Not enough roles left for the Random players (too many excluded)');

    const colors = mutation ? [...COLORS, 'purple'] : COLORS.slice();
    const s = {
      challenges: { mutation, virulent, worldwidePanic, lab },
      colors,
      cubeMax: Object.fromEntries(colors.map(c => [c, c === 'purple' ? purpleCubes : CUBES_PER_COLOR])),
      players: [],
      cubes: Object.fromEntries(CITY_NAMES.map(c => [c, zeroCubes(colors)])),
      supply: Object.fromEntries(colors.map(c => [c, c === 'purple' ? purpleCubes : CUBES_PER_COLOR])),
      boxed: zeroCubes(colors), // cubes removed from the game (Unacceptable Loss)
      activeEvents: [], // lasting/reminder events in play (Improved Sanitation, Infection Zone Ban, Sequencing Breakthrough)
      links: { added: [], cut: [] }, // connections changed by New Route / Border Closure, as sorted [a, b] pairs
      stations: ['Austin'],
      cures: Object.fromEntries(colors.map(c => [c, 'none'])), // none | cured | eradicated
      rateIdx: 0,
      outbreaks: 0,
      epidemics,
      playerDeck: [], // top of deck = end of array
      playerDiscard: [],
      infectionDeck: shuffle(CITY_NAMES), // top = end, bottom = index 0
      infectionDiscard: [],
      removed: [],
      virulent: null, // Virulent Strain color once determined
      vsEffects: [], // continuing Virulent Strain effects in play
      vsPlayed: [], // every Virulent Strain epidemic drawn so far
      current: 0,
      turnNo: 1,
      turn: null,
      interrupt: null,
      quietNight: false,
      travelBan: null, // Commercial Travel Ban lasts until this player's next turn begins
      rvdColor: null, // Rapid Vaccine Deployment window after a cure
      solo, // solo game: 1 human player plus the CDC
      cdc: null, // the CDC's face-up cards and state (solo only)
      removedRoles: [], // roles taken out of the game by the CDC's Reassign action
      status: 'playing',
      result: null,
      log: [],
    };

    // Initial infections happen before pawns are placed, so no role protects them.
    log(s, 'Setting up initial infections.');
    // Worldwide Panic seeds extra purple cubes on the 1st, 4th and 7th cities drawn.
    const wwpPurple = { 0: 1, 3: 2, 6: 3 };
    [3, 3, 3, 2, 2, 2, 1, 1, 1].forEach((count, i) => {
      const card = s.infectionDeck.pop();
      placeCubes(s, card, CITIES[card].color, count, new Set());
      s.infectionDiscard.push(card);
      log(s, `${card} infected with ${count} ${CITIES[card].color} cube${count > 1 ? 's' : ''}.`);
      if (worldwidePanic && wwpPurple[i]) {
        placeCubes(s, card, 'purple', wwpPurple[i], new Set());
        log(s, `${card} also seeded with ${wwpPurple[i]} purple cube${wwpPurple[i] > 1 ? 's' : ''} (Worldwide Panic).`);
      }
    });
    if (mutation) s.infectionDiscard.push('MUTATION1', 'MUTATION2');

    s.players = players.map(p => ({
      name: p.name,
      role: p.role || freeRoles.pop(),
      location: 'Austin',
      hand: [],
      stored: null, // Contingency Planner
      samples: zeroCubes(colors), // Field Operative
    }));

    let deck;
    if (solo) {
      // Solo: seed the Player Discard with difficulty cards, use 4 events (no Special Orders),
      // deal the human 4 cards and the CDC its own set of 4.
      const seedCount = { 4: 8, 5: 12, 6: 14, 7: 16 }[epidemics] || 12;
      let cityDeck, seeds;
      do { cityDeck = shuffle(CITY_NAMES); seeds = cityDeck.slice(0, seedCount); }
      while (COLORS.some(col => seeds.filter(c => CITIES[c].color === col).length > 6));
      s.playerDiscard.push(...seeds);
      log(s, `Solo setup: ${seedCount} City cards set aside in the discard pile.`);
      const soloEvents = shuffle(Object.keys(EVENTS).filter(k => EVENTS[k].set !== 'custom' && k !== 'specialOrders')).slice(0, 4)
        .concat(customEvents ? Object.keys(EVENTS).filter(k => EVENTS[k].set === 'custom') : []).map(k => 'E:' + k);
      deck = shuffle(cityDeck.slice(seedCount).concat(soloEvents));
      for (let i = 0; i < 4; i++) s.players[0].hand.push(deck.pop());
      s.cdc = { hand: [] };
      for (let i = 0; i < 4; i++) s.cdc.hand.push(deck.pop());
    } else {
      const allEvents = Object.keys(EVENTS).filter(k => EVENTS[k].set !== 'custom');
      const numEvents = Math.max(0, Math.min(allEvents.length, eventCount == null ? 2 * n : eventCount));
      const events = shuffle(allEvents).slice(0, numEvents)
        .concat(customEvents ? Object.keys(EVENTS).filter(k => EVENTS[k].set === 'custom') : []).map(k => 'E:' + k);
      deck = shuffle(CITY_NAMES.concat(events));
      const handSize = HAND_SIZE[n];
      s.players.forEach(p => { for (let i = 0; i < handSize; i++) p.hand.push(deck.pop()); });
    }
    if (mutation) deck = shuffle(deck.concat(Object.keys(MUTATION_EVENTS).map(k => 'ME:' + k)));

    const epidemicCards = virulent
      ? shuffle(Object.keys(VIRULENT)).slice(0, epidemics).map(k => 'EPIDEMIC-VS:' + k)
      : Array.from({ length: epidemics }, (_, i) => 'EPIDEMIC' + (i + 1));
    // Split into piles (larger piles on top), shuffle an epidemic into each, stack them.
    const piles = [];
    const base = Math.floor(deck.length / epidemics), extra = deck.length % epidemics;
    let pos = 0;
    for (let i = 0; i < epidemics; i++) {
      const size = base + (i < extra ? 1 : 0);
      piles.push(shuffle(deck.slice(pos, pos + size).concat([epidemicCards[i]])));
      pos += size;
    }
    for (let i = piles.length - 1; i >= 0; i--) s.playerDeck.push(...piles[i]);

    if (lab) {
      const labDeck = shuffle(SEQUENCES.map(c => c.id));
      const newLine = () => ({ seqId: null, color: null, charCard: null, testCard: null, tested: false, filled: [] });
      s.lab = {
        lines: [newLine(), newLine()],
        dishes: Object.fromEntries(['sampleA', 'sampleB', 'centrifuge', 'separator', 'growth'].map(d => [d, zeroCubes(colors)])),
        deck: labDeck,
        discard: [],
      };
      placeSequence(s, 0, labDeck.pop()); // the first research line starts with a Sequence card
      log(s, 'Challenge: Lab — cures must be built in the lab before they can be discovered.');
    }
    if (virulent) log(s, 'Challenge: Virulent Strain.');
    if (mutation) log(s, 'Challenge: Mutation (purple disease, 12 cubes).');
    s.players.forEach(p => log(s, `${p.name} is the ${ROLES[p.role].name}.`));
    const first = Math.floor(Math.random() * n);
    log(s, `${s.players[first].name} goes first.`);
    startTurn(s, first);
    return s;
  }

  function startTurn(s, idx) {
    s.current = idx;
    if (s.travelBan === idx) {
      s.travelBan = null;
      log(s, 'Commercial Travel Ban has ended.');
    }
    // Improved Sanitation / Infection Zone Ban last until their player's next turn begins.
    expireEvents(s, (e) => (e.key === 'improvedSanitation' || e.key === 'infectionZoneBan') && e.owner === idx);
    s.turn = {
      phase: 'actions', // actions | draw | epidemic | infect | over
      actionsLeft: s.players[idx].role === 'generalist' ? 5 : 4,
      actionsTaken: 0,
      pending: [], // drawn player cards still to resolve
      flags: {},
    };
    // Snapshot for "Restart turn" (everything except the snapshot itself).
    s.turnStart = null;
    s.turnStart = JSON.parse(JSON.stringify(s));
  }

  // ---------------------------------------------------------------- helpers

  const handLimit = (p) => p.role === 'archivist' ? 8 : 7;
  const overLimit = (s) => s.players.map((p, i) => (p.hand.length > handLimit(p) ? i : -1)).filter(i => i >= 0);
  const boardCount = (s, color) => CITY_NAMES.reduce((t, c) => t + s.cubes[c][color], 0);

  function lose(s, reason) {
    if (s.status !== 'playing') return;
    s.status = 'lost';
    s.result = reason;
    s.turn.phase = 'over';
    log(s, `GAME OVER: ${reason}`);
  }
  // Win when the 4 standard diseases are cured and purple (if in play) is cured or off the board.
  function checkWin(s) {
    if (s.status !== 'playing') return;
    if (!COLORS.every(c => s.cures[c] !== 'none')) return;
    if (s.colors.includes('purple') && s.cures.purple === 'none' && boardCount(s, 'purple') > 0) return;
    s.status = 'won';
    s.result = s.colors.includes('purple')
      ? (s.cures.purple !== 'none' ? 'All five diseases cured!' : 'All four cures discovered and no purple disease left!')
      : 'All four cures discovered!';
    s.turn.phase = 'over';
    log(s, `VICTORY! ${s.result}`);
  }

  function removeCubes(s, city, color, n) {
    const k = Math.min(n, s.cubes[city][color]);
    s.cubes[city][color] -= k;
    s.supply[color] += k;
    return k;
  }

  function checkEradication(s) {
    s.colors.forEach(color => {
      if (s.cures[color] === 'cured' && boardCount(s, color) === 0) {
        s.cures[color] = 'eradicated';
        log(s, `The ${color} disease has been ERADICATED!`);
      }
    });
  }

  // Current connections of a city: the printed map plus New Route, minus Border Closure.
  const linkKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const hasLink = (list, a, b) => (list || []).some(([x, y]) => linkKey(x, y) === linkKey(a, b));
  // Outbreaks spread along printed connections only (minus Border Closure): New Route is for pawns, not infections.
  function infectAdj(s, city) {
    const links = s.links || { added: [], cut: [] };
    return ADJ[city].filter(nb => !hasLink(links.cut, city, nb));
  }
  function adj(s, city) {
    const links = s.links || { added: [], cut: [] };
    const out = infectAdj(s, city);
    links.added.forEach(([a, b]) => { if (a === city) out.push(b); else if (b === city) out.push(a); });
    return out;
  }

  // Shortest number of connections between two cities (Pilot flies up to 3); Infinity if farther.
  function pilotDistance(s, from, to) {
    if (from === to) return 0;
    let frontier = [from];
    const seen = new Set([from]);
    for (let d = 1; d <= 3; d++) {
      const next = [];
      for (const c of frontier) for (const nb of adj(s, c)) {
        if (seen.has(nb)) continue;
        if (nb === to) return d;
        seen.add(nb); next.push(nb);
      }
      frontier = next;
    }
    return Infinity;
  }

  function isProtected(s, city, color) {
    return s.players.some(p =>
      (p.role === 'quarantineSpecialist' && (p.location === city || adj(s, p.location).includes(city))) ||
      (p.role === 'medic' && p.location === city && s.cures[color] !== 'none'));
  }

  // Place n cubes in city, resolving outbreaks. `chain` holds cities that already outbroke this chain.
  function placeCubes(s, city, color, n, chain) {
    if (s.status !== 'playing') return;
    if (s.cures[color] === 'eradicated') return;
    if (s.players.length && isProtected(s, city, color)) {
      log(s, `Infection in ${city} was prevented.`);
      return;
    }
    for (let i = 0; i < n; i++) {
      if (s.cubes[city][color] >= 3) {
        // Infection Zone Ban: a cube that would cause a chain-reaction outbreak (one inside an
        // ongoing chain) is simply not placed, so no further outbreak happens.
        if (chain.size > 0 && hasActive(s, 'infectionZoneBan')) {
          log(s, `Infection Zone Ban: chain-reaction outbreak in ${city} ignored.`);
          return;
        }
        outbreak(s, city, color, chain);
        return;
      }
      if (s.supply[color] <= 0) { lose(s, `Ran out of ${color} disease cubes.`); return; }
      s.cubes[city][color]++;
      s.supply[color]--;
    }
  }

  function outbreak(s, city, color, chain) {
    if (chain.has(city)) return;
    chain.add(city);
    const isFirst = chain.size === 1; // this outbreak is not itself a chain reaction
    const step = (color === s.virulent && vsOn(s, 'slipperySlope')) ? 2 : 1;
    s.outbreaks += step;
    log(s, `OUTBREAK in ${city} (${color})! Outbreaks: ${Math.min(s.outbreaks, MAX_OUTBREAKS)}/${MAX_OUTBREAKS}.` +
      (step === 2 ? ' (Slippery Slope: +2)' : ''));
    if (s.outbreaks >= MAX_OUTBREAKS) { lose(s, `${MAX_OUTBREAKS} outbreaks occurred.`); return; }
    // Highly Contagious: a first (non-chain) Virulent Strain outbreak spreads 2 cubes to each city.
    const spread = (isFirst && color === s.virulent && vsOn(s, 'highlyContagious')) ? 2 : 1;
    for (const nb of infectAdj(s, city)) {
      placeCubes(s, nb, color, spread, chain);
      if (s.status !== 'playing') return;
    }
  }

  function infectCity(s, city, n, color = CITIES[city].color, note = '') {
    if (s.cures[color] === 'eradicated') log(s, `${city} drawn — ${color} is eradicated, no cubes placed.`);
    else log(s, `Infect ${city} (${n} ${color})${note}.`);
    placeCubes(s, city, color, n, new Set());
  }

  // Bottom card of the infection deck that is a city (a Mutation card found there is just discarded).
  function drawBottomCity(s) {
    while (s.infectionDeck.length && !isCity(s.infectionDeck[0])) s.infectionDiscard.push(s.infectionDeck.shift());
    return s.infectionDeck.shift() || null;
  }

  function onEnter(s, idx, method) {
    const p = s.players[idx];
    const city = p.location;
    if (p.role === 'medic') {
      s.colors.forEach(c => {
        if (s.cures[c] !== 'none' && s.cubes[city][c] > 0) {
          const k = removeCubes(s, city, c, 3);
          log(s, `Medic removed ${k} ${c} cube(s) in ${city}.`);
        }
      });
    }
    if (p.role === 'containmentSpecialist') {
      s.colors.forEach(c => {
        if (s.cubes[city][c] >= 2) {
          removeCubes(s, city, c, 1);
          log(s, `Containment Specialist removed 1 ${c} cube in ${city}.`);
        }
      });
    }
    // Mobile Hospital: only when the current player drives/ferries into a city.
    if (s.turn && s.turn.flags.mobileHospital && idx === s.current && method === 'drive') {
      const best = s.colors.filter(c => s.cubes[city][c] > 0).sort((a, b) => s.cubes[city][b] - s.cubes[city][a])[0];
      if (best) {
        removeCubes(s, city, best, 1);
        if (best === s.virulent) markVsTreated(s, city);
        log(s, `Mobile Hospital removed 1 ${best} cube in ${city}.`);
      }
    }
    checkEradication(s);
  }

  function markVsTreated(s, city) {
    s.turn.flags.vsTreated = s.turn.flags.vsTreated || [];
    if (!s.turn.flags.vsTreated.includes(city)) s.turn.flags.vsTreated.push(city);
  }

  // Government Interference: a pawn can't leave a city with Virulent Strain cubes until one was treated there this turn.
  function leaveBlocked(s, pawnIdx) {
    if (!vsOn(s, 'governmentInterference')) return null;
    const from = s.players[pawnIdx].location;
    if (s.cubes[from][s.virulent] > 0 && !((s.turn.flags.vsTreated || []).includes(from))) {
      return `Government Interference: treat at least 1 ${s.virulent} cube in ${from} before leaving`;
    }
    return null;
  }

  function movePawn(s, idx, to, method) {
    s.players[idx].location = to;
    onEnter(s, idx, method);
  }

  function discardFromHand(s, p, card) {
    if (!removeOne(p.hand, card)) fail(`${p.name} does not have ${cardName(card)}`);
    s.playerDiscard.push(card);
  }

  // Legal ways for `actorIdx` (the current player) to move `pawnIdx` to `to`.
  function getMoveOptions(s, actorIdx, pawnIdx, to) {
    const res = [];
    if (!s.turn || s.turn.phase !== 'actions' || s.turn.actionsLeft <= 0 || actorIdx !== s.current) return res;
    const actor = s.players[actorIdx], pawn = s.players[pawnIdx];
    if (!actor || !pawn || !CITIES[to]) return res;
    const from = pawn.location;
    if (from === to) return res;
    const own = actorIdx === pawnIdx;
    const dispatcher = actor.role === 'dispatcher';
    const special = s.turn.flags.specialOrders === pawnIdx;
    if (!own && !dispatcher && !special) return res;
    if (leaveBlocked(s, pawnIdx)) return res;
    // The Pilot, moving their own pawn, can only fly (up to 3 connections) — no driving or flights.
    // When another player moves the Pilot (Dispatcher / Special Orders), normal movement applies instead.
    if (own && pawn.role === 'pilot') {
      const d = pilotDistance(s, from, to);
      return (d >= 1 && d <= 3) ? [{ method: 'pilot', label: `Pilot flight (${d} connection${d > 1 ? 's' : ''})` }] : [];
    }
    const has = (c) => actor.hand.includes(c);

    // A neighbouring city is always reached by Drive/Ferry: it's free, so flights there would only waste a card.
    if (adj(s, from).includes(to)) return [{ method: 'drive', label: 'Drive / Ferry' }];
    if (has(to)) res.push({ method: 'direct', card: to, label: `Direct Flight (discard ${to})` });
    if (has(from)) res.push({ method: 'charter', card: from, label: `Charter Flight (discard ${from})` });
    if (s.stations.includes(from) && s.stations.includes(to)) res.push({ method: 'shuttle', label: 'Shuttle Flight' });
    if (dispatcher && s.players.some((q, i) => i !== pawnIdx && q.location === to)) {
      res.push({ method: 'dispatch', label: 'Dispatcher: move to a pawn' });
    }
    if (own && actor.role === 'opsExpert' && !s.turn.flags.opsMove && s.stations.includes(from)) {
      const cards = actor.hand.filter(isCity);
      if (cards.length) res.push({ method: 'ops', cards, label: 'Operations Expert move (discard any City card)' });
    }
    if (own && actor.role === 'troubleshooter' && has(to)) {
      res.push({ method: 'troubleshooter', label: `Troubleshooter flight (reveal ${to}, keep it)` });
    }
    return res;
  }

  // Cards a player could give/take in a share-knowledge action with each player in their city.
  function getShareOptions(s, pid) {
    const p = s.players[pid];
    const res = [];
    s.players.forEach((q, qi) => {
      if (qi === pid || q.location !== p.location) return;
      p.hand.filter(isCity).forEach(c => {
        if (c === p.location || p.role === 'researcher') res.push({ mode: 'give', other: qi, card: c });
      });
      q.hand.filter(isCity).forEach(c => {
        if (c === p.location || q.role === 'researcher') res.push({ mode: 'take', other: qi, card: c });
      });
    });
    return res;
  }

  // City cards needed to cure `color` (Scientist 4; Field Operative may swap 2 cards for 3 samples;
  // Complex Molecular Structure adds 1 for an uncured Virulent Strain).
  function cardsNeededForCure(s, p, color, useSamples) {
    let n = p.role === 'scientist' ? 4 : 5;
    if (s.challenges && s.challenges.lab) n = p.role === 'scientist' ? 2 : 3; // Lab: 3 (not 5), Scientist 2
    if (color && color === s.virulent && vsOn(s, 'complexMolecularStructure') && s.cures[color] === 'none') n++;
    n -= (s.activeEvents || []).filter(e => e.key === 'sequencingBreakthrough').length; // Sequencing Breakthrough
    if (useSamples) n -= 2;
    return Math.max(1, n);
  }
  // Hand cards that can count toward curing `color`.
  function cureCards(s, p, color) {
    return p.hand.filter(c => isCity(c) && (color === 'purple' || CITIES[c].color === color));
  }

  // ---------------------------------------------------------------- turn flow

  function requireActionTurn(s, pid) {
    if (pid !== s.current) fail("It's not your turn");
    if (s.turn.phase !== 'actions' || s.turn.actionsLeft <= 0) fail('No actions left this turn');
  }

  function requireCdc(s, pid) {
    if (!s.solo || !s.cdc) fail('This is not a solo game');
    if (pid !== 0) fail('Only you direct the CDC');
    if (s.turn.phase !== 'cdc') fail('The CDC acts only after you infect cities');
  }

  // The turn stays in the actions phase (so it can still be restarted) until the player ends it.
  function spendAction(s) {
    s.turn.actionsLeft--;
    s.turn.actionsTaken++;
  }

  const canRestart = (s) => !!s.turnStart && s.status === 'playing' && s.turn.phase === 'actions' &&
    !s.interrupt && !s.turn.flags.revealed;

  function determineVirulent(s) {
    const counts = COLORS.map(c => [c, boardCount(s, c)]);
    const max = Math.max(...counts.map(([, n]) => n));
    const tied = counts.filter(([, n]) => n === max).map(([c]) => c);
    s.virulent = tied[Math.floor(Math.random() * tied.length)];
    log(s, `The VIRULENT STRAIN is ${s.virulent}${tied.length > 1 ? ' (chosen at random among the tied diseases)' : ''}!`);
  }

  function applyVirulentEffect(s, key) {
    const v = s.virulent, eff = VIRULENT[key];
    s.vsPlayed.push(key);
    if (eff.continuing) {
      s.vsEffects.push(key);
      log(s, `Virulent Strain effect — ${eff.name}: ${eff.text}`);
      return;
    }
    log(s, `Virulent Strain effect — ${eff.name}.`);
    if (key === 'hiddenPocket') {
      const cities = s.infectionDiscard.filter(c => isCity(c) && CITIES[c].color === v);
      if (s.cures[v] === 'eradicated' && cities.length) {
        s.cures[v] = 'cured';
        log(s, `Hidden Pocket: ${v} is no longer eradicated!`);
        cities.forEach(c => { infectCity(s, c, 1, v, ' — Hidden Pocket'); });
      } else {
        log(s, 'Hidden Pocket has no effect.');
      }
    } else if (key === 'unacceptableLoss') {
      const k = Math.min(4, s.supply[v]);
      s.supply[v] -= k;
      s.boxed[v] += k;
      log(s, `Unacceptable Loss: ${k} ${v} cube(s) removed from the game.` +
        (s.supply[v] === 0 ? ` No ${v} cubes are left: the next ${v} cube placed loses the game.` : ''));
    } else if (key === 'uncountedPopulations') {
      const cities = CITY_NAMES.filter(c => s.cubes[c][v] === 1);
      cities.forEach(c => { if (s.status === 'playing') infectCity(s, c, 1, v, ' — Uncounted Populations'); });
      if (!cities.length) log(s, 'Uncounted Populations has no effect.');
    }
  }

  function resolveEpidemic(s, card, p) {
    s.removed.push(card);
    s.rateIdx = Math.min(s.rateIdx + 1, RATES.length - 1);
    log(s, `${p.name} drew an EPIDEMIC! Infection rate is now ${RATES[s.rateIdx]}.`);
    const bottom = drawBottomCity(s);
    if (bottom) {
      infectCity(s, bottom, 3);
      s.infectionDiscard.push(bottom);
    }
    if (s.status !== 'playing') return;
    const key = vsKeyOf(card);
    if (key) {
      if (!s.virulent) determineVirulent(s);
      applyVirulentEffect(s, key);
    }
  }

  function resolveMutationEvent(s, card, p) {
    const key = card.slice(3);
    s.playerDiscard.push(card);
    log(s, `${p.name} drew ${MUTATION_EVENTS[key].name}`);
    const active = s.cures.purple !== 'eradicated';
    if (key === 'threatens' && active) {
      const c = drawBottomCity(s);
      if (c) { infectCity(s, c, 3, 'purple', ' — Mutation'); s.infectionDiscard.push(c); }
    } else if (key === 'spreads' && active) {
      for (let i = 0; i < 3 && s.status === 'playing'; i++) {
        const c = drawBottomCity(s);
        if (c) { infectCity(s, c, 1, 'purple', ' — Mutation'); s.infectionDiscard.push(c); }
      }
    } else if (key === 'intensifies') {
      CITY_NAMES.filter(c => s.cubes[c].purple === 2).forEach(c => { if (s.status === 'playing') infectCity(s, c, 1, 'purple', ' — Mutation'); });
    } else {
      log(s, 'Purple is eradicated — no effect.');
    }
  }

  // ---------------------------------------------------------------- Lab challenge

  // Place a Sequence card id onto research line `li`, resetting its progress.
  function placeSequence(s, li, seqId) {
    const line = s.lab.lines[li];
    line.seqId = seqId;
    line.filled = seqId ? SEQ_BY_ID[seqId].spots.map(() => null) : [];
    line.color = null; line.charCard = null; line.testCard = null; line.tested = false;
  }
  // The color a spot needs: a gray ('cure') spot needs the line's cure color.
  function spotNeed(line, i) {
    const spot = SEQ_BY_ID[line.seqId].spots[i];
    return spot === 'cure' ? line.color : spot;
  }
  // A cube of `color` fills open spot i if it matches, or that spot's color is eradicated.
  function spotAccepts(s, line, i, color) {
    if (line.filled[i] != null) return false;
    const need = spotNeed(line, i);
    if (!need) return false;
    return color === need || s.cures[need] === 'eradicated';
  }
  const lineFilled = (line) => line.seqId && line.filled.length > 0 && line.filled.every(x => x != null);
  const lineComplete = (s, line) => !!line.color && line.tested && lineFilled(line);
  function clearLineCubes(s, line) {
    line.filled.forEach((c, i) => { if (c != null) { s.supply[c]++; line.filled[i] = null; } });
  }
  function emptyDishToSupply(s, dish) {
    s.colors.forEach(c => { s.supply[c] += dish[c]; dish[c] = 0; });
  }
  const dishTotal = (s, dish) => s.colors.reduce((t, c) => t + dish[c], 0);
  function requireLabStation(s, p) {
    if (!s.lab) fail('There is no lab in this game');
    if (!s.stations.includes(p.location)) fail('Lab actions must be done at a research station');
  }
  // Move cubes from a dish onto a characterized line's Sequence card; leftovers go to the supply.
  function fillCardFromDish(s, line, dish) {
    const spots = SEQ_BY_ID[line.seqId].spots;
    s.colors.forEach(color => {
      while (dish[color] > 0) {
        const i = spots.findIndex((_, idx) => spotAccepts(s, line, idx, color));
        if (i < 0) break;
        line.filled[i] = color;
        dish[color]--;
      }
    });
    emptyDishToSupply(s, dish);
  }
  // Free lab actions: the build bonus, or a role's once-per-turn lab ability. Returns the
  // free source to consume (or null, meaning it costs a normal action).
  function labFreeSource(s, p, kind) {
    if (s.turn.flags.labBonus) return 'labBonus';
    if (kind === 'process' && p.role === 'epidemiologist' && !s.turn.flags.epiProcess) return 'epiProcess';
    if (kind === 'sequence' && p.role === 'researcher' && !s.turn.flags.resSequence) return 'resSequence';
    if ((kind === 'characterize' || kind === 'test') && p.role === 'localLiaison' && !s.turn.flags.liaisonLab) return 'liaisonLab';
    return null;
  }
  function labBegin(s, pid, kind) {
    const p = s.players[pid];
    if (pid !== s.current || !s.turn || s.turn.phase !== 'actions') fail('Only during your actions phase');
    requireLabStation(s, p);
    const free = labFreeSource(s, p, kind);
    if (!free && s.turn.actionsLeft <= 0) fail('No actions left this turn');
    return { p, free };
  }
  function labEnd(s, free) {
    if (free === 'labBonus') s.turn.flags.labBonus = false;
    else if (free) s.turn.flags[free] = true;
    else spendAction(s);
  }

  function continueDrawing(s) {
    const p = s.players[s.current];
    while (s.turn.pending.length) {
      const card = s.turn.pending.shift();
      if (isEpidemic(card)) {
        resolveEpidemic(s, card, p);
        if (s.status !== 'playing') return;
        s.turn.phase = 'epidemic'; // pause so Resilient Population can be played before Intensify
        return;
      }
      if (isMutationEvent(card)) {
        resolveMutationEvent(s, card, p);
        if (s.status !== 'playing') return;
        continue;
      }
      p.hand.push(card);
      log(s, `${p.name} drew ${cardName(card)}.`);
    }
    s.turn.phase = 'infect';
  }

  function drawPlayerCards(s) {
    if (s.playerDeck.length < 2) { lose(s, 'Not enough player cards left to draw.'); return; }
    const drawn = [s.playerDeck.pop(), s.playerDeck.pop()];
    // A Mutation Event is resolved before an Epidemic drawn at the same time.
    if (isEpidemic(drawn[0]) && isMutationEvent(drawn[1])) drawn.reverse();
    s.turn.pending = drawn;
    continueDrawing(s);
  }

  function infectPhase(s) {
    if (s.quietNight) {
      s.quietNight = false;
      log(s, 'One Quiet Night — the Infect Cities step is skipped.');
    } else {
      let n = s.travelBan !== null ? 1 : RATES[s.rateIdx];
      if (s.travelBan !== null) log(s, 'Commercial Travel Ban — the infection rate is 1.');
      let rateBonus = false;
      for (let i = 0; i < n && s.infectionDeck.length; i++) {
        const card = s.infectionDeck.pop();
        if (isMutationCard(card)) {
          log(s, 'A Mutation card was drawn.');
          if (s.cures.purple !== 'eradicated') {
            const c = drawBottomCity(s);
            // Worldwide Panic Mutation cards place 2 purple cubes instead of 1.
            if (c) { infectCity(s, c, s.challenges.worldwidePanic ? 2 : 1, 'purple', ' — Mutation'); s.infectionDiscard.push(c); }
          }
          s.infectionDiscard.push(card);
        } else {
          const color = CITIES[card].color;
          if (s.colors.includes('purple') && s.cubes[card].purple > 0 && s.cures.purple !== 'eradicated') {
            infectCity(s, card, 1, 'purple', ' — Mutation');
          }
          const chronic = color === s.virulent && vsOn(s, 'chronicEffect') && s.cubes[card][color] === 0;
          if (s.status === 'playing') infectCity(s, card, chronic ? 2 : 1, color, chronic ? ' — Chronic Effect' : '');
          s.infectionDiscard.push(card);
          if (!rateBonus && color === s.virulent && vsOn(s, 'rateEffect')) {
            rateBonus = true;
            n++;
            log(s, 'Rate Effect: drawing 1 more infection card.');
          }
        }
        if (s.status !== 'playing') return;
      }
    }
    // Solo: after infecting, the CDC may take 1 action before the next turn begins.
    if (s.solo) {
      s.turn.phase = 'cdc';
      log(s, 'The CDC may take 1 action (or pass).');
      return;
    }
    s.turnNo++;
    startTurn(s, (s.current + 1) % s.players.length);
    log(s, `--- ${s.players[s.current].name}'s turn ---`);
  }

  function endCdcPhase(s) {
    if (s.status !== 'playing') return;
    s.turnNo++;
    startTurn(s, 0);
    log(s, `--- ${s.players[0].name}'s turn ---`);
  }

  // The CDC draws 1 Player card (resolving an Epidemic in full, with no Resilient Population pause).
  function cdcDraw(s) {
    if (s.playerDeck.length < 1) { lose(s, 'Not enough player cards left to draw.'); return; }
    const card = s.playerDeck.pop();
    const cdcP = { name: 'The CDC' };
    if (isEpidemic(card)) {
      resolveEpidemic(s, card, cdcP);
      if (s.status !== 'playing') return;
      s.infectionDeck.push(...shuffle(s.infectionDiscard));
      s.infectionDiscard = [];
      log(s, 'Intensify: infection discards shuffled onto the infection deck.');
    } else if (isMutationEvent(card)) {
      resolveMutationEvent(s, card, cdcP);
    } else {
      s.cdc.hand.push(card);
      log(s, `The CDC drew ${cardName(card)}.`);
    }
  }

  // ---------------------------------------------------------------- events

  function validPawn(s, i) {
    if (!Number.isInteger(i) || !s.players[i]) fail('Pick a valid pawn');
    return i;
  }
  function validCity(c) {
    if (!CITIES[c]) fail('Pick a valid city');
    return c;
  }

  function playEvent(s, pid, a) {
    const p = s.players[pid];
    const card = a.card;
    if (!isEvent(card)) fail('That is not an event card');
    const key = eventKey(card);
    const ev = EVENTS[key];

    // Reminder events stay in play (not in the discard pile) until they expire; the card is
    // only disposed of then. A stored event leaves the game when it finally expires.
    if (REMINDER_EVENTS[key]) {
      let disp;
      if (a.fromStored) {
        if (p.stored !== card) fail('That event is not stored on your role card');
        p.stored = null; disp = 'removed';
      } else {
        if (!removeOne(p.hand, card)) fail(`${p.name} does not have ${cardName(card)}`);
        disp = 'discard';
      }
      if (key === 'infectionZoneBan' && hasActive(s, 'infectionZoneBan')) { /* stacking is harmless */ }
      s.activeEvents.push({ key, owner: pid, card, disp });
      log(s, `${p.name} played ${ev.name}.`);
      return;
    }

    if (a.fromStored) {
      if (p.stored !== card) fail('That event is not stored on your role card');
      p.stored = null;
      s.removed.push(card);
    } else {
      discardFromHand(s, p, card);
    }
    const prm = a.params || {};
    const inActions = s.turn.phase === 'actions';
    log(s, `${p.name} played ${ev.name}.`);

    switch (key) {
      case 'airlift': {
        const i = validPawn(s, prm.pawn), to = validCity(prm.to);
        if (s.players[i].location === to) fail('That pawn is already there');
        const blocked = leaveBlocked(s, i);
        if (blocked) fail(blocked);
        movePawn(s, i, to, 'airlift');
        log(s, `${s.players[i].name} airlifted to ${to}.`);
        break;
      }
      case 'forecast': {
        const cards = s.infectionDeck.splice(-FORECAST_COUNT).reverse(); // top first
        s.interrupt = { type: 'forecast', player: pid, cards };
        s.turn.flags.revealed = true; // hidden cards seen: the turn can no longer be restarted
        break;
      }
      case 'governmentGrant': {
        const city = validCity(prm.city);
        if (s.stations.includes(city)) fail('There is already a research station there');
        if (s.stations.length >= MAX_STATIONS) {
          if (!removeOne(s.stations, prm.remove)) fail('All 6 stations are built — pick one to remove');
        }
        s.stations.push(city);
        log(s, `Research station built in ${city}.`);
        if (s.challenges.lab && pid === s.current && s.turn.phase === 'actions') {
          s.turn.flags.labBonus = true;
          log(s, `${p.name} may do 1 free lab action.`);
        }
        break;
      }
      case 'oneQuietNight':
        s.quietNight = true;
        break;
      case 'newRoute': {
        const a = validCity(prm.a), b = validCity(prm.b);
        if (a === b) fail('Pick 2 different cities');
        if (CITIES[a].color !== CITIES[b].color) fail('Both cities must be the same color');
        if (adj(s, a).includes(b)) fail(`${a} and ${b} are already connected`);
        s.links = s.links || { added: [], cut: [] };
        // Re-opening a closed printed connection restores it; otherwise it's a brand-new route.
        if (ADJ[a].includes(b)) s.links.cut = s.links.cut.filter(([x, y]) => linkKey(x, y) !== linkKey(a, b));
        else s.links.added.push([a, b].sort());
        log(s, `New Route: ${a} and ${b} are now connected.`);
        break;
      }
      case 'borderClosure': {
        // Up to 2 connections, each as { a, b }: [{ a, b }] or [{ a, b }, { a, b }].
        const picks = Array.isArray(prm.closures) ? prm.closures : [];
        if (!picks.length || picks.length > 2) fail('Pick 1 or 2 connections to remove');
        s.links = s.links || { added: [], cut: [] };
        const done = [];
        for (const p of picks) {
          const a = validCity(p && p.a), b = validCity(p && p.b);
          if (done.some(([x, y]) => linkKey(x, y) === linkKey(a, b))) fail('Pick 2 different connections');
          if (!adj(s, a).includes(b)) fail(`${a} and ${b} are not connected`);
          if (hasLink(s.links.added, a, b)) s.links.added = s.links.added.filter(([x, y]) => linkKey(x, y) !== linkKey(a, b));
          else s.links.cut.push([a, b].sort());
          done.push([a, b]);
          log(s, `Border Closure: ${a} and ${b} are no longer connected.`);
        }
        break;
      }
      case 'resilientPopulation': {
        if (!isCity(prm.card)) fail('Pick a City card (Mutation cards cannot be removed)');
        if (!removeOne(s.infectionDiscard, prm.card)) fail('Pick a card from the Infection Discard pile');
        s.removed.push(prm.card);
        log(s, `${prm.card} removed from the infection deck for the rest of the game.`);
        break;
      }
      case 'borrowedTime':
        if (!inActions) fail('Borrowed Time can only be played while the current player is taking actions');
        s.turn.actionsLeft += 2;
        break;
      case 'commercialTravelBan':
        s.travelBan = s.current;
        log(s, `The infection rate is 1 until ${s.players[s.current].name}'s next turn begins.`);
        break;
      case 'mobileHospital':
        s.turn.flags.mobileHospital = true;
        break;
      case 'newAssignment': {
        const i = validPawn(s, prm.player);
        const role = prm.role;
        if (!ROLES[role] || s.players.some(q => q.role === role)) fail('Pick an unused role');
        const q = s.players[i];
        if (q.stored) { s.removed.push(q.stored); q.stored = null; }
        s.colors.forEach(c => { s.supply[c] += q.samples[c]; q.samples[c] = 0; });
        log(s, `${q.name} changed from ${ROLES[q.role].name} to ${ROLES[role].name}.`);
        const wasGeneralist = q.role === 'generalist';
        q.role = role;
        // Swapping to (or from) the Generalist lets the current player do up to 5 actions this turn.
        if (i === s.current && inActions && role === 'generalist' && !wasGeneralist) s.turn.actionsLeft++;
        onEnter(s, i);
        break;
      }
      case 'rapidVaccineDeployment': {
        const color = s.rvdColor;
        if (!color) fail('Rapid Vaccine Deployment must be played right after a cure is discovered');
        const list = (prm.removals || []).filter(r => r && r.n > 0);
        if (!list.length) fail('Choose at least one city');
        const total = list.reduce((t, r) => t + r.n, 0);
        if (total > 5) fail('At most 5 cubes');
        const cities = list.map(r => validCity(r.city));
        if (new Set(cities).size !== cities.length) fail('Each city once');
        list.forEach(r => { if (!Number.isInteger(r.n) || s.cubes[r.city][color] < r.n) fail(`Not enough cubes in ${r.city}`); });
        const seen = new Set([cities[0]]), stack = [cities[0]];
        while (stack.length) {
          const c = stack.pop();
          adj(s, c).forEach(nb => { if (cities.includes(nb) && !seen.has(nb)) { seen.add(nb); stack.push(nb); } });
        }
        if (seen.size !== cities.length) fail('The cities must form a connected group');
        list.forEach(r => removeCubes(s, r.city, color, r.n));
        log(s, `Removed ${total} ${color} cube(s) from ${cities.join(', ')}.`);
        s.rvdColor = null;
        checkEradication(s);
        break;
      }
      case 'reexaminedResearch': {
        const i = validPawn(s, prm.player);
        if (!isCity(prm.card) || !removeOne(s.playerDiscard, prm.card)) fail('Pick a City card from the Player Discard pile');
        s.players[i].hand.push(prm.card);
        log(s, `${s.players[i].name} took ${prm.card} from the discard pile.`);
        break;
      }
      case 'remoteTreatment': {
        const list = (prm.removals || []).filter(Boolean);
        if (!list.length || list.length > 2) fail('Choose 1 or 2 cubes');
        list.forEach(r => {
          validCity(r.city);
          if (!s.colors.includes(r.color) || s.cubes[r.city][r.color] < 1) fail(`No ${r.color} cube in ${r.city}`);
          removeCubes(s, r.city, r.color, 1);
          log(s, `Removed 1 ${r.color} cube from ${r.city}.`);
        });
        checkEradication(s);
        break;
      }
      case 'specialOrders': {
        if (!inActions) fail('Special Orders can only be played while the current player is taking actions');
        const i = validPawn(s, prm.pawn);
        if (i === s.current) fail("Pick another player's pawn");
        s.turn.flags.specialOrders = i;
        log(s, `${s.players[s.current].name} may move ${s.players[i].name}'s pawn this turn.`);
        break;
      }
      default:
        fail('Unknown event');
    }
  }

  // ---------------------------------------------------------------- actions

  function apply(state, pid, action) {
    const s = JSON.parse(JSON.stringify(state));
    doApply(s, pid, action || {});
    checkWin(s);
    return s;
  }

  function doApply(s, pid, a) {
    if (s.status !== 'playing') fail('The game is over');
    const p = s.players[pid];
    if (!p) fail('You are not a player in this game');

    if (s.interrupt) {
      const expect = s.interrupt.type === 'labSequence' ? 'labSequenceResolve' : 'forecastOrder';
      const what = s.interrupt.type === 'labSequence' ? 'Sequencing' : 'Forecast';
      if (a.type !== expect || pid !== s.interrupt.player) {
        fail(`Waiting for ${s.players[s.interrupt.player].name} to finish ${what}`);
      }
    }
    const over = overLimit(s);
    if (over.length && !['discard', 'playEvent', 'forecastOrder', 'labSequenceResolve'].includes(a.type)) {
      fail(`Waiting for ${over.map(i => s.players[i].name).join(', ')} to discard down to the hand limit`);
    }
    if (s.solo && s.cdc && s.cdc.hand.length > 7 && !['cdcDiscard', 'playEvent'].includes(a.type)) {
      fail('The CDC is over its 7-card limit — discard CDC cards first');
    }
    if (a.type !== 'playEvent' && a.type !== 'discard') s.rvdColor = null;

    const here = p.location;
    switch (a.type) {
      case 'move': {
        requireActionTurn(s, pid);
        const pawn = Number.isInteger(a.pawn) ? a.pawn : pid;
        if (!s.players[pawn]) fail('Pick a valid pawn');
        const blocked = leaveBlocked(s, pawn);
        if (blocked) fail(blocked);
        const opt = getMoveOptions(s, pid, pawn, a.to).find(o => o.method === a.method);
        if (!opt) fail('That move is not allowed');
        const from = s.players[pawn].location;
        if (opt.method === 'direct' || opt.method === 'charter') discardFromHand(s, p, opt.card);
        if (opt.method === 'ops') {
          if (!opt.cards.includes(a.card)) fail('Pick a City card to discard');
          discardFromHand(s, p, a.card);
          s.turn.flags.opsMove = true;
        }
        // Pilot may carry 1 other pawn from the same city.
        let passenger = null;
        if (opt.method === 'pilot' && Number.isInteger(a.passenger) && a.passenger !== pawn) {
          const pg = s.players[a.passenger];
          if (!pg) fail('Pick a valid passenger');
          if (pg.location !== from) fail('A passenger must start in the same city as the Pilot');
          passenger = a.passenger;
        }
        movePawn(s, pawn, a.to, opt.method);
        log(s, `${s.players[pawn].name} moved ${from} → ${a.to} (${opt.label}${opt.method === 'ops' ? `, discarded ${a.card}` : ''}).`);
        if (passenger != null) {
          movePawn(s, passenger, a.to, 'pilot');
          log(s, `${s.players[passenger].name} rode along with the Pilot to ${a.to}.`);
        }
        spendAction(s);
        break;
      }
      case 'build': {
        requireActionTurn(s, pid);
        if (p.role === 'pilot') fail('The Pilot cannot build research stations');
        if (s.stations.includes(here)) fail('There is already a research station here');
        if (p.role !== 'opsExpert') discardFromHand(s, p, here);
        if (s.stations.length >= MAX_STATIONS) {
          if (!removeOne(s.stations, a.remove)) fail('All 6 stations are built — pick one to remove');
        }
        s.stations.push(here);
        log(s, `${p.name} built a research station in ${here}.`);
        spendAction(s);
        // Lab: building earns 1 free bonus lab action.
        if (s.challenges.lab) { s.turn.flags.labBonus = true; log(s, `${p.name} may do 1 free lab action.`); }
        break;
      }
      case 'treat': {
        requireActionTurn(s, pid);
        const color = a.color;
        // Field Director may treat a connected city instead of their own.
        let target = here;
        if (a.city && a.city !== here) {
          if (p.role !== 'fieldDirector') fail('You can only treat disease in your own city');
          if (!adj(s, here).includes(a.city)) fail('Field Director can only treat a connected city');
          target = validCity(a.city);
        }
        if (!s.colors.includes(color) || s.cubes[target][color] < 1) fail(`No ${color} cubes there`);
        // Resistant to Treatment: treating the uncured Virulent Strain costs 2 actions.
        const resistant = color === s.virulent && vsOn(s, 'resistantToTreatment') && s.cures[color] === 'none';
        if (resistant && s.turn.actionsLeft < 2) fail('Resistant to Treatment: treating the Virulent Strain needs 2 actions');
        const all = p.role === 'medic' || s.cures[color] !== 'none';
        // Improved Sanitation: a single-cube treat removes 1 more cube of the same color.
        const want = all ? 3 : (hasActive(s, 'improvedSanitation') ? 2 : 1);
        const k = removeCubes(s, target, color, want);
        if (color === s.virulent) markVsTreated(s, target);
        log(s, `${p.name} treated ${k} ${color} cube(s) in ${target}.`);
        // Lab: 1 of the cubes just removed may be kept as a sample instead of returned to the supply.
        if (s.challenges.lab && k > 0 && (a.sample === 'sampleA' || a.sample === 'sampleB') && s.supply[color] > 0) {
          s.supply[color]--;
          s.lab.dishes[a.sample][color]++;
          log(s, `${p.name} kept 1 ${color} cube as a sample.`);
        }
        checkEradication(s);
        spendAction(s);
        if (resistant) spendAction(s);
        break;
      }
      case 'share': {
        requireActionTurn(s, pid);
        const ok = getShareOptions(s, pid).some(o => o.mode === a.mode && o.other === a.other && o.card === a.card);
        if (!ok) fail('That card cannot be shared');
        const q = s.players[a.other];
        const [giver, taker] = a.mode === 'give' ? [p, q] : [q, p];
        removeOne(giver.hand, a.card);
        taker.hand.push(a.card);
        log(s, `${giver.name} gave ${a.card} to ${taker.name}.`);
        spendAction(s);
        break;
      }
      case 'cure': {
        requireActionTurn(s, pid);
        const color = a.color;
        if (!s.colors.includes(color)) fail('Pick a color');
        if (!s.stations.includes(here)) fail('You must be at a research station');
        if (s.cures[color] !== 'none') fail('That disease is already cured');
        // Lab: a standard disease can only be cured once its research line is complete.
        let labLine = -1;
        if (s.challenges.lab && color !== 'purple') {
          labLine = s.lab.lines.findIndex(l => l.color === color && lineComplete(s, l));
          if (labLine < 0) fail('The lab research line for this disease is not complete yet (characterize it, fill its Sequence card, and test the cure)');
        }
        const useSamples = !!a.useSamples;
        if (useSamples && (p.role !== 'fieldOperative' || p.samples[color] < 3)) fail('You need 3 samples of that color');
        const need = cardsNeededForCure(s, p, color, useSamples);
        const cards = Array.isArray(a.cards) ? a.cards : [];
        // Virologist: pairs of same-color City cards each stand in for 1 cure-color card.
        const pairs = (p.role === 'virologist' && Array.isArray(a.pairs)) ? a.pairs : [];
        const allowed = cureCards(s, p, color);
        const used = [];
        cards.forEach(c => {
          if (!allowed.includes(c) || used.includes(c)) fail(`Invalid card ${c}`);
          used.push(c);
        });
        pairs.forEach(pr => {
          if (!Array.isArray(pr) || pr.length !== 2) fail('Each substitute needs a pair of City cards');
          const [x, y] = pr;
          if (!isCity(x) || !isCity(y) || x === y) fail('A pair needs 2 different City cards');
          if (used.includes(x) || used.includes(y)) fail('A card was used twice');
          if (!p.hand.includes(x) || !p.hand.includes(y)) fail('Pair cards must be in your hand');
          if (CITIES[x].color !== CITIES[y].color) fail('Each pair must be 2 cards of the same color');
          used.push(x, y);
        });
        const what = color === 'purple' ? 'City cards (any colors)' : `${color} City cards`;
        if (cards.length + pairs.length !== need) fail(`Select cards worth exactly ${need} ${what}`);
        if (color === 'purple') {
          const min = s.challenges.worldwidePanic ? 2 : 1;
          if (used.filter(c => s.cubes[c].purple > 0).length < min) {
            fail(`At least ${min} of the cards must be cities that have purple cubes`);
          }
        }
        used.forEach(c => discardFromHand(s, p, c));
        if (useSamples) { p.samples[color] -= 3; s.supply[color] += 3; }
        s.cures[color] = 'cured';
        // Sequencing Breakthrough is spent once the next cure is discovered.
        expireEvents(s, (e) => e.key === 'sequencingBreakthrough');
        // Lab: retire the completed research line's Sequence card and open a fresh one.
        if (labLine >= 0) {
          const line = s.lab.lines[labLine];
          if (line.charCard) s.playerDiscard.push(line.charCard);
          if (line.testCard) s.playerDiscard.push(line.testCard);
          clearLineCubes(s, line);
          s.lab.discard.push(line.seqId);
          if (!s.lab.deck.length) { s.lab.deck = shuffle(s.lab.discard); s.lab.discard = []; }
          placeSequence(s, labLine, s.lab.deck.length ? s.lab.deck.pop() : null);
          log(s, `Research line ${labLine + 1} opened a new Sequence card.`);
        }
        log(s, `${p.name} discovered a cure for ${color}!`);
        s.players.forEach((q, qi) => { if (q.role === 'medic') onEnter(s, qi); });
        checkEradication(s);
        spendAction(s);
        checkWin(s);
        if (s.status === 'playing') s.rvdColor = color;
        break;
      }
      case 'contingencyTake': {
        requireActionTurn(s, pid);
        if (p.role !== 'contingencyPlanner') fail('Only the Contingency Planner can do that');
        if (p.stored) fail('You already have a stored event');
        if (!isEvent(a.card) || !removeOne(s.playerDiscard, a.card)) fail('Pick an Event from the discard pile');
        p.stored = a.card;
        log(s, `${p.name} stored ${cardName(a.card)}.`);
        spendAction(s);
        break;
      }
      case 'archivistRetrieve': {
        requireActionTurn(s, pid);
        if (p.role !== 'archivist') fail('Only the Archivist can do that');
        if (s.turn.flags.archivist) fail('Already used this turn');
        if (!removeOne(s.playerDiscard, here)) fail(`${here} is not in the discard pile`);
        p.hand.push(here);
        s.turn.flags.archivist = true;
        log(s, `${p.name} retrieved ${here} from the discard pile.`);
        spendAction(s);
        break;
      }
      case 'fieldSample': {
        requireActionTurn(s, pid);
        if (p.role !== 'fieldOperative') fail('Only the Field Operative can do that');
        if (s.turn.flags.sample) fail('Already took a sample this turn');
        if (!s.colors.includes(a.color) || s.cubes[here][a.color] < 1) fail('No cube of that color here');
        s.cubes[here][a.color]--;
        p.samples[a.color]++;
        s.turn.flags.sample = true;
        log(s, `${p.name} took a ${a.color} sample from ${here}.`);
        checkEradication(s);
        spendAction(s);
        break;
      }
      case 'epidemiologistTake': {
        if (pid !== s.current || s.turn.phase !== 'actions') fail('Only during your actions phase');
        if (p.role !== 'epidemiologist') fail('Only the Epidemiologist can do that');
        if (s.turn.flags.epidemiologist) fail('Already used this turn');
        const q = s.players[a.from];
        if (!q || a.from === pid || q.location !== here) fail('That player is not in your city');
        if (!isCity(a.card) || !removeOne(q.hand, a.card)) fail('Pick one of their City cards');
        p.hand.push(a.card);
        s.turn.flags.epidemiologist = true;
        log(s, `${p.name} took ${a.card} from ${q.name}.`);
        break;
      }
      case 'virologistRemove': {
        requireActionTurn(s, pid);
        if (p.role !== 'virologist') fail('Only the Virologist can do that');
        const card = a.card;
        if (!isCity(card) || !p.hand.includes(card)) fail('Discard a City card from your hand');
        const color = CITIES[card].color;
        const city = validCity(a.city);
        if (s.cubes[city][color] < 1) fail(`There is no ${color} cube in ${city}`);
        discardFromHand(s, p, card);
        removeCubes(s, city, color, 1);
        log(s, `${p.name} discarded ${card} to remove 1 ${color} cube from ${city}.`);
        checkEradication(s);
        spendAction(s);
        break;
      }
      case 'fieldDirectorMove': {
        if (pid !== s.current || s.turn.phase !== 'actions') fail('Only during your actions phase');
        if (p.role !== 'fieldDirector') fail('Only the Field Director can do that');
        if (s.turn.flags.fieldDirector) fail('Already used this turn');
        const i = validPawn(s, a.pawn);
        if (i === pid) fail("Pick another player's pawn");
        if (s.players[i].role === 'pilot') fail('The Field Director cannot move the Pilot');
        const from = s.players[i].location;
        if (from !== here && !adj(s, here).includes(from)) fail('That pawn must be in your city or a connected city');
        const to = validCity(a.to);
        if (!adj(s, from).includes(to)) fail('Drive/Ferry only: pick a city connected to that pawn');
        const blocked = leaveBlocked(s, i);
        if (blocked) fail(blocked);
        movePawn(s, i, to, 'drive');
        s.turn.flags.fieldDirector = true;
        log(s, `${p.name} moved ${s.players[i].name} ${from} → ${to} (Field Director, free).`);
        break;
      }
      case 'localLiaisonGive': {
        requireActionTurn(s, pid);
        if (p.role !== 'localLiaison') fail('Only the Local Liaison can do that');
        if (s.turn.flags.localLiaison) fail('Already used this turn');
        const color = CITIES[here].color;
        const card = a.card;
        if (!isCity(card) || !p.hand.includes(card) || CITIES[card].color !== color) {
          fail(`Give a ${color} City card (matching your city)`);
        }
        const i = validPawn(s, a.to);
        if (i === pid) fail('Give to another player');
        if (CITIES[s.players[i].location].color !== color) fail(`That player must be in a ${color} city`);
        removeOne(p.hand, card);
        s.players[i].hand.push(card);
        s.turn.flags.localLiaison = true;
        log(s, `${p.name} gave ${card} to ${s.players[i].name} (Local Liaison).`);
        spendAction(s);
        break;
      }
      case 'labCharacterize': {
        const { p: pl, free } = labBegin(s, pid, 'characterize');
        const li = a.line, line = s.lab.lines[li];
        if (!line || !line.seqId) fail('There is no Sequence card on that research line');
        if (line.color) fail('That research line is already characterized');
        const card = a.card;
        if (!isCity(card) || !pl.hand.includes(card)) fail('Play a City card you hold');
        const color = CITIES[card].color;
        if (!SEQ_BY_ID[line.seqId].vials.includes(color)) fail("That card's color is not a vial symbol on this Sequence card");
        if (s.cures[color] !== 'none') fail('That disease is already cured');
        // If the other line is already this disease, close it (discard its cards and cubes).
        const other = s.lab.lines[1 - li];
        if (other.color === color) {
          if (other.charCard) s.playerDiscard.push(other.charCard);
          if (other.testCard) s.playerDiscard.push(other.testCard);
          clearLineCubes(s, other);
          if (other.seqId) s.lab.discard.push(other.seqId);
          placeSequence(s, 1 - li, null);
          log(s, `The other research line was also ${color}, so it was closed.`);
        }
        removeOne(pl.hand, card);
        line.charCard = card;
        line.color = color;
        log(s, `${pl.name} characterized research line ${li + 1} as ${color}.`);
        labEnd(s, free);
        break;
      }
      case 'labProcess': {
        const { free } = labBegin(s, pid, 'process');
        const d = s.lab.dishes, from = a.from;
        if (!d[from]) fail('Pick a dish to process');
        if (dishTotal(s, d[from]) === 0) fail('That dish is empty');
        if (from === 'sampleA' || from === 'sampleB') {
          if (a.to === 'centrifuge') {
            const color = a.color;
            if (!s.colors.includes(color) || d[from][color] === 0) fail('Pick a color present in that sample dish');
            s.colors.forEach(c => {
              if (c === color) { d.centrifuge[c] += d[from][c]; } else { s.supply[c] += d[from][c]; }
              d[from][c] = 0;
            });
            log(s, `Processed a sample: ${color} cubes to the centrifuge.`);
          } else if (a.to === 'separator') {
            s.colors.forEach(c => {
              if (d[from][c] > 0) { d.separator[c] += 1; d[from][c] -= 1; }
              s.supply[c] += d[from][c]; d[from][c] = 0;
            });
            log(s, 'Processed a sample: 1 cube of each color to the separator.');
          } else fail('A sample dish feeds the centrifuge or the separator');
        } else if (from === 'centrifuge' || from === 'separator') {
          if (a.to === 'growth') {
            s.colors.forEach(c => {
              const n = d[from][c];
              if (!n) return;
              const k = Math.min(n, s.supply[c]); // doubled cubes come from the supply
              s.supply[c] -= k;
              d.growth[c] += n + k;
              d[from][c] = 0;
              if (k < n) lose(s, `Ran out of ${c} disease cubes.`);
            });
            if (s.status !== 'playing') { labEnd(s, free); break; }
            log(s, `Processed to the growth dish (cubes doubled) from the ${from}.`);
          } else if (a.to === 'card') {
            const line = s.lab.lines[a.line];
            if (!line || !line.color) fail('Pick a characterized research line');
            fillCardFromDish(s, line, d[from]);
            log(s, `Processed ${from} cubes onto research line ${a.line + 1}.`);
          } else fail('The centrifuge/separator feeds the growth dish or a Sequence card');
        } else if (from === 'growth') {
          if (a.to !== 'card') fail('The growth dish feeds a Sequence card');
          const line = s.lab.lines[a.line];
          if (!line || !line.color) fail('Pick a characterized research line');
          fillCardFromDish(s, line, d.growth);
          log(s, `Processed growth cubes onto research line ${a.line + 1}.`);
        } else fail('Unknown dish');
        labEnd(s, free);
        break;
      }
      case 'labTest': {
        const { p: pl, free } = labBegin(s, pid, 'test');
        const li = a.line, line = s.lab.lines[li];
        if (!line || !line.color) fail('That research line is not characterized yet');
        if (line.tested) fail('That cure is already tested');
        if (!line.filled.some(x => x != null)) fail('A cure cannot be tested until at least 1 cube is on its Sequence card');
        const card = a.card;
        if (!isCity(card) || !pl.hand.includes(card) || CITIES[card].color !== line.color) fail(`Play a ${line.color} City card`);
        const city = validCity(a.city);
        if (s.cubes[city][line.color] < 1) fail(`Remove 1 ${line.color} cube to test: there is none in ${city}`);
        removeOne(pl.hand, card);
        line.testCard = card;
        line.tested = true;
        removeCubes(s, city, line.color, 1);
        if (line.color === s.virulent) markVsTreated(s, city);
        log(s, `${pl.name} tested the ${line.color} cure (removed 1 cube from ${city}).`);
        checkEradication(s);
        labEnd(s, free);
        break;
      }
      case 'labSequence': {
        const { p: pl, free } = labBegin(s, pid, 'sequence');
        if (!s.lab.deck.length) { s.lab.deck = shuffle(s.lab.discard); s.lab.discard = []; }
        if (!s.lab.deck.length) fail('No Sequence cards left to draw');
        const drawn = s.lab.deck.pop();
        s.interrupt = { type: 'labSequence', player: pid, card: drawn, free };
        s.turn.flags.revealed = true; // a hidden Sequence card was revealed
        log(s, `${pl.name} drew a Sequence card.`);
        break;
      }
      case 'labSequenceResolve': {
        if (!s.interrupt || s.interrupt.type !== 'labSequence' || pid !== s.interrupt.player) fail('No drawn Sequence card to resolve');
        const drawn = s.interrupt.card, free = s.interrupt.free;
        if (a.mode === 'discard') {
          s.lab.discard.push(drawn);
          log(s, 'Discarded the drawn Sequence card.');
        } else {
          const li = a.line, line = s.lab.lines[li];
          if (li !== 0 && li !== 1) fail('Pick a research line');
          if (a.mode === 'place') {
            if (line.seqId) fail('That research line already has a Sequence card');
            if (s.stations.length < 2) fail('You need a 2nd research station to open the other research line');
            placeSequence(s, li, drawn);
            log(s, `Placed the Sequence card on research line ${li + 1}.`);
          } else if (a.mode === 'swap') {
            if (!line.seqId) fail('That research line is empty — place the card instead');
            const keepColor = line.color && SEQ_BY_ID[drawn].vials.includes(line.color);
            const carry = line.filled.filter(x => x != null);
            const prev = { color: line.color, charCard: line.charCard, testCard: line.testCard, tested: line.tested };
            if (!keepColor) {
              if (line.charCard) s.playerDiscard.push(line.charCard);
              if (line.testCard) s.playerDiscard.push(line.testCard);
              carry.forEach(c => s.supply[c]++); // old cubes return to the supply
            }
            s.lab.discard.push(line.seqId);
            placeSequence(s, li, drawn);
            if (keepColor) {
              Object.assign(line, prev);
              const dish = zeroCubes(s.colors);
              carry.forEach(c => dish[c]++);
              fillCardFromDish(s, line, dish); // carry cubes onto the new card; excess to supply
            }
            log(s, `Swapped in a new Sequence card on research line ${li + 1}.`);
          } else fail('Pick place, swap or discard');
        }
        s.interrupt = null;
        labEnd(s, free);
        break;
      }
      case 'pass':
        requireActionTurn(s, pid);
        log(s, `${p.name} passed an action.`);
        spendAction(s);
        break;
      // ---- Solo: the CDC's one action after the human infects.
      case 'cdcMove': {
        requireCdc(s, pid);
        const human = s.players[0], from = human.location, to = validCity(a.to);
        if (from === to) fail('Pick a different city');
        if (a.method === 'drive') { if (!adj(s, from).includes(to)) fail('Those cities are not connected'); }
        else if (a.method === 'direct') { if (!removeOne(s.cdc.hand, to)) fail('The CDC needs the destination city card'); s.playerDiscard.push(to); }
        else if (a.method === 'charter') { if (!removeOne(s.cdc.hand, from)) fail('The CDC needs your current city card'); s.playerDiscard.push(from); }
        else if (a.method === 'shuttle') { if (!(s.stations.includes(from) && s.stations.includes(to))) fail('Both cities need a research station'); }
        else fail('Pick a movement method');
        const blocked = leaveBlocked(s, 0);
        if (blocked) fail(blocked);
        movePawn(s, 0, to, a.method === 'drive' ? 'drive' : 'other');
        log(s, `The CDC moved ${human.name} ${from} → ${to}.`);
        endCdcPhase(s);
        break;
      }
      case 'cdcReassign': {
        requireCdc(s, pid);
        const human = s.players[0];
        if (!s.stations.includes(human.location)) fail('You must be at a research station');
        const role = a.role;
        if (!ROLES[role]) fail('Pick a role');
        if (s.players.some(q => q.role === role) || s.removedRoles.includes(role)) fail('That role is not available');
        if (['dispatcher', 'researcher', 'epidemiologist', 'localLiaison'].includes(role)) fail('That role is not used in the solo game');
        if (s.challenges.lab && role === 'fieldOperative') fail('The Field Operative is not used in the Lab challenge');
        if (human.stored) { s.removed.push(human.stored); human.stored = null; }
        s.colors.forEach(c => { s.supply[c] += human.samples[c]; human.samples[c] = 0; });
        s.removedRoles.push(human.role);
        log(s, `The CDC reassigned you from ${ROLES[human.role].name} to ${ROLES[role].name}.`);
        human.role = role;
        onEnter(s, 0);
        endCdcPhase(s);
        break;
      }
      case 'cdcExchange': {
        requireCdc(s, pid);
        const human = s.players[0];
        if (!s.stations.includes(human.location)) fail('You must be at a research station');
        const cityColor = CITIES[human.location].color;
        if (!isCity(a.giveCard) || !human.hand.includes(a.giveCard) || CITIES[a.giveCard].color !== cityColor) fail(`Give a ${cityColor} City card (matching your city)`);
        if (!isCity(a.takeCard) || !s.cdc.hand.includes(a.takeCard)) fail('Pick a City card from the CDC');
        removeOne(human.hand, a.giveCard); s.cdc.hand.push(a.giveCard);
        removeOne(s.cdc.hand, a.takeCard); human.hand.push(a.takeCard);
        log(s, `The CDC gave you ${a.takeCard} for ${a.giveCard}.`);
        endCdcPhase(s);
        break;
      }
      case 'cdcDraw': {
        requireCdc(s, pid);
        cdcDraw(s);
        if (s.status !== 'playing') break;
        s.turn.cdcDrew = true;
        if (s.cdc.hand.length <= 7) endCdcPhase(s);
        break;
      }
      case 'cdcDiscard': {
        if (!s.solo || !s.cdc || s.turn.phase !== 'cdc') fail('Nothing for the CDC to discard');
        if (s.cdc.hand.length <= 7) fail('The CDC is within its 7-card limit');
        if (!removeOne(s.cdc.hand, a.card)) fail('The CDC does not have that card');
        s.playerDiscard.push(a.card);
        log(s, `The CDC discarded ${cardName(a.card)} (hand limit).`);
        if (s.turn.cdcDrew && s.cdc.hand.length <= 7) endCdcPhase(s);
        break;
      }
      case 'cdcCure': {
        requireCdc(s, pid);
        if (s.challenges.lab) fail('In the Lab challenge the CDC cannot discover cures directly');
        const color = a.color;
        if (!s.colors.includes(color)) fail('Pick a color');
        if (s.cures[color] !== 'none') fail('That disease is already cured');
        const cards = Array.isArray(a.cards) ? a.cards : [];
        if (new Set(cards).size !== cards.length || cards.length !== 5) fail('Select exactly 5 CDC City cards');
        cards.forEach(c => {
          if (!isCity(c) || !s.cdc.hand.includes(c)) fail('The CDC must hold all 5 cards');
          if (color !== 'purple' && CITIES[c].color !== color) fail(`All 5 cards must be ${color}`);
        });
        if (color === 'purple') {
          const min = s.challenges.worldwidePanic ? 2 : 1;
          if (cards.filter(c => s.cubes[c].purple > 0).length < min) fail(`At least ${min} of the cards must be cities with purple cubes`);
        }
        cards.forEach(c => { removeOne(s.cdc.hand, c); s.playerDiscard.push(c); });
        s.cures[color] = 'cured';
        expireEvents(s, (e) => e.key === 'sequencingBreakthrough');
        log(s, `The CDC discovered a cure for ${color}!`);
        s.players.forEach((q, qi) => { if (q.role === 'medic') onEnter(s, qi); });
        checkEradication(s);
        checkWin(s);
        if (s.status === 'playing') endCdcPhase(s);
        break;
      }
      case 'cdcSkip':
        requireCdc(s, pid);
        log(s, 'The CDC passed.');
        endCdcPhase(s);
        break;
      case 'restartTurn': {
        if (pid !== s.current) fail("It's not your turn");
        if (!canRestart(s)) fail(s.turn.flags.revealed ? 'Cannot restart after hidden cards were revealed (Forecast)' : 'Nothing to restart');
        const snap = s.turnStart;
        const { logCount } = s;
        Object.keys(s).forEach(k => delete s[k]);
        Object.assign(s, JSON.parse(JSON.stringify(snap)), { turnStart: snap, logCount });
        log(s, `${p.name} restarted their turn.`);
        break;
      }
      case 'endActions':
        if (pid !== s.current) fail("It's not your turn");
        if (s.turn.phase !== 'actions') fail('Your actions are already over');
        log(s, s.turn.actionsLeft > 0 ? `${p.name} ended their turn early.` : `${p.name} ended their actions.`);
        s.turn.actionsLeft = 0;
        s.turn.phase = 'draw';
        drawPlayerCards(s); // drawn straight away; events can still be played before Infect
        break;
      case 'draw':
        if (pid !== s.current || s.turn.phase !== 'draw') fail('Not time to draw');
        drawPlayerCards(s);
        break;
      case 'continue':
        if (pid !== s.current || s.turn.phase !== 'epidemic') fail('Nothing to continue');
        s.infectionDeck.push(...shuffle(s.infectionDiscard));
        s.infectionDiscard = [];
        log(s, 'Intensify: infection discards shuffled onto the infection deck.');
        continueDrawing(s);
        break;
      case 'infect':
        if (pid !== s.current || s.turn.phase !== 'infect') fail('Not time to infect');
        infectPhase(s);
        break;
      case 'discard':
        if (!over.includes(pid)) fail('You are within your hand limit');
        discardFromHand(s, p, a.card);
        log(s, `${p.name} discarded ${cardName(a.card)} (hand limit).`);
        break;
      case 'playEvent':
        if (s.interrupt) fail('Finish the Forecast first');
        playEvent(s, pid, a);
        break;
      case 'forecastOrder': {
        const cards = s.interrupt.cards;
        const order = Array.isArray(a.order) ? a.order : [];
        const sorted = (x) => x.slice().sort().join('|');
        if (order.length !== cards.length || sorted(order) !== sorted(cards)) fail('Order must contain exactly the forecast cards');
        s.infectionDeck.push(...order.slice().reverse());
        s.interrupt = null;
        log(s, `${p.name} rearranged the top ${order.length} infection cards.`);
        break;
      }
      default:
        fail('Unknown action');
    }
  }

  // What clients get to see: hide deck order, expose counts and legitimately revealed cards.
  function view(s) {
    const v = JSON.parse(JSON.stringify(s));
    v.playerDeckCount = s.playerDeck.length;
    v.epidemicsLeft = s.playerDeck.filter(isEpidemic).length;
    v.infectionDeckCount = s.infectionDeck.length;
    delete v.playerDeck;
    delete v.infectionDeck;
    delete v.turnStart;
    if (v.lab) { v.lab.deckCount = s.lab.deck.length; delete v.lab.deck; }
    v.canRestart = canRestart(s) && JSON.stringify({ ...s, turnStart: null, log: null, logCount: null }) !==
      JSON.stringify({ ...s.turnStart, turnStart: null, log: null, logCount: null });
    v.infectionRate = RATES[s.rateIdx];
    v.overLimit = overLimit(s);
    v.handLimits = s.players.map(handLimit);
    const cur = s.players[s.current];
    v.peek = (cur && cur.role === 'troubleshooter' && s.turn.phase === 'actions')
      ? s.infectionDeck.slice(-RATES[s.rateIdx]).reverse() : null;
    return v;
  }

  return {
    GameError, createGame, apply, view, adj, getMoveOptions, getShareOptions, cardsNeededForCure, cureCards, leaveBlocked,
    isCity, isEvent, isEpidemic, isMutationEvent, isMutationCard, vsKeyOf, eventKey, cardName, handLimit,
    RATES, MAX_STATIONS, MAX_OUTBREAKS, infectAdj,
    labLineComplete: lineComplete, labSpotNeed: spotNeed, labSpotAccepts: spotAccepts,
  };
}));
