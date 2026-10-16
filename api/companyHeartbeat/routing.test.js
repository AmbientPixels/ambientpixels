// Run: node companyHeartbeat/routing.test.js   (from api/)
// Work routed by role to agents that actually run — the fix for the 2026-10-16 blog jam (dormant Pixel).
'use strict';
const assert = require('assert');
const C = require('./constants');
const R = require('./routing');

let passed = 0;
function t(name, fn) { try { fn(); passed++; } catch (err) { console.error('FAIL', name, '\n ', err.message); process.exitCode = 1; } }
const NOW = Date.parse('2026-10-16T12:00:00Z');
const day = (n) => new Date(NOW + n * 864e5).toISOString();

// The live fleet on 2026-10-16: Pixel and Cipher dormant.
const LIVE = ['nova', 'forge', 'scribe', 'quill', 'echo', 'scout', 'vale'];
const ALL = LIVE.concat(['pixel', 'cipher']);

t('design falls through Pixel → Echo → Scribe → nobody', () => {
  assert.strictEqual(R.resolveRole('design', ALL), 'pixel');
  assert.strictEqual(R.resolveRole('design', LIVE), 'echo');
  assert.strictEqual(R.resolveRole('design', ['nova', 'scribe']), 'scribe');
  assert.strictEqual(R.resolveRole('design', ['nova']), null);
  assert.strictEqual(R.resolveRole('finance', LIVE), 'nova');
  assert.strictEqual(R.resolveRole('video', LIVE), 'studio'); // department inbox, never runs, takes tasks
});
t('routeTask keeps a running assignee, reroutes a dormant one by the task role', () => {
  assert.strictEqual(R.routeTask({ assignee: 'scribe', taskType: 'blog_post' }, LIVE), 'scribe');
  assert.strictEqual(R.routeTask({ assignee: 'pixel', taskType: 'design_asset' }, LIVE), 'echo');
  assert.strictEqual(R.routeTask({ assignee: 'pixel', taskType: 'general' }, LIVE), 'nova');
  assert.strictEqual(R.routeTask({ assignee: 'cipher' }, LIVE), 'nova'); // no type: the agent's own role (finance)
  assert.strictEqual(R.routeTask({ assignee: 'pixel' }, LIVE), 'echo');   // no type: design
});
t('humans are never routed; studio counts as runnable', () => {
  assert.ok(R.isHuman('ceo') && R.isHuman('Pixelpusher'));
  assert.ok(!R.isHuman('pixel'));
  assert.ok(R.isRunnable('studio', LIVE));
  assert.ok(!R.isRunnable('pixel', LIVE));
});
t('whoDoesWhat names the stand-in and flags a gap', () => {
  const w = R.whoDoesWhat(LIVE);
  assert.match(w, /Design & images → echo \(pixel is not running\)/);
  assert.match(w, /Budget\/cost → nova \(cipher is not running\)/);
  assert.match(w, /Video → studio/);
  assert.match(R.whoDoesWhat(['nova']), /Design & images → NOBODY/);
});
t('capacity due dates: queue ÷ real throughput, never earlier than asked', () => {
  const tasks = [];
  for (let i = 0; i < 9; i++) tasks.push({ assignee: 'scribe', status: 'todo' });
  for (let i = 0; i < 7; i++) tasks.push({ assignee: 'scribe', status: 'done', completedAt: day(-1) }); // 1 a day
  const due = Date.parse(R.capacityDueDate(tasks, 'scribe', null, NOW));
  assert.strictEqual(Math.round((due - NOW) / 864e5), 10); // 9 queued + this one, at 1/day
  assert.strictEqual(R.capacityDueDate(tasks, 'scribe', day(20), NOW), day(20)); // later ask wins
  // nobody finished anything: floor of 0.5/day, capped at 30 days
  const idle = Array.from({ length: 40 }, () => ({ assignee: 'echo', status: 'todo' }));
  assert.strictEqual(Math.round((Date.parse(R.capacityDueDate(idle, 'echo', null, NOW)) - NOW) / 864e5), 30);
  assert.strictEqual(Math.round((Date.parse(R.capacityDueDate([], 'echo', null, NOW)) - NOW) / 864e5), 2);
});

