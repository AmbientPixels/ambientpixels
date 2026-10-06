// Run: node companyHeartbeat/bet-schema.test.js
'use strict';
const assert = require('assert');
const { validateBet, computeBetKey, checkBetKeyAgainst, newestEvidenceAsOf, MECHANISMS, LOST_BLOCK_DAYS } = require('./bet-schema');

const NOW = Date.parse('2026-10-06T12:00:00Z');
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();

function good() {
  return {
    mechanism: 'search_page', product: 'Resume Roast', channel: 'google', audience: 'job seekers',
    hypothesis: 'Role-intent résumé pages will bring strangers who then run a roast.',
    evidence: [{ metric: 'search_impressions', k: 0, n: 12, window: '30d', source: 'search console', asOf: '2026-10-01' }],
    expected: { metric: 'qualified_uses_week', delta: 3, byDay: 28 },
    kill: { metric: 'campaign_qualified_uses', below: 2, byDay: 14 },
    scale: { metric: 'campaign_qualified_uses', above: 6, byDay: 14 }
  };
}

// 1. A complete bet validates and gets a stable key.
{
  const r = validateBet(good(), { nowMs: NOW });
  assert.strictEqual(r.ok, true, r.errors.join('; '));
  assert.strictEqual(r.bet.betKey, 'search_page|resume-roast|google|job-seekers');
  assert.strictEqual(r.bet.evidence[0].asOf, '2026-10-01');
  assert.deepStrictEqual(r.bet.kill, { metric: 'campaign_qualified_uses', below: 2, byDay: 14 });
}

// 2. Rewording does not change the key; changing the mechanism does.
{
  const a = computeBetKey({ mechanism: 'broadcast_post', product: 'AmbientScore', channel: 'social_bluesky' });
  const b = computeBetKey({ mechanism: 'Broadcast_Post', product: 'ambientscore ', channel: 'Social Bluesky' });
  const c = computeBetKey({ mechanism: 'weekly_scoreboard', product: 'AmbientScore', channel: 'social_bluesky' });
  assert.strictEqual(a, b, 'normalized');
  assert.notStrictEqual(a, c);
  assert.strictEqual(a, 'broadcast_post|ambientscore|social-bluesky|any');
}

// 3. Every missing or dishonest field is named.
{
  const r = validateBet({}, { nowMs: NOW });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /mechanism/.test(e)));
  assert.ok(r.errors.some(e => /evidence\[\] is required/.test(e)));
  assert.ok(r.errors.some(e => /expected\.metric/.test(e)));
  assert.ok(r.errors.some(e => /kill\.metric/.test(e)));
  assert.strictEqual(r.bet, null);

  const noDenominator = good(); noDenominator.evidence = [{ metric: 'likes', k: 37, window: '30d', source: 'perf' }];
  const r2 = validateBet(noDenominator, { nowMs: NOW });
  assert.ok(r2.errors.some(e => /evidence\[0\]\.n must be a positive number/.test(e)), 'a number without a denominator is not evidence');

  const kGtN = good(); kGtN.evidence[0].k = 20;
  assert.ok(validateBet(kGtN).errors.some(e => /cannot exceed n/.test(e)));

  const killOnZero = good(); killOnZero.kill.below = 0;
  assert.ok(validateBet(killOnZero).errors.some(e => /kill\.below must be >= 1/.test(e)), 'a kill rule on 0 fires on an unmeasured pipe');

  const killAfterExpected = good(); killAfterExpected.kill.byDay = 40;
  assert.ok(validateBet(killAfterExpected).errors.some(e => /not be later than expected\.byDay/.test(e)));

  const likesExpected = good(); likesExpected.expected.metric = 'avg_likes';
  assert.ok(validateBet(likesExpected).errors.some(e => /expected\.metric must be one of/.test(e)), 'expected effect must be a people metric');

  const freeText = good(); freeText.mechanism = 'viral growth hacking';
  assert.ok(validateBet(freeText).errors.some(e => /mechanism must be one of/.test(e)));
  assert.ok(MECHANISMS.indexOf('copy_variant') !== -1, 'experiments are copy_variant bets');
}

// 4. betKey dedup: running → blocked; lost recently → blocked unless evidence is newer; old loss → allowed.
{
  const key = 'broadcast_post|ambientscore|social-bluesky|any';
  const running = [{ id: 'c1', status: 'active', bet: { betKey: key } }];
  assert.strictEqual(checkBetKeyAgainst(key, '2026-10-05', running, [], NOW).reason, 'betkey_already_running');
  assert.strictEqual(checkBetKeyAgainst(key, '2026-10-05', [{ id: 'c1', status: 'paused', bet: { betKey: key } }], [], NOW).reason, 'betkey_already_running');

  const lostRecently = [{ betKey: key, result: 'lost', scoredAt: daysAgo(10), campaignId: 'c0' }];
  const r = checkBetKeyAgainst(key, '2026-09-20', [], lostRecently, NOW);
  assert.strictEqual(r.reason, 'betkey_lost_recently');
  assert.strictEqual(r.matchId, 'c0');

  const newer = checkBetKeyAgainst(key, new Date(NOW - 2 * 86400000).toISOString().slice(0, 10), [], lostRecently, NOW);
  assert.strictEqual(newer.blocked, false, 'evidence dated after the verdict clears the block');

  const oldLoss = [{ betKey: key, result: 'killed', scoredAt: daysAgo(LOST_BLOCK_DAYS + 5), campaignId: 'c0' }];
  assert.strictEqual(checkBetKeyAgainst(key, '2026-01-01', [], oldLoss, NOW).blocked, false, 'a loss older than the block window does not bind');

  const viaCampaign = [{ id: 'c9', status: 'killed', bet: { betKey: key }, verdict: { result: 'killed', scoredAt: daysAgo(3) } }];
  assert.strictEqual(checkBetKeyAgainst(key, '2026-09-01', viaCampaign, [], NOW).reason, 'betkey_lost_recently', 'verdicts on campaigns count even without a ledger row');

  assert.strictEqual(checkBetKeyAgainst('other|key|x|any', '2026-10-05', running, lostRecently, NOW).blocked, false);
}

// 5. newestEvidenceAsOf picks the latest date.
{
  assert.strictEqual(newestEvidenceAsOf({ evidence: [{ asOf: '2026-09-01' }, { asOf: '2026-10-02' }, {}] }), '2026-10-02');
  assert.strictEqual(newestEvidenceAsOf({}), null);
}

console.log('bet-schema.test.js: all assertions passed');
