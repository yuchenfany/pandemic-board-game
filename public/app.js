/* global io, PData, Engine */
'use strict';
const { CITIES, COLORS, COLOR_HEX, ROLES, EVENTS, DIFFICULTIES, EDGES, MAP_W, MAP_H } = PData;
const CITY_NAMES = Object.keys(CITIES).sort();

const socket = io();
const ui = { room: null, game: null, you: -1, pawn: null, tab: 'log', chatSeen: 0, forecastFor: null };
const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------ DOM helpers

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(Infinity).forEach(c => { if (c != null && c !== false) el.append(c instanceof Node ? c : String(c)); });
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  kids.flat().forEach(c => c != null && el.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return el;
}
const show = (id) => ['home', 'lobby', 'game'].forEach(x => $('#' + x).classList.toggle('hidden', x !== id));

let toastTimer;
function toast(msg, kind = 'error') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + (kind === 'info' ? 'info' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

// ------------------------------------------------------------ modal helpers

function openModal(title, body, buttons = []) {
  $('#modalTitle').textContent = title;
  const b = $('#modalBody'); b.innerHTML = ''; b.append(body);
  const bb = $('#modalButtons'); bb.innerHTML = '';
  buttons.forEach(btn => bb.append(btn));
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); ui.forecastFor = null; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !ui.forecastFor) closeModal(); });
const cancelBtn = () => h('button', { onclick: closeModal }, 'Cancel');

function openChoice(title, choices, note) {
  const list = h('div', { class: 'choice-list' },
    choices.map(c => h('button', { onclick: () => { closeModal(); c.onClick(); } }, c.label)));
  openModal(title, h('div', null, note ? h('p', { class: 'muted' }, note) : null, list), [cancelBtn()]);
}

// fields: [{name, label, type: 'select'|'number', options: [[value, label]], min, max, value}]
function openForm(title, note, fields, onSubmit) {
  const inputs = {};
  const body = h('div', null, note ? h('p', { class: 'muted' }, note) : null,
    fields.map(f => {
      let input;
      if (f.type === 'select') {
        input = h('select', null, f.options.map(([v, l]) => h('option', { value: v }, l)));
        if (f.value != null) input.value = f.value;
      } else {
        input = h('input', { type: 'number', min: f.min ?? 0, max: f.max ?? 99, value: f.value ?? 0 });
      }
      inputs[f.name] = { input, f };
      return h('label', null, f.label, input);
    }));
  const ok = h('button', { class: 'primary', onclick: () => {
    const vals = {};
    for (const [k, { input, f }] of Object.entries(inputs)) vals[k] = f.type === 'number' ? Number(input.value) : input.value;
    closeModal();
    onSubmit(vals);
  } }, 'Confirm');
  openModal(title, body, [cancelBtn(), ok]);
}

// ------------------------------------------------------------ networking

const SESSION_KEY = 'pandemic:session';
const getSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } };
const setSession = (v) => v ? localStorage.setItem(SESSION_KEY, JSON.stringify(v)) : localStorage.removeItem(SESSION_KEY);

function joined(res) {
  if (res.error) {
    toast(res.error);
    setSession(null);
    show('home');
    return;
  }
  setSession({ code: res.code, token: res.token });
  history.replaceState(null, '', `?room=${res.code}`);
}

function send(action) {
  socket.emit('action', action, (res) => { if (res && res.error) toast(res.error); });
}

socket.on('connect', () => {
  const sess = getSession();
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (sess && (!urlRoom || urlRoom.toUpperCase() === sess.code)) {
    socket.emit('join', { code: sess.code, token: sess.token }, joined);
  } else {
    show('home');
  }
});

socket.on('state', (data) => {
  const prevTurn = ui.game && ui.game.turnNo;
  ui.room = data.room; ui.game = data.game; ui.you = data.you;
  if (ui.game && ui.game.turnNo !== prevTurn) ui.pawn = null;
  render();
});

// ------------------------------------------------------------ home

