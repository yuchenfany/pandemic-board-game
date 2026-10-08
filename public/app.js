/* global PData, Engine, Room, HostNet, GuestNet */
'use strict';
const { CITIES, COLORS, COLOR_HEX, ROLES, EVENTS, DIFFICULTIES, EDGES, MAP_W, MAP_H } = PData;
const CITY_NAMES = Object.keys(CITIES).sort();
const ICON = { blue: '🔵', yellow: '🟡', black: '⚫', red: '🔴' };

let net = null;
const ui = {
  room: null, game: null, you: -1, pawn: null, tab: 'log', chatSeen: 0, forecastFor: null,
  logSeen: null, view: { x: 0, y: 0, w: MAP_W, h: MAP_H }, dragged: false,
};
const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------ DOM helpers

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    } else if (k === 'class') el.className = v;
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
// Rich hover tooltips for any element with data-tip (+ optional data-tip-title).
const hoverTip = $('#hovertip');
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest ? e.target.closest('[data-tip]') : null;
  if (!el) { hoverTip.classList.add('hidden'); return; }
  hoverTip.innerHTML = '';
  if (el.dataset.tipTitle) hoverTip.append(h('b', null, el.dataset.tipTitle));
  hoverTip.append(h('div', null, el.dataset.tip));
  hoverTip.classList.remove('hidden');
  const r = el.getBoundingClientRect();
  const x = Math.min(innerWidth - hoverTip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - hoverTip.offsetWidth / 2));
  let y = r.top - hoverTip.offsetHeight - 8;
  if (y < 8) y = r.bottom + 8;
  hoverTip.style.left = `${x}px`;
  hoverTip.style.top = `${y}px`;
});
const roleTip = (role) => ({ 'data-tip': ROLES[role].text, 'data-tip-title': ROLES[role].name });

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } },
};

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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ui.forecastFor) closeModal(); });
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

// ------------------------------------------------------------ session & networking

const SESSION_KEY = 'pandemic:session';
const getSession = () => store.get(SESSION_KEY);
const setSession = (v) => store.set(SESSION_KEY, v);
const inviteLink = (code) => `${location.origin}${location.pathname}?room=${code}`;

function wire(n) {
  n.on('state', (data) => {
    const prevTurn = ui.game && ui.game.turnNo;
    ui.room = data.room; ui.game = data.game; ui.you = data.you;
    if (ui.game && ui.game.turnNo !== prevTurn) ui.pawn = null;
    render();
  });
  n.on('status', () => { renderConn(); if (ui.room) render(); });
}

function connectingScreen(text) {
  show('home');
  $('#homeForm').classList.add('hidden');
  $('#homeConnecting').classList.remove('hidden');
  $('#connectingText').textContent = text;
}
function homeScreen() {
  show('home');
  $('#homeForm').classList.remove('hidden');
  $('#homeConnecting').classList.add('hidden');
}

function leaveRoom() {
  if (net) net.close();
  net = null;
  setSession(null);
  ui.room = ui.game = null; ui.you = -1; ui.logSeen = null; ui.prevCubes = null;
  history.replaceState(null, '', location.pathname);
  homeScreen();
}

function hostNewRoom(name) {
  const code = Room.newCode();
  net = new HostNet(code, new Room(code));
  wire(net);
  net.start();
  net.emit('join', { name }, (res) => {
    setSession({ code, token: res.token, host: true });
    history.replaceState(null, '', `?room=${code}`);
  });
}

function resumeHosting(sess, saved) {
  const room = new Room(sess.code, saved);
  room.seats.forEach(seat => { seat.connected = seat.token === sess.token; });
  net = new HostNet(sess.code, room);
  net.myToken = sess.token;
  wire(net);
  net.start();
  net.broadcast();
}

function joinRoom(code, joinData) {
  net = new GuestNet(code);
  wire(net);
  connectingScreen(`Connecting to room ${code}…`);
  net.on('status', ({ text }) => { if (!ui.room) $('#connectingText').textContent = text; });
  net.join(joinData, (res) => {
    if (res.error) {
      toast(res.error);
      if (!ui.room) leaveRoom();
      return;
    }
    setSession({ code, token: res.token, host: false });
    history.replaceState(null, '', `?room=${code}`);
  });
}

function send(action) {
  if (!net) return;
  net.emit('action', action, (res) => { if (res && res.error) toast(res.error); });
}
function req(ev, data) {
  if (!net) return;
  net.emit(ev, data, (res) => { if (res && res.error) toast(res.error); });
}

// ------------------------------------------------------------ home

