/* global BedtimeSchedule */
'use strict';
const Bedtime = (() => {
  const KEY = 'pandemic:bedtime';
  let schedule = BedtimeSchedule.DEFAULT;
  function load() {
    let raw;
    try { raw = localStorage.getItem(KEY); }
    catch { return; } // Retain the current schedule if storage becomes unavailable.
    try {
      const saved = JSON.parse(raw);
      schedule = BedtimeSchedule.valid(saved) ? saved : BedtimeSchedule.DEFAULT;
    } catch { schedule = BedtimeSchedule.DEFAULT; }
  }
  const lock = document.querySelector('#bedtimeLock');
  const settings = document.querySelector('#bedtimeSettings');
  const warning = document.querySelector('#bedtimeWarning');
  const start = document.querySelector('#bedtimeStart');
  const end = document.querySelector('#bedtimeEnd');
  const error = document.querySelector('#bedtimeError');
  function format(time) {
    const date = new Date();
    date.setHours(Number(time.slice(0, 2)), Number(time.slice(3)), 0, 0);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function refresh() {
    load();
    const state = BedtimeSchedule.status(schedule);
    const message = `Time for bed—play unlocks at ${format(schedule.end)}.`;
    document.querySelector('#bedtimeMessage').textContent = message;
    warning.textContent = state.warning ? `Bedtime in ${state.minutesLeft} minute${state.minutesLeft === 1 ? '' : 's'}. Play locks at ${format(schedule.start)}.` : '';
    warning.classList.toggle('hidden', !state.warning);
    if (state.locked) {
      if (settings.open) settings.close();
      if (!lock.open) lock.showModal();
    } else if (lock.open) {
      lock.close();
    }
    return !state.locked;
  }
  lock.addEventListener('cancel', e => e.preventDefault());
  document.querySelector('#bedtimeButton').addEventListener('click', () => {
    if (!refresh()) return;
    start.value = schedule.start;
    end.value = schedule.end;
    error.textContent = '';
    settings.showModal();
  });
  document.querySelector('#bedtimeCancel').addEventListener('click', () => settings.close());
  document.querySelector('#bedtimeForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!refresh()) return;
    const next = { start: start.value, end: end.value };
    if (!BedtimeSchedule.valid(next)) {
      error.textContent = 'Choose two different times for bedtime and morning.';
      return;
    }
    try { localStorage.setItem(KEY, JSON.stringify(next)); }
    catch {
      error.textContent = 'Your browser could not save this schedule. Allow site storage and try again.';
      return;
    }
    schedule = next;
    settings.close();
    refresh();
  });
  window.addEventListener('storage', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, 1000);
  refresh();
  return { canPlay: refresh };
})();
