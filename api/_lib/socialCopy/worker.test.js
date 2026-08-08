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
