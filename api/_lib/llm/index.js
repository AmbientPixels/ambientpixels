// _lib/llm — the model caller for PUBLIC, customer-facing products.
//
// WHY THIS EXISTS (2026-08-07)
// ----------------------------
// Every public product called Anthropic directly, once, with no fallback:
//   pixel-agent-run       (all 24 agents, incl. the free Resume Roast)
//   _lib/ambientScore/analyzer.callClaude   (the $9 rewrite, the free scan,
//                                            the $199 teardown)
// A single non-2xx — a 429, a 529 overload, or `credit_balance_too_low` —
// meant the customer got "encountered a system fault". Exhausted credits would
// have taken down 100% of paid AND free traffic at once, which is why this
// blocked pointing any traffic at the product at all.
//
// WHY NOT JUST USE companyHeartbeat/gemini.js
// -------------------------------------------
// It already implements a correct cross-provider chain, and the pure routing
// half of it — model-registry.js — is REUSED here rather than reimplemented,
// because the chain build, the dedup-by-resolved-id and the thinking-budget
// rules are subtle and already proven. What is NOT reused is its provider
// callers, for three reasons that are disqualifying for a public product:
//   1. no `system` parameter — every Pixel Agent depends on agent.systemPrompt
//   2. temperature is dropped on the Claude leg — agents specify 0.7-0.9
//   3. it returns text only, so per-call cost cannot be attributed
// Rewriting gemini.js to fix those would change the call path of all nine
// fleet agents on every heartbeat. That is a large blast radius to accept for
// a product change, so the public path gets its own callers and the fleet path
// is left exactly as it is.
//
// CONTRACT
// --------
// callModel() resolves with the first model in the chain that answers, or
// rejects with LlmUnavailableError once every model has failed. Callers get
// `usage` back so they can attribute spend, and `fellBackFrom` so a degraded
// answer is visible rather than silent.

const fetch = require('node-fetch');
const storage = require('../../_utils/companyStorage');
const registry = require('../../companyHeartbeat/model-registry');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

// Wall-clock ceiling per attempt. Without it a hung socket holds the Azure
// Function until its own timeout, and the fallback never gets a turn — the
// chain would be useless in exactly the overload it exists for.
const ATTEMPT_TIMEOUT_MS = 60000;

// Smallest attempt worth starting when a caller supplies `deadlineAt`. Below
// this there is no realistic chance of a completion landing, so starting the
// call would only guarantee an abort — and would spend the caller's entire
// remaining budget doing it, leaving nothing for the writes that follow.
const MIN_ATTEMPT_MS = 15000;

/**
 * Thrown only when EVERY model in the chain has failed.
 * `reason` classifies it so callers can choose honest user-facing copy:
 *   'credits'  — billing/credit exhaustion. Ours to fix, not transient.
 *   'capacity' — 429/529/5xx. Genuinely retryable.
 *   'config'   — no API keys present at all.
 *   'error'    — anything else.
 */
class LlmUnavailableError extends Error {
  constructor(message, reason, attempts) {
    super(message);
    this.name = 'LlmUnavailableError';
    this.reason = reason || 'error';
    this.attempts = attempts || [];
  }
}

// Classify a provider failure from its status and body text.
function classify(status, bodyText) {
  const t = String(bodyText || '').toLowerCase();
  // Anthropic reports credit exhaustion as a 400 invalid_request_error, NOT a
  // 402 — so status alone cannot detect the case that worries us most.
  if (/credit balance|billing|quota|insufficient|payment required|exceeded your current quota/.test(t)) return 'credits';
  if (status === 402) return 'credits';
  if (status === 429 || status === 529 || (status >= 500 && status < 600)) return 'capacity';
  return 'error';
}

// ── providers ──────────────────────────────────────────────────────────

async function withTimeout(fn, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || ATTEMPT_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function callClaude(modelId, opts) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, reason: 'config', detail: 'ANTHROPIC_API_KEY not set' };

  const body = {
    model: modelId,
    max_tokens: opts.maxTokens || 1500,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.8,
    messages: [{ role: 'user', content: opts.prompt }]
  };
  if (opts.system) body.system = opts.system;

  const res = await withTimeout(signal => fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify(body),
    signal
  }), opts.timeoutMs);

  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, reason: classify(res.status, raw), status: res.status, detail: raw.slice(0, 400) };
  }

  let data;
  try { data = JSON.parse(raw); } catch { return { ok: false, reason: 'error', detail: 'unparseable response' }; }

  const text = (data && data.content && data.content[0] && data.content[0].text) || '';
  if (!text.trim()) return { ok: false, reason: 'error', detail: 'empty completion' };

  const u = data.usage || {};
  return {
    ok: true,
    text,
    // A max_tokens stop means the JSON is cut off mid-object. Callers that
    // parse it would otherwise see a syntax error and blame the model, or
    // worse, fall back to dumping raw text at the customer.
    truncated: data.stop_reason === 'max_tokens',
    usage: {
      promptTokens: u.input_tokens || 0,
      completionTokens: u.output_tokens || 0,
      totalTokens: (u.input_tokens || 0) + (u.output_tokens || 0)
    }
  };
}

