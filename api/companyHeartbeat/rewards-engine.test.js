// Run with: node api/companyHeartbeat/rewards-engine.test.js
// Pure-function tests for the agent XP/reward engine (Stage 1).
const assert = require('assert');
const {
  levelFromXp, rankFromLevel, classFor,
  applyEvents, applyCompany, extractEvents, buildProgressionPromptBlock,
  resolveContributors, conversionFallbackAgents
} = require('./rewards-engine');

const DAY = 86400000;
const NOW = Date.UTC(2026, 5, 20, 12, 0, 0);
const at = (dayOffset, h) => new Date(NOW + dayOffset * DAY + (h || 0) * 3600000).toISOString();

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const agent = (r, id) => r.perAgent[id];

// ── helpers ──
test('levelFromXp boundaries', () => {
  assert.strictEqual(levelFromXp(0), 1);
  assert.strictEqual(levelFromXp(74), 1);
  assert.strictEqual(levelFromXp(75), 2);   // L1->2 costs 50+25 = 75
  assert.strictEqual(levelFromXp(300), 4);  // cumulative L4
});

test('rankFromLevel bands', () => {
  assert.strictEqual(rankFromLevel(1), 'Rookie');
  assert.strictEqual(rankFromLevel(9), 'Rookie');
  assert.strictEqual(rankFromLevel(10), 'Operator');
  assert.strictEqual(rankFromLevel(25), 'Veteran');
  assert.strictEqual(rankFromLevel(40), 'Elite');
  assert.strictEqual(rankFromLevel(50), 'Legend');
});

test('classFor returns role archetype with no specialization on a fresh agent', () => {
  assert.strictEqual(classFor('scout', { recent: [] }), 'Pathfinder');
  assert.strictEqual(classFor('nova', { recent: [] }), 'Orchestrator');
});

// ── applyEvents: single award ──
test('a completed task awards 1 XP and ticks the counter', () => {
  const { rewards } = applyEvents([{ id: 'task_1', type: 'task_done', agentId: 'scribe', at: at(0) }], null, NOW);
  assert.strictEqual(agent(rewards, 'scribe').xp, 1);
  assert.strictEqual(agent(rewards, 'scribe').counters.tasksDone, 1);
});

test('an approved proposal awards 8 XP and unlocks first_approval (renown, not XP)', () => {
  const { rewards } = applyEvents([{ id: 'appr_1', type: 'proposal_approved', agentId: 'nova', at: at(0) }], null, NOW);
  const a = agent(rewards, 'nova');
  assert.strictEqual(a.xp, 8);
  assert.ok(a.achievements.some(x => x.id === 'first_approval'), 'first_approval unlocked');
  assert.ok(a.renown >= 10, 'achievement granted renown');
});

// ── applyEvents: daily soft cap → overflow to Renown ──
test('XP above the daily soft cap converts to Renown instead of being lost', () => {
  const { rewards } = applyEvents([
    { id: 'appr_1', type: 'proposal_approved', agentId: 'nova', at: at(0, 1) },
    { id: 'appr_2', type: 'proposal_approved', agentId: 'nova', at: at(0, 2) }
  ], null, NOW);
  const a = agent(rewards, 'nova');
  assert.strictEqual(a.xp, 12, 'XP capped at 12/day');
  assert.ok(a.renown >= 2, 'overflow (8+8-12=4 -> >=2 renown) plus achievement renown');
});

// ── applyEvents: streak across consecutive days ──
test('streak increments on consecutive UTC days and resets on a gap', () => {
  const evs = [
    { id: 't1', type: 'task_done', agentId: 'forge', at: at(0) },
    { id: 't2', type: 'task_done', agentId: 'forge', at: at(1) },
    { id: 't3', type: 'task_done', agentId: 'forge', at: at(2) }
  ];
  let { rewards } = applyEvents(evs, null, NOW);
  assert.strictEqual(agent(rewards, 'forge').streakDays, 3);
  // a 2-day gap resets to 1
  ({ rewards } = applyEvents([{ id: 't4', type: 'task_done', agentId: 'forge', at: at(5) }], rewards, NOW));
  assert.strictEqual(agent(rewards, 'forge').streakDays, 1);
});

