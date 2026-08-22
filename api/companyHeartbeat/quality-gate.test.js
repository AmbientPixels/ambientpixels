// quality-gate.test.js — offer-claim detector (2026-07-22)
// Run: node api/companyHeartbeat/quality-gate.test.js
const assert = require('node:assert');
const QG = require('./quality-gate');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '-', e.message); }
}

const NOW = Date.parse('2026-07-22T12:00:00Z');
const GENESIS_COPY = "This is a little scary to share. I'm starting the AmbientScore Genesis Sale today. " +
  "It's a big discount for the very first people who want to try the new tool I've been building. " +
  "Your early support means a lot.\n\nhttps://ambientpixels.ai/ambient-score";
const ACTIVE_OFFER = { name: 'Genesis Sale', code: 'GENESIS', discountPct: 50, active: true, expires: '2026-08-15' };

// ── detectUngroundedOffer ──
test('the real Genesis post with no offers on file is claimed + ungrounded', () => {
  const r = QG.detectUngroundedOffer(GENESIS_COPY, [], NOW);
  assert.strictEqual(r.claimed, true);
  assert.strictEqual(r.grounded, false);
  assert.ok(r.issue && /product-facts/.test(r.issue));
});

test('same copy with an active offer on file is grounded', () => {
  const r = QG.detectUngroundedOffer(GENESIS_COPY, [ACTIVE_OFFER], NOW);
  assert.strictEqual(r.claimed, true);
  assert.strictEqual(r.grounded, true);
});

test('expired offer does not ground a claim', () => {
  const expired = Object.assign({}, ACTIVE_OFFER, { expires: '2026-07-01' });
  const r = QG.detectUngroundedOffer(GENESIS_COPY, [expired], NOW);
  assert.strictEqual(r.grounded, false);
});

test('inactive offer does not ground a claim', () => {
  const off = Object.assign({}, ACTIVE_OFFER, { active: false });
  const r = QG.detectUngroundedOffer(GENESIS_COPY, [off], NOW);
  assert.strictEqual(r.grounded, false);
});

test('offer language variants are claimed: % off, promo code, free trial, half price', () => {
  ['20% off this week', 'use promo code SAVE', 'start your free trial', 'half price for early birds']
    .forEach(t => assert.strictEqual(QG.detectUngroundedOffer(t, [], NOW).claimed, true, t));
});

test('revenue reports are NOT offer claims (first-sale celebration must not block)', () => {
  ['We just made our first sale!', 'Landed a sale today. Small step, real revenue.',
   'Celebrating our first sale this morning']
    .forEach(t => assert.strictEqual(QG.detectUngroundedOffer(t, [], NOW).claimed, false, t));
});

test('free scan / free report / normal copy are NOT offer claims', () => {
  ['Run a free scan of your site today', 'Your free report shows the top findings',
   'We shipped a new feature for AmbientScore', 'Sales teams love dashboards']
    .forEach(t => assert.strictEqual(QG.detectUngroundedOffer(t, [], NOW).claimed, false, t));
});

test('lifetime claim is NOT grounded by a one-time offer (Founders Circle miss)', () => {
  const fc = "I'm opening up a small Founder's Circle to get early feedback. You get a big lifetime discount for helping us out.";
  const r = QG.detectUngroundedOffer(fc, [ACTIVE_OFFER], NOW); // GENESIS is one-time
  assert.strictEqual(r.claimed, true);
  assert.strictEqual(r.grounded, false);
  assert.ok(/lifetime/i.test(r.issue));
});

test('lifetime claim IS grounded by an offer marked lifetime', () => {
  const fc = 'Founders get a lifetime discount on AmbientScore.';
  const lifetimeOffer = Object.assign({}, ACTIVE_OFFER, { lifetime: true });
  assert.strictEqual(QG.detectUngroundedOffer(fc, [lifetimeOffer], NOW).grounded, true);
});

test('non-lifetime claim still grounds against the one-time offer', () => {
  const ok = 'Use code GENESIS for 50% off the $29 audit. First 20 people, ends Aug 5.';
  assert.strictEqual(QG.detectUngroundedOffer(ok, [ACTIVE_OFFER], NOW).grounded, true);
});

