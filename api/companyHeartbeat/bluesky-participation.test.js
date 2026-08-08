// Run with: node api/companyHeartbeat/bluesky-participation.test.js
//
// The auto-draft lane. blueskyCandidates held 200 threads discovered since
// 2026-07-02 and exactly ONE had ever been drafted, because drafting required a
// human to click each candidate on the dashboard. This turns the top-scoring
// ones into CEO-gated draft tasks automatically.
//
// The hard constraint is what separates this from the prospect pipeline that was
// killed on 2026-08-05 after 40 replies produced 0 clicks: a participation reply
// carries NO link and mentions NO product. Its only job is to be worth reading,
// and the reach comes from being visible in someone else's thread.
//
// Two of these tests exist purely to keep that constraint true against machinery
// that would otherwise break it: agent-runner injects a product URL into any
// bluesky-reply task carrying a [SCAN RESULT] comment or a destinationUrl.

const assert = require('assert');
const P = require('./bluesky-participation');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const NOW = Date.parse('2026-08-08T18:00:00Z');
const HOUR = 3600 * 1000;
const iso = ms => new Date(ms).toISOString();

const cand = o => Object.assign({
  id: 'bsc-1', uri: 'at://x/1', cid: 'cid1', author: 'someone.bsky.social', authorDid: 'did:plc:1',
  text: 'I have been rewriting my resume for three weeks and still hear nothing back from anyone.',
  indexedAt: iso(NOW - HOUR), discoveredAt: iso(NOW - HOUR),
  replyCount: 4, likeCount: 9, score: 70, status: 'new'
}, o);

const cfg = P.loadConfig({});

// ── config ──

t('the lane is OFF until it is explicitly switched on', function () {
  assert.strictEqual(P.loadConfig({}).enabled, false, 'a new outbound lane must not self-start');
  assert.strictEqual(P.loadConfig({ blueskyParticipation: { enabled: true } }).enabled, true);
});

t('systemConfig overrides individual knobs without dropping the rest', function () {
  const c = P.loadConfig({ blueskyParticipation: { maxPerDay: 7 } });
  assert.strictEqual(c.maxPerDay, 7);
  assert.ok(Number.isFinite(c.perAuthorCooldownDays), 'unset knobs must keep their defaults');
});

// ── selection ──

t('a good fresh candidate is selected', function () {
  const r = P.selectForDrafting([cand()], [], cfg, NOW);
  assert.strictEqual(r.survivors.length, 1, JSON.stringify(r.drops));
});

t('only status=new is eligible', function () {
  const r = P.selectForDrafting([cand({ status: 'replied' }), cand({ uri: 'at://x/2', status: 'dismissed' })], [], cfg, NOW);
  assert.strictEqual(r.survivors.length, 0);
  assert.strictEqual(r.drops.not_new, 2);
});

t('stale threads are dropped — a reply to a two-day-old post is shouting into a closed room', function () {
  const r = P.selectForDrafting([cand({ indexedAt: iso(NOW - 48 * HOUR) })], [], cfg, NOW);
  assert.strictEqual(r.survivors.length, 0);
  assert.strictEqual(r.drops.too_old, 1);
});

t('low-scoring candidates are dropped even though discovery kept them', function () {
  // Discovery keeps anything >= 40. Drafting is pickier on purpose.
  const r = P.selectForDrafting([cand({ score: 41 })], [], cfg, NOW);
  assert.strictEqual(r.drops.low_score, 1);
});

t('a thread with almost no text gives nothing to reply to', function () {
  const r = P.selectForDrafting([cand({ text: 'ugh' })], [], cfg, NOW);
  assert.strictEqual(r.drops.too_short, 1);
});

t('a thread we already have a reply task for is never drafted twice', function () {
  const tasks = [{ tags: ['bluesky-reply'], threadContext: { uri: 'at://x/1' }, createdAt: iso(NOW - 300 * HOUR) }];
  const r = P.selectForDrafting([cand()], tasks, cfg, NOW);
  assert.strictEqual(r.drops.already_tasked, 1);
});

t('one person is not replied to twice inside the cooldown, across ANY lane', function () {
  // The history comes from every bluesky-reply task, not just this lane's, so
  // prospect + participation cannot tag-team the same stranger.
  const tasks = [{ tags: ['bluesky-reply', 'as-prospect'], threadContext: { uri: 'at://other', author: 'someone.bsky.social' }, createdAt: iso(NOW - 24 * HOUR) }];
  const r = P.selectForDrafting([cand()], tasks, cfg, NOW);
  assert.strictEqual(r.drops.author_cooldown, 1);
});

t('two candidates from the same author in one run cannot both pass', function () {
  const r = P.selectForDrafting([cand({ uri: 'at://a' }), cand({ uri: 'at://b' })], [], cfg, NOW);
  assert.strictEqual(r.survivors.length, 1);
  assert.strictEqual(r.drops.author_cooldown, 1);
});

