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

module.exports = { proposalSeverity: proposalSeverity, selectTopProposals: selectTopProposals };
