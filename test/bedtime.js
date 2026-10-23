const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const Schedule = require('../public/shared/bedtime');
const at = (hours, minutes = 0) => new Date(2026, 9, 22, hours, minutes);
for (const [h, m, locked, warning] of [
  [22, 44, false, false], [22, 45, false, true], [22, 59, false, true],
  [23, 0, true, false], [0, 0, true, false], [6, 59, true, false], [7, 0, false, false],
]) {
  const state = Schedule.status(Schedule.DEFAULT, at(h, m));
  assert.strictEqual(state.locked, locked, `${h}:${m} lock`);
  assert.strictEqual(state.warning, warning, `${h}:${m} warning`);
}
assert.strictEqual(Schedule.status(Schedule.DEFAULT, at(22, 45)).minutesLeft, 15);
assert(Schedule.status({ start: '09:00', end: '17:00' }, at(9)).locked);
assert(!Schedule.status({ start: '09:00', end: '17:00' }, at(17)).locked);
for (const invalid of [null, {}, { start: '25:00', end: '07:00' }, { start: '7:00', end: '23:00' }, { start: '07:00', end: '07:00' }]) {
  assert(!Schedule.valid(invalid));
  assert(Schedule.status(invalid, at(23)).locked);
}

// Run the real browser controller with a controlled clock and minimal DOM.
let now = at(22, 44);
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, {
    open: false, value: '', textContent: '', listeners: {},
    classList: { toggle() {} },
    addEventListener(event, callback) { this.listeners[event] = callback; },
    showModal() { this.open = true; }, close() { this.open = false; },
  });
  return nodes.get(id);
}
const events = {}, saved = new Map();
let storageFails = false;
const storage = {
  getItem: key => saved.get(key) || null,
  setItem(key, value) { if (storageFails) throw Error('blocked'); saved.set(key, value); },
};
const context = vm.createContext({
  Date: Clock, localStorage: storage,
  document: { querySelector: node, addEventListener: (event, callback) => { events[event] = callback; } },
  window: { addEventListener: (event, callback) => { events[event] = callback; } },
  setInterval: callback => { events.tick = callback; },
});
vm.runInContext(fs.readFileSync('public/shared/bedtime.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('public/bedtime.js', 'utf8') + '\nglobalThis.controller = Bedtime;', context);
const trigger = (id, event = 'click') => node(id).listeners[event]({ preventDefault() {} });
assert(context.controller.canPlay());
trigger('#bedtimeButton');
assert(node('#bedtimeSettings').open);
now = at(23);
events.visibilitychange();
assert(node('#bedtimeLock').open);
assert(!node('#bedtimeSettings').open);
let prevented = false;
node('#bedtimeLock').listeners.cancel({ preventDefault() { prevented = true; } });
assert(prevented, 'Escape cannot dismiss bedtime');
node('#bedtimeStart').value = '23:30';
node('#bedtimeEnd').value = '08:00';
trigger('#bedtimeForm', 'submit');
assert(!saved.has('pandemic:bedtime'), 'settings cannot be saved after cutoff');
now = at(7);
events.focus();
assert(!node('#bedtimeLock').open);
trigger('#bedtimeButton');
node('#bedtimeStart').value = '22:00';
node('#bedtimeEnd').value = '08:00';
storageFails = true;
trigger('#bedtimeForm', 'submit');
assert(node('#bedtimeError').textContent.includes('could not save'));
assert(node('#bedtimeSettings').open);
storageFails = false;
trigger('#bedtimeForm', 'submit');
assert(node('#bedtimeLock').open, 'schedule covering current time locks immediately');
assert.deepStrictEqual(JSON.parse(saved.get('pandemic:bedtime')), { start: '22:00', end: '08:00' });
now = at(8);
events.tick();
assert(context.controller.canPlay());
saved.set('pandemic:bedtime', JSON.stringify({ start: '08:00', end: '09:00' }));
events.storage();
assert(node('#bedtimeLock').open, 'other tabs apply schedule updates');
saved.set('pandemic:bedtime', 'broken json');
now = at(23);
assert(!context.controller.canPlay(), 'malformed storage does not disable lock');

// Exercise the transport boundary: local moves stop, remote hosting continues.
let locked = true, handled = 0, sent = [];
const transport = vm.createContext({
  Bedtime: { canPlay: () => !locked },
  Date, Set, Map, localStorage: storage,
});
vm.runInContext(fs.readFileSync('public/net.js', 'utf8') + '\nglobalThis.classes = { HostNet, GuestNet };', transport);
const { HostNet, GuestNet } = transport.classes;
const host = new HostNet('TEST', { handle() { handled++; return { ok: true }; } });
let broadcasts = 0;
host.broadcast = () => broadcasts++;
let error;
host.emit('action', {}, result => { error = result.error; });
assert(error);
assert.strictEqual(handled, 0);
assert.strictEqual(broadcasts, 0);
const remoteListeners = {};
host.accept({ token: 'remote', on(event, callback) { remoteListeners[event] = callback; }, send() {} });
remoteListeners.data({ ev: 'action', data: {}, id: 1 });
assert.strictEqual(handled, 1, 'remote players are not blocked by host bedtime');
assert.strictEqual(broadcasts, 1, 'remote moves still broadcast and save');
const guest = new GuestNet('TEST');
guest.conn = { open: true, send: message => sent.push(message) };
guest.emit('action', {});
guest.send('join', { name: 'New player' });
assert.strictEqual(sent.length, 0);
guest.send('join', { token: 'existing-seat' });
assert.strictEqual(sent.length, 1, 'existing guests can reconnect');
locked = false;
host.emit('action', {});
guest.emit('action', {});
assert.strictEqual(handled, 2);
assert.strictEqual(sent.length, 2);
console.log('Bedtime schedule, controller, and transport tests passed');
