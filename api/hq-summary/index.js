// hq-summary — GET /api/hq-summary (company secret). Everything HQ Today shows, computed here with the shared
// definitions (api/_shared/metrics.js) so the page cannot count differently from anything else. Read-only.
//
// Blocks: health · waiting · goal · week · campaigns · fleet · happened. Each carries its own asOf and source.
// A source that cannot be read makes its block { state: 'not_measured' } — never an empty list or a zero.
// The task board is the one source Today cannot do without: if it fails, the whole answer is a 503.
// Plan: docs/superpowers/plans/2026-10-16-hq-simplification-plan.md §2.
'use strict';

const storage = require('../_utils/companyStorage');
const M = require('../_shared/metrics');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

const SOURCES = ['tasks', 'campaigns', 'objectives', 'approvalQueue', 'heartbeatRuns', 'governanceLog', 'actions', 'geminiUsage', 'agentRegistry'];
const DAY = 86400000;
const STALL_DAYS = 2;          // a running agent with work older than this and nothing finished in 7 days is stalled
const MAX_HEALTH_ITEMS = 3;    // calm by default: at most three warnings

const nm = (source, why) => ({ state: 'not_measured', source, reason: why || ("couldn't read " + source) });
const nameOf = (reg, id) => {
  const a = ((reg && reg.agents) || []).find((x) => x && x.id === id);
  if (a && a.name) return a.name;
  if (id === 'studio') return 'Video department';
  if (['ceo', 'chad'].indexOf(String(id || '').toLowerCase()) !== -1) return 'You';
  return String(id || '').charAt(0).toUpperCase() + String(id || '').slice(1);
};

