'use strict';

// Pure validator for proposalEdit patches. No IO. Returns { clean, error }.
// `clean` contains only allow-listed, coerced fields (safe to Object.assign onto
// the queue entry). `error` is a non-null string only for a hard failure
// (unknown type, or a required field made empty); every other bad value is
// silently coerced or omitted so a typo never rejects the whole save.

var VALID_SOCIAL_TASK_TYPES = ['social_x', 'social_linkedin', 'social_bluesky'];
var VALID_CADENCE = ['daily', 'weekly', 'biweekly'];

function _str(v) { return v == null ? '' : String(v); }
function _clampStr(v, max) { return _str(v).slice(0, max); }

function _campaign(patch, clean) {
  if ('name' in patch) {
    var name = _str(patch.name).trim();
    if (!name) return 'name is required';
    clean.name = name.slice(0, 100);
  }
  if ('description' in patch) clean.description = _clampStr(patch.description, 1000);
  if ('duration' in patch) clean.duration = _clampStr(patch.duration, 50);
  if ('product' in patch) clean.product = _clampStr(patch.product, 50);
  if ('kpiTarget' in patch) clean.kpiTarget = _clampStr(patch.kpiTarget, 200);
  if ('northStarMetric' in patch) {
    var ns = _str(patch.northStarMetric).trim();
    clean.northStarMetric = ns ? ns.slice(0, 50) : null;
  }
  if ('platforms' in patch && Array.isArray(patch.platforms)) {
    var plats = patch.platforms.filter(function (p) { return VALID_SOCIAL_TASK_TYPES.indexOf(p) !== -1; });
    if (plats.length) clean.platforms = plats;
  }
  if ('frequency' in patch) {
    var f = Math.floor(Number(patch.frequency));
    if (Number.isFinite(f)) clean.frequency = Math.max(1, Math.min(14, f));
  }
  if ('cadence' in patch && VALID_CADENCE.indexOf(patch.cadence) !== -1) clean.cadence = patch.cadence;
  return null;
}

function _objective(patch, clean) {
  if ('title' in patch) {
    var title = _str(patch.title).trim();
    if (!title) return 'title is required';
    clean.title = title.slice(0, 100);
  }
  if ('description' in patch) clean.description = _clampStr(patch.description, 1000);
  if ('successCriteria' in patch) clean.successCriteria = _clampStr(patch.successCriteria, 300);
  if ('timeHorizon' in patch) clean.timeHorizon = _clampStr(patch.timeHorizon, 50);
  if ('northStarMetric' in patch) {
    var ns = _str(patch.northStarMetric).trim();
    clean.northStarMetric = ns ? ns.slice(0, 50) : null;
  }
  if ('metricTarget' in patch) {
    if (patch.metricTarget === null) clean.metricTarget = null;
    else {
      var n = Number(patch.metricTarget);
      if (Number.isFinite(n) && n >= 0) clean.metricTarget = n;
    }
  }
  if ('metricDeadline' in patch) {
    if (patch.metricDeadline === null) clean.metricDeadline = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(_str(patch.metricDeadline))) clean.metricDeadline = _str(patch.metricDeadline);
  }
  return null;
}

function validatePatch(type, patch) {
  var clean = {};
  patch = (patch && typeof patch === 'object') ? patch : {};
  var error = null;
  if (type === 'campaign_proposal') error = _campaign(patch, clean);
  else if (type === 'objective_proposal') error = _objective(patch, clean);
  else error = 'not an editable proposal type';
  if (error) return { clean: {}, error: error };
  return { clean: clean, error: null };
}

module.exports = { validatePatch: validatePatch, VALID_SOCIAL_TASK_TYPES: VALID_SOCIAL_TASK_TYPES, VALID_CADENCE: VALID_CADENCE };
