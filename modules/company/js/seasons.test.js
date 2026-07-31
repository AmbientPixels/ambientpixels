// Run with: node modules/company/js/seasons.test.js
const assert = require('assert');
const S = require('./seasons.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const agent = (seasonXp, revenueXp, extra) => Object.assign({
  xp: seasonXp, seasonXp, seasonRevenueXp: revenueXp, revenueRecent: [], ladderStatus: 'safe'
}, extra || {});

// ── seasonState ──
test('a season with no par reads as unscored', () => {
  assert.strictEqual(S.seasonState({ seasonMeta: { par: null } }), 'unscored');
  assert.strictEqual(S.seasonState({ seasonMeta: {} }), 'unscored');
  assert.strictEqual(S.seasonState({}), 'unscored');
  assert.strictEqual(S.seasonState({ seasonMeta: { par: 40 } }), 'scored');
});

// ── standings ──
test('standings rank by season XP, tie-break on lifetime XP, then id', () => {
  const r = { perAgent: {
    echo: agent(100, 50), scribe: agent(100, 0, { xp: 700 }), nova: agent(10, 0), quill: agent(10, 0, { xp: 5 })
  } };
  const ids = S.seasonStandings(r).map(x => x.id);
  // scribe ties echo on season XP but has more lifetime XP -> ranks first
  assert.deepStrictEqual(ids, ['scribe', 'echo', 'nova', 'quill']);
});

test('standings exclude non-fleet ledger entries such as ceo', () => {
  const r = { perAgent: { echo: agent(10, 0), ceo: agent(9999, 9999) } };
  const ids = S.seasonStandings(r).map(x => x.id);
  assert.deepStrictEqual(ids, ['echo'], 'ceo must never appear in standings');
});

test('standings split revenue XP from churn XP', () => {
  const r = { perAgent: { echo: agent(168, 148) } };
  const row = S.seasonStandings(r)[0];
  assert.strictEqual(row.revenueXp, 148);
  assert.strictEqual(row.churnXp, 20);
  assert.strictEqual(row.revenueShare, 88);
});

test('an agent with zero season XP reports 0% revenue share, not NaN', () => {
  const row = S.seasonStandings({ perAgent: { nova: agent(0, 0) } })[0];
  assert.strictEqual(row.revenueShare, 0);
  assert.strictEqual(row.churnXp, 0);
});

test('privilege tier falls back to line when privileges are absent or disabled', () => {
  const base = { perAgent: { echo: agent(5, 0) } };
  assert.strictEqual(S.seasonStandings(base)[0].tier, 'line');
  const disabled = { perAgent: { echo: agent(5, 0) }, privileges: { enabled: false, tiers: { echo: 'probation' } } };
  assert.strictEqual(S.seasonStandings(disabled)[0].tier, 'line', 'disabled privileges must not show a tier');
  const live = { perAgent: { echo: agent(5, 0) }, privileges: { enabled: true, tiers: { echo: 'vanguard' } } };
  assert.strictEqual(S.seasonStandings(live)[0].tier, 'vanguard');
});

// ── parProgress ──
test('par progress is null when unscored and clamps to 0-100 when scored', () => {
  assert.strictEqual(S.parProgress(20, null), null, 'unscored -> no bar');
  assert.strictEqual(S.parProgress(20, 40), 50);
  assert.strictEqual(S.parProgress(999, 40), 100, 'clamped');
  assert.strictEqual(S.parProgress(0, 40), 0);
});

// ── daysLeft ──
test('daysLeft counts to the end of the season month, including December rollover', () => {
  assert.strictEqual(S.daysLeft('2026-08', Date.UTC(2026, 7, 21)), 11);
  assert.strictEqual(S.daysLeft('2026-12', Date.UTC(2026, 11, 30)), 2, 'December rolls into January');
  assert.strictEqual(S.daysLeft('2026-08', Date.UTC(2026, 8, 5)), 0, 'never negative');
  assert.strictEqual(S.daysLeft('garbage', Date.now()), null);
});

// ── effortVsOutcome ──
test('effort vs outcome reports the fleet revenue share and counts earners', () => {
  const r = { perAgent: {
    echo: agent(168, 148), scribe: agent(148, 148), nova: agent(20, 0), quill: agent(0, 0)
  } };
  const eo = S.effortVsOutcome(r);
  assert.strictEqual(eo.totalSeasonXp, 336);
  assert.strictEqual(eo.totalRevenueXp, 296);
  assert.strictEqual(eo.totalChurnXp, 40);
  assert.strictEqual(eo.fleetRevenueShare, 88);
  assert.strictEqual(eo.earningAgents, 2);
  assert.strictEqual(eo.idleAgents, 1);
});

test('a churn-only fleet reports a 0% revenue share — the alarm case', () => {
  const r = { perAgent: { echo: agent(50, 0), scribe: agent(80, 0) } };
  const eo = S.effortVsOutcome(r);
  assert.strictEqual(eo.fleetRevenueShare, 0);
  assert.strictEqual(eo.earningAgents, 0);
  assert.strictEqual(eo.totalChurnXp, 130);
});

// ── attributionSummary ──
test('attribution summary surfaces the unattributed share', () => {
  const a = S.attributionSummary({ attributedRevenueCents: 0, unattributedRevenueCents: 39800 });
  assert.strictEqual(a.totalCents, 39800);
  assert.strictEqual(a.unattributedPct, 100, 'the live case today');
  assert.strictEqual(a.hasRevenue, true);
});

test('attribution summary is safe with no revenue at all', () => {
  const a = S.attributionSummary({});
  assert.strictEqual(a.totalCents, 0);
  assert.strictEqual(a.unattributedPct, 0, 'no divide-by-zero');
  assert.strictEqual(a.hasRevenue, false);
});

// ── revenueEvents ──
test('revenue events are fleet-only, newest first, and window-filtered', () => {
  const r = { perAgent: {
    echo: agent(0, 0, { revenueRecent: [{ at: '2026-07-30T02:00:00Z', xp: 74 }, { at: '2026-06-01T00:00:00Z', xp: 5 }] }),
    ceo: agent(0, 0, { revenueRecent: [{ at: '2026-07-31T00:00:00Z', xp: 999 }] })
  } };
  const all = S.revenueEvents(r, 0);
  assert.strictEqual(all.length, 2, 'ceo entries excluded');
  assert.strictEqual(all[0].xp, 74, 'newest first');
  const windowed = S.revenueEvents(r, Date.parse('2026-07-01T00:00:00Z'));
  assert.strictEqual(windowed.length, 1, 'older event filtered out');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