function buildSummary(state, nowMs) {
  const now = nowMs || Date.now();
  const asOf = new Date(now).toISOString();
  const ok = (k) => state[k] !== undefined;
  const tasks = state.tasks || [];
  const reg = ok('agentRegistry') ? state.agentRegistry : null;
  const blocks = {};

  // ── Waiting on you ──
  blocks.waiting = ok('approvalQueue') ? (() => {
    const all = M.pendingDecisions({ approvalQueue: state.approvalQueue, tasks });
    return { asOf, source: 'approvalQueue + tasks', count: all.length, items: all.slice(0, 3).map((p) => Object.assign({}, p, { from: p.from ? nameOf(reg, p.from) : null })) };
  })() : nm('approvalQueue');

  // ── The goal ──
  blocks.goal = ok('objectives') ? (() => {
    const o = (state.objectives || []).find((x) => x && x.status === 'active' && x.northStarMetric) || null;
    if (!o) return { asOf, source: 'objectives', state: 'none', title: null };
    const c = o.criteria || {};
    const measured = o.measuredValue !== undefined && o.measuredValue !== null;
    return {
      asOf: o.measuredAt || null, source: 'objectives.' + o.id, title: o.title, metric: o.northStarMetric,
      label: o.northStarMetric === 'qualified_uses_week' ? 'People who used a free offer, last 7 days' : o.northStarMetric.replace(/_/g, ' '),
      value: measured ? Number(o.measuredValue) : null, target: c.target === undefined ? null : c.target, by: c.by || null,
      baseline: c.baseline === undefined ? null : c.baseline, state: measured ? 'measured' : 'not_measured'
    };
  })() : nm('objectives');

  // ── This week ──
  blocks.week = {
    asOf, window: 'last 7 days',
    published: ok('actions') ? M.publishedCount(state.actions, now, 7) : null,
    tasksDone: M.tasksDone(tasks, now, 7),
    spend: ok('geminiUsage') ? M.spend(state.geminiUsage, now, 7) : null,
    spendMonth: ok('geminiUsage') ? M.spendMonthToDate(state.geminiUsage, now) : null,
    sources: { published: 'actions (succeeded)', tasksDone: 'tasks', spend: 'geminiUsage (all model calls)' }
  };

  // ── Campaigns ──
  blocks.campaigns = ok('campaigns') ? {
    asOf, source: 'campaigns + tasks',
    items: (state.campaigns || []).filter((c) => M.isActiveCampaign(c, now)).map((c) => M.campaignPace(c, tasks, now))
  } : nm('campaigns');

  // ── The fleet ──
  const running = reg ? (reg.agents || []).filter((a) => a && a.status === 'active').map((a) => a.id) : null;
  const dormant = reg ? (reg.agents || []).filter((a) => a && a.status === 'dormant').map((a) => nameOf(reg, a.id)) : [];
  const ids = (running || []).slice();
  tasks.forEach((t) => { if (M.isOpen(t) && t.assignee === 'studio' && ids.indexOf('studio') === -1) ids.push('studio'); });
  const paces = ids.map((id) => M.agentPace(tasks, id, now));
  const busy = paces.filter((p) => p.queue > 0).sort((a, b) => b.queue - a.queue).map((p) => ({
    id: p.agent, name: nameOf(reg, p.agent), queue: p.queue, donePerDay: p.donePerDay, daysToClear: p.daysToClear,
    clearBy: p.daysToClear ? new Date(now + p.daysToClear * DAY).toISOString().slice(0, 10) : null
  }));
  blocks.fleet = {
    asOf, source: 'tasks + agentRegistry', registryRead: !!reg,
    busy, onCall: paces.filter((p) => p.queue === 0).map((p) => nameOf(reg, p.agent)), dormant
  };

  // ── What happened (last 24 hours) ──
  blocks.happened = ok('governanceLog')
    ? Object.assign({ asOf, source: 'governanceLog + tasks', window: 'last 24 hours' }, M.recentEvents(state.governanceLog, tasks, now, { hours: 24, limit: 5 }))
    : nm('governanceLog');

  // ── Health: green unless something is actually wrong ──
  const hb = ok('heartbeatRuns') ? M.heartbeatHealth(state.heartbeatRuns, now) : { state: 'not_measured', nextRunAt: new Date(M.nextSlot(now)).toISOString() };
  const issues = [];
  if (hb.state === 'missed') issues.push({ level: 'broken', text: 'The fleet missed its ' + hb.missedSlot.slice(11, 16) + ' UTC run' });
  if (hb.state === 'error') issues.push({ level: 'broken', text: 'The last fleet run failed' + (hb.lastError ? ': ' + hb.lastError : '') });
  if (ok('governanceLog')) {
    const gaps = (state.governanceLog || []).filter((e) => e && e.type === 'routing-gap' && now - Date.parse(e.timestamp || 0) <= DAY);
    if (gaps.length) issues.push({ level: 'attention', text: gaps.length + ' piece' + (gaps.length === 1 ? '' : 's') + ' of work had nobody to take ' + (gaps.length === 1 ? 'it' : 'them') + ' (24 h)' });
  }
  paces.forEach((p) => {
    if (p.agent === 'studio' || p.queue === 0 || p.doneWeek > 0) return;
    const oldest = tasks.filter((t) => M.isOpen(t) && t.assignee === p.agent).reduce((m, t) => Math.min(m, Date.parse(t.createdAt || '') || now), now);
    if (now - oldest >= STALL_DAYS * DAY) issues.push({ level: 'attention', text: nameOf(reg, p.agent) + ' has ' + p.queue + ' waiting and finished nothing this week' });
  });
  const unread = SOURCES.filter((k) => !ok(k));
  if (unread.length) issues.push({ level: 'attention', text: "Couldn't read " + unread.join(', ') + ' — those numbers say "not measured"' });
  const order = { broken: 0, attention: 1 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  blocks.health = {
    asOf, source: 'heartbeatRuns + governanceLog + tasks',
    state: issues.length ? issues[0].level : (hb.state === 'not_measured' ? 'attention' : 'ok'),
    text: issues.length ? issues[0].text : (hb.state === 'not_measured' ? "Couldn't check the fleet's runs" : 'All systems normal'),
    issues: issues.slice(0, MAX_HEALTH_ITEMS), more: Math.max(0, issues.length - MAX_HEALTH_ITEMS),
    heartbeat: hb
  };

  return { asOf, nextRunAt: hb.nextRunAt, lastRunAt: hb.lastRunAt || null, blocks };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: corsHeaders, body: '' }; return; }
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) { context.res = { status: 403, headers: corsHeaders, body: { error: 'Invalid secret' } }; return; }
  try {
    const reads = await Promise.all(SOURCES.map((k) => storage.getStateWithMeta(k)));
    const state = {};
    SOURCES.forEach((k, i) => { if (!reads[i].failed) state[k] = reads[i].value === null ? (k === 'agentRegistry' ? { agents: [] } : []) : reads[i].value; });
    if (state.tasks === undefined) {
      context.res = { status: 503, headers: Object.assign({}, corsHeaders, { 'Retry-After': '30' }), body: { error: "The task board couldn't be read — try again" } };
      return;
    }
    context.res = { status: 200, headers: corsHeaders, body: buildSummary(state, Date.now()) };
  } catch (err) {
    context.log.error('[hq-summary]', err.message);
    context.res = { status: 500, headers: corsHeaders, body: { error: 'HQ summary failed', details: err.message } };
  }
};

module.exports.buildSummary = buildSummary;
module.exports.SOURCES = SOURCES;
