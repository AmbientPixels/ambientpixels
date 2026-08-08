#!/usr/bin/env node
// roast-funnel-reconcile.js — split the Resume Roast start/complete gap into
// the two problems hiding inside it.
//
//   node scripts/roast-funnel-reconcile.js [range] [product]
//   node scripts/roast-funnel-reconcile.js 1d
//   node scripts/roast-funnel-reconcile.js 7d pixelagents
//
// Reads COMPANY_WRITE_SECRET from the environment, or from
// c:/Dev/Ambientpixels/COMPANY_WRITE_SECRET.txt (outside the repo).
//
// WHY: agent_run_started fires in the browser before the request and
// agent_run_completed only if the tab is still open when the answer renders. So
// "25 starts, 5 completions" pooled our failures with their impatience and named
// neither. api/pixel-agent-run now emits run_delivered / run_failed itself, so:
//
//     started -> delivered   is OUR failure rate   (fix the product)
//     delivered -> completed is THEIR abandonment  (fix the wait, or the page)
//
// The one number this script refuses to print is a confident zero. If no server
// events are present it says UNMEASURED, because a metric nobody computes
// reading as 0 is how a working lane gets killed.

const fs = require('fs');

const BASE = process.env.AP_API_BASE || 'https://ambientpixels-nova-api.azurewebsites.net/api';
const RANGE = process.argv[2] || '7d';
const PRODUCT = process.argv[3] || 'resumeroast';
const SECRET_FILE = 'c:/Dev/Ambientpixels/COMPANY_WRITE_SECRET.txt';

function loadSecret() {
  if (process.env.COMPANY_WRITE_SECRET) return process.env.COMPANY_WRITE_SECRET.trim();
  try {
    const raw = fs.readFileSync(SECRET_FILE, 'utf8');
    const m = raw.match(/COMPANY_WRITE_SECRET\s*=\s*(\S+)/);
    if (m) return m[1];
    return raw.trim();
  } catch (e) {
    return '';
  }
}

async function query(metric, secret, includeInternal) {
  const url = BASE + '/productAnalyticsQuery?product=' + PRODUCT + '&range=' + RANGE
    + '&metric=' + metric + (includeInternal ? '&include_internal=1' : '');
  const res = await fetch(url, { headers: { 'x-company-secret': secret } });
  if (!res.ok) throw new Error(metric + ' query failed: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return (await res.json()).data;
}

function pct(part, whole) {
  if (!whole) return '—';
  return Math.round((part / whole) * 100) + '%';
}

function bar(label, n, width) {
  const filled = width ? Math.round((n / width) * 28) : 0;
  return '  ' + label.padEnd(22) + String(n).padStart(5) + '  ' + '█'.repeat(Math.max(0, filled));
}

(async function () {
  const secret = loadSecret();
  if (!secret) {
    console.error('No COMPANY_WRITE_SECRET in env or ' + SECRET_FILE);
    process.exit(1);
  }

  const [events, funnels] = await Promise.all([
    query('events', secret),
    query('funnels', secret)
  ]);

  const byEvent = {};
  (events || []).forEach(function (e) { byEvent[e.event] = e; });
  const count = function (name) { return (byEvent[name] && byEvent[name].count) || 0; };

  const steps = (funnels && funnels[PRODUCT]) || [];
  const users = {};
  steps.forEach(function (s) { users[s.step] = s.users; });

  const started = count('agent_run_started');
  const delivered = count('run_delivered');
  const completed = count('agent_run_completed');
  const failed = count('run_failed');
  const reasons = (byEvent.run_failed && byEvent.run_failed.reasons) || {};

  console.log('');
  console.log('Resume Roast funnel reconciliation — product=' + PRODUCT + ' range=' + RANGE);
  console.log('(internal-flagged devices excluded, as everywhere else)');
  console.log('');

  console.log('RUNS (event volume — retries count separately)');
  const scale = Math.max(started, 1);
  console.log(bar('started (client)', started, scale));
  console.log(bar('delivered (server)', delivered, scale));
  console.log(bar('completed (client)', completed, scale));
  console.log(bar('failed (server)', failed, scale));
  console.log('');

  console.log('PEOPLE (distinct visitors — the honest denominator)');
  ['run_page_view', 'agent_run_started', 'run_delivered', 'agent_run_completed', 'rewrite_upsell_view']
    .forEach(function (s) {
      if (users[s] === undefined) return;
      console.log(bar(s, users[s], Math.max(users.run_page_view || 1, 1)));
    });
  console.log('');

  if (!delivered && !failed) {
    // The whole point of the script, and the one thing it must never fake.
    console.log('SPLIT: UNMEASURED.');
    console.log('  No server-side run events in this window, so the gap between');
    console.log('  started and completed cannot be attributed. That is NOT a 0%');
    console.log('  failure rate — it means api/pixel-agent-run has not emitted');
    console.log('  run_delivered/run_failed for this range yet (deployed');
    console.log('  2026-08-09; browsers on cached JS report identity_source=ip).');
  } else {
    const ourFailures = Math.max(0, started - delivered);
    const theirAbandons = Math.max(0, delivered - completed);
    console.log('SPLIT');
    console.log('  our failure rate     ' + pct(ourFailures, started)
      + '   (' + ourFailures + ' of ' + started + ' starts never reached an answer)');
    console.log('  their abandon rate   ' + pct(theirAbandons, delivered)
      + '   (' + theirAbandons + ' of ' + delivered + ' answers were never seen on screen)');
    console.log('');
    console.log('WHY RUNS FAILED');
    const keys = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; });
    if (!keys.length) console.log('  (no run_failed events — every start that we saw reached the model)');
    keys.forEach(function (k) { console.log('  ' + k.padEnd(20) + String(reasons[k]).padStart(4)); });
    if (reasons.rate_limited) {
      console.log('');
      console.log('  NOTE: the anonymous cap is 5/day per IP HASH, so shared wifi and');
      console.log('  mobile CGNAT spend it on strangers. rate_limited is a demand');
      console.log('  signal as much as a failure — check before raising or lowering it.');
    }
  }

  // A server event only joins to the client's events when the browser forwarded
  // its pa_anon_id. Browsers still on cached JS fall back to an IP hash, which
  // reads as a SEPARATE person in the PEOPLE table — so delivered can exceed
  // started there while the RUNS table stays sane. Derived rather than asserted:
  // if the people columns disagree with the run columns, say so instead of
  // letting someone read a clean funnel that is quietly double-identified.
  if (users.run_delivered > users.agent_run_started) {
    console.log('CAUTION: more distinct people delivered than started.');
    console.log('  Server events are landing under IP hashes because those browsers');
    console.log('  have not picked up the JS that forwards their analytics id.');
    console.log('  Trust the RUNS table until this clears; PEOPLE is double-counting.');
    console.log('');
  }
})().catch(function (err) {
  console.error(err.message);
  process.exit(1);
});
