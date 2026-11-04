// The once-a-day pipeline (2026-11-04). At one run a day every stage a task misses costs a whole day,
// and each of these regressions is silent: agents look busy, work just arrives days later.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const C = require('./constants.js');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

function execGroups() {
  const m = /const _EXEC_GROUPS = (\[.*\]);/.exec(read('index.js'));
  assert.ok(m, '_EXEC_GROUPS not found in index.js');
  return JSON.parse(m[1].replace(/'/g, '"'));
}

test('content pipeline runs Echo, then Scribe, then Quill', () => {
  const order = execGroups().flat();
  assert.ok(order.indexOf('echo') < order.indexOf('scribe'), 'a brief must reach Scribe in the same run');
  assert.ok(order.indexOf('scribe') < order.indexOf('quill'), 'copy must reach Quill in the same run');
});

test('Scribe and Quill are never in a parallel group', () => {
  // Any group of 2+ is prefetched concurrently, so its agents all decide from the same stale board.
  for (const group of execGroups()) {
    if (group.length < 2) continue;
    for (const agent of ['echo', 'scribe', 'quill']) {
      assert.ok(!group.includes(agent), agent + ' would not see the previous stage output');
    }
  }
});

test('the response schema and the prompt both allow the full action cap', () => {
  const cap = C.GUARDRAILS.maxActionsPerCyclePerAgent;
  assert.strictEqual(C.AGENT_ENVELOPE_SCHEMA.properties.taskUpdates.maxItems, cap,
    'structured output would silently truncate actions below the guardrail');
  assert.match(read('prompt-builders.js'), /_promptSlotCap = require\('\.\/constants'\)\.GUARDRAILS\.maxActionsPerCyclePerAgent/,
    'a hardcoded prompt cap keeps agents emitting the old number');
});

test('a hero-replace task gets past both existing-hero guards', () => {
  const src = read('agent-runner.js');
  assert.match(src, /_earlyDoc\.hero_image_asset_id && !_earlyReplace/);
  assert.match(src, /imgDoc\.hero_image_asset_id && !_heroReplace/);
});

test('generate-image counts as work, so anti-stall leaves Pixel alone', () => {
  assert.match(read('agent-runner.js'), /_hasWorkAction = actions\.some\(a =>[\s\S]{0,260}a\.type === 'generate-image'/);
});