// ── detectFabricatedUrl ──
test('invented ambientpixels.ai paths are fabricated (the /score/ incident)', () => {
  ['https://ambientpixels.ai/score/devalvaro.vercel.app',
   'https://ambientpixels.ai/score/report/d4f2ca',
   'https://ambientpixels.ai/founders-circle']
    .forEach(u => assert.strictEqual(QG.detectFabricatedUrl('check it: ' + u).fabricated, true, u));
});

test('real ambientpixels.ai URLs pass', () => {
  ['https://ambientpixels.ai/ambientscore/report.html?id=ccr_1784680800286_19e6ca54',
   'https://ambientpixels.ai/ambient-score?utm_source=bluesky&utm_content=act_x',
   'https://ambientpixels.ai/ambient-score', 'https://ambientpixels.ai/pulse/',
   'https://ambientpixels.ai/blog/some-post', 'https://ambientpixels.ai/',
   'https://ambientpixels.ai']
    .forEach(u => assert.strictEqual(QG.detectFabricatedUrl('see ' + u).fabricated, false, u));
});

test('external URLs are never our problem', () => {
  assert.strictEqual(QG.detectFabricatedUrl('congrats on https://kempock.com launch').fabricated, false);
  assert.strictEqual(QG.detectFabricatedUrl('nice site delilahsdawson.com!').fabricated, false);
});

test('invented brand DOMAINS are fabricated, scheme or not (the ambientscore.ai incident)', () => {
  ['ambientscore.ai/s/delilahsdawson-com',
   'https://ambientscore.ai/report/x',
   'http://www.ambient-score.io/x',
   'ambientos.com/dashboard',
   'ambientpixels.com/ambient-score']
    .forEach(u => assert.strictEqual(QG.detectFabricatedUrl('link: ' + u).fabricated, true, u));
});

test('the real domain passes with or without scheme', () => {
  ['ambientpixels.ai/ambient-score',
   'www.ambientpixels.ai/pulse/',
   'https://ambientpixels.ai/ambientscore/report.html?id=ccr_abc123']
    .forEach(u => assert.strictEqual(QG.detectFabricatedUrl('see ' + u).fabricated, false, u));
});

test('bare-domain fabricated PATHS on the real domain are also caught', () => {
  assert.strictEqual(QG.detectFabricatedUrl('report: ambientpixels.ai/score/foo').fabricated, true);
});

test('verdict hard-fails copy carrying a fabricated own-domain URL', () => {
  const v = QG.composeQualityVerdict({ text: 'Free report here: https://ambientpixels.ai/score/report/abc123', platform: 'bluesky', offers: [] });
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.deterministicFlags.fabricatedUrl, true);
  assert.ok(v.issues.some(i => /fabricated|does not exist/i.test(i)));
});

// ── composeQualityVerdict integration ──
test('verdict hard-fails offer-claiming copy when no active offers exist', () => {
  const v = QG.composeQualityVerdict({ text: GENESIS_COPY, platform: 'bluesky', offers: [] });
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.confidence, 100);
  assert.strictEqual(v.deterministicFlags.ungroundedOffer, true);
  assert.ok(v.issues.some(i => /offer|discount/i.test(i) && /product-facts/.test(i)));
});

// nowMs is pinned: ACTIVE_OFFER expires 2026-08-15, so a wall-clock read made this
// test start failing on 2026-08-16 for a reason that has nothing to do with the gate.
// An offer-grounding test must control "now" or it is a dated bomb, not a test.
test('verdict passes the same copy when an active offer exists', () => {
  const v = QG.composeQualityVerdict({
    text: GENESIS_COPY, platform: 'bluesky', offers: [ACTIVE_OFFER],
    nowMs: Date.parse('2026-08-10T00:00:00Z')
  });
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.deterministicFlags.ungroundedOffer, false);
});

test('an offer past its expiry no longer grounds the claim', () => {
  const v = QG.composeQualityVerdict({
    text: GENESIS_COPY, platform: 'bluesky', offers: [ACTIVE_OFFER],
    nowMs: Date.parse('2026-08-20T00:00:00Z')
  });
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.deterministicFlags.ungroundedOffer, true);
});