// ── applyEvents: per-event dedup ──
test('the same event id is never counted twice', () => {
  const e = { id: 'appr_dup', type: 'proposal_approved', agentId: 'echo', at: at(0) };
  let { rewards } = applyEvents([e], null, NOW);
  const before = agent(rewards, 'echo').xp;
  ({ rewards } = applyEvents([e], rewards, NOW));
  assert.strictEqual(agent(rewards, 'echo').xp, before, 'dedup by id');
});

// ── applyEvents: assist cap per pair/week ──
test('assists are capped at 2 per (from->to) pair per 7 days', () => {
  const mk = (n, d) => ({ id: 'as_' + n, type: 'assist', agentId: 'scout', at: at(d), meta: { beneficiary: 'cipher' } });
  const { rewards } = applyEvents([mk(1, 0), mk(2, 0), mk(3, 1)], null, NOW);
  assert.strictEqual(agent(rewards, 'scout').counters.assists, 2, 'third assist for same pair within a week is blocked');
});

// ── applyEvents: achievement dedup ──
test('an achievement only unlocks once', () => {
  let { rewards } = applyEvents([{ id: 'a1', type: 'proposal_approved', agentId: 'pixel', at: at(0) }], null, NOW);
  ({ rewards } = applyEvents([{ id: 'a2', type: 'proposal_approved', agentId: 'pixel', at: at(1) }], rewards, NOW));
  const firsts = agent(rewards, 'pixel').achievements.filter(x => x.id === 'first_approval');
  assert.strictEqual(firsts.length, 1, 'first_approval recorded once');
});

// ── applyEvents: empty / no-op ──
test('no events is a no-op', () => {
  const { rewards, newAwards } = applyEvents([], null, NOW);
  assert.deepStrictEqual(newAwards, []);
  assert.ok(rewards && rewards.perAgent && typeof rewards.perAgent === 'object');
});

// ── applyCompany: follower growth + company achievement ──
test('company follower growth drips Renown to content agents and ticks the counter', () => {
  let base = applyEvents([], null, NOW).rewards;
  base.company.lastFollowerTotal = 100;
  const rewards = applyCompany(base, { followerTotal: 120, revenueCents: 0, blogViews: 0 }, NOW);
  assert.strictEqual(rewards.company.counters.followers, 20, 'delta counted');
  assert.ok(agent(rewards, 'echo').renown > 0 && agent(rewards, 'scribe').renown > 0, 'content agents get the drip');
});

test('first-follower-baseline run does not retro-award (lastFollowerTotal seeds, no delta)', () => {
  let base = applyEvents([], null, NOW).rewards; // lastFollowerTotal null
  const rewards = applyCompany(base, { followerTotal: 500, revenueCents: 0, blogViews: 0 }, NOW);
  assert.strictEqual(rewards.company.counters.followers, 0, 'no retro award on first sighting');
  assert.strictEqual(rewards.company.lastFollowerTotal, 500, 'baseline seeded');
});

// ── extractEvents: sources → normalized events with stable ids ──
test('extractEvents maps approved proposals, blogs, snapshots, tasks', () => {
  const state = {
    approvalQueue: [
      { id: 'p1', type: 'campaign_proposal', status: 'approved', proposedBy: 'nova', createdAt: at(0) },
      { id: 'p2', type: 'campaign_proposal', status: 'pending', proposedBy: 'nova', createdAt: at(0) }
    ],
    blogPosts: [{ id: 'b1', author: 'scribe', publishedAt: at(0) }],
    outcomeSnapshots: { act1: { createdBy: 'echo', publishedAt: at(0), complete: true, samples: [{ lag: 't7', likes: 40, comments: 5, reposts: 5 }] } },
    tasks: [{ id: 'tk1', status: 'done', assignee: 'quill', completedAt: at(0) }],
    tasksArchive: []
  };
  const ids = extractEvents(state, null).map(e => e.id);
  assert.ok(ids.includes('appr_p1'), 'approved proposal');
  assert.ok(!ids.includes('appr_p2'), 'pending proposal excluded');
  assert.ok(ids.includes('blog_b1'), 'blog ship');
  assert.ok(ids.includes('ship_act1'), 'social ship');
  assert.ok(ids.includes('eng_act1'), 'engagement');
  assert.ok(ids.includes('task_tk1'), 'task done');
});

