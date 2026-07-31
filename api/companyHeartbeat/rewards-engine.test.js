// Run with: node api/companyHeartbeat/rewards-engine.test.js
// Pure-function tests for the agent XP/reward engine (Stage 1).
const assert = require('assert');
const {
  levelFromXp, rankFromLevel, classFor,
  applyEvents, applyCompany, extractEvents, buildProgressionPromptBlock,
  resolveContributors, conversionFallbackAgents, rolloverSeason, computeBudgetPlan,
  runRewardsEngine
} = require('./rewards-engine');

const DAY = 86400000;
const NOW = Date.UTC(2026, 5, 20, 12, 0, 0);
const at = (dayOffset, h) => new Date(NOW + dayOffset * DAY + (h || 0) * 3600000).toISOString();

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}
const asyncTests = [];
function testAsync(name, fn) { asyncTests.push({ name, fn }); }
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

// ── Task 3: economy application ──
test('revenue_sale is exempt from the daily cap and accrues season + revenue XP', () => {
  const { rewards } = applyEvents([
    { id: 'appr_x1', type: 'proposal_approved', agentId: 'echo', at: at(0, 1) },   // 8 XP
    { id: 'sale_e1__echo', type: 'revenue_sale', agentId: 'echo', xpOverride: 43, at: at(0, 2) }
  ], null, NOW);
  const a = agent(rewards, 'echo');
  assert.ok(a.xp >= 8 + 43, 'sale not haircut by the 12/day cap (got ' + a.xp + ')');
  assert.ok(a.seasonXp >= 8 + 43, 'season XP accrues');
  assert.ok(a.seasonRevenueXp >= 43, 'revenue-lane season XP tracked');
  assert.strictEqual(a.counters.sales, 1);
  assert.ok(Array.isArray(a.revenueRecent) && a.revenueRecent.length === 1);
  assert.ok(a.achievements.some(x => x.id === 'first_sale'), 'first_sale unlocked');
});

test('task_done lane-caps at 3 XP/day: 4th task pays nothing and mints no renown', () => {
  const evs = [1, 2, 3, 4].map(n => ({ id: 'tk_lane_' + n, type: 'task_done', agentId: 'scribe', at: at(0, n) }));
  const { rewards } = applyEvents(evs, null, NOW);
  const a = agent(rewards, 'scribe');
  assert.strictEqual(a.xp, 3, 'lane cap 3');
  assert.strictEqual(a.renown, 0, 'no renown from lane overflow');
  assert.strictEqual(a.counters.tasksDone, 4, 'counter still counts all tasks');
});

test('funnel_lead exempt from cap; funnel_scan is NOT exempt', () => {
  const evs = [
    { id: 'lead_a__echo', type: 'funnel_lead', agentId: 'echo', xpOverride: 15, at: at(0, 1) },
    { id: 'appr_c1', type: 'proposal_approved', agentId: 'echo', at: at(0, 2) },     // fills cap: 8
    { id: 'appr_c2', type: 'proposal_approved', agentId: 'echo', at: at(0, 3) },     // 8 -> capped at 4
    { id: 'scan_s1__echo', type: 'funnel_scan', agentId: 'echo', xpOverride: 3, at: at(0, 4) } // cap full -> 0
  ];
  const { rewards } = applyEvents(evs, null, NOW);
  const a = agent(rewards, 'echo');
  // lead 15 (exempt) + capped non-exempt lanes 12 = 27
  assert.strictEqual(a.xp, 27);
  assert.strictEqual(a.counters.leads, 1);
});

test('xpOverride shares are exact — streak multiplier never inflates revenue events', () => {
  // build a 3-day streak first (mult 1.06), then a sale share of 43
  const evs = [
    { id: 'st_1', type: 'task_done', agentId: 'forge', at: at(0) },
    { id: 'st_2', type: 'task_done', agentId: 'forge', at: at(1) },
    { id: 'st_3', type: 'task_done', agentId: 'forge', at: at(2) },
    { id: 'sale_ex__forge', type: 'revenue_sale', agentId: 'forge', xpOverride: 43, at: at(2, 1) }
  ];
  const { rewards } = applyEvents(evs, null, NOW);
  assert.strictEqual(agent(rewards, 'forge').seasonRevenueXp, 43, 'share paid exactly, no streak inflation');
});

test('task_done lane cap composes with the global 12/day cap regardless of event order', () => {
  // non-exempt lanes fill the global cap FIRST, then task_done arrives
  const evs = [
    { id: 'appr_o1', type: 'proposal_approved', agentId: 'scout', at: at(0, 1) },  // 8
    { id: 'appr_o2', type: 'proposal_approved', agentId: 'scout', at: at(0, 2) },  // 8 -> 4 (cap)
    { id: 'tk_o1', type: 'task_done', agentId: 'scout', at: at(0, 3) },
    { id: 'tk_o2', type: 'task_done', agentId: 'scout', at: at(0, 4) },
    { id: 'tk_o3', type: 'task_done', agentId: 'scout', at: at(0, 5) }
  ];
  const { rewards } = applyEvents(evs, null, NOW);
  assert.strictEqual(agent(rewards, 'scout').xp, 12, 'global daily cap holds regardless of order');
});

