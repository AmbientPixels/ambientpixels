// Run: node companyHeartbeat/video-desk.test.js   (from api/)
'use strict';
const assert = require('assert');
const V = require('./video-desk');
const desk = require('../studio/desk');

let passed = 0;
const pending = [];
function t(name, fn) {
  const fail = (err) => { console.error('FAIL', name, '\n ', err.message); process.exitCode = 1; };
  try {
    V._resetPending();
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => { passed++; }, fail));
    else passed++;
  } catch (err) { fail(err); }
}
const NOW = Date.parse('2026-10-20T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const KEYS = ['AmbientScore', 'ResumeRoast', 'CardForge'];

function video(over) {
  return Object.assign({
    trigger: { type: 'release', ref: 'rel_major', evidence: '' },
    product: 'AmbientScore', format: 'walkthrough', mood: 'ambient', title: 'What a free scan shows you',
    goal: 'Run a free scan on their own site', claims: [{ claim: 'Eight dimensions', source: 'product-facts:AmbientScore' }],
  }, over);
}
// A request task on the board, filed by `from` `ago` days ago, in board status `status`.
function filed(from, ago, status, trigger, comments) {
  const r = desk.cleanRequest(video({ trigger: trigger || { type: 'release', ref: 'rel_' + Math.random() } }), from);
  return Object.assign({ id: 'task-' + Math.random().toString(36).slice(2, 10), created_by: from, createdAt: daysAgo(ago), updatedAt: daysAgo(ago), comments: comments || [] },
    desk.requestTask(r), { status: status || 'todo' });
}
function data(over) {
  return Object.assign({
    tasks: [],
    releases: [
      { id: 'rel_major', at: daysAgo(2), product: 'AmbientScore', title: 'Free scans answer at once', summary: 'The report fills in as it finishes.', kind: 'feature', significance: 'major', status: 'unreviewed' },
      { id: 'rel_minor', at: daysAgo(1), product: 'ResumeRoast', title: 'Sharing fixed', kind: 'fix', significance: 'minor', status: 'confirmed' },
      { id: 'rel_old', at: daysAgo(20), product: 'CardForge', title: 'Old launch', kind: 'launch', significance: 'major', status: 'confirmed' },
      { id: 'rel_hidden', at: daysAgo(1), product: 'CardForge', title: 'Wrong', kind: 'launch', significance: 'major', status: 'hidden' },
    ],
    campaigns: [
      { id: 'camp-new', status: 'active', title: 'Roast replies', createdAt: daysAgo(3), bet: { betKey: 'community_reply|resume-roast|bluesky|any' } },
      { id: 'camp-old', status: 'active', title: 'Old', createdAt: daysAgo(30) },
      { id: 'camp-paused', status: 'paused', title: 'Paused', createdAt: daysAgo(1) },
    ],
    ledger: {
      rows: [
        { campaignId: 'camp-w', title: 'Search page', betKey: 'search_page|ambientscore|google|any', result: 'won', scoredAt: daysAgo(5), actual: { value: 12, posts: 9, days: 28 }, expected: { metric: 'qualified_uses_week', delta: 8 } },
        { campaignId: 'camp-l', title: 'Lost one', betKey: 'broadcast_post|x|bluesky|any', result: 'lost', scoredAt: daysAgo(5) },
      ],
      running: [{ campaignId: 'camp-s', title: 'Scaling', betKey: 'email|x|email|any', scaleEligible: true }],
    },
  }, over);
}

t('triggers: major/launch releases ≤14 d, won bets, scale-eligible bets, fresh active campaigns — nothing else', () => {
  const refs = V.validTriggers(data(), NOW).map((x) => x.type + ':' + x.ref).sort();
  assert.deepStrictEqual(refs, ['bet_scale:email|x|email|any', 'bet_won:search_page|ambientscore|google|any', 'campaign_launch:camp-new', 'release:rel_major']);
});
t('a trigger already used by any request on the board is gone, even a declined one', () => {
  const d = data({ tasks: [filed('scout', 1, 'canceled', { type: 'release', ref: 'rel_major' })] });
  assert.ok(!V.validTriggers(d, NOW).some((x) => x.ref === 'rel_major'));
});
t('capacity: 2 open fleet-wide; 21 days per agent, declined ones count', () => {
  const req = (tasks) => desk.requestsFrom(tasks);
  assert.strictEqual(V.capacity('echo', [], NOW).ok, true);
  assert.match(V.capacity('echo', req([filed('nova', 30, 'in-progress'), filed('scout', 25, 'todo')]), NOW).reason, /2 open/);
  const c = V.capacity('echo', req([filed('echo', 10, 'canceled')]), NOW);
  assert.strictEqual(c.ok, false);
  assert.match(c.reason, /2026-10-31/);
  assert.strictEqual(V.capacity('echo', req([filed('echo', 22, 'done')]), NOW).ok, true);
});
t('gates in order: agent, board readable, capacity, trigger, product-facts source', () => {
  assert.strictEqual(V.gateSuggestion('scribe', video(), data(), KEYS, NOW).gate, 'video_unauthorized');
  assert.strictEqual(V.gateSuggestion('echo', video(), data({ tasks: null }), KEYS, NOW).gate, 'video_desk_unavailable');
  assert.strictEqual(V.gateSuggestion('echo', video(), data({ tasks: [filed('echo', 3, 'canceled')] }), KEYS, NOW).gate, 'video_agent_cooldown');
  assert.strictEqual(V.gateSuggestion('echo', video(), data({ tasks: [filed('nova', 40, 'in-progress'), filed('scout', 40, 'todo')] }), KEYS, NOW).gate, 'video_fleet_full');
  assert.strictEqual(V.gateSuggestion('echo', video({ trigger: { type: 'release', ref: 'rel_minor' } }), data(), KEYS, NOW).gate, 'video_no_trigger');
  assert.strictEqual(V.gateSuggestion('echo', video({ trigger: { type: 'manual', ref: 'x' } }), data(), KEYS, NOW).gate, 'video_no_trigger');
  assert.strictEqual(V.gateSuggestion('echo', video({ claims: [{ claim: 'x', source: 'product-facts:Nope' }] }), data(), KEYS, NOW).gate, 'video_bad_source');
  assert.strictEqual(V.gateSuggestion('echo', video({ hook: "I'll render it myself" }), data(), KEYS, NOW).gate, 'video_request_invalid');
});
t('a passing suggestion becomes a studio-assigned video_request task carrying the trigger evidence and campaign', () => {
  const g = V.gateSuggestion('echo', video({ trigger: { type: 'bet_won', ref: 'search_page|ambientscore|google|any' } }), data(), KEYS, NOW);
  assert.strictEqual(g.ok, true, g.reason);
  assert.strictEqual(g.task.assignee, 'studio');
  assert.strictEqual(g.task.taskType, 'video_request');
  assert.strictEqual(g.task.campaign_id, 'camp-w');
  assert.match(g.request.trigger.evidence, /12 .* against 8 expected/);
});
t('a request filed this cycle counts at once, before the heartbeat applies the create', () => {
  const g = V.gateSuggestion('nova', video({ trigger: { type: 'campaign_launch', ref: 'camp-new' } }), data(), KEYS, NOW);
  V.noteFiled(g.request, Date.now());
  const g2 = V.gateSuggestion('scout', video({ trigger: { type: 'campaign_launch', ref: 'camp-new' } }), data(), KEYS, NOW);
  assert.strictEqual(g2.gate, 'video_no_trigger'); // same trigger, already used
  const g3 = V.gateSuggestion('scout', video({ trigger: { type: 'release', ref: 'rel_major' } }), data({ tasks: [filed('echo', 40, 'in-progress')] }), KEYS, NOW);
  assert.strictEqual(g3.gate, 'video_fleet_full'); // 1 on the board + 1 pending
});
t('block: empty when nothing to see or do; triggers + contract when allowed; status + decline reason after', () => {
  assert.strictEqual(V.buildVideoDeskBlock('scribe', 'Scribe', data(), NOW), '');
  assert.strictEqual(V.buildVideoDeskBlock('echo', 'Echo', data({ releases: [], campaigns: [], ledger: null }), NOW), '');
  const b = V.buildVideoDeskBlock('echo', 'Echo', data(), NOW);
  assert.match(b, /VIDEO DEPARTMENT/);
  assert.match(b, /type=release ref=rel_major/);
  assert.match(b, /"type":"suggest-video"/);
  assert.ok(b.length < 2700, 'block is ' + b.length + ' chars');
  const d = data({ tasks: [filed('echo', 5, 'canceled', null, [{ text: 'not the right moment', agentId: null, timestamp: daysAgo(4) }])] });
  const after = V.buildVideoDeskBlock('echo', 'Echo', d, NOW);
  assert.match(after, /declined — Chad: "not the right moment"/);
  assert.match(after, /No new suggestions now: your next suggestion is allowed from/);
  assert.doesNotMatch(after, /"type":"suggest-video"/);
});
t('the department\'s @mention reaches any agent, until that agent answers in the thread', () => {
  const task = filed('echo', 2, 'in-progress', null, [
    { author: 'studio', text: '[studio:scripting video=04-scan] On the Board. @Quill please check the 1 claim in this request.', createdAt: daysAgo(1) },
  ]);
  const d = data({ tasks: [task], releases: [], campaigns: [], ledger: null });
  const b = V.buildVideoDeskBlock('quill', 'Quill', d, NOW);
  assert.match(b, new RegExp('task ' + task.id));
  assert.match(b, /@Quill please check/);
  assert.match(b, /"type":"comment-task"/);
  assert.strictEqual(V.buildVideoDeskBlock('scout', 'Scout', d, NOW), '');
  task.comments.push({ author: 'quill', text: 'The claim checks out.', createdAt: daysAgo(0.5) });
  assert.strictEqual(V.buildVideoDeskBlock('quill', 'Quill', d, NOW), '');
  const old = filed('echo', 9, 'in-progress', null, [{ author: 'studio', text: '@Quill old ask', createdAt: daysAgo(5) }]);
  assert.strictEqual(V.asksFor('quill', 'Quill', desk.requestsFrom([old]), NOW).length, 0); // older than 72 h
});
t('the heartbeat creates the task as the department\'s (assignee stays studio, not Nova) and it parses back', () => {
  const { applyTaskUpdate } = require('./task-mutations');
  const g = V.gateSuggestion('echo', video(), data(), KEYS, NOW);
  const tasks = [];
  applyTaskUpdate(tasks, { action: 'create', task: g.task }, [], 'echo');
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(tasks[0].assignee, 'studio');
  assert.strictEqual(tasks[0].created_by, 'echo');
  const r = desk.parseRequest(tasks[0]);
  assert.strictEqual(r.status, 'waiting');
  assert.strictEqual(r.from, 'echo');
  assert.strictEqual(r.title, 'What a free scan shows you');
  applyTaskUpdate(tasks, { action: 'create', task: { title: 'x', assignee: 'mallory' } }, [], 'echo');
  assert.strictEqual(tasks[1].assignee, 'nova'); // unknown assignees still fall back to Nova
});
t('releases block: live, not hidden, newest first, ≤6, empty when none', () => {
  const b = V.buildReleasesBlock(data().releases, NOW);
  assert.match(b, /AmbientScore: Free scans answer at once \[major\]/);
  assert.doesNotMatch(b, /Wrong|Old launch/);
  assert.strictEqual(V.buildReleasesBlock([], NOW), '');
});

t('triage block: Pixel sees untriaged waiting requests only, others never see it', () => {
  const fresh = filed('nova', 1, 'todo');
  const done = filed('echo', 1, 'todo', null, [{ author: 'pixel', text: 'RECOMMEND: decline. Posts would do.' }]);
  const accepted = filed('scout', 1, 'in-progress');
  const d = data({ tasks: [fresh, done, accepted] });
  assert.deepStrictEqual(V.untriaged(d.tasks, 'pixel').map((r) => r.taskId), [fresh.id]);
  const b = V.buildVideoDeskBlock('pixel', 'Pixel', d, NOW);
  assert.match(b, /VIDEO TRIAGE/);
  assert.ok(b.indexOf(fresh.id) !== -1 && b.indexOf(done.id) === -1 && b.indexOf(accepted.id) === -1);
  assert.match(b, /RECOMMEND: accept\|decline/);
  assert.doesNotMatch(b, /suggest-video/);
  assert.strictEqual(V.buildVideoDeskBlock('pixel', 'Pixel', data({ tasks: [done, accepted] }), NOW), '');
  assert.doesNotMatch(V.buildVideoDeskBlock('nova', 'Nova', d, NOW), /VIDEO TRIAGE/);
});

Promise.all(pending).then(() => console.log(`video-desk: ${passed} passed${process.exitCode ? ', FAILURES above' : ''}`));