$('#nameInput').value = localStorage.getItem('pandemic:name') || '';
$('#codeInput').value = new URLSearchParams(location.search).get('room') || '';
const myName = () => {
  const n = $('#nameInput').value.trim();
  if (!n) { toast('Enter your name first'); return null; }
  localStorage.setItem('pandemic:name', n);
  return n;
};
$('#createBtn').onclick = () => { const name = myName(); if (name) socket.emit('create', { name }, joined); };
$('#joinBtn').onclick = () => {
  const name = myName();
  const code = $('#codeInput').value.trim().toUpperCase();
  if (name && code) socket.emit('join', { code, name }, joined);
};
$('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });

// ------------------------------------------------------------ render root

function render() {
  if (!ui.room || ui.you < 0) { show('home'); return; }
  if (!ui.room.started || !ui.game) { renderLobby(); show('lobby'); return; }
  show('game');
  renderGame();
}

// ------------------------------------------------------------ lobby

function renderLobby() {
  const r = ui.room;
  const isHost = r.host === ui.you;
  const taken = r.seats.map(x => x.role).filter(Boolean);
  const link = `${location.origin}/?room=${r.code}`;

  const seats = r.seats.map((seat, i) => {
    let roleCell;
    if (i === ui.you) {
      const sel = h('select', { onchange: (e) => socket.emit('pickRole', { role: e.target.value || null }, (res) => res && res.error && toast(res.error)) },
        h('option', { value: '' }, 'Random role'),
        Object.entries(ROLES).map(([k, ro]) => h('option', { value: k, disabled: taken.includes(k) && seat.role !== k }, ro.name + (ro.set === 'brink' ? ' (On the Brink)' : ''))));
      sel.value = seat.role || '';
      roleCell = sel;
    } else {
      roleCell = h('span', { class: 'muted' }, seat.role ? ROLES[seat.role].name : 'Random role');
    }
    return h('div', { class: 'seat' },
      h('span', { class: 'dot' + (seat.connected ? ' on' : '') }),
      h('span', { class: 'name' }, seat.name, i === ui.you ? ' (you)' : '', i === r.host ? h('span', { class: 'tag' }, 'host') : null),
      roleCell);
  });

  const cfg = r.config;
  const diffSel = h('select', { disabled: !isHost, onchange: (e) => socket.emit('config', { epidemics: Number(e.target.value) }) },
    DIFFICULTIES.map(d => h('option', { value: d.epidemics }, `${d.name} — ${d.epidemics} epidemics`)));
  diffSel.value = cfg.epidemics;
  const evSel = h('select', { disabled: !isHost, onchange: (e) => socket.emit('config', { eventsPerPlayer: Number(e.target.value) }) },
    [0, 1, 2, 3].map(n => h('option', { value: n }, `${n} per player${n === 2 ? ' (recommended)' : ''}`)));
  evSel.value = cfg.eventsPerPlayer;

  const lobby = $('#lobby');
  lobby.innerHTML = '';
  lobby.append(
    h('div', { class: 'lobby-grid' },
      h('div', { class: 'card' },
        h('h2', null, 'Room'),
        h('div', { class: 'room-code' }, r.code),
        h('p', { class: 'muted small' }, 'Share this link with your team: ',
          h('a', { class: 'link', onclick: () => { navigator.clipboard.writeText(link); toast('Invite link copied', 'info'); } }, link)),
        h('h2', null, `Players (${r.seats.length}/5)`),
        seats,
        h('h2', { style: { marginTop: '16px' } }, 'Settings'),
        h('label', null, 'Difficulty', diffSel),
        h('label', null, 'Event cards', evSel),
        h('div', { class: 'row', style: { marginTop: '12px' } },
          isHost ? h('button', { class: 'primary', disabled: r.seats.length < 2, onclick: () => socket.emit('start', null, (res) => res && res.error && toast(res.error)) },
            r.seats.length < 2 ? 'Need at least 2 players' : 'Start game') : h('span', { class: 'muted' }, 'Waiting for the host to start…'),
          h('button', { onclick: () => { socket.emit('leave'); setSession(null); history.replaceState(null, '', '/'); ui.room = null; show('home'); } }, 'Leave'))),
      h('div', { class: 'card' },
        h('h2', null, 'Roles'),
        h('div', { class: 'role-list' }, Object.values(ROLES).map(ro => h('div', null,
          h('b', null, h('span', { class: 'pawnchip', style: { background: ro.color } }), ro.name), ro.set === 'brink' ? h('span', { class: 'tag' }, 'On the Brink') : null,
          h('div', { class: 'muted small' }, ro.text)))))));
}

// ------------------------------------------------------------ map

let mapBuilt = false;
function buildMap() {
  const svg = $('#map');
  svg.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const edges = s('g');
  EDGES.forEach(([a, b]) => {
    const A = CITIES[a], B = CITIES[b];
    if (Math.abs(A.x - B.x) > MAP_W / 2) {
      // Wrap around the Pacific
      const [w, e] = A.x < B.x ? [A, B] : [B, A];
      edges.append(s('line', { class: 'edge', x1: w.x, y1: w.y, x2: e.x - MAP_W, y2: e.y }));
      edges.append(s('line', { class: 'edge', x1: e.x, y1: e.y, x2: w.x + MAP_W, y2: w.y }));
    } else {
      edges.append(s('line', { class: 'edge', x1: A.x, y1: A.y, x2: B.x, y2: B.y }));
    }
  });
  const cities = s('g');
  Object.entries(CITIES).forEach(([name, c]) => {
    const g = s('g', { class: 'city', 'data-city': name, transform: `translate(${c.x},${c.y})`, onclick: () => onCityClick(name) },
      s('circle', { class: 'ring', r: 15 }),
      s('circle', { class: 'dotc', r: 9, fill: COLOR_HEX[c.color] }),
      s('text', { y: 23 }, name),
      s('title', null, name));
    cities.append(g);
  });
  svg.append(edges, cities, s('g', { id: 'dyn', class: 'dyn' }));
  mapBuilt = true;
}

function renderMap(g) {
  if (!mapBuilt) buildMap();
  const reach = new Set();
  const myTurn = g.current === ui.you && g.turn.phase === 'actions' && g.status === 'playing';
  if (myTurn) {
    const pawn = selectedPawn(g);
    CITY_NAMES.forEach(c => { if (Engine.getMoveOptions(g, ui.you, pawn, c).length) reach.add(c); });
  }
  document.querySelectorAll('#map .city').forEach(el => {
    const name = el.dataset.city;
    el.classList.toggle('reachable', reach.has(name));
    el.classList.toggle('danger', COLORS.some(c => g.cubes[name][c] >= 3));
  });

  const dyn = $('#dyn');
  dyn.innerHTML = '';
  Object.entries(CITIES).forEach(([name, c]) => {
    if (g.stations.includes(name)) {
      dyn.append(s('path', { d: `M${c.x - 27} ${c.y + 2} l7 -7 l7 7 v7 h-14 z`, fill: '#fff', stroke: '#000', 'stroke-width': 1 }));
    }
    let row = 0;
    COLORS.forEach(col => {
      const n = g.cubes[name][col];
      if (!n) return;
      for (let k = 0; k < n; k++) {
        dyn.append(s('rect', { x: c.x + 12 + k * 10, y: c.y - 16 + row * 11, width: 9, height: 9, rx: 1.5,
          fill: COLOR_HEX[col], stroke: '#000', 'stroke-width': 1 }));
      }
      row++;
    });
  });
  const byCity = {};
  g.players.forEach((p, i) => (byCity[p.location] = byCity[p.location] || []).push(i));
  Object.entries(byCity).forEach(([city, idxs]) => {
    const c = CITIES[city];
    idxs.forEach((i, k) => {
      const x = c.x - ((idxs.length - 1) * 11) / 2 + k * 11;
      dyn.append(s('circle', { class: 'pawn' + (i === g.current ? ' current' : ''), cx: x, cy: c.y - 22, r: 6,
        fill: ROLES[g.players[i].role].color, stroke: '#000', 'stroke-width': 1.5 }));
    });
  });
}

function selectedPawn(g) {
  const me = g.players[ui.you];
  const canOthers = me.role === 'dispatcher' || g.turn.flags.specialOrders != null;
  if (ui.pawn == null || !canOthers) return ui.you;
  if (me.role !== 'dispatcher' && ui.pawn !== ui.you && ui.pawn !== g.turn.flags.specialOrders) return ui.you;
  return ui.pawn;
}

function onCityClick(city) {
  const g = ui.game;
  if (!g) return;
  const cubes = COLORS.filter(c => g.cubes[city][c]).map(c => `${g.cubes[city][c]} ${c}`).join(', ') || 'no cubes';
  const info = `${city} (${CITIES[city].color}) — ${cubes}${g.stations.includes(city) ? ', research station' : ''}`;
  if (g.current !== ui.you || g.turn.phase !== 'actions' || g.status !== 'playing') { toast(info, 'info'); return; }
  const pawn = selectedPawn(g);
  const opts = Engine.getMoveOptions(g, ui.you, pawn, city);
  if (!opts.length) { toast(info, 'info'); return; }
  const go = (o, card) => send({ type: 'move', pawn, to: city, method: o.method, card });
  const choices = [];
  opts.forEach(o => {
    if (o.method === 'ops') o.cards.forEach(card => choices.push({ label: `Operations Expert move (discard ${card})`, onClick: () => go(o, card) }));
    else choices.push({ label: o.label, onClick: () => go(o) });
  });
  const free = opts.find(o => o.method === 'drive' || o.method === 'shuttle' || o.method === 'dispatch');
  if (free && opts.length === 1) { go(free); return; }
  openChoice(`Move ${g.players[pawn].name} to ${city}`, choices, info);
}

// ------------------------------------------------------------ game render

const chip = (card, opts = {}) => {
  if (Engine.isEvent(card)) {
    const ev = EVENTS[Engine.eventKey(card)];
    return h('span', { class: 'chip event' + (opts.onclick ? ' clickable' : ''), title: ev.text, onclick: opts.onclick }, '★ ' + ev.name);
  }
  const col = CITIES[card] ? CITIES[card].color : 'black';
  return h('span', { class: `chip ${col}` + (opts.onclick ? ' clickable' : ''), style: { background: COLOR_HEX[col] }, onclick: opts.onclick, title: opts.title }, card);
};

function renderGame() {
  const g = ui.game;
  renderTopbar(g);
  renderMap(g);
  renderPlayers(g);
  renderBanner(g);
  renderActions(g);
  renderLog(g);
  renderChat();
  maybeOpenForecast(g);
}

function renderTopbar(g) {
  const top = $('#topbar');
  top.innerHTML = '';
  const rates = Engine.RATES;
  top.append(...[
    h('div', { class: 'stat' }, h('b', null, 'PANDEMIC'), h('span', { class: 'tag' }, ui.room.code)),
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, 'Outbreaks'),
      h('div', { class: 'track' }, Array.from({ length: 8 }, (_, i) => h('span', { class: i < g.outbreaks ? 'on' : '' }, i + 1)))),
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, 'Infection rate'),
      h('div', { class: 'track' }, rates.map((r, i) => h('span', { class: i === g.rateIdx ? 'cur' : '' }, r)))),
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, 'Cures'),
      COLORS.map(c => h('span', { class: 'cure', title: `${c}: ${g.cures[c]}`,
        style: { borderColor: COLOR_HEX[c], background: g.cures[c] === 'none' ? 'transparent' : COLOR_HEX[c], color: c === 'yellow' ? '#222' : '#fff' } },
      g.cures[c] === 'cured' ? '✓' : g.cures[c] === 'eradicated' ? '✕' : ''))),
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, 'Cubes left'),
      COLORS.map(c => h('span', null, h('span', { class: 'cube', style: { background: COLOR_HEX[c] } }), ' ', g.supply[c], ' '))),
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, 'Player deck'), `${g.playerDeckCount} (${g.epidemicsLeft} epidemic${g.epidemicsLeft === 1 ? '' : 's'})`),
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, 'Stations'), `${g.stations.length}/${Engine.MAX_STATIONS}`),
    h('div', { class: 'stat' },
      h('a', { class: 'link', onclick: () => showPile('Player discard pile', g.playerDiscard) }, `Player discards (${g.playerDiscard.length})`), ' · ',
      h('a', { class: 'link', onclick: () => showPile('Infection discard pile', g.infectionDiscard) }, `Infection discards (${g.infectionDiscard.length})`), ' · ',
      h('a', { class: 'link', onclick: showHelp }, 'Help')),
    g.quietNight ? h('span', { class: 'tag' }, 'One Quiet Night active') : null,
    g.travelBan != null ? h('span', { class: 'tag' }, 'Commercial Travel Ban') : null,
  ].filter(Boolean));
}