// ── Task 4: season rollover ──
const mkLedger = (season, perAgent, seasonMeta) => ({
  season, seasonMeta: seasonMeta || null, perAgent, company: { counters: {} }, processedEventIds: [], assistPairs: {}
});
const mkA = (seasonXp, extra) => Object.assign({
  xp: seasonXp, level: 1, rank: 'Rookie', renown: 0, streakDays: 0, lastActiveDay: null,
  dailyXp: 0, dailyXpDay: null, seasonXp, seasonRevenueXp: 0, revenueRecent: [],
  counters: {}, achievements: [], recent: [], parMisses: 0, ladderStatus: 'safe', seasonHistory: []
}, extra || {});
const AUG = Date.UTC(2026, 7, 1, 1, 0, 0);   // 2026-08-01
const IDS5 = ['echo', 'scribe', 'nova', 'quill', 'pixel'];

test('rollover archives standings, resets season XP, sets scaled par', () => {
  const prev = mkLedger('2026-07', {
    echo: mkA(100), scribe: mkA(80), nova: mkA(50), quill: mkA(10), pixel: mkA(5)
  }, { par: 40 });
  const r = rolloverSeason(prev, AUG, { activeIds: IDS5, parFloor: 40 });
  assert.strictEqual(r.rewards.season, '2026-08');
  const e = r.rewards.perAgent.echo;
  assert.strictEqual(e.seasonXp, 0, 'season XP reset');
  assert.strictEqual(e.seasonHistory[0].season, '2026-07');
  assert.strictEqual(e.seasonHistory[0].rank, 1);
  assert.strictEqual(e.seasonHistory[0].belowPar, false);
  // median of [100,80,50,10,5] = 50 -> par = max(40, round(55)) = 55
  assert.strictEqual(r.rewards.seasonMeta.par, 55);
  assert.strictEqual(r.rewards.seasonMeta.previousChampion, 'echo');
});

test('par misses escalate the ladder: watch -> squeezed -> retirement_pending', () => {
  // pixel stays at seasonXp 0 (always below par) across three real rollovers;
  // the other four earn 100 each month so they never miss par.
  const prev = mkLedger('2026-07', { echo: mkA(100), scribe: mkA(90), nova: mkA(80), quill: mkA(70), pixel: mkA(0) }, { par: 40 });
  const r1 = rolloverSeason(prev, AUG, { activeIds: IDS5, parFloor: 40 });
  assert.strictEqual(r1.rewards.perAgent.pixel.parMisses, 1);
  assert.strictEqual(r1.rewards.perAgent.pixel.ladderStatus, 'watch');
  assert.ok(!r1.transitions.some(t => t.agentId === 'pixel' && t.to === 'retirement_pending'));

  ['echo', 'scribe', 'nova', 'quill'].forEach(id => { r1.rewards.perAgent[id].seasonXp = 100; });
  const SEP = Date.UTC(2026, 8, 1, 1, 0, 0);
  const r2 = rolloverSeason(r1.rewards, SEP, { activeIds: IDS5, parFloor: 40 });
  assert.strictEqual(r2.rewards.perAgent.pixel.parMisses, 2);
  assert.strictEqual(r2.rewards.perAgent.pixel.ladderStatus, 'squeezed');
  assert.ok(!r2.transitions.some(t => t.agentId === 'pixel' && t.to === 'retirement_pending'));

  ['echo', 'scribe', 'nova', 'quill'].forEach(id => { r2.rewards.perAgent[id].seasonXp = 100; });
  const OCT = Date.UTC(2026, 9, 1, 1, 0, 0);
  const r3 = rolloverSeason(r2.rewards, OCT, { activeIds: IDS5, parFloor: 40 });
  assert.strictEqual(r3.rewards.perAgent.pixel.parMisses, 3);
  assert.strictEqual(r3.rewards.perAgent.pixel.ladderStatus, 'retirement_pending');
  assert.ok(r3.transitions.some(t => t.agentId === 'pixel' && t.to === 'retirement_pending'), 'transition reported only on the third rollover');
});

