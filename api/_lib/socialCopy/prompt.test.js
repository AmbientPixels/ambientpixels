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