$('#nameInput').value = store.get('pandemic:name') || '';
$('#codeInput').value = new URLSearchParams(location.search).get('room') || '';
const myName = () => {
  const n = $('#nameInput').value.trim();
  if (!n) { toast('Enter your name first'); $('#nameInput').focus(); return null; }
  store.set('pandemic:name', n);
  return n;
};
$('#createBtn').onclick = () => { const name = myName(); if (name) hostNewRoom(name); };
$('#joinBtn').onclick = () => {
  const name = myName();
  const code = $('#codeInput').value.trim().toUpperCase();
  if (!code) { toast('Enter the room code'); return; }
  if (name) joinRoom(code, { name });
};
$('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });
$('#cancelConnect').onclick = leaveRoom;

(function buildHomeMap() {
  const svg = $('#homeMap');
  svg.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.append(...landLayers('h'));
  EDGES.forEach(([a, b]) => {
    const A = CITIES[a], B = CITIES[b];
    if (Math.abs(A.x - B.x) < MAP_W / 2) svg.append(s('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y }));
  });
  Object.values(CITIES).forEach((c, i) => svg.append(s('circle', { cx: c.x, cy: c.y, r: 5, fill: COLOR_HEX[c.color], style: `animation-delay:${(i % 12) * 0.33}s` })));
}());

function boot() {
  const sess = getSession();
  const urlRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (sess && (!urlRoom || urlRoom === sess.code)) {
    const saved = sess.host ? HostNet.savedRoom(sess.code) : null;
    // A game saved by an older version (e.g. before cities were renamed) can't be resumed.
    if (saved && saved.game && Object.keys(saved.game.cubes).some(c => !CITIES[c])) saved.game = null;
    if (sess.host && saved) return resumeHosting(sess, saved);
    if (!sess.host) return joinRoom(sess.code, { token: sess.token, name: store.get('pandemic:name') });
    setSession(null);
  }
  homeScreen();
  if (urlRoom) $('#nameInput').focus();
}

// ------------------------------------------------------------ render root

function render() {
  if (!ui.room || ui.you < 0) return;
  if (!ui.room.started || !ui.game) { renderLobby(); show('lobby'); return; }
  show('game');
  renderGame();
}

function connBadge() {
  if (!net) return null;
  const cls = net.status === 'online' ? 'dot on' : 'dot wait';
  return h('span', { class: 'conn', title: net.statusText, style: { display: 'flex', alignItems: 'center', gap: '6px' } },
    h('span', { class: cls }), h('span', { class: 'muted small' }, net instanceof HostNet ? (net.status === 'online' ? 'Hosting' : net.statusText) : net.statusText));
}
function renderConn() {
  const el = document.querySelector('[data-conn]');
  if (el) { el.innerHTML = ''; const b = connBadge(); if (b) el.append(b); }
}

// ------------------------------------------------------------ lobby

function renderLobby() {
  const r = ui.room;
  const isHost = r.host === ui.you;
  const link = inviteLink(r.code);
  const mySeat = r.seats[ui.you];
  const ownerOf = (role) => r.seats.findIndex(x => x.role === role);

  const seats = r.seats.map((seat, i) => h('div', { class: 'seat' },
    h('span', { class: 'dot' + (seat.connected ? ' on' : '') }),
    h('span', { class: 'name' }, seat.name, i === ui.you ? h('span', { class: 'muted' }, ' (you)') : '', i === r.host ? h('span', { class: 'tag' }, 'host') : null),
    h('span', { class: 'rolename' }, seat.role ? [h('span', { class: 'pawnchip', style: { background: ROLES[seat.role].color } }), ROLES[seat.role].name] : 'Random role')));

  const cfg = r.config;
  const diffSel = h('select', { disabled: !isHost, onchange: (e) => req('config', { epidemics: Number(e.target.value) }) },
    DIFFICULTIES.map(d => h('option', { value: d.epidemics }, `${d.name} — ${d.epidemics} epidemics`)));
  diffSel.value = cfg.epidemics;
  const evSel = h('select', { disabled: !isHost, onchange: (e) => req('config', { eventsPerPlayer: Number(e.target.value) }) },
    [0, 1, 2, 3].map(n => h('option', { value: n }, `${n} per player${n === 2 ? ' (recommended)' : ''}`)));
  evSel.value = cfg.eventsPerPlayer;

  const roleCards = [
    h('div', { class: 'role-card' + (!mySeat.role ? ' mine' : ''), style: { '--rc': '#6b7a8f' }, onclick: () => req('pickRole', { role: null }) },
      h('div', { class: 'rn' }, '🎲 Random'), h('div', { class: 'rt' }, 'Get a random unused role when the game starts.')),
    ...Object.entries(ROLES).map(([key, ro]) => {
      const owner = ownerOf(key);
      const mine = owner === ui.you, taken = owner >= 0 && !mine;
      return h('div', { class: 'role-card' + (mine ? ' mine' : '') + (taken ? ' taken' : ''), style: { '--rc': ro.color },
        onclick: () => !taken && req('pickRole', { role: mine ? null : key }) },
      owner >= 0 ? h('span', { class: 'who' }, r.seats[owner].name) : null,
      h('div', { class: 'rn' }, ro.name, ro.set === 'brink' ? h('span', { class: 'tag' }, 'Brink') : null),
      h('div', { class: 'rt' }, ro.text));
    }),
  ];

  const lobby = $('#lobby');
  lobby.innerHTML = '';
  lobby.append(
    h('div', { class: 'lobby-head' }, h('div', { class: 'logo' }, 'PANDEMIC'), h('span', { class: 'muted' }, 'Lobby'), h('div', { class: 'conn', 'data-conn': '' })),
    h('div', { class: 'lobby-grid' },
      h('div', { class: 'card' },
        h('h2', null, 'Room code'),
        h('div', { class: 'room-code' }, r.code),
        h('div', { class: 'invite' },
          h('input', { value: link, readonly: true, onclick: (e) => e.target.select() }),
          h('button', { onclick: () => { navigator.clipboard.writeText(link).then(() => toast('Invite link copied', 'info')); } }, 'Copy link')),
        h('h2', null, `Players (${r.seats.length}/5)`),
        seats,
        h('h2', { style: { marginTop: '18px' } }, 'Settings'),
        h('label', null, 'Difficulty', diffSel),
        h('label', null, 'Event cards', evSel),
        h('div', { class: 'row', style: { marginTop: '14px' } },
          isHost ? h('button', { class: 'primary big', style: { flex: '1' }, disabled: r.seats.length < 2, onclick: () => req('start') },
            r.seats.length < 2 ? 'Waiting for players…' : 'Start game') : h('span', { class: 'muted', style: { flex: '1' } }, 'Waiting for the host to start…'),
          h('button', { onclick: () => {
            if (isHost && !confirm('Close this room for everyone?')) return;
            if (isHost) return leaveRoom();
            req('leave');
            setTimeout(leaveRoom, 300);
          } }, 'Leave')),
        isHost ? h('p', { class: 'fine' }, 'You are hosting: the game runs in this tab. Keep it open (refreshing is fine).') : null),
      h('div', { class: 'card' },
        h('h2', null, 'Choose your role'),
        h('div', { class: 'roles-grid' }, roleCards))));
  renderConn();
}

// ------------------------------------------------------------ map

let mapBuilt = false;

// Pandemic-board style continents: glowing coastline over a gridded blue landmass.
function landLayers(id) {
  const land = typeof WORLD_LAND === 'string' ? WORLD_LAND : '';
  const defs = s('defs', null,
    s('linearGradient', { id: `${id}-land`, x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0%', 'stop-color': '#24577a' }), s('stop', { offset: '100%', 'stop-color': '#173f5c' })),
    s('pattern', { id: `${id}-grid`, width: 8, height: 8, patternUnits: 'userSpaceOnUse' },
      s('path', { d: 'M8 0H0V8', fill: 'none', stroke: 'rgba(160,220,255,.10)', 'stroke-width': 0.6 })),
    s('filter', { id: `${id}-glow`, x: '-5%', y: '-5%', width: '110%', height: '110%' },
      s('feGaussianBlur', { stdDeviation: 3 })));
  return [defs,
    s('path', { d: land, fill: 'none', stroke: '#4fc3ff', 'stroke-width': 5, opacity: 0.35, filter: `url(#${id}-glow)` }),
    s('path', { d: land, fill: `url(#${id}-land)` }),
    s('path', { d: land, fill: `url(#${id}-grid)` }),
    s('path', { d: land, fill: 'none', stroke: '#7fd6ff', 'stroke-width': 0.8, opacity: 0.8 })];
}
const edgeEls = {};
const pawnEls = [];

function buildMap() {
  const svg = $('#map');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.append(...landLayers('m'));
  const edges = s('g');
  const addEdge = (a, b, attrs) => {
    const el = s('line', { class: 'edge', ...attrs });
    edges.append(el);
    (edgeEls[a] = edgeEls[a] || []).push(el);
    (edgeEls[b] = edgeEls[b] || []).push(el);
  };
  EDGES.forEach(([a, b]) => {
    const A = CITIES[a], B = CITIES[b];
    if (Math.abs(A.x - B.x) > MAP_W / 2) {
      const [w, e] = A.x < B.x ? [A, B] : [B, A];
      addEdge(a, b, { x1: w.x, y1: w.y, x2: e.x - MAP_W, y2: e.y });
      addEdge(a, b, { x1: e.x, y1: e.y, x2: w.x + MAP_W, y2: w.y });
    } else {
      addEdge(a, b, { x1: A.x, y1: A.y, x2: B.x, y2: B.y });
    }
  });
  const cities = s('g');
  Object.entries(CITIES).forEach(([name, c]) => {
    const g = s('g', { class: 'city', 'data-city': name, transform: `translate(${c.x},${c.y})`,
      onclick: () => { if (!ui.dragged) onCityClick(name); },
      onmouseenter: () => showTip(name), onmouseleave: hideTip },
    s('circle', { class: 'hit', r: 18, fill: 'transparent' }),
    s('circle', { class: 'ring', r: 15 }),
    s('circle', { class: 'dotc', r: 9, fill: COLOR_HEX[c.color] }),
    s('text', { y: 24 }, name));
    cities.append(g);
  });
  svg.append(edges, s('g', { id: 'dyn', class: 'dyn' }), cities, s('g', { id: 'pawns' }), s('g', { id: 'fx', class: 'dyn' }));
  setupPanZoom(svg);
  applyView();
  mapBuilt = true;
}

function applyView() {
  const v = ui.view;
  $('#map').setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
}
function clampView() {
  const v = ui.view;
  v.w = Math.min(MAP_W, Math.max(MAP_W / 4, v.w));
  v.h = v.w * MAP_H / MAP_W;
  v.x = Math.min(MAP_W - v.w, Math.max(0, v.x));
  v.y = Math.min(MAP_H - v.h, Math.max(0, v.y));
}
function zoomAt(factor, px, py) {
  const v = ui.view;
  const nw = Math.min(MAP_W, Math.max(MAP_W / 4, v.w * factor));
  const k = nw / v.w;
  v.x = px - (px - v.x) * k;
  v.y = py - (py - v.y) * k;
  v.w = nw;
  clampView();
  applyView();
}
function setupPanZoom(svg) {
  const toSvg = (cx, cy) => {
    const pt = new DOMPoint(cx, cy).matrixTransform(svg.getScreenCTM().inverse());
    return pt;
  };
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = toSvg(e.clientX, e.clientY);
    zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
  }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, vx: ui.view.x, vy: ui.view.y, moved: false, id: e.pointerId };
    ui.dragged = false;
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) { drag.moved = true; svg.setPointerCapture(drag.id); svg.classList.add('dragging'); hideTip(); }
    const rect = svg.getBoundingClientRect();
    const scale = Math.max(ui.view.w / rect.width, ui.view.h / rect.height);
    ui.view.x = drag.vx - dx * scale;
    ui.view.y = drag.vy - dy * scale;
    clampView();
    applyView();
  });
  const end = () => {
    if (drag && drag.moved) { ui.dragged = true; setTimeout(() => { ui.dragged = false; }, 50); }
    drag = null;
    svg.classList.remove('dragging');
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  document.querySelectorAll('#zoom button').forEach(b => b.addEventListener('click', () => {
    const v = ui.view;
    if (b.dataset.zoom === 'reset') { Object.assign(v, { x: 0, y: 0, w: MAP_W, h: MAP_H }); applyView(); return; }
    zoomAt(b.dataset.zoom === 'in' ? 1 / 1.3 : 1.3, v.x + v.w / 2, v.y + v.h / 2);
  }));
}

function showTip(city) {
  (edgeEls[city] || []).forEach(e => e.classList.add('hot'));
  const g = ui.game;
  if (!g) return;
  const c = CITIES[city];
  const cubes = COLORS.filter(col => g.cubes[city][col]).map(col => `${ICON[col]} ${g.cubes[city][col]}`).join('  ');
  const here = g.players.filter(p => p.location === city).map(p => p.name);
  const tip = $('#tip');
  tip.innerHTML = '';
  tip.append(
    h('b', null, city), ' ', h('span', { class: 'muted' }, `· ${c.color}`),
    h('div', null, cubes || h('span', { class: 'muted' }, 'No disease cubes')),
    g.stations.includes(city) ? h('div', null, '🏥 Research station') : null,
    here.length ? h('div', null, '👤 ', here.join(', ')) : null,
    h('div', { class: 'muted small' }, 'Connects to: ', PData.ADJ[city].join(', ')));
  const wrap = $('#mapwrap').getBoundingClientRect();
  const el = document.querySelector(`[data-city="${CSS.escape(city)}"] .dotc`).getBoundingClientRect();
  let x = el.right - wrap.left + 12, y = el.top - wrap.top - 6;
  tip.classList.remove('hidden');
  if (x + tip.offsetWidth > wrap.width - 8) x = el.left - wrap.left - tip.offsetWidth - 12;
  if (y + tip.offsetHeight > wrap.height - 8) y = wrap.height - tip.offsetHeight - 8;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
function hideTip() {
  document.querySelectorAll('#map .edge.hot').forEach(e => e.classList.remove('hot'));
  $('#tip').classList.add('hidden');
}

function renderMap(g, delays = {}) {
  if (!mapBuilt) buildMap();
  const prev = ui.prevCubes;
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
      dyn.append(s('g', { transform: `translate(${c.x - 27},${c.y - 4})` },
        s('path', { d: 'M0 4 L7 -3 L14 4 V12 H0 Z', fill: '#fff', stroke: '#000', 'stroke-width': 1 }),
        s('path', { d: 'M5.5 5 h3 v2 h2 v3 h-2 v2 h-3 v-2 h-2 v-3 h2 z', fill: '#d8433b', transform: 'scale(.8) translate(1.8,1)' })));
    }
    let row = 0;
    COLORS.forEach(col => {
      const n = g.cubes[name][col];
      const before = prev ? prev[name][col] : n;
      const shown = Math.max(n, before);
      if (!shown) return;
      for (let k = 0; k < shown; k++) {
        const x = c.x + 12 + k * 10, y = c.y - 17 + row * 11;
        let cls = 'cube', style = '';
        if (k >= n) cls += ' cube-gone';
        else if (k >= before) { cls += ' cube-new'; style = `animation-delay:${(delays[name] || 0) + (k - before) * 140}ms`; }
        dyn.append(s('g', { class: cls, style },
          s('rect', { x, y, width: 9, height: 9, rx: 1.5, fill: COLOR_HEX[col], stroke: 'rgba(0,0,0,.7)', 'stroke-width': 1 }),
          s('rect', { x: x + 1, y: y + 1, width: 7, height: 2.5, rx: 1, fill: '#fff', opacity: 0.35 })));
      }
      row++;
    });
  });
  ui.prevCubes = JSON.parse(JSON.stringify(g.cubes));

  // Pawns are persistent so CSS can animate them between cities.
  const layer = $('#pawns');
  while (pawnEls.length < g.players.length) {
    const i = pawnEls.length;
    const bob = s('g', { class: 'bob' },
      s('path', { d: 'M0 0 C-5 -7 -8 -11 -8 -16 A8 8 0 1 1 8 -16 C8 -11 5 -7 0 0 Z', stroke: '#000', 'stroke-width': 1.3 }),
      s('text', { y: -13 }, ''));
    const el = s('g', { class: 'pawn' }, bob);
    layer.append(el);
    pawnEls.push(el);
  }
  const byCity = {};
  g.players.forEach((p, i) => (byCity[p.location] = byCity[p.location] || []).push(i));
  g.players.forEach((p, i) => {
    const el = pawnEls[i];
    const group = byCity[p.location];
    const k = group.indexOf(i);
    const c = CITIES[p.location];
    const x = c.x - ((group.length - 1) * 15) / 2 + k * 15;
    el.style.transform = `translate(${x}px, ${c.y - 9}px)`;
    el.classList.toggle('current', i === g.current);
    el.querySelector('path').setAttribute('fill', ROLES[p.role].color);
    el.querySelector('text').textContent = p.name.slice(0, 1).toUpperCase();
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
  if (g.current !== ui.you || g.turn.phase !== 'actions' || g.status !== 'playing') return;
  const pawn = selectedPawn(g);
  const opts = Engine.getMoveOptions(g, ui.you, pawn, city);
  if (!opts.length) { toast(`Can't reach ${city} from ${g.players[pawn].location} with one action`, 'info'); return; }
  const go = (o, card) => send({ type: 'move', pawn, to: city, method: o.method, card });
  const choices = [];
  opts.forEach(o => {
    if (o.method === 'ops') o.cards.forEach(card => choices.push({ label: `🛠 Operations Expert move (discard ${card})`, onClick: () => go(o, card) }));
    else choices.push({ label: { drive: '🚗 ', direct: '✈️ ', charter: '🛩 ', shuttle: '🏥 ', dispatch: '📡 ', troubleshooter: '🔧 ' }[o.method] + o.label, onClick: () => go(o) });
  });
  const free = opts.find(o => o.method === 'drive' || o.method === 'shuttle' || o.method === 'dispatch');
  if (free && opts.length === 1) { go(free); return; }
  openChoice(`Move ${g.players[pawn].name} to ${city}`, choices);
}

// ------------------------------------------------------------ alerts from new log entries

// Turn new log entries into a timeline of effects. Returns per-city cube delays (so cubes
// drop in the order cities were infected) and a run() that fires the effects.
function scanLog(g) {
  const res = { delays: {}, run: () => {} };
  const count = g.logCount || g.log.length;
  if (ui.logSeen == null || count < ui.logSeen) { ui.logSeen = count; return res; }
  const fresh = g.log.slice(Math.max(0, g.log.length - (count - ui.logSeen)));
  ui.logSeen = count;
  const alerts = [], fx = [], draws = [];
  const delays = res.delays;
  let t = 0;
  fresh.forEach((e, i) => {
    let m;
    if ((m = e.msg.match(/^(.+?) drew an EPIDEMIC/))) {
      const next = fresh[i + 1] && fresh[i + 1].msg.match(/^Infect (.+?) \(/);
      alerts.push({ big: 'EPIDEMIC', sub: next ? `${next[1]} is hit with 3 cubes` : e.msg, cls: '' });
      draws.push({ player: m[1], epidemic: true });
      t += 300;
    } else if ((m = e.msg.match(/^(.+?) drew (.+)\.$/))) {
      draws.push({ player: m[1], card: m[2] });
    } else if ((m = e.msg.match(/^OUTBREAK in (.+?) \((\w+)\)/))) {
      const [, city, color] = m;
      const at = t + 150;
      fx.push([at, () => outbreakFx(city, color)]);
      PData.ADJ[city].forEach(nb => { if (delays[nb] == null) delays[nb] = at + 500; });
      if (!alerts.some(a => a.big === 'OUTBREAK')) alerts.push({ big: 'OUTBREAK', sub: `${city} — outbreaks ${g.outbreaks}/8`, cls: '' });
      t += 650;
    } else if ((m = e.msg.match(/^Infect (.+?) \((\d) (\w+)\)/))) {
      const [, city, n, color] = m;
      t += 450;
      if (delays[city] == null) delays[city] = t;
      const at = t;
      fx.push([at, () => ripple(city, color, Number(n) >= 3)]);
    } else if ((m = e.msg.match(/^Infection in (.+?) was prevented/))) {
      const city = m[1], at = t + 450;
      fx.push([at, () => shield(city)]);
    } else if ((m = e.msg.match(/discovered a cure for (\w+)/))) {
      alerts.push({ big: 'CURE FOUND', sub: `${m[1]} disease cured`, cls: 'good' });
    } else if ((m = e.msg.match(/The (\w+) disease has been ERADICATED/))) {
      alerts.push({ big: 'ERADICATED', sub: `${m[1]} is gone for good`, cls: 'good' });
    } else if (/^--- /.test(e.msg) && e.msg.includes(g.players[ui.you].name + "'s turn")) {
      alerts.push({ big: 'YOUR TURN', sub: '', cls: 'warn' });
    }
  });
  res.run = () => {
    fx.forEach(([at, fn]) => setTimeout(fn, at));
    showAlerts(alerts);
    animateDraws(g, draws);
  };
  return res;
}

function fxEl(el, ms) { $('#fx').append(el); setTimeout(() => el.remove(), ms); return el; }
function ripple(city, color, big) {
  const c = CITIES[city];
  fxEl(s('circle', { class: 'ripple' + (big ? ' big' : ''), cx: c.x, cy: c.y, r: 12, stroke: COLOR_HEX[color] }), 1500);
  if (big) fxEl(s('circle', { class: 'ripple big', cx: c.x, cy: c.y, r: 12, stroke: COLOR_HEX[color], style: 'animation-delay:.25s' }), 1800);
  flashCity(city, 'hitpulse');
}
function outbreakFx(city, color) {
  const c = CITIES[city];
  fxEl(s('circle', { class: 'shock', cx: c.x, cy: c.y, r: 14, stroke: COLOR_HEX[color] }), 1300);
  flashCity(city, 'flash');
  PData.ADJ[city].forEach(nb => {
    const n = CITIES[nb];
    let tx = n.x;
    if (Math.abs(tx - c.x) > MAP_W / 2) tx += tx < c.x ? MAP_W : -MAP_W; // fly across the Pacific edge
    const dot = fxEl(s('circle', { class: 'spark', r: 4.5, cx: 0, cy: 0, fill: COLOR_HEX[color] }), 1000);
    dot.style.transform = `translate(${c.x}px, ${c.y}px)`;
    requestAnimationFrame(() => requestAnimationFrame(() => { dot.style.transform = `translate(${tx}px, ${n.y}px)`; dot.style.opacity = '0.3'; }));
  });
}
function shield(city) {
  const c = CITIES[city];
  fxEl(s('circle', { class: 'shieldfx', cx: c.x, cy: c.y, r: 20 }), 1300);
}

// Cards fly from the player deck to whoever drew them; epidemics fly to the middle of the map.
function animateDraws(g, draws) {
  const from = document.getElementById('deckStat');
  if (!from || !draws.length) return;
  draws.forEach((d, i) => {
    const pi = g.players.findIndex(p => p.name === d.player);
    let target, label, cls;
    if (d.epidemic) {
      target = $('#mapwrap'); label = '☣ EPIDEMIC'; cls = 'epi';
    } else {
      const city = CITIES[d.card];
      const ev = Object.values(EVENTS).find(e => e.name === d.card);
      label = ev ? `★ ${ev.name}` : d.card;
      cls = ev ? 'event' : city ? city.color : '';
      target = pi === ui.you ? document.querySelector(`#myhand .pcard[data-card="${CSS.escape(d.card)}"]`) : null;
      target = target || document.querySelector(`#players .player[data-idx="${pi}"]`) || $('#myhand');
    }
    const mine = target.classList.contains('pcard');
    if (mine) target.classList.add('incoming');
    setTimeout(() => flyCard(from, target, label, cls, () => {
      if (mine) { target.classList.remove('incoming'); target.classList.add('pcard-new'); }
      else if (!d.epidemic) { target.classList.add('got-card'); setTimeout(() => target.classList.remove('got-card'), 900); }
    }), i * 550);
  });
}
function flyCard(fromEl, toEl, label, cls, done) {
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  const W = 96, H = 60;
  const card = h('div', { class: `flycard ${cls}`, style: { left: `${a.left + a.width / 2 - W / 2}px`, top: `${a.top + a.height / 2 - H / 2}px` } },
    h('div', { class: 'band' }), h('div', { class: 'fl' }, label));
  $('#flylayer').append(card);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const scale = cls === 'epi' ? 2.2 : 1;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${cls === 'epi' ? 0 : -6 + Math.random() * 12}deg) scale(${scale})`;
  }));
  setTimeout(() => { card.classList.add('land'); if (done) done(); }, 700);
  setTimeout(() => card.remove(), cls === 'epi' ? 1500 : 1000);
}

function flashCity(city, cls) {
  const el = document.querySelector(`#map [data-city="${CSS.escape(city)}"]`);
  if (!el) return;
  el.classList.remove(cls);
  void el.getBoundingClientRect();
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 2200);
}
let alertQueue = [], alertBusy = false;
function showAlerts(list) {
  alertQueue.push(...list);
  if (alertBusy) return;
  const next = () => {
    const a = alertQueue.shift();
    const box = $('#alert');
    if (!a) { alertBusy = false; box.classList.add('hidden'); return; }
    alertBusy = true;
    box.innerHTML = '';
    box.append(h('div', { class: 'box ' + a.cls }, h('div', { class: 'big' }, a.big), a.sub ? h('div', null, a.sub) : null));
    box.classList.remove('hidden');
    setTimeout(next, 2400);
  };
  next();
}

