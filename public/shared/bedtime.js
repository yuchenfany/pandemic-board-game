// Local wall-clock schedule; no server or timezone conversion is required.
(function (root) {
  'use strict';
  const DEFAULT = Object.freeze({ start: '23:00', end: '07:00' });
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const valid = s => !!s && validTime(s.start) && validTime(s.end) && s.start !== s.end;
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  function status(schedule, now = new Date()) {
    const s = valid(schedule) ? schedule : DEFAULT;
    const start = minutes(s.start), end = minutes(s.end);
    const time = now.getHours() * 60 + now.getMinutes();
    const locked = start > end ? time >= start || time < end : time >= start && time < end;
    const untilStart = (start - time + 1440) % 1440;
    return { locked, warning: !locked && untilStart <= 15, minutesLeft: untilStart };
  }
  const api = { DEFAULT, valid, status };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BedtimeSchedule = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
