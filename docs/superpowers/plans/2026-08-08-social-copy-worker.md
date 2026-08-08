# Social Copy Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Scribe writes the copy" heartbeat stage for short social posts with a stateless, cheap-model worker — cutting one full 6-hour stage of latency and ~28x of the cost of that step.

**Architecture:** A new pure module `api/_lib/socialCopy/` builds a small (~1k token) prompt from a shared voice spec, the product-facts entry, and platform rules, then calls `_lib/llm` with `model: 'claude-haiku'` (overridable via `systemConfig`, so the model can be changed without a deploy). It is dead code until Task 6 wires it into `agent-runner.js` behind a `systemConfig` kill switch that defaults to OFF. On any failure — bad output, quality-gate rejection, model outage — it falls back to creating the `social_copy` task for Scribe exactly as today. The worker never publishes; its output still goes through the quality gate, Quill, and CEO approval.

**Tech Stack:** Node.js (CommonJS), Azure Functions, `api/_lib/llm` (cross-provider model chain), `api/companyHeartbeat/quality-gate.js`, hand-rolled test runners (`node path/to/file.test.js`).

---

## Why this exists (read before starting)

Measured on 2026-08-08 from `geminiUsage`, last 40 fleet calls:

| | |
|---|---|
| Average input | **11,315 tokens** |
| Average output | **330 tokens** |
| Ratio | **34 : 1** |
| Scribe specifically | **11,582 in → 204 out** |

Scribe reads ~11.5k tokens of identity, memory and company doctrine to write ~150 words of social copy. A worker needs the brief, the voice rules, the product facts and the platform cap — about 1,000 tokens. The prompt built by Task 2 measures **563–646 input tokens** in practice, not the ~1,000 budgeted, so the input cut against Scribe's 11,582 is **~18–20x**.

### Measured, not projected (8 real calls, 2026-08-08)

Both candidate models were run four times each — two Bluesky briefs, two LinkedIn — through `_lib/llm` with the exact prompt Task 2 builds, and their output put through the exact checks Task 3 applies:

| model | passed checks | avg cost/post | vs Scribe ($0.0378) |
|---|---|---|---|
| **claude-haiku-4-5** | **4/4** | $0.00133 | **28x** |
| gemini-2.5-flash | 3/4 | $0.00067 | 56x |

**Haiku is the default, and the reason is quality, not cost.** Gemini overran the character limit in two separate samples (304 > 300 on Bluesky, 1517 > 1500 on LinkedIn) — a habit, not a fluke; it does not count characters reliably. Its copy also read as a feature list ("You get 5 free roasts daily. A free account raises it to 10. You can also get a full rewrite for $9") and led with the score, which the brief explicitly says not to do. Haiku produced shorter, restrained copy that led with a consequence ("Your resume probably has blind spots") and passed every check first time.

The cost gap between them is irrelevant at this volume. At the campaign's 3 posts/week, Haiku costs **$0.017/month** and Gemini **$0.009/month** — a difference of **less than one cent a month**, against Scribe's $0.49. Both are a rounding error; only one of them writes copy you would publish. Optimising the cheaper of two rounding errors at the expense of the output is false economy.

Gemini stays available via `systemConfig.socialCopyWorker.model` and is the right choice **if volume ever makes the difference real** — at which point the retry loop absorbs its overruns anyway, since a rejected attempt feeds "too long 1517>1500" straight back into the next prompt.

For reference, the full price table from `api/_utils/companyStorage.js`:

| model | $/M in | $/M out | in registry? |
|---|---|---|---|
| claude-sonnet-4-6 | 3.00 | 15.00 | yes |
| **claude-haiku-4-5** | **1.00** | **5.00** | **yes — the default** |
| gemini-2.5-flash | 0.30 | 2.50 | yes |
| gemini-2.0-flash | 0.10 | 0.40 | **no** |
| gemini-2.0-flash-lite | 0.025 | 0.10 | **no** |

The 2.0 models are cheaper again but are **not in `model-registry.js`**, and on this evidence the binding constraint is instruction-following, not price. 

The second win is latency. The heartbeat runs every 6 hours (`0 0 */6 * * *`) and `agent-runner.js` explicitly skips tasks younger than 30 seconds ("ANTI-STALL"), so each pipeline stage costs a cycle. Removing the Scribe stage removes ~6 hours from every social post.

**The queue is NOT the problem.** Active tasks are draining (52 → 42 over 8 cycles), agents use ~11 of ~21 available action slots, and only 0–2 new tasks are created per cycle against a cap of 6. Do not add parallel capacity expecting a speed-up — the win here is stage removal and cost, not throughput.

---

## Safety model (the "what if the cheap model writes something wrong" answer)

Four layers, in order:

1. **Deterministic pre-checks in the worker** (Task 3) — mandatory URL present, within platform length cap, no em dashes, no banned buzzwords. Pure regex, no model, catches the most common cheap-model failures for free.
2. **The existing quality gate** — worker output goes through `composeQualityVerdict` + `findUngroundedClaims` against `product-facts.json`, exactly as Scribe's output does today. Note this gate is **fail-open**.
3. **Fallback to Scribe** (Task 6) — any failure at any layer creates the `social_copy` task as today. The system degrades to current behaviour, never to nothing and never to unchecked copy.
4. **CEO approval is unchanged** — `api/actionsExecute/index.js` gate #1 rejects any action whose `approval.status` is not `approved`. Nothing this worker produces can reach the public without a human. **Do not touch that gate.**

---

## Do not touch

- `api/companyHeartbeat/index.js` — the central pump.
- `api/company-state/index.js`, `ambientpixels/staticwebapp.config.json`, `data/company-actions.json`.
- `api/actionsExecute/index.js` approval gates.
- `api/companyHeartbeat/agent-runner.js` is edited in Task 6 **only**, and only at the one call site named there.

---

## File Structure

| Path | Responsibility |
|---|---|
| `api/_lib/socialCopy/voice.js` | The brand-voice spec and platform rules, as data. One definition, shared by the worker and (Task 7) agent-runner. |
| `api/_lib/socialCopy/voice.test.js` | Guards that the spec still contains the load-bearing rules. |
| `api/_lib/socialCopy/prompt.js` | Pure prompt builder: brief + voice + product facts + platform → prompt string. No I/O. |
| `api/_lib/socialCopy/prompt.test.js` | Prompt content and token-budget tests. |
| `api/_lib/socialCopy/validate.js` | Pure deterministic post-checks (URL, length, em dash, buzzwords). No I/O. |
| `api/_lib/socialCopy/validate.test.js` | Validation tests. |
| `api/_lib/socialCopy/index.js` | `composeSocialCopy()` — the only impure part: calls `_lib/llm`, retries once, returns text + usage. |
| `api/_lib/socialCopy/worker.test.js` | Worker tests with a stubbed `callModel`. |
| `api/companyHeartbeat/agent-runner.js` | **Task 6 only.** One call site, behind a kill switch. |

