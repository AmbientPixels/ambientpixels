#!/usr/bin/env node
// seedOutcomeSnapshots.js — ONE-TIME migration (Phase 1 deploy)
//
// Scans existing `actions` state for past social publishes and synthesizes
// outcomeSnapshots entries so the system has data to work with immediately
// after Phase 1 deploy (otherwise we'd wait 7 days for the first complete
// snapshot to appear).
//
// For each action with execution.status==='success' and a receipt.post_id,
// we create an outcomeSnapshots entry and — if receipt.metrics exist (X posts
// have them from actionsMetricsPull) — synthesize a t1 OR t7 sample using
// the metrics snapshot time.
//
// USAGE:
//   MSYS_NO_PATHCONV=1 node scripts/seedOutcomeSnapshots.js --dry-run
//   MSYS_NO_PATHCONV=1 node scripts/seedOutcomeSnapshots.js --commit
//
// The script hits the live company-state API; requires x-company-secret env.

const https = require('https');

const API_BASE = process.env.AP_API_BASE || 'https://ambientpixels-nova-api.azurewebsites.net';
const SECRET = process.env.AP_SECRET || 'pixelpusher';
const DRY_RUN = process.argv.indexOf('--commit') === -1;

const PLATFORMS_SUPPORTED = ['x', 'twitter', 'bluesky', 'linkedin', 'reddit', 'facebook'];

function apiGet(key) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + '/api/company-state?key=' + encodeURIComponent(key));
    const opts = { hostname: url.hostname, path: url.pathname + url.search, method: 'GET', headers: { 'x-company-secret': SECRET } };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (_e) { reject(new Error('parse error')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function apiPost(key, value) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + '/api/company-state');
    const body = JSON.stringify({ key: key, value: value });
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-company-secret': SECRET
      }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { resolve({ status: res.statusCode, body: d }); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function classifyHookLocal(text) {
  if (!text || typeof text !== 'string') return 'general';
  if (/\?/.test(text)) return 'question';
  if (/\d+%|\d+x/.test(text)) return 'statistic';
  if (/\b(story|journey|when I)\b/i.test(text)) return 'storytelling';
  if (/\b(launching|announcing|introducing|now available)\b/i.test(text)) return 'announcement';
  if (/\b(check out|try|sign up|join)\b/i.test(text)) return 'cta';
  return 'general';
}

(async () => {
  console.log('[seed] dry-run:', DRY_RUN, 'API:', API_BASE);

  const actionsWrap = await apiGet('actions');
  const actions = actionsWrap.value || actionsWrap || [];
  console.log('[seed] loaded', actions.length, 'actions');

  const existingWrap = await apiGet('outcomeSnapshots');
  // Defensive unwrap: company-state GET returns {key, value} envelope.
  // Never fall back to `existingWrap` directly (would merge the envelope
  // into snapshots as polluting top-level keys).
  let existing = (existingWrap && existingWrap.value) || {};
  if (typeof existing !== 'object' || Array.isArray(existing)) existing = {};
  // Scrub any polluted envelope keys that might already be in state from a
  // prior bad seed run. Only keep entries shaped like real snapshots.
  Object.keys(existing).forEach(k => {
    const v = existing[k];
    if (!v || typeof v !== 'object' || (!v.platform && !v.actionId)) delete existing[k];
  });
  console.log('[seed] existing outcomeSnapshots:', Object.keys(existing).length);

  const snapshots = Object.assign({}, existing);
  let seeded = 0;

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (!a || !a.id || !a.execution) continue;
    if (a.execution.status !== 'success') continue;
    const r = a.execution.receipt;
    if (!r || !r.platform || !r.post_id) continue;
    if (PLATFORMS_SUPPORTED.indexOf((r.platform || '').toLowerCase()) === -1) continue;
    if (snapshots[a.id]) continue; // idempotent

    const publishedAt = a.execution.finished_at || r.timestamp || new Date().toISOString();
    const hook = classifyHookLocal((a.payload && a.payload.text) || '');

    const samples = [
      { lag: 't0', capturedAt: publishedAt, likes: 0, comments: 0, reposts: 0, views: 0, clicks: 0 }
    ];

    // If metrics were pulled by actionsMetricsPull (X only), synthesize a sample at that time.
    if (r.metrics && r.metrics.pulled_at) {
      const pulledMs = Date.parse(r.metrics.pulled_at);
      const pubMs = Date.parse(publishedAt);
      const daysElapsed = Number.isFinite(pulledMs) && Number.isFinite(pubMs) ? (pulledMs - pubMs) / (24 * 60 * 60 * 1000) : 0;
      let lag = 't1';
      if (daysElapsed >= 7) lag = 't7';
      else if (daysElapsed >= 1) lag = 't1';
      else lag = 't1';
      samples.push({
        lag: lag,
        capturedAt: r.metrics.pulled_at,
        likes: r.metrics.likes || 0,
        comments: r.metrics.replies || r.metrics.comments || 0,
        reposts: (r.metrics.retweets || 0) + (r.metrics.quotes || 0),
        views: r.metrics.views || 0,
        clicks: 0
      });
    }

    const hasT7 = samples.some(s => s.lag === 't7');
    snapshots[a.id] = {
      actionId: a.id,
      platform: r.platform,
      postId: r.post_id,
      postUrl: r.post_url || '',
      atUri: r.at_uri || null,
      createdBy: a.created_by || null,
      experimentTag: a.experiment_tag || null,
      campaignId: a.campaign_id || null,
      parentTaskId: a._parentTaskId || null,
      hookType: hook,
      publishedAt: publishedAt,
      samples: samples,
      engagementRate: null,
      complete: hasT7,
      downstream: { blogViews: 0, formSubmits: 0, submissionTypes: {} }
    };
    seeded++;
  }

  console.log('[seed] new snapshots to write:', seeded);
  console.log('[seed] total after merge:', Object.keys(snapshots).length);

  if (DRY_RUN) {
    console.log('[seed] DRY RUN — no writes. Pass --commit to write.');
    return;
  }

  const res = await apiPost('outcomeSnapshots', snapshots);
  console.log('[seed] POST status:', res.status);
  console.log('[seed] body:', res.body.substring(0, 300));
})().catch(err => {
  console.error('[seed] fatal:', err);
  process.exit(1);
});
