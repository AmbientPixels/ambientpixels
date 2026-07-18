// milestone-herald.test.js — unit tests for the milestone → social-task generator.
// Run: node api/companyHeartbeat/milestone-herald.test.js

const assert = require('assert');
const H = require('./milestone-herald');

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      r.then(() => { console.log('  PASS ', name); pass++; })
        .catch(e => { console.log('  FAIL ', name, '\n        ', e.message); fail++; });
    } else { console.log('  PASS ', name); pass++; }
  } catch (e) { console.log('  FAIL ', name, '\n        ', e.message); fail++; }
}

const NOW = Date.parse('2026-07-18T16:00:00Z');
const DAY = 86400000;

function ledgerEntry(over) {
  return Object.assign({
    xp: 78, level: 2, rank: 'Rookie', class: 'Artisan the Workhorse',
    renown: 12, streakDays: 3,
    achievements: [{ id: 'first_assist', label: 'First Assist', tier: 'bronze', at: new Date(NOW - 30 * DAY).toISOString() }],
    recent: [
      { at: new Date(NOW - 2 * DAY).toISOString(), type: 'blog_ship', xp: 6, reason: 'Blog shipped: test post' },
      { at: new Date(NOW - 1 * DAY).toISOString(), type: 'task_done', xp: 1, reason: 'Task done: review' }
    ]
  }, over);
}

function freshState() { return { watermarks: {}, postLog: [] }; }

function wmFor(entry, over) {
  return Object.assign({
    level: entry.level, rank: entry.rank,
    achievementIds: entry.achievements.map(a => a.id),
    streakMax: entry.streakDays, lastPostAt: null
  }, over);
}

// ── detection ────────────────────────────────────────────────────

test('first sight of an agent seeds the watermark without firing', () => {
  const rewards = { perAgent: { pixel: ledgerEntry() } };
  const out = H.detectMilestones({ rewards, heraldState: freshState(), config: H.DEFAULTS, nowMs: NOW });
  assert.strictEqual(out.candidates.length, 0);
  assert.deepStrictEqual(out.seededAgents, ['pixel']);
  assert.strictEqual(out.nextWatermarks.pixel.level, 2);
  assert.deepStrictEqual(out.nextWatermarks.pixel.achievementIds, ['first_assist']);
});

test('level-up past the watermark fires a level_up milestone', () => {
  const entry = ledgerEntry({ level: 3 });
  const state = { watermarks: { pixel: wmFor(ledgerEntry()) }, postLog: [] };
  const out = H.detectMilestones({ rewards: { perAgent: { pixel: entry } }, heraldState: state, config: H.DEFAULTS, nowMs: NOW });
  assert.strictEqual(out.candidates.length, 1);
  assert.strictEqual(out.candidates[0].kind, 'level_up');
  assert.strictEqual(out.candidates[0].agentId, 'pixel');
  assert.strictEqual(out.nextWatermarks.pixel.level, 3);
});

test('new achievement fires; already-seen ids never re-fire', () => {
  const entry = ledgerEntry();
  entry.achievements = entry.achievements.concat([{ id: 'streak_7', label: '7-Day Streak', tier: 'silver', at: new Date(NOW - 1000).toISOString() }]);
  const state = { watermarks: { pixel: wmFor(ledgerEntry()) }, postLog: [] };
  const out = H.detectMilestones({ rewards: { perAgent: { pixel: entry } }, heraldState: state, config: H.DEFAULTS, nowMs: NOW });
  assert.strictEqual(out.candidates.length, 1);
  assert.strictEqual(out.candidates[0].kind, 'achievement');
  assert.strictEqual(out.candidates[0].detail.id, 'streak_7');
  assert(out.nextWatermarks.pixel.achievementIds.indexOf('streak_7') !== -1);
});

test('streak crossing a threshold fires once (streakMax watermark)', () => {
  const entry = ledgerEntry({ streakDays: 7 });
  const state = { watermarks: { pixel: wmFor(ledgerEntry()) }, postLog: [] };
  const out = H.detectMilestones({ rewards: { perAgent: { pixel: entry } }, heraldState: state, config: H.DEFAULTS, nowMs: NOW });
  assert.strictEqual(out.candidates.length, 1);
  assert.strictEqual(out.candidates[0].kind, 'streak');
  assert.strictEqual(out.candidates[0].detail.threshold, 7);
  // same streak next day does not re-fire
  const state2 = { watermarks: { pixel: out.nextWatermarks.pixel }, postLog: [] };
  const out2 = H.detectMilestones({ rewards: { perAgent: { pixel: entry } }, heraldState: state2, config: H.DEFAULTS, nowMs: NOW + DAY });
  assert.strictEqual(out2.candidates.filter(c => c.kind === 'streak').length, 0);
});

