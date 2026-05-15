#!/usr/bin/env node
// Self-test for build-agent-profiles.js — no test framework, pure Node assert.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const OUTPUT_BASE = path.join(REPO, 'ambientos', 'agents');
const EXPECTED_AGENTS = ['nova', 'cipher', 'pixel', 'forge', 'scribe', 'quill', 'echo', 'scout'];

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

console.log('Running build script tests...');

// Run the build once.
execSync(`node "${path.join(__dirname, 'build-agent-profiles.js')}"`, { cwd: REPO, stdio: 'pipe' });

test('hub page exists', () => {
  assert(fs.existsSync(path.join(OUTPUT_BASE, 'index.html')), 'agents/index.html missing');
});

test('all 8 profile pages exist', () => {
  for (const id of EXPECTED_AGENTS) {
    const p = path.join(OUTPUT_BASE, id, 'index.html');
    assert(fs.existsSync(p), `${id}/index.html missing`);
  }
});

test('no unresolved placeholders in any output', () => {
  const allFiles = [path.join(OUTPUT_BASE, 'index.html'), ...EXPECTED_AGENTS.map(id => path.join(OUTPUT_BASE, id, 'index.html'))];
  for (const f of allFiles) {
    const html = fs.readFileSync(f, 'utf8');
    const stray = html.match(/\{\{[^}]+\}\}/g);
    assert(!stray, `${path.relative(REPO, f)} has unresolved placeholders: ${stray}`);
  }
});

test('each profile contains its own agent name', () => {
  for (const id of EXPECTED_AGENTS) {
    const html = fs.readFileSync(path.join(OUTPUT_BASE, id, 'index.html'), 'utf8');
    const expectedName = id[0].toUpperCase() + id.slice(1);
    assert(html.includes(expectedName), `${id}/index.html does not contain "${expectedName}"`);
  }
});

test('each profile excludes itself from crew chips', () => {
  for (const id of EXPECTED_AGENTS) {
    const html = fs.readFileSync(path.join(OUTPUT_BASE, id, 'index.html'), 'utf8');
    const crewSection = html.split('Meet the rest of the crew')[1] || '';
    assert(!crewSection.includes(`href="/ambientos/agents/${id}"`), `${id}/index.html links to itself in crew chips`);
  }
});

test('hub page contains all 8 agent cards', () => {
  const html = fs.readFileSync(path.join(OUTPUT_BASE, 'index.html'), 'utf8');
  for (const id of EXPECTED_AGENTS) {
    assert(html.includes(`/ambientos/agents/${id}`), `hub does not link to ${id}`);
  }
});

test('build is idempotent (second run produces no changes)', () => {
  const before = {};
  for (const id of [...EXPECTED_AGENTS, '']) {
    const p = id ? path.join(OUTPUT_BASE, id, 'index.html') : path.join(OUTPUT_BASE, 'index.html');
    before[p] = fs.readFileSync(p, 'utf8');
  }
  execSync(`node "${path.join(__dirname, 'build-agent-profiles.js')}"`, { cwd: REPO, stdio: 'pipe' });
  for (const [p, content] of Object.entries(before)) {
    assert.strictEqual(fs.readFileSync(p, 'utf8'), content, `${p} changed on second run`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
