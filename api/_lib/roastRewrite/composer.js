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
// Bound queue growth (review follow-up, 2026-08-02): a scrubbed delivered/failed
// entry no longer holds PII, but the entry itself lingers forever so buyers can
// reload their delivery link. Drop the entry + fully purge the doc once that
// link lifetime has also passed. 60d = 2x the 30d scrub window, i.e. buyers get
// a 30-day grace period after their resume text is scrubbed before the link
// dies entirely — a deliberate tradeoff of "link works for 60 days" against
// "queue doesn't grow forever".
const FULL_PURGE_MS = 2 * RESUME_RETENTION_MS;
const PRICE_CENTS_DEFAULT = 900;
const RESUME_MAX_CHARS = 20000;
// Optional target posting. Same cap the free roast already applies to the same
// pasted text (pixel-agent-run trims secondaryInput to 6000), so the paid
// rewrite targets exactly the posting the buyer saw scored — and so a pasted
// job PAGE can't blow the prompt.
const JOB_DESCRIPTION_MAX_CHARS = 6000;

// ── Tokens ───────────────────────────────────────────────────────

function buildRewriteToken(orderId) {
  return crypto.createHmac('sha256', FORM_INTAKE_SALT)
    .update('rewrite:' + orderId)
    .digest('hex')
    .slice(0, 32);
}

// ── Orders (pure) ────────────────────────────────────────────────

// Single definition of "how much posting we keep", shared by the endpoint's
// validation, the stored order doc and the prompt — so the three can never
// disagree about the cap. Returns null (not '') for absent/blank/non-string so
// every downstream check is a plain truthiness test.
function normalizeJobDescription(value) {
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, JOB_DESCRIPTION_MAX_CHARS) || null;
}

// Keyed fingerprint of exactly what the buyer is paying to have rewritten. The
// resume text plus the target posting, because the same resume aimed at a
// different job is a genuinely different product and must not be deduped
// against the first one.
//
// HMAC with the server-side salt rather than a bare sha256: a plain content
// hash of a resume is confirmable by anyone who can guess the document, and
// this value sits in a queue an operator can read. Keyed, it is a pseudonym
// that means nothing off this system.
//
// Nothing is stored that could rebuild the resume — only enough to answer
// "have we already been paid for this exact input?".
function fingerprintOrder(resumeText, jobDescription) {
  const resume = String(resumeText || '');
  const jd = normalizeJobDescription(jobDescription) || '';
  // Length-prefixed rather than joined by a separator character. Any separator
  // could itself occur in a resume, letting two different (resume, posting)
  // pairs hash identically by shifting the boundary between them, which would
  // hand one buyer another buyer's rewrite. A length makes the split
  // unambiguous for every possible input, and keeps this file plain ASCII.
  return crypto.createHmac('sha256', FORM_INTAKE_SALT)
    .update('rrfp:' + resume.length + ':' + resume + jd)
    .digest('hex')
    .slice(0, 32);
}

// Statuses that mean "this buyer has already handed over $9 for this exact
// input". 'created' is deliberately absent: an order that never got paid must
// not block the buyer from paying, which is the whole point of the record.
// 'failed' IS included — they paid and got nothing, so the answer is a refund
// or a requeue, never a second charge.
const PAID_STATUSES = ['paid', 'processing', 'delivered', 'failed'];

// Has this exact input already been paid for? Returns the existing entry so the
// caller can hand back its delivery link instead of minting a second checkout.
// Scans newest-first so a buyer with more than one match lands on their most
// recent purchase.
//
// Dedup lifetime is deliberately the ENTRY's lifetime (60d, the same window the
// delivery link works for) rather than the 30d resume-scrub window: for exactly
// as long as we will still show someone their rewrite, we refuse to sell it to
// them twice. The fingerprint is not scrubbed at 30d with the resume text
// because it is a keyed pseudonym, not the content.
function findPaidDuplicate(queue, fingerprint) {
  if (!fingerprint) return null;
  const q = Array.isArray(queue) ? queue : [];
  for (let i = q.length - 1; i >= 0; i--) {
    const o = q[i];
    if (!o || o.fingerprint !== fingerprint) continue;
    if (PAID_STATUSES.indexOf(o.status) === -1) continue;
    return o;
  }
  return null;
}

