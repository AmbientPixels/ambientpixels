// teamsNudges — what Vale posts to her Teams channel, decided from the HQ summary.
// Pure: no I/O. The runner (api/valeTeamsNudges) posts each message and records only
// the ones Teams accepted, so a failed post is tried again next tick.
//
// Three kinds, any hour (Chad, 2026-10-20: "she can post anytime, that's the point"):
//  - needs:  something new is waiting on Chad (approval queue + his own tasks)
//  - health: the fleet's run broke (missed or failed)
//  - wrap:   once a Pacific day at 16:05, after his Microsoft day: health, waiting, campaigns, last 24 h
// At most CAP needs/health posts per Pacific day; the wrap is outside the cap.
// The first run ever posts one "connected" card for what is already waiting, never a burst.
'use strict';

var { pacificParts } = require('./schedule');

var CAP = 5;
var WRAP_AT = 16 * 60 + 5;
var MAX_LISTED = 5;
var BASE = 'https://www.ambientpixels.ai/modules/company/';
var ACTIONS = { title: 'Open Actions', url: BASE + 'actions.html' };
var OFFICE = { title: 'Ask Vale', url: BASE + 'office.html' };

function emptyLog() { return { date: null, count: 0, notified: {}, health: {}, wrapDate: null, started: false }; }

function itemLine(p) {
  return '• ' + p.title + (p.from ? ' — from ' + p.from : '');
}

// summary: hq-summary buildSummary output. pending: full pendingDecisions list (with from-names).
function decide(opts) {
  var now = opts.now;
  var summary = opts.summary;
  var pending = opts.pending || [];
  var log = Object.assign(emptyLog(), opts.log || {});
  var p = pacificParts(now);
  var countToday = log.date === p.date ? log.count : 0;
  var out = [];
  var b = summary.blocks || {};
  var waitingMeasured = b.waiting && b.waiting.state !== 'not_measured';

  // First run: one card for what is already waiting, then normal service.
  if (!log.started) {
    var lines = waitingMeasured
      ? [pending.length ? pending.length + ' thing' + (pending.length === 1 ? ' is' : 's are') + ' waiting on you:' : 'Nothing is waiting on you right now.']
          .concat(pending.slice(0, MAX_LISTED).map(itemLine))
          .concat(pending.length > MAX_LISTED ? ['…and ' + (pending.length - MAX_LISTED) + ' more.'] : [])
      : ["I couldn't read the approval queue just now, so I'll tell you when I can."];
    lines.push("From here on I'll post when something new needs you, if a fleet run breaks, and a wrap at 4:05 pm.");
    out.push({ kind: 'start', title: 'Vale is connected', lines: lines, link: pending.length ? ACTIONS : OFFICE,
      mark: { started: true, ids: waitingMeasured ? pending.map(function (x) { return x.id; }) : [] } });
    return { messages: out, date: p.date, countToday: countToday };
  }

  // Health: once per issue text per day.
  var h = b.health;
  if (h && h.state === 'broken' && log.health[h.text] !== p.date && countToday < CAP) {
    out.push({ kind: 'health', title: 'Something broke on the team', lines: [h.text + '.', "I'll keep watching; the details are on HQ."],
      link: { title: 'Open HQ', url: BASE + 'index.html' }, mark: { health: h.text }, counts: true });
    countToday++;
  }

  // Needs: anything waiting that I haven't told him about.
  if (waitingMeasured) {
    var fresh = pending.filter(function (x) { return !log.notified[x.id]; });
    if (fresh.length && countToday < CAP) {
      var total = pending.length;
      out.push({
        kind: 'needs',
        title: fresh.length === 1 ? 'New: 1 thing needs you' : 'New: ' + fresh.length + ' things need you',
        lines: fresh.slice(0, MAX_LISTED).map(itemLine)
          .concat(fresh.length > MAX_LISTED ? ['…and ' + (fresh.length - MAX_LISTED) + ' more.'] : [])
          .concat(total > fresh.length ? [total + ' waiting in all.'] : []),
        link: ACTIONS, mark: { ids: fresh.map(function (x) { return x.id; }) }, counts: true
      });
      countToday++;
    }
  }

  // Wrap: once a day after his Microsoft day.
  if (p.minutes >= WRAP_AT && log.wrapDate !== p.date) {
    var w = [];
    if (h) w.push('Health: ' + h.text + '.');
    w.push(waitingMeasured ? 'Waiting on you: ' + pending.length + '.' : "Waiting on you: couldn't read the queue.");
    var camps = (b.campaigns && b.campaigns.items) || [];
    camps.forEach(function (c) {
      w.push(c.title + ': ' + (c.status === 'not_measured' ? 'pace not measured' : c.done + ' of ' + c.planned + ' ' + c.period) + '.');
    });
    var ev = b.happened;
    if (ev && ev.state !== 'not_measured') {
      w.push(ev.total ? 'Last 24 hours, ' + ev.total + ' event' + (ev.total === 1 ? '' : 's') + ':' : 'Last 24 hours: nothing recorded.');
      (ev.items || []).slice(0, 3).forEach(function (e) { w.push('• ' + e.text); });
    }
    out.push({ kind: 'wrap', title: "Today's wrap", lines: w, link: OFFICE, mark: { wrap: true } });
  }

  return { messages: out, date: p.date, countToday: log.date === p.date ? log.count : 0 };
}

// Record one message Teams accepted. Returns the new log.
function applyMark(log, msg, date, nowIso, pendingIds) {
  var next = Object.assign(emptyLog(), log || {});
  next.notified = Object.assign({}, next.notified);
  next.health = Object.assign({}, next.health);
  if (next.date !== date) { next.date = date; next.count = 0; }
  if (msg.counts) next.count++;
  var m = msg.mark || {};
  if (m.started) next.started = true;
  (m.ids || []).forEach(function (id) { next.notified[id] = nowIso; });
  if (m.health) next.health[m.health] = date;
  if (m.wrap) next.wrapDate = date;
  // Forget items that are no longer waiting, so the log stays small.
  if (Array.isArray(pendingIds)) {
    var keep = {};
    pendingIds.forEach(function (id) { if (next.notified[id]) keep[id] = next.notified[id]; });
    next.notified = keep;
  }
  return next;
}

module.exports = { decide, applyMark, emptyLog, CAP, WRAP_AT };
