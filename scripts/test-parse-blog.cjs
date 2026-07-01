'use strict';
const assert = require('assert');
const { parseBlogDeliverable } = require('../api/companyHeartbeat/helpers');

// 1) The real memo-wrapped draft → lift headline, strip memo + metadata scaffold
const memo = [
  '**TO:** Pixelpusher (CEO)',
  '**FROM:** Scribe (Content Director)',
  '**DATE:** 2026-07-01',
  '**SUBJECT:** Draft Blog Post for "Build in Public" Campaign',
  '',
  "Here is the draft for this week's \"Build in Public\" blog post. It's based on Scout's work.",
  '',
  'This is a `marketing_post` and is ready for your review in the approval queue.',
  '',
  '---',
  '',
  '**Headline:** we needed a better way to listen',
  '',
  '**Author:** Pixelpusher (Chad)',
  '**Category:** Build in Public',
  '**Tags:** process, startups, feedback',
  '',
  "we're a small team. really small.",
  '',
  'that means we have to be smart about where we spend our time.'
].join('\n');
const r1 = parseBlogDeliverable(memo);
assert.strictEqual(r1.title, 'we needed a better way to listen', 'title from **Headline:** label');
assert.ok(r1.body.startsWith("we're a small team"), 'body starts at real content, got: ' + r1.body.slice(0, 40));
assert.ok(!/\*\*TO:\*\*|\*\*FROM:\*\*|\*\*SUBJECT:\*\*/.test(r1.body), 'memo header stripped');
assert.ok(!/\*\*Headline:\*\*|\*\*Author:\*\*|\*\*Tags:\*\*/.test(r1.body), 'metadata block stripped');
assert.ok(!/ready for your review/i.test(r1.body), 'handoff intro stripped');
console.log('OK: memo-wrapped draft');

// 2) Clean H1 blog → passthrough, title from H1, body intact (H1 kept)
const clean = '# How we shipped the fallback chain\n\nit started with a dead fleet.\n\nmore body here.';
const r2 = parseBlogDeliverable(clean);
assert.strictEqual(r2.title, 'How we shipped the fallback chain');
assert.strictEqual(r2.body, clean.trim(), 'clean draft body untouched');
console.log('OK: clean H1 draft passthrough');

// 3) Plain prose, no scaffold, no H1 → title null, body untouched (must NOT over-strip)
const prose = "Here's what we learned this week.\n\nwe broke something and fixed it.";
const r3 = parseBlogDeliverable(prose);
assert.strictEqual(r3.title, null, 'no title');
assert.strictEqual(r3.body, prose.trim(), 'prose starting with "Here" must not be stripped (no scaffold header)');
console.log('OK: plain prose not over-stripped');

// 4) Memo header but headline as H1 after scaffold → title from H1
const memoH1 = '**TO:** CEO\n**FROM:** Scribe\n\n---\n\n# the real headline\n\nreal body starts here.';
const r4 = parseBlogDeliverable(memoH1);
assert.strictEqual(r4.title, 'the real headline', 'title lifted from H1 after scaffold');
assert.ok(r4.body.startsWith('# the real headline'), 'H1 kept in body when it is the content start');
console.log('OK: memo + H1 headline');

// 5) Empty / falsy input → safe
assert.deepStrictEqual(parseBlogDeliverable(''), { title: null, body: '' });
assert.deepStrictEqual(parseBlogDeliverable(null), { title: null, body: '' });
console.log('OK: empty input safe');

console.log('\nALL PASS');