// ------------------------------------------------------------ game render

const chip = (card, opts = {}) => {
  if (Engine.isEvent(card)) {
    const ev = EVENTS[Engine.eventKey(card)];
    return h('span', { class: 'chip event' + (opts.onclick ? ' clickable' : ''), 'data-tip': ev.text, 'data-tip-title': ev.name, onclick: opts.onclick }, '★ ' + ev.name);
  }
  const col = CITIES[card] ? CITIES[card].color : 'black';
  return h('span', { class: `chip ${col}` + (opts.onclick ? ' clickable' : ''), style: { background: COLOR_HEX[col] }, onclick: opts.onclick }, card);
};

function renderGame() {
  const g = ui.game;
  const effects = scanLog(g);
  renderTopbar(g);
  renderMap(g, effects.delays);
  renderPlayers(g);
  renderBanner(g);
  renderTurnRow(g);
  renderHand(g);
  renderLog(g);
  renderChat();
  effects.run();
  maybeOpenForecast(g);
}

function renderTopbar(g) {
  const top = $('#topbar');
  top.innerHTML = '';
  const rates = Engine.RATES;
  top.append(
    h('div', { class: 'brand' }, 'PANDEMIC', h('span', { class: 'tag' }, ui.room.code)),
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, 'Outbreaks'),
      h('div', { class: 'track ob' }, Array.from({ length: 8 }, (_, i) => h('span', { class: (i < g.outbreaks ? 'on' : '') + (i === 7 ? ' last' : '') }, i === 7 ? '☠' : i + 1)))),
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, 'Infection rate'),
      h('div', { class: 'track rate' }, rates.map((r, i) => h('span', { class: i === g.rateIdx ? 'cur' : i < g.rateIdx ? 'past' : '' }, r)))),
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, 'Cures'),
      COLORS.map(c => h('span', { class: 'vial ' + g.cures[c], title: `${c}: ${g.cures[c]}`,
        style: { borderColor: COLOR_HEX[c], background: g.cures[c] === 'none' ? 'transparent' : COLOR_HEX[c] } },
      g.cures[c] === 'cured' ? '✓' : g.cures[c] === 'eradicated' ? '★' : ''))),
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, 'Cubes'),
      h('div', { class: 'supply' }, COLORS.map(c => h('div', { class: 'bar' + (g.supply[c] <= 5 ? ' low' : '') },
        h('div', { class: 'bg' }, h('i', { style: { width: `${(g.supply[c] / 24) * 100}%`, background: COLOR_HEX[c] } })), g.supply[c])))),
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, 'Deck'),
      h('span', { id: 'deckStat', 'data-tip': 'Cards left in the player deck. You lose if you must draw and cannot.' }, `🂠 ${g.playerDeckCount}`),
      h('span', { class: 'muted small' }, `${g.epidemicsLeft} epidemic${g.epidemicsLeft === 1 ? '' : 's'} left`)),
    h('div', { class: 'stat' }, h('span', { class: 'lbl' }, 'Stations'), `🏥 ${g.stations.length}/${Engine.MAX_STATIONS}`),
    ...[g.quietNight ? h('span', { class: 'tag' }, '🌙 Quiet night') : null,
      g.travelBan != null ? h('span', { class: 'tag' }, '🚫 Travel ban') : null].filter(Boolean),
    h('div', { class: 'topbtns' },
      h('span', { 'data-conn': '' }),
      h('button', { onclick: () => showPile('Player discard pile', g.playerDiscard) }, `Discards (${g.playerDiscard.length})`),
      h('button', { onclick: () => showPile('Infection discard pile', g.infectionDiscard) }, `Infected (${g.infectionDiscard.length})`),
      h('button', { onclick: showHelp }, 'Help'),
      h('button', { onclick: showMenu }, '⋯')),
  );
  renderConn();
}

