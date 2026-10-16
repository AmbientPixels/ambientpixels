// metrics.js — the ONE definition of every number HQ shows. Pure functions over state arrays; no I/O.
// Open/overdue live in ./taskStatus.js (re-exported here). The browser renders what /api/hq-summary computes
// with these, so there is no browser twin to drift.
//
// Why (2026-10-16): each HQ page counted on its own — "pending approvals" meant three different things on three
// pages, pace was guessed in prompts, spend was summed per page. A number HQ shows names its window and source,
// and a number we cannot measure is null ("not measured"), never 0.
'use strict';

const taskStatus = require('./taskStatus');

const DAY = 86400000;
const HOUR = 3600000;
const lc = (v) => String(v || '').toLowerCase();
const ts = (v) => { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : null; };

// ── Pending decisions: things that wait on the CEO ─────────────────────────────────────────────
// 1. approvalQueue entries still pending (no status = pending, as the Vale brief always read it);
// 2. open tasks assigned to a person (ceo/chad);
// 3. video requests in todo — Chad accepts (in-progress) or declines (cancel) on the board.
const PENDING_QUEUE_STATUSES = ['pending', 'pending_approval', ''];
const HUMANS = ['ceo', 'chad', 'pixelpusher'];

function isPendingQueueItem(q) {
  return !!q && PENDING_QUEUE_STATUSES.indexOf(lc(q.status)) !== -1;
}

function pendingDecisions(input) {
  input = input || {};
  const out = [];
  // A video request also sits in the queue (videoApprovals, 2026-10-16): count it once, as the queue item.
  const queuedTaskIds = new Set((Array.isArray(input.approvalQueue) ? input.approvalQueue : [])
    .filter((q) => isPendingQueueItem(q) && q.taskId).map((q) => q.taskId));
  (Array.isArray(input.approvalQueue) ? input.approvalQueue : []).forEach((q) => {
    if (!isPendingQueueItem(q)) return;
    out.push({
      id: q.id, kind: 'approval', type: q.type || q.kind || 'approval',
      // Proposals carry their title in 'name' (campaign_proposal, objective_proposal).
      title: q.title || q.name || q.taskTitle || q.summary || (q.type || q.kind || 'Approval'),
      from: q.originAgent || q.proposedBy || q.agentId || q.created_by || null,
      since: q.submittedAt || q.createdAt || q.created_at || null
    });
  });
  (Array.isArray(input.tasks) ? input.tasks : []).forEach((t) => {
    if (!taskStatus.isOpen(t)) return;
    const human = HUMANS.indexOf(lc(t.assignee)) !== -1;
    const video = t.taskType === 'video_request' && lc(t.status) === 'todo';
    if (!human && !video) return;
    if (video && queuedTaskIds.has(t.id)) return;
    out.push({
      id: t.id, kind: 'task', type: video ? 'video_request' : 'ceo_task', title: t.title || 'Task',
      from: t.created_by || t.source || null, since: t.createdAt || null
    });
  });
  // Oldest first: what has waited longest is what to look at.
  out.sort((a, b) => (ts(a.since) || 0) - (ts(b.since) || 0));
  return out;
}

// ── Agent pace: queue and what the agent actually finishes ─────────────────────────────────────
// queue = open tasks assigned to it; donePerDay = tasks it marked done in the last 7 days ÷ 7 (no floor —
// a floor is a scheduling assumption, see routing.capacityDueDate); daysToClear = queue ÷ donePerDay
// (null when it finished nothing: we can't say).
function agentPace(tasks, agentId, nowMs) {
  const now = nowMs || Date.now();
  const a = lc(agentId);
  const all = Array.isArray(tasks) ? tasks : [];
  const mine = all.filter((t) => t && lc(t.assignee) === a);
  const queue = mine.filter(taskStatus.isOpen).length;
  const doneWeek = mine.filter((t) => lc(t.status) === 'done' && now - (ts(t.completedAt || t.updatedAt) || 0) <= 7 * DAY).length;
  const donePerDay = doneWeek / 7;
  const daysToClear = queue === 0 ? 0 : (donePerDay > 0 ? Math.ceil(queue / donePerDay) : null);
  return { agent: a, queue, doneWeek, donePerDay: Math.round(donePerDay * 10) / 10, daysToClear };
}

// ── Campaign pace ──────────────────────────────────────────────────────────────────────────────
// A campaign plans `frequency` pieces per `cadence` period. Done = its tasks completed inside the current
// rolling period (the same window campaign-lifecycle uses to replenish). Status:
//   on_pace  done ≥ planned          · starting  first period not over yet and nothing due-late
//   behind   a full period has run and done < planned
const CADENCE_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };
const CADENCE_LABEL = { daily: 'today', weekly: 'this week', biweekly: 'these 2 weeks', monthly: 'this month' };

function isActiveCampaign(c, nowMs) {
  if (!c || c.deletedAt || lc(c.status) !== 'active') return false;
  const now = nowMs || Date.now();
  const end = ts(c.endDate);
  return !(end && end < now);
}

