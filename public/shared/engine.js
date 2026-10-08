// Pandemic rules engine (base game + On the Brink roles, events, Virulent Strain and Mutation challenges).
// Pure state-in / state-out; runs in the host's browser (authoritative) and in every browser (move hints).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.Engine = factory(root.PData);
}(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';
  const { CITIES, ADJ, COLORS, ROLES, EVENTS, VIRULENT, MUTATION_EVENTS } = D;
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

  // ---------------------------------------------------------------- setup

  function createGame({ players, epidemics = 5, eventCount, challenges = {} }) {
    const n = players.length;
    if (n < 2 || n > 5) fail('Pandemic needs 2 to 5 players');
    if (epidemics < 4 || epidemics > 7) fail('Epidemics must be 4-7');
    const mutation = !!challenges.mutation, virulent = !!challenges.virulent;

    const roleKeys = Object.keys(ROLES);
    const chosen = players.map(p => p.role).filter(Boolean);
    if (new Set(chosen).size !== chosen.length) fail('Two players picked the same role');
    chosen.forEach(r => { if (!ROLES[r]) fail(`Unknown role ${r}`); });
    const freeRoles = shuffle(roleKeys.filter(r => !chosen.includes(r)));

    const colors = mutation ? [...COLORS, 'purple'] : COLORS.slice();
    const s = {
      challenges: { mutation, virulent },
      colors,
      players: [],
      cubes: Object.fromEntries(CITY_NAMES.map(c => [c, zeroCubes(colors)])),
      supply: Object.fromEntries(colors.map(c => [c, c === 'purple' ? PURPLE_CUBES : CUBES_PER_COLOR])),
      boxed: zeroCubes(colors), // cubes removed from the game (Unacceptable Loss)
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
      status: 'playing',
      result: null,
      log: [],
    };

    // Initial infections happen before pawns are placed, so no role protects them.
    log(s, 'Setting up initial infections.');
    for (const count of [3, 3, 3, 2, 2, 2, 1, 1, 1]) {
      const card = s.infectionDeck.pop();
      placeCubes(s, card, CITIES[card].color, count, new Set());
      s.infectionDiscard.push(card);
      log(s, `${card} infected with ${count} ${CITIES[card].color} cube${count > 1 ? 's' : ''}.`);
    }
    if (mutation) s.infectionDiscard.push('MUTATION1', 'MUTATION2');

    s.players = players.map(p => ({
      name: p.name,
      role: p.role || freeRoles.pop(),
      location: 'Austin',
      hand: [],
      stored: null, // Contingency Planner
      samples: zeroCubes(colors), // Field Operative
    }));

    const allEvents = Object.keys(EVENTS);
    const numEvents = Math.max(0, Math.min(allEvents.length, eventCount == null ? 2 * n : eventCount));
    const events = shuffle(allEvents).slice(0, numEvents).map(k => 'E:' + k);
    let deck = shuffle(CITY_NAMES.concat(events));

    const handSize = HAND_SIZE[n];
    s.players.forEach(p => { for (let i = 0; i < handSize; i++) p.hand.push(deck.pop()); });
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

  function isProtected(s, city, color) {
    return s.players.some(p =>
      (p.role === 'quarantineSpecialist' && (p.location === city || ADJ[p.location].includes(city))) ||
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
      if (s.cubes[city][color] >= 3) { outbreak(s, city, color, chain); return; }
      if (s.supply[color] <= 0) { lose(s, `Ran out of ${color} disease cubes.`); return; }
      s.cubes[city][color]++;
      s.supply[color]--;
    }
  }

  function outbreak(s, city, color, chain) {
    if (chain.has(city)) return;
    chain.add(city);
    const step = (color === s.virulent && vsOn(s, 'slipperySlope')) ? 2 : 1;
    s.outbreaks += step;
    log(s, `OUTBREAK in ${city} (${color})! Outbreaks: ${Math.min(s.outbreaks, MAX_OUTBREAKS)}/${MAX_OUTBREAKS}.` +
      (step === 2 ? ' (Slippery Slope: +2)' : ''));
    if (s.outbreaks >= MAX_OUTBREAKS) { lose(s, `${MAX_OUTBREAKS} outbreaks occurred.`); return; }
    for (const nb of ADJ[city]) {
      placeCubes(s, nb, color, 1, chain);
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
    const has = (c) => actor.hand.includes(c);

    // A neighbouring city is always reached by Drive/Ferry: it's free, so flights there would only waste a card.
    if (ADJ[from].includes(to)) return [{ method: 'drive', label: 'Drive / Ferry' }];
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
    if (color && color === s.virulent && vsOn(s, 'complexMolecularStructure') && s.cures[color] === 'none') n++;
    if (useSamples) n -= 2;
    return n;
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
      log(s, `Unacceptable Loss: ${k} ${v} cube(s) removed from the game.`);
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
            if (c) { infectCity(s, c, 1, 'purple', ' — Mutation'); s.infectionDiscard.push(c); }
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
    s.turnNo++;
    startTurn(s, (s.current + 1) % s.players.length);
    log(s, `--- ${s.players[s.current].name}'s turn ---`);
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
    if (a.fromStored) {
      if (p.stored !== card) fail('That event is not stored on your role card');
      p.stored = null;
      s.removed.push(card);
    } else {
      discardFromHand(s, p, card);
    }
    const key = eventKey(card);
    const prm = a.params || {};
    const ev = EVENTS[key];
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
        break;
      }
      case 'oneQuietNight':
        s.quietNight = true;
        break;
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
          ADJ[c].forEach(nb => { if (cities.includes(nb) && !seen.has(nb)) { seen.add(nb); stack.push(nb); } });
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
      if (a.type !== 'forecastOrder' || pid !== s.interrupt.player) {
        fail(`Waiting for ${s.players[s.interrupt.player].name} to finish Forecast`);
      }
    }
    const over = overLimit(s);
    if (over.length && !['discard', 'playEvent', 'forecastOrder'].includes(a.type)) {
      fail(`Waiting for ${over.map(i => s.players[i].name).join(', ')} to discard down to the hand limit`);
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
        movePawn(s, pawn, a.to, opt.method);
        log(s, `${s.players[pawn].name} moved ${from} → ${a.to} (${opt.label}${opt.method === 'ops' ? `, discarded ${a.card}` : ''}).`);
        spendAction(s);
        break;
      }
      case 'build': {
        requireActionTurn(s, pid);
        if (s.stations.includes(here)) fail('There is already a research station here');
        if (p.role !== 'opsExpert') discardFromHand(s, p, here);
        if (s.stations.length >= MAX_STATIONS) {
          if (!removeOne(s.stations, a.remove)) fail('All 6 stations are built — pick one to remove');
        }
        s.stations.push(here);
        log(s, `${p.name} built a research station in ${here}.`);
        spendAction(s);
        break;
      }
      case 'treat': {
        requireActionTurn(s, pid);
        const color = a.color;
        if (!s.colors.includes(color) || s.cubes[here][color] < 1) fail(`No ${color} cubes here`);
        const all = p.role === 'medic' || s.cures[color] !== 'none';
        const k = removeCubes(s, here, color, all ? 3 : 1);
        if (color === s.virulent) markVsTreated(s, here);
        log(s, `${p.name} treated ${k} ${color} cube(s) in ${here}.`);
        checkEradication(s);
        spendAction(s);
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
        const useSamples = !!a.useSamples;
        if (useSamples && (p.role !== 'fieldOperative' || p.samples[color] < 3)) fail('You need 3 samples of that color');
        const cards = Array.isArray(a.cards) ? a.cards : [];
        const need = cardsNeededForCure(s, p, color, useSamples);
        const what = color === 'purple' ? 'City cards (any colors)' : `${color} City cards`;
        if (new Set(cards).size !== cards.length || cards.length !== need) fail(`Select exactly ${need} ${what}`);
        const allowed = cureCards(s, p, color);
        cards.forEach(c => { if (!allowed.includes(c)) fail(`Invalid card ${c}`); });
        if (color === 'purple' && !cards.some(c => s.cubes[c].purple > 0)) {
          fail('At least 1 of the cards must be a city that has purple cubes');
        }
        cards.forEach(c => discardFromHand(s, p, c));
        if (useSamples) { p.samples[color] -= 3; s.supply[color] += 3; }
        s.cures[color] = 'cured';
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
      case 'pass':
        requireActionTurn(s, pid);
        log(s, `${p.name} passed an action.`);
        spendAction(s);
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
        break;
      case 'draw': {
        if (pid !== s.current || s.turn.phase !== 'draw') fail('Not time to draw');
        if (s.playerDeck.length < 2) { lose(s, 'Not enough player cards left to draw.'); break; }
        const drawn = [s.playerDeck.pop(), s.playerDeck.pop()];
        // A Mutation Event is resolved before an Epidemic drawn at the same time.
        if (isEpidemic(drawn[0]) && isMutationEvent(drawn[1])) drawn.reverse();
        s.turn.pending = drawn;
        continueDrawing(s);
        break;
      }
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
    GameError, createGame, apply, view, getMoveOptions, getShareOptions, cardsNeededForCure, cureCards, leaveBlocked,
    isCity, isEvent, isEpidemic, isMutationEvent, isMutationCard, vsKeyOf, eventKey, cardName, handLimit,
    RATES, MAX_STATIONS, MAX_OUTBREAKS,
  };
}));
