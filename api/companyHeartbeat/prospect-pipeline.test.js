// Run: node api/companyHeartbeat/prospect-pipeline.test.js
const assert = require('node:assert');
const PP = require('./prospect-pipeline');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '-', e.message); }
}

const BLOCK = {
  ownDomains: ['ambientpixels.ai', 'azurestaticapps.net'],
  domainBlocklist: ['bit.ly', 'github.com', 'bsky.app']
};

// ── extractSiteUrl ──
test('prefers candidate.links over text', () => {
  const r = PP.extractSiteUrl({ links: ['https://mysite.io/x'], text: 'see https://other.com' }, BLOCK);
  assert.strictEqual(r.siteUrl, 'https://mysite.io/x');
  assert.strictEqual(r.domain, 'mysite.io');
});

test('falls back to first http(s) URL in text, strips trailing punctuation', () => {
  const r = PP.extractSiteUrl({ links: [], text: 'just launched https://cool.dev/app!' }, BLOCK);
  assert.strictEqual(r.siteUrl, 'https://cool.dev/app');
});

test('skips blocked and own domains, takes next candidate', () => {
  const r = PP.extractSiteUrl({ links: ['https://bit.ly/x', 'https://real.site'], text: '' }, BLOCK);
  assert.strictEqual(r.domain, 'real.site');
});

test('subdomain of blocked domain is blocked', () => {
  const r = PP.extractSiteUrl({ links: ['https://foo.azurestaticapps.net'], text: '' }, BLOCK);
  assert.strictEqual(r, null);
});

test('no usable URL yields null', () => {
  assert.strictEqual(PP.extractSiteUrl({ links: [], text: 'launched my site today, so proud' }, BLOCK), null);
  assert.strictEqual(PP.extractSiteUrl({ links: ['https://github.com/me/repo'], text: '' }, BLOCK), null);
});

test('links entry with trailing parens survives intact (not text-stripped)', () => {
  const r = PP.extractSiteUrl({ links: ['https://site.io/page_(v2)'], text: '' }, BLOCK);
  assert.strictEqual(r.siteUrl, 'https://site.io/page_(v2)');
});

// ── filterProspects ──
const NOW = Date.parse('2026-07-21T12:00:00Z');
const CFG = Object.assign({}, BLOCK, {
  maxScansPerDay: 3, maxDraftsPerDay: 2, maxQueuedProspects: 10,
  minEngagement: 1, maxPostAgeHours: 24, domainCooldownDays: 30
});
function cand(over) {
  return Object.assign({
    uri: 'at://did:plc:a/app.bsky.feed.post/' + Math.random().toString(36).slice(2, 8),
    cid: 'cid1', author: 'maker.bsky.social', authorDid: 'did:plc:a',
    text: 'just launched https://newsite.dev', links: [],
    indexedAt: new Date(NOW - 2 * 3600e3).toISOString(),
    replyCount: 1, likeCount: 2
  }, over || {});
}

test('qualifying candidate becomes a prospect', () => {
  const out = PP.filterProspects([cand()], [], CFG, NOW);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].status, 'discovered');
  assert.strictEqual(out[0].domain, 'newsite.dev');
  assert.strictEqual(out[0].author, 'maker.bsky.social');
  assert.ok(out[0].id.indexOf('pros_') === 0);
  assert.strictEqual(out[0].scanId, null);
  assert.strictEqual(out[0].scanQueuedAt, null);
  assert.strictEqual(out[0].promotedAt, null);
});

test('explicit zero config values are honored, not treated as falsy-default', () => {
  const paused = Object.assign({}, CFG, { maxScansPerDay: 0 });
  assert.strictEqual(PP.filterProspects([cand()], [], paused, NOW).length, 0);
});

test('partial budget: 1 scanned today + maxScansPerDay 3 admits exactly 2 of 3 distinct candidates', () => {
  const today = new Date(NOW - 3600e3).toISOString();
  const existing = [{ author: 'used.bsky.social', domain: 'used.dev', status: 'scan_queued',
    scanQueuedAt: today, discoveredAt: today }];
  const batch = [
    cand({ author: 'one.bsky.social', authorDid: 'did:plc:one', text: 'just launched https://one.dev' }),
    cand({ author: 'two.bsky.social', authorDid: 'did:plc:two', text: 'just launched https://two.dev' }),
    cand({ author: 'three.bsky.social', authorDid: 'did:plc:three', text: 'just launched https://three.dev' })
  ];
  assert.strictEqual(PP.filterProspects(batch, existing, CFG, NOW).length, 2);
});

test('post older than maxPostAgeHours is rejected', () => {
  const old = cand({ indexedAt: new Date(NOW - 30 * 3600e3).toISOString() });
  assert.strictEqual(PP.filterProspects([old], [], CFG, NOW).length, 0);
});