t('the daily budget counts what this lane already drafted today', function () {
  const today = [];
  for (let i = 0; i < cfg.maxPerDay; i++) {
    today.push({ tags: ['bluesky-reply', 'participation'], threadContext: { uri: 'at://done' + i, author: 'other' + i }, createdAt: iso(NOW - HOUR) });
  }
  const r = P.selectForDrafting([cand()], today, cfg, NOW);
  assert.strictEqual(r.survivors.length, 0);
  assert.strictEqual(r.drops.daily_budget, 1);
});

t('the highest-scoring thread wins the slot, not the first one seen', function () {
  const c = P.loadConfig({ blueskyParticipation: { maxPerDay: 1 } });
  const r = P.selectForDrafting([
    cand({ uri: 'at://low', author: 'a.bsky.social', score: 56 }),
    cand({ uri: 'at://high', author: 'b.bsky.social', score: 95 })
  ], [], c, NOW);
  assert.strictEqual(r.survivors.length, 1);
  assert.strictEqual(r.survivors[0].uri, 'at://high');
});

t('every drop reason is counted — a silent cap reads as "nothing was out there"', function () {
  const r = P.selectForDrafting([], [], cfg, NOW);
  ['not_new', 'too_old', 'low_score', 'too_short', 'already_tasked', 'author_cooldown', 'daily_budget']
    .forEach(k => assert.ok(k in r.drops, 'missing drop counter: ' + k));
});

t('malformed candidates and tasks do not crash selection', function () {
  assert.doesNotThrow(function () {
    P.selectForDrafting([null, {}, cand({ indexedAt: 'nope' })], [null, {}, { tags: null }], cfg, NOW);
  });
});

// ── the task, and the no-pitch constraint ──

const task = P.buildParticipationTask(cand(), NOW);

t('the task rides the existing bluesky-reply rails', function () {
  assert.strictEqual(task.taskType, 'bluesky_reply');
  assert.strictEqual(task.assignee, 'scribe');
  assert.strictEqual(task.status, 'todo');
  assert.ok(task.tags.includes('bluesky-reply'), 'without this tag agent-runner never routes it');
  assert.ok(task.tags.includes('participation'), 'without this it cannot be told apart from prospect replies');
});

t('threadContext carries what the reply executor needs to thread', function () {
  assert.strictEqual(task.threadContext.uri, 'at://x/1');
  assert.strictEqual(task.threadContext.cid, 'cid1');
  assert.strictEqual(task.threadContext.author, 'someone.bsky.social');
});

t('NO destinationUrl — agent-runner would otherwise append a product link', function () {
  // agent-runner.js ~2059: `else if (task.destinationUrl)` appends it with
  // "Try it free:". Setting it here would silently turn every participation
  // reply into an ad.
  assert.ok(!('destinationUrl' in task) || !task.destinationUrl,
    'destinationUrl set — the link-repair path would inject a pitch');
});

t('NO [SCAN RESULT] comment — the other link-injection trigger', function () {
  // agent-runner.js ~2050 appends the report link when it finds this comment.
  const comments = task.comments || [];
  assert.ok(!comments.some(c => String(c.text || '').indexOf('[SCAN RESULT]') === 0),
    'a scan comment would trigger report-link injection');
});

t('the brief forbids links and product mentions in the reply itself', function () {
  const d = task.description.toLowerCase();
  assert.ok(/do not include any link|no link/.test(d), 'the no-link rule must be explicit');
  assert.ok(d.includes('do not pitch'), 'the no-pitch rule must be explicit');
  assert.ok(d.includes('resume roast') && d.includes('ambientscore'),
    'naming the products is what stops the model reaching for them');
});

t('the brief gives the model an out instead of forcing a reply', function () {
  // A model with nothing to say will invent something. The prospect pipeline's
  // 40 replies / 0 clicks is what that looks like at scale.
  assert.ok(/nothing specific/i.test(task.description));
});

t('the decline instruction matches what agent-runner actually detects', function () {
  // agent-runner (~2032) treats a deliverable under 5 characters as a decline.
  // An earlier draft of this brief told Scribe to answer "NOTHING TO ADD" — 14
  // characters, which sails past that check and gets POSTED as the reply. The
  // deliverable is the reply; only an empty one is understood as a refusal.
  const d = task.description;
  assert.ok(/LEAVE YOUR DELIVERABLE EMPTY/i.test(d), 'the brief must ask for an EMPTY deliverable');
  assert.ok(!/say exactly "NOTHING TO ADD"/i.test(d), 'a sentinel string would be published verbatim');
  assert.ok(/posted verbatim/i.test(d), 'the brief must say why a written refusal is dangerous');
});

t('the original post is included so the reply can be about what they wrote', function () {
  assert.ok(task.description.includes('still hear nothing back'));
});

console.log('\nparticipation lane tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
