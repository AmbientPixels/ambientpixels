// Run: node companyHeartbeat/bet-ledger.test.js
'use strict';
const assert = require('assert');
const { evaluateBets, scoreBets, scoreOne, buildLedger, buildEvidenceBlock, MEMORY_SOURCE } = require('./bet-ledger');

const NOW = Date.parse('2026-10-20T12:00:00Z');
const daysAgo = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

function bet(over) {
  return Object.assign({
    betKey: 'search_page|resume-roast|google|any', mechanism: 'search_page', product: 'Resume Roast', channel: 'google',
    hypothesis: 'x', evidence: [], proposedBy: 'scout',
    expected: { metric: 'qualified_uses_week', delta: 3, byDay: 28 },
    kill: { metric: 'campaign_qualified_uses', below: 2, byDay: 14 },
    scale: { metric: 'campaign_qualified_uses', above: 6, byDay: 14 }
  }, over || {});
}
function camp(id, over) { return Object.assign({ id, title: 'Campaign ' + id, status: 'active', startDate: daysAgo(20), bet: bet() }, over || {}); }
function digest(perCampaign) { return { perCampaign }; }

// 1. Kill fires only on a MEASURED number below the threshold after byDay; null is a measurement gap, never a kill.
{
  const cs = [
    camp('a'),                                   // measured 1 < 2 after day 14 → killed
    camp('b'),                                   // measured 5 → survives
    camp('c'),                                   // unmeasured → measurementGap, not killed
    camp('d', { startDate: daysAgo(5) }),        // too young → untouched
    camp('e', { status: 'paused' })              // not active → untouched
  ];
  const d = digest([
    { campaignId: 'a', postsPublished: 10, qualifiedUsesAttributed: 1, qualifiedUsesMeasuredPosts: 10 },
    { campaignId: 'b', postsPublished: 10, qualifiedUsesAttributed: 5, qualifiedUsesMeasuredPosts: 10 },
    { campaignId: 'c', postsPublished: 10, qualifiedUsesAttributed: null, qualifiedUsesMeasuredPosts: 0 },
    { campaignId: 'd', postsPublished: 2, qualifiedUsesAttributed: 0, qualifiedUsesMeasuredPosts: 2 }
  ]);
  const r = evaluateBets(cs, d, NOW);
  assert.deepStrictEqual(r.killed, ['a']);
  assert.strictEqual(cs[0].status, 'killed');
  assert.ok(/campaign_qualified_uses = 1 \(< 2\)/.test(cs[0].killReason), cs[0].killReason);
  assert.strictEqual(cs[1].status, 'active');
  assert.strictEqual(cs[2].status, 'active');
  assert.strictEqual(cs[2].measurementGap, true, 'null never kills; it flags');
  assert.deepStrictEqual(r.measurementGaps, ['c']);
  assert.strictEqual(cs[3].status, 'active');
  assert.strictEqual(cs[4].status, 'paused');
  assert.ok(r.govEvents.some(e => e.type === 'campaign_killed' && e.data.campaignId === 'a'));
  assert.strictEqual(r.scaleEligible.length, 0, '5 is not > 6');
}

// 2. Scale flags, never changes frequency.
{
  const cs = [camp('s')];
  const r = evaluateBets(cs, digest([{ campaignId: 's', postsPublished: 9, qualifiedUsesAttributed: 7, qualifiedUsesMeasuredPosts: 9 }]), NOW);
  assert.deepStrictEqual(r.scaleEligible, ['s']);
  assert.strictEqual(cs[0].scaleEligible, true);
  assert.strictEqual(cs[0].frequency, undefined, 'frequency untouched');
  const again = evaluateBets(cs, digest([{ campaignId: 's', postsPublished: 9, qualifiedUsesAttributed: 7, qualifiedUsesMeasuredPosts: 9 }]), NOW);
  assert.strictEqual(again.scaleEligible.length, 0, 'flag is set once');
}