test('at-or-above-par season resets misses; privilege tiers derive from final ranks', () => {
  // 6 agents — probation only applies when fleet >= 6
  const IDS6 = ['echo', 'scribe', 'nova', 'forge', 'quill', 'pixel'];
  const prev = mkLedger('2026-07', {
    echo: mkA(100), scribe: mkA(80), nova: mkA(50, { parMisses: 1, ladderStatus: 'watch' }),
    forge: mkA(45), quill: mkA(42), pixel: mkA(41)
  }, { par: 40 });
  const r = rolloverSeason(prev, AUG, { activeIds: IDS6, parFloor: 40 });
  assert.strictEqual(r.rewards.perAgent.nova.parMisses, 0, 'recovery resets');
  assert.strictEqual(r.rewards.perAgent.nova.ladderStatus, 'safe');
  const tiers = r.rewards.privileges.tiers;
  assert.strictEqual(tiers.echo, 'vanguard');
  assert.strictEqual(tiers.scribe, 'vanguard');
  assert.strictEqual(tiers.nova, 'line');
  assert.strictEqual(tiers.forge, 'line');
  assert.strictEqual(tiers.quill, 'probation');
  assert.strictEqual(tiers.pixel, 'probation');
});

test('probation is skipped for small fleets (< 6 agents)', () => {
  const prev = mkLedger('2026-07', {
    echo: mkA(100), scribe: mkA(80), nova: mkA(50), quill: mkA(45), pixel: mkA(41)
  }, { par: 40 });
  const r = rolloverSeason(prev, AUG, { activeIds: IDS5, parFloor: 40 });
  const tiers = r.rewards.privileges.tiers;
  assert.strictEqual(tiers.pixel, 'line', 'no probation at fleet size 5');
});

test('no rollover mid-season; bootstrap ledger without seasonMeta counts no misses', () => {
  const prev = mkLedger('2026-08', { echo: mkA(5) }, { par: 40 });
  const r = rolloverSeason(prev, AUG, { activeIds: ['echo'], parFloor: 40 });
  assert.strictEqual(r.rolled, false, 'same month: no-op');
  const boot = mkLedger('2026-07', { echo: mkA(0), scribe: mkA(0) }, null);   // pre-seasons ledger
  const rb = rolloverSeason(boot, AUG, { activeIds: ['echo', 'scribe'], parFloor: 40 });
  assert.strictEqual(rb.rewards.perAgent.echo.parMisses, 0, 'no par existed -> no miss');
  assert.strictEqual(rb.rewards.seasonMeta.par, 40, 'par floors at 40');
});

test('non-fleet perAgent entries (e.g. ceo) get season accumulators reset on rollover', () => {
  const prev = mkLedger('2026-07', { echo: mkA(100), scribe: mkA(80) }, { par: 40 });
  prev.perAgent.ceo = mkA(9999);
  const r = rolloverSeason(prev, AUG, { activeIds: ['echo', 'scribe'], parFloor: 40 });
  assert.strictEqual(r.rewards.perAgent.ceo.seasonXp, 0, 'non-fleet seasonXp reset');
  assert.strictEqual(r.rewards.perAgent.ceo.seasonHistory.length, 0, 'but no history/rank for non-fleet');
});

test('ranking ties break alphabetically by id, independent of activeIds order', () => {
  const per = { nova: mkA(50), echo: mkA(50), scribe: mkA(50) };
  const r1 = rolloverSeason(mkLedger('2026-07', JSON.parse(JSON.stringify(per)), { par: 40 }), AUG, { activeIds: ['nova', 'scribe', 'echo'], parFloor: 40 });
  const r2 = rolloverSeason(mkLedger('2026-07', JSON.parse(JSON.stringify(per)), { par: 40 }), AUG, { activeIds: ['echo', 'scribe', 'nova'], parFloor: 40 });
  assert.strictEqual(r1.rewards.seasonMeta.previousChampion, 'echo');
  assert.strictEqual(r2.rewards.seasonMeta.previousChampion, 'echo', 'champion stable across input orders');
  assert.deepStrictEqual(r1.rewards.privileges.tiers, r2.rewards.privileges.tiers, 'tiers stable across input orders');
});

test('multi-month gap = one rollover, one miss, gap recorded', () => {
  const prev = mkLedger('2026-07', { echo: mkA(100), scribe: mkA(5) }, { par: 40 });
  const NOV = Date.UTC(2026, 10, 1, 1, 0, 0);
  const r = rolloverSeason(prev, NOV, { activeIds: ['echo', 'scribe'], parFloor: 40 });
  assert.strictEqual(r.rewards.season, '2026-11');
  assert.strictEqual(r.rewards.perAgent.scribe.parMisses, 1, 'one miss despite 3-month gap (deliberate)');
  assert.strictEqual(r.rewards.seasonMeta.monthsSkipped, 3, 'gap recorded honestly');
});