function showPile(title, cards) {
  openModal(title, h('div', { class: 'hand' }, cards.length ? cards.slice().reverse().map(c => chip(c)) : h('span', { class: 'muted' }, 'Empty')),
    [h('button', { onclick: closeModal }, 'Close')]);
}

function showHelp() {
  openModal('Reference', h('div', null,
    h('p', { class: 'muted small' }, 'Click a highlighted city on the map to move there. Use the buttons at the bottom for other actions. ' +
      'Click your ★ event cards to play them — events can be played at any time, even on other players\' turns.'),
    h('h4', null, 'Roles'),
    Object.values(ROLES).map(r => h('div', { class: 'small', style: { marginBottom: '6px' } }, h('b', null, r.name), ' — ', r.text)),
    h('h4', null, 'Events'),
    Object.values(EVENTS).map(e => h('div', { class: 'small', style: { marginBottom: '6px' } }, h('b', null, e.name), ' — ', e.text))),
  [h('button', { onclick: closeModal }, 'Close')]);
}

function renderPlayers(g) {
  const box = $('#players');
  box.innerHTML = '';
  const over = g.overLimit;
  g.players.forEach((p, i) => {
    const role = ROLES[p.role];
    const mine = i === ui.you;
    const mustDiscard = over.includes(i);
    const seat = ui.room.seats[i];
    const cards = p.hand.map(card => {
      let onclick = null;
      if (mine && g.status === 'playing') {
        if (Engine.isEvent(card)) onclick = () => mustDiscard ? discardOrPlay(card) : playEventDialog(card, false);
        else if (mustDiscard) onclick = () => send({ type: 'discard', card });
      }
      return chip(card, { onclick });
    });
    box.append(h('div', { class: 'player' + (i === g.current ? ' current' : '') },
      h('div', { class: 'hdr' },
        h('span', { class: 'pawnchip', style: { background: role.color } }),
        h('span', { class: 'nm' }, p.name, mine ? ' (you)' : ''),
        h('span', { class: 'dot' + (seat && seat.connected ? ' on' : ''), title: seat && seat.connected ? 'online' : 'offline' }),
        h('span', { class: 'loc' }, '📍 ', p.location)),
      h('div', { class: 'role', title: role.text }, role.name, ' · ',
        h('span', { class: mustDiscard ? 'over' : '' }, `${p.hand.length}/${g.handLimits[i]} cards`)),
      h('div', { class: 'hand' }, cards,
        p.stored ? [h('span', { class: 'muted small' }, 'Stored:'), chip(p.stored, { onclick: mine && g.status === 'playing' ? () => playEventDialog(p.stored, true) : null })] : null,
        p.role === 'fieldOperative' ? h('span', { class: 'muted small' }, 'Samples: ',
          COLORS.map(c => p.samples[c] ? [h('span', { class: 'cube', style: { background: COLOR_HEX[c] } }), `×${p.samples[c]} `] : null)) : null)));
  });
}