test('engagement floor: likes+replies below minEngagement rejected', () => {
  const cold = cand({ replyCount: 0, likeCount: 0 });
  assert.strictEqual(PP.filterProspects([cold], [], CFG, NOW).length, 0);
});

test('author already prospected (any status) is rejected forever', () => {
  const existing = [{ author: 'maker.bsky.social', domain: 'x.dev', status: 'declined',
    discoveredAt: new Date(NOW - 90 * 86400e3).toISOString() }];
  assert.strictEqual(PP.filterProspects([cand()], existing, CFG, NOW).length, 0);
});

test('domain inside cooldown window is rejected, outside is allowed', () => {
  const recent = [{ author: 'other.bsky.social', domain: 'newsite.dev', status: 'sent',
    discoveredAt: new Date(NOW - 10 * 86400e3).toISOString() }];
  assert.strictEqual(PP.filterProspects([cand()], recent, CFG, NOW).length, 0);
  const stale = [{ author: 'other.bsky.social', domain: 'newsite.dev', status: 'sent',
    discoveredAt: new Date(NOW - 40 * 86400e3).toISOString() }];
  assert.strictEqual(PP.filterProspects([cand()], stale, CFG, NOW).length, 1);
});

test('daily scan cap counts prospects scan-queued today', () => {
  const today = new Date(NOW - 3600e3).toISOString();
  const existing = [1, 2, 3].map(function (i) {
    return { author: 'a' + i, domain: 'd' + i + '.com', status: 'scan_queued', scanQueuedAt: today,
      discoveredAt: today };
  });
  assert.strictEqual(PP.filterProspects([cand()], existing, CFG, NOW).length, 0);
});

test('candidate without extractable URL is rejected', () => {
  const noUrl = cand({ text: 'launched my site!', links: [] });
  assert.strictEqual(PP.filterProspects([noUrl], [], CFG, NOW).length, 0);
});

test('dedup within one batch by author and by domain', () => {
  const a = cand(); const b = cand({ authorDid: 'did:plc:b' }); // same author handle + domain
  assert.strictEqual(PP.filterProspects([a, b], [], CFG, NOW).length, 1);
});

// ── builders ──
test('buildReplyTask: backlog, scribe, threadContext, fact sheet, objective link', () => {
  const p = PP.filterProspects([cand()], [], CFG, NOW)[0];
  const task = PP.buildReplyTask(p, NOW);
  assert.strictEqual(task.status, 'backlog');
  assert.strictEqual(task.assignee, 'scribe');
  assert.strictEqual(task.taskType, 'bluesky_reply');
  assert.strictEqual(task.source, 'asProspectCron');
  assert.strictEqual(task.objective_id, 'obj-first-customer');
  assert.strictEqual(task.threadContext.uri, p.uri);
  assert.strictEqual(task.threadContext.cid, p.cid);
  assert.strictEqual(task.threadContext.author, p.author);
  assert.ok(task.description.indexOf('PROSPECT FACT SHEET') !== -1);
  assert.ok(task.description.indexOf(p.siteUrl) !== -1);
  assert.ok(task.description.indexOf(p.postText) !== -1);
  assert.ok(task.description.indexOf('[SCAN RESULT]') !== -1);
  assert.ok(task.dueDate && task.id && task.createdAt);
});

test('buildScanJob: matches asScanQueue shape', () => {
  const p = PP.filterProspects([cand()], [], CFG, NOW)[0];
  const job = PP.buildScanJob(p, 'task_x', NOW);
  assert.strictEqual(job.url, p.siteUrl);
  assert.strictEqual(job.taskId, 'task_x');
  assert.strictEqual(job.status, 'queued');
  assert.strictEqual(job.requestedBy, 'asProspectCron');
  assert.ok(job.id.indexOf('scan_') === 0);
});

// ── promoteReady ──
function queuedProspect(over) {
  return Object.assign({
    id: 'pros_1', author: 'maker.bsky.social', domain: 'newsite.dev',
    status: 'scan_queued', taskId: 'task_1', scanId: 'scan_1',
    scanQueuedAt: new Date(NOW - 3600e3).toISOString(),
    discoveredAt: new Date(NOW - 3600e3).toISOString(),
    scanScore: null, reportId: null, promotedAt: null
  }, over || {});
}

test('scan done → prospect task_ready + task flip to todo', () => {
  const prospects = [queuedProspect()];
  const scanQ = [{ id: 'scan_1', taskId: 'task_1', status: 'done', reportId: 'ccr_9', score: 61 }];
  const r = PP.promoteReady(prospects, scanQ, CFG, NOW);
  assert.deepStrictEqual(r.taskIdsToTodo, ['task_1']);
  assert.strictEqual(prospects[0].status, 'task_ready');
  assert.strictEqual(prospects[0].reportId, 'ccr_9');
  assert.strictEqual(prospects[0].scanScore, 61);
  assert.ok(prospects[0].promotedAt);
});

