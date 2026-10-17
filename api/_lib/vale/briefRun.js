// briefRun.js — one morning-brief run: flags → schedule → token → Graph → triage → brief →
// send as vale@ → logs. Every dependency is injected so the whole run is testable offline.
// A failed read is never reported as "nothing new"; a failed send is retried by the next
// catch-up run; Discord (if set) only ever gets a content-free failure notice.
'use strict';

var schedule = require('./schedule');
var tokenStore = require('./tokenStore');
var graphLib = require('./graph');
var triageLib = require('./triage');
var briefLib = require('./brief');
var audit = require('./audit');

var DAY = 86400000;
var LOOKBACK_MS = 14 * DAY;       // inbox + sent window (needed for "waiting on others")
var FIRST_RUN_MS = DAY;           // no watermark yet → last 24 h
var MAX_GAP_MS = 3 * DAY;         // never re-triage more than 72 h
var STATE_TTL_MS = 14 * DAY;
var BRIEFS_CAP = 60;
var LOG_DAYS = 14;

function iso(ms) { return new Date(ms).toISOString(); }

function markDay(cur, date, patch) {
  var log = Object.assign({ days: {} }, cur || {});
  log.days = Object.assign({}, log.days);
  log.days[date] = Object.assign({}, log.days[date] || {}, patch);
  var keys = Object.keys(log.days).sort();
  while (keys.length > LOG_DAYS) delete log.days[keys.shift()];
  return log;
}

// Facts for "Vale's take": rules-only (client) items reduced to sender domain + project.
function takeFacts(nowMs, events, triaged, waiting, workHours) {
  var tv = events ? briefLib.todayView(events, nowMs, workHours) : null;
  var counts = {};
  (triaged || []).forEach(function (i) { counts[i.label] = (counts[i.label] || 0) + 1; });
  return {
    date: schedule.pacificParts(nowMs).date,
    meetings: tv ? tv.meetings.map(function (m) { return { start: m.start, external: m.external, dayJobClash: m.dayJob, unanswered: m.unanswered, subject: m.external ? undefined : m.subject }; }) : 'unavailable',
    freeMinutes: tv ? tv.free.reduce(function (s, f) { return s + (f.end - f.start); }, 0) : null,
    needsYou: (triaged || []).filter(function (i) { return i.label === 'needs_you'; }).slice(0, 15).map(function (i) {
      return i.rulesOnly ? { from: '@' + (i.from.split('@')[1] || ''), project: i.project, receivedAt: i.receivedAt }
        : { from: i.fromName || i.from, subject: i.subject, project: i.project, why: i.why, receivedAt: i.receivedAt };
    }),
    waiting: (waiting || []).map(function (w) { return { to: w.toName || w.to, days: w.days, subject: w.subject }; }),
    counts: counts
  };
}