async function callGemini(modelId, opts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, reason: 'config', detail: 'GEMINI_API_KEY not set' };

  // Thinking config is model-dependent and getting it wrong is silent: Pro
  // rejects thinkingBudget:0 outright, while Flash NEEDS it or its thinking
  // tokens eat maxOutputTokens and truncate the JSON. Both rules live in the
  // shared registry so this and the fleet path cannot drift apart.
  const thinking = registry.requiresThinking(modelId);
  const generationConfig = {
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.8,
    topP: 0.9,
    maxOutputTokens: thinking ? Math.max(opts.maxTokens || 1500, 8192) : (opts.maxTokens || 1500),
    thinkingConfig: thinking ? { thinkingBudget: -1 } : { thinkingBudget: 0 }
  };
  // Agents contract for raw JSON. Claude honours that from the system prompt;
  // Gemini needs to be told, or it wraps the object in prose and the caller's
  // parse fails — which would look like a fallback that "worked" and returned
  // garbage.
  if (opts.json) generationConfig.responseMimeType = 'application/json';

  const body = {
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };

  const res = await withTimeout(signal => fetch(GEMINI_BASE + modelId + ':generateContent?key=' + key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  }), opts.timeoutMs);

  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, reason: classify(res.status, raw), status: res.status, detail: raw.slice(0, 400) };
  }

  let data;
  try { data = JSON.parse(raw); } catch { return { ok: false, reason: 'error', detail: 'unparseable response' }; }

  const cand = data && data.candidates && data.candidates[0];
  const text = (cand && cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text) || '';
  if (!text.trim()) {
    // A MAX_TOKENS finish with no text means the ceiling was consumed before
    // any output — worth naming, because it looks identical to an outage.
    const why = cand && cand.finishReason ? ' finishReason=' + cand.finishReason : '';
    return { ok: false, reason: 'error', detail: 'empty completion' + why };
  }

  const um = data.usageMetadata || {};
  return {
    ok: true,
    text,
    truncated: cand.finishReason === 'MAX_TOKENS',
    usage: {
      promptTokens: um.promptTokenCount || 0,
      completionTokens: um.candidatesTokenCount || 0,
      totalTokens: um.totalTokenCount || 0
    }
  };
}

// ── the chain ──────────────────────────────────────────────────────────

/**
 * Call a model, falling back across providers until one answers.
 *
 * @param {object} opts
 * @param {string} opts.prompt       - the user message (required)
 * @param {string} [opts.system]     - system prompt
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {boolean} [opts.json]      - the caller will JSON.parse the result
 * @param {string} [opts.model]      - primary model key, default 'claude-sonnet'
 * @param {string} [opts.caller]     - for spend attribution (required in practice)
 * @param {string} [opts.agentId]
 * @param {string} [opts.runId]      - lets spend be joined back to a single run
 * @param {number} [opts.timeoutMs]  - per-attempt ceiling; default 60s. Raise it
 *   for large generations (the AmbientScore evaluators emit up to 16k tokens and
 *   legitimately run for minutes) — too low a value aborts a healthy call and
 *   burns a fallback attempt on a request that was going to succeed.
 * @param {number} [opts.deadlineAt] - absolute epoch-ms ceiling for the WHOLE
 *   chain. `timeoutMs` bounds one attempt; this bounds all of them, so a caller
 *   behind a hard limit (Azure kills an HTTP request at 230s) can guarantee it
 *   returns in time. Attempts are clamped to the remaining budget and the chain
 *   stops once too little is left to be worth starting. Omit for no ceiling.
 * @returns {Promise<{text:string, modelKey:string, modelId:string, provider:string,
 *                    usage:object, fellBackFrom:?string, attempts:Array}>}
 * @throws {LlmUnavailableError} only when every model in the chain has failed
 */
