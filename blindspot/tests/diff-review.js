/**
 * Blindspot Diff Reviewer — Automated code review on staged/recent changes
 *
 * Reads the git diff and checks for common quality issues:
 * - Changes outside blindspot/ scope
 * - CSS specificity bombs (deeply nested selectors)
 * - Hardcoded pixel values that should be responsive
 * - Large diffs (>300 lines added in single file)
 * - Accidental file deletions
 * - Raw hex colors in CSS
 * - console.log left in (should be console.warn/error or removed)
 * - Inline styles in HTML (should be in CSS)
 * - Missing ARIA attributes on new interactive elements
 *
 * Usage: node ambientpixels/blindspot/tests/diff-review.js
 * Reads: git diff HEAD~1 (last commit) or git diff --staged
 */

const { execSync } = require('child_process');

let passed = 0;
let failed = 0;
const warnings = [];

function pass(msg) { console.log('\x1b[32m  PASS\x1b[0m', msg); passed++; }
function fail(msg) { console.log('\x1b[31m  FAIL\x1b[0m', msg); failed++; }
function warn(msg) { console.log('\x1b[33m  WARN\x1b[0m', msg); warnings.push(msg); }

function getDiff() {
  // Try staged first, then last commit
  try {
    const staged = execSync('git diff --staged --stat', { encoding: 'utf8' }).trim();
    if (staged) {
      return {
        stat: staged,
        full: execSync('git diff --staged', { encoding: 'utf8' }),
        source: 'staged'
      };
    }
  } catch (e) { /* no staged changes */ }

  try {
    return {
      stat: execSync('git diff HEAD~1 --stat', { encoding: 'utf8' }),
      full: execSync('git diff HEAD~1', { encoding: 'utf8' }),
      source: 'HEAD~1'
    };
  } catch (e) {
    return null;
  }
}