function showMenu() {
  const isHost = ui.room.host === ui.you;
  const link = inviteLink(ui.room.code);
  const choices = [{ label: '🔗 Copy invite link', onClick: () => navigator.clipboard.writeText(link).then(() => toast('Invite link copied', 'info')) }];
  if (isHost) {
    choices.push({ label: '↩ End this game and return to lobby', onClick: () => { if (confirm('End the current game for everyone?')) req('abandon'); } });
    choices.push({ label: '✖ Close room', onClick: () => { if (confirm('Close the room? Everyone will be disconnected.')) leaveRoom(); } });
  } else {
    choices.push({ label: '✖ Leave (you can rejoin with the same browser)', onClick: () => { if (net) net.close(); net = null; ui.room = null; homeScreen(); } });
  }
  openChoice('Menu', choices, isHost ? 'You are the host: this tab runs the game. Refreshing is safe; closing it pauses the game for everyone.' : null);
}

function showPile(title, cards) {
  openModal(title, h('div', { class: 'pile' }, cards.length ? cards.slice().reverse().map(c => chip(c)) : h('span', { class: 'muted' }, 'Empty')),
    [h('button', { onclick: closeModal }, 'Close')]);
}

function showHelp() {
  openModal('How to play', h('div', { class: 'ref' },
    h('p', { class: 'muted' }, 'On your turn take your actions, draw 2 cards, then infect cities. ',
      'Click a highlighted city to move there (hover a city for details; scroll or use +/− to zoom, drag to pan). ',
      'Click ★ event cards in your hand to play them — events work at any time, even on other players\' turns.'),
    h('h4', null, 'Win / lose'),
    h('div', null, 'Win by discovering all 4 cures. Lose at 8 outbreaks, if a color runs out of cubes, or when the player deck runs out.'),
    h('h4', null, 'Roles'),
    Object.values(ROLES).map(r => h('div', null, h('b', { style: { color: r.color } }, r.name), ' — ', r.text)),
    h('h4', null, 'Events'),
    Object.values(EVENTS).map(e => h('div', null, h('b', null, e.name), ' — ', e.text))),
  [h('button', { onclick: closeModal }, 'Close')]);
}

