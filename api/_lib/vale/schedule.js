// schedule.js — when Vale's morning brief goes out. Linux Consumption Function Apps have
// no WEBSITE_TIME_ZONE, so the timer fires at 13:30, 14:30 and 15:30 UTC and this decides:
// send once per Pacific date, between 06:30 and 09:00 Pacific (catch-up if a run failed),
// DST-correct because the wall clock comes from Intl, not a fixed UTC offset.
'use strict';

var TZ = 'America/Los_Angeles';
var BRIEF_START = 6 * 60 + 30;
var BRIEF_END = 9 * 60;
var SENDING_STALE_MS = 30 * 60 * 1000;

var _fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
});

// { date: 'YYYY-MM-DD', minutes: minutes since local midnight, weekday: 'Mon'.. }
function pacificParts(ms) {
  var p = {};
  _fmt.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday };
}

// log: valeBriefLog value, { days: { 'YYYY-MM-DD': { status: 'sending'|'sent'|'failed', at } } }
function shouldSendBrief(nowMs, log) {
  var p = pacificParts(nowMs);
  if (p.minutes < BRIEF_START || p.minutes >= BRIEF_END) return { send: false, reason: 'outside_window', date: p.date };
  var day = log && log.days && log.days[p.date];
  if (day && day.status === 'sent') return { send: false, reason: 'already_sent', date: p.date };
  if (day && day.status === 'sending' && nowMs - Date.parse(day.at) < SENDING_STALE_MS) {
    return { send: false, reason: 'in_flight', date: p.date };
  }
  return { send: true, date: p.date };
}

module.exports = { pacificParts: pacificParts, shouldSendBrief: shouldSendBrief, TZ: TZ };