function discardOrPlay(card) {
  openChoice(Engine.cardName(card), [
    { label: 'Play this event', onClick: () => playEventDialog(card, false) },
    { label: 'Discard it', onClick: () => send({ type: 'discard', card }) },
  ]);
}

function renderBanner(g) {
  const b = $('#banner');
  b.innerHTML = '';
  const msg = (text, cls = '') => b.append(h('div', { class: 'msg ' + cls }, text));
  if (g.status === 'won') msg(['🎉 You won! ', g.result, ' ', ui.room.host === ui.you ? h('button', { onclick: () => socket.emit('backToLobby') }, 'Back to lobby') : null], 'good');
  if (g.status === 'lost') msg(['☠ Game over — ', g.result, ' ', ui.room.host === ui.you ? h('button', { onclick: () => socket.emit('backToLobby') }, 'Back to lobby') : null], 'bad');
  if (g.status !== 'playing') return;
  if (g.interrupt) msg(`${g.players[g.interrupt.player].name} is rearranging the infection deck (Forecast)…`, 'warn');
  g.overLimit.forEach(i => msg(i === ui.you
    ? `You are over your hand limit (${g.players[i].hand.length}/${g.handLimits[i]}). Click cards in your hand to discard (or play events).`
    : `Waiting for ${g.players[i].name} to discard down to ${g.handLimits[i]} cards…`, 'warn'));
  if (g.peek) msg(['Troubleshooter sees the next infections: ', g.peek.map(c => chip(c))]);
  if (g.rvdColor && g.players.some(p => p.hand.includes('E:rapidVaccineDeployment') || p.stored === 'E:rapidVaccineDeployment')) {
    msg('Rapid Vaccine Deployment can be played now (before the next action).', 'warn');
  }
  if (g.turn.phase === 'epidemic') msg('Epidemic! Last chance to play Resilient Population before Intensify.', 'warn');
}

