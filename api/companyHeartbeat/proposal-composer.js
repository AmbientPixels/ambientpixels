'use strict';

// proposal-composer.js — the LLM side of the proposal generator, fully isolated.
// Given a detected signal + grounding packet + an injected callModel, composes a
// specific, data-grounded campaign/objective proposal and validates it hard against
// hallucination. Pure given inputs (no storage/network of its own); the model call
// is injected so the module is unit-testable with a fake callModel.

const METRIC_ALLOWLIST = new Set([
  'bluesky_followers', 'linkedin_followers', 'x_followers',
  'paying_customers', 'scans_per_week', 'blog_views'
]);
// v1 note: baselines are computed for followers + paying_customers only. Metrics in
// the allowlist without a computed baseline (scans_per_week, blog_views) fail the
// no-baseline check → compose returns skip → deterministic fallback. Wire their
// baseline sources here to enable them.

const LOW_BASELINE_FLOOR = 10;      // below this, use the absolute cap not the multiplier
const GROWTH_MULTIPLIER_CAP = 5;    // target <= 5x baseline for baselines >= floor
const LOW_BASELINE_ABS_CAP = 25;    // target <= 25 for near-zero baselines (e.g. paying_customers 0)
const MIN_DEADLINE_DAYS = 14;
const MAX_DEADLINE_DAYS = 180;
const CAPS = { title: 100, description: 1000, rationale: 500, success: 300 };

// Valid campaign platforms — a SUBSET of materialize.js VALID_TASK_TYPES: growth
// channels only (excludes ops/financial/general), which is what a campaign can task.
const VALID_CAMPAIGN_PLATFORMS = ['blog_post', 'social_linkedin', 'social_bluesky', 'social_x', 'design_asset', 'internal_doc', 'research'];

function _arr(v) { return Array.isArray(v) ? v : null; }
function _normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function _platforms(sas) { return (sas && sas.platforms) || sas || {}; }
function _followers(sas, key) {
  var p = _platforms(sas)[key];
  var n = p && Number(p.followers);
  return Number.isFinite(n) ? n : null;
}

// Count unique customers with a positive charge in the revenue ledger. Default 0.
// Accepts BOTH the real production blob { entries:[...], updatedAt } and a bare array
// (fixtures). Real entries carry customerId (often null) + customerEmail.
function _payingCustomers(state) {
  var raw = state.revenueLedger;
  var ledger = Array.isArray(raw) ? raw : ((raw && _arr(raw.entries)) || []);
  var set = {};
  ledger.forEach(function (e) {
    if (!e) return;
    var amt = Number(e.amountCents != null ? e.amountCents : e.amount);
    if (!(amt > 0)) return;
    var k = e.customerId || e.customerEmail || e.id;
    if (k) set[String(k)] = true;
  });
  return Object.keys(set).length;
}

function _metricBaselines(state) {
  var sas = state.socialAccountStats || {};
  var out = {};
  var bf = _followers(sas, 'bluesky'); if (bf != null) out.bluesky_followers = bf;
  var lf = _followers(sas, 'linkedin'); if (lf != null) out.linkedin_followers = lf;
  var xf = _followers(sas, 'x'); if (xf != null) out.x_followers = xf;
  out.paying_customers = _payingCustomers(state); // always defined
  return out;
}

// A model-named product must resolve to a real product-facts name via exact
// normalized equality (spacing/case-insensitive). Substring matching is unsafe:
// generic "Forge"/"Ambient" would pass as real products.
function _matchesProduct(name, names) {
  var n = _normName(name);
  if (n.length < 3) return false;
  return (names || []).some(function (pn) { return _normName(pn) === n; });
}

function _validPlatforms(arr) {
  var v = (Array.isArray(arr) ? arr : []).filter(function (t) { return VALID_CAMPAIGN_PLATFORMS.indexOf(t) !== -1; });
  return v.length ? v.slice(0, 5) : ['social_bluesky'];
}

// Build the focused grounding packet the model reasons over.
function buildGrounding(signal, state) {
  state = state || {};
  var objectives = _arr(state.objectives) || [];
  var campaigns = _arr(state.campaigns) || [];
  var perProduct = (state.strategicDigest && _arr(state.strategicDigest.perProduct)) || [];
  return {
    signal: signal,
    baselines: _metricBaselines(state),
    productNames: _arr(state.productNames) || [],
    activeObjectives: objectives.filter(function (o) { return o && o.status === 'active'; })
      .map(function (o) { return { title: o.title || '', northStarMetric: o.northStarMetric || null, progress: Number(o.progress) || 0 }; }),
    activeCampaigns: campaigns.filter(function (c) { return c && c.status === 'active'; })
      .map(function (c) { return { name: c.name || c.title || '', product: c.product || null, cadence: c.cadence || null }; }),
    products: perProduct.filter(function (p) { return p; }).map(function (p) { return { product: p.product, verdict: p.verdict, deltaPct: (p.traffic && p.traffic.deltaPct) }; })
  };
}

// Defensively pull a JSON object out of model text (bare, fenced, or amid prose).
function extractJson(text) {
  if (typeof text !== 'string') return null;
  var t = text.trim();
  var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  var s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s === -1 || e === -1 || e < s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch (_) { return null; }
}

module.exports = {
  METRIC_ALLOWLIST: METRIC_ALLOWLIST,
  buildGrounding: buildGrounding,
  extractJson: extractJson,
  // buildPrompt / validate / compose added in Task 4
  _matchesProduct: _matchesProduct,
  _validPlatforms: _validPlatforms,
  _metricBaselines: _metricBaselines,
  LOW_BASELINE_FLOOR: LOW_BASELINE_FLOOR,
  GROWTH_MULTIPLIER_CAP: GROWTH_MULTIPLIER_CAP,
  LOW_BASELINE_ABS_CAP: LOW_BASELINE_ABS_CAP,
  MIN_DEADLINE_DAYS: MIN_DEADLINE_DAYS,
  MAX_DEADLINE_DAYS: MAX_DEADLINE_DAYS,
  CAPS: CAPS
};
