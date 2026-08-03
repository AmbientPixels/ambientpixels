// composer.js — turns a free roast + resume text into the $9 Deep Roast Rewrite.
// Pure functions with the Claude call injected, mirroring teardownComposer.
// Consumed by roast-rewrite (token/order/compose), as-webhook (markPaid) and
// roastRewriteRunner (backstop compose + retention).

const crypto = require('crypto');
const { parseJson, callClaudeWithBackoff } = require('../ambientScore/teardownComposer');

const FORM_INTAKE_SALT = process.env.FORM_INTAKE_SALT || 'ambientos-intake-v1-default';
const QUEUE_CAP = 300;
const STALE_PROCESSING_MS = 10 * 60 * 1000;        // one Claude call; 10 min stuck = crashed
const MAX_RETRIES = 2;
const UNPAID_TTL_MS = 48 * 60 * 60 * 1000;          // created-but-never-paid orders
const RESUME_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // spec: scrub resume text 30d post-delivery
const PRICE_CENTS_DEFAULT = 900;
const RESUME_MAX_CHARS = 20000;

// ── Tokens ───────────────────────────────────────────────────────

function buildRewriteToken(orderId) {
  return crypto.createHmac('sha256', FORM_INTAKE_SALT)
    .update('rewrite:' + orderId)
    .digest('hex')
    .slice(0, 32);
}

// ── Orders (pure) ────────────────────────────────────────────────

// Resume text is too large for Stripe metadata, so unlike teardowns the order
// exists BEFORE checkout: queue entry (small, status machine) + doc (payload).
function createOrder(resumeText, roastResult, nowIso) {
  const orderId = 'rr_' + Date.parse(nowIso) + '_' + crypto.randomBytes(2).toString('hex');
  return {
    entry: { orderId, status: 'created', createdAt: nowIso, retryCount: 0, email: null },
    doc: {
      orderId,
      resumeText: String(resumeText).slice(0, RESUME_MAX_CHARS),
      roastResult: roastResult || null,
      rewrite: null,
      createdAt: nowIso,
      paidAt: null,
      deliveredAt: null
    }
  };
}

// Webhook path. Dedups on sessionId so Stripe retries never double-fire.
function markPaid(queue, session, nowIso) {
  const q = Array.isArray(queue) ? queue.slice() : [];
  const md = (session && session.metadata) || {};
  if (md.rewrite !== '1' || !md.orderId) return { queue: q, order: null };
  if (q.some(o => o && o.sessionId === session.id)) return { queue: q, order: null };
  const order = q.find(o => o && o.orderId === md.orderId);
  if (!order || order.status !== 'created') return { queue: q, order: null };
  order.status = 'paid';
  order.paidAt = nowIso;
  order.sessionId = session.id;
  order.email = (session.customer_details && session.customer_details.email) || null;
  return { queue: q, order };
}

// Self-heal: a crash mid-compose leaves 'processing'; after STALE_PROCESSING_MS
// it goes back to 'paid' (retryCount++) until retries are exhausted.
function advanceQueue(queue, nowMs) {
  const q = Array.isArray(queue) ? queue : [];
  let resets = 0;
  let failed = 0;
  for (const order of q) {
    if (!order || order.status !== 'processing') continue;
    // Non-finite processingAt (missing/corrupt) must NOT skip forever — fail
    // closed and treat it as stale so it falls into the retry/fail path below.
    const startedMs = Date.parse(order.processingAt || 0);
    if (Number.isFinite(startedMs) && nowMs - startedMs < STALE_PROCESSING_MS) continue;
    order.retryCount = (order.retryCount || 0) + 1;
    if (order.retryCount > MAX_RETRIES) {
      order.status = 'failed';
      order.error = 'retries exhausted after stale processing';
      failed++;
    } else {
      order.status = 'paid';
      resets++;
    }
  }
  return { queue: q, resets, failed };
}

// Retention (runner tick): drop never-paid orders after 48h (delete their docs,
// which hold resume text) and scrub resume text from docs 30d after delivery
// (or after creation, for orders that failed and were never delivered).
// A malformed/missing timestamp parses to NaN — treat that as age 0 (i.e. an
// infinite age once compared against "now"), so corrupted data fails CLOSED
// (gets cleaned up) instead of hanging onto PII forever.
function retentionPass(queue, nowMs) {
  const q = Array.isArray(queue) ? queue : [];
  const removeDocIds = [];
  const scrubDocIds = [];
  const kept = [];
  for (const order of q) {
    if (!order) continue;
    const createdMs = Date.parse(order.createdAt || 0);
    const createdAgeMs = nowMs - (Number.isFinite(createdMs) ? createdMs : 0);
    if (order.status === 'created' && createdAgeMs > UNPAID_TTL_MS) {
      removeDocIds.push(order.orderId);
      continue;
    }
    if (order.status === 'delivered' && !order.resumeScrubbed) {
      const deliveredMs = Date.parse(order.deliveredAt || 0);
      const deliveredAgeMs = nowMs - (Number.isFinite(deliveredMs) ? deliveredMs : 0);
      if (deliveredAgeMs > RESUME_RETENTION_MS) {
        order.resumeScrubbed = true;
        scrubDocIds.push(order.orderId);
      }
    }
    if (order.status === 'failed' && !order.resumeScrubbed && createdAgeMs > RESUME_RETENTION_MS) {
      order.resumeScrubbed = true;
      scrubDocIds.push(order.orderId);
    }
    kept.push(order);
  }
  return { queue: kept, removeDocIds, scrubDocIds };
}