// 3. Scoring: won / lost / inconclusive / unmeasured / killed, with a calibration error and a memory to the proposer.
{
  const cs = [
    camp('won', { status: 'complete', startDate: daysAgo(30) }),
    camp('lost', { status: 'complete', startDate: daysAgo(30) }),
    camp('few', { status: 'complete', startDate: daysAgo(30) }),       // < 8 posts → inconclusive
    camp('young', { status: 'complete', startDate: daysAgo(10) }),     // < 14 days → inconclusive
    camp('unm', { status: 'complete', startDate: daysAgo(30) }),       // null → unmeasured
    camp('kil', { status: 'killed', startDate: daysAgo(30) }),
    camp('run'),                                                        // active → not scored
    camp('done-before', { status: 'complete', verdict: { result: 'won' } }) // already scored → untouched
  ];
  const d = digest([
    { campaignId: 'won', postsPublished: 12, qualifiedUsesAttributed: 4, qualifiedUsesMeasuredPosts: 12 },
    { campaignId: 'lost', postsPublished: 12, qualifiedUsesAttributed: 0, qualifiedUsesMeasuredPosts: 12 },
    { campaignId: 'few', postsPublished: 3, qualifiedUsesAttributed: 3, qualifiedUsesMeasuredPosts: 3 },
    { campaignId: 'young', postsPublished: 12, qualifiedUsesAttributed: 9, qualifiedUsesMeasuredPosts: 12 },
    { campaignId: 'unm', postsPublished: 12, qualifiedUsesAttributed: null, qualifiedUsesMeasuredPosts: 0 },
    { campaignId: 'kil', postsPublished: 12, qualifiedUsesAttributed: 1, qualifiedUsesMeasuredPosts: 12 },
    { campaignId: 'run', postsPublished: 12, qualifiedUsesAttributed: 9, qualifiedUsesMeasuredPosts: 12 }
  ]);
  const store = {};
  const r = scoreBets(cs, d, store, NOW);
  const by = {}; r.scored.forEach(s => by[s.campaignId] = s.result);
  assert.deepStrictEqual(by, { won: 'won', lost: 'lost', few: 'inconclusive', young: 'inconclusive', unm: 'unmeasured', kil: 'killed' });
  assert.strictEqual(cs[0].verdict.calibrationError, Math.round(Math.abs(3 - 4) / 3 * 100) / 100);
  assert.strictEqual(cs[1].verdict.calibrationError, 1);
  assert.strictEqual(cs[4].verdict.calibrationError, null, 'unmeasured has no calibration');
  assert.strictEqual(cs[6].verdict, undefined, 'active campaign not scored');
  assert.strictEqual(cs[7].verdict.result, 'won', 'existing verdict untouched');
  assert.strictEqual(r.memoriesWritten, 6);
  const mems = store.scout;
  assert.strictEqual(mems.length, 6);
  assert.ok(mems.every(m => m.source === MEMORY_SOURCE && m.type === 'verified_fact' && m.text.length <= 300));
  const lostMem = mems.find(m => m.evidence.campaignId === 'lost');
  assert.ok(/LOST/.test(lostMem.text) && /0 vs expected 3 over 12 posts/.test(lostMem.text) && /Do not re-propose/.test(lostMem.text), lostMem.text);
  const unmMem = mems.find(m => m.evidence.campaignId === 'unm');
  assert.ok(/UNMEASURED/.test(unmMem.text) && /the pipe, not the idea/.test(unmMem.text));
  const r2 = scoreBets(cs, d, store, NOW);
  assert.strictEqual(r2.scored.length, 0, 'idempotent');
  assert.strictEqual(store.scout.length, 6);
}

// 4. Ledger: rows newest first, calibration per agent, never-tried mechanisms, stale flag.
{
  const cs = [
    camp('x1', { status: 'complete', bet: bet({ mechanism: 'search_page', betKey: 'search_page|a|g|any', proposedBy: 'scout' }), verdict: { result: 'lost', actual: { value: 0, posts: 10 }, expected: 3, calibrationError: 1, scoredAt: daysAgo(5) } }),
    camp('x2', { status: 'complete', bet: bet({ mechanism: 'broadcast_post', betKey: 'broadcast_post|a|b|any', proposedBy: 'echo' }), verdict: { result: 'won', actual: { value: 4, posts: 12 }, expected: 3, calibrationError: 0.33, scoredAt: daysAgo(2) } }),
    camp('x3', { status: 'complete', bet: bet({ mechanism: 'email', betKey: 'email|a|e|any', proposedBy: 'echo' }), verdict: { result: 'lost', actual: { value: 0, posts: 9 }, expected: 2, calibrationError: 1, scoredAt: daysAgo(120) } }),
    camp('x4', { bet: bet({ mechanism: 'directory_listing', betKey: 'directory_listing|a|ph|any' }) })
  ];
  const l = buildLedger(cs, NOW);
  assert.deepStrictEqual(l.rows.map(r => r.campaignId), ['x2', 'x1', 'x3']);
  assert.strictEqual(l.rows[2].stale, true);
  assert.deepStrictEqual(l.calibration, { scout: { scored: 1, meanError: 1 }, echo: { scored: 1, meanError: 0.33 } }, 'stale rows excluded from calibration');
  assert.deepStrictEqual(l.running.map(r => r.campaignId), ['x4']);
  assert.ok(l.neverTried.indexOf('weekly_scoreboard') !== -1 && l.neverTried.indexOf('directory_listing') === -1 && l.neverTried.indexOf('search_page') === -1);
  assert.deepStrictEqual(l.counts, { won: 1, lost: 2 });

  const block = buildEvidenceBlock(l, digest([{ campaignId: 'x2', channel: 'social_bluesky', postsPublished: 12, qualifiedUsesAttributed: 4, qualifiedUsesMeasuredPosts: 12 }]), 'echo');
  assert.ok(/BET LEDGER/.test(block));
  assert.ok(/WON broadcast_post\|a\|b\|any: 4 vs expected 3 over 12 posts/.test(block), block);
  assert.ok(/LOST \(stale\) email/.test(block));
  assert.ok(/MECHANISMS NEVER TRIED: .*weekly_scoreboard/.test(block));
  assert.ok(/YOUR CALIBRATION: mean error 0.33 over 1 scored bets/.test(block));
  assert.ok(/PEOPLE PER POST .*social_bluesky 4\/12/.test(block));
  assert.ok(/blocked unless your evidence asOf is newer/.test(block));
  assert.strictEqual(buildEvidenceBlock(null), '');
  assert.ok(/No bet has been scored yet/.test(buildEvidenceBlock(buildLedger([], NOW), null, 'nova')));
}

// 5. scoreOne on a campaign with no perCampaign row is unmeasured.
{
  const v = scoreOne(camp('z', { status: 'complete', startDate: daysAgo(30) }), digest([]), NOW);
  assert.strictEqual(v.result, 'unmeasured');
  assert.strictEqual(v.actual.posts, 0);
}

console.log('bet-ledger.test.js: all assertions passed');
