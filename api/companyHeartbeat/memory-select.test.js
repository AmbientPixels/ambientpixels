// Run: node companyHeartbeat/memory-select.test.js
'use strict';
const assert = require('assert');
const { selectMemoriesForPrompt, selectCalloutMemories, isPlaceholderText, tierOf, FEEDBACK_CAP } = require('./memory-select');

const NOW = Date.parse('2026-10-06T12:00:00Z');
const day = n => new Date(NOW - n * 86400000).toISOString();
let id = 0;
const mem = (over) => Object.assign({ id: 'm' + (++id), type: 'learning', text: 'a perfectly ordinary memory with enough words in it', timestamp: day(1) }, over);

// 1. Rate-limit notices never reach the prompt, even when they are the newest entries.
{
  const list = [];
  for (let i = 0; i < 9; i++) list.push(mem({ type: 'consolidated_belief', source: 'auto:consolidation', text: 'Consolidated from 5 similar entries. Core belief: I emitted more than 3 actions last cycle; 12 were dropped by the rate limit.', timestamp: day(0) }));
  list.push(mem({ type: 'feedback', source: 'auto:rate-limit', text: 'I emitted more than 3 actions last cycle; 4 were dropped by the rate limit. Prioritize and batch next time.', timestamp: day(0) }));
  list.push(mem({ type: 'constraint', text: 'Milestone Herald posts conflict with the Founder Voice doctrine; do not draft them.', timestamp: day(20) }));
  const out = selectMemoriesForPrompt(list, 10, NOW);
  assert.ok(out.every(m => m.source !== 'auto:rate-limit'), 'rate-limit source dropped');
  assert.ok(out.some(m => m.type === 'constraint'), 'old constraint survives newer noise');
  // consolidated rate-limit beliefs are tier 3 and still eligible by source; they fill AFTER the constraint
  assert.strictEqual(out[0].type, 'constraint', 'chronological: oldest first');
}

// 2. CEO corrections and scored bets are always kept, ahead of everything, regardless of age.
{
  const list = [];
  for (let i = 0; i < 12; i++) list.push(mem({ type: 'decision', timestamp: day(0) }));
  list.push(mem({ type: 'constraint', source: 'auto:ceo-revision', text: 'CEO sent back: strip the pitch, the reply must stand on its own.', timestamp: day(80) }));
  list.push(mem({ type: 'verified_fact', source: 'auto:bet-verdict', text: 'Bet search_page|resumeroast LOST: 0 of 11 pages reached a person in 28d.', timestamp: day(45) }));
  const out = selectMemoriesForPrompt(list, 10, NOW);
  assert.strictEqual(out.length, 10);
  assert.ok(out.some(m => m.source === 'auto:ceo-revision'), 'ceo revision kept');
  assert.ok(out.some(m => m.source === 'auto:bet-verdict'), 'bet verdict kept');
  assert.strictEqual(out.filter(m => m.type === 'decision').length, 8);
}

// 3. Feedback is capped so a run of quality-gate rejections cannot fill the block.
{
  const list = [];
  for (let i = 0; i < 10; i++) list.push(mem({ type: 'feedback', source: 'auto:quality-gate', text: 'Quality gate rejected my last bluesky reply. Issues: TONE VIOLATION number ' + i, timestamp: day(i) }));
  list.push(mem({ type: 'learning', text: 'Posts starting with a question on Bluesky have a median engagement of 0 over 107 samples.', timestamp: day(30) }));
  const out = selectMemoriesForPrompt(list, 10, NOW);
  assert.strictEqual(out.filter(m => m.type === 'feedback').length, FEEDBACK_CAP, 'feedback capped');
  assert.ok(out.some(m => m.type === 'learning'));
  const fb = out.filter(m => m.type === 'feedback');
  assert.ok(fb.every(m => /number [01]$/.test(m.text)), 'the two NEWEST feedback entries are the ones kept');
}

// 4. Placeholder and expired entries are dropped; limit is respected; order is chronological.
{
  const list = [
    mem({ type: 'consolidated_belief', text: 'Consolidated from 5 similar entries. Core belief: string', timestamp: day(2) }),
    mem({ type: 'decision', text: 'string', timestamp: day(2) }),
    mem({ type: 'decision', text: 'An expired decision that should never be shown to anyone now.', timestamp: day(40), expiresAt: day(1) }),
    mem({ type: 'decision', text: 'Second: keep exactly one conversion campaign active at a time.', timestamp: day(3) }),
    mem({ type: 'decision', text: 'First: every outbound link carries utm_content equal to the action id.', timestamp: day(5) })
  ];
  const out = selectMemoriesForPrompt(list, 10, NOW);
  assert.strictEqual(out.length, 2);
  assert.ok(/^First/.test(out[0].text) && /^Second/.test(out[1].text), 'chronological');
  assert.strictEqual(selectMemoriesForPrompt(list, 1, NOW).length, 1);
  assert.strictEqual(isPlaceholderText('string'), true);
  assert.strictEqual(isPlaceholderText('   '), true);
  assert.strictEqual(isPlaceholderText('Consolidated from 5 similar entries. Core belief: string'), true, 'a consolidated placeholder is still a placeholder');
  assert.strictEqual(isPlaceholderText('Consolidated from 5 similar entries. Core belief: posts starting with a question get median 0.'), false);
}

// 5. tierOf and the callout filter.
{
  assert.strictEqual(tierOf({ source: 'auto:ceo-edit', type: 'feedback' }), 1);
  assert.strictEqual(tierOf({ type: 'constraint' }), 2);
  assert.strictEqual(tierOf({ type: 'reflection' }), 3);
  assert.strictEqual(tierOf({ type: 'context' }), 4);
  assert.strictEqual(tierOf({ type: 'mystery' }), 3);
  const list = [
    mem({ type: 'feedback', source: 'auto:rate-limit', text: 'I emitted more than 3 actions last cycle; 2 were dropped by the rate limit.', timestamp: day(0) }),
    mem({ type: 'feedback', source: 'auto:quality-gate', text: 'Quality gate rejected my last social post. Issues: FABRICATED FEATURE: ATS score.', timestamp: day(1) }),
    mem({ type: 'feedback', source: 'auto:ceo-edit', text: 'CEO approved but edited my site post. ORIGINAL: ... EDITED: ...', timestamp: day(9) })
  ];
  const out = selectCalloutMemories(list, 2, NOW);
  assert.strictEqual(out.length, 2);
  assert.ok(out.every(m => m.source !== 'auto:rate-limit'), 'rate-limit never a callout');
  assert.strictEqual(out[0].source, 'auto:ceo-edit', 'chronological inside the callout');
}

// 6. Empty and malformed input.
{
  assert.deepStrictEqual(selectMemoriesForPrompt(null, 10, NOW), []);
  assert.deepStrictEqual(selectMemoriesForPrompt([null, undefined, {}], 10, NOW), []);
}

console.log('memory-select.test.js: all assertions passed');