test('rank promotion outranks level-up for the same agent', () => {
  const entry = ledgerEntry({ level: 10, rank: 'Operator' });
  const state = { watermarks: { pixel: wmFor(ledgerEntry()) }, postLog: [] };
  const out = H.detectMilestones({ rewards: { perAgent: { pixel: entry } }, heraldState: state, config: H.DEFAULTS, nowMs: NOW });
  assert.strictEqual(out.candidates.length, 1);
  assert.strictEqual(out.candidates[0].kind, 'rank_up');
});

test('notable week fires only with weeklyXp >= floor and nothing better', () => {
  const quiet = ledgerEntry({ recent: [{ at: new Date(NOW - DAY).toISOString(), type: 'task_done', xp: 2, reason: 'small' }] });
  const busy = ledgerEntry({ recent: [
    { at: new Date(NOW - 2 * DAY).toISOString(), type: 'blog_ship', xp: 6, reason: 'a' },
    { at: new Date(NOW - DAY).toISOString(), type: 'proposal_approved', xp: 8, reason: 'b' }
  ] });
  const state = { watermarks: { pixel: wmFor(ledgerEntry()), forge: wmFor(ledgerEntry()) }, postLog: [] };
  const out = H.detectMilestones({ rewards: { perAgent: { pixel: quiet, forge: busy } }, heraldState: state, config: H.DEFAULTS, nowMs: NOW });
  assert.strictEqual(out.candidates.length, 1);
  assert.strictEqual(out.candidates[0].agentId, 'forge');
  assert.strictEqual(out.candidates[0].kind, 'notable_week');
});

// ── caps ─────────────────────────────────────────────────────────

test('per-agent 7d cap blocks an agent that posted recently', () => {
  const cand = [{ agentId: 'pixel', kind: 'level_up', priority: 2, detail: {} }];
  const state = { watermarks: { pixel: wmFor(ledgerEntry(), { lastPostAt: new Date(NOW - 2 * DAY).toISOString() }) }, postLog: [] };
  const fired = H.applyCaps(cand, state, H.DEFAULTS, NOW);
  assert.strictEqual(fired.length, 0);
});

test('fleet weekly cap keeps highest-priority milestones', () => {
  const cand = [
    { agentId: 'a', kind: 'notable_week', priority: 5, detail: {} },
    { agentId: 'b', kind: 'level_up', priority: 2, detail: {} },
    { agentId: 'c', kind: 'achievement', priority: 3, detail: {} },
    { agentId: 'd', kind: 'streak', priority: 4, detail: {} }
  ];
  const state = { watermarks: {}, postLog: [{ agentId: 'z', at: new Date(NOW - DAY).toISOString() }] };
  const fired = H.applyCaps(cand, state, Object.assign({}, H.DEFAULTS, { fleetWeeklyCap: 3 }), NOW);
  assert.strictEqual(fired.length, 2); // 3 slots - 1 used = 2
  assert.deepStrictEqual(fired.map(f => f.agentId), ['b', 'c']);
});

test('non-fleet ledger entries (ceo) are ignored entirely', () => {
  const rewards = { perAgent: { ceo: ledgerEntry({ level: 5 }), pixel: ledgerEntry() } };
  const out = H.detectMilestones({ rewards, heraldState: freshState(), config: H.DEFAULTS, nowMs: NOW });
  assert.deepStrictEqual(out.seededAgents, ['pixel']);
  assert.strictEqual(out.nextWatermarks.ceo, undefined);
});

test('agents allowlist restricts detection', () => {
  const entry = ledgerEntry({ level: 3 });
  const state = { watermarks: { pixel: wmFor(ledgerEntry()) }, postLog: [] };
  const cfg = Object.assign({}, H.DEFAULTS, { agents: ['forge'] });
  const out = H.detectMilestones({ rewards: { perAgent: { pixel: entry } }, heraldState: state, config: cfg, nowMs: NOW });
  assert.strictEqual(out.candidates.length, 0);
});

// ── task building ────────────────────────────────────────────────

test('task carries campaign, objective, echo assignee, url + verbatim quote', () => {
  const m = { agentId: 'pixel', kind: 'level_up', priority: 2, detail: { level: 3, prevLevel: 2 } };
  const entry = ledgerEntry({ level: 3 });
  const tasks = H.buildTasks(m, entry, '"I have been running on pure instinct."', H.DEFAULTS, NOW);
  assert.strictEqual(tasks.length, 1); // default platforms = bluesky only
  const t = tasks[0];
  assert.strictEqual(t.taskType, 'social_bluesky');
  assert.strictEqual(t.assignee, 'echo');
  assert.strictEqual(t.campaign_id, H.CAMPAIGN_ID);
  assert.strictEqual(t.objective_id, H.OBJECTIVE_ID);
  assert.strictEqual(t.status, 'todo');
  assert(t.description.indexOf('https://ambientpixels.ai/ambientos/agents/pixel') !== -1, 'profile url missing');
  assert(t.description.indexOf('pure instinct') !== -1, 'quote missing');
  assert(t.description.indexOf('LEVEL UP') !== -1, 'milestone missing');
  assert(t.description.indexOf('do not invent') !== -1, 'grounding instruction missing');
  assert.strictEqual(t.source.type, 'milestone_herald');
});

