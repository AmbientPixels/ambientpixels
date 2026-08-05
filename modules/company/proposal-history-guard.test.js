// Run with: node modules/company/proposal-history-guard.test.js
//
// Covers the prior-decision guard in actions.html — the check that surfaces
// "you already rejected/canceled this" before a proposal can be approved.
//
// Why it exists: "Operation: Budget Lockdown" reached a live campaign three
// separate times (rejected 08-01, rejected 08-02, approved by misclick and
// canceled 08-03, then re-proposed and re-approved 08-05). The server's semantic
// dedup deliberately ignores canceled campaigns so a genuinely revived idea is
// not blocked forever, which leaves the CEO as the only check. Three misclicks
// is a UI problem, so the receipts now render on the card and in the drawer, and
// Approve is gated behind a confirm.
//
// The guard lives as inline JS in actions.html, so this test extracts the pure
// functions by name and evaluates them. If a function is renamed, this test fails
// loudly rather than silently covering nothing.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const HTML = path.join(__dirname, 'actions.html');
const src = fs.readFileSync(HTML, 'utf8');

function grabFn(name) {
  const i = src.indexOf('function ' + name);
  assert.ok(i >= 0, 'actions.html no longer defines ' + name + ' — guard may have been removed or renamed');
  let depth = 0;
  const start = src.indexOf('{', i);
  for (let k = start; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

const stopwords = src.match(/var _PD_STOPWORDS = \{[^}]*\};/);
const threshold = src.match(/var _PD_MATCH = [0-9.]+;/);
assert.ok(stopwords && threshold, 'actions.html no longer defines _PD_STOPWORDS / _PD_MATCH');

global.window = {};
eval(stopwords[0] + threshold[0] + ['_pdTokens', '_pdSimilar', '_pdRejectedRows', '_pdKilledRows', '_pdAllRows', '_pdPriorDecisions'].map(grabFn).join('\n'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

// Mirrors the real history that produced the incident.
window._proposalDecisionIndex = {
  queue: _pdRejectedRows([
    { status: 'rejected', name: 'Operation: Budget Lockdown', resolvedAt: '2026-08-01T10:00:00Z', ceoNote: 'budget work lives as tasks under obj-ms98rscb-ilkj, never a public social campaign' },
    { status: 'rejected', name: 'Operation: Budget Lockdown', resolvedAt: '2026-08-02T09:00:00Z', ceoNote: 'rejected again' },
    { status: 'pending', name: 'Something Still Pending', resolvedAt: '' }
  ]),
  campaigns: _pdKilledRows([
    { status: 'canceled', title: 'Operation: Budget Lockdown', canceledAt: '2026-08-03T03:52:00Z', cancelReason: 'accidental approval after two explicit rejections' },
    { status: 'canceled', title: 'Operation: Budget Compliance', canceledAt: '2026-08-01T00:00:00Z', cancelReason: 'internal-ops navel-gazing' },
    { status: 'active', title: 'Search-Intent Content' }
  ]),
  objectives: []
};

console.log('the case that recurred three times:');
t('an identical re-proposal surfaces all three prior decisions', () =>
  assert.strictEqual(_pdPriorDecisions('Operation: Budget Lockdown').length, 3));
t('both rejections are included', () =>
  assert.strictEqual(_pdPriorDecisions('Operation: Budget Lockdown').filter(h => h.kind === 'rejected').length, 2));
t('the cancellation is included', () =>
  assert.strictEqual(_pdPriorDecisions('Operation: Budget Lockdown').filter(h => h.kind === 'canceled').length, 1));
t('the cancel reason reaches the CEO', () =>
  assert.match(_pdPriorDecisions('Operation: Budget Lockdown').find(h => h.kind === 'canceled').note, /accidental approval/));

console.log('re-skins — the actual point, since server dedup ignores canceled work:');
t('"Budget Lockdown Initiative" is caught', () =>
  assert.ok(_pdPriorDecisions('Budget Lockdown Initiative').length > 0));
t('"Operation Budget Lockdown v2" is caught', () =>
  assert.ok(_pdPriorDecisions('Operation Budget Lockdown v2').length > 0));

console.log('calibration — a banner that fires on everything gets ignored:');
t('a merely-adjacent sibling does not fire', () =>
  assert.strictEqual(_pdPriorDecisions('Operation: Budget Compliance').filter(h => h.name === 'Operation: Budget Lockdown').length, 0));
t('sharing only a product name does not fire', () =>
  assert.strictEqual(_pdPriorDecisions('AmbientScore Launch Week').length, 0));
t('unrelated demand work is clean', () =>
  assert.strictEqual(_pdPriorDecisions('Search-Intent Content').length, 0));

console.log('hygiene:');
t('active campaigns are never treated as prior decisions', () =>
  assert.ok(!_pdAllRows().some(r => r.name === 'Search-Intent Content')));
t('pending proposals are not decisions', () =>
  assert.ok(!_pdAllRows().some(r => r.name === 'Something Still Pending')));
t('an empty name is safe', () =>
  assert.strictEqual(_pdPriorDecisions('').length, 0));
t('a missing index is safe', () => {
  const saved = window._proposalDecisionIndex;
  window._proposalDecisionIndex = undefined;
  assert.strictEqual(_pdPriorDecisions('anything').length, 0);
  window._proposalDecisionIndex = saved;
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