function run() {
  const diff = getDiff();
  if (!diff) {
    console.log('No diff found (no staged changes and no previous commit).');
    process.exit(0);
  }

  console.log('Reviewing diff from: ' + diff.source);
  console.log(diff.stat);
  console.log('');

  const lines = diff.full.split('\n');
  const addedLines = lines.filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const removedLines = lines.filter(l => l.startsWith('-') && !l.startsWith('---'));
  const changedFiles = [...new Set(lines.filter(l => l.startsWith('diff --git')).map(l => {
    const match = l.match(/b\/(.+)$/);
    return match ? match[1] : null;
  }).filter(Boolean))];

  console.log('── Scope Check ──');
  // Check for changes outside blindspot scope
  const outOfScope = changedFiles.filter(f =>
    !f.startsWith('blindspot/') &&
    !f.startsWith('api/cardforgearenabattle/') &&
    !f.startsWith('api/cardforgearenabosses/') &&
    !f.startsWith('api/_lib/') &&
    f !== 'TASKS.md'
  );
  if (outOfScope.length === 0) pass('All changes within scope');
  else warn('Changes outside scope: ' + outOfScope.join(', '));

  // Check for accidental deletions
  const deletedFiles = lines.filter(l => l.startsWith('deleted file')).length;
  if (deletedFiles === 0) pass('No files deleted');
  else warn(deletedFiles + ' file(s) deleted — verify intentional');

  console.log('\n── Size Check ──');
  // Check diff size per file
  const fileAdditions = {};
  let currentFile = null;
  lines.forEach(l => {
    if (l.startsWith('diff --git')) {
      const match = l.match(/b\/(.+)$/);
      currentFile = match ? match[1] : null;
    }
    if (l.startsWith('+') && !l.startsWith('+++') && currentFile) {
      fileAdditions[currentFile] = (fileAdditions[currentFile] || 0) + 1;
    }
  });

  const largeFiles = Object.entries(fileAdditions).filter(([f, count]) => count > 300);
  if (largeFiles.length === 0) pass('No oversized diffs (all <300 lines added)');
  else largeFiles.forEach(([f, count]) => warn(f + ': ' + count + ' lines added — consider splitting'));

  const totalAdded = addedLines.length;
  const totalRemoved = removedLines.length;
  console.log('  Total: +' + totalAdded + ' / -' + totalRemoved + ' lines');

  console.log('\n── CSS Quality ──');
  const cssAdded = addedLines.filter(l => changedFiles.some(f => f.endsWith('.css')));

  // Check for raw hex colors in added CSS
  const rawHexAdded = cssAdded.filter(l => l.match(/[^-]#[0-9a-fA-F]{3,8}\b/) && !l.includes('var('));
  if (rawHexAdded.length === 0) pass('No raw hex colors in new CSS');
  else warn(rawHexAdded.length + ' raw hex colors — use --bs-* tokens');

  // Check for deeply nested selectors (specificity bombs)
  const deepSelectors = cssAdded.filter(l => {
    const selectorParts = l.replace(/\+/, '').trim().split(/\s+/);
    return selectorParts.length > 4 && l.includes('{');
  });
  if (deepSelectors.length === 0) pass('No deeply nested selectors');
  else warn(deepSelectors.length + ' deeply nested selectors — check specificity');

  // Check for !important (sometimes needed, but flag it)
  const importantCount = cssAdded.filter(l => l.includes('!important')).length;
  if (importantCount <= 2) pass('Minimal !important usage (' + importantCount + ')');
  else warn(importantCount + ' !important declarations — review necessity');

  console.log('\n── JS Quality ──');
  const jsAdded = addedLines.filter(l => changedFiles.some(f => f.endsWith('.js')));

  // Check for console.log (should be warn/error or removed)
  const consoleLogs = jsAdded.filter(l => l.includes('console.log') && !l.includes('//'));
  if (consoleLogs.length === 0) pass('No console.log in new code');
  else warn(consoleLogs.length + ' console.log statements — use console.warn/error or remove');

  // Check for global variable leaks
  const bareAssignments = jsAdded.filter(l => {
    const trimmed = l.replace(/^\+/, '').trim();
    return trimmed.match(/^[a-zA-Z_]\w+\s*=\s*/) &&
      !trimmed.startsWith('var ') && !trimmed.startsWith('let ') &&
      !trimmed.startsWith('const ') && !trimmed.startsWith('this.') &&
      !trimmed.startsWith('//') && !trimmed.includes('.') &&
      !trimmed.startsWith('function') && !trimmed.startsWith('if') &&
      !trimmed.startsWith('for') && !trimmed.startsWith('return');
  });
  if (bareAssignments.length === 0) pass('No apparent global variable leaks');
  else warn(bareAssignments.length + ' possible global leaks — check var/let/const');

  // Check for TODO/FIXME/HACK left in
  const todos = jsAdded.filter(l => l.match(/\b(TODO|FIXME|HACK|XXX)\b/i));
  if (todos.length === 0) pass('No TODO/FIXME/HACK markers');
  else warn(todos.length + ' TODO/FIXME markers left in code');

  console.log('\n── HTML Quality ──');
  const htmlAdded = addedLines.filter(l => changedFiles.some(f => f.endsWith('.html')));

  // Check for inline styles in new HTML
  const inlineStyles = htmlAdded.filter(l => l.includes('style="') && l.includes('<'));
  if (inlineStyles.length <= 3) pass('Minimal inline styles (' + inlineStyles.length + ')');
  else warn(inlineStyles.length + ' inline styles — move to CSS');

  // Check for interactive elements without ARIA
  const interactiveNoAria = htmlAdded.filter(l => {
    return (l.includes('<button') || l.includes('<a ')) &&
      !l.includes('aria-label') && !l.includes('aria-') &&
      !l.includes('role=');
  });
  if (interactiveNoAria.length === 0) pass('New interactive elements have ARIA attributes');
  else warn(interactiveNoAria.length + ' interactive elements missing ARIA — add aria-label');

  // ── Summary ──
  console.log('\n' + '─'.repeat(50));
  if (failed === 0) {
    console.log('\x1b[32m  ALL ' + passed + ' CHECKS PASSED\x1b[0m');
    if (warnings.length > 0) console.log('  (' + warnings.length + ' warnings to review)');
  } else {
    console.log('\x1b[31m  ' + failed + ' FAILED\x1b[0m, ' + passed + ' passed, ' + warnings.length + ' warnings');
  }
  process.exit(failed > 0 ? 1 : 0);
}

run();