// ── Bootstrap-season + baseline-cap safety (post-review hardening) ──
test('a zero-spread season assigns NO tiers — everyone line (bootstrap season guard)', () => {
  // First rollover under Revenue Seasons: seasonXp is a brand-new field, so every
  // agent is at 0. Ranking would be pure alphabetical — must not hand out real
  // privileges (or penalties) on alphabetical order.
  const IDS9 = ['cipher', 'echo', 'forge', 'nova', 'pixel', 'quill', 'scout', 'scribe', 'vale'];
  const per = {};
  IDS9.forEach(id => { per[id] = mkA(0, { xp: id === 'scribe' ? 543 : 15 }); });
  const r = rolloverSeason(mkLedger('2026-07', per, { par: 40 }), AUG, { activeIds: IDS9, parFloor: 40 });
  const tiers = r.rewards.privileges.tiers;
  IDS9.forEach(id => assert.strictEqual(tiers[id], 'line', id + ' must be line in a zero-spread season'));
});

test('with a real season spread, ties break on lifetime XP before alphabetical', () => {
  const IDS6 = ['cipher', 'echo', 'forge', 'nova', 'scribe', 'vale'];
  const per = {};
  // scribe + vale tie on season XP but scribe has vastly more lifetime XP
  IDS6.forEach(id => { per[id] = mkA(id === 'nova' ? 100 : 10, { xp: id === 'scribe' ? 543 : 12 }); });
  const r = rolloverSeason(mkLedger('2026-07', per, { par: 40 }), AUG, { activeIds: IDS6, parFloor: 40 });
  const tiers = r.rewards.privileges.tiers;
  // nova leads outright on season XP; scribe wins every remaining tie on lifetime XP,
  // so it ranks #2 — the alphabetical order (cipher, echo, forge...) would have buried it.
  assert.strictEqual(tiers.scribe, 'vanguard', 'lifetime leader outranks alphabetical peers on a tie');
  assert.notStrictEqual(tiers.scribe, 'probation', 'the fleet top producer is never demoted on a tie');
});

test('pre-revenue budget plan preserves baseline (CEO-tuned) caps instead of flattening', () => {
  const led = mkLedger('2026-08', { nova: mkA(0), scribe: mkA(0), vale: mkA(0) }, { par: 40 });
  const baseline = { nova: 20, scribe: 16, vale: 7 };   // sums 43
  const plan = computeBudgetPlan(led, {
    poolDollars: 43, activeIds: ['nova', 'scribe', 'vale'], baselineCaps: baseline, nowMs: AUG
  });
  assert.strictEqual(plan.perAgent.nova, 20, 'hand-tuned cap preserved pre-revenue');
  assert.strictEqual(plan.perAgent.scribe, 16);
  assert.strictEqual(plan.perAgent.vale, 7);
});

test('with revenue, the floor stays baseline-proportional and merit follows earnings', () => {
  const led = mkLedger('2026-08', {
    nova: mkA(0), scribe: mkA(0),
    vale: mkA(0, { revenueRecent: [{ at: new Date(AUG - 86400000).toISOString(), xp: 100 }] })
  }, { par: 40 });
  const plan = computeBudgetPlan(led, {
    poolDollars: 100, activeIds: ['nova', 'scribe', 'vale'],
    baselineCaps: { nova: 50, scribe: 30, vale: 20 }, nowMs: AUG
  });
  // floor 40 by baseline share: nova 20, scribe 12, vale 8. merit 60 all to vale.
  assert.strictEqual(plan.perAgent.nova, 20);
  assert.strictEqual(plan.perAgent.scribe, 12);
  assert.strictEqual(plan.perAgent.vale, 68, 'sole earner takes the whole merit pool');
});

test('every active agent gets a floor even with no ledger entry yet (pool not concentrated)', () => {
  // Only scribe has earned anything; the other two must still receive their baseline floor
  // rather than letting scribe+peers absorb the entire pool.
  const led = mkLedger('2026-08', { scribe: mkA(0) }, { par: 40 });
  const plan = computeBudgetPlan(led, {
    poolDollars: 100, activeIds: ['nova', 'scribe', 'vale'],
    baselineCaps: { nova: 50, scribe: 30, vale: 20 }, nowMs: AUG
  });
  assert.strictEqual(Object.keys(plan.perAgent).length, 3, 'all three active agents present');
  assert.strictEqual(plan.perAgent.nova, 50, 'ledger-less agent keeps its baseline allocation');
  assert.strictEqual(plan.perAgent.vale, 20);
  const sum = Object.values(plan.perAgent).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 100) < 0.05, 'plan still sums to the pool');
});