---

## Task 1: The voice spec, as shared data

**Files:**
- Create: `api/_lib/socialCopy/voice.js`
- Test: `api/_lib/socialCopy/voice.test.js`

The spec below is copied **verbatim in substance** from the `social_copy` task description currently built in `api/companyHeartbeat/agent-runner.js` (~line 2801). Task 7 removes the duplicate.

- [ ] **Step 1: Write the failing test**

Create `api/_lib/socialCopy/voice.test.js`:

```js
// Run with: node api/_lib/socialCopy/voice.test.js
// The voice spec is the only thing standing between a cheap model and copy that
// does not sound like us. These assert the load-bearing rules survive edits.
const assert = require('assert');
const { VOICE_RULES, PLATFORM_RULES, BANNED_WORDS, platformRule } = require('./voice');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

t('the voice rules carry the non-negotiables', function () {
  const s = VOICE_RULES.toLowerCase();
  for (const must of ['founder voice', 'sentence case', 'em dash', '5th grade', 'one idea per line']) {
    assert.ok(s.includes(must), 'voice spec lost: ' + must);
  }
});

t('banned words include the ones that make copy read as AI marketing', function () {
  for (const w of ['supercharge', 'unleash', 'revolutionary', 'thrilled']) {
    assert.ok(BANNED_WORDS.includes(w), 'missing banned word: ' + w);
  }
});

t('every supported platform has a length cap and guidance', function () {
  for (const p of ['social_bluesky', 'social_x', 'social_linkedin']) {
    const r = platformRule(p);
    assert.ok(r, 'no rule for ' + p);
    assert.ok(Number.isFinite(r.maxLen) && r.maxLen > 0, p + ' has no usable maxLen');
    assert.ok(r.guidance && r.guidance.length > 10, p + ' has no guidance');
  }
});

t('an unknown platform returns null rather than a wrong default', function () {
  // Silently defaulting to 280 chars would truncate a LinkedIn post to a stub.
  assert.strictEqual(platformRule('social_tiktok'), null);
  assert.strictEqual(platformRule(''), null);
  assert.strictEqual(platformRule(undefined), null);
});

t('the whole spec stays small — it is the point of the worker', function () {
  const chars = VOICE_RULES.length + Object.values(PLATFORM_RULES).map(r => r.guidance).join('').length;
  assert.ok(chars < 4000, 'voice + platform guidance is ' + chars + ' chars; the budget is ~1k tokens total');
});

console.log('\nvoice tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node api/_lib/socialCopy/voice.test.js`
Expected: FAIL — `Cannot find module './voice'`

- [ ] **Step 3: Write the implementation**

Create `api/_lib/socialCopy/voice.js`:

```js
// voice.js — the brand voice spec and platform rules, as data.
//
// This text already existed, inline, inside the social_copy task description
// built by companyHeartbeat/agent-runner.js. It lives here so the worker and
// the Scribe path cannot drift apart: there is ONE definition of how we sound.
//
// Keep it small. The entire reason the worker is cheap is that its prompt is
// ~1k tokens instead of the ~11.5k a fleet agent carries.

const BANNED_WORDS = ['supercharge', 'unleash', 'revolutionary', 'thrilled', 'game-changing', 'seamless'];

const VOICE_RULES = [
  'Founder voice, not corporate: casual, proper sentence case (capitalize the first word of every sentence and the pronoun "I").',
  'Short paragraphs. One idea per line.',
  'No em dashes. No double hyphens.',
  'No buzzwords: ' + BANNED_WORDS.join(', ') + '.',
  'No rhetorical question hooks.',
  '5th grade reading level.',
  'Lead with specifics, not adjectives. Vulnerability beats polish.',
  'No markdown, no headers, no internal notes, no "Post 1/Post 2" labels.'
].join('\n- ');

const PLATFORM_RULES = {
  social_bluesky: { maxLen: 300, guidance: 'One short post. Every character counts; lead with the specific.' },
  social_x: { maxLen: 280, guidance: 'One short post. Every character counts; lead with the specific.' },
  social_linkedin: { maxLen: 1500, guidance: 'Aim for 800-1500 chars. Write like a short article: narrative hook, short paragraphs, personal voice, clear takeaway. NOT a compressed ad tagline.' }
};

// Returns null for unknown platforms on purpose. A default of 280 would
// silently truncate a LinkedIn post into a stub, and the caller must be able
// to tell "I do not handle this" from "here is a cap".
function platformRule(platform) {
  if (!platform || typeof platform !== 'string') return null;
  return PLATFORM_RULES[platform] || null;
}

module.exports = { VOICE_RULES, PLATFORM_RULES, BANNED_WORDS, platformRule };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node api/_lib/socialCopy/voice.test.js`
Expected: PASS — `voice tests: 5 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add api/_lib/socialCopy/voice.js api/_lib/socialCopy/voice.test.js
git commit -m "Extract the brand voice spec so one definition can serve two writers"
```

---

## Task 2: The prompt builder

**Files:**
- Create: `api/_lib/socialCopy/prompt.js`
- Test: `api/_lib/socialCopy/prompt.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/_lib/socialCopy/prompt.test.js`:

```js
// Run with: node api/_lib/socialCopy/prompt.test.js
//
// The prompt IS the cost. A fleet agent spends ~11,315 input tokens to produce
// ~330 output; this worker exists to do the same job in ~1,000. A test that
// only checked content would let the prompt quietly grow back.
const assert = require('assert');
const { buildCopyPrompt, estimateTokens } = require('./prompt');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const BRIEF = {
  title: 'Draft Bluesky post for Resume Roast: first traffic probe',
  description: 'Send people to the free resume roast. Lead with the roast, not the score.',
  platform: 'social_bluesky',
  url: 'https://www.ambientpixels.ai/resume-roast/',
  productKey: 'ResumeRoast'
};

t('the prompt carries the brief, the URL and the platform cap', function () {
  const p = buildCopyPrompt(BRIEF);
  assert.ok(p.includes('Resume Roast'), 'brief title missing');
  assert.ok(p.includes('https://www.ambientpixels.ai/resume-roast/'), 'mandatory URL missing');
  assert.ok(p.includes('300'), 'bluesky length cap missing');
});

t('product facts are included so a cheap model has no reason to invent them', function () {
  const p = buildCopyPrompt(BRIEF);
  assert.ok(/no signup/i.test(p), 'product facts not injected');
  // The notThis list is what stops it confusing this with AmbientScore.
  assert.ok(/AmbientScore/i.test(p), 'the "what this is NOT" facts must be present');
});

t('an unknown product still builds a prompt, without inventing facts', function () {
  const p = buildCopyPrompt(Object.assign({}, BRIEF, { productKey: 'NoSuchProduct' }));
  assert.ok(p.length > 0);
  assert.ok(!/undefined/.test(p), 'undefined leaked into the prompt');
});

t('an unsupported platform is refused rather than guessed at', function () {
  assert.throws(() => buildCopyPrompt(Object.assign({}, BRIEF, { platform: 'social_tiktok' })), /platform/i);
});

t('a missing URL is refused — every post must carry one', function () {
  assert.throws(() => buildCopyPrompt(Object.assign({}, BRIEF, { url: '' })), /url/i);
});

t('the prompt stays inside the token budget that makes this worth doing', function () {
  const tokens = estimateTokens(buildCopyPrompt(BRIEF));
  assert.ok(tokens < 1600, 'prompt is ~' + tokens + ' tokens; a fleet agent is ~11315 and the budget here is ~1000');
});

t('quality-gate feedback is appended when a previous attempt failed', function () {
  const p = buildCopyPrompt(Object.assign({}, BRIEF, { qgFeedback: 'Too long. Removed the URL.' }));
  assert.ok(p.includes('Too long'), 'retry feedback not passed through');
});

t('the output contract forbids preamble, because the deliverable is published verbatim', function () {
  const p = buildCopyPrompt(BRIEF);
  assert.ok(/first character/i.test(p), 'the no-preamble rule is missing and preamble ships to the public');
});

console.log('\nprompt tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node api/_lib/socialCopy/prompt.test.js`
Expected: FAIL — `Cannot find module './prompt'`

- [ ] **Step 3: Write the implementation**

Create `api/_lib/socialCopy/prompt.js`:

```js
// prompt.js — builds the worker's prompt. Pure: no I/O, no model, no storage.
//
// Budget: ~1,000 tokens. That number is the entire justification for this
// module — a fleet agent spends ~11,315 input tokens on the same job because it
// carries identity, memory and company doctrine it does not need in order to
// write 150 words.

const path = require('path');
const { VOICE_RULES, platformRule } = require('./voice');

// Loaded once at require time. product-facts.json is the source of truth for
// what we may claim; Nova owns it. Injecting the relevant entry is far cheaper
// than letting a weak model guess and relying on the gate to catch it.
let PRODUCT_FACTS = {};
try {
  PRODUCT_FACTS = require(path.join(__dirname, '..', '..', '_data', 'product-facts.json')).products || {};
} catch (e) {
  PRODUCT_FACTS = {};
}

// ~4 chars per token is close enough to bound a budget; this is a guardrail,
// not billing.
function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function factsBlock(productKey) {
  const f = PRODUCT_FACTS[productKey];
  if (!f) return '';
  const lines = ['TRUE FACTS ABOUT THIS PRODUCT (do not state anything outside this list):'];
  (f.features || []).slice(0, 6).forEach(x => lines.push('- ' + x));
  if ((f.notThis || []).length) {
    lines.push('WHAT IT IS NOT (getting these wrong is the most common failure):');
    (f.notThis || []).slice(0, 4).forEach(x => lines.push('- ' + x));
  }
  return lines.join('\n') + '\n\n';
}

function buildCopyPrompt(brief) {
  brief = brief || {};
  const rule = platformRule(brief.platform);
  if (!rule) throw new Error('buildCopyPrompt: unsupported platform "' + brief.platform + '"');
  const url = String(brief.url || '').trim();
  if (!url) throw new Error('buildCopyPrompt: a product url is required — every post must carry one');

  const qg = brief.qgFeedback
    ? 'A PREVIOUS ATTEMPT WAS REJECTED. Fix this and do not repeat it:\n' + brief.qgFeedback + '\n\n'
    : '';

  return [
    'Write ONE publish-ready social media post.',
    '',
    'BRIEF: ' + String(brief.title || '').slice(0, 200),
    String(brief.description || '').slice(0, 600),
    '',
    factsBlock(brief.productKey) + qg +
    'PLATFORM: ' + brief.platform + ' — max ' + rule.maxLen + ' characters. ' + rule.guidance,
    '',
    'VOICE:',
    '- ' + VOICE_RULES,
    '',
    'HARD REQUIREMENTS:',
    '- The post MUST include this URL exactly once: ' + url,
    '- Stay under ' + rule.maxLen + ' characters, including the URL.',
    '- Write exactly ONE post. Not variations, not a batch.',
    '- The first character of your reply IS the first character of the post. No preamble, no "here is the post", no rationale. Your reply is published verbatim.',
    '- Never state a number, statistic or outcome that is not in the facts above.'
  ].join('\n');
}

module.exports = { buildCopyPrompt, estimateTokens };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node api/_lib/socialCopy/prompt.test.js`
Expected: PASS — `prompt tests: 8 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add api/_lib/socialCopy/prompt.js api/_lib/socialCopy/prompt.test.js
git commit -m "Build the worker prompt from facts and voice, inside a 1k token budget"
```

---

## Task 3: Deterministic post-checks

**Files:**
- Create: `api/_lib/socialCopy/validate.js`
- Test: `api/_lib/socialCopy/validate.test.js`

These run before the quality gate. They cost nothing and catch the failures a cheap model actually makes.

- [ ] **Step 1: Write the failing test**

Create `api/_lib/socialCopy/validate.test.js`:

```js
// Run with: node api/_lib/socialCopy/validate.test.js
// Free checks that catch the cheap model's most likely mistakes before the
// (fail-open) quality gate is asked to.
const assert = require('assert');
const { validateCopy } = require('./validate');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const URL = 'https://www.ambientpixels.ai/resume-roast/';
const OK = 'Your resume says "responsible for". So did every intern. Get it roasted free. ' + URL;

t('good copy passes', function () {
  const r = validateCopy(OK, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
});

t('a missing URL fails — the post would send nobody anywhere', function () {
  const r = validateCopy('Get your resume roasted free.', { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /url/i.test(p)));
});

t('over-length fails, with the actual numbers named', function () {
  const r = validateCopy('x'.repeat(400) + ' ' + URL, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /300/.test(p) && /4\d\d/.test(p)), 'problem must name limit and actual: ' + JSON.stringify(r.problems));
});

t('em dashes fail — they are the clearest tell that a model wrote it', function () {
  const r = validateCopy('Your resume — it is bad. ' + URL, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /em dash/i.test(p)));
});

t('banned buzzwords fail and the offender is named', function () {
  const r = validateCopy('Supercharge your resume today. ' + URL, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /supercharge/i.test(p)));
});

t('preamble fails — it would be published verbatim', function () {
  const r = validateCopy('Here is the post: get roasted. ' + URL, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /preamble/i.test(p)));
});

t('a refusal is caught rather than published as the post', function () {
  const r = validateCopy('I cannot write this post because the brief is unclear.', { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /refusal/i.test(p)));
});

t('empty or whitespace output fails', function () {
  for (const bad of ['', '   ', null, undefined]) {
    assert.strictEqual(validateCopy(bad, { platform: 'social_bluesky', url: URL }).ok, false);
  }
});

t('the URL appearing twice fails — it reads as spam', function () {
  const r = validateCopy('Roast it ' + URL + ' seriously ' + URL, { platform: 'social_bluesky', url: URL });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /once/i.test(p)));
});

console.log('\nvalidate tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node api/_lib/socialCopy/validate.test.js`
Expected: FAIL — `Cannot find module './validate'`

- [ ] **Step 3: Write the implementation**

Create `api/_lib/socialCopy/validate.js`:

```js
// validate.js — deterministic post-checks. Pure: no I/O, no model.
//
// These run BEFORE the quality gate, which is fail-open. A regex costs nothing
// and catches the failures a small model actually produces: preamble, refusals,
// a dropped URL, over-length, and the buzzwords that make copy read as AI
// marketing.

const { platformRule, BANNED_WORDS } = require('./voice');

const PREAMBLE_RX = /^\s*(here('| i)s|this is|sure[,!]|okay[,!]|i'?ve written|draft:|post:)/i;
const REFUSAL_RX = /\b(i (cannot|can't|am unable to)|as an ai|i'm sorry, but)\b/i;

function validateCopy(text, opts) {
  opts = opts || {};
  const s = String(text == null ? '' : text).trim();
  const problems = [];

  if (!s) return { ok: false, problems: ['empty output'] };

  const rule = platformRule(opts.platform);
  if (!rule) problems.push('unsupported platform "' + opts.platform + '"');
  else if (s.length > rule.maxLen) problems.push('too long: ' + s.length + ' chars, limit is ' + rule.maxLen);

  if (REFUSAL_RX.test(s)) problems.push('reads as a refusal, which would be published as the post');
  if (PREAMBLE_RX.test(s)) problems.push('starts with preamble, which would be published verbatim');

  const url = String(opts.url || '').trim();
  if (url) {
    const n = s.split(url).length - 1;
    if (n === 0) problems.push('missing the required url ' + url);
    else if (n > 1) problems.push('the url appears ' + n + ' times; include it exactly once');
  }

  if (/—|--/.test(s)) problems.push('contains an em dash or double hyphen');

  const lower = s.toLowerCase();
  BANNED_WORDS.forEach(function (w) {
    if (lower.includes(w)) problems.push('contains the banned word "' + w + '"');
  });

  return { ok: problems.length === 0, problems: problems };
}

module.exports = { validateCopy };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node api/_lib/socialCopy/validate.test.js`
Expected: PASS — `validate tests: 9 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add api/_lib/socialCopy/validate.js api/_lib/socialCopy/validate.test.js
git commit -m "Catch the cheap model's likely mistakes with free deterministic checks"
```

---

## Task 4: The worker

**Files:**
- Create: `api/_lib/socialCopy/index.js`
- Test: `api/_lib/socialCopy/worker.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/_lib/socialCopy/worker.test.js`:

```js
// Run with: node api/_lib/socialCopy/worker.test.js
// callModel is stubbed — no network in tests, ever.
const assert = require('assert');

const llmPath = require.resolve('../llm');
let calls = [];
let scripted = [];
require.cache[llmPath] = {
  id: llmPath, filename: llmPath, loaded: true,
  exports: {
    async callModel(opts) {
      calls.push(opts);
      const next = scripted.shift();
      if (!next) throw new Error('no scripted response');
      if (next instanceof Error) throw next;
      return { text: next, modelKey: opts.model, modelId: opts.model, provider: 'claude',
               usage: { promptTokens: 900, completionTokens: 120, totalTokens: 1020 },
               truncated: false, fellBackFrom: null, attempts: [] };
    },
    LlmUnavailableError: class LlmUnavailableError extends Error {}
  }
};

const { composeSocialCopy } = require('./index');

let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }

const URL = 'https://www.ambientpixels.ai/resume-roast/';
const BRIEF = { title: 'Draft Bluesky post for Resume Roast', description: 'Send people to the free roast.',
                platform: 'social_bluesky', url: URL, productKey: 'ResumeRoast' };
const GOOD = 'Your resume says "responsible for". So did every intern who opened the repo. Get it roasted free. ' + URL;

function reset() { calls = []; scripted = []; }

t('returns the post and the usage on a clean first attempt', async () => {
  reset(); scripted = [GOOD];
  const r = await composeSocialCopy(BRIEF);
  assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
  assert.strictEqual(r.text, GOOD);
  assert.strictEqual(r.usage.promptTokens, 900);
  assert.strictEqual(calls.length, 1);
});

t('uses a CHEAP model — that is the point of the worker', async () => {
  reset(); scripted = [GOOD];
  await composeSocialCopy(BRIEF);
  assert.strictEqual(calls[0].model, 'claude-haiku',
    'worker called ' + calls[0].model + '; a fleet-tier model erases the cost saving');
});

t('the model can be overridden without a code change, so it can be A/B tested', async () => {
  reset(); scripted = [GOOD];
  await composeSocialCopy(Object.assign({}, BRIEF, { model: 'gemini-flash' }));
  assert.strictEqual(calls[0].model, 'gemini-flash', 'brief.model must win over the default');
});

t('the prompt it sends stays inside the token budget', async () => {
  reset(); scripted = [GOOD];
  await composeSocialCopy(BRIEF);
  const approxTokens = Math.ceil(calls[0].prompt.length / 4);
  assert.ok(approxTokens < 1600, 'sent ~' + approxTokens + ' tokens; a fleet agent averages 11315 and the budget is ~1000');
});

t('a rejected first attempt retries ONCE with the problems fed back', async () => {
  reset(); scripted = ['Supercharge your resume. ' + URL, GOOD];
  const r = await composeSocialCopy(BRIEF);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(calls.length, 2, 'expected exactly one retry');
  assert.ok(/supercharge/i.test(calls[1].prompt), 'the retry must tell it what was wrong');
});

t('two bad attempts give up rather than publishing bad copy', async () => {
  reset(); scripted = ['Supercharge it. ' + URL, 'Unleash it. ' + URL];
  const r = await composeSocialCopy(BRIEF);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.length > 0);
  assert.strictEqual(calls.length, 2, 'must not retry forever');
});

t('a model outage resolves to ok:false, never throws at the caller', async () => {
  reset(); scripted = [new Error('all models failed')];
  const r = await composeSocialCopy(BRIEF);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /model|unavailable|failed/i.test(p)));
});

t('an unsupported platform fails cleanly without calling the model at all', async () => {
  reset(); scripted = [GOOD];
  const r = await composeSocialCopy(Object.assign({}, BRIEF, { platform: 'social_tiktok' }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(calls.length, 0, 'must not spend a model call on a platform it cannot handle');
});

t('spend is attributed to the worker, not to whatever called it', async () => {
  reset(); scripted = [GOOD];
  await composeSocialCopy(BRIEF);
  assert.strictEqual(calls[0].caller, 'social-copy-worker',
    'without this the worker cannot be told apart from the agents in Cost Overview');
});

(async function () {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ok    ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
  }
  console.log('\nworker tests: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node api/_lib/socialCopy/worker.test.js`
Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Write the implementation**

