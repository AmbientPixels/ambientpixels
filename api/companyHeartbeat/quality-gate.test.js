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

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