test('extractEvents credits an assist when a child task was done by a different agent', () => {
  const state = {
    approvalQueue: [], blogPosts: [], outcomeSnapshots: {},
    tasks: [
      { id: 'parent', status: 'done', assignee: 'cipher', completedAt: at(0) },
      { id: 'child', status: 'done', assignee: 'scout', parent_task_id: 'parent', completedAt: at(0) }
    ],
    tasksArchive: []
  };
  const ev = extractEvents(state, null).find(e => e.type === 'assist');
  assert.ok(ev, 'assist event produced');
  assert.strictEqual(ev.agentId, 'scout', 'contributor credited');
  assert.strictEqual(ev.meta.beneficiary, 'cipher', 'beneficiary recorded');
});

test('extractEvents credits the reviewer of a landed task (review_done)', () => {
  const state = {
    approvalQueue: [], blogPosts: [], outcomeSnapshots: {},
    tasks: [
      { id: 'tk1', status: 'done', assignee: 'scribe', reviewer: 'quill', reviewedAt: at(0), completedAt: at(0) },
      { id: 'tk2', status: 'done', assignee: 'scribe', completedAt: at(0) },                       // no reviewer
      { id: 'tk3', status: 'todo', assignee: 'scribe', reviewer: 'quill', reviewedAt: at(0) },     // not landed
      { id: 'tk4', status: 'done', assignee: 'quill', reviewer: 'quill', reviewedAt: at(0) },      // self-review
      { id: 'tk5', status: 'done', assignee: 'scribe', reviewer: 'quill', completedAt: at(0) }     // never reviewed
    ],
    tasksArchive: []
  };
  const revs = extractEvents(state, null).filter(e => e.type === 'review_done');
  assert.strictEqual(revs.length, 1, 'only the landed, other-reviewed task counts');
  assert.strictEqual(revs[0].id, 'rev_tk1');
  assert.strictEqual(revs[0].agentId, 'quill');
});

test('a landed review awards 1 XP and ticks the reviews counter', () => {
  const { rewards } = applyEvents([{ id: 'rev_tk1', type: 'review_done', agentId: 'quill', at: at(0) }], null, NOW);
  assert.strictEqual(agent(rewards, 'quill').xp, 1);
  assert.strictEqual(agent(rewards, 'quill').counters.reviews, 1);
});