// The webhook half of the same guard. findPaidDuplicate runs at CHECKOUT time
// and so cannot see a checkout that is merely open — a buyer who starts two
// before completing either can still pay twice. This runs at PAYMENT time,
// when both charges are known facts, and answers "was an identical order
// already paid for by someone other than this one?".
//
// It cannot prevent the charge, only surface it. That is the whole point: a
// double charge nobody is told about is discovered by the customer, on their
// statement, which is the worst possible way for it to come out.
function findDoubleCharge(queue, order) {
  if (!order || !order.fingerprint) return null;
  const q = Array.isArray(queue) ? queue : [];
  for (let i = q.length - 1; i >= 0; i--) {
    const o = q[i];
    if (!o || o.orderId === order.orderId) continue;
    if (o.fingerprint !== order.fingerprint) continue;
    if (PAID_STATUSES.indexOf(o.status) === -1) continue;
    return o;
  }
  return null;
}

// Resume text is too large for Stripe metadata, so unlike teardowns the order
// exists BEFORE checkout: queue entry (small, status machine) + doc (payload).
// `jobDescription` is optional and trails the original signature so existing
// three-arg callers keep working unchanged.
function createOrder(resumeText, roastResult, nowIso, jobDescription) {
  const orderId = 'rr_' + Date.parse(nowIso) + '_' + crypto.randomBytes(2).toString('hex');
  return {
    // fingerprint lives on the ENTRY, not the doc: docs get scrubbed and purged
    // on a retention schedule, and dedup has to keep working after that.
    entry: { orderId, status: 'created', createdAt: nowIso, retryCount: 0, email: null, fingerprint: fingerprintOrder(resumeText, jobDescription) },
    doc: {
      orderId,
      resumeText: String(resumeText).slice(0, RESUME_MAX_CHARS),
      // The posting the buyer is targeting. Buyer-supplied content of the same
      // sensitivity class as resumeText, so scrubOrderDoc strips it on the
      // same 30d retention pass — it must never outlive the resume.
      jobDescription: normalizeJobDescription(jobDescription),
      roastResult: roastResult || null,
      rewrite: null,
      createdAt: nowIso,
      paidAt: null,
      deliveredAt: null
    }
  };
}

// Webhook path. Dedups on sessionId so Stripe retries never double-fire.
// `reason` distinguishes a no-op order (null) so callers can tell a benign
// dedup apart from a payment with no matching order — the latter needs
// error-level attention (manual recovery), the former doesn't.
function markPaid(queue, session, nowIso) {
  const q = Array.isArray(queue) ? queue.slice() : [];
  const md = (session && session.metadata) || {};
  if (md.rewrite !== '1' || !md.orderId) return { queue: q, order: null, reason: 'not-rewrite' };
  if (q.some(o => o && o.sessionId === session.id)) return { queue: q, order: null, reason: 'dedup' };
  const order = q.find(o => o && o.orderId === md.orderId);
  if (!order) return { queue: q, order: null, reason: 'missing' };
  if (order.status !== 'created') return { queue: q, order: null, reason: 'bad-status' };
  order.status = 'paid';
  order.paidAt = nowIso;
  order.sessionId = session.id;
  order.email = (session.customer_details && session.customer_details.email) || null;
  return { queue: q, order, reason: null };
}

// Self-heal: a crash mid-compose leaves 'processing'; after STALE_PROCESSING_MS
// it goes back to 'paid' (retryCount++) until retries are exhausted. Returns
// the affected orderIds alongside the counts so callers (the runner) can log
// and alert on exactly which orders need attention without dumping the queue.
function advanceQueue(queue, nowMs) {
  const q = Array.isArray(queue) ? queue : [];
  let resets = 0;
  let failed = 0;
  const resetIds = [];
  const failedIds = [];
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
      failedIds.push(order.orderId);
    } else {
      order.status = 'paid';
      resets++;
      resetIds.push(order.orderId);
    }
  }
  return { queue: q, resets, failed, resetIds, failedIds };
}

