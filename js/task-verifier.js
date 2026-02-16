// task-verifier.js — Verification Gate v1: deterministic task completion validation
// Loads templates from /data/company-verification-templates.json
// Never throws raw errors. Never mutates tasks.

var TaskVerifier = (function () {
  'use strict';

  var _templates = null;
  var _loadPromise = null;
  var _loadError = null;

  // ── Load templates ──
  function load() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = fetch('/data/company-verification-templates.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.templates)) {
          throw new Error('Invalid template structure');
        }
        _templates = data.templates;
        _loadError = null;
        return _templates;
      })
      .catch(function (err) {
        _templates = null;
        _loadError = (err && err.message) ? err.message : 'Template load failed';
        _loadPromise = null;
        return null;
      });
    return _loadPromise;
  }

  function isLoaded() { return _templates !== null; }
  function hasError() { return _loadError !== null; }

  // ── Get template by task type ──
  function _getTemplate(taskType) {
    if (!_templates || !taskType) return null;
    for (var i = 0; i < _templates.length; i++) {
      if (_templates[i].id === taskType) return _templates[i];
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════
  // ── PUBLIC: verify(task) ──
  // Returns { status, reasons, riskLevel, requiresApproval }
  // status: "pass" | "warn" | "fail" | "manual"
  // ══════════════════════════════════════════════════════════
  function verify(task) {
    // Defensive: no task at all
    if (!task) {
      return _result('fail', ['No task provided'], 'high', true);
    }

    // Templates not loaded → manual
    if (!_templates) {
      return _result('manual', ['Verification templates not available'], 'medium', true);
    }

    var template = _getTemplate(task.type);

    // Unknown task type → manual review required (fail closed)
    if (!template) {
      return _result('manual', ['Unknown task type: manual review required'], 'medium', true);
    }

    var reasons = [];

    // 1) Required fields check
    var reqFields = template.requiredFields || [];
    for (var i = 0; i < reqFields.length; i++) {
      var field = reqFields[i];
      var val = task[field];
      if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
        reasons.push('Missing required field: ' + field);
      }
    }

    // 2) Required artifacts check
    var reqArtifacts = template.requiredArtifacts || [];
    var taskArtifacts = task.artifacts || [];
    for (var j = 0; j < reqArtifacts.length; j++) {
      var artType = reqArtifacts[j];
      var found = false;
      for (var k = 0; k < taskArtifacts.length; k++) {
        if (taskArtifacts[k] && taskArtifacts[k].type === artType) {
          found = true;
          break;
        }
      }
      if (!found) {
        reasons.push('Missing required artifact: ' + artType);
      }
    }

    // 3) Validations
    var validations = template.validations || [];
    for (var v = 0; v < validations.length; v++) {
      var rule = validations[v];
      var fieldVal = task[rule.field];
      var fieldStr = (typeof fieldVal === 'string') ? fieldVal : '';

      switch (rule.type) {
        case 'nonEmpty':
          if (!fieldStr || fieldStr.trim() === '') {
            reasons.push('Field "' + rule.field + '" must not be empty');
          }
          break;
        case 'minLength':
          if (fieldStr.length < (rule.value || 0)) {
            reasons.push('Field "' + rule.field + '" must be at least ' + rule.value + ' characters (current: ' + fieldStr.length + ')');
          }
          break;
        default:
          // Unknown validation type — skip silently (do not fail on unknown rules)
          break;
      }
    }

    // Determine status
    if (reasons.length > 0) {
      return _result('fail', reasons, template.riskLevel || 'medium', template.requiresApproval !== false);
    }

    return _result('pass', [], template.riskLevel || 'low', template.requiresApproval === true);
  }

  // ── Verify for lane transition (v1.1: Loose Review, Strict Done) ──
  // targetLane: the lane the task is moving into
  // Returns: { allowed, status, reasons, message?, notice? }
  function verifyForTransition(task, targetLane) {
    var result = verify(task);

    // Non-gated lanes — always allow
    if (targetLane !== 'review' && targetLane !== 'done') {
      return { allowed: true, status: result.status, reasons: result.reasons, message: null, notice: null };
    }

    // ── REVIEW: always allowed (loose gate) ──
    if (targetLane === 'review') {
      if (result.status === 'pass') {
        return { allowed: true, status: 'pass', reasons: [], message: null, notice: null };
      }
      // Incomplete or unknown — allow but attach notice
      var firstReason = result.reasons.length > 0 ? result.reasons[0] : 'Verification incomplete';
      return {
        allowed: true,
        status: result.status,
        reasons: result.reasons,
        message: null,
        notice: 'Moved to Review \u2014 incomplete: ' + firstReason
      };
    }

    // ── DONE: strict gate — only PASS allowed ──
    if (result.status === 'pass') {
      return { allowed: true, status: 'pass', reasons: [], message: null, notice: null };
    }

    var blockMsg = result.status === 'manual'
      ? 'Manual review required before marking as Done'
      : (result.reasons.length > 0 ? result.reasons[0] : 'Verification failed');

    return {
      allowed: false,
      status: result.status,
      reasons: result.reasons,
      message: blockMsg,
      notice: null
    };
  }

  // ── Validate a worker proposal ──
  // Attaches verification result to proposed_action
  function validateProposal(proposal, task) {
    if (!proposal) return proposal;
    var result = verify(task);

    var annotated = {};
    for (var key in proposal) {
      if (proposal.hasOwnProperty(key)) annotated[key] = proposal[key];
    }

    annotated.verification = {
      status: result.status,
      riskLevel: result.riskLevel,
      requiresApproval: result.requiresApproval
    };

    if (result.status === 'fail') {
      annotated.verification.downgraded = true;
      annotated.verification.originalAction = annotated.actionType;
      annotated.actionType = 'requires_fix';
      annotated.verification.reasons = result.reasons;
    } else if (result.status === 'pass') {
      annotated.verification.tag = 'verification_passed';
    } else if (result.status === 'manual') {
      annotated.verification.tag = 'manual_review_required';
    }

    return annotated;
  }

  // ── Sync verify (uses cached templates) ──
  function verifySync(task) {
    return verify(task);
  }

  // ── Badge helper for UI ──
  // Returns { cls, icon, label } for rendering
  function getBadge(task) {
    var result = verify(task);
    switch (result.status) {
      case 'pass':
        return { cls: 'verify-badge--pass', icon: 'fas fa-check-circle', label: 'Verified' };
      case 'fail':
        return { cls: 'verify-badge--fail', icon: 'fas fa-times-circle', label: 'Failed' };
      case 'manual':
        return { cls: 'verify-badge--manual', icon: 'fas fa-question-circle', label: 'Review' };
      case 'warn':
        return { cls: 'verify-badge--warn', icon: 'fas fa-exclamation-circle', label: 'Warning' };
      default:
        return { cls: 'verify-badge--manual', icon: 'fas fa-question-circle', label: 'Review' };
    }
  }

  // ── Internal result builder ──
  function _result(status, reasons, riskLevel, requiresApproval) {
    return {
      status: status,
      reasons: reasons || [],
      riskLevel: riskLevel || 'medium',
      requiresApproval: !!requiresApproval
    };
  }

  return {
    load: load,
    isLoaded: isLoaded,
    hasError: hasError,
    verify: verify,
    verifySync: verifySync,
    verifyForTransition: verifyForTransition,
    validateProposal: validateProposal,
    getBadge: getBadge
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TaskVerifier;
}
