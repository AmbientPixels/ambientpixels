// Roast-lane targeting gates — the three that were missing on 2026-09-03.
//
// THE INCIDENT: eleven replies sat pending in the approval queue after eleven unattended
// days. Two were good targets. The other nine went to people who did not want, did not
// need, or had already solved the thing the product solves. Every existing gate — crisis,
// distress, politics, NSFW, self-prospecting — worked exactly as written. These are the
// cases nobody had written a gate for yet.
//
// The fixtures below are the REAL posts, verbatim from asProspects. That matters more
// than the regex details: a gate tuned on invented examples passes its own test and then
// meets prose. Every string in this file was harvested by the live lane and drew a real
// draft reply.
//
// The two GOOD targets are load-bearing. Any gate that starts refusing @knotmagick or
// @neonsparrows has stopped being precision and started being a mute button — check them
// before loosening or tightening anything here.

const { test } = require('node:test');
const assert = require('node:assert');

const P = require('./prospect-pipeline.js');
const REL = require('./bluesky-relevance.js');

// ── The real posts ──────────────────────────────────────────────────────────
const POSTS = {
  // Good targets — must survive every gate.
  knotmagick: "The worst part about looking for work while employed full time is that thanks to AI, job hunting is a full time job on its own. You have to submit HUNDREDS of applications to find ONE where you get past the AI, then customize resume/cover letter for every. Single. One.",
  neonsparrows: "would it be dumb to try to make a writing portfolio alongside trying to fix my resume",
  tdesseyn: "working with a recruiter is a gold mine of info outside of finding a job: where does my resume stack up against others you see? whats one thing youd fix on it? am i asking too much or too little on salary? where is my biggest gap technically compared to others youve spoken with",

  // Need already met.
  tonyringtail: "I JUST got accepted to a decent job after looking for 4 + months... I can offer some advice, there are online companies that will process your existing resume to make it AI friendly since 90+% of companies are letting AI do their resume reading now. I did it and it at least got me callbacks",
  nerdyqueer: "WELL... I updated my resume and LinkedIn last night after doing a lengthy rewrite, and I already had a screening call with a recruiter today! It went well, so maybe I'll end up only working at Target for a couple of weeks.",
  skeetlet: "I've had a (Job Hunt Domme place) service auto-tailoring my resume and spitting out applications to places (only after I review my resume and the place being applied to)... dozens of applications out, many rejections... well I just got my first interview from that service... we'll see how it goes!",

  // Wrong word sense — 'resume' as a verb.
  derekvandyke: "I would like to take a year off of having a job so I can fix my house and also work through my massive media backlog and also see many friends. But I should keep getting a paycheck. And I should get to resume my job in exactly one year. If this is not feasible, I'll take \"don't need sleep\" magic.",

  // Broadcast thread, trailing marker.
  hirerevolutionai: "Honestly, most ATS software was built decades ago to store resumes and search them by keywords, not to actually understand people. The re-typing thing happens because the system parses your resume into fields, does it badly, and then makes you fix its mistakes. It's not malice. It's just old (1/6)",

  // Still ungated as of 2026-09-03 — see the final test.
  bartdorsey: "How I automated applying to jobs using the open source Reactive Resume and Claude. It may not help me get a job, but it does take the tedium out of applying online.",
  thevirusofdoom: "oof. I redid my résumé earlier today from scratch and asked my dad for some feedback on it, but it felt like he asked an LLM about it and sent the output to me. I appreciate that he looked over it and I did get some valuable feedback, but I guess it doesn't feel genuine with all the LLM-isms :/",
  jdiggs67: "Yep. Similarly, they think my advice of walking into the business with your resume and delivering it in person is a bad idea. And I've been told they might be right in most situations nowadays."
};

// ── Gate 1: 'resume' the verb is not 'resume' the document ──────────────────
test('a sabbatical joke is not a sales prospect', () => {
  // "I should get to resume my job in exactly one year" — the old qualifier matched the
  // word 'resume' and the word 'job' four tokens later and called it buying intent.
  assert.equal(P._hasResumeIntent(POSTS.derekvandyke), false);
});

test('verb usages do not qualify, whatever job vocabulary surrounds them', () => {
  ['regular service will now resume tomorrow, sorry for the interruption',
   'we can resume the interview process next week',
   'let us resume normal operations after the hiring freeze',
   'they will resume their job search in the spring'
  ].forEach(s => assert.equal(P._hasResumeIntent(s), false, 'should not qualify: ' + s));
});

test('the noun still qualifies, including when a verb appears too', () => {
  ['can we resume the call after I fix my resume for this job',
   'my resume keeps getting rejected by ATS'
  ].forEach(s => assert.equal(P._hasResumeIntent(s), true, 'should qualify: ' + s));
});

// ── Gate 2: trailing thread markers ─────────────────────────────────────────
test('a thread marked (1/6) at the END is broadcast', () => {
  assert.equal(REL.isBroadcastThread(POSTS.hirerevolutionai), true);
  assert.equal(P._isUnsuitableTopic(POSTS.hirerevolutionai), 'broadcast');
});

