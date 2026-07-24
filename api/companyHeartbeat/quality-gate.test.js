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

test('verdict passes the same copy when an active offer exists', () => {
  const v = QG.composeQualityVerdict({ text: GENESIS_COPY, platform: 'bluesky', offers: [ACTIVE_OFFER] });
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.deterministicFlags.ungroundedOffer, false);
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

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