function renderPlayers(g) {
  const box = $('#players');
  box.innerHTML = '';
  g.players.forEach((p, i) => {
    const role = ROLES[p.role];
    const mine = i === ui.you;
    const seat = ui.room.seats[i];
    const over = g.overLimit.includes(i);
    box.append(h('div', { class: 'player' + (i === g.current ? ' current' : ''), 'data-idx': i, style: { '--rc': role.color } },
      h('div', { class: 'hdr' },
        h('span', { class: 'pawnchip', style: { background: role.color } }),
        h('span', { class: 'nm' }, p.name, mine ? h('span', { class: 'muted' }, ' (you)') : ''),
        i === g.current ? h('span', { class: 'turn-tag' }, 'TURN') : null,
        h('span', { class: 'dot' + (seat && seat.connected ? ' on' : ''), title: seat && seat.connected ? 'online' : 'offline' }),
        h('span', { class: 'loc' }, '📍 ', p.location)),
      h('div', { class: 'role' }, h('b', roleTip(p.role), role.name, ' ⓘ'), ' · ',
        h('span', { class: over ? 'over' : '' }, `${p.hand.length}/${g.handLimits[i]} cards`)),
      h('div', { class: 'hand' },
        p.hand.map(c => chip(c)),
        p.stored ? [h('span', { class: 'muted small' }, 'Stored:'), chip(p.stored)] : null,
        p.role === 'fieldOperative' && COLORS.some(c => p.samples[c]) ? h('span', { class: 'muted small' }, 'Samples: ',
          COLORS.map(c => p.samples[c] ? `${ICON[c]}×${p.samples[c]} ` : null)) : null)));
  });
}