function renderActions(g) {
  const bar = $('#actionbar');
  bar.innerHTML = '';
  const cur = g.players[g.current];
  const me = g.players[ui.you];
  const phaseText = { actions: `${g.turn.actionsLeft} action${g.turn.actionsLeft === 1 ? '' : 's'} left`, draw: 'drawing cards',
    epidemic: 'resolving an epidemic', infect: 'infecting cities', over: 'game over' }[g.turn.phase];
  bar.append(h('span', { class: 'status' }, g.current === ui.you ? 'Your turn' : `${cur.name}'s turn`, ` — ${phaseText}`));
  if (g.status !== 'playing' || g.current !== ui.you) return;
  const add = (...els) => bar.append(...els);
  const btn = (label, onclick, opts = {}) => h('button', { onclick, disabled: opts.disabled, class: opts.class, title: opts.title, style: opts.style }, label);
  const ph = g.turn.phase;

  if (ph === 'draw') add(btn('Draw 2 player cards', () => send({ type: 'draw' }), { class: 'primary' }));
  if (ph === 'epidemic') add(btn('Continue: Intensify', () => send({ type: 'continue' }), { class: 'primary' }));
  if (ph === 'infect') {
    const n = g.quietNight ? 0 : g.travelBan != null ? 1 : g.infectionRate;
    add(btn(n ? `Infect ${n} cit${n === 1 ? 'y' : 'ies'}` : 'Skip infection (One Quiet Night)', () => send({ type: 'infect' }), { class: 'primary' }));
  }
  if (ph !== 'actions') return;

  const here = me.location;
  // Pawn selector for Dispatcher / Special Orders
  if (me.role === 'dispatcher' || g.turn.flags.specialOrders != null) {
    const allowed = g.players.map((p, i) => i).filter(i => me.role === 'dispatcher' || i === ui.you || i === g.turn.flags.specialOrders);
    const sel = h('select', { onchange: (e) => { ui.pawn = Number(e.target.value); renderMap(g); } },
      allowed.map(i => h('option', { value: i }, `Move: ${g.players[i].name}`)));
    sel.value = selectedPawn(g);
    add(sel);
  }
  add(h('span', { class: 'muted small' }, 'Click a highlighted city to move.'), h('span', { class: 'sep' }));

  // Build
  const canBuild = !g.stations.includes(here) && (me.role === 'opsExpert' || me.hand.includes(here));
  add(btn('Build station', () => {
    if (g.stations.length >= Engine.MAX_STATIONS) {
      openForm('Build research station', 'All 6 stations are built. Choose one to move here.',
        [{ name: 'remove', label: 'Remove station from', type: 'select', options: g.stations.map(c => [c, c]) }],
        (v) => send({ type: 'build', remove: v.remove }));
    } else send({ type: 'build' });
  }, { disabled: !canBuild, title: me.role === 'opsExpert' ? 'No card needed' : `Discard ${here}` }));

  // Treat
  COLORS.filter(c => g.cubes[here][c] > 0).forEach(c => add(btn(`Treat ${c}`, () => send({ type: 'treat', color: c }),
    { class: 'colorbtn', style: { borderColor: COLOR_HEX[c] } })));

  // Share
  const shares = Engine.getShareOptions(g, ui.you);
  add(btn('Share knowledge', () => openChoice('Share knowledge', shares.map(o => ({
    label: o.mode === 'give' ? `Give ${o.card} to ${g.players[o.other].name}` : `Take ${o.card} from ${g.players[o.other].name}`,
    onClick: () => send({ type: 'share', ...o }),
  }))), { disabled: !shares.length }));

  // Cure
  const cureColors = COLORS.filter(c => {
    if (g.cures[c] !== 'none' || !g.stations.includes(here)) return false;
    const n = me.hand.filter(x => CITIES[x] && CITIES[x].color === c).length;
    const samples = me.role === 'fieldOperative' && me.samples[c] >= 3;
    return n >= Engine.cardsNeededForCure(me, false) || (samples && n >= Engine.cardsNeededForCure(me, true));
  });
  add(btn('Discover cure', () => cureDialog(g, cureColors), { disabled: !cureColors.length }));

  // Role-specific
  if (me.role === 'contingencyPlanner') {
    const evs = g.playerDiscard.filter(Engine.isEvent);
    add(btn('Take discarded event', () => openChoice('Store an event', evs.map(c => ({ label: Engine.cardName(c), onClick: () => send({ type: 'contingencyTake', card: c }) }))),
      { disabled: !evs.length || !!me.stored }));
  }
  if (me.role === 'archivist') {
    add(btn(`Retrieve ${here}`, () => send({ type: 'archivistRetrieve' }), { disabled: g.turn.flags.archivist || !g.playerDiscard.includes(here) }));
  }
  if (me.role === 'fieldOperative') {
    COLORS.filter(c => g.cubes[here][c] > 0).forEach(c => add(btn(`Sample ${c}`, () => send({ type: 'fieldSample', color: c }),
      { disabled: g.turn.flags.sample, class: 'colorbtn', style: { borderColor: COLOR_HEX[c] } })));
  }
  if (me.role === 'epidemiologist') {
    const opts = [];
    g.players.forEach((q, qi) => { if (qi !== ui.you && q.location === here) q.hand.filter(Engine.isCity).forEach(c => opts.push({ qi, c })); });
    add(btn('Take a card (free)', () => openChoice('Epidemiologist: take a City card', opts.map(o => ({
      label: `Take ${o.c} from ${g.players[o.qi].name}`, onClick: () => send({ type: 'epidemiologistTake', from: o.qi, card: o.c }),
    }))), { disabled: g.turn.flags.epidemiologist || !opts.length }));
  }

  add(h('span', { class: 'spacer' }),
    btn('Pass action', () => send({ type: 'pass' })),
    btn('End actions', () => openChoice('End your actions?', [{ label: `Yes, skip my remaining ${g.turn.actionsLeft} action(s)`, onClick: () => send({ type: 'endActions' }) }])));
}