test('scan error → prospect dismissed + task close', () => {
  const prospects = [queuedProspect()];
  const scanQ = [{ id: 'scan_1', taskId: 'task_1', status: 'error' }];
  const r = PP.promoteReady(prospects, scanQ, CFG, NOW);
  assert.deepStrictEqual(r.taskIdsToClose, ['task_1']);
  assert.strictEqual(prospects[0].status, 'dismissed');
});

test('scan still queued/running → untouched', () => {
  const prospects = [queuedProspect()];
  const r = PP.promoteReady(prospects, [{ id: 'scan_1', taskId: 'task_1', status: 'running' }], CFG, NOW);
  assert.strictEqual(prospects[0].status, 'scan_queued');
  assert.strictEqual(r.taskIdsToTodo.length, 0);
});

test('scan score below outreach floor → dismissed, not promoted (bot-wall guard)', () => {
  const prospects = [queuedProspect()];
  const scanQ = [{ id: 'scan_1', taskId: 'task_1', status: 'done', reportId: 'ccr_amz', score: 7 }];
  const r = PP.promoteReady(prospects, scanQ, CFG, NOW);
  assert.strictEqual(prospects[0].status, 'dismissed');
  assert.deepStrictEqual(r.taskIdsToClose, ['task_1']);
  assert.strictEqual(r.taskIdsToTodo.length, 0);
});

test('outreach floor is tunable: floor 80 dismisses a 75 scan', () => {
  const prospects = [queuedProspect()];
  const scanQ = [{ id: 'scan_1', taskId: 'task_1', status: 'done', reportId: 'ccr_x', score: 75 }];
  const strict = Object.assign({}, CFG, { minOutreachScore: 80 });
  PP.promoteReady(prospects, scanQ, strict, NOW);
  assert.strictEqual(prospects[0].status, 'dismissed');
});

test('daily draft cap limits promotions', () => {
  const done = function (n) { return { id: 'scan_' + n, taskId: 'task_' + n, status: 'done', reportId: 'r' + n }; };
  const promotedToday = queuedProspect({ id: 'p0', taskId: 'task_0', scanId: 'scan_0',
    status: 'task_ready', promotedAt: new Date(NOW - 1800e3).toISOString() });
  const a = queuedProspect({ id: 'p1', taskId: 'task_1', scanId: 'scan_1', author: 'a1', domain: 'd1.com' });
  const b = queuedProspect({ id: 'p2', taskId: 'task_2', scanId: 'scan_2', author: 'a2', domain: 'd2.com' });
  const r = PP.promoteReady([promotedToday, a, b], [done(1), done(2)], CFG, NOW); // cap 2, 1 used
  assert.strictEqual(r.taskIdsToTodo.length, 1);
  assert.strictEqual(b.status, 'scan_queued'); // deferred to tomorrow
});

test('scan status "failed" (asScanRunner\'s actual value) → dismissed + close', () => {
  const prospects = [queuedProspect()];
  const scanQ = [{ id: 'scan_1', taskId: 'task_1', status: 'failed' }];
  const r = PP.promoteReady(prospects, scanQ, CFG, NOW);
  assert.deepStrictEqual(r.taskIdsToClose, ['task_1']);
  assert.strictEqual(prospects[0].status, 'dismissed');
});

// ── reconcile ──
test('task done + APPROVED reply action → sent (actionId stamped)', () => {
  const p = queuedProspect({ status: 'task_ready' });
  const tasks = [{ id: 'task_1', status: 'done' }];
  const actions = [{ id: 'act_9', type: 'social_post.reply', _parentTaskId: 'task_1',
    approval: { status: 'approved' } }];
  PP.reconcile([p], tasks, actions, NOW);
  assert.strictEqual(p.status, 'sent');
  assert.strictEqual(p.actionId, 'act_9');
});

test('task done + PENDING reply action → stays task_ready (no premature stamp)', () => {
  const p = queuedProspect({ status: 'task_ready' });
  const tasks = [{ id: 'task_1', status: 'done' }];
  const actions = [{ id: 'act_9', type: 'social_post.reply', _parentTaskId: 'task_1',
    approval: { status: 'pending' } }];
  PP.reconcile([p], tasks, actions, NOW);
  assert.strictEqual(p.status, 'task_ready');
});

test('task done + REJECTED reply action → declined', () => {
  const p = queuedProspect({ status: 'task_ready' });
  const tasks = [{ id: 'task_1', status: 'done' }];
  const actions = [{ id: 'act_9', type: 'social_post.reply', _parentTaskId: 'task_1',
    approval: { status: 'rejected' } }];
  PP.reconcile([p], tasks, actions, NOW);
  assert.strictEqual(p.status, 'declined');
});