function renderHand(g) {
  const box = $('#myhand');
  box.innerHTML = '';
  const me = g.players[ui.you];
  const over = g.overLimit.includes(ui.you);
  const playing = g.status === 'playing';
  box.append(h('div', { class: 'label' },
    h('span', { class: 'rolebadge', style: { '--rc': ROLES[me.role].color }, ...roleTip(me.role) }, ROLES[me.role].name, ' ⓘ'),
    h('b', null, 'Your hand'), `${me.hand.length}/${g.handLimits[ui.you]} cards`,
    over ? h('span', { class: 'over' }, 'Discard!') : null));
  const sorted = me.hand.slice().sort((a, b) => {
    const ka = Engine.isEvent(a) ? 9 : COLORS.indexOf(CITIES[a].color), kb = Engine.isEvent(b) ? 9 : COLORS.indexOf(CITIES[b].color);
    return ka - kb || a.localeCompare(b);
  });
  const cardEl = (card, stored) => {
    const isEv = Engine.isEvent(card);
    let onclick = null;
    if (playing) {
      if (isEv) onclick = () => (over && !stored) ? discardOrPlay(card) : playEventDialog(card, stored);
      else if (over) onclick = () => send({ type: 'discard', card });
    }
    const tip = isEv ? { 'data-tip': EVENTS[Engine.eventKey(card)].text + ' Click to play.', 'data-tip-title': EVENTS[Engine.eventKey(card)].name }
      : { title: over ? 'Click to discard' : `${CITIES[card].color} city card` };
    return h('div', { class: 'pcard' + (isEv ? ' event' : '') + (onclick ? ' clickable' : '') + (over && !stored ? ' discard' : '') + (card === me.location ? ' here' : ''),
      style: { '--c': isEv ? '#9c6a00' : COLOR_HEX[CITIES[card].color] }, 'data-card': isEv ? EVENTS[Engine.eventKey(card)].name : card, ...tip, onclick },
    h('div', { class: 'cn' }, isEv ? '★ ' + EVENTS[Engine.eventKey(card)].name : card),
    h('div', { class: 'cc' }, isEv ? (stored ? 'stored event' : 'event · play anytime') : CITIES[card].color));
  };
  sorted.forEach(c => box.append(cardEl(c, false)));
  if (me.stored) box.append(cardEl(me.stored, true));
  if (!me.hand.length && !me.stored) box.append(h('div', { class: 'label' }, h('span', { class: 'muted' }, 'No cards')));
  // Cure progress
  const need = Engine.cardsNeededForCure(me, false);
  box.append(h('div', { class: 'cure-hint' }, COLORS.filter(c => g.cures[c] === 'none').map(c => {
    const n = me.hand.filter(x => CITIES[x] && CITIES[x].color === c).length;
    return h('div', { class: n >= need ? 'ok' : '' }, `${ICON[c]} ${n}/${need} for cure`);
  })));
}

function discardOrPlay(card) {
  openChoice(Engine.cardName(card), [
    { label: '★ Play this event', onClick: () => playEventDialog(card, false) },
    { label: '🗑 Discard it', onClick: () => send({ type: 'discard', card }) },
  ]);
}