// Retention (runner tick): drop never-paid orders after 48h (delete their docs,
// which hold buyer content), scrub that content from docs 30d after delivery
// (or after creation, for orders that failed and were never delivered — see
// scrubOrderDoc for exactly which fields go), and fully purge scrubbed entries
// once they've also passed the 60d link-lifetime.
// A missing timestamp coerces to Date.parse(0) (year 2000 UTC) — already so
// far in the past that every age check below already treats it as expired.
// A present-but-malformed string (e.g. "garbage") parses to NaN instead,
// which the Number.isFinite guards fall back to age 0 for. Either way,
// corrupted or missing data fails CLOSED (gets cleaned up) instead of
// hanging onto PII forever.
//
// `allowedIds` (array or Set, optional) restricts which candidates may
// actually be removed/flagged this call — everything else about them (their
// age, their eligibility) is still computed, but they're left untouched and
// excluded from the returned id lists. Omitted/null means no restriction
// (every eligible candidate is processed) — the original, pre-restriction
// behavior. The runner uses this for a docs-first two-step retention: a
// read-only dry run (no allowedIds) finds candidates, doc IO (purge/scrub)
// runs against those candidates outside any mutator, and only the ids whose
// doc IO actually succeeded are passed back in as allowedIds for the real
// queue-mutating call — so a doc write failure leaves that order's queue
// entry untouched and it naturally retries next tick, instead of the queue
// recording a purge/scrub that never actually happened to the doc.
function retentionPass(queue, nowMs, allowedIds) {
  const q = Array.isArray(queue) ? queue : [];
  const allowed = allowedIds ? new Set(allowedIds) : null;
  const removeDocIds = [];
  const scrubDocIds = [];
  const kept = [];
  for (const order of q) {
    if (!order) continue;
    const isAllowed = !allowed || allowed.has(order.orderId);
    const createdMs = Date.parse(order.createdAt || 0);
    const createdAgeMs = nowMs - (Number.isFinite(createdMs) ? createdMs : 0);
    if (order.status === 'created' && createdAgeMs > UNPAID_TTL_MS && isAllowed) {
      removeDocIds.push(order.orderId);
      continue;
    }
    if (order.status === 'delivered' && !order.resumeScrubbed && isAllowed) {
      const deliveredMs = Date.parse(order.deliveredAt || 0);
      const deliveredAgeMs = nowMs - (Number.isFinite(deliveredMs) ? deliveredMs : 0);
      if (deliveredAgeMs > RESUME_RETENTION_MS) {
        order.resumeScrubbed = true;
        scrubDocIds.push(order.orderId);
      }
    }
    if (order.status === 'failed' && !order.resumeScrubbed && createdAgeMs > RESUME_RETENTION_MS && isAllowed) {
      order.resumeScrubbed = true;
      scrubDocIds.push(order.orderId);
    }
    if (order.resumeScrubbed && order.status === 'delivered' && isAllowed) {
      const deliveredMs = Date.parse(order.deliveredAt || 0);
      const deliveredAgeMs = nowMs - (Number.isFinite(deliveredMs) ? deliveredMs : 0);
      if (deliveredAgeMs > FULL_PURGE_MS) {
        removeDocIds.push(order.orderId);
        continue;
      }
    }
    if (order.resumeScrubbed && order.status === 'failed' && createdAgeMs > FULL_PURGE_MS && isAllowed) {
      removeDocIds.push(order.orderId);
      continue;
    }
    kept.push(order);
  }
  return { queue: kept, removeDocIds, scrubDocIds };
}