async function callModel(opts) {
  if (!opts || !opts.prompt) throw new Error('callModel: prompt is required');

  const primary = opts.model || 'claude-sonnet';
  const chain = registry.buildChain(primary);
  const attempts = [];

  for (const modelKey of chain) {
    const modelId = registry.MODELS[modelKey];
    const provider = registry.providerOf(modelKey);
    const started = Date.now();

    // `timeoutMs` bounds ONE attempt, so a chain of N models can still burn
    // N * timeoutMs of wall clock. That is invisible to a caller sitting
    // behind a hard limit — Azure kills an HTTP request at 230s no matter
    // what this module thinks its budget is. `deadlineAt` (epoch ms) is the
    // absolute version: every remaining attempt is clamped to the time
    // actually left, and the chain stops rather than starting an attempt it
    // cannot finish. Omitted (the default) leaves behaviour byte-identical.
    let attemptOpts = opts;
    if (opts.deadlineAt) {
      const remaining = opts.deadlineAt - Date.now();
      if (remaining < MIN_ATTEMPT_MS) {
        attempts.push({ modelKey, modelId, provider, ok: false, reason: 'deadline', status: null, detail: 'skipped: ' + Math.max(0, remaining) + 'ms left, need ' + MIN_ATTEMPT_MS + 'ms', ms: 0 });
        break;
      }
      attemptOpts = Object.assign({}, opts, {
        timeoutMs: Math.min(opts.timeoutMs || ATTEMPT_TIMEOUT_MS, remaining)
      });
    }

    let out;
    try {
      out = provider === 'claude'
        ? await callClaude(modelId, attemptOpts)
        : await callGemini(modelId, attemptOpts);
    } catch (err) {
      // A thrown error here is a transport failure (abort, DNS, socket). It must
      // advance the chain rather than escape, or the fallback is pointless.
      // Report the timeout that actually applied, not the module default —
      // with `deadlineAt` the effective ceiling is whatever budget was left,
      // and a log claiming 60000ms when the call was cut at 9000ms sends the
      // next person debugging in the wrong direction.
      const effectiveTimeout = attemptOpts.timeoutMs || ATTEMPT_TIMEOUT_MS;
      out = {
        ok: false,
        reason: err.name === 'AbortError' ? 'capacity' : 'error',
        detail: err.name === 'AbortError' ? 'timed out after ' + effectiveTimeout + 'ms' : err.message
      };
    }

    const ms = Date.now() - started;

    if (!out.ok) {
      attempts.push({ modelKey, modelId, provider, ok: false, reason: out.reason, status: out.status || null, detail: out.detail, ms });
      continue;
    }

    attempts.push({ modelKey, modelId, provider, ok: true, ms });
    logUsage(provider, modelId, out.usage, opts);

    const fellBackFrom = modelKey === chain[0] ? null : chain[0];
    if (fellBackFrom) recordFallback(fellBackFrom, modelKey, attempts, opts);

    return { text: out.text, modelKey, modelId, provider, usage: out.usage, truncated: !!out.truncated, fellBackFrom, attempts };
  }

  // Whole chain down. Surface the most actionable reason: a credit problem is
  // ours to fix and is NOT retryable, so it must not be reported as capacity.
  const reasons = attempts.map(a => a.reason);
  const reason = reasons.includes('credits') ? 'credits'
    : reasons.includes('capacity') ? 'capacity'
      : reasons.every(r => r === 'config') ? 'config'
        // Every remaining model was skipped for lack of clock. Distinct from
        // 'capacity' on purpose: nothing upstream was wrong, WE ran out of
        // time, so a caller with a longer budget (the cron backstop) can
        // succeed on the identical request where the HTTP path could not.
        : reasons.every(r => r === 'deadline') ? 'deadline' : 'error';

  recordFallback(chain[0] || primary, null, attempts, opts);
  throw new LlmUnavailableError(
    'All models failed: ' + attempts.map(a => a.modelKey + '=' + a.reason).join(', '),
    reason,
    attempts
  );
}

// Spend logging is fire-and-forget: a storage hiccup must never fail a request
// the customer already paid for.
function logUsage(provider, modelId, usage, opts) {
  if (!usage) return;
  const entry = {
    caller: opts.caller || 'public-llm',
    model: modelId,
    agentId: opts.agentId || null,
    runId: opts.runId || null,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens
  };
  const log = provider === 'claude' ? storage.logClaudeUsage : storage.logGeminiUsage;
  if (typeof log === 'function') Promise.resolve(log(entry)).catch(() => {});
}

// A fallback means the primary provider is failing. That is a business signal —
// it is how we find out credits ran dry BEFORE the whole chain is down — so it
// is recorded rather than only logged to stdout.
function recordFallback(fromKey, toKey, attempts, opts) {
  const failure = attempts.find(a => !a.ok) || {};
  const entry = {
    ts: new Date().toISOString(),
    caller: opts.caller || 'public-llm',
    agentId: opts.agentId || null,
    from: fromKey,
    to: toKey,                       // null = the entire chain failed
    reason: failure.reason || null,
    status: failure.status || null,
    detail: (failure.detail || '').slice(0, 200)
  };
  console.error('[llm] fallback', JSON.stringify(entry));

  Promise.resolve()
    .then(async () => {
      const log = (await storage.getState('llmFallbackLog')) || [];
      log.push(entry);
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
      await storage.setState('llmFallbackLog', log.filter(e => e.ts >= cutoff).slice(-500));
    })
    .catch(() => {});
}

module.exports = { callModel, LlmUnavailableError, ATTEMPT_TIMEOUT_MS, _classify: classify };
