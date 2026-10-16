// Run: node _shared/metrics.test.js   (from api/)
// Pins every HQ definition to the live board captured 2026-10-16 03:00 UTC (fixtures/hq-board-2026-10-16.json),
// hand-counted that night, plus the edge cases each rule exists for.
'use strict';
const assert = require('assert');
const M = require('./metrics');
const F = require('./fixtures/hq-board-2026-10-16.json');

let passed = 0;
function t(name, fn) { try { fn(); passed++; } catch (err) { console.error('FAIL', name, '\n ', err.message); process.exitCode = 1; } }
const NOW = Date.parse(F.capturedAt);
const DAY = 864e5;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

// ── Live board, 2026-10-16 03:00 UTC ──
t('live: 26 open tasks, 0 overdue (the 10-16 re-dating)', () => {
  assert.strictEqual(F.tasks.filter(M.isOpen).length, 26);
  assert.strictEqual(F.tasks.filter((x) => M.isOverdue(x, NOW)).length, 0);
});
t('live: one decision waits — the AmbientScore video request; the queue holds only resolved items', () => {
  const p = M.pendingDecisions(F);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].type, 'video_request');
  assert.strictEqual(F.approvalQueue.filter(M.isPendingQueueItem).length, 0);
});
t('live: Scribe carries the board — 20 queued, 6 done this week, ~24 days to clear', () => {
  assert.deepStrictEqual(M.agentPace(F.tasks, 'scribe', NOW), { agent: 'scribe', queue: 20, doneWeek: 6, donePerDay: 0.9, daysToClear: 24 });
  assert.deepStrictEqual(M.agentPace(F.tasks, 'echo', NOW), { agent: 'echo', queue: 5, doneWeek: 5, donePerDay: 0.7, daysToClear: 7 });
  assert.strictEqual(M.agentPace(F.tasks, 'studio', NOW).daysToClear, null, 'finished nothing: we cannot say');
});
t('live: both active campaigns are in their first period', () => {
  const paces = F.campaigns.filter((c) => M.isActiveCampaign(c, NOW)).map((c) => M.campaignPace(c, F.tasks, NOW));
  assert.deepStrictEqual(paces.map((p) => [p.id, p.status, p.done, p.planned, p.period]), [
    ['camp-monthly-journal', 'starting', 0, 1, 'this month'],
    ['camp-mvaahbz8-hme3', 'starting', 0, 1, 'this week']
  ]);
});
t('live: 2 published, 19 tasks done, $4.96 AI spend in 7 days, $9.92 this month', () => {
  assert.strictEqual(M.publishedCount(F.actions, NOW, 7), 2);
  assert.strictEqual(M.tasksDone(F.tasks, NOW, 7), 19);
  assert.strictEqual(M.spend(F.geminiUsage, NOW, 7), 4.96);
  assert.strictEqual(M.spendMonthToDate(F.geminiUsage, NOW), 9.92);
});
t('live: heartbeat healthy, last run 01:56 (manual), next 06:00', () => {
  const h = M.heartbeatHealth(F.heartbeatRuns, NOW);
  assert.strictEqual(h.state, 'ok');
  assert.strictEqual(h.lastRunAt, '2026-10-16T01:56:05.562Z');
  assert.strictEqual(h.nextRunAt, '2026-10-16T06:00:00.000Z');
});
t('live: the night in plain words, one action trail folded to its last step', () => {
  const ev = M.recentEvents(F.governanceLog, F.tasks, NOW);
  assert.strictEqual(ev.items[0].text, 'You declined: AgentForge Creator Engine: Search-Intent Content ("Too soon. lets revisit.")');
  assert.strictEqual(ev.items[1].text, 'Published on the blog: How to build an AI agent without writing any code');
  const blog = ev.items.filter((i) => /How to build an AI agent without/.test(i.text) && i.type !== 'task-done');
  assert.strictEqual(blog.length, 1, 'requested + approved + published = one line');
});