// deps: { cfg: {strict, mailEnabled, ceoAddress, tenantId, clientId, clientSecret, tokenKey, ...},
//         now, store: {getWithMeta, mutate, set}, fetch, sleep?, callModel?, sendBrief, seedRules, notify? }
async function runBrief(deps) {
  var cfg = deps.cfg;
  if (!cfg.strict || !cfg.mailEnabled) return { ran: false, reason: 'disabled' }; // before any I/O

  var store = deps.store;
  var nowMs = deps.now();
  var logMeta = await store.getWithMeta('valeBriefLog');
  if (logMeta.failed) return { ran: false, reason: 'log_unreadable' };
  var decision = schedule.shouldSendBrief(nowMs, logMeta.value);
  if (!decision.send) return { ran: false, reason: decision.reason };
  var date = decision.date;

  await store.mutate('valeBriefLog', function (cur) { return markDay(cur, date, { status: 'sending', at: iso(nowMs) }); });

  var auditEntry = { at: iso(nowMs), run: 'brief', calls: 0, messages: 0, events: 0, ok: false };
  var brief = null;
  var triaged = null;
  try {
    var token = null;
    try {
      token = await tokenStore.getAccessToken({ cfg: cfg, fetch: deps.fetch, store: store, now: deps.now });
    } catch (e) {
      if (e && e.name === 'ReconnectError') brief = briefLib.buildBrief({ nowMs: nowMs, status: { reconnect: true } });
      else throw e;
    }

    if (!brief) {
      var graph = graphLib.createGraph({ fetch: deps.fetch, token: token, sleep: deps.sleep });
      var inbox = null, sent = null, events = null;
      try { inbox = await graph.listInbox(iso(nowMs - LOOKBACK_MS), 200); } catch (e) { inbox = null; }
      try { sent = await graph.listSent(iso(nowMs - LOOKBACK_MS), 200); } catch (e) { sent = null; }
      try { events = await graph.calendarView(iso(nowMs - 10 * 3600000), iso(nowMs + 2 * DAY)); } catch (e) { events = null; }

      var rulesMeta = await store.getWithMeta('valeMailRules');
      var rules = (!rulesMeta.failed && rulesMeta.value) || deps.seedRules || {};

      var waiting = (inbox && sent) ? triageLib.waitingOnOthers(inbox, sent, nowMs) : null;
      if (inbox) {
        var wm = logMeta.value && logMeta.value.watermark ? Date.parse(logMeta.value.watermark) : NaN;
        var since = Number.isFinite(wm) ? Math.max(wm, nowMs - MAX_GAP_MS) : nowMs - FIRST_RUN_MS;
        var fresh = inbox.filter(function (m) { return Date.parse(m.receivedDateTime || 0) >= since; });
        triaged = await triageLib.triage(fresh, { rules: rules, callModel: deps.callModel });
      }

      var profileMeta = await store.getWithMeta('ceoProfile');
      var workHours = (!profileMeta.failed && profileMeta.value && profileMeta.value.workHours) || null;

      var take = [];
      if (deps.callModel && (triaged || events)) {
        try {
          var tp = briefLib.buildTakePrompt(takeFacts(nowMs, events, triaged, waiting, workHours));
          var tr = await deps.callModel({ model: 'claude-haiku', caller: 'vale-take', json: true, temperature: 0.2, maxTokens: 600, system: tp.system, prompt: tp.prompt });
          take = briefLib.parseTake(tr && tr.text);
        } catch (e) { take = []; }
      }

      brief = briefLib.buildBrief({ nowMs: nowMs, events: events, triaged: triaged, waiting: waiting, take: take, status: {}, workHours: workHours });
      auditEntry.calls = graph.calls();
      auditEntry.messages = inbox ? inbox.length : 0;
      auditEntry.events = events ? events.length : 0;

      await store.set('valeMailState', { at: iso(nowMs), expiresAt: iso(nowMs + STATE_TTL_MS), triaged: triaged, waiting: waiting });
    }

    await deps.sendBrief({ to: cfg.ceoAddress, subject: brief.subject, html: brief.html });

    await store.mutate('valeBriefLog', function (cur) {
      var next = markDay(cur, date, { status: 'sent', at: iso(nowMs) });
      if (triaged) next.watermark = iso(nowMs);
      next.lastSent = { date: date, at: iso(nowMs), subject: brief.subject };
      return next;
    });
    await store.mutate('valeMailBriefs', function (cur) {
      var list = Array.isArray(cur) ? cur.slice() : [];
      list.push({ at: iso(nowMs), date: date, subject: brief.subject, text: brief.text, needsYouIds: brief.needsYouIds, delivery: 'sent' });
      return list.slice(-BRIEFS_CAP);
    });
    auditEntry.ok = true;
    return { ran: true, sent: true, subject: brief.subject };
  } catch (err) {
    auditEntry.error = err && err.message;
    try { await store.mutate('valeBriefLog', function (cur) { return markDay(cur, date, { status: 'failed', at: iso(nowMs), error: String(auditEntry.error || '').slice(0, 200) }); }); } catch (e) { /* next run retries */ }
    if (brief) {
      try {
        await store.mutate('valeMailBriefs', function (cur) {
          var list = Array.isArray(cur) ? cur.slice() : [];
          list.push({ at: iso(nowMs), date: date, subject: brief.subject, text: brief.text, needsYouIds: brief.needsYouIds, delivery: 'failed' });
          return list.slice(-BRIEFS_CAP);
        });
      } catch (e) { /* best effort */ }
    }
    if (deps.notify) { try { await deps.notify('Vale could not email your morning brief. It will retry before 9am; details are on the Office page.'); } catch (e) { /* best effort */ } }
    return { ran: true, sent: false, error: auditEntry.error };
  } finally {
    await audit.appendAudit(store, auditEntry);
  }
}

module.exports = { runBrief: runBrief, takeFacts: takeFacts, markDay: markDay };
