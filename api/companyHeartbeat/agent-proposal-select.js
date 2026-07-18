// Pure helpers for agentic proposal selection. No IO — unit-tested in isolation.
'use strict';

const {
  PROPOSAL_TRIGGER_SEVERITY,
  PROPOSAL_UNKNOWN_TRIGGER_SEVERITY
} = require('./constants');

// Map a declared trigger key to a deterministic severity. Unknown/missing → low.
function proposalSeverity(trigger) {
  if (trigger && Object.prototype.hasOwnProperty.call(PROPOSAL_TRIGGER_SEVERITY, trigger)) {
    return PROPOSAL_TRIGGER_SEVERITY[trigger];
  }
  return PROPOSAL_UNKNOWN_TRIGGER_SEVERITY;
}

// Given staged candidates [{type, severity, ...}] and per-type caps {type: n},
// return { selected, deferred }. Within each type, highest severity wins; ties keep
// input order (stable). Types with no cap entry default to 0 (everything deferred).
function selectTopProposals(staged, caps) {
  var list = Array.isArray(staged) ? staged.slice() : [];
  caps = caps || {};
  var byType = {};
  list.forEach(function (p, i) {
    if (!p || !p.type) return;
    (byType[p.type] = byType[p.type] || []).push({ p: p, i: i });
  });
  var selected = [], deferred = [];
  Object.keys(byType).forEach(function (type) {
    var cap = Number.isFinite(caps[type]) ? caps[type] : 0;
    var sorted = byType[type].sort(function (a, b) {
      var d = (b.p.severity || 0) - (a.p.severity || 0);
      return d !== 0 ? d : a.i - b.i; // stable on ties
    });
    sorted.forEach(function (entry, idx) {
      if (idx < cap) selected.push(entry.p);
      else deferred.push(entry.p);
    });
  });
  return { selected: selected, deferred: deferred };
}

// ── Shape-tolerant lift of propose-* intents out of the legacy `proposals` array ──
// The proposals array is a dead display-only path (breadcrumbs, never approvalQueue).
// Models keep putting proposal-shaped output there in several shapes. This lifts
// anything recognizably a campaign/objective proposal into a canonical ACTION object
// the agent-runner handler chain can dispatch: {type:'propose-campaign',campaign:{...}}
// or {type:'propose-objective',objective:{...}}. Unrecognizable items stay behind.

var _CAMPAIGN_KINDS = { 'propose-campaign': 1, 'propose_campaign': 1, 'campaign_proposal': 1, 'campaign-proposal': 1 };
var _OBJECTIVE_KINDS = { 'propose-objective': 1, 'propose_objective': 1, 'objective_proposal': 1, 'objective-proposal': 1 };
var _CAMPAIGN_FIELDS = ['name', 'title', 'description', 'rationale', 'trigger', 'product', 'platforms',
  'frequency', 'cadence', 'duration', 'kpiTarget', 'northStarMetric', 'metricTarget', 'metricDeadline'];
var _OBJECTIVE_FIELDS = ['title', 'name', 'description', 'rationale', 'trigger', 'successCriteria',
  'timeHorizon', 'northStarMetric', 'metricTarget', 'metricDeadline', 'suggestedCampaigns'];

function _isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

function _declaredKind(item) {
  var t = String(item.type || item.proposedAction || '').toLowerCase().trim();
  if (_CAMPAIGN_KINDS[t]) return 'campaign';
  if (_OBJECTIVE_KINDS[t]) return 'objective';
  return null;
}

function _pickFields(sources, fields) {
  var out = {};
  fields.forEach(function (f) {
    for (var i = 0; i < sources.length; i++) {
      if (_isObj(sources[i]) && sources[i][f] !== undefined && sources[i][f] !== null && sources[i][f] !== '') {
        out[f] = sources[i][f];
        return;
      }
    }
  });
  return out;
}

// Extract the payload object for a kind, or synthesize one from flat fields.
// Returns null when there isn't enough substance to make a real proposal.
function _extractPayload(item, kind) {
  var nested = item[kind] || (_isObj(item.payload) && item.payload[kind]) || null;
  var obj;
  if (_isObj(nested)) {
    obj = {};
    Object.keys(nested).forEach(function (k) { obj[k] = nested[k]; });
  } else {
    // Flat synthesis: fields sitting directly on the item (or its payload)
    obj = _pickFields([item, item.payload], kind === 'campaign' ? _CAMPAIGN_FIELDS : _OBJECTIVE_FIELDS);
  }
  // Alias name<->title so the handler's required-field checks see the right key
  if (kind === 'campaign' && !obj.name && obj.title) obj.name = obj.title;
  if (kind === 'objective' && !obj.title && obj.name) obj.title = obj.name;
  // Backfill trigger declared at the item level
  if (!obj.trigger && typeof item.trigger === 'string') obj.trigger = item.trigger;
  var label = kind === 'campaign' ? obj.name : obj.title;
  if (!label || !(obj.description || obj.rationale)) return null; // not enough substance
  return obj;
}

// liftProposalActions(proposals) → { lifted: [actionObj], remaining: [item] }
function liftProposalActions(proposals) {
  var lifted = [], remaining = [];
  (Array.isArray(proposals) ? proposals : []).forEach(function (item) {
    if (!_isObj(item)) { if (item !== undefined && item !== null) remaining.push(item); return; }
    var kind = _declaredKind(item);
    if (!kind) {
      // No declared type — infer from an unambiguous bare payload
      var hasC = _isObj(item.campaign) || (_isObj(item.payload) && _isObj(item.payload.campaign));
      var hasO = _isObj(item.objective) || (_isObj(item.payload) && _isObj(item.payload.objective));
      if (hasC && !hasO) kind = 'campaign';
      else if (hasO && !hasC) kind = 'objective';
    }
    if (!kind) { remaining.push(item); return; }
    var payload = _extractPayload(item, kind);
    if (!payload) { remaining.push(item); return; }
    var action = kind === 'campaign'
      ? { type: 'propose-campaign', campaign: payload }
      : { type: 'propose-objective', objective: payload };
    if (typeof item.summary === 'string' && item.summary) action.summary = item.summary;
    lifted.push(action);
  });
  return { lifted: lifted, remaining: remaining };
}

module.exports = {
  proposalSeverity: proposalSeverity,
  selectTopProposals: selectTopProposals,
  liftProposalActions: liftProposalActions
};