test('non-offer copy is unaffected by the offers list', () => {
  const v = QG.composeQualityVerdict({ text: 'We shipped a new feature today. Details on the blog.', platform: 'bluesky', offers: [] });
  assert.strictEqual(v.deterministicFlags.ungroundedOffer, false);
  assert.strictEqual(v.pass, true);
});

// ── per-platform length caps (2026-07-22 — over-limit posts shipping cut off) ──
const LONG_TAIL = '\n\nhttps://ambientpixels.ai/pulse/?utm_source=bluesky&utm_content=act_1784692937685_vr29ey';

test('bluesky copy over 300 chars hard-fails with the length issue', () => {
  const text = 'a'.repeat(260) + LONG_TAIL; // 260 + 90 = 350 chars
  const v = QG.composeQualityVerdict({ text, platform: 'bluesky', offers: [] });
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.confidence, 100);
  assert.strictEqual(v.deterministicFlags.overlong, true);
  assert.ok(v.issues.some(i => /platform cap is 300/.test(i)));
});

test('x copy over 280 chars hard-fails; 280 exactly passes', () => {
  const over = QG.composeQualityVerdict({ text: 'a'.repeat(281), platform: 'x', offers: [] });
  assert.strictEqual(over.deterministicFlags.overlong, true);
  const atCap = QG.composeQualityVerdict({ text: 'a'.repeat(280), platform: 'x', offers: [] });
  assert.strictEqual(atCap.deterministicFlags.overlong, false);
});

test('bluesky copy within 300 chars passes the length check', () => {
  const text = 'a'.repeat(200) + LONG_TAIL; // 290 chars
  const v = QG.composeQualityVerdict({ text, platform: 'bluesky', offers: [] });
  assert.strictEqual(v.deterministicFlags.overlong, false);
});

test('linkedin keeps its 1500 hard line', () => {
  const v = QG.composeQualityVerdict({ text: 'a'.repeat(1501), platform: 'linkedin', offers: [] });
  assert.strictEqual(v.deterministicFlags.overlong, true);
  assert.ok(v.issues.some(i => /1500/.test(i)));
});

test('platforms without a cap (reddit/facebook) are not length-checked', () => {
  const v = QG.composeQualityVerdict({ text: 'a'.repeat(5000), platform: 'reddit', offers: [] });
  assert.strictEqual(v.deterministicFlags.overlong, false);
});

// ── system-claim grounding (2026-08-22 — the p95 victory-lap incident) ────────
// Both fixtures are the real drafted copy. Forge's live reading across both days
// was p95=14207ms RED, unresolved; neither post's numbers reconcile with it.
const P95_BSKY = "Shipped a fix for our agent platform's cold starts. P95 latency was spiking to " +
  "7852ms, which is way too slow. It's now consistently under 800ms. A misconfigured " +
  "azure function was the culprit. #buildinpublic #azure";
const P95_LINKEDIN = "Our p95 latency for a core service spiked to over 14,000ms last week. " +
  "We added a simple in-memory cache. The p95 latency dropped from 14,000ms to under 200ms.";
const REAL_TELEMETRY = { errorIntel: { p50: 1840, p95: 14207, perfAlert: 'p95_red' } };

const groundedAgainst = (text, telemetry, thread) =>
  QG.findUngroundedClaims(text, QG.buildGroundingText(null, null, telemetry, thread));

test('detectSystemClaim fires on a first-person operational metric', () => {
  const c = QG.detectSystemClaim(P95_BSKY);
  assert.strictEqual(c.isClaim, true);
  assert.strictEqual(c.hasFixLanguage, true);
});

test('detectSystemClaim ignores metric talk with no ownership anchor', () => {
  assert.strictEqual(QG.detectSystemClaim('p95 latency is the metric that matters.').isClaim, false);
});

test('detectSystemClaim ignores our-voice copy with no metric', () => {
  assert.strictEqual(QG.detectSystemClaim('We shipped a fix for the signup button today.').isClaim, false);
});

