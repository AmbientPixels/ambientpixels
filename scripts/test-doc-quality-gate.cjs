// test-doc-quality-gate.cjs — unit tests for the shared blog/long-form quality-gate
// decision helper (api/companyHeartbeat/doc-quality-gate.js).
//
// Why this exists: blog posts written via execute-task hit the AUTO-DOC fallback
// (agent-runner.js ~2114) which created the marketing_post WITHOUT running the
// Haiku fact-check. The "Heartbeat Diaries" fabrication (2026-06-17) reached the
// approval queue with a BLANK qualityGate stamp because of that bypass. The gate
// decision is now extracted into evaluateDocQualityGate() so BOTH doc-creation
// paths share one tested rule, and the LLM call is INJECTED so this runs offline
// (no API key, no network).
//
// Run: node scripts/test-doc-quality-gate.cjs   (exit 0 = all pass)

const path = require('path');
const { evaluateDocQualityGate } = require(path.join(__dirname, '..', 'api', 'companyHeartbeat', 'doc-quality-gate.js'));

const ctx = { log: function () {} };
const LONG = 'x'.repeat(200); // content over the min-length threshold

// ── tiny async assert harness (mirrors scripts/test-quality-gate-leaks.cjs) ──
let pass = 0, fail = 0;
async function check(name, fn) {
  let ok = false, detail = '';
  try { const r = await fn(); ok = r === true; if (!ok) detail = String(r); }
  catch (e) { ok = false; detail = 'threw: ' + (e && e.message ? e.message : e); }
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}

(async function () {
  console.log('\n== doc quality-gate decision ==');

  // 1. High-confidence Haiku rejection → caller must NOT store the doc.
  await check('high-confidence fail → rejected, no stamp, issues surfaced', async () => {
    const stub = async () => ({ pass: false, confidence: 85, issues: ['fabricated incident: no June 16 outage'] });
    const r = await evaluateDocQualityGate({ title: 'Heartbeat Diaries', contentMd: LONG, kind: 'marketing_post', validate: stub, context: ctx });
    return r.rejected === true && r.qualityGate === null && r.issues[0].indexOf('fabricated') !== -1;
  });

  // 2. Pass → not rejected, stamped with the real verdict + rule list.
  await check('pass → not rejected, stamped pass:true, rulesChecked present', async () => {
    const stub = async () => ({ pass: true, confidence: 90, issues: [] });
    const r = await evaluateDocQualityGate({ title: 'T', contentMd: LONG, kind: 'marketing_post', validate: stub, context: ctx });
    return r.rejected === false && r.qualityGate.pass === true && !r.qualityGate.failOpen
      && r.qualityGate.rulesChecked.indexOf('hallucinated-features') !== -1;
  });

  // 3. LLM unavailable (validate returns null) → fail-open stamp, doc still stored.
  await check('validate null → fail-open stamp (haiku-unavailable), not rejected', async () => {
    const stub = async () => null;
    const r = await evaluateDocQualityGate({ title: 'T', contentMd: LONG, kind: 'marketing_post', validate: stub, context: ctx });
    return r.rejected === false && r.qualityGate.failOpen === true
      && r.qualityGate.failOpenReason === 'haiku-unavailable' && r.qualityGate.pass === true;
  });

  // 4. validate throws → fail-open (never blocks the pipeline on infra error).
  await check('validate throws → fail-open, not rejected', async () => {
    const stub = async () => { throw new Error('network down'); };
    const r = await evaluateDocQualityGate({ title: 'T', contentMd: LONG, kind: 'marketing_post', validate: stub, context: ctx });
    return r.rejected === false && r.qualityGate.failOpen === true && r.qualityGate.failOpenReason === 'haiku-unavailable';
  });

  // 5. Too-short content → fail-open without calling the LLM at all.
  await check('content too short → fail-open (content-too-short), validate NOT called', async () => {
    let called = false;
    const stub = async () => { called = true; return { pass: false, confidence: 100, issues: ['x'] }; };
    const r = await evaluateDocQualityGate({ title: 'T', contentMd: 'too short', kind: 'marketing_post', validate: stub, context: ctx });
    return r.rejected === false && r.qualityGate.failOpen === true
      && r.qualityGate.failOpenReason === 'content-too-short' && called === false;
  });

  // 6. Low-confidence fail (<70) → soft, NOT rejected, but verdict stamped honestly.
  await check('low-confidence fail (<70) → not rejected, stamped pass:false', async () => {
    const stub = async () => ({ pass: false, confidence: 40, issues: ['minor tone nit'] });
    const r = await evaluateDocQualityGate({ title: 'T', contentMd: LONG, kind: 'marketing_post', validate: stub, context: ctx });
    return r.rejected === false && r.qualityGate.pass === false && r.qualityGate.confidence === 40;
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail === 0 ? 0 : 1);
})();