function renderBanner(g) {
  const b = $('#banner');
  b.innerHTML = '';
  const msg = (kids, cls = '') => b.append(h('div', { class: 'msg ' + cls }, kids));
  const backBtn = ui.room.host === ui.you ? h('button', { class: 'primary', onclick: () => req('backToLobby') }, 'Back to lobby') : null;
  if (net && net.status !== 'online') msg(['📡 ', net.statusText], 'warn');
  if (g.status === 'won') msg(['🎉 Victory! ', g.result, backBtn], 'good');
  if (g.status === 'lost') msg(['☠ Game over — ', g.result, backBtn], 'bad');
  if (g.status !== 'playing') return;
  if (g.interrupt) msg(`🔮 ${g.players[g.interrupt.player].name} is rearranging the infection deck (Forecast)…`, 'warn');
  g.overLimit.forEach(i => msg(i === ui.you
    ? `✋ You're over your hand limit (${g.players[i].hand.length}/${g.handLimits[i]}). Click cards in your hand to discard (or play events).`
    : `⏳ Waiting for ${g.players[i].name} to discard down to ${g.handLimits[i]} cards…`, 'warn'));
  if (g.peek) msg(['🔧 Troubleshooter sees the next infections:', g.peek.map(c => chip(c))]);
  if (g.rvdColor && g.players.some(p => p.hand.includes('E:rapidVaccineDeployment') || p.stored === 'E:rapidVaccineDeployment')) {
    msg('💉 Rapid Vaccine Deployment can be played now (before the next action).', 'warn');
  }
  if (g.current === ui.you && g.turn.phase === 'actions' && g.turn.actionsLeft <= 0) {
    msg('All actions used — press End turn to draw cards, or Restart turn to redo your moves.', 'warn');
  }
  if (g.turn.phase === 'epidemic') msg('☣ Epidemic! Last chance to play Resilient Population before Intensify.', 'warn');
}

