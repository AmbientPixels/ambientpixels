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

// ── reconcile ──
test('task done + reply action → sent (actionId stamped)', () => {
  const p = queuedProspect({ status: 'task_ready' });
  const tasks = [{ id: 'task_1', status: 'done' }];
  const actions = [{ id: 'act_9', type: 'social_post.reply', _parentTaskId: 'task_1' }];
  PP.reconcile([p], tasks, actions, NOW);
  assert.strictEqual(p.status, 'sent');
  assert.strictEqual(p.actionId, 'act_9');
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

// ── runProspectPipeline (integration, mocked IO) ──
function mockStorage(initial) {
  const state = Object.assign({}, initial);
  return {
    _state: state,
    getState: async function (k) { return state[k] !== undefined ? state[k] : null; },
    setState: async function (k, v) { state[k] = v; }
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

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