test('the p95 victory-lap posts hard-fail against real telemetry', () => {
  for (const copy of [P95_BSKY, P95_LINKEDIN]) {
    const v = QG.composeQualityVerdict({
      text: copy, platform: 'bluesky', telemetryAvailable: true,
      grounding: groundedAgainst(copy, REAL_TELEMETRY)
    });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.deterministicFlags.ungroundedSystemClaim, true);
    assert.ok(v.issues.some(i => /do not appear in live telemetry/.test(i)));
  }
});

test('a system claim citing the REAL number passes', () => {
  const honest = 'Our p95 latency is sitting at 14207ms and we have not fixed it yet. Working on it.';
  const v = QG.composeQualityVerdict({
    text: honest, platform: 'bluesky', telemetryAvailable: true,
    grounding: groundedAgainst(honest, REAL_TELEMETRY)
  });
  assert.strictEqual(v.deterministicFlags.systemClaim, true);
  assert.strictEqual(v.deterministicFlags.ungroundedSystemClaim, false);
  assert.strictEqual(v.pass, true);
});

test('system claims fail CLOSED when telemetry could not be read', () => {
  const v = QG.composeQualityVerdict({
    text: P95_BSKY, platform: 'bluesky', telemetryAvailable: false,
    grounding: groundedAgainst(P95_BSKY, null)
  });
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.deterministicFlags.unverifiableSystemClaim, true);
  assert.ok(v.issues.some(i => /could not be read/.test(i)));
});

test('non-system copy still fails OPEN when telemetry is unavailable', () => {
  const copy = 'Stop chasing a perfect ATS score. It is not about hitting 100%.';
  const v = QG.composeQualityVerdict({
    text: copy, platform: 'bluesky', telemetryAvailable: false,
    grounding: groundedAgainst(copy, null)
  });
  assert.strictEqual(v.deterministicFlags.systemClaim, false);
  assert.strictEqual(v.pass, true);
});

test('ungrounded numbers OUTSIDE a system claim stay a soft warning', () => {
  // Rhetorical ATS percentages — the false-positive class that kept this soft in v1.
  const copy = 'So what is a good score? Is 80% enough? 90%? The real answer is more complicated.';
  const v = QG.composeQualityVerdict({
    text: copy, platform: 'linkedin', telemetryAvailable: true,
    grounding: groundedAgainst(copy, REAL_TELEMETRY)
  });
  assert.strictEqual(v.pass, true);
  assert.ok(v.deterministicFlags.ungroundedClaims.length > 0);
  assert.ok(v.issues.some(i => /Unverified numbers/.test(i)));
});

test("a stranger's own stat is grounded by their post (reply lane)", () => {
  const reply = '1200 resumes for 2 interviews is brutal. That is often the whole game.';
  const thread = { author: 'technolust.bsky.social', originalText: 'i sent over 1200 resumes in the past 2 years. I had 2 interviews.' };
  const g = groundedAgainst(reply, REAL_TELEMETRY, thread);
  assert.strictEqual(g.ungrounded.length, 0);
  assert.ok(g.grounded.includes('1200'));
});

// ── internal reward mechanics in public copy (2026-08-22) ────────────────────
test('XP announcements are caught as persona leaks', () => {
  const copy = 'The system just pinged me. Milestone: NOTABLE WEEK. It\'s just +14 XP, but it is a ' +
    'good reminder that consistent work adds up. I\'m apparently a "workhorse" now. #buildinpublic';
  const v = QG.composeQualityVerdict({ text: copy, platform: 'bluesky' });
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.deterministicFlags.agentPersona, true);
});

test('"rookie agent" self-description is caught', () => {
  const copy = 'I\'m still a rookie agent, but this was a notable week. I earned +12 XP. ' +
    'The secret was just showing up. #buildinpublic';
  const v = QG.composeQualityVerdict({ text: copy, platform: 'bluesky' });
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.deterministicFlags.agentPersona, true);
});

test('ordinary build-in-public copy is not caught by the XP patterns', () => {
  // "level up" in the ordinary sense, and a number that is not XP, must stay clean.
  const copy = 'Shipped 3 improvements to the editor this week. Small stuff, but it levels up the ' +
    'whole flow. More soon.';
  const v = QG.composeQualityVerdict({ text: copy, platform: 'bluesky' });
  assert.strictEqual(v.deterministicFlags.agentPersona, false);
  assert.strictEqual(v.pass, true);
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