// task-mutations: creation routes a non-running assignee and keeps the directive category.
t('task creation routes a dormant assignee by role and keeps category', () => {
  const saved = C.AGENT_IDS.slice();
  C.AGENT_IDS.length = 0; LIVE.forEach((a) => C.AGENT_IDS.push(a));
  try {
    const { applyTaskUpdate } = require('./task-mutations');
    const tasks = [];
    applyTaskUpdate(tasks, { action: 'create', task: { title: 'Hero', taskType: 'design_asset', assignee: 'pixel' } }, [], 'nova');
    applyTaskUpdate(tasks, { action: 'create', task: { title: 'DIRECTIVE: x', taskType: 'ops', assignee: 'scribe', category: 'system_directive' } }, [], 'forge');
    applyTaskUpdate(tasks, { action: 'create', task: { title: 'Typo', assignee: 'nobody' } }, [], 'nova');
    assert.strictEqual(tasks[0].assignee, 'echo');
    assert.strictEqual(tasks[1].category, 'system_directive');
    assert.strictEqual(tasks[2].assignee, 'nova');
    assert.ok(Date.parse(tasks[0].dueDate) > Date.now()); // a capacity date, not undefined
  } finally { C.AGENT_IDS.length = 0; saved.forEach((a) => C.AGENT_IDS.push(a)); }
});

// prompt text: the Pixel-only rules name whoever holds the design role now; Nova gets the live roster.
t('prompt rewrite follows the roster', () => {
  const saved = C.AGENT_IDS.slice();
  const { _routeRoleText } = require('./prompt-builders');
  const text = 'use generate-image (Pixel only — Pixel is Head of Design and owns all hero image generation). NEVER create hero image tasks for Pixel — the system';
  try {
    C.AGENT_IDS.length = 0; ALL.forEach((a) => C.AGENT_IDS.push(a));
    assert.strictEqual(_routeRoleText(text, { id: 'echo' }), text); // Pixel runs: unchanged
    C.AGENT_IDS.length = 0; LIVE.forEach((a) => C.AGENT_IDS.push(a));
    const out = _routeRoleText(text, { id: 'echo' });
    assert.match(out, /held now by echo, because Pixel is not running/);
    assert.match(out, /NEVER create hero image tasks yourself/);
    assert.match(_routeRoleText('x', { id: 'nova' }), /WHO DOES WHAT NOW .*Design & images → echo/);
  } finally { C.AGENT_IDS.length = 0; saved.forEach((a) => C.AGENT_IDS.push(a)); }
});

// Forge's stall protocol: only agents with open work are stalled; never Nova.
t('stall protocol ignores idle agents and Nova', () => {
  const { _buildForgeOpsPromptBlock } = require('./ops-intel');
  const digest = { heartbeatHealth: { stalledAgents: [{ agent: 'nova', runs: 20, zeroRuns: 20 }, { agent: 'scout', runs: 6, zeroRuns: 6 }, { agent: 'scribe', runs: 6, zeroRuns: 6 }] } };
  const out = _buildForgeOpsPromptBlock({ id: 'forge' }, digest, [{ assignee: 'scribe', status: 'todo' }]);
  assert.match(out, /scribe: 0 actions/);
  assert.doesNotMatch(out, /nova: 0 actions|scout: 0 actions/);
  const none = _buildForgeOpsPromptBlock({ id: 'forge' }, digest, []);
  assert.doesNotMatch(none, /STALLED AGENT PROTOCOL/);
});

console.log(`routing: ${passed} passed${process.exitCode ? ', FAILURES above' : ''}`);