test('missing/partial baselineCaps falls back to an even split (no crash)', () => {
  const led = mkLedger('2026-08', { nova: mkA(0), scribe: mkA(0) }, { par: 40 });
  const plan = computeBudgetPlan(led, { poolDollars: 100, activeIds: ['nova', 'scribe'], nowMs: AUG });
  assert.strictEqual(plan.perAgent.nova, 50, 'no baseline -> even split');
  const partial = computeBudgetPlan(led, {
    poolDollars: 100, activeIds: ['nova', 'scribe'], baselineCaps: { nova: 10 }, nowMs: AUG
  });
  const sum = Object.values(partial.perAgent).reduce((s, v) => s + v, 0);
  assert.ok(sum <= 100 + 1e-6 && sum > 0, 'partial baseline still yields a sane plan');
});

// ── Task 5: merit budget plan ──
test('pre-revenue (all trailing 0) the plan is an even split of the pool', () => {
  const led = mkLedger('2026-08', { echo: mkA(0), scribe: mkA(0), nova: mkA(0), quill: mkA(0) }, { par: 40 });
  const plan = computeBudgetPlan(led, { poolDollars: 100, activeIds: ['echo', 'scribe', 'nova', 'quill'], nowMs: AUG });
  assert.strictEqual(plan.perAgent.echo, 25);
  assert.strictEqual(plan.perAgent.quill, 25);
});

test('trailing revenue XP shifts the 60% merit share; floor guarantees survival', () => {
  const led = mkLedger('2026-08', {
    echo: mkA(0, { revenueRecent: [{ at: new Date(AUG - 2 * 86400000).toISOString(), xp: 60 }] }),
    scribe: mkA(0, { revenueRecent: [{ at: new Date(AUG - 3 * 86400000).toISOString(), xp: 20 }] }),
    nova: mkA(0), quill: mkA(0)
  }, { par: 40 });
  const plan = computeBudgetPlan(led, { poolDollars: 100, activeIds: ['echo', 'scribe', 'nova', 'quill'], nowMs: AUG });
  // floor: 40/4 = 10 each. merit 60: echo 45, scribe 15, others 0.
  assert.strictEqual(plan.perAgent.echo, 55);
  assert.strictEqual(plan.perAgent.scribe, 25);
  assert.strictEqual(plan.perAgent.nova, 10);
  // entries older than 14d are ignored
  led.perAgent.echo.revenueRecent = [{ at: new Date(AUG - 20 * 86400000).toISOString(), xp: 60 }];
  const plan2 = computeBudgetPlan(led, { poolDollars: 100, activeIds: ['echo', 'scribe', 'nova', 'quill'], nowMs: AUG });
  assert.strictEqual(plan2.perAgent.scribe, 70, 'scribe now sole earner: 10 + 60');
});

test('squeezed agents lose 30%, redistributed to the previous champion', () => {
  const led = mkLedger('2026-08', {
    echo: mkA(0), scribe: mkA(0), nova: mkA(0), quill: mkA(0, { ladderStatus: 'squeezed' })
  }, { par: 40 });
  led.seasonMeta = { par: 40, previousChampion: 'echo' };
  const plan = computeBudgetPlan(led, { poolDollars: 100, activeIds: ['echo', 'scribe', 'nova', 'quill'], nowMs: AUG });
  assert.strictEqual(plan.perAgent.quill, 17.5, '25 * 0.7');
  assert.strictEqual(plan.perAgent.echo, 32.5, '25 + freed 7.5');
});

test('a squeezed champion does not refund their own cut to themselves', () => {
  const led = mkLedger('2026-08', {
    echo: mkA(0, { ladderStatus: 'squeezed' }), scribe: mkA(0), nova: mkA(0), quill: mkA(0)
  }, { par: 40 });
  led.seasonMeta = { par: 40, previousChampion: 'echo' };
  const plan = computeBudgetPlan(led, { poolDollars: 100, activeIds: ['echo', 'scribe', 'nova', 'quill'], nowMs: AUG });
  assert.strictEqual(plan.perAgent.echo, 17.5, 'squeezed champion keeps the 30% cut');
});

test('invalid floor/merit percentages fall back to defaults; sum never exceeds pool', () => {
  const led = mkLedger('2026-08', { echo: mkA(0), scribe: mkA(0) }, { par: 40 });
  const plan = computeBudgetPlan(led, { poolDollars: 100, floorPct: 0.6, meritPct: 0.6, activeIds: ['echo', 'scribe'], nowMs: AUG });
  assert.strictEqual(plan.perAgent.echo, 50, 'invalid 0.6+0.6 config ignored, defaults used');
  const total = Object.values(plan.perAgent).reduce((s, v) => s + v, 0);
  assert.ok(total <= 100 + 1e-6, 'never allocates more than the pool');
});