function campaignPace(campaign, tasks, nowMs) {
  const now = nowMs || Date.now();
  const days = CADENCE_DAYS[lc(campaign.cadence)] || null;
  const planned = Number(campaign.frequency) || null;
  const mine = (Array.isArray(tasks) ? tasks : []).filter((t) => t && t.campaign_id === campaign.id);
  const open = mine.filter(taskStatus.isOpen).length;
  if (!days || !planned) {
    return { id: campaign.id, title: campaign.title, status: 'not_measured', done: null, planned: null, period: null, open };
  }
  const start = ts(campaign.startDate) || ts(campaign.createdAt) || now;
  const periodStart = Math.max(start, now - days * DAY);
  const done = mine.filter((t) => lc(t.status) === 'done' && (ts(t.completedAt || t.updatedAt) || 0) >= periodStart).length;
  let status;
  if (done >= planned) status = 'on_pace';
  else if (now - start < days * DAY) status = 'starting';
  else status = 'behind';
  return { id: campaign.id, title: campaign.title, status, done, planned, period: CADENCE_LABEL[lc(campaign.cadence)], open };
}

// ── Published: what actually went out ──────────────────────────────────────────────────────────
// An action whose execution succeeded inside the window. The archiver keeps 7 days of finished actions live,
// so a 7-day window over `actions` is complete; longer windows are not (return null rather than undercount).
function publishedCount(actions, nowMs, windowDays) {
  const w = windowDays || 7;
  if (w > 7) return null;
  const now = nowMs || Date.now();
  return (Array.isArray(actions) ? actions : []).filter((a) => {
    const ex = a && a.execution;
    return ex && ex.status === 'success' && now - (ts(ex.finished_at) || 0) <= w * DAY;
  }).length;
}

function tasksDone(tasks, nowMs, windowDays) {
  const now = nowMs || Date.now();
  const w = (windowDays || 7) * DAY;
  return (Array.isArray(tasks) ? tasks : []).filter((t) => t && lc(t.status) === 'done' && now - (ts(t.completedAt || t.updatedAt) || 0) <= w).length;
}

// ── AI spend (geminiUsage ledger — every model call the fleet makes is logged there, Claude included) ─
function spend(usage, nowMs, windowDays) {
  const now = nowMs || Date.now();
  const rows = Array.isArray(usage) ? usage : null;
  if (!rows) return null;
  const w = (windowDays || 7) * DAY;
  const total = rows.reduce((s, r) => (r && now - (ts(r.timestamp) || 0) <= w ? s + (Number(r.totalCost) || 0) : s), 0);
  return Math.round(total * 100) / 100;
}

function spendMonthToDate(usage, nowMs) {
  const now = new Date(nowMs || Date.now());
  const rows = Array.isArray(usage) ? usage : null;
  if (!rows) return null;
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const total = rows.reduce((s, r) => ((ts(r && r.timestamp) || 0) >= monthStart ? s + (Number(r.totalCost) || 0) : s), 0);
  return Math.round(total * 100) / 100;
}

// ── Heartbeat health ───────────────────────────────────────────────────────────────────────────
// The fleet runs at 00/06/12/18 UTC (companyHeartbeat/function.json). A slot is missed when 30 minutes have
// passed since it and no run started at or after it.
const HB_EVERY_H = 6;
const HB_GRACE_MS = 30 * 60000;

function lastSlot(nowMs) {
  const d = new Date(nowMs);
  const h = Math.floor(d.getUTCHours() / HB_EVERY_H) * HB_EVERY_H;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h);
}
function nextSlot(nowMs) { return lastSlot(nowMs) + HB_EVERY_H * HOUR; }

function heartbeatHealth(runs, nowMs) {
  const now = nowMs || Date.now();
  if (!Array.isArray(runs)) return { state: 'not_measured', lastRunAt: null, lastStatus: null, nextRunAt: new Date(nextSlot(now)).toISOString() };
  const last = runs.length ? runs[runs.length - 1] : null;
  const lastAt = last ? ts(last.startedAt || last.timestamp) : null;
  // The slot we should have seen by now (the current one once its grace has passed, else the one before).
  const slot = now - lastSlot(now) >= HB_GRACE_MS ? lastSlot(now) : lastSlot(now) - HB_EVERY_H * HOUR;
  let state = 'ok';
  if (!lastAt || lastAt < slot) state = 'missed';
  else if (last.status && lc(last.status) !== 'ok') state = 'error';
  return {
    state,
    lastRunAt: lastAt ? new Date(lastAt).toISOString() : null,
    lastStatus: last ? (last.status || null) : null,
    lastError: last && last.errorSummary ? String(last.errorSummary).slice(0, 160) : null,
    missedSlot: state === 'missed' ? new Date(slot).toISOString() : null,
    nextRunAt: new Date(nextSlot(now)).toISOString()
  };
}

