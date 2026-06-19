// modules/company/fleet-evolve.js
// Pure logic + HTML builders for the Fleet Command evolve modal.
// No DOM or network side effects except readEvolveModalState (DOM read only).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FleetEvolve = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CAP_CEILING = 5.00; // mirror of FLEET_PROPOSAL_COST_CEILINGS['propose-role-evolution']
  var ALLOWED_FIELDS = ['focus', 'monthlyCap', 'doctrine', 'expectedActionMix'];
  var PROTECTED_FIELDS = ['id', 'name', 'tier', 'status', 'hiredAt', 'retiredAt', 'reportsTo'];
  var ACTION_LEVELS = ['none', 'low', 'medium', 'high'];
  var RISK_PRESETS = ['Low', 'Low-Medium', 'Medium', 'Medium-High', 'High'];
  var HORIZON_PRESETS = ['Immediate', 'Days-Weeks', 'Weekly-Quarterly', '12-36 months', '3-10 years'];

  // Archetype bundles pre-fill the form; values merge over current doctrine/mix.
  var ARCHETYPES = {
    aggressive:   { label: '⚔ More aggressive',  doctrine: { riskTolerance: 'High' } },
    conservative: { label: '🛡 More conservative', doctrine: { riskTolerance: 'Low' } },
    output:       { label: '📣 Output-focused',    expectedActionMix: { 'execute-task': 'high', 'create-doc': 'high' } },
    reset:        { label: '↺ Reset to default',   _reset: true }
  };

  return {
    CAP_CEILING: CAP_CEILING,
    ALLOWED_FIELDS: ALLOWED_FIELDS,
    PROTECTED_FIELDS: PROTECTED_FIELDS,
    ACTION_LEVELS: ACTION_LEVELS,
    RISK_PRESETS: RISK_PRESETS,
    HORIZON_PRESETS: HORIZON_PRESETS,
    ARCHETYPES: ARCHETYPES
  };
});
