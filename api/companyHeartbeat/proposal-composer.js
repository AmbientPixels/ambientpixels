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

function buildPrompt(signal, grounding) {
  var g = grounding;
  var lines = [];
  lines.push('You are Nova, prime operator of the AmbientPixels autonomous fleet.');
  lines.push('A deterministic scan found a real strategic gap. Propose the single most valuable ' + signal.kind + ' to close it.');
  lines.push('');
  lines.push('DETECTED GAP (' + signal.trigger + '): subject ' + JSON.stringify(signal.subject) + ', evidence ' + JSON.stringify(signal.evidence));
  lines.push('');
  lines.push('CURRENT STATE — ground every claim in this; invent nothing:');
  lines.push('- Active objectives: ' + JSON.stringify(g.activeObjectives));
  lines.push('- Active campaigns: ' + JSON.stringify(g.activeCampaigns));
  lines.push('- Product verdicts: ' + JSON.stringify(g.products));
  lines.push('- Metrics you may anchor on (metric: current baseline): ' + JSON.stringify(g.baselines));
  lines.push('- Real product names (only these may be named): ' + JSON.stringify(g.productNames));
  lines.push('');
  lines.push('The company north star is paying customers. Prefer a move that advances revenue when the data supports it.');
  lines.push('');
  lines.push('Return ONLY minified JSON, no prose. Shape:');
  if (signal.kind === 'objective') {
    lines.push('{"propose":true,"kind":"objective","title":"...","description":"...","rationale":"...","successCriteria":"...","northStarMetric":"<a metric key above>","metricBaseline":<number>,"metricTarget":<number>,"metricDeadline":"YYYY-MM-DD","suggestedCampaigns":["..."]}');
  } else {
    lines.push('{"propose":true,"kind":"campaign","title":"...","description":"...","rationale":"...","successCriteria":"...","product":"<a real product name or empty>","northStarMetric":"<a metric key above>","metricBaseline":<number>,"metricTarget":<number>,"metricDeadline":"YYYY-MM-DD","platforms":["social_bluesky"]}');
  }
  lines.push('Rules: metricTarget beats baseline but stays realistic (<= ~5x; for a 0 baseline propose a small count <= 25). metricDeadline 14-180 days out. If nothing here is genuinely worth proposing, return {"propose":false}.');
  return lines.join('\n');
}

// Deterministic anti-hallucination gauntlet. Returns { ok:true, proposal } or { ok:false, reason }.
function validate(parsed, signal, grounding, nowMs) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'not-object' };
  if (parsed.propose !== true) return { ok: false, reason: 'model-declined' };
  if (parsed.kind !== signal.kind) return { ok: false, reason: 'kind-mismatch' };

  var title = String(parsed.title || '').trim();
  var description = String(parsed.description || '').trim();
  var rationale = String(parsed.rationale || '').trim();
  var successCriteria = String(parsed.successCriteria || '').trim();
  if (!title || !description || !rationale || !successCriteria) return { ok: false, reason: 'missing-fields' };

  var metric = String(parsed.northStarMetric || '').trim();
  var existingMetrics = (grounding.activeObjectives || []).map(function (o) { return o.northStarMetric; }).filter(Boolean);
  if (!METRIC_ALLOWLIST.has(metric) && existingMetrics.indexOf(metric) === -1) return { ok: false, reason: 'metric-not-allowed' };

  var baseline = grounding.baselines[metric];
  if (baseline == null) return { ok: false, reason: 'no-baseline-for-metric' };
  var target = Number(parsed.metricTarget);
  if (!Number.isFinite(target)) return { ok: false, reason: 'target-not-finite' };
  if (!(target > baseline)) return { ok: false, reason: 'target-not-directional' };
  if (baseline >= LOW_BASELINE_FLOOR) {
    if (target > baseline * GROWTH_MULTIPLIER_CAP) return { ok: false, reason: 'target-out-of-band' };
  } else if (target > LOW_BASELINE_ABS_CAP) {
    return { ok: false, reason: 'target-out-of-band' };
  }

  var dl = String(parsed.metricDeadline || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dl)) return { ok: false, reason: 'deadline-format' };
  var dMs = Date.parse(dl + 'T00:00:00Z');
  if (!Number.isFinite(dMs)) return { ok: false, reason: 'deadline-invalid' };
  var days = (dMs - nowMs) / 86400000;
  if (days < MIN_DEADLINE_DAYS || days > MAX_DEADLINE_DAYS) return { ok: false, reason: 'deadline-out-of-window' };

  var product = String(parsed.product || signal.subject.product || '').trim();
  if (product && !_matchesProduct(product, grounding.productNames)) return { ok: false, reason: 'unknown-product' };

  var iso = new Date(nowMs).toISOString();
  if (signal.kind === 'objective') {
    return { ok: true, proposal: {
      id: 'oprop_' + nowMs + '_auto', type: 'objective_proposal', status: 'pending',
      proposedBy: 'nova', source: 'auto:proposal-generator',
      title: title.substring(0, CAPS.title), description: description.substring(0, CAPS.description),
      rationale: rationale.substring(0, CAPS.rationale), successCriteria: successCriteria.substring(0, CAPS.success),
      timeHorizon: Math.round(days) + ' days',
      suggestedCampaigns: Array.isArray(parsed.suggestedCampaigns) ? parsed.suggestedCampaigns.slice(0, 5) : [],
      northStarMetric: metric, metricTarget: target, metricDeadline: dl,
      strategyFlag: null, createdAt: iso
    } };
  }
  return { ok: true, proposal: {
    id: 'cprop_' + nowMs + '_auto', type: 'campaign_proposal', status: 'pending',
    proposedBy: 'nova', source: 'auto:proposal-generator',
    name: title.substring(0, CAPS.title), description: description.substring(0, CAPS.description),
    rationale: rationale.substring(0, CAPS.rationale),
    platforms: _validPlatforms(parsed.platforms), frequency: 3, cadence: 'weekly', duration: '30 days',
    product: product.substring(0, 50), kpiTarget: successCriteria.substring(0, 200),
    northStarMetric: metric, strategyFlag: null, createdAt: iso
  } };
}

// Orchestrate one composition. Returns { proposal } or { skip, reason }. Never throws.
async function compose(signal, grounding, callModel, nowMs) {
  nowMs = nowMs || Date.now();
  var text;
  try { text = await callModel(buildPrompt(signal, grounding)); }
  catch (e) { return { skip: true, reason: 'model-error:' + (e && e.message ? e.message : 'unknown') }; }
  if (!text) return { skip: true, reason: 'empty-response' };
  var parsed = extractJson(text);
  if (!parsed) return { skip: true, reason: 'unparseable' };
  var v = validate(parsed, signal, grounding, nowMs);
  if (!v.ok) return { skip: true, reason: v.reason };
  return { proposal: v.proposal };
}

module.exports = {
  METRIC_ALLOWLIST: METRIC_ALLOWLIST,
  buildGrounding: buildGrounding,
  buildPrompt: buildPrompt,
  extractJson: extractJson,
  validate: validate,
  compose: compose,
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
