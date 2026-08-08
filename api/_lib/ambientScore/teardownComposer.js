// teardownComposer.js — turns an analyzer report + buyer goal into the $199
// Conversion Teardown document. Pure functions with the Claude call injected
// so the whole module unit-tests without network. Consumed by as-webhook
// (queueTeardownOrder), asTeardownRunner (composeTeardown, advanceQueue) and
// as-teardown (buildTeardownToken).

const crypto = require('crypto');

const FORM_INTAKE_SALT = process.env.FORM_INTAKE_SALT || 'ambientos-intake-v1-default';
const QUEUE_CAP = 200;
const STALE_PROCESSING_MS = 2 * 60 * 60 * 1000;
const MAX_RETRIES = 2;

// ── Tokens ───────────────────────────────────────────────────────

function buildTeardownToken(orderId) {
  return crypto.createHmac('sha256', FORM_INTAKE_SALT)
    .update('teardown:' + orderId)
    .digest('hex')
    .slice(0, 32);
}

// ── Queue management (pure) ──────────────────────────────────────

// Build a queue entry from a completed Stripe checkout session.
// Dedups on sessionId so webhook retries can never double-queue an order.
function queueTeardownOrder(session, queue, nowIso) {
  const q = Array.isArray(queue) ? queue.slice() : [];
  const md = (session && session.metadata) || {};
  if (md.teardown !== '1') return { queue: q, order: null };
  if (q.some(o => o && o.sessionId === session.id)) return { queue: q, order: null };

  const order = {
    orderId: 'td_' + Date.parse(nowIso) + '_' + crypto.randomBytes(2).toString('hex'),
    url: String(md.url || '').slice(0, 500),
    goal: String(md.goal || '').slice(0, 500),
    // Stripe-collected email wins over the form email carried in metadata.
    email: (session.customer_details && session.customer_details.email) || md.email || null,
    sessionId: session.id,
    utmContent: md.utm_content || null,
    utmSource: md.utm_source || null,
    paidAt: nowIso,
    status: 'paid',
    retryCount: 0
  };
  q.push(order);
  while (q.length > QUEUE_CAP) q.shift();
  return { queue: q, order };
}

