// Run with: node api/companyHeartbeat/bluesky-sensor.test.js
//
// Why this module exists at all: the discovery sensor used to live inside
// runAgentHeartbeat() under `if (agentId === 'scout')`. The idle-agent gate
// shipped 2026-08-07 and skips any agent with no assigned tasks BEFORE
// runAgentHeartbeat is called, so the sensor stopped firing that day. Scout was
// skipped with no_assigned_tasks_or_mentions in all 7 cycles that followed and
// blueskyCandidates went 25.7h stale against a 2h cooldown. Nobody noticed,
// because a sensor that stops producing looks exactly like a quiet week.
//
// The sensor makes no LLM call. It is an HTTP search plus arithmetic, so gating
// it on whether an agent has deliberation to do was never right. Pure cores
// live here so the scoring and cooldown can be asserted without a network.

const assert = require('assert');
const S = require('./bluesky-sensor');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const NOW = Date.parse('2026-08-08T18:00:00Z');
const HOUR = 3600 * 1000;
const cand = o => Object.assign({ uri: 'at://x/1', discoveredAt: new Date(NOW).toISOString(), status: 'new' }, o);

// ── cooldown ──

t('an empty store is always due for a scan', function () {
  assert.strictEqual(S.isCooldownElapsed([], NOW, 2 * HOUR), true);
});

t('a scan inside the cooldown is refused', function () {
  const c = [cand({ discoveredAt: new Date(NOW - 30 * 60 * 1000).toISOString() })];
  assert.strictEqual(S.isCooldownElapsed(c, NOW, 2 * HOUR), false);
});

t('a scan past the cooldown is due', function () {
  const c = [cand({ discoveredAt: new Date(NOW - 3 * HOUR).toISOString() })];
  assert.strictEqual(S.isCooldownElapsed(c, NOW, 2 * HOUR), true);
});

t('cooldown reads the NEWEST candidate, not the last array slot', function () {
  // Pruning and the 200-cap reorder this array. Trusting the tail meant an old
  // entry could park at the end and hold the sensor open (or shut) forever.
  const c = [
    cand({ uri: 'a', discoveredAt: new Date(NOW - 10 * HOUR).toISOString() }),
    cand({ uri: 'b', discoveredAt: new Date(NOW - 5 * 60 * 1000).toISOString() }),
    cand({ uri: 'c', discoveredAt: new Date(NOW - 9 * HOUR).toISOString() })
  ];
  assert.strictEqual(S.isCooldownElapsed(c, NOW, 2 * HOUR), false, 'b is 5 minutes old; this is not due');
});

t('candidates with no timestamp do not crash or count as recent', function () {
  assert.strictEqual(S.isCooldownElapsed([cand({ discoveredAt: null }), {}], NOW, 2 * HOUR), true);
});

t('a cooldown of 0 means RUN NOW, not "use the default"', function () {
  // Live bug, 2026-08-08: the shell read the override as
  // `(deps.cooldownMs) || DEFAULTS.cooldownMs`, so ?force=1 passing 0 hit the
  // falsy branch and got the 2h default straight back. The override looked
  // accepted and did nothing — verification silently kept waiting for the timer.
  const justScanned = [cand({ discoveredAt: new Date(NOW - 60 * 1000).toISOString() })];
  assert.strictEqual(S.isCooldownElapsed(justScanned, NOW, 0), true, '0 must bypass the cooldown');
  assert.strictEqual(S.isCooldownElapsed(justScanned, NOW, 2 * HOUR), false, 'and the default must still hold');
});

// ── scoring ──

const raw = o => Object.assign({
  uri: 'at://x/1', text: 'anyone know a good tool for this?',
  indexedAt: new Date(NOW).toISOString(), replyCount: 0, likeCount: 0, _velocity: 0
}, o);

t('a brand new thread scores higher than a two-hour-old one', function () {
  const fresh = S.scoreCandidate(raw({}), NOW);
  const old = S.scoreCandidate(raw({ indexedAt: new Date(NOW - 2 * HOUR).toISOString() }), NOW);
  assert.ok(fresh > old, 'recency must count: ' + fresh + ' vs ' + old);
});

t('recency cannot go negative and drag a good thread below threshold', function () {
  const ancient = S.scoreCandidate(raw({ indexedAt: new Date(NOW - 400 * HOUR).toISOString(), likeCount: 20 }), NOW);
  assert.ok(ancient >= 0, 'score went negative: ' + ancient);
});

t('engagement and velocity are capped so one viral thread cannot dominate', function () {
  const huge = S.scoreCandidate(raw({ replyCount: 9999, likeCount: 9999, _velocity: 9999 }), NOW);
  assert.ok(huge <= 30 + 30 + 20 + 100, 'caps not applied: ' + huge);
});

t('a malformed candidate scores without throwing', function () {
  [{}, { indexedAt: 'not-a-date' }, { text: null }].forEach(function (r) {
    assert.doesNotThrow(function () { S.scoreCandidate(r, NOW); }, JSON.stringify(r));
    assert.ok(Number.isFinite(S.scoreCandidate(r, NOW)), 'non-finite score for ' + JSON.stringify(r));
  });
});

// ── dedup ──

t('URIs already stored, and URIs already replied to, are both excluded', function () {
  const stored = [cand({ uri: 'at://seen' })];
  const tasks = [{ tags: ['bluesky-reply'], threadContext: { uri: 'at://replied' } }];
  const seen = S.collectExistingUris(stored, tasks);
  assert.ok(seen.has('at://seen'));
  assert.ok(seen.has('at://replied'), 'a thread we already replied to must never resurface');
  assert.ok(!seen.has('at://fresh'));
});

t('tasks without the bluesky-reply tag are ignored', function () {
  const seen = S.collectExistingUris([], [{ tags: ['social-copy'], threadContext: { uri: 'at://other' } }]);
  assert.strictEqual(seen.size, 0);
});

t('malformed tasks and candidates do not crash dedup', function () {
  assert.doesNotThrow(function () {
    S.collectExistingUris([null, {}, cand({ uri: null })], [null, {}, { tags: null }, { tags: ['bluesky-reply'] }]);
  });
});

// ── prune ──

t('dismissed candidates older than the retention window are dropped', function () {
  const keep = cand({ uri: 'k', status: 'dismissed', discoveredAt: new Date(NOW - 2 * 24 * HOUR).toISOString() });
  const drop = cand({ uri: 'd', status: 'dismissed', discoveredAt: new Date(NOW - 30 * 24 * HOUR).toISOString() });
  const out = S.pruneCandidates([keep, drop], NOW, 200);
  assert.deepStrictEqual(out.map(c => c.uri), ['k']);
});

t('new and replied candidates are never dropped by age', function () {
  const old = new Date(NOW - 365 * 24 * HOUR).toISOString();
  const out = S.pruneCandidates([cand({ uri: 'n', status: 'new', discoveredAt: old }),
                                 cand({ uri: 'r', status: 'replied', discoveredAt: old })], NOW, 200);
  assert.strictEqual(out.length, 2);
});

t('the cap keeps the NEWEST candidates, not the first ones found', function () {
  // The old implementation sliced the tail of an append-ordered array, which is
  // the same thing only as long as nothing ever reorders it.
  const many = [];
  for (let i = 0; i < 10; i++) many.push(cand({ uri: 'u' + i, discoveredAt: new Date(NOW - (10 - i) * HOUR).toISOString() }));
  const out = S.pruneCandidates(many, NOW, 3);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map(c => c.uri).sort(), ['u7', 'u8', 'u9']);
});

console.log('\nbluesky sensor tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
