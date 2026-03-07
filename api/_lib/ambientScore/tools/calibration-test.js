#!/usr/bin/env node
// calibration-test.js — Batch test score calibration across site types
// Usage: node calibration-test.js [--url https://example.com]
// Or run all built-in test URLs: node calibration-test.js --all
//
// Requires: GEMINI_API_KEY in environment or ../.env / ../../../local.settings.json
// Run from repo root: node ambientpixels/api/_lib/ambientScore/tools/calibration-test.js --all

const path = require('path');

// Try loading env vars from local.settings.json
try {
  const settings = require(path.resolve(__dirname, '../../../local.settings.json'));
  if (settings.Values) {
    for (const [k, v] of Object.entries(settings.Values)) {
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch { /* no local.settings.json */ }

const { analyze } = require('../analyzer');

// ── Test URLs by expected site type ──────────────────────────────

const TEST_URLS = [
  // Enterprise platforms — expect high scores (75+)
  { url: 'https://stripe.com', expectedType: 'enterprise_platform', expectedRange: [70, 95] },
  { url: 'https://www.cloudflare.com', expectedType: 'enterprise_platform', expectedRange: [70, 95] },

  // Direct-response SaaS — expect mid-high scores (65+)
  { url: 'https://basecamp.com', expectedType: 'direct_response_saas', expectedRange: [60, 90] },
  { url: 'https://calendly.com', expectedType: 'direct_response_saas', expectedRange: [65, 90] },

  // E-commerce — expect varied
  { url: 'https://www.allbirds.com', expectedType: 'ecommerce', expectedRange: [60, 90] },

  // Agency — expect mid range
  { url: 'https://www.hugeinc.com', expectedType: 'agency_consulting', expectedRange: [55, 85] },

  // Local service — expect wide range
  { url: 'https://www.example.com', expectedType: 'unknown', expectedRange: [20, 50] },
];

// ── CLI Parsing ──────────────────────────────────────────────────

const args = process.argv.slice(2);
let urls = [];

if (args.includes('--all')) {
  urls = TEST_URLS;
} else if (args.includes('--url')) {
  const idx = args.indexOf('--url');
  const url = args[idx + 1];
  if (!url) { console.error('Missing URL after --url'); process.exit(1); }
  urls = [{ url, expectedType: 'unknown', expectedRange: [0, 100] }];
} else {
  console.log('AmbientScore Calibration Test');
  console.log('===============================');
  console.log('Usage:');
  console.log('  node calibration-test.js --all            Run all test URLs');
  console.log('  node calibration-test.js --url <URL>      Test a single URL');
  console.log('');
  console.log('Test URLs:');
  TEST_URLS.forEach(t => console.log('  ' + t.url + ' (' + t.expectedType + ', expect ' + t.expectedRange[0] + '-' + t.expectedRange[1] + ')'));
  process.exit(0);
}

// ── Run Tests ────────────────────────────────────────────────────

async function runTests() {
  console.log('\nAmbientScore Calibration Test');
  console.log('==============================\n');

  const results = [];

  for (const test of urls) {
    console.log('Testing: ' + test.url);
    console.log('  Expected type: ' + test.expectedType);
    console.log('  Expected range: ' + test.expectedRange[0] + '-' + test.expectedRange[1]);

    try {
      const start = Date.now();
      const result = await analyze(test.url);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      const report = result.fullReport;
      const inRange = result.score >= test.expectedRange[0] && result.score <= test.expectedRange[1];
      const typeMatch = test.expectedType === 'unknown' || report.siteType === test.expectedType;

      console.log('  Score: ' + result.score + '/100 (Grade: ' + result.grade + ') ' + (inRange ? 'OK' : 'OUT OF RANGE'));
      console.log('  Site type: ' + report.siteType + ' (' + report.siteTypeLabel + ') ' + (typeMatch ? 'OK' : 'MISMATCH'));
      console.log('  Time: ' + elapsed + 's');

      // Dimension breakdown
      console.log('  Dimensions:');
      for (const [id, d] of Object.entries(report.dimensions)) {
        console.log('    ' + d.label.padEnd(22) + d.score + '/100 (' + d.grade + ') [weight: ' + d.weight.toFixed(2) + ']');
      }

      results.push({
        url: test.url,
        score: result.score,
        grade: result.grade,
        siteType: report.siteType,
        expectedType: test.expectedType,
        typeMatch,
        inRange,
        elapsed,
        dimensions: Object.fromEntries(Object.entries(report.dimensions).map(([id, d]) => [id, { score: d.score, grade: d.grade }]))
      });

    } catch (err) {
      console.log('  ERROR: ' + err.message);
      results.push({ url: test.url, error: err.message });
    }

    console.log('');
  }

  // Summary
  console.log('=== SUMMARY ===');
  console.log('');
  const scores = results.filter(r => !r.error).map(r => r.score);
  if (scores.length > 0) {
    const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const spread = max - min;
    console.log('Score range: ' + min + ' - ' + max + ' (spread: ' + spread + ')');
    console.log('Average: ' + avg);
    console.log('');

    // Compression check
    if (spread < 20) {
      console.log('WARNING: Score spread < 20. Scores may still be compressed.');
    } else if (spread < 30) {
      console.log('NOTE: Score spread is moderate (' + spread + '). Acceptable but could be wider.');
    } else {
      console.log('OK: Good score spread (' + spread + ').');
    }
  }

  const inRange = results.filter(r => r.inRange).length;
  const typeMatch = results.filter(r => r.typeMatch).length;
  const total = results.filter(r => !r.error).length;
  console.log('In expected range: ' + inRange + '/' + total);
  console.log('Type classification match: ' + typeMatch + '/' + total);

  const failed = results.filter(r => r.error);
  if (failed.length > 0) {
    console.log('Failures: ' + failed.length);
    failed.forEach(f => console.log('  ' + f.url + ': ' + f.error));
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