function cureDialog(g, colors) {
  const me = g.players[ui.you];
  const pickColor = (color) => {
    const cards = me.hand.filter(x => CITIES[x] && CITIES[x].color === color);
    const canSample = me.role === 'fieldOperative' && me.samples[color] >= 3;
    const boxes = cards.map((c, i) => ({ c, box: h('input', { type: 'checkbox', checked: i < Engine.cardsNeededForCure(me, false) }) }));
    const sampleBox = canSample ? h('input', { type: 'checkbox' }) : null;
    const body = h('div', null,
      h('p', { class: 'muted' }, `Select ${Engine.cardsNeededForCure(me, false)} cards` + (canSample ? ` (or ${Engine.cardsNeededForCure(me, true)} cards + 3 samples)` : '') + '.'),
      boxes.map(({ c, box }) => h('label', { class: 'check' }, box, chip(c))),
      sampleBox ? h('label', { class: 'check' }, sampleBox, 'Use 3 samples from my role card') : null);
    openModal(`Discover a cure: ${color}`, body, [cancelBtn(), h('button', { class: 'primary', onclick: () => {
      closeModal();
      send({ type: 'cure', color, cards: boxes.filter(b => b.box.checked).map(b => b.c), useSamples: !!(sampleBox && sampleBox.checked) });
    } }, 'Discover cure')]);
  };
  if (colors.length === 1) pickColor(colors[0]);
  else openChoice('Which disease?', colors.map(c => ({ label: c, onClick: () => pickColor(c) })));
}