Create `api/_lib/socialCopy/index.js`:

```js
// socialCopy — a stateless worker that writes one short social post.
//
// NOT an agent. It has no identity, no memory, no XP, no registry entry and no
// place in the retirement ladder. That is deliberate: memoryConsolidate grinds
// archived agents forever, so anything given an identity becomes permanent
// recurring cost. This is a function that returns text and forgets.
//
// Cost, measured 2026-08-08: a fleet agent averages 11,315 input tokens to
// produce ~330 output (34:1); Scribe specifically spends 11,582 to write ~204.
// This sends ~600 on claude-haiku: ~$0.00133 per post against ~$0.0378, i.e.
// ~28x, measured. Note it is NOT the token ratio times the price ratio — the
// output tokens do not shrink and are priced far above input, so only the
// input side benefits from the smaller prompt.

const { callModel } = require('../llm');
const { buildCopyPrompt } = require('./prompt');
const { validateCopy } = require('./validate');

// claude-haiku: $0.00133 per post vs Scribe's $0.0378 (28x), measured over 4
// real calls, 4/4 passing the deterministic checks. gemini-2.5-flash is half
// the price but overran the character limit in 2 of 4 samples and wrote copy
// that read as a feature list. At 3 posts/week the gap between them is under a
// cent a month, so this is a quality choice, not a cost one.
// Overridable per call so the model can be A/B'd from systemConfig, no deploy.
const DEFAULT_MODEL = 'claude-haiku';
const MAX_ATTEMPTS = 2;      // one try, one corrective retry. Never a loop.
const TIMEOUT_MS = 45000;

/**
 * @returns {Promise<{ok:boolean, text:?string, problems:string[], usage:?object, attempts:number}>}
 * Never throws. The caller falls back to the Scribe path on ok:false, so a
 * thrown error here would turn a graceful degrade into a lost task.
 */
async function composeSocialCopy(brief) {
  const problems = [];
  let usage = null;
  let attempts = 0;
  let feedback = (brief && brief.qgFeedback) || '';

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    let prompt;
    try {
      prompt = buildCopyPrompt(Object.assign({}, brief, { qgFeedback: feedback }));
    } catch (err) {
      // Bad input, not a bad model. Retrying cannot help and would spend money.
      return { ok: false, text: null, problems: [err.message], usage: null, attempts: 0 };
    }

    attempts++;
    let out;
    try {
      out = await callModel({
        model: (brief && brief.model) || DEFAULT_MODEL,
        prompt: prompt,
        maxTokens: 700,
        temperature: 0.7,
        caller: 'social-copy-worker',
        agentId: 'social-copy-worker',
        timeoutMs: TIMEOUT_MS
      });
    } catch (err) {
      problems.push('model unavailable: ' + (err && err.message ? err.message : String(err)));
      return { ok: false, text: null, problems: problems, usage: usage, attempts: attempts };
    }

    usage = out.usage || usage;
    const text = String(out.text || '').trim();
    const verdict = validateCopy(text, { platform: brief.platform, url: brief.url });
    if (verdict.ok) {
      return { ok: true, text: text, problems: [], usage: usage, attempts: attempts };
    }

    problems.length = 0;
    verdict.problems.forEach(p => problems.push(p));
    feedback = verdict.problems.join('; ');
  }

  return { ok: false, text: null, problems: problems, usage: usage, attempts: attempts };
}

module.exports = { composeSocialCopy, DEFAULT_MODEL, MAX_ATTEMPTS };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node api/_lib/socialCopy/worker.test.js`
Expected: PASS — `worker tests: 8 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add api/_lib/socialCopy/index.js api/_lib/socialCopy/worker.test.js
git commit -m "A stateless social copy worker: cheap model, 1k prompt, no identity"
```

---

## Task 5: Prove the saving before wiring anything

**Files:**
- Create: `scripts/measure-social-copy-worker.cjs`

A one-off measurement. It makes ONE real model call, so it costs a fraction of a cent. Run it before Task 6 — if the numbers do not hold, stop and report rather than wiring it in.

- [ ] **Step 1: Write the script**

Create `scripts/measure-social-copy-worker.cjs`:

```js
#!/usr/bin/env node
// Proves the worker's cost claim against the measured fleet baseline.
// Run: node scripts/measure-social-copy-worker.cjs
// Requires ANTHROPIC_API_KEY in the environment. Makes ONE real call.

const { composeSocialCopy } = require('../api/_lib/socialCopy');

// Measured 2026-08-08 from geminiUsage, last 40 fleet calls.
const FLEET_AVG_INPUT = 11315;
const SCRIBE_AVG_INPUT = 11582;

(async () => {
  const r = await composeSocialCopy({
    title: 'Draft Bluesky post for Resume Roast: first traffic probe',
    description: 'Send people to the free resume roast. Lead with the roast, not the score.',
    platform: 'social_bluesky',
    url: 'https://www.ambientpixels.ai/resume-roast/',
    productKey: 'ResumeRoast'
  });

  console.log('ok        :', r.ok);
  console.log('attempts  :', r.attempts);
  console.log('problems  :', r.problems);
  console.log('post      :', r.text);
  console.log('');
  if (r.usage) {
    console.log('input tokens : ' + r.usage.promptTokens + '   (fleet avg ' + FLEET_AVG_INPUT + ', scribe ' + SCRIBE_AVG_INPUT + ')');
    console.log('output tokens: ' + r.usage.completionTokens);
    console.log('input cut    : ' + (SCRIBE_AVG_INPUT / Math.max(1, r.usage.promptTokens)).toFixed(1) + 'x vs scribe');
    console.log('');
    const sonnet = { i: 3.00, o: 15.00 }, haiku = { i: 1.00, o: 5.00 };
    const cost = (i, o, pr) => (i * pr.i + o * pr.o) / 1e6;
    const scribeCost = cost(SCRIBE_AVG_INPUT, 204, sonnet);
    const workerCost = cost(r.usage.promptTokens, r.usage.completionTokens, haiku);
    console.log('scribe cost  : $' + scribeCost.toFixed(5));
    console.log('worker cost  : $' + workerCost.toFixed(5));
    console.log('COST CUT     : ' + (scribeCost / workerCost).toFixed(0) + 'x   (expect ~28x)');
  }
  process.exit(r.ok ? 0 : 1);
})();
```

- [ ] **Step 2: Run it**

Run: `node scripts/measure-social-copy-worker.cjs`
Expected: `ok: true`, a readable post under 300 chars containing the URL, and `input cut` of **8x or better**.

**If the input cut is under 5x, STOP.** The premise of this plan has failed — report the number rather than wiring it in.

- [ ] **Step 3: Commit**

```bash
git add scripts/measure-social-copy-worker.cjs
git commit -m "Measure the worker against the fleet baseline before trusting the claim"
```

---

## Task 6: Wire it in, behind a kill switch that defaults OFF

**Files:**
- Modify: `api/companyHeartbeat/agent-runner.js` (the `copyTask` creation site, ~line 2798)

`agent-runner.js` is high blast radius. This is the **only** task that edits it, and it touches **one** call site.

- [ ] **Step 1: Read the call site before changing it**

Run: `sed -n '2780,2850p' api/companyHeartbeat/agent-runner.js`

You are looking for `const copyTask = {` — the object that hands work to Scribe. The change wraps its creation, it does not delete it. **The Scribe path must remain reachable**, because it is the fallback.

**Anchor check — run this before editing.** This file is actively developed, so the region can move:

```bash
for a in "const copyTask = {" "tasks.push(copyTask);" "_detectProductFromTask" "AUTO-CREATED Scribe copy task"; do
  printf "%-34s %s\n" "$a" "$(grep -c "$a" api/companyHeartbeat/agent-runner.js)"
done
```

Expected: `const copyTask = {` → 1, `tasks.push(copyTask);` → 1, `_detectProductFromTask` → 4, `AUTO-CREATED Scribe copy task` → 1.

**If any count differs, STOP and report rather than editing.** 0 means the code moved; more than expected means there is now a second call site and this plan no longer describes the file.

- [ ] **Step 2: Add the switch read and the worker attempt**

Immediately **before** `const copyTask = {`, insert:

```js
              // Social copy worker (2026-08-08). Off by default; flip
              // systemConfig.socialCopyWorker.enabled to true to use it.
              //
              // Why: this hand-off costs a full heartbeat (agents skip tasks
              // younger than 30s, and the cycle is 6h) and ~11,582 input tokens
              // of Scribe's context to produce ~204 tokens of post. The worker
              // does it inline for ~1,000 tokens on a cheaper model.
              //
              // Every failure path falls through to the Scribe task below. That
              // is the safety valve: we degrade to today's behaviour, never to
              // nothing and never to unchecked copy.
              let _workerCopy = null;
              try {
                const _sysCfg = (await storage.getState('systemConfig')) || {};
                if (_sysCfg.socialCopyWorker && _sysCfg.socialCopyWorker.enabled === true) {
                  const { composeSocialCopy } = require('../_lib/socialCopy');
                  const _r = await composeSocialCopy({
                    title: stripTaskPrefixes(socialTask.title || ''),
                    description: (socialTask.description || '').substring(0, 600),
                    platform: _platform,
                    url: _cmpUrl,
                    // _detectProductFromTask already exists in this file (~line
                    // 139) and resolves the product from the task text against
                    // product-facts.json. Reuse it rather than adding a static
                    // config value that would be wrong the moment a campaign
                    // covers a second product.
                    productKey: _detectProductFromTask(socialTask),
                    // Lets the model be swapped from systemConfig with no deploy,
                    // so claude-haiku vs gemini-flash can be compared on real copy.
                    model: _sysCfg.socialCopyWorker.model || undefined,
                    qgFeedback: _qgFeedback || ''
                  });
                  if (_r.ok) {
                    _workerCopy = _r.text;
                    context.log('[Heartbeat] social-copy-worker wrote copy for', action.taskId,
                      'in', _r.attempts, 'attempt(s), input tokens', _r.usage && _r.usage.promptTokens);
                  } else {
                    context.log('[Heartbeat] social-copy-worker declined for', action.taskId,
                      '-', _r.problems.join('; '), '- falling back to scribe');
                    // Leave a trace you can SEE. A fallback that only exists in App
                    // Insights looks identical to the worker never having run, which
                    // makes 'is this thing working' unanswerable from the dashboard.
                    socialTask.comments = socialTask.comments || [];
                    socialTask.comments.push({
                      id: 'cmt-' + Date.now(),
                      author: 'social-copy-worker',
                      text: 'Declined after ' + _r.attempts + ' attempt(s), handed to Scribe. Reasons: ' + _r.problems.join('; '),
                      type: 'note',
                      createdAt: new Date().toISOString()
                    });
                  }
                }
              } catch (_wErr) {
                context.log('[Heartbeat] social-copy-worker threw, falling back to scribe:', _wErr.message);
              }
```

- [ ] **Step 3: Attach the copy as a deliverable when the worker succeeded**

At **line 2840–2841** you will find exactly these two lines:

```js
              tasks.push(copyTask);
              context.log('[Heartbeat]', agentId, 'AUTO-CREATED Scribe copy task:', copyTask.id, 'for social task:', action.taskId);
```