test('two platforms produce two tasks for one milestone', () => {
  const m = { agentId: 'forge', kind: 'achievement', priority: 3, detail: { id: 'x', label: 'First CEO Yes', tier: 'bronze' } };
  const cfg = Object.assign({}, H.DEFAULTS, { platforms: ['social_bluesky', 'social_x'] });
  const tasks = H.buildTasks(m, ledgerEntry(), null, cfg, NOW);
  assert.strictEqual(tasks.length, 2);
  assert.deepStrictEqual(tasks.map(t => t.taskType).sort(), ['social_bluesky', 'social_x']);
});

test('reflection quote picker skips junk and noise sources', () => {
  const mems = [
    { text: 'A real thought about deploys.', source: 'auto:reflection', timestamp: new Date(NOW - 3 * DAY).toISOString() },
    { text: 'string', source: 'auto:reflection', timestamp: new Date(NOW - DAY).toISOString() },
    { text: 'noise', source: 'auto:rate-limit', timestamp: new Date(NOW).toISOString() }
  ];
  assert.strictEqual(H.pickReflectionQuote(mems), 'A real thought about deploys.');
  assert.strictEqual(H.pickReflectionQuote([]), null);
});

// ── runner ───────────────────────────────────────────────────────

function mockStorage(seed) {
  const store = Object.assign({}, seed);
  const writes = [];
  return {
    store, writes,
    getState: async k => (k in store ? store[k] : null),
    setState: async (k, v) => { store[k] = v; writes.push(k); }
  };
}

function runnerSeed(over) {
  return Object.assign({
    systemConfig: { milestoneHerald: { enabled: true } },
    agentRewards: { perAgent: { pixel: ledgerEntry({ level: 3 }) } },
    milestoneHeraldState: { watermarks: { pixel: wmFor(ledgerEntry()) }, postLog: [] },
    agentMemories: { pixel: [{ text: 'A real memory.', source: 'auto:reflection', timestamp: new Date(NOW - DAY).toISOString() }] },
    campaigns: [{ id: H.CAMPAIGN_ID, status: 'active' }],
    tasks: []
  }, over);
}

async function run(storage, dryRun) {
  return H.runMilestoneHerald({ storage, nowMs: NOW, log: () => {}, dryRun: !!dryRun });
}

test('runner disabled via systemConfig writes nothing', async () => {
  const s = mockStorage(runnerSeed({ systemConfig: { milestoneHerald: { enabled: false } } }));
  const res = await run(s);
  assert.strictEqual(res.enabled, false);
  assert.strictEqual(s.writes.length, 0);
});

test('runner fires level-up: creates task + updates herald state', async () => {
  const s = mockStorage(runnerSeed());
  const res = await run(s);
  assert.strictEqual(res.tasksCreated, 1);
  assert.strictEqual(s.store.tasks.length, 1);
  assert.strictEqual(s.store.tasks[0].taskType, 'social_bluesky');
  assert.strictEqual(s.store.milestoneHeraldState.watermarks.pixel.level, 3);
  assert(s.store.milestoneHeraldState.watermarks.pixel.lastPostAt, 'lastPostAt not stamped');
  assert.strictEqual(s.store.milestoneHeraldState.postLog.length, 1);
});

test('runner dryRun reports fired milestones but writes nothing', async () => {
  const s = mockStorage(runnerSeed());
  const res = await run(s, true);
  assert.strictEqual(res.dryRun, true);
  assert.strictEqual(res.fired.length, 1);
  assert.strictEqual(res.tasksCreated, 0);
  assert.strictEqual(s.writes.length, 0);
});

test('runner skips when campaign is missing or inactive', async () => {
  const s = mockStorage(runnerSeed({ campaigns: [] }));
  const res = await run(s);
  assert.strictEqual(res.skipped, 'campaign_missing');
  assert.strictEqual(s.store.tasks.length, 0);
});

test('runner with quiet ledger writes only watermark seed, no tasks', async () => {
  const s = mockStorage(runnerSeed({ milestoneHeraldState: null }));
  const res = await run(s);
  assert.strictEqual(res.tasksCreated, 0);
  assert.deepStrictEqual(res.seeded, ['pixel']);
  assert(s.store.milestoneHeraldState, 'watermarks should be seeded');
  assert.strictEqual(s.store.tasks.length, 0);
});

// async tests resolve after the sync loop — settle before the summary line
setTimeout(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}, 500);