// ── buildProgressionPromptBlock (Stage 5: the prompt nudge) ──
test('progression block renders level, next-level, fleet rank, and outcome-only reminder', () => {
  const rewards = { perAgent: {
    scribe: { xp: 120, level: 2, rank: 'Rookie', class: 'Scribe the Author', renown: 21, streakDays: 3, achievements: [{ label: 'First Blog Shipped', tier: 'bronze' }] },
    nova:   { xp: 16, level: 1, rank: 'Rookie', class: 'Orchestrator', renown: 10, streakDays: 2, achievements: [] }
  } };
  const block = buildProgressionPromptBlock('nova', rewards);
  assert.ok(block.indexOf('YOUR PROGRESSION') !== -1, 'header');
  assert.ok(block.indexOf('Level 1') !== -1, 'shows level');
  assert.ok(block.indexOf('to Level 2') !== -1, 'shows next level');
  assert.ok(/#2 of 2/.test(block), 'shows fleet rank');
  assert.ok(block.indexOf('Scribe') !== -1, 'names the leader');
  assert.ok(/only from outcomes/i.test(block), 'reinforces outcome-only earning');
});

test('progression block: leader gets a lead message; empty for unknown/no data', () => {
  const rewards = { perAgent: { scribe: { xp: 120, level: 2, rank: 'Rookie' }, nova: { xp: 16, level: 1, rank: 'Rookie' } } };
  assert.ok(/lead the fleet/i.test(buildProgressionPromptBlock('scribe', rewards)), 'leader message');
  assert.strictEqual(buildProgressionPromptBlock('ghost', rewards), '', 'unknown agent -> empty');
  assert.strictEqual(buildProgressionPromptBlock('nova', null), '', 'no rewards -> empty');
});

// ── Task 1: attribution resolver ──
test('resolveContributors walks action -> task -> reviewer and dedups to fleet agents', () => {
  const ctx = {
    actionsById: { act_1: { id: 'act_1', created_by: 'scribe', _parentTaskId: 'tk1' } },
    attributionIndex: {},
    tasksById: { tk1: { id: 'tk1', assignee: 'echo', reviewer: 'quill', campaign_id: 'camp-x' } }
  };
  assert.deepStrictEqual(resolveContributors('act_1', ctx), ['scribe', 'echo', 'quill']);
});

test('resolveContributors falls back to actionAttributionIndex for trimmed actions', () => {
  const ctx = {
    actionsById: {},
    attributionIndex: { act_old: { agent: 'echo', campaignId: 'camp-x', at: '2026-07-01T00:00:00Z' } },
    tasksById: {}
  };
  assert.deepStrictEqual(resolveContributors('act_old', ctx), ['echo']);
});

test('resolveContributors filters system/ceo/unknown and returns [] on no match', () => {
  const ctx = {
    actionsById: { act_2: { id: 'act_2', created_by: 'system', _parentTaskId: 'tk2' } },
    attributionIndex: {},
    tasksById: { tk2: { id: 'tk2', assignee: 'ceo' } }
  };
  assert.deepStrictEqual(resolveContributors('act_2', ctx), []);
  assert.deepStrictEqual(resolveContributors('missing', ctx), []);
  assert.deepStrictEqual(resolveContributors(null, ctx), []);
});

test('conversionFallbackAgents = assignees of recent tasks on active conversion campaigns', () => {
  const state = {
    campaigns: [
      { id: 'camp-conv', status: 'active', northStarMetric: 'paying customers' },
      { id: 'camp-paused', status: 'paused', northStarMetric: 'revenue' },
      { id: 'camp-brand', status: 'active', northStarMetric: 'bluesky followers' }
    ],
    tasks: [
      { id: 't1', campaign_id: 'camp-conv', assignee: 'echo', updatedAt: at(-3) },
      { id: 't2', campaign_id: 'camp-conv', assignee: 'scribe', updatedAt: at(-40) },  // stale >30d
      { id: 't3', campaign_id: 'camp-paused', assignee: 'pixel', updatedAt: at(-3) },  // paused campaign
      { id: 't4', campaign_id: 'camp-brand', assignee: 'scout', updatedAt: at(-3) }    // not conversion
    ],
    tasksArchive: []
  };
  assert.deepStrictEqual(conversionFallbackAgents(state, NOW), ['echo']);
});

// ── Task 2: revenue-lane extraction ──
const REV_STATE = () => ({
  approvalQueue: [], blogPosts: [], outcomeSnapshots: {}, tasksArchive: [],
  _nowMs: NOW, // extractEvents has no nowMs param; fallback attribution reads state._nowMs
  tasks: [{ id: 'tk1', assignee: 'echo', reviewer: 'quill', campaign_id: 'camp-conv', updatedAt: at(-1) }],
  campaigns: [{ id: 'camp-conv', status: 'active', northStarMetric: 'paying customers' }],
  actionsById: { act_1: { id: 'act_1', created_by: 'scribe', _parentTaskId: 'tk1' } },
  attributionIndex: {},
  revenueLedgerEntries: [], asLeads: [], scans: []
});

test('an attributed sale splits 100 + $-XP across the causal chain, floor 1 each', () => {
  const s = REV_STATE();
  s.revenueLedgerEntries = [{ id: 'evt_1', type: 'one_time', amountCents: 2900, utmContent: 'act_1', occurredAt: at(0) }];
  const evs = extractEvents(s, null).filter(e => e.type === 'revenue_sale');
  // total = 100 + 29 = 129, 3 contributors (scribe, echo, quill) -> 43 each
  assert.strictEqual(evs.length, 3);
  assert.ok(evs.every(e => e.xpOverride === 43));
  const ids = evs.map(e => e.id).sort();
  assert.deepStrictEqual(ids, ['sale_evt_1__echo', 'sale_evt_1__quill', 'sale_evt_1__scribe']);
});

test('refunds, disputes and cancellations emit no sale events', () => {
  const s = REV_STATE();
  s.revenueLedgerEntries = [
    { id: 'evt_r', type: 'refund', amountCents: -2900, utmContent: 'act_1', occurredAt: at(0) },
    { id: 'evt_d', type: 'dispute', amountCents: -2900, occurredAt: at(0) },
    { id: 'evt_c', type: 'subscription_canceled', amountCents: 0, occurredAt: at(0) }
  ];
  assert.strictEqual(extractEvents(s, null).filter(e => e.type === 'revenue_sale').length, 0);
});

test('an unattributed sale pays 50% to conversion-campaign agents; company keeps the rest', () => {
  const s = REV_STATE();
  s.revenueLedgerEntries = [{ id: 'evt_2', type: 'one_time', amountCents: 2900, utmContent: null, occurredAt: at(0) }];
  const evs = extractEvents(s, null).filter(e => e.type === 'revenue_sale');
  // fallback set = ['echo'] (task on active conversion campaign) -> floor(129*0.5) = 64
  assert.strictEqual(evs.length, 1);
  assert.strictEqual(evs[0].agentId, 'echo');
  assert.strictEqual(evs[0].xpOverride, 64);
  assert.strictEqual(evs[0].id, 'sale_evt_2__echo');
});

test('a lead pays 15 XP through the same chain; scans pay 3 via fallback', () => {
  const s = REV_STATE();
  s.asLeads = [{ email: 'x@y.z', utmContent: 'act_1', ts: at(0) }];
  s.scans = [
    { reportId: 'ccr_1', tier: 'free', timestamp: at(0) },
    { reportId: 'ccr_2', tier: 'agent', timestamp: at(0) },     // internal — excluded
    { tier: 'failed', timestamp: at(0) }                        // failed — excluded
  ];
  const leads = extractEvents(s, null).filter(e => e.type === 'funnel_lead');
  assert.strictEqual(leads.length, 3, 'lead split across scribe/echo/quill');
  assert.ok(leads.every(e => e.xpOverride === 5), '15/3 = 5 each');
  const scans = extractEvents(s, null).filter(e => e.type === 'funnel_scan');
  assert.strictEqual(scans.length, 1, 'only the public scan, via fallback');
  assert.strictEqual(scans[0].agentId, 'echo');
  assert.strictEqual(scans[0].id, 'scan_ccr_1__echo');
});

test('lead ids are stable across runs (ts + email hash) so dedup holds', () => {
  const s = REV_STATE();
  s.asLeads = [{ email: 'x@y.z', utmContent: 'act_1', ts: at(0) }];
  const a = extractEvents(s, null).filter(e => e.type === 'funnel_lead').map(e => e.id).sort();
  const b = extractEvents(s, null).filter(e => e.type === 'funnel_lead').map(e => e.id).sort();
  assert.deepStrictEqual(a, b);
});

test('_emitSplit never distributes more than the nominal budget to a large fallback set', () => {
  const s = REV_STATE();
  // 6 agents active on the conversion campaign -> fallback set of 6
  s.tasks = ['echo', 'scribe', 'pixel', 'scout', 'forge', 'quill'].map((a, i) => (
    { id: 'tf' + i, campaign_id: 'camp-conv', assignee: a, updatedAt: at(-2) }
  ));
  s.actionsById = {};   // force fallback path
  s.scans = [{ reportId: 'ccr_big', tier: 'free', timestamp: at(0) }];
  const evs = extractEvents(s, null).filter(e => e.type === 'funnel_scan');
  const total = evs.reduce((sum, e) => sum + e.xpOverride, 0);
  assert.ok(total <= 1, 'scan budget = floor(3*0.5) = 1; got ' + total);
  assert.strictEqual(evs.length, 1, 'recipient list trimmed to budget');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