Replace **both** lines (keep the log inside the `else`, or a fallback will look silent in the logs) with:

```js
              if (_workerCopy) {
                // Same shape Scribe's deliverable takes, so the quality gate,
                // Quill review and CEO approval downstream cannot tell the
                // difference and need no changes.
                socialTask.comments = socialTask.comments || [];
                socialTask.comments.push({
                  id: 'cmt-' + Date.now(),
                  author: 'social-copy-worker',
                  text: _workerCopy,
                  type: 'deliverable',
                  createdAt: new Date().toISOString()
                });
                socialTask.awaiting_copy_review = true;
              } else {
                tasks.push(copyTask);
                context.log('[Heartbeat]', agentId, 'AUTO-CREATED Scribe copy task:', copyTask.id, 'for social task:', action.taskId);
              }
```

- [ ] **Step 4: Verify nothing else changed**

Run: `git diff --stat api/companyHeartbeat/agent-runner.js`
Expected: **one file, roughly 47 insertions, 2 deletions.** If more lines were deleted, you have removed the Scribe fallback — revert and redo.

Run: `grep -c "tasks.push(copyTask)" api/companyHeartbeat/agent-runner.js`
Expected: **1**. Zero means the fallback is gone, which is the one outcome this task must not produce.

Run: `node --check api/companyHeartbeat/agent-runner.js`
Expected: no output.

- [ ] **Step 5: Run the whole suite, including smoke tests**

Run:
```bash
for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules | sort); do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```
Expected: `done` with no FAIL lines. Baseline is **1001 tests across 54 suites**; this plan adds 30, so expect ~1031.

- [ ] **Step 6: Commit**

```bash
git add api/companyHeartbeat/agent-runner.js
git commit -m "Let a worker write short social copy inline, behind a default-off switch"
```

---

## Task 7: Remove the duplicated voice spec

**Files:**
- Modify: `api/companyHeartbeat/agent-runner.js` (the `copyTask.description` string, ~line 2801)

Task 1 copied the voice rules into `voice.js`. Two copies will drift. Now that we are already in this file, collapse them.

- [ ] **Step 1: Replace the inline voice lines with the shared constant**

In the `copyTask` description, replace the literal line beginning `'- Founder voice (NOT corporate):'` and the buzzword list that follows it with:

```js
                  + '- ' + require('../_lib/socialCopy/voice').VOICE_RULES + '\n'
```

Leave every other requirement line (deliverable format, refusal handling, LinkedIn/Reddit guidance, the URL requirement) exactly as it is — those are Scribe-specific and are not in `voice.js`.

- [ ] **Step 2: Verify the Scribe prompt still contains the rules**

Run:
```bash
node -e "
const {VOICE_RULES}=require('./api/_lib/socialCopy/voice');
['founder voice','sentence case','em dash','5th grade'].forEach(k=>{
  if(!VOICE_RULES.toLowerCase().includes(k)) { console.error('MISSING: '+k); process.exit(1); }
});
console.log('voice rules intact');
"
```
Expected: `voice rules intact`

- [ ] **Step 3: Syntax check and full suite**

Run: `node --check api/companyHeartbeat/agent-runner.js`
Expected: no output.

Run the suite loop from Task 6 Step 5. Expected: no FAIL lines.

- [ ] **Step 4: Commit**

```bash
git add api/companyHeartbeat/agent-runner.js
git commit -m "One definition of how we sound, shared by both writers"
```

---

## Task 8: Enable it, and watch

Nothing here changes code. `systemConfig` is **read-modify-write — a POST replaces the whole object**, so a blind write wipes every other setting.

- [ ] **Step 1: Enable the switch (GET first, always)**

```bash
SECRET=$(sed -n 's/^COMPANY_WRITE_SECRET=//p' /c/Dev/Ambientpixels/COMPANY_WRITE_SECRET.txt | head -1 | tr -d '\r\n')
API="https://ambientpixels-nova-api.azurewebsites.net/api"
node -e "
const API='$API', SECRET='$SECRET';
(async()=>{
  const cur=(await (await fetch(API+'/company-state?key=systemConfig',{headers:{'x-company-secret':SECRET}})).json()).value||{};
  console.log('existing keys:', Object.keys(cur).join(', '));
  cur.socialCopyWorker={enabled:true};
  const r=await fetch(API+'/company-state',{method:'POST',headers:{'Content-Type':'application/json','x-company-secret':SECRET},body:JSON.stringify({key:'systemConfig',value:cur})});
  if(!r.ok){console.error('write failed',r.status);process.exit(1);}
  const back=(await (await fetch(API+'/company-state?key=systemConfig',{headers:{'x-company-secret':SECRET}})).json()).value;
  console.log('enabled:', back.socialCopyWorker.enabled, '| keys still present:', Object.keys(back).length);
})();
"
```
Expected: `enabled: true`, and the key count unchanged from the first line.

- [ ] **Step 2: Wait for one heartbeat and confirm it ran**

The heartbeat is `0 0 */6 * * *` — 00:00, 06:00, 12:00, 18:00 UTC. After the next one, check for the worker's log line and a deliverable authored by `social-copy-worker`:

```bash
curl -s "$API/company-state?key=tasks" -H "x-company-secret: $SECRET" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const v=JSON.parse(d).value||[];
  const hits=v.filter(t=>(t.comments||[]).some(c=>c.author==='social-copy-worker'));
  console.log('tasks with worker-written copy:', hits.length);
  hits.slice(0,5).forEach(t=>{
    const c=(t.comments||[]).find(x=>x.author==='social-copy-worker');
    console.log('  '+t.id+'  ['+t.status+']  '+String(c.text).slice(0,110));
  });
});"
```

- [ ] **Step 3: Confirm the cost in the spend breakdown**

```bash
curl -s "$API/llm-spend" -H "x-company-secret: $SECRET" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d);
  const w=(j.topCallers||[]).find(c=>c.caller==='social-copy-worker');
  console.log('social-copy-worker spend:', w?('\$'+w.usd):'not yet present');
  console.log('daily burn:', j.dailyBurnUsd, ' runway days:', j.runwayDays);
});"
```

- [ ] **Step 4: Read the post before believing it**

Open the copy the worker produced and read it as a person. The gate is fail-open and the model is small — **a status code cannot tell you whether the writing is any good.** If it reads badly, set `enabled:false` (same GET-first pattern) and report what it got wrong; the Scribe path resumes immediately with no deploy.

---

## How to watch it