test('disabled-plan fallback shape for empty roster or zero pool', () => {
  const empty = computeBudgetPlan({ perAgent: {} }, { poolDollars: 100, nowMs: AUG });
  assert.strictEqual(empty.enabled, false);
  assert.deepStrictEqual(empty.perAgent, {});
  const noPool = computeBudgetPlan(mkLedger('2026-08', { echo: mkA(0) }, null), { poolDollars: 0, activeIds: ['echo'], nowMs: AUG });
  assert.strictEqual(noPool.enabled, false);
});

// ── Task 6: prompt block v2 ──
test('prompt block shows season standings, par progress and earning guide', () => {
  const led = mkLedger('2026-08', {
    echo: mkA(0, { seasonXp: 50, level: 4, rank: 'Rookie', xp: 388 }),
    scribe: mkA(0, { seasonXp: 30, level: 5, rank: 'Rookie', xp: 543 }),
    nova: mkA(0, { seasonXp: 5, level: 1, rank: 'Rookie', xp: 37 })
  }, { par: 40, previousChampion: null });
  led.privileges = { enabled: true, season: '2026-08', tiers: { echo: 'vanguard', scribe: 'line', nova: 'probation' } };
  const block = buildProgressionPromptBlock('nova', led, AUG + 10 * 86400000);
  assert.ok(/SEASON/.test(block), 'season header');
  assert.ok(/#3 of 3/.test(block), 'season rank');
  assert.ok(/5\/40/.test(block), 'par progress seasonXp/par');
  assert.ok(/days (left|remain)/i.test(block), 'days remaining');
  assert.ok(/probation/i.test(block), 'privilege tier shown');
  assert.ok(/sale/i.test(block) && /lead/i.test(block), 'earning guide names the revenue lane');
});

test('ladder consequence lines are stated verbatim for hot states', () => {
  const led = mkLedger('2026-08', {
    echo: mkA(0, { seasonXp: 50 }), nova: mkA(0, { seasonXp: 5, parMisses: 2, ladderStatus: 'squeezed' }),
    quill: mkA(0, { seasonXp: 1, parMisses: 3, ladderStatus: 'retirement_pending' })
  }, { par: 40 });
  assert.ok(/budget is cut 30%/i.test(buildProgressionPromptBlock('nova', led, AUG)), 'squeeze line');
  const rp = buildProgressionPromptBlock('quill', led, AUG);
  assert.ok(/retirement/i.test(rp) && /successor/i.test(rp), 'existential line');
});

test('non-fleet agent ids render without a season rank line (no rank #0 garbage)', () => {
  const led = mkLedger('2026-08', { nova: mkA(5), ceo: mkA(3) }, { par: 40 });
  const block = buildProgressionPromptBlock('ceo', led, AUG);
  assert.ok(block.length > 0, 'still renders for known perAgent entry');
  assert.ok(!/rank #0/i.test(block), 'no rank #0');
  assert.ok(!/#0 of/.test(block), 'no zero-index rank at all');
});

test('bare mid-season ledger degrades cleanly: no ladder line, LINE tier, assists in guide', () => {
  const led = { perAgent: { scribe: { xp: 120, level: 2, rank: 'Rookie' }, nova: { xp: 16, level: 1, rank: 'Rookie' } } };
  const block = buildProgressionPromptBlock('nova', led, AUG);
  assert.ok(!/LADDER:/.test(block), 'no ladder line when no status');
  assert.ok(/LINE/.test(block), 'defaults to LINE tier');
  assert.ok(/assists/i.test(block), 'assists restored to earning guide');
});

// ── Task 7: IO wiring ──
const FLEET_TEST_IDS = ['nova', 'cipher', 'pixel', 'forge', 'echo', 'scout', 'scribe', 'quill', 'vale'];
function fakeStorage(seed) {
  const db = Object.assign({}, seed);
  return {
    db,
    getState: async (k) => (k in db ? JSON.parse(JSON.stringify(db[k])) : null),
    setState: async (k, v) => { db[k] = JSON.parse(JSON.stringify(v)); }
  };
}

testAsync('runRewardsEngine pays an attributed sale end-to-end and attaches budgetPlan', async () => {
  const st = fakeStorage({
    approvalQueue: [], blogPosts: [], outcomeSnapshots: {}, tasksArchive: [], blogPostViews: [],
    socialAccountStats: {}, runtimeMemory: {}, agentRewards: null,
    tasks: [{ id: 'tk1', assignee: 'echo', reviewer: 'quill', campaign_id: 'camp-conv', updatedAt: at(-1) }],
    campaigns: [{ id: 'camp-conv', status: 'active', northStarMetric: 'paying customers' }],
    actions: [{ id: 'act_1', created_by: 'scribe', _parentTaskId: 'tk1' }],
    actionAttributionIndex: { map: {} },
    revenueLedger: { entries: [{ id: 'evt_1', type: 'one_time', amountCents: 2900, utmContent: 'act_1', occurredAt: at(0) }] },
    as_leads: [], cc_analytics: [], systemConfig: {},
    // mirrors the live registry: hand-tuned per-agent caps, not a flat split
    agentRegistry: { agents: FLEET_TEST_IDS.map(id => (
      { id, status: 'active', monthlyCap: ({ nova: 20, scribe: 16, echo: 16, forge: 11, vale: 7 })[id] || 10 }
    )) }
  });
  const res = await runRewardsEngine({ storage: st, nowMs: NOW, log: () => {} });
  assert.strictEqual(res.ok, true);
  const led = st.db.agentRewards;
  assert.ok(led.perAgent.scribe.counters.sales >= 1, 'writer credited');
  assert.ok(led.budgetPlan.perAgent.nova > led.budgetPlan.perAgent.vale,
    'registry baseline caps weight the plan (nova $20 vs vale $7), not a flat split');
  assert.ok(led.perAgent.echo.seasonRevenueXp > 0, 'assignee credited');
  assert.ok(led.budgetPlan && led.budgetPlan.perAgent, 'budgetPlan attached');
});

testAsync('runRewardsEngine drafts ONE retirement proposal on transition, never for protected agents', async () => {
  const mkPrev = (targetId) => {
    const per = {};
    FLEET_TEST_IDS.forEach(id => { per[id] = mkA(id === targetId ? 0 : 100); });
    per[targetId].parMisses = 2;
    per[targetId].ladderStatus = 'squeezed';
    return mkLedger('2026-07', per, { par: 40 });
  };
  const seed = (targetId) => ({
    approvalQueue: [], blogPosts: [], outcomeSnapshots: {}, tasks: [], tasksArchive: [], blogPostViews: [],
    socialAccountStats: {}, runtimeMemory: {}, campaigns: [], actions: [], actionAttributionIndex: { map: {} },
    revenueLedger: { entries: [] }, as_leads: [], cc_analytics: [], systemConfig: {},
    agentRewards: mkPrev(targetId),
    agentRegistry: { agents: FLEET_TEST_IDS.map(id => ({ id, status: 'active' })) }
  });
  let st = fakeStorage(seed('quill'));
  await runRewardsEngine({ storage: st, nowMs: AUG, log: () => {} });
  let drafts = st.db.approvalQueue.filter(q => q.type === 'agent_retire_proposal');
  assert.strictEqual(drafts.length, 1, 'draft appended');
  assert.strictEqual(drafts[0].retire.targetAgent, 'quill');
  assert.strictEqual(drafts[0].proposedBy, 'rewards-engine');
  // re-run: no duplicate
  const res2 = await runRewardsEngine({ storage: st, nowMs: AUG + 3600000, log: () => {} });
  assert.strictEqual(res2.ok, true);
  drafts = st.db.approvalQueue.filter(q => q.type === 'agent_retire_proposal');
  assert.strictEqual(drafts.length, 1, 'dedup across runs');
  // protected agent: no draft
  st = fakeStorage(seed('nova'));
  const res3 = await runRewardsEngine({ storage: st, nowMs: AUG, log: () => {} });
  assert.strictEqual(res3.ok, true);
  assert.strictEqual(st.db.approvalQueue.filter(q => q.type === 'agent_retire_proposal').length, 0, 'nova is protected');
});

testAsync('an existing pending draft suppresses a fresh transition draft (dedup guard)', async () => {
  const per = {};
  FLEET_TEST_IDS.forEach(id => { per[id] = mkA(id === 'quill' ? 0 : 100); });
  per.quill.parMisses = 2;
  per.quill.ladderStatus = 'squeezed';
  const st = fakeStorage({
    approvalQueue: [{
      id: 'retpr_seeded', type: 'agent_retire_proposal', status: 'pending', proposedBy: 'forge',
      retire: { targetAgent: 'quill', rationale: 'seeded by the manual path' }, createdAt: at(-1)
    }],
    blogPosts: [], outcomeSnapshots: {}, tasks: [], tasksArchive: [], blogPostViews: [],
    socialAccountStats: {}, runtimeMemory: {}, campaigns: [], actions: [], actionAttributionIndex: { map: {} },
    revenueLedger: { entries: [] }, as_leads: [], cc_analytics: [], systemConfig: {},
    agentRewards: mkLedger('2026-07', per, { par: 40 }),
    agentRegistry: { agents: FLEET_TEST_IDS.map(id => ({ id, status: 'active' })) }
  });
  // rollover DOES fire here (transition to retirement_pending) — the pending entry must suppress the append
  const res = await runRewardsEngine({ storage: st, nowMs: AUG, log: () => {} });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.rolled, true, 'rollover fired, so a draft was genuinely attempted');
  assert.strictEqual(st.db.agentRewards.perAgent.quill.ladderStatus, 'retirement_pending', 'transition happened');
  const drafts = st.db.approvalQueue.filter(q => q.type === 'agent_retire_proposal' && q.retire.targetAgent === 'quill');
  assert.strictEqual(drafts.length, 1, 'still exactly one — the seeded entry, no duplicate appended');
  assert.strictEqual(drafts[0].id, 'retpr_seeded');
});

testAsync('kill switch across a month boundary: rollover fires on re-enable with gap recorded', async () => {
  const per = {};
  FLEET_TEST_IDS.forEach(id => { per[id] = mkA(50); });
  const st = fakeStorage({
    approvalQueue: [], blogPosts: [], outcomeSnapshots: {}, tasks: [], tasksArchive: [], blogPostViews: [],
    socialAccountStats: {}, runtimeMemory: {}, campaigns: [], actions: [], actionAttributionIndex: { map: {} },
    revenueLedger: { entries: [] }, as_leads: [], cc_analytics: [],
    systemConfig: { rewards: { enabled: false } },
    agentRewards: mkLedger('2026-07', per, { par: 40 }),
    agentRegistry: { agents: FLEET_TEST_IDS.map(id => ({ id, status: 'active' })) }
  });
  // disabled run AFTER the month boundary — must NOT consume the rollover
  let res = await runRewardsEngine({ storage: st, nowMs: AUG, log: () => {} });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(st.db.agentRewards.season, '2026-07', 'stale season preserved while disabled');
  // re-enable: rollover fires now
  st.db.systemConfig = { rewards: { enabled: true } };
  res = await runRewardsEngine({ storage: st, nowMs: AUG + 3600000, log: () => {} });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.rolled, true, 'missed rollover fires on re-enable');
  assert.strictEqual(st.db.agentRewards.season, '2026-08');
});

testAsync('retirement drafts carry real orphans from the registry', async () => {
  const per = {};
  FLEET_TEST_IDS.forEach(id => { per[id] = mkA(id === 'scribe' ? 0 : 100); });
  per.scribe.parMisses = 2;
  per.scribe.ladderStatus = 'squeezed';
  const st = fakeStorage({
    approvalQueue: [], blogPosts: [], outcomeSnapshots: {}, tasks: [], tasksArchive: [], blogPostViews: [],
    socialAccountStats: {}, runtimeMemory: {}, campaigns: [], actions: [], actionAttributionIndex: { map: {} },
    revenueLedger: { entries: [] }, as_leads: [], cc_analytics: [], systemConfig: {},
    agentRewards: mkLedger('2026-07', per, { par: 40 }),
    agentRegistry: { agents: FLEET_TEST_IDS.map(id => (
      { id, status: 'active', reportsTo: (id === 'quill' ? 'scribe' : 'nova') }
    )) }
  });
  const res = await runRewardsEngine({ storage: st, nowMs: AUG, log: () => {} });
  assert.strictEqual(res.ok, true);
  const draft = st.db.approvalQueue.find(q => q.type === 'agent_retire_proposal');
  assert.ok(draft, 'draft created');
  assert.deepStrictEqual(draft.retire.orphans, ['quill'], 'reportsTo dependants captured');
});

testAsync('systemConfig.rewards.enabled=false skips seasons/budget/drafts but legacy lanes still pay', async () => {
  const st = fakeStorage({
    approvalQueue: [], blogPosts: [{ id: 'b1', author: 'scribe', publishedAt: at(0) }],
    outcomeSnapshots: {}, tasks: [], tasksArchive: [], blogPostViews: [], socialAccountStats: {}, runtimeMemory: {},
    campaigns: [], actions: [], actionAttributionIndex: { map: {} },
    revenueLedger: { entries: [{ id: 'evt_9', type: 'one_time', amountCents: 2900, utmContent: null, occurredAt: at(0) }] },
    as_leads: [], cc_analytics: [],
    systemConfig: { rewards: { enabled: false } },
    agentRewards: null,
    agentRegistry: { agents: FLEET_TEST_IDS.map(id => ({ id, status: 'active' })) }
  });
  const resOff = await runRewardsEngine({ storage: st, nowMs: NOW, log: () => {} });
  assert.strictEqual(resOff.ok, true);
  const led = st.db.agentRewards;
  assert.ok(led.perAgent.scribe.counters.blogs >= 1, 'legacy blog lane still pays');
  assert.ok(!led.budgetPlan || led.budgetPlan.enabled === false, 'no merit budget when disabled');
  assert.ok(!Object.keys(led.perAgent).some(id => (led.perAgent[id].counters.sales || 0) > 0), 'revenue lane off');
});

(async () => {
  for (const t of asyncTests) {
    try { await t.fn(); pass++; console.log('  PASS ', t.name); }
    catch (e) { fail++; console.log('  FAIL ', t.name, '\n        ', e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
})();