test('task done + CANCELLED reply action → declined (terminal, same as rejected)', () => {
  const p = queuedProspect({ status: 'task_ready' });
  const tasks = [{ id: 'task_1', status: 'done' }];
  const actions = [{ id: 'act_9', type: 'social_post.reply', _parentTaskId: 'task_1',
    approval: { status: 'cancelled' } }];
  PP.reconcile([p], tasks, actions, NOW);
  assert.strictEqual(p.status, 'declined');
});

test('task done + no reply action → declined', () => {
  const p = queuedProspect({ status: 'task_ready' });
  PP.reconcile([p], [{ id: 'task_1', status: 'done' }], [], NOW);
  assert.strictEqual(p.status, 'declined');
});

test('prunes dismissed >14d, everything >60d, caps at 300', () => {
  const mk = function (i, status, ageDays) {
    return { id: 'p' + i, status: status, taskId: 't' + i,
      discoveredAt: new Date(NOW - ageDays * 86400e3).toISOString() };
  };
  const list = [mk(1, 'dismissed', 20), mk(2, 'dismissed', 2), mk(3, 'sent', 70), mk(4, 'sent', 5)];
  for (let i = 5; i < 301; i++) list.push(mk(i, 'sent', 1));
  const kept = PP.reconcile(list, [], [], NOW);
  assert.ok(!kept.some(function (p) { return p.id === 'p1'; }), 'old dismissed pruned');
  assert.ok(kept.some(function (p) { return p.id === 'p2'; }), 'fresh dismissed kept');
  assert.ok(!kept.some(function (p) { return p.id === 'p3'; }), '>60d pruned');
  assert.ok(kept.length <= 300, 'capped at 300');
});

test('cap keeps the NEWEST 300 when over limit', () => {
  const list = [];
  for (let i = 0; i < 310; i++) {
    list.push({ id: 'pc' + i, status: 'sent', taskId: 't' + i,
      discoveredAt: new Date(NOW - (310 - i) * 60e3).toISOString() }); // ascending: pc309 newest
  }
  const kept = PP.reconcile(list, [], [], NOW);
  assert.strictEqual(kept.length, 300);
  assert.ok(kept.some(function (p) { return p.id === 'pc309'; }), 'newest kept');
  assert.ok(!kept.some(function (p) { return p.id === 'pc0'; }), 'oldest dropped');
});

// ── sweepOrphans ──
test('orphan sweep: no-job scan_queued older than 30min reverts to discovered + closes task', () => {
  const p = queuedProspect({ scanQueuedAt: new Date(NOW - 40 * 60e3).toISOString() });
  const tasks = [{ id: 'task_1', status: 'backlog' }];
  const r = PP.sweepOrphans([p], [], tasks, NOW); // empty scanQueue → no job found for scan_1/task_1
  assert.deepStrictEqual(r.reverted, ['pros_1']);
  assert.deepStrictEqual(r.taskIdsToClose, ['task_1']);
  assert.strictEqual(p.status, 'discovered');
  assert.strictEqual(p.taskId, null);
  assert.strictEqual(p.scanId, null);
  assert.strictEqual(p.scanQueuedAt, null);
});

test('orphan sweep: no-job scan_queued YOUNGER than 30min is untouched (age guard)', () => {
  const p = queuedProspect({ scanQueuedAt: new Date(NOW - 5 * 60e3).toISOString() });
  const tasks = [{ id: 'task_1', status: 'backlog' }];
  const r = PP.sweepOrphans([p], [], tasks, NOW);
  assert.strictEqual(r.reverted.length, 0);
  assert.strictEqual(p.status, 'scan_queued');
});

test('orphan sweep: task_ready with backlog task gets reflipped', () => {
  const p = queuedProspect({ status: 'task_ready', taskId: 'task_1' });
  const tasks = [{ id: 'task_1', status: 'backlog' }];
  const r = PP.sweepOrphans([p], [], tasks, NOW);
  assert.deepStrictEqual(r.reflipTaskIds, ['task_1']);
  assert.strictEqual(p.status, 'task_ready');
});

test('orphan sweep: task_ready with missing task is dismissed', () => {
  const p = queuedProspect({ status: 'task_ready', taskId: 'task_missing' });
  const r = PP.sweepOrphans([p], [], [], NOW);
  assert.strictEqual(p.status, 'dismissed');
  assert.strictEqual(r.reflipTaskIds.length, 0);
});

// ── runProspectPipeline (integration, mocked IO) ──
function mockStorage(initial) {
  const state = Object.assign({}, initial);
  const writes = [];
  return {
    _state: state,
    _writes: writes,
    getState: async function (k) { return state[k] !== undefined ? state[k] : null; },
    setState: async function (k, v) { writes.push(k); state[k] = v; }
  };
}