No new dashboard is needed — the worker is visible in three places that already exist, provided it keeps `caller` and `agentId` set to `social-copy-worker` (Task 4 asserts both).

**1. Cost Overview — `modules/company/cost-overview.html`.** It already renders cost grouped by CALLER and by AGENT, fed by `/api/geminiCosts` and `/api/claudeCosts`, which build `byCaller` and `byAgent` from the usage log. The worker appears as its own row in both, next to the agents, with no code change. `gemini-2.5-flash` and `claude-haiku-4-5-20251001` are both already priced in `GEMINI_PRICING` / `CLAUDE_PRICING`, so the cost is real rather than defaulted.

**2. The tasks themselves.** Every post the worker writes lands as a task comment with `author: "social-copy-worker"`, and every time it declines it leaves a `note` comment saying why and how many attempts it took. So "worker wrote this" vs "Scribe wrote this" vs "worker tried and gave up" are all distinguishable per task, in the UI you already use.

**3. `GET /api/llm-spend`** (secret-gated) lists `topCallers` live, if you want the number without opening a dashboard.

What you will NOT see is a spawn/despawn event, because there is nothing to spawn — each call is a function invocation that returns text and ends. One row in `claudeUsage`/`geminiUsage` per call, 30-day retention, 5,000-entry cap. If you later want a running success rate, derive it from the ratio of `deliverable` to `note` comments authored by the worker; that needs no new state key.

---

## Rollback

Set `systemConfig.socialCopyWorker.enabled = false` using the GET-first pattern in Task 8 Step 1. The next heartbeat reverts to the Scribe path. No deploy, no revert, no data migration — the switch is read fresh every cycle.

---

## Out of scope, deliberately

- **Spawn/despawn by workload.** There is no high workload: the queue drains every cycle and agents use ~11 of ~21 slots. Routing by task *type* is deterministic and has no thresholds to tune.
- **Giving workers identities, XP or memory.** `memoryConsolidate` grinds archived agents forever, so an ephemeral identity becomes permanent recurring cost, and the XP economy and retirement ladder would fill with ghosts.
- **A second reviewer.** Quill already reviews brand voice. Adding Scribe and Echo as approvers puts three 9–17k-token reviews on a 150-word post and rebuilds the cost this saves.
- **The 48% blocked-action rate.** Real and worth fixing (37 of 83 blocks in 8 cycles are agents rediscovering paused campaigns), but it is a separate problem and this plan does not touch it.

---

## Kickoff prompt for the next context

Paste this into a fresh session.

```
Read `ambientpixels/docs/superpowers/plans/2026-08-08-social-copy-worker.md` and implement it
task by task. It is written to be followed exactly — every step has real code, real commands and
the expected output. Don't re-derive its reasoning; the measurements behind it are already done.

WHY IT EXISTS, in one paragraph: writing one short social post currently costs a full 6-hour
heartbeat stage and ~11,582 input tokens of Scribe's context to produce ~204 tokens of post.
Measured on 2026-08-08 across the last 40 fleet calls: average 11,315 tokens in, 330 out, a 34:1
ratio. A stateless worker with a ~1,000-token prompt on a cheaper model does the same job for
~28x less on claude-haiku ($0.00133 vs $0.0378 per post, measured over 4 real calls), and removes
a stage from a 5-stage pipeline on a 6-hour clock. Do NOT
"fix" this by adding capacity — the queue drains every cycle and agents already use only ~11 of
~21 available action slots. The win is stage removal and cost, not throughput.

STATE OF THE WORLD RIGHT NOW:
- The heartbeat is every 6h (`0 0 */6 * * *`). agent-runner skips tasks younger than 30s
  ("ANTI-STALL"), which is why each pipeline stage costs a full cycle.
- Baseline test suite: 1001 tests across 54 suites, green. Run them with
  `for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules); do node "$f"; done`
  Note the `*smoke-test.js` glob — pixel-agent-run has a 35-test smoke suite that a plain
  `*.test.js` sweep silently skips.
- `camp-resume-roast-launch` is live (LinkedIn + Bluesky + X, 3/week) against
  `obj-resume-roast-demand` (50 runs by 2026-08-22, kill under 15). It is the first real consumer
  of this pipeline, so its tasks are useful test subjects.
- All three social platforms are connected and healthy: X (@AIAmbientPixels, 52 followers),
  Bluesky (81), LinkedIn (2). Zero errored.
- **This repo auto-commits and pushes.** Edits left in the working tree can ship without you
  running `git push`. Do not leave a task half-finished across a break — finish and commit it
  deliberately, or revert it. Check `git status` before you stop.
- **Committed markdown under `docs/` is served publicly as raw text.** This plan is safe for
  anyone to read. If you add notes to it: no secrets, no balances, no tokens.

DO NOT DO WITHOUT ASKING ME:
- Touch `companyHeartbeat/index.js`, `company-state`, `staticwebapp.config.json`, or
  `data/company-actions.json`. Task 6 edits `agent-runner.js` at ONE named call site; that is the
  only permitted change to it.
- Weaken any approval gate. `actionsExecute` gate #1 rejects any action whose approval status is
  not `approved`, and it is the only thing standing between an agent and a public post.
- Post publicly as the brand, spend money, or create external accounts.
- Enable the kill switch (Task 8) before Task 5's measurement has passed.

RULES THAT EARNED THEIR PLACE:
- **If a step's anchor text does not match what is in the file, STOP and report it. Do not
  improvise a nearby edit.** The plan anchors on exact line CONTENT rather than line numbers,
  but `agent-runner.js` is actively developed — another session edited it on 2026-08-08 — so
  that region can still move. A plan that has drifted from the code is one to re-verify with
  me, not to approximate around. This applies especially to Task 6.
- Task 5 is a real gate, not a formality. If the measured input cut is under 5x, STOP and report
  the number. The whole plan rests on that claim and it is cheap to falsify.
- `systemConfig` is read-modify-write: a POST REPLACES the whole object. GET first, always, or you
  wipe every other setting. The plan's Task 8 shows the safe pattern.
- Verify in PRODUCTION, not just locally. When checking whether a deploy landed, grep for a string
  that exists ONLY in the new code — and check the workflow's STEP list, because a run can go green
  having skipped the API deploy entirely.
- Read the copy the worker writes, as a person, before believing it works. The quality gate is
  fail-open and the model is small. A 200 and a green suite cannot tell you whether the writing is
  any good.
- Never fabricate. Every product claim must be checkable in `api/_data/product-facts.json`.

Commit and push as you go, with real reasoning in the messages.
```
