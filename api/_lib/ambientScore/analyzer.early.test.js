// Run with: node api/_lib/ambientScore/analyzer.early.test.js
// The free teaser (score, grade, top findings) is complete once computeScore runs; the
// synthesis call only feeds the paid report. analyze() must hand the scored report to
// opts.onScored BEFORE synthesis starts, so a visitor isn't kept waiting for paid-only work.
// All dependencies are stubbed: no network, no model calls.
const assert = require('assert');
const path = require('path');

const order = [];
function stub(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub('./scraper', { scrapeUrl: async () => ({ finalUrl: 'https://acme.example/', wordCount: 400, jsRenderedWarning: null }) });
stub('./promptBuilder', {
  buildExtractionPrompt: () => 'extract', buildClassificationPrompt: () => 'classify',
  buildGroupEvalPrompt: (g) => 'eval-' + g, buildSynthesisPrompt: () => 'synth'
});
stub('./dimensions', { GROUPS: { A: {}, B: {} }, WEIGHT_PROFILES: { direct_response_saas: { label: 'SaaS' } } });
stub('./scorer', {
  computeScore: () => {
    order.push('score');
    return {
      score: 70, grade: 'C', rawScoreAvg: 6,
      dimensions: { cta: { score: 40, label: 'CTA Strength' }, trust: { score: 80, label: 'Trust Signals' } },
      findings: [{ finding: 'Primary CTA is vague', recommendation: 'Name the outcome', estimatedImpact: 'high' }],
      teaserFindings: [{ finding: 'Primary CTA is vague' }], totalFindings: 1, disclaimer: null
    };
  }
});
let synthBehaviour = 'ok';
stub('../llm', {
  LlmUnavailableError: class extends Error {},
  callModel: async (o) => {
    if (o.caller === 'as-synthesis' || o.caller === 'as-synthesis-retry') {
      order.push('synthesis');
      if (synthBehaviour === 'fail') throw new Error('boom');
      return { text: JSON.stringify({ executiveSummary: 'Real synthesis.' }) };
    }
    if (o.caller === 'as-classification') return { text: JSON.stringify({ siteType: 'direct_response_saas', confidence: 'high' }) };
    if (o.caller.indexOf('as-eval-group-') === 0) return { text: JSON.stringify({ ['dim_' + o.caller.slice(-1)]: { score: 5 } }) };
    return { text: JSON.stringify({ headline: 'x' }) };
  }
});

const { analyze } = require('./analyzer');

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('onScored receives the scored report before synthesis starts', async () => {
  order.length = 0; synthBehaviour = 'ok';
  let early = null;
  const result = await analyze('https://acme.example', { onScored: async (r) => { order.push('onScored'); early = r; } });
  assert.deepStrictEqual(order, ['score', 'onScored', 'synthesis']);
  assert.strictEqual(early.score, 70);
  assert.strictEqual(early.grade, 'C');
  assert.deepStrictEqual(early.teaserFindings, [{ finding: 'Primary CTA is vague' }]);
  assert.strictEqual(early.synthesisPending, true, 'early report is flagged as pending synthesis');
  assert.strictEqual(early.synthesis.degraded, true, 'a paid viewer opening early still gets a usable summary');
  assert.ok(Number.isFinite(early.metadata.teaserReadyMs), 'records when the teaser became ready');
  // the final report is the real one
  assert.strictEqual(result.fullReport.synthesis.executiveSummary, 'Real synthesis.');
  assert.strictEqual(result.fullReport.synthesisPending, undefined);
  assert.ok(Number.isFinite(result.fullReport.metadata.synthTimeMs), 'synthesis duration measured');
  assert.strictEqual(result.fullReport.metadata.teaserReadyMs, early.metadata.teaserReadyMs);
});

test('a failing onScored never breaks the analysis', async () => {
  synthBehaviour = 'ok';
  const result = await analyze('https://acme.example', { onScored: async () => { throw new Error('blob down'); } });
  assert.strictEqual(result.score, 70);
  assert.strictEqual(result.fullReport.synthesis.executiveSummary, 'Real synthesis.');
});

test('without onScored the pipeline behaves as before', async () => {
  order.length = 0; synthBehaviour = 'ok';
  const result = await analyze('https://acme.example');
  assert.deepStrictEqual(order, ['score', 'synthesis']);
  assert.strictEqual(result.fullReport.synthesisPending, undefined);
});

test('synthesis failure still ends in a complete report (fallback), not pending', async () => {
  synthBehaviour = 'fail';
  const result = await analyze('https://acme.example', { onScored: async () => {} });
  assert.strictEqual(result.fullReport.synthesis.degraded, true);
  assert.strictEqual(result.fullReport.synthesisPending, undefined);
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); pass++; console.log('  PASS ', t.name); }
    catch (e) { fail++; console.log('  FAIL ', t.name, '\n        ', e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