function renderTurnRow(g) {
  const bar = $('#turnrow');
  bar.innerHTML = '';
  const cur = g.players[g.current];
  const me = g.players[ui.you];
  const ph = g.turn.phase;
  const total = g.turn.actionsLeft + g.turn.actionsTaken;
  const n = g.quietNight ? 0 : g.travelBan != null ? 1 : g.infectionRate;
  bar.append(
    h('span', { class: 'whose', ...roleTip(cur.role) }, h('span', { class: 'pawnchip', style: { background: ROLES[cur.role].color } }),
      g.current === ui.you ? 'Your turn' : `${cur.name}'s turn`, h('span', { class: 'muted small' }, ` · ${ROLES[cur.role].name}`)),
    h('div', { class: 'stepper' },
      h('span', { class: 'step' + (ph === 'actions' ? ' on' : '') }, 'Actions',
        h('span', { class: 'pips' }, Array.from({ length: total }, (_, i) => h('i', { class: i < g.turn.actionsTaken ? 'used' : '' })))),
      h('span', { class: 'arrow' }, '▶'),
      h('span', { class: 'step' + (ph === 'draw' || ph === 'epidemic' ? ' on' : '') }, ph === 'epidemic' ? 'Epidemic!' : 'Draw 2'),
      h('span', { class: 'arrow' }, '▶'),
      h('span', { class: 'step' + (ph === 'infect' ? ' on' : '') }, `Infect ${n}`)));
  if (g.status !== 'playing' || g.current !== ui.you) return;

  const add = (...els) => bar.append(...els);
  const noActions = ph === 'actions' && g.turn.actionsLeft <= 0;
  const btn = (icon, label, onclick, opts = {}) => h('button', { onclick, disabled: opts.disabled || (opts.act !== false && noActions),
    class: 'act ' + (opts.class || ''), title: opts.title, style: opts.style },
  h('span', { class: 'ic' }, icon), label);

  if (ph === 'draw') add(btn('🂠', 'Draw 2 player cards', () => send({ type: 'draw' }), { class: 'primary' }));
  if (ph === 'epidemic') add(btn('☣', 'Continue: Intensify', () => send({ type: 'continue' }), { class: 'primary' }));
  if (ph === 'infect') add(btn('🦠', n ? `Infect ${n} cit${n === 1 ? 'y' : 'ies'}` : 'Skip infection (Quiet Night)', () => send({ type: 'infect' }), { class: 'primary' }));
  if (ph !== 'actions') return;

  const here = me.location;
  add(h('span', { class: 'sep' }));
  if (me.role === 'dispatcher' || g.turn.flags.specialOrders != null) {
    const allowed = g.players.map((p, i) => i).filter(i => me.role === 'dispatcher' || i === ui.you || i === g.turn.flags.specialOrders);
    const sel = h('select', { title: 'Which pawn to move', onchange: (e) => { ui.pawn = Number(e.target.value); renderMap(g); } },
      allowed.map(i => h('option', { value: i }, `Move: ${g.players[i].name}`)));
    sel.value = selectedPawn(g);
    add(sel);
  }

  const canBuild = !g.stations.includes(here) && (me.role === 'opsExpert' || me.hand.includes(here));
  add(btn('🏥', 'Build', () => {
    if (g.stations.length >= Engine.MAX_STATIONS) {
      openForm('Build research station', 'All 6 stations are built. Choose one to move here.',
        [{ name: 'remove', label: 'Remove station from', type: 'select', options: g.stations.map(c => [c, c]) }],
        (v) => send({ type: 'build', remove: v.remove }));
    } else send({ type: 'build' });
  }, { disabled: !canBuild, title: g.stations.includes(here) ? 'Already a station here' : me.role === 'opsExpert' ? 'No card needed' : `Discard ${here}` }));

  COLORS.filter(c => g.cubes[here][c] > 0).forEach(c => add(btn('💉', `Treat ${c}`, () => send({ type: 'treat', color: c }),
    { class: 'colorbtn', style: { '--c': COLOR_HEX[c] } })));

  const shares = Engine.getShareOptions(g, ui.you);
  add(btn('🤝', 'Share', () => openChoice('Share knowledge', shares.map(o => ({
    label: o.mode === 'give' ? `Give ${o.card} → ${g.players[o.other].name}` : `Take ${o.card} ← ${g.players[o.other].name}`,
    onClick: () => send({ type: 'share', ...o }),
  }))), { disabled: !shares.length, title: 'Give or take the card matching your city with a player in the same city' }));

  const cureColors = COLORS.filter(c => {
    if (g.cures[c] !== 'none' || !g.stations.includes(here)) return false;
    const cnt = me.hand.filter(x => CITIES[x] && CITIES[x].color === c).length;
    const samples = me.role === 'fieldOperative' && me.samples[c] >= 3;
    return cnt >= Engine.cardsNeededForCure(me, false) || (samples && cnt >= Engine.cardsNeededForCure(me, true));
  });
  add(btn('🧪', 'Cure', () => cureDialog(g, cureColors), { disabled: !cureColors.length, title: 'At a research station with enough cards of one color' }));

  if (me.role === 'contingencyPlanner') {
    const evs = g.playerDiscard.filter(Engine.isEvent);
    add(btn('📋', 'Store event', () => openChoice('Store an event', evs.map(c => ({ label: Engine.cardName(c), onClick: () => send({ type: 'contingencyTake', card: c }) }))),
      { disabled: !evs.length || !!me.stored }));
  }
  if (me.role === 'archivist') {
    add(btn('🗄', `Retrieve ${here}`, () => send({ type: 'archivistRetrieve' }), { disabled: g.turn.flags.archivist || !g.playerDiscard.includes(here) }));
  }
  if (me.role === 'fieldOperative') {
    COLORS.filter(c => g.cubes[here][c] > 0).forEach(c => add(btn('🧫', `Sample ${c}`, () => send({ type: 'fieldSample', color: c }),
      { disabled: g.turn.flags.sample, class: 'colorbtn', style: { '--c': COLOR_HEX[c] } })));
  }
  if (me.role === 'epidemiologist') {
    const opts = [];
    g.players.forEach((q, qi) => { if (qi !== ui.you && q.location === here) q.hand.filter(Engine.isCity).forEach(c => opts.push({ qi, c })); });
    add(btn('🔬', 'Take card (free)', () => openChoice('Epidemiologist: take a City card', opts.map(o => ({
      label: `Take ${o.c} from ${g.players[o.qi].name}`, onClick: () => send({ type: 'epidemiologistTake', from: o.qi, card: o.c }),
    }))), { disabled: g.turn.flags.epidemiologist || !opts.length, act: false }));
  }

  add(h('span', { class: 'spacer' }),
    btn('↺', 'Restart turn', () => openChoice('Restart your turn?', [{ label: '↺ Yes, undo everything I did this turn', onClick: () => send({ type: 'restartTurn' }) }],
      'Moves, treatments, cards and events used this turn are put back as they were when your turn began.'),
    { class: 'ghost', act: false, disabled: !g.canRestart,
      title: g.turn.flags.revealed ? 'Locked: hidden cards were revealed this turn (Forecast)' : 'Undo all of this turn\'s actions' }),
    btn('⏭', 'Pass', () => send({ type: 'pass' }), { class: 'ghost', title: 'Spend one action doing nothing' }),
    btn('✋', 'End turn', () => (g.turn.actionsLeft > 0
      ? openChoice('End your turn?', [{ label: `Yes, skip my remaining ${g.turn.actionsLeft} action(s) and draw`, onClick: () => send({ type: 'endActions' }) }])
      : send({ type: 'endActions' })), { class: noActions ? 'primary' : 'ghost', act: false, title: 'Finish actions, then draw 2 cards and infect' }));
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
    openModal(`🧪 Discover a cure: ${color}`, body, [cancelBtn(), h('button', { class: 'primary', onclick: () => {
      closeModal();
      send({ type: 'cure', color, cards: boxes.filter(b => b.box.checked).map(b => b.c), useSamples: !!(sampleBox && sampleBox.checked) });
    } }, 'Discover cure')]);
  };
  if (colors.length === 1) pickColor(colors[0]);
  else openChoice('Which disease?', colors.map(c => ({ label: `${ICON[c]} ${c}`, onClick: () => pickColor(c) })));
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
  const title = `★ ${ev.name}`;

  switch (key) {
    case 'airlift':
      return openForm(title, ev.text, [
        { name: 'pawn', label: 'Pawn', type: 'select', options: players, value: g.current },
        { name: 'to', label: 'Destination', type: 'select', options: cityOpts }],
      (v) => play({ pawn: Number(v.pawn), to: v.to }));
    case 'governmentGrant': {
      const fields = [{ name: 'city', label: 'City', type: 'select', options: cityOpts.filter(([c]) => !g.stations.includes(c)) }];
      if (g.stations.length >= Engine.MAX_STATIONS) fields.push({ name: 'remove', label: 'Remove station from', type: 'select', options: g.stations.map(c => [c, c]) });
      return openForm(title, ev.text, fields, (v) => play(v));
    }
    case 'resilientPopulation':
      if (!g.infectionDiscard.length) return toast('The infection discard pile is empty');
      return openForm(title, ev.text, [{ name: 'card', label: 'Infection card to remove', type: 'select', options: g.infectionDiscard.map(c => [c, c]) }], (v) => play(v));
    case 'newAssignment': {
      const unused = Object.entries(ROLES).filter(([k]) => !g.players.some(p => p.role === k)).map(([k, r]) => [k, r.name]);
      return openForm(title, ev.text, [
        { name: 'player', label: 'Player', type: 'select', options: players },
        { name: 'role', label: 'New role', type: 'select', options: unused }],
      (v) => play({ player: Number(v.player), role: v.role }));
    }
    case 'rapidVaccineDeployment': {
      const color = g.rvdColor;
      if (!color) return toast('Play this right after a cure is discovered');
      const cities = CITY_NAMES.filter(c => g.cubes[c][color] > 0);
      return openForm(title, `${ev.text} Color: ${color}. Cities must be connected to each other.`,
        cities.map(c => ({ name: c, label: `${c} (${g.cubes[c][color]} ${color})`, type: 'number', min: 0, max: g.cubes[c][color], value: 0 })),
        (v) => play({ removals: Object.entries(v).filter(([, n]) => n > 0).map(([city, n]) => ({ city, n })) }));
    }
    case 'reexaminedResearch': {
      const cards = g.playerDiscard.filter(Engine.isCity);
      if (!cards.length) return toast('No City cards in the discard pile');
      return openForm(title, ev.text, [
        { name: 'card', label: 'Card', type: 'select', options: cards.map(c => [c, c]) },
        { name: 'player', label: 'Give to', type: 'select', options: players, value: ui.you }],
      (v) => play({ card: v.card, player: Number(v.player) }));
    }
    case 'remoteTreatment': {
      if (!withCubes.length) return toast('There are no cubes on the board');
      const opts = [['', '— none —'], ...withCubes];
      return openForm(title, ev.text, [
        { name: 'a', label: 'First cube', type: 'select', options: withCubes },
        { name: 'b', label: 'Second cube (may be the same city)', type: 'select', options: opts, value: '' }],
      (v) => play({ removals: [v.a, v.b].filter(Boolean).map(x => { const [city, color] = x.split('|'); return { city, color }; }) }));
    }
    case 'specialOrders':
      return openForm(title, ev.text, [{ name: 'pawn', label: 'Pawn', type: 'select', options: players.filter(([i]) => i !== g.current) }],
        (v) => play({ pawn: Number(v.pawn) }));
    default:
      return openChoice(title, [{ label: `Play ${ev.name}`, onClick: () => play({}) }], ev.text);
  }
}

function maybeOpenForecast(g) {
  if (!g.interrupt || g.interrupt.type !== 'forecast' || g.interrupt.player !== ui.you) return;
  const id = (g.logCount || g.log.length) + ':' + g.interrupt.cards.join();
  if (ui.forecastFor === id) return;
  const order = g.interrupt.cards.slice();
  const list = h('div');
  const draw = () => {
    list.innerHTML = '';
    order.forEach((c, i) => list.append(h('div', { class: 'forecast-row' },
      h('span', { class: 'n' }, i === 0 ? 'Next' : `#${i + 1}`), chip(c),
      h('button', { disabled: i === 0, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); } }, '↑'),
      h('button', { disabled: i === order.length - 1, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); } }, '↓'))));
  };
  draw();
  openModal('🔮 Forecast — arrange the infection deck', h('div', null, h('p', { class: 'muted' }, 'The first card is drawn next.'), list),
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
  if (text) req('chat', { text });
  $('#chatInput').value = '';
});

boot();