// The doc-side half of retentionPass. retentionPass flags the queue ENTRY
// (resumeScrubbed) and names the doc ids; the runner then calls this on each
// named doc to actually strip the buyer's content. It lives here, next to the
// pass that schedules it, so there is ONE list of "fields that must not
// survive retention" — a new user-supplied field added to the order doc gets
// scrubbed by editing this function, not by remembering to touch the runner.
// Mutates and returns the doc so a caller can setState(scrubOrderDoc(doc)).
// roastResult is nulled rather than deleted, matching the shape createOrder
// writes for an order that never had one.
function scrubOrderDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  delete doc.resumeText;
  delete doc.jobDescription;
  doc.roastResult = null;
  return doc;
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

// The page promises, directly under the job-description box, that "the score,
// the keyword gap and the rewrite all target that job" — so the posting has to
// reach the paid prompt, not just the free roast. The targeting block below
// mirrors the free roast's JOB-DESCRIPTION TARGETING rules (pixel-agents.json,
// resume-roast.systemPrompt): match the posting's own wording because that is
// what the parser matches on, and never claim experience the resume doesn't
// support. The block is spliced in ONLY when a posting is present, so a
// no-posting prompt stays byte-identical to the pre-targeting version (there
// is a regression test asserting exactly that).
function buildRewritePrompt(resumeText, roastResult, jobDescription) {
  const roast = roastResult
    ? JSON.stringify(roastResult).slice(0, 4000)
    : 'none provided';
  const jd = normalizeJobDescription(jobDescription);
  const jdBlock = jd ? [
    'TARGET JOB DESCRIPTION:',
    jd,
    '',
    'JOB-DESCRIPTION TARGETING (this rewrite is for THAT posting):',
    '- Target the rewrite at this posting. Lead with the experience it asks for, and order bullets so what matters to this job comes first.',
    '- Mirror the posting\'s own wording for skills, tools and titles the client genuinely has, because that is what the ATS parser matches on.',
    '- Never claim experience the source resume does not support. Where the posting requires something the resume lacks, leave it out. A real gap is not a keyword to insert.',
    '- In ats_keywords.missing, list what this posting asks for that the resume does not yet support, in the posting\'s own wording, most important first.',
    ''
  ] : [];
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
    ...jdBlock,
    'Rewrite the resume: strong action verbs, achievement-first bullets, clean ATS-parseable structure (standard section headers, no tables or columns), tight professional summary.',
    '',
    'Respond with STRICT JSON only, no code fences, no prose outside JSON:',
    '{',
    '  "rewritten_resume": "<the complete rewritten resume in clean Markdown, every section>",',
    '  "changes": [3-8 of {"section": "<section name>", "what": "<what changed>", "why": "<why it helps>"}],',
    '  "ats_keywords": {"present": ["<keyword>", ...], "missing": ["<keyword worth adding IF the client truly has the experience>", ...]}',
    '}',
    '',
    'Rules: use standard resume punctuation: no em dashes and no double hyphens anywhere; write date ranges with a single hyphen (March 2022 - Present). No invented statistics. The rewritten_resume must be complete and usable as-is.'
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

// Malformed output retries once cooler. Ladder is indexed rather than iterated
// so a caller doing one attempt per call (the HTTP path, see below) can resume
// at the temperature it left off at instead of always re-rolling at 0.4.
const COMPOSE_TEMPERATURES = [0.4, 0.2];

// Budget for a compose running INSIDE an HTTP request. Azure's gateway kills a
// request at 230s regardless of functionTimeout, and the delivery page's fetch
// dies with it. 195s leaves ~35s for the doc write, the queue flip and the
// ready email that follow a successful compose.
//
// MEASURED, not assumed: the one real order to date (rr_1785808666421_00d8)
// took 354s paid -> delivered — 1 for 1 past the gateway limit. A single
// 8000-token rewrite runs ~150-180s, so the old code's two sequential attempts
// could not fit in one request and never could have.
const INLINE_COMPOSE_BUDGET_MS = 195000;

// One temperature attempt per HTTP request. The ladder still happens — it is
// just spread across successive polls, each of which gets a FRESH 230s gateway
// budget, instead of being crammed into the first poll's. Two inline tries
// (retryCount 0 and 1), then roastRewriteRunner takes the last one with the
// much larger budget below, so a paid order is never failed merely because the
// fast path has to be fast.
const INLINE_MAX_ATTEMPTS = 1;
const INLINE_MAX_RETRIES = 2;

// Budget for the cron backstop. No gateway in front of a timer trigger, so the
// only ceiling is host.json's functionTimeout (10 min). 420s runs the full
// ladder and still leaves 3 min for retention IO, the doc write and the email.
const BACKSTOP_COMPOSE_BUDGET_MS = 420000;

// `jobDescription` trails callClaude and `opts` trails that, so existing
// call sites are unaffected: no opts means two attempts, no deadline, exactly
// the previous behaviour.
//
// opts.deadlineMs    — wall-clock budget for the WHOLE compose. Threaded down
//                      to _lib/llm as an absolute deadline, so both the retry
//                      ladder and each individual model attempt are bounded.
// opts.maxAttempts   — how many temperature attempts to make in THIS call.
// opts.attemptOffset — where to start on the temperature ladder, so an attempt
//                      spread across calls still gets cooler each time.
async function composeRewrite(resumeText, roastResult, callClaude, jobDescription, opts) {
  const o = opts || {};
  const prompt = buildRewritePrompt(resumeText, roastResult, jobDescription);
  const deadlineAt = Number.isFinite(o.deadlineMs) && o.deadlineMs > 0
    ? Date.now() + o.deadlineMs
    : null;
  const offset = Number.isFinite(o.attemptOffset) && o.attemptOffset > 0 ? Math.floor(o.attemptOffset) : 0;
  const maxAttempts = Number.isFinite(o.maxAttempts) && o.maxAttempts > 0
    ? Math.floor(o.maxAttempts)
    : COMPOSE_TEMPERATURES.length;

  let lastErr = null;
  for (let i = 0; i < maxAttempts; i++) {
    // An offset past the end of the ladder clamps to the coolest temperature
    // rather than reading undefined and silently sending temperature: null.
    const temperature = COMPOSE_TEMPERATURES[Math.min(offset + i, COMPOSE_TEMPERATURES.length - 1)];
    try {
      const raw = await callClaudeWithBackoff(callClaude, prompt, {
        temperature,
        maxOutputTokens: 8000,
        caller: 'roast-rewrite-compose',
        deadlineAt: deadlineAt || undefined
      });
      const parsed = parseJson(raw);
      const problem = validateRewrite(parsed);
      if (problem) throw new Error('rewrite validation failed: ' + problem);
      return parsed;
    } catch (err) {
      lastErr = err;
      // Out of clock: a cooler temperature cannot conjure more of it, and
      // looping would only report the same failure later.
      if (err && err.deadline) break;
    }
  }
  const failure = new Error('composeRewrite failed after retries: ' + (lastErr && lastErr.message));
  // Propagated so the caller can tell "we ran out of time" (retry me somewhere
  // with a bigger budget) from "the model would not produce valid output"
  // (retrying identically is unlikely to help).
  if (lastErr && lastErr.deadline) failure.deadline = true;
  throw failure;
}

module.exports = {
  buildRewriteToken,
  normalizeJobDescription,
  fingerprintOrder,
  findPaidDuplicate,
  findDoubleCharge,
  createOrder,
  markPaid,
  advanceQueue,
  retentionPass,
  scrubOrderDoc,
  capQueue,
  buildRewritePrompt,
  validateRewrite,
  composeRewrite,
  PAID_STATUSES,
  COMPOSE_TEMPERATURES,
  INLINE_COMPOSE_BUDGET_MS,
  INLINE_MAX_ATTEMPTS,
  INLINE_MAX_RETRIES,
  BACKSTOP_COMPOSE_BUDGET_MS,
  QUEUE_CAP,
  MAX_RETRIES,
  STALE_PROCESSING_MS,
  UNPAID_TTL_MS,
  RESUME_RETENTION_MS,
  PRICE_CENTS_DEFAULT,
  RESUME_MAX_CHARS,
  JOB_DESCRIPTION_MAX_CHARS
};
