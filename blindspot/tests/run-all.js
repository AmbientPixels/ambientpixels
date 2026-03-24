/**
 * Blindspot Test Runner — runs all offline test suites
 *
 * Usage: node ambientpixels/blindspot/tests/run-all.js
 */

const { execSync } = require('child_process');
const path = require('path');

const TESTS = [
  { name: 'Smoke Tests', file: 'smoke-test.js' },
  { name: 'Unit Tests',  file: 'unit-tests.js' }
];

let allPassed = true;

for (const test of TESTS) {
  console.log('\n\x1b[36m━━ ' + test.name + ' ━━\x1b[0m');
  try {
    execSync('node "' + path.join(__dirname, test.file) + '"', { stdio: 'inherit' });
  } catch (e) {
    allPassed = false;
  }
}

console.log('\n' + '━'.repeat(50));
if (allPassed) {
  console.log('\x1b[32m  ALL TEST SUITES PASSED\x1b[0m');
} else {
  console.log('\x1b[31m  SOME TEST SUITES FAILED\x1b[0m');
  process.exit(1);
}
