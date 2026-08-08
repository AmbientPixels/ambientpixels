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
//
// NOT WIRED IN. Nothing calls composeSocialCopy() yet. The heartbeat call site
// is deliberately unbuilt: the drafted version of it set a deliverable comment
// and awaiting_copy_review, but the gate that actually releases a social action
// is socialTask.reviewed_copy (agent-runner.js ~2769), and the `continue` below
// it is unconditional. Wiring it that way dead-ends the post and skips Quill's
// review entirely. See the plan's Task 6 before giving this a caller.

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
