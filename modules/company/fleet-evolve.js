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

  function _shallowEqual(a, b) {
    a = a || {}; b = b || {};
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      var k = ka[i];
      if (Array.isArray(a[k]) || Array.isArray(b[k])) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
      } else if (a[k] !== b[k]) return false;
    }
    return true;
  }

  function buildChanges(current, edited) {
    var changes = {};
    if (String(edited.focus) !== String(current.focus)) changes.focus = edited.focus;
    if (Number(edited.monthlyCap) !== Number(current.monthlyCap)) changes.monthlyCap = Number(edited.monthlyCap);
    if (!_shallowEqual(current.doctrine, edited.doctrine)) changes.doctrine = edited.doctrine;
    if (!_shallowEqual(current.expectedActionMix, edited.expectedActionMix)) changes.expectedActionMix = edited.expectedActionMix;
    return changes;
  }

  function computeCostDelta(current, edited) {
    return Math.round((Number(edited.monthlyCap) - Number(current.monthlyCap)) * 100) / 100;
  }

  function validateEvolution(changes, opts) {
    opts = opts || {};
    var errors = [];
    var keys = Object.keys(changes || {});
    var hasAllowed = keys.some(function (k) { return ALLOWED_FIELDS.indexOf(k) !== -1; });
    if (!hasAllowed) errors.push('Change at least one field (focus, cap, doctrine, or loadout).');
    var protectedHit = keys.filter(function (k) { return PROTECTED_FIELDS.indexOf(k) !== -1; });
    if (protectedHit.length) errors.push('Cannot change protected field(s): ' + protectedHit.join(', '));
    if ('monthlyCap' in changes) {
      var cap = Number(changes.monthlyCap);
      if (!(cap > 0 && cap <= CAP_CEILING)) errors.push('Monthly cap must be between $0 and $' + CAP_CEILING.toFixed(2) + '.');
    }
    if (String(opts.rationale || '').trim().length < 20) errors.push('Rationale is required (min 20 characters).');
    return { ok: errors.length === 0, errors: errors };
  }

  var DOCTRINE_LABELS = { strategicBias: 'Strategic bias', riskTolerance: 'Risk tolerance', timeHorizon: 'Time horizon', coreQuestion: 'Core question', escalationTriggers: 'Escalation triggers' };

  function diffSummary(current, edited) {
    var out = [];
    if (String(edited.focus) !== String(current.focus)) out.push({ label: 'Focus', was: String(current.focus || ''), now: String(edited.focus || '') });
    if (Number(edited.monthlyCap) !== Number(current.monthlyCap)) out.push({ label: 'Monthly cap', was: '$' + Number(current.monthlyCap).toFixed(2), now: '$' + Number(edited.monthlyCap).toFixed(2) });
    var cd = current.doctrine || {}, edd = edited.doctrine || {};
    Object.keys(DOCTRINE_LABELS).forEach(function (k) {
      var a = Array.isArray(cd[k]) ? cd[k].join(', ') : (cd[k] || '');
      var b = Array.isArray(edd[k]) ? edd[k].join(', ') : (edd[k] || '');
      if (a !== b) out.push({ label: DOCTRINE_LABELS[k], was: a, now: b });
    });
    var cm = current.expectedActionMix || {}, em = edited.expectedActionMix || {};
    Object.keys(em).forEach(function (act) {
      if ((cm[act] || 'none') !== em[act]) out.push({ label: act, was: cm[act] || 'none', now: em[act] });
    });
    return out;
  }

  function _esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function _segDoctrine(field, presets, current) {
    return presets.map(function (p) {
      var on = (String(current) === p) ? ' on' : '';
      return '<b data-doctrine="' + field + '" data-val="' + _esc(p) + '" class="fe-seg-b' + on + '">' + _esc(p) + '</b>';
    }).join('');
  }
  function _segAction(action, current) {
    return ACTION_LEVELS.map(function (lvl) {
      var on = (String(current || 'none') === lvl) ? ' on' : '';
      return '<b data-action="' + action + '" data-val="' + lvl + '" class="fe-seg-b' + on + '">' + lvl + '</b>';
    }).join('');
  }

  function buildEvolveModalHtml(agent) {
    var d = agent.doctrine || {}, mix = agent.expectedActionMix || {};
    var ver = (Array.isArray(agent.doctrineHistory) ? agent.doctrineHistory.length : 0) + 1;
    var presetBtns = Object.keys(ARCHETYPES).map(function (k) {
      return '<b class="fe-preset" data-preset="' + k + '">' + _esc(ARCHETYPES[k].label) + '</b>';
    }).join('');
    var triggers = (Array.isArray(d.escalationTriggers) ? d.escalationTriggers : []).map(function (t) {
      return '<span class="fe-chip" data-trigger="' + _esc(t) + '">' + _esc(t) + '<i class="fe-x">×</i></span>';
    }).join('');
    var mixRows = Object.keys(mix).map(function (act) {
      return '<div class="fe-row"><span>' + _esc(act) + '</span><div class="fe-seg">' + _segAction(act, mix[act]) + '</div></div>';
    }).join('');

    return '' +
    '<div class="fe-modal" data-agent="' + _esc(agent.id) + '">' +
      '<div class="fe-head"><div class="fe-title">Evolve ' + _esc(agent.name || agent.id) + '</div>' +
        '<div class="fe-sub">' + _esc(agent.role || '') + ' · Tier ' + _esc(agent.tier) + ' · v' + (ver - 1) + ' → v' + ver + '</div></div>' +
      '<div class="fe-presets">' + presetBtns + '</div>' +
      '<div class="fe-sec"><div class="fe-lbl">Focus</div>' +
        '<textarea class="fe-ta" data-field="focus" rows="2">' + _esc(agent.focus || '') + '</textarea></div>' +
      '<div class="fe-sec"><div class="fe-lbl">Monthly cap (max $' + CAP_CEILING.toFixed(2) + ')</div>' +
        '<input class="fe-range" type="range" min="0.5" max="' + CAP_CEILING + '" step="0.25" data-field="monthlyCap" value="' + Number(agent.monthlyCap || 0) + '">' +
        '<span class="fe-capval">$' + Number(agent.monthlyCap || 0).toFixed(2) + '</span></div>' +
      '<div class="fe-sec"><div class="fe-lbl">Doctrine</div>' +
        '<div class="fe-row"><span>Risk tolerance</span><div class="fe-seg">' + _segDoctrine('riskTolerance', RISK_PRESETS, d.riskTolerance) + '</div></div>' +
        '<div class="fe-row"><span>Time horizon</span><div class="fe-seg">' + _segDoctrine('timeHorizon', HORIZON_PRESETS, d.timeHorizon) + '</div></div>' +
        '<div class="fe-row"><span>Strategic bias</span><input class="fe-ta" data-doctrine="strategicBias" value="' + _esc(d.strategicBias || '') + '"></div>' +
        '<div class="fe-row"><span>Core question</span><input class="fe-ta" data-doctrine="coreQuestion" value="' + _esc(d.coreQuestion || '') + '"></div>' +
        '<div class="fe-row"><span>Escalation triggers</span><div class="fe-chips" data-triggers>' + triggers + '<span class="fe-chip fe-add">+ add</span></div></div></div>' +
      '<div class="fe-sec"><div class="fe-lbl">Loadout — expected action mix</div>' + mixRows + '</div>' +
      '<div class="fe-sec"><div class="fe-lbl">Rationale <span class="fe-req">*required</span></div>' +
        '<textarea class="fe-ta" data-field="rationale" rows="2" placeholder="Why this evolution? (min 20 chars — saved to lineage)"></textarea></div>' +
      '<div class="fe-diff" data-diff></div>' +
      '<div class="fe-foot"><span class="fe-note">If rejected: 14-day cooldown.</span>' +
        '<span class="fe-spacer"></span>' +
        '<button class="fe-btn fe-ghost" data-fe="cancel">Cancel</button>' +
        '<button class="fe-btn fe-sec" data-fe="propose">Propose for review</button>' +
        '<button class="fe-btn fe-amber" data-fe="now">⚡ Evolve now</button></div>' +
    '</div>';
  }

  return {
    CAP_CEILING: CAP_CEILING,
    ALLOWED_FIELDS: ALLOWED_FIELDS,
    PROTECTED_FIELDS: PROTECTED_FIELDS,
    ACTION_LEVELS: ACTION_LEVELS,
    RISK_PRESETS: RISK_PRESETS,
    HORIZON_PRESETS: HORIZON_PRESETS,
    ARCHETYPES: ARCHETYPES,
    buildChanges: buildChanges,
    computeCostDelta: computeCostDelta,
    validateEvolution: validateEvolution,
    diffSummary: diffSummary,
    buildEvolveModalHtml: buildEvolveModalHtml
  };
});