// ------------------------------------------------------------ events

function playEventDialog(card, fromStored) {
  const g = ui.game;
  const key = Engine.eventKey(card);
  const ev = EVENTS[key];
  const play = (params) => send({ type: 'playEvent', card, fromStored, params });
  const players = g.players.map((p, i) => [i, `${p.name} (${ROLES[p.role].name})`]);
  const cityOpts = CITY_NAMES.map(c => [c, c]);
  const withCubes = [];
  CITY_NAMES.forEach(c => COLORS.forEach(col => { if (g.cubes[c][col]) withCubes.push([`${c}|${col}`, `${c} — ${col} (${g.cubes[c][col]})`]); }));

  switch (key) {
    case 'airlift':
      return openForm(ev.name, ev.text, [
        { name: 'pawn', label: 'Pawn', type: 'select', options: players, value: g.current },
        { name: 'to', label: 'Destination', type: 'select', options: cityOpts }],
      (v) => play({ pawn: Number(v.pawn), to: v.to }));
    case 'governmentGrant': {
      const fields = [{ name: 'city', label: 'City', type: 'select', options: cityOpts.filter(([c]) => !g.stations.includes(c)) }];
      if (g.stations.length >= Engine.MAX_STATIONS) fields.push({ name: 'remove', label: 'Remove station from', type: 'select', options: g.stations.map(c => [c, c]) });
      return openForm(ev.name, ev.text, fields, (v) => play(v));
    }
    case 'resilientPopulation':
      if (!g.infectionDiscard.length) return toast('The infection discard pile is empty');
      return openForm(ev.name, ev.text, [{ name: 'card', label: 'Infection card to remove', type: 'select', options: g.infectionDiscard.map(c => [c, c]) }], (v) => play(v));
    case 'newAssignment': {
      const unused = Object.entries(ROLES).filter(([k]) => !g.players.some(p => p.role === k)).map(([k, r]) => [k, r.name]);
      return openForm(ev.name, ev.text, [
        { name: 'player', label: 'Player', type: 'select', options: players },
        { name: 'role', label: 'New role', type: 'select', options: unused }],
      (v) => play({ player: Number(v.player), role: v.role }));
    }
    case 'rapidVaccineDeployment': {
      const color = g.rvdColor;
      if (!color) return toast('Play this right after a cure is discovered');
      const cities = CITY_NAMES.filter(c => g.cubes[c][color] > 0);
      return openForm(ev.name, `${ev.text} Color: ${color}. Cities must be connected to each other.`,
        cities.map(c => ({ name: c, label: `${c} (${g.cubes[c][color]} ${color})`, type: 'number', min: 0, max: g.cubes[c][color], value: 0 })),
        (v) => play({ removals: Object.entries(v).filter(([, n]) => n > 0).map(([city, n]) => ({ city, n })) }));
    }
    case 'reexaminedResearch': {
      const cards = g.playerDiscard.filter(Engine.isCity);
      if (!cards.length) return toast('No City cards in the discard pile');
      return openForm(ev.name, ev.text, [
        { name: 'card', label: 'Card', type: 'select', options: cards.map(c => [c, c]) },
        { name: 'player', label: 'Give to', type: 'select', options: players, value: ui.you }],
      (v) => play({ card: v.card, player: Number(v.player) }));
    }
    case 'remoteTreatment': {
      if (!withCubes.length) return toast('There are no cubes on the board');
      const opts = [['', '— none —'], ...withCubes];
      return openForm(ev.name, ev.text, [
        { name: 'a', label: 'First cube', type: 'select', options: withCubes },
        { name: 'b', label: 'Second cube (may be the same city)', type: 'select', options: opts, value: '' }],
      (v) => play({ removals: [v.a, v.b].filter(Boolean).map(x => { const [city, color] = x.split('|'); return { city, color }; }) }));
    }
    case 'specialOrders':
      return openForm(ev.name, ev.text, [{ name: 'pawn', label: 'Pawn', type: 'select', options: players.filter(([i]) => i !== g.current) }],
        (v) => play({ pawn: Number(v.pawn) }));
    default:
      return openChoice(ev.name, [{ label: `Play ${ev.name}`, onClick: () => play({}) }], ev.text);
  }
}

