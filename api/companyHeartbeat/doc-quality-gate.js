// doc-quality-gate.js — shared blog/long-form quality-gate DECISION.
//
// The Haiku content fact-check (factual-accuracy, hallucinated-features,
// fabricated-statistics, tone, brand) used to live inline ONLY in the create-doc
// handler. Blog posts written via execute-task hit the AUTO-DOC fallback path
// (agent-runner.js ~2114), which created the marketing_post WITHOUT running it —
// so a fabricated post ("Heartbeat Diaries", 2026-06-17: a fake outage with
// invented agent dialogue) reached the approval queue with a BLANK qualityGate
// stamp. This module extracts the gate decision so every doc-creation path can
// share one rule. The LLM call is INJECTED (`validate`) so this stays a pure,
// offline-testable decision (scripts/test-doc-quality-gate.cjs).
//
// Parity contract with the create-doc handler:
//   - content <= 40 chars            → fail-open (reason 'content-too-short'), no LLM call
//   - validate() null / throws       → fail-open (reason 'haiku-unavailable')
//   - pass === false && conf >= 70   → REJECTED (caller must not store the doc)
//   - otherwise                      → stamp the real verdict and store

'use strict';

const QG_REJECT_CONFIDENCE = 70;   // fail-closed threshold (matches create-doc handler)
const QG_MIN_CONTENT_CHARS = 40;   // below this we don't bother the LLM
const QG_MODEL = 'claude-haiku-4-5-20251001';
const QG_RULES = ['factual-accuracy', 'hallucinated-features', 'fabricated-statistics', 'tone-violations', 'brand-violations'];

// opts: { title, contentMd, kind, validate, context }
//   validate: async (text, platform, context) => { pass, confidence, issues } | null
// returns: { rejected, qualityGate, issues, reason, confidence }
async function evaluateDocQualityGate(opts) {
  opts = opts || {};
  const title = opts.title || '';
  const contentMd = opts.contentMd || '';
  const kind = opts.kind || 'marketing_post';
  const validate = opts.validate;
  const context = opts.context || { log: function () {} };

  let result = null;
  let reason = null;

  if (contentMd && contentMd.length > QG_MIN_CONTENT_CHARS && typeof validate === 'function') {
    try {
      const text = (title ? title + '\n\n' : '') + contentMd;
      result = await validate(text, 'blog-' + kind, context);
      if (!result) reason = 'haiku-unavailable';
    } catch (err) {
      context.log('[QualityGate] DOC error (fail-open):', String(err).substring(0, 150));
      reason = 'haiku-unavailable';
    }
  } else {
    reason = 'content-too-short';
  }

  // Fail-closed: high-confidence rejection. Caller must NOT store the doc.
  if (result && result.pass === false && (result.confidence || 0) >= QG_REJECT_CONFIDENCE) {
    return {
      rejected: true,
      qualityGate: null,
      issues: result.issues || [],
      reason: 'haiku_rejection_doc',
      confidence: result.confidence || 0
    };
  }

  // Pass / soft-fail / fail-open: stamp and let the caller store the doc.
  let qualityGate;
  if (result) {
    qualityGate = {
      pass: !!result.pass,
      confidence: result.confidence || 0,
      issues: result.issues || [],
      model: QG_MODEL,
      checkedAt: new Date().toISOString(),
      rulesChecked: QG_RULES
    };
  } else {
    qualityGate = {
      pass: true,
      confidence: 0,
      issues: [],
      model: QG_MODEL,
      checkedAt: new Date().toISOString(),
      failOpen: true,
      failOpenReason: reason || 'unknown'
    };
  }

  return {
    rejected: false,
    qualityGate: qualityGate,
    issues: qualityGate.issues,
    reason: reason,
    confidence: qualityGate.confidence
  };
}

module.exports = {
  evaluateDocQualityGate,
  QG_REJECT_CONFIDENCE,
  QG_MIN_CONTENT_CHARS
};