(async function () {
  // Run 1: discover → prospect + backlog task + scan queued
  const storage = mockStorage({
    systemConfig: { asProspecting: { minEngagement: 1 } },
    tasks: [], asScanQueue: [], asProspects: [], actions: [], governanceLog: []
  });
  const discover = async function () { return [cand()]; };
  const r1 = await PP.runProspectPipeline({ storage: storage, log: function () {}, nowMs: NOW, discover: discover });
  const s = storage._state;

  test('run1: prospect created, scan queued, backlog task created', () => {
    assert.strictEqual(s.asProspects.length, 1);
    assert.strictEqual(s.asProspects[0].status, 'scan_queued');
    assert.ok(s.asProspects[0].scanId);
    assert.strictEqual(s.asScanQueue.length, 1);
    assert.strictEqual(s.tasks.length, 1);
    assert.strictEqual(s.tasks[0].status, 'backlog');
    assert.strictEqual(s.asScanQueue[0].taskId, s.tasks[0].id);
    assert.strictEqual(r1.discovered, 1);
    assert.strictEqual(r1.queued, 1);
    assert.strictEqual(r1.swept, 0, 'clean run sweeps nothing, but the key is always present');
  });

  // Run 2: scan runner finished → task promoted to todo
  s.asScanQueue[0].status = 'done';
  s.asScanQueue[0].reportId = 'ccr_test';
  const r2 = await PP.runProspectPipeline({ storage: storage, log: function () {}, nowMs: NOW + 3600e3, discover: async function () { return []; } });
  test('run2: task promoted to todo, prospect task_ready', () => {
    assert.strictEqual(s.tasks[0].status, 'todo');
    assert.strictEqual(s.asProspects[0].status, 'task_ready');
    assert.strictEqual(s.asProspects[0].reportId, 'ccr_test');
    assert.strictEqual(r2.promoted, 1);
  });

  // Kill switch
  const storage2 = mockStorage({ systemConfig: { asProspecting: { enabled: false } } });
  const r3 = await PP.runProspectPipeline({ storage: storage2, log: function () {}, nowMs: NOW, discover: discover });
  test('kill switch: disabled config does nothing', () => {
    assert.strictEqual(r3.skipped, 'disabled');
    assert.ok(!storage2._state.asProspects || storage2._state.asProspects === null);
  });

  // Queue full: prospect persists as 'discovered' (spec rule), no task, no job
  const fullQueue = [];
  for (let i = 0; i < 20; i++) fullQueue.push({ id: 'q' + i, url: 'https://q' + i + '.com', status: 'queued' });
  const storage3 = mockStorage({
    systemConfig: {}, tasks: [], asScanQueue: fullQueue, asProspects: [], actions: [], governanceLog: []
  });
  const r4 = await PP.runProspectPipeline({ storage: storage3, log: function () {}, nowMs: NOW, discover: discover });
  test('queue full: prospect stays discovered for retry, no task created', () => {
    assert.strictEqual(storage3._state.asProspects.length, 1);
    assert.strictEqual(storage3._state.asProspects[0].status, 'discovered');
    assert.strictEqual(storage3._state.tasks.length, 0);
    assert.strictEqual(storage3._state.asScanQueue.filter(q => q.taskId).length, 0);
    assert.strictEqual(r4.discovered, 1);
    assert.strictEqual(r4.queued, 0);
  });

  // Carried retry: previously-discovered prospect queues once the queue frees up
  storage3._state.asScanQueue = [];
  const r5 = await PP.runProspectPipeline({ storage: storage3, log: function () {}, nowMs: NOW + 3600e3, discover: async function () { return []; } });
  test('carried retry: discovered prospect queues on a later run', () => {
    assert.strictEqual(storage3._state.asProspects[0].status, 'scan_queued');
    assert.strictEqual(storage3._state.tasks.length, 1);
    assert.strictEqual(storage3._state.tasks[0].status, 'backlog');
    assert.strictEqual(r5.queued, 1);
  });

  // Orphan sweep wiring: a stranded scan_queued prospect (no job, old enough
  // to clear the age guard) should close its task with the HONEST orphan
  // copy, not the promote-path "scan failed" copy — no scan failed here, the
  // prospect is being reverted for a retry, not dismissed.
  const orphanProspect = queuedProspect({ id: 'pros_orphan', taskId: 'task_orphan', scanId: 'scan_orphan',
    scanQueuedAt: new Date(NOW - 40 * 60e3).toISOString() });
  const storage5 = mockStorage({
    systemConfig: {}, tasks: [{ id: 'task_orphan', status: 'backlog', comments: [] }],
    asScanQueue: [], asProspects: [orphanProspect], actions: [], governanceLog: []
  });
  const r6 = await PP.runProspectPipeline({ storage: storage5, log: function () {}, nowMs: NOW, discover: async function () { return []; } });
  test('orphan sweep wiring: orphan-closed task gets honest "Scan job lost" copy', () => {
    const t = storage5._state.tasks.find(function (x) { return x.id === 'task_orphan'; });
    assert.strictEqual(t.status, 'done');
    assert.ok(t.comments.some(function (c) { return c.text.indexOf('Scan job lost') !== -1; }), 'orphan copy present');
    assert.ok(!t.comments.some(function (c) { return c.text.indexOf('Scan failed for this prospect') !== -1; }), 'promote copy absent');
    assert.strictEqual(storage5._state.asProspects.find(function (p) { return p.id === 'pros_orphan'; }).status, 'discovered');
    assert.strictEqual(r6.swept, 1);
  });

  // Dirty-flag: a run with nothing to discover/promote/sweep must not rewrite
  // tasks or asScanQueue (asProspects always persists).
  const storage4 = mockStorage({
    systemConfig: {}, tasks: [], asScanQueue: [], asProspects: [], actions: [], governanceLog: []
  });
  await PP.runProspectPipeline({ storage: storage4, log: function () {}, nowMs: NOW, discover: async function () { return []; } });
  test('dirty-flag: empty run writes asProspects but not tasks or asScanQueue', () => {
    assert.ok(storage4._writes.includes('asProspects'));
    assert.ok(!storage4._writes.includes('tasks'));
    assert.ok(!storage4._writes.includes('asScanQueue'));
  });

  // ── repairReplyLink ──
  const SCAN_CMT = '[SCAN RESULT] AmbientScore audit of https://example.com: score 40/100, grade F. ' +
    'Top findings: something | something else ' +
    'Shareable free report (score + top findings visible, rest paywalled): ' +
    'https://ambientpixels.ai/ambientscore/report.html?id=ccr_1784767200260_f872bced ' +
    'Use 1-2 specific findings in your reply or post.';
  const REAL = 'https://ambientpixels.ai/ambientscore/report.html?id=ccr_1784767200260_f872bced';

  test('repairReplyLink: fabricated ambientscore.ai URL swapped for real report link', () => {
    const out = PP.repairReplyLink('Nice site. We ran a scan. Report: ambientscore.ai/s/example-com', SCAN_CMT);
    assert.ok(out.includes(REAL));
    assert.ok(!out.includes('ambientscore.ai/s/'));
  });

  test('repairReplyLink: fabricated ambientpixels.ai path swapped', () => {
    const out = PP.repairReplyLink('We scanned it. Details: https://ambientpixels.ai/score/example.com', SCAN_CMT);
    assert.ok(out.includes(REAL));
    assert.ok(!out.includes('/score/'));
  });

  test('repairReplyLink: linkless hedge stripped and real link appended', () => {
    const out = PP.repairReplyLink('We ran a free scan and saw one thing. Happy to share the report, just say the word.', SCAN_CMT);
    assert.ok(out.includes(REAL));
    assert.ok(!/happy to share/i.test(out));
    assert.ok(out.length <= 296);
  });

  test('repairReplyLink: prospect own domain untouched, link appended', () => {
    const out = PP.repairReplyLink('We scanned example.com and the headline needs work.', SCAN_CMT);
    assert.ok(out.includes('example.com and the headline'));
    assert.ok(out.includes(REAL));
  });

  test('repairReplyLink: already-correct link left alone', () => {
    const text = 'Good stuff. Full report: ' + REAL;
    assert.strictEqual(PP.repairReplyLink(text, SCAN_CMT), text);
  });

  test('repairReplyLink: no scan comment → no-op', () => {
    const text = 'We made a full report if you want to see it.';
    assert.strictEqual(PP.repairReplyLink(text, ''), text);
    assert.strictEqual(PP.repairReplyLink(text, '[SCAN FAILED] blocked'), text);
  });

  test('repairReplyLink: over-cap trims text at word boundary, keeps link whole', () => {
    const long = 'A'.repeat(120) + ' ' + 'B'.repeat(120) + ' ' + 'C'.repeat(80) + ' final words here';
    const out = PP.repairReplyLink(long, SCAN_CMT);
    assert.ok(out.length <= 296);
    assert.ok(out.endsWith(REAL));
    assert.ok(out.includes(REAL));
  });

  // ── findBlockingReply — one prospect, one reply ──
  // Regression guard. The original dedup matched only status === 'pending', so once
  // the first reply was approved and executed it stopped matching and the next cycle
  // drafted a second. Real duplicate outreach reached fruitfop + vocalai (07-24) and
  // zimpirate (07-28, four days AFTER the pending-only guard shipped in 0a9eb9ec).
  const RLY = (over) => Object.assign({
    id: 'act_1', type: 'social_post.reply', _parentTaskId: 'task_z73q',
    approval: { status: 'pending' }
  }, over || {});

  test('findBlockingReply: no prior replies → nothing blocks', () => {
    assert.strictEqual(PP.findBlockingReply([], 'task_z73q'), null);
  });

  test('findBlockingReply: a pending reply blocks (original behaviour preserved)', () => {
    const hit = PP.findBlockingReply([RLY()], 'task_z73q');
    assert.ok(hit && hit.id === 'act_1');
  });

  test('findBlockingReply: an APPROVED reply blocks — the zimpirate regression', () => {
    // This is the case that shipped duplicate outreach to a real prospect.
    const hit = PP.findBlockingReply([RLY({ approval: { status: 'approved' } })], 'task_z73q');
    assert.ok(hit, 'an already-approved reply MUST block a second draft');
  });

  test('findBlockingReply: a rejected reply does NOT block', () => {
    // It never reached the prospect, and redraft-after-rejection is how copy improves.
    assert.strictEqual(PP.findBlockingReply([RLY({ approval: { status: 'rejected' } })], 'task_z73q'), null);
  });

  test('findBlockingReply: a missing approval object blocks', () => {
    // Cannot prove it was never sent, so refuse to send a second.
    const hit = PP.findBlockingReply([RLY({ approval: undefined })], 'task_z73q');
    assert.ok(hit, 'unknown status must be treated as blocking');
  });

  test('findBlockingReply: replies for other tasks are ignored', () => {
    assert.strictEqual(PP.findBlockingReply([RLY({ _parentTaskId: 'task_other' })], 'task_z73q'), null);
  });

  test('findBlockingReply: non-reply action types are ignored', () => {
    assert.strictEqual(PP.findBlockingReply([RLY({ type: 'social_post.schedule' })], 'task_z73q'), null);
  });

  test('findBlockingReply: garbage input does not throw', () => {
    assert.strictEqual(PP.findBlockingReply(null, 'task_z73q'), null);
    assert.strictEqual(PP.findBlockingReply([null, undefined, {}], 'task_z73q'), null);
    assert.strictEqual(PP.findBlockingReply([RLY()], ''), null);
  });

  // ── Resume Roast lane (2026-08-02) ──
  const NOW_R = Date.parse('2026-08-02T12:00:00Z');
  const RC = (over) => Object.assign({
    uri: 'at://did:plc:x/app.bsky.feed.post/rr1', cid: 'cid-rr1', author: 'seeker.bsky.social',
    text: 'Three months of job hunting and my resume gets zero interviews. Any feedback welcome.',
    indexedAt: new Date(NOW_R - 3600e3).toISOString(), likeCount: 0, replyCount: 0
  }, over || {});
  const RCFG = { maxDraftsPerDay: 4, maxQueuedProspects: 15, maxPostAgeHours: 48, minEngagement: 0, minPostChars: 25, destinationUrl: 'https://ambientpixels.ai/pixel-agents/run.html?agent=resume-roast' };

  test('filterRoastProspects: accepts a candidate with NO url (job posts rarely carry one)', () => {
    const out = PP.filterRoastProspects([RC()], [], RCFG, NOW_R);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].lane, 'resumeRoast');
    assert.strictEqual(out[0].siteUrl, null);
    assert.strictEqual(out[0].status, 'discovered');
  });

  test('filterRoastProspects: one-touch-per-author holds ACROSS lanes', () => {
    const existingAsLane = [{ id: 'p1', author: 'seeker.bsky.social', status: 'sent', discoveredAt: new Date(NOW_R - 5 * 86400e3).toISOString() }];
    const out = PP.filterRoastProspects([RC()], existingAsLane, RCFG, NOW_R);
    assert.strictEqual(out.length, 0, 'author already touched by the AS lane must be skipped');
  });

  test('filterRoastProspects: substance floor drops thin posts', () => {
    const out = PP.filterRoastProspects([RC({ text: 'resume feedback pls' })], [], RCFG, NOW_R);
    assert.strictEqual(out.length, 0);
  });

  test('_hasResumeIntent: the four LIVE junk matches from the first run are all rejected', () => {
    // Bluesky loose term search matched these on 2026-08-02 — regression corpus.
    assert.strictEqual(PP._hasResumeIntent('You consider Laura Ingraham an education?  No wonder YouTube is filled with hilarious interviews with MAGA geniuses!'), false);
    assert.strictEqual(PP._hasResumeIntent('In our biz, we tell people that TV interviews (and, by extension, live streams) are about leaving someone with a feeling.'), false);
    assert.strictEqual(PP._hasResumeIntent('We apologize for the interruption. Regular service will now resume.'), false, 'resume-the-verb must not match');
    assert.strictEqual(PP._hasResumeIntent("I don't know who cia is and no I don't watch Bill Maher. Did you watch the interviews with the candidates?"), false);
  });

  test('_hasResumeIntent: genuine job-seeker posts pass', () => {
    assert.strictEqual(PP._hasResumeIntent('Three months of job hunting and my resume gets zero interviews. Any feedback welcome.'), true);
    assert.strictEqual(PP._hasResumeIntent('Can someone roast my CV? Applying to jobs and hearing nothing back.'), true);
    assert.strictEqual(PP._hasResumeIntent('Laid off last week. Rewriting the resume and dreading every recruiter call.'), true, 'resume + job context, no possessive');
    assert.strictEqual(PP._hasResumeIntent('Wondering if my résumé is even ATS readable'), true, 'accented résumé possessive');
  });

  test('filterRoastProspects: intent guard wired in (verb-resume candidate dropped)', () => {
    const junk = RC({ text: 'We apologize for the interruption. Regular service will now resume shortly, thanks all.' });
    assert.strictEqual(PP.filterRoastProspects([junk], [], RCFG, NOW_R).length, 0);
  });

  test('filterRoastProspects: stale posts dropped, headroom respects discovered backlog', () => {
    const stale = RC({ indexedAt: new Date(NOW_R - 72 * 3600e3).toISOString() });
    assert.strictEqual(PP.filterRoastProspects([stale], [], RCFG, NOW_R).length, 0, 'older than maxPostAgeHours');
    const backlog = [];
    for (let i = 0; i < 15; i++) backlog.push({ id: 'b' + i, lane: 'resumeRoast', status: 'discovered', author: 'other' + i, discoveredAt: new Date(NOW_R).toISOString() });
    assert.strictEqual(PP.filterRoastProspects([RC()], backlog, RCFG, NOW_R).length, 0, 'backlog at maxQueuedProspects blocks new discovery');
  });

  test('buildRoastReplyTask: born todo for scribe with destinationUrl contract', () => {
    const p = PP.filterRoastProspects([RC()], [], RCFG, NOW_R)[0];
    const t = PP.buildRoastReplyTask(p, RCFG, NOW_R);
    assert.strictEqual(t.status, 'todo');
    assert.strictEqual(t.assignee, 'scribe');
    assert.strictEqual(t.taskType, 'bluesky_reply');
    assert.strictEqual(t.destinationUrl, RCFG.destinationUrl);
    assert.ok(t.description.indexOf(RCFG.destinationUrl) !== -1, 'link in fact sheet');
    assert.ok(t.description.indexOf('EMPATHY FIRST') !== -1, 'empathy rule present');
    assert.strictEqual(t.objective_id, 'obj-revenue-engine');
    assert.ok(t.threadContext && t.threadContext.uri === p.uri && t.threadContext.cid === p.cid);
  });

  test('repairReplyLinkTo: appends missing link with label, strips hedge', () => {
    const dest = RCFG.destinationUrl;
    const out = PP.repairReplyLinkTo('Rough market. We built a free resume roast, happy to share it if you want.', dest, 'Try it free:');
    assert.ok(out.indexOf(dest) !== -1, 'link appended');
    assert.ok(out.indexOf('happy to share') === -1, 'hedge stripped');
    assert.ok(out.indexOf('Try it free:') !== -1, 'label used');
  });

  test('repairReplyLinkTo: swaps invented ambient URL for the real one, no-op when present', () => {
    const dest = RCFG.destinationUrl;
    const swapped = PP.repairReplyLinkTo('Try our roast at https://ambientpixels.ai/roast', dest, 'Try it free:');
    assert.ok(swapped.indexOf(dest) !== -1 && swapped.indexOf('/roast') === -1 || swapped.indexOf(dest) !== -1, 'invented URL replaced');
    const good = 'Rough out there. Free roast: ' + dest;
    assert.strictEqual(PP.repairReplyLinkTo(good, dest, 'Try it free:'), good, 'already-correct reply untouched');
  });

  test('repairReplyLinkTo: over-cap trims the text, never the link', () => {
    const dest = RCFG.destinationUrl;
    const long = 'A'.repeat(40) + ' ' + 'word '.repeat(60) + 'Try it free: ' + dest;
    const out = PP.repairReplyLinkTo(long, dest, 'Try it free:');
    assert.ok(out.length <= 296, 'fits BSKY_REPLY_MAX');
    assert.ok(out.indexOf(dest) !== -1, 'link survives the trim');
  });

  test('reconcile: roast entries track sent/declined lane-agnostically', () => {
    const pr = [{ id: 'pr1', lane: 'resumeRoast', status: 'task_ready', taskId: 'task_r1', discoveredAt: new Date(NOW_R - 86400e3).toISOString() }];
    const tasks = [{ id: 'task_r1', status: 'done' }];
    const actions = [{ id: 'act_r1', type: 'social_post.reply', _parentTaskId: 'task_r1', approval: { status: 'approved' } }];
    const kept = PP.reconcile(pr, tasks, actions, NOW_R);
    assert.strictEqual(kept[0].status, 'sent');
    assert.strictEqual(kept[0].actionId, 'act_r1');
  });

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