function maybeOpenForecast(g) {
  if (!g.interrupt || g.interrupt.type !== 'forecast' || g.interrupt.player !== ui.you) return;
  const id = g.log.length + ':' + g.interrupt.cards.join();
  if (ui.forecastFor === id) return;
  const order = g.interrupt.cards.slice();
  const list = h('div');
  const draw = () => {
    list.innerHTML = '';
    order.forEach((c, i) => list.append(h('div', { class: 'forecast-row' },
      h('span', { class: 'n' }, i === 0 ? 'Top' : i + 1), chip(c),
      h('button', { disabled: i === 0, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); } }, '↑'),
      h('button', { disabled: i === order.length - 1, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); } }, '↓'))));
  };
  draw();
  openModal('Forecast — arrange the infection deck', h('div', null, h('p', { class: 'muted' }, 'The first card is drawn next.'), list),
    [h('button', { class: 'primary', onclick: () => { closeModal(); send({ type: 'forecastOrder', order }); } }, 'Confirm order')]);
  ui.forecastFor = id;
}

// ------------------------------------------------------------ log & chat

function renderLog(g) {
  const v = $('#logView');
  const atBottom = v.scrollHeight - v.scrollTop - v.clientHeight < 30;
  v.innerHTML = '';
  g.log.forEach(e => {
    const cls = /EPIDEMIC|ERADICATED|cure|VICTORY|GAME OVER/.test(e.msg) ? 'ep' : /OUTBREAK/.test(e.msg) ? 'ob' : /^---/.test(e.msg) ? 'turn' : '';
    v.append(h('div', { class: cls }, e.msg));
  });
  if (atBottom || !renderLog.done) v.scrollTop = v.scrollHeight;
  renderLog.done = true;
}

function renderChat() {
  const box = $('#chatMsgs');
  const chat = ui.room.chat;
  box.innerHTML = '';
  chat.forEach(m => box.append(h('div', null, h('b', null, m.name, ': '), m.text)));
  box.scrollTop = box.scrollHeight;
  if (ui.tab === 'chat') ui.chatSeen = chat.length;
  const unread = chat.length - ui.chatSeen;
  $('#chatBadge').textContent = unread > 0 ? `(${unread})` : '';
}

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  ui.tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  $('#logView').classList.toggle('hidden', ui.tab !== 'log');
  $('#chatView').classList.toggle('hidden', ui.tab !== 'chat');
  if (ui.room) renderChat();
}));
$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#chatInput').value.trim();
  if (text) socket.emit('chat', { text });
  $('#chatInput').value = '';
});