// ── What happened: the few events a CEO cares about ────────────────────────────────────────────
// Agent guard noise (policy-violation, stall-alert, archive-run, standup runs, directives) is left out on purpose.
// governanceLog has two shapes: { summary, details } and { data }. One action's trail (publish requested →
// approved → published) is folded into its latest step, titled from whichever step named it.
const PLATFORM = { site: 'the blog', bluesky: 'Bluesky', x: 'X', linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', reddit: 'Reddit' };
const ACTION_WORD = (d) => {
  const type = String((d && d.type) || '');
  const where = PLATFORM[lc(d && d.platform)] || (d && d.platform) || '';
  if (type === 'publish_document') return 'Published on the blog';
  if (/reply/.test(type)) return 'Replied on ' + (where || 'social');
  if (/social_post/.test(type)) return 'Posted on ' + (where || 'social');
  return 'Ran ' + type.replace(/[._]/g, ' ');
};
const ACTION_NOUN = (d) => {
  const type = String((d && d.type) || '');
  const where = PLATFORM[lc(d && d.platform)] || '';
  if (type === 'publish_document') return 'blog post';
  if (/reply/.test(type)) return (where ? where + ' ' : '') + 'reply';
  if (/schedule/.test(type)) return 'scheduled ' + (where ? where + ' ' : '') + 'post';
  return (where ? where + ' ' : '') + 'post';
};
const STEP = { 'publish-requested': 1, 'ceo-approval': 2, 'ceo-reject': 3, 'action-success': 4, 'scheduled-action-success': 4 };
const EVENT_TONE = { 'routing-gap': 'attention', 'action-success': 'ok', 'scheduled-action-success': 'ok', 'task-done': 'ok' };
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function q(s) { return s ? ': ' + s : ''; }

function eventText(e, title) {
  const d = e.data || e.details || {};
  const who = e.agentId || d.agent || d.agentId;
  switch (e.type) {
    case 'publish-requested': return (who ? cap(who) + ' asked to publish' : 'Publish requested') + q(title);
    case 'ceo-approval': return title ? 'You approved' + q(title) : 'You approved a ' + ACTION_NOUN(d);
    case 'ceo-reject': return title ? 'You declined' + q(title) : 'You declined a ' + ACTION_NOUN(d);
    case 'action-success':
    case 'scheduled-action-success': return ACTION_WORD(d) + q(title);
    case 'proposal-created': return (who ? cap(who) + ' proposed' : 'New proposal') + q(String(e.summary || d.title || '').replace(/^Agent proposal queued:\s*/, ''));
    case 'proposal-decided': {
      const verb = d.decision === 'rejected' ? 'You declined' : d.decision === 'approved' ? 'You approved' : 'Decided';
      const what = String(e.summary || '').replace(/^CEO \w+:\s*\w+\s*—\s*/, '');
      return verb + q(what) + (d.note ? ' ("' + String(d.note).slice(0, 60) + '")' : '');
    }
    case 'routing-gap': return 'Nobody running can take' + q(e.summary || d.what);
    case 'task-handoff': return 'Handed off' + q(e.summary || d.title);
    case 'campaign_auto_replenish': return 'New work for ' + (d.campaignTitle || 'a campaign') + q(d.taskTitle);
    default: return null;
  }
}

function recentEvents(governanceLog, tasks, nowMs, opts) {
  opts = opts || {};
  const now = nowMs || Date.now();
  const since = now - (opts.hours || 24) * HOUR;
  const log = Array.isArray(governanceLog) ? governanceLog : [];
  // Titles for actions, from any step that carried one.
  const titleOf = {};
  log.forEach((e) => { const d = (e && (e.data || e.details)) || {}; if (d.actionId && d.title) titleOf[d.actionId] = d.title; });
  const latestStep = {};
  const out = [];
  log.forEach((e) => {
    const at = ts(e && (e.timestamp || e.at));
    if (!at || at < since) return;
    const d = e.data || e.details || {};
    const text = eventText(e, d.actionId ? titleOf[d.actionId] : d.title);
    if (!text) return;
    const item = { at: new Date(at).toISOString(), text: text.slice(0, 140), tone: EVENT_TONE[e.type] || 'neutral', type: e.type };
    if (d.actionId && STEP[e.type]) {
      const prev = latestStep[d.actionId];
      if (prev && STEP[prev.type] >= STEP[e.type]) return;
      if (prev) out.splice(out.indexOf(prev), 1);
      latestStep[d.actionId] = item;
    }
    out.push(item);
  });
  (Array.isArray(tasks) ? tasks : []).forEach((t) => {
    const at = ts(t && t.completedAt);
    if (!at || at < since || lc(t.status) !== 'done') return;
    out.push({ at: new Date(at).toISOString(), text: (t.assignee ? cap(t.assignee) + ' finished: ' : 'Finished: ') + String(t.title || '').slice(0, 110), tone: 'ok', type: 'task-done' });
  });
  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { total: out.length, items: out.slice(0, opts.limit || 5) };
}

module.exports = {
  // task status (one definition, re-exported)
  isOpen: taskStatus.isOpen, isClosed: taskStatus.isClosed, isOverdue: taskStatus.isOverdue,
  HUMANS, isPendingQueueItem, pendingDecisions,
  agentPace,
  CADENCE_DAYS, isActiveCampaign, campaignPace,
  publishedCount, tasksDone,
  spend, spendMonthToDate,
  lastSlot, nextSlot, heartbeatHealth,
  recentEvents
};