test('leading markers still caught', () => {
  assert.equal(REL.isBroadcastThread('1/2 SEO sur votre profil LinkedIn'), true);
  assert.equal(REL.isBroadcastThread('3/7 and another thing'), true);
});

test('trailing markers in both bracketed and bare form', () => {
  assert.equal(REL.isBroadcastThread('some long take about hiring [2/5]'), true);
  assert.equal(REL.isBroadcastThread('some long take about hiring 2/5'), true);
});

test('a trailing ratio that is not a thread index is left alone', () => {
  // index > total cannot be a thread marker. Guards ratings and scores.
  assert.equal(REL.isBroadcastThread('I would rate that resume advice 7/5'), false);
  assert.equal(REL.isBroadcastThread('got through 9/1 of the applications'), false);
});

// ── Gate 3: the need is already met ─────────────────────────────────────────
test('people who already got the job are not prospects', () => {
  assert.equal(P.needAlreadyMet(POSTS.tonyringtail), true);
  assert.equal(P.needAlreadyMet(POSTS.nerdyqueer), true);
  assert.equal(P.needAlreadyMet(POSTS.skeetlet), true);
});

test('completion verbs are required — wanting a job is not having one', () => {
  // These are the phrasings that must NOT trip the gate, or the lane goes silent.
  ['It may not help me get a job, but it takes the tedium out of applying',
   'looking for work while employed full time',
   'trying to get an interview anywhere at this point',
   'I need to land a job soon'
  ].forEach(s => assert.equal(P.needAlreadyMet(s), false, 'should NOT read as resolved: ' + s));
});

test('a resolved prospect gets a congratulations task with no link', () => {
  const task = P.buildRoastReplyTask(
    { author: 'tonyringtail.bsky.social', postText: POSTS.tonyringtail, tone: 'none', resolved: true },
    { destinationUrl: 'https://ambientpixels.ai/resume-roast/' }, Date.now());
  assert.match(task.title, /congratulations/i);
  assert.equal(task.destinationUrl, null, 'destinationUrl MUST be null — link repair keys off it');
  assert.match(task.description, /NO PITCH, NO LINK, NO PRODUCT/);
  assert.doesNotMatch(task.description, /ambientpixels\.ai/, 'the URL must not appear anywhere in the prompt');
});

test('resolution is re-derived when the flag is absent, not assumed false', () => {
  // Prospects queued before this gate existed carry no `resolved` field. Defaulting to
  // false would pitch at every one of them exactly once on the way through.
  const task = P.buildRoastReplyTask(
    { author: 'nerdyqueer.bsky.social', postText: POSTS.nerdyqueer, tone: 'none' },
    { destinationUrl: 'https://ambientpixels.ai/resume-roast/' }, Date.now());
  assert.equal(task.destinationUrl, null);
  assert.match(task.title, /congratulations/i);
});

// ── The good targets must still get through ─────────────────────────────────
test('THE LOAD-BEARING TEST: real prospects survive all three gates', () => {
  ['knotmagick', 'neonsparrows', 'tdesseyn'].forEach(k => {
    assert.equal(P._hasResumeIntent(POSTS[k]), true, k + ' lost resume intent');
    assert.equal(P.needAlreadyMet(POSTS[k]), false, k + ' wrongly read as resolved');
    assert.equal(REL.isBroadcastThread(POSTS[k]), false, k + ' wrongly read as broadcast');
    assert.equal(P._isUnsuitableTopic(POSTS[k]), null, k + ' wrongly read as unsuitable');
  });
});

test('a good target still gets the pitching task shape, with the link', () => {
  const dest = 'https://ambientpixels.ai/resume-roast/';
  const task = P.buildRoastReplyTask(
    { author: 'knotmagick.bsky.social', postText: POSTS.knotmagick, tone: 'none', resolved: false },
    { destinationUrl: dest }, Date.now());
  assert.equal(task.destinationUrl, dest);
  assert.match(task.description, /EMPATHY FIRST/);
});

// ── Honest scoreboard ───────────────────────────────────────────────────────
test('KNOWN GAP: three of the nine bad targets are still ungated', () => {
  // Recorded rather than hidden. These three drew bad replies on 2026-09-03 and would
  // draw them again; they need judgement the deterministic gates do not have yet:
  //   @bartdorsey     — showing off HIS OWN open-source resume tool; we pitched ours
  //   @thevirusofdoom — complaining that feedback felt LLM-generated; we offered LLM feedback
  //   @jdiggs67       — idle commentary with no ask; we replied with a bare link
  // All three still pass every gate. If a later change makes one of them fail, that is
  // progress — update this test rather than deleting it.
  assert.equal(P._hasResumeIntent(POSTS.bartdorsey), true);
  assert.equal(P._hasResumeIntent(POSTS.thevirusofdoom), true);
  assert.equal(P._hasResumeIntent(POSTS.jdiggs67), true);
  assert.equal(P.needAlreadyMet(POSTS.bartdorsey), false);
});