// ── Edge cases ──
t('pending: no status counts as pending; resolved and expired do not; oldest first', () => {
  const p = M.pendingDecisions({ approvalQueue: [
    { id: 'b', status: 'pending', submittedAt: iso(-DAY) }, { id: 'a', submittedAt: iso(-2 * DAY) },
    { id: 'x', status: 'expired' }, { id: 'y', status: 'approved' }, { id: 'z', status: 'revision_requested' }
  ], tasks: [{ id: 'c', assignee: 'ceo', status: 'todo', createdAt: iso(-3 * DAY) }, { id: 'd', assignee: 'ceo', status: 'done' },
    { id: 'v', taskType: 'video_request', status: 'in-progress' }] });
  assert.deepStrictEqual(p.map((x) => x.id), ['c', 'a', 'b']);
});
t('pending: a video request with a pending queue item counts once, as the queue item', () => {
  const p = M.pendingDecisions({ approvalQueue: [{ id: 'aq-video-v1', type: 'video_request', taskId: 'v1', status: 'pending', submittedAt: iso(-DAY) }],
    tasks: [{ id: 'v1', taskType: 'video_request', status: 'todo', createdAt: iso(-DAY) }, { id: 'v2', taskType: 'video_request', status: 'todo', createdAt: iso(-DAY) }] });
  assert.deepStrictEqual(p.map((x) => x.id).sort(), ['aq-video-v1', 'v2']);
});
t('agent pace: an empty queue is 0 days, nothing finished is null', () => {
  assert.strictEqual(M.agentPace([], 'nova', NOW).daysToClear, 0);
  assert.strictEqual(M.agentPace([{ assignee: 'nova', status: 'todo' }], 'nova', NOW).daysToClear, null);
});
t('campaign pace: behind once a whole period passed short; on pace when done ≥ planned; no cadence = not measured', () => {
  const c = { id: 'c1', cadence: 'weekly', frequency: 2, startDate: iso(-30 * DAY) };
  const doneAt = (d) => ({ campaign_id: 'c1', status: 'done', completedAt: iso(-d * DAY) });
  assert.strictEqual(M.campaignPace(c, [doneAt(1)], NOW).status, 'behind');
  assert.strictEqual(M.campaignPace(c, [doneAt(1), doneAt(2)], NOW).status, 'on_pace');
  assert.strictEqual(M.campaignPace(c, [doneAt(1), doneAt(9)], NOW).status, 'behind', 'outside the window does not count');
  assert.strictEqual(M.campaignPace({ id: 'c2' }, [], NOW).status, 'not_measured');
  assert.strictEqual(M.isActiveCampaign({ status: 'active', endDate: iso(-DAY) }, NOW), false);
});
t('published: a window past the 7-day archive is null, never an undercount', () => {
  assert.strictEqual(M.publishedCount(F.actions, NOW, 30), null);
});
t('spend: a missing ledger is null (not measured), not $0', () => {
  assert.strictEqual(M.spend(null, NOW), null);
  assert.strictEqual(M.spendMonthToDate(undefined, NOW), null);
});
t('heartbeat: missed after slot + 30 min with no run; fine inside the grace; error status shows', () => {
  const at = Date.parse('2026-10-16T06:40:00Z');
  assert.strictEqual(M.heartbeatHealth([{ startedAt: '2026-10-16T00:00:01Z', status: 'ok' }], at).state, 'missed');
  assert.strictEqual(M.heartbeatHealth([{ startedAt: '2026-10-16T00:00:01Z', status: 'ok' }], Date.parse('2026-10-16T06:20:00Z')).state, 'ok');
  assert.strictEqual(M.heartbeatHealth([{ startedAt: '2026-10-16T06:00:01Z', status: 'error', errorSummary: 'x' }], at).state, 'error');
  assert.strictEqual(M.heartbeatHealth(null, at).state, 'not_measured');
});
t('events: guard noise is left out', () => {
  const ev = M.recentEvents([{ type: 'policy-violation', timestamp: iso(-60000) }, { type: 'stall-alert', timestamp: iso(-60000) }], [], NOW);
  assert.strictEqual(ev.total, 0);
});

console.log('metrics: ' + passed + ' passed');
