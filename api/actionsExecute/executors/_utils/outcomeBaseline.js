// outcomeBaseline.js — Outcome Attribution Phase 1
//
// Writes a t0 baseline snapshot to `outcomeSnapshots` immediately after a
// social action executes successfully. The t0 sample is EXISTENCE PROOF only
// — it confirms the post was published, who authored it, which experiment it
// belongs to, and what hook type it uses. Engagement numbers at t0 are
// effectively zero (no one has seen the post yet) and MUST NOT be treated as
// a signal. engagementRate is computed only at t7+ by the outcomeRefresh
// cron. Any consumer reading t0 metrics for engagement math is reading noise.
//
// Downstream fields (blogViews, formSubmits) are populated by outcomeRefresh
// by scanning blogPostViews + formIntake for events carrying matching
// utm_content.
//
// Retention: the writer trims entries older than 60 days on every call.

const storage = require('../../../_utils/companyStorage');

// Lazy-load classifyHook from the heartbeat module so we get parity with the
// digest. This helper is called from an HTTP trigger path; the heartbeat
// module is loaded only on first use.
let _classifyHook = null;
function getClassifyHook() {
  if (_classifyHook) return _classifyHook;
  try {
    _classifyHook = require('../../../companyHeartbeat/performance-intel').classifyHook;
  } catch (_e) {
    _classifyHook = function (t) { return t ? 'general' : 'general'; };
  }
  return _classifyHook;
}

const RETENTION_DAYS = 60;

async function writeBaseline(action, context) {
  if (!action || !action.id) return;
  if (!action.execution || !action.execution.receipt) return;
  const r = action.execution.receipt;
  if (!r.platform || !r.post_id) return;

  try {
    const store = (await storage.getState('outcomeSnapshots')) || {};

    // Don't overwrite existing t0 (idempotency: if executor re-runs, preserve original)
    if (store[action.id] && Array.isArray(store[action.id].samples) &&
        store[action.id].samples.some(function (s) { return s.lag === 't0'; })) {
      return;
    }

    const hook = getClassifyHook()((action.payload && action.payload.text) || '');
    const now = new Date().toISOString();

    store[action.id] = {
      actionId: action.id,
      platform: r.platform,
      postId: r.post_id,
      postUrl: r.post_url || '',
      createdBy: action.created_by || null,
      experimentTag: action.experiment_tag || null,
      campaignId: action.campaign_id || (action._parentCampaignId || null),
      parentTaskId: action._parentTaskId || null,
      hookType: hook,
      publishedAt: action.execution.finished_at || now,
      samples: [
        { lag: 't0', capturedAt: now, likes: 0, comments: 0, reposts: 0, views: 0, clicks: 0 }
      ],
      engagementRate: null,
      complete: false,
      downstream: { blogViews: 0, formSubmits: 0, submissionTypes: {} }
    };

    // Retention: drop entries with publishedAt older than RETENTION_DAYS.
    const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const keys = Object.keys(store);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const pubMs = Date.parse(store[k] && store[k].publishedAt || 0);
      if (!Number.isFinite(pubMs) || pubMs < cutoff) delete store[k];
    }

    await storage.setState('outcomeSnapshots', store);
    if (context && context.log) {
      context.log('[outcomeBaseline] t0 written for', action.id, 'platform:', r.platform, 'hook:', hook, 'experiment:', action.experiment_tag || '(none)');
    }
  } catch (err) {
    // Non-fatal: baseline write failure must not break the execution path.
    if (context && context.log && context.log.warn) {
      context.log.warn('[outcomeBaseline] write failed (non-fatal):', (err && err.message) || String(err).substring(0, 200));
    }
  }
}

module.exports = { writeBaseline };