// Self-heal pass run at the top of every runner tick: a crash mid-analysis
// leaves an order stuck in 'processing'; after 2h it goes back to 'paid'
// (retryCount++) until retries are exhausted, then 'failed'.
function advanceQueue(queue, nowMs) {
  const q = Array.isArray(queue) ? queue : [];
  let resets = 0;
  let failed = 0;
  for (const order of q) {
    if (!order || order.status !== 'processing') continue;
    const startedMs = Date.parse(order.processingAt || 0);
    if (!Number.isFinite(startedMs) || nowMs - startedMs < STALE_PROCESSING_MS) continue;
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

// ── Composition ──────────────────────────────────────────────────

function buildTeardownPrompt(report, goal) {
  const fr = (report && report.fullReport) || {};
  const dims = fr.dimensions || {};
  const dimLines = Object.values(dims)
    .map(d => '- ' + d.label + ': ' + d.score + '/100')
    .join('\n');
  const findings = (fr.findings || []).slice(0, 12)
    .map((f, i) => (i + 1) + '. ' + f.finding + ' -> ' + f.recommendation + ' (impact: ' + (f.estimatedImpact || 'n/a') + ')')
    .join('\n');
  const synth = fr.synthesis || {};
  const extraction = fr.extraction || {};

  return [
    'You are a senior conversion strategist writing a paid, done-for-you teardown for a client.',
    'Site: ' + (fr.url || 'unknown'),
    'Overall score: ' + (fr.score || 0) + '/100 (grade ' + (fr.grade || '?') + '), site type: ' + (fr.siteTypeLabel || fr.siteType || 'unknown'),
    'Client goal: ' + (goal || 'improve conversions'),
    '',
    'DIMENSION SCORES:\n' + (dimLines || 'none'),
    '',
    'AUDIT FINDINGS:\n' + (findings || 'none'),
    '',
    'EXECUTIVE SUMMARY FROM THE AUDIT:\n' + (synth.executiveSummary || 'none'),
    '',
    'SITE COPY EXTRACTED VERBATIM (use these as the "before" quotes — never invent copy the site does not contain):\n' + JSON.stringify({
      headlines: extraction.headlines || extraction.valueProps || [],
      ctas: extraction.ctas || []
    }).slice(0, 3000),
    '',
    'Write the teardown. Respond with STRICT JSON only, no code fences, no prose outside JSON:',
    '{',
    '  "summary": "<120-180 words, second person, references the client goal, plain confident language>",',
    '  "killers": [exactly 5 of {"title": "<short name of the conversion killer>", "why": "<2-3 sentences on why it costs conversions>", "before": "<verbatim quote from the site copy above, or a precise description of the current state if no quote applies>", "after": "<your rewritten copy or concrete replacement>", "impact": "high|medium|low"}],',
    '  "fixOrder": [exactly 4 of {"week": <1-4>, "items": ["<action>", ...]}],',
    '  "confidence": "high|medium|low"',
    '}',
    '',
    'Rules: no em dashes anywhere. No invented statistics. Killers ordered by impact. Rewrites must be usable as-is.'
  ].join('\n');
}

function parseJson(text) {
  let cleaned = String(text || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const first = cleaned.search(/[{[]/);
    const last = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (first !== -1 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw err;
  }
}

function validateTeardown(t) {
  if (!t || typeof t !== 'object') return 'not an object';
  if (typeof t.summary !== 'string' || t.summary.trim().length < 40) return 'summary too short';
  if (!Array.isArray(t.killers) || t.killers.length !== 5) return 'killers must be exactly 5';
  for (const k of t.killers) {
    if (!k || !k.title || !k.why || !k.before || !k.after) return 'killer missing field';
  }
  if (!Array.isArray(t.fixOrder) || t.fixOrder.length !== 4) return 'fixOrder must be 4 weeks';
  for (const w of t.fixOrder) {
    if (!w || !Number.isFinite(Number(w.week)) || !Array.isArray(w.items) || w.items.length === 0) return 'fixOrder week malformed';
  }
  return null;
}

// Transient upstream failures must not burn a paid order: td_1785382746857_2faa
// died as 'failed' (refund territory) on three "Claude returned 500" bursts —
// the two temperature attempts fired back-to-back into the same outage. Retry
// transient errors with backoff INSIDE an attempt; only real output problems
// (parse/validation) fall through to the cooler second attempt.
const TRANSIENT_ERR_RX = /returned 5\d\d|returned 429|overloaded|timeout|ETIMEDOUT|ECONNRESET|ECONNABORTED|socket hang up/i;

// Smallest window worth attempting a call in. Mirrors _lib/llm's own floor:
// below this the call would be aborted before any completion could land.
const MIN_RETRY_WINDOW_MS = 15000;

// `opts.deadlineAt` (absolute epoch ms, optional) is passed straight through to
// callClaude AND used here, because this ladder is itself a multiplier: three
// tries plus 10s of sleeps on top of whatever one call costs. A caller behind a
// hard limit needs both halves bounded or the budget is fiction. Without it the
// ladder behaves exactly as before.
async function _callClaudeWithBackoff(callClaude, prompt, opts) {
  const waitsMs = [0, 2000, 8000];
  const deadlineAt = opts && opts.deadlineAt;
  let lastErr = null;
  for (const w of waitsMs) {
    // Never sleep into the deadline, and never start a try there is no room
    // to finish — burning the tail of the budget on a call that is certain to
    // be aborted costs money and delivers nothing.
    if (deadlineAt && deadlineAt - Date.now() - w < MIN_RETRY_WINDOW_MS) {
      if (!lastErr) {
        lastErr = new Error('Claude budget exhausted before completion — no room for an attempt');
        lastErr.deadline = true;
      }
      break;
    }
    if (w) await new Promise(function (r) { setTimeout(r, w); });
    try {
      return await callClaude(prompt, opts);
    } catch (err) {
      lastErr = err;
      if (!TRANSIENT_ERR_RX.test(String(err && err.message))) throw err;
    }
  }
  throw lastErr;
}

// One composition call; on malformed output retry once cooler, then throw.
async function composeTeardown(report, goal, callClaude) {
  const prompt = buildTeardownPrompt(report, goal);
  const attempts = [{ temperature: 0.4 }, { temperature: 0.2 }];
  let lastErr = null;
  for (const opts of attempts) {
    try {
      const raw = await _callClaudeWithBackoff(callClaude, prompt, {
        temperature: opts.temperature,
        maxOutputTokens: 3500,
        caller: 'as-teardown-compose'
      });
      const parsed = parseJson(raw);
      const problem = validateTeardown(parsed);
      if (problem) throw new Error('teardown validation failed: ' + problem);
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error('composeTeardown failed after retries: ' + (lastErr && lastErr.message));
}

module.exports = {
  buildTeardownToken,
  queueTeardownOrder,
  advanceQueue,
  buildTeardownPrompt,
  composeTeardown,
  validateTeardown,
  parseJson,
  callClaudeWithBackoff: _callClaudeWithBackoff,
  QUEUE_CAP,
  MAX_RETRIES
};