// Queue-cap enforcement (endpoint calls this instead of `queue.shift()`
// directly) so dropped entries never orphan their `roast_rewrite_<id>` docs —
// caller must delete removeDocIds.
//
// Status-aware (review follow-up, 2026-08-02): only 'created' entries (never
// paid, nothing at stake yet) are droppable, and only the oldest ones. A
// paid/processing/delivered/failed entry represents real money or in-flight
// work and must never be silently dropped — if there aren't enough 'created'
// entries to shed, the queue is returned over-cap unchanged. Safety beats cap.
function capQueue(queue) {
  const q = Array.isArray(queue) ? queue.slice() : [];
  const overflow = q.length - QUEUE_CAP;
  if (overflow <= 0) return { queue: q, removeDocIds: [] };

  const removeDocIds = [];
  const kept = [];
  let toDrop = overflow;
  for (const order of q) {
    if (toDrop > 0 && order && order.status === 'created') {
      removeDocIds.push(order.orderId);
      toDrop--;
      continue;
    }
    kept.push(order);
  }
  return { queue: kept, removeDocIds };
}

// ── Composition ──────────────────────────────────────────────────

function buildRewritePrompt(resumeText, roastResult) {
  const roast = roastResult
    ? JSON.stringify(roastResult).slice(0, 4000)
    : 'none provided';
  return [
    'You are a senior professional resume writer. A client paid for a full rewrite of their resume after receiving the automated roast below.',
    '',
    'INTEGRITY RULES (non-negotiable):',
    '- Use ONLY facts present in the source resume. NEVER invent employers, job titles, dates, degrees, certifications, skills, or metrics.',
    '- Where a bullet would benefit from a number the source does not contain, write the literal placeholder [add metric] for the client to fill in.',
    '- Keep the true chronology. Reordering sections is fine; changing history is not.',
    '',
    'ROAST FINDINGS (fix these):',
    roast,
    '',
    'SOURCE RESUME:',
    String(resumeText).slice(0, RESUME_MAX_CHARS),
    '',
    'Rewrite the resume: strong action verbs, achievement-first bullets, clean ATS-parseable structure (standard section headers, no tables or columns), tight professional summary.',
    '',
    'Respond with STRICT JSON only, no code fences, no prose outside JSON:',
    '{',
    '  "rewritten_resume": "<the complete rewritten resume in clean Markdown, every section>",',
    '  "changes": [3-8 of {"section": "<section name>", "what": "<what changed>", "why": "<why it helps>"}],',
    '  "ats_keywords": {"present": ["<keyword>", ...], "missing": ["<keyword worth adding IF the client truly has the experience>", ...]}',
    '}',
    '',
    'Rules: no em dashes anywhere. No invented statistics. The rewritten_resume must be complete and usable as-is.'
  ].join('\n');
}

function validateRewrite(r) {
  if (!r || typeof r !== 'object') return 'not an object';
  if (typeof r.rewritten_resume !== 'string' || r.rewritten_resume.trim().length < 400) return 'rewritten_resume too short';
  if (!Array.isArray(r.changes) || r.changes.length < 3 || r.changes.length > 8) return 'changes must be 3-8 items';
  for (const c of r.changes) {
    if (!c || !c.section || !c.what || !c.why) return 'change missing field';
  }
  if (!r.ats_keywords || !Array.isArray(r.ats_keywords.present) || !Array.isArray(r.ats_keywords.missing)) return 'ats_keywords malformed';
  return null;
}

// One composition; malformed output retries once cooler; transient upstream
// errors retry with backoff inside each attempt (shared teardown helper —
// a paid $9 order must not die on an Anthropic 500 burst).
async function composeRewrite(resumeText, roastResult, callClaude) {
  const prompt = buildRewritePrompt(resumeText, roastResult);
  const attempts = [{ temperature: 0.4 }, { temperature: 0.2 }];
  let lastErr = null;
  for (const opts of attempts) {
    try {
      const raw = await callClaudeWithBackoff(callClaude, prompt, {
        temperature: opts.temperature,
        maxOutputTokens: 8000,
        caller: 'roast-rewrite-compose'
      });
      const parsed = parseJson(raw);
      const problem = validateRewrite(parsed);
      if (problem) throw new Error('rewrite validation failed: ' + problem);
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error('composeRewrite failed after retries: ' + (lastErr && lastErr.message));
}

module.exports = {
  buildRewriteToken,
  createOrder,
  markPaid,
  advanceQueue,
  retentionPass,
  capQueue,
  buildRewritePrompt,
  validateRewrite,
  composeRewrite,
  QUEUE_CAP,
  MAX_RETRIES,
  STALE_PROCESSING_MS,
  UNPAID_TTL_MS,
  RESUME_RETENTION_MS,
  PRICE_CENTS_DEFAULT,
  RESUME_MAX_CHARS
};
