// graceWindow.js — Phase C auto-publish grace window (Full Autonomy Roadmap C1+C2)
//
// Advisory social posts that pass the composed quality gate auto-approve after the
// CEO has had `graceHours` to act. The existing actionsScheduler then posts them —
// ZERO changes to the publish rails. Shared by the autoPublishGrace timer (hourly)
// and the auto-publish-grace-trigger HTTP endpoint (manual/testing).
//
// Config (runtime-switchable, no deploy): systemConfig.autoPublish =
//   { enabled, graceHours, maxPerDay, platforms }
//
// Safety stack, outermost first:
//   - enabled flag (kill switch, dashboard/company-state editable)
//   - C2 breaker: >=2 CEO rejects of grace-published posts within 7d → self-disable
//     + AQ escalation + governance log. The system asks for help, never doubles down.
//   - platform whitelist + maxPerDay cap
//   - composed QG verdict must be an explicit PASS (no verdict = no auto-publish)
//   - only `classification: 'advisory'` actions (executive_required never auto-approves)

const storage = require('./companyStorage');

const DEFAULTS = { enabled: false, graceHours: 48, maxPerDay: 2, platforms: ['bluesky', 'x', 'linkedin'] };
const BREAKER_REJECTS = 2;
const BREAKER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function _qgPass(action, aqByActionId) {
  // Verdict on the action (stamped at creation since A2) or on its AQ entry (older actions).
  const qg = action.qualityGate || (aqByActionId[action.id] && aqByActionId[action.id].qualityGate) || null;
  return !!(qg && qg.pass === true);
}

async function runGraceWindow(context) {
  const log = (m) => context.log('[GraceWindow] ' + m);
  const cfg = (await storage.getState('systemConfig')) || {};
  const ap = Object.assign({}, DEFAULTS, cfg.autoPublish || {});
  if (!ap.enabled) { log('disabled (systemConfig.autoPublish.enabled=false)'); return { enabled: false, approved: 0 }; }

  const now = Date.now();
  const actions = (await storage.getState('actions')) || [];
  const aq = (await storage.getState('approvalQueue')) || [];
  const aqByActionId = {};
  aq.forEach(q => { if (q && q.action_id) aqByActionId[q.action_id] = q; });

  // ── C2 breaker: CEO rejected >=2 grace-published posts within 7d → self-disable ──
  const breakerHits = actions.filter(a => {
    if (!a || !a._gracePublished || !a.approval) return false;
    if (a.approval.status !== 'rejected' && a.approval.status !== 'ceo-rejected') return false;
    const ts = new Date(a.approval.decided_at || a.approval.approved_at || 0).getTime() || 0;
    return ts >= now - BREAKER_WINDOW_MS;
  });
  if (breakerHits.length >= BREAKER_REJECTS) {
    cfg.autoPublish = Object.assign({}, ap, { enabled: false, disabledBy: 'breaker', disabledAt: new Date().toISOString() });
    await storage.setState('systemConfig', cfg);
    const escId = 'aq-grace-breaker-' + new Date().toISOString().slice(0, 10);
    if (!aq.some(q => q && q.id === escId)) {
      aq.push({
        id: escId, kind: 'task_escalation', taskId: null,
        taskTitle: 'Auto-publish breaker tripped', originAgent: 'system',
        classification: 'executive_required', riskLevel: 'medium', status: 'pending',
        submittedAt: new Date().toISOString(),
        preview: 'CEO rejected ' + breakerHits.length + ' grace-published posts within 7 days (' +
          breakerHits.map(b => b.id).join(', ') + '). Auto-publish disabled itself. Re-enable via systemConfig.autoPublish.enabled after review.'
      });
      await storage.setState('approvalQueue', aq);
    }
    await _logGovernance('auto-publish-breaker', 'Auto-publish self-disabled: ' + breakerHits.length + ' grace-published posts CEO-rejected within 7d',
      { rejectedActionIds: breakerHits.map(b => b.id) });
    log('BREAKER TRIPPED — auto-publish disabled (' + breakerHits.length + ' rejects in 7d)');
    return { enabled: false, breakerTripped: true, approved: 0 };
  }

  // ── maxPerDay budget ──
  const grantedToday = actions.filter(a => {
    if (!a || !a._gracePublished || !a.approval) return false;
    const ts = new Date(a.approval.approved_at || 0).getTime() || 0;
    return ts >= now - 24 * 60 * 60 * 1000;
  }).length;
  let slots = Math.max(0, ap.maxPerDay - grantedToday);
  if (slots === 0) { log('daily budget exhausted (' + grantedToday + '/' + ap.maxPerDay + ')'); return { enabled: true, approved: 0, grantedToday }; }

  // ── candidates: advisory social posts, QG-passed, pending past the grace window ──
  const cutoff = now - ap.graceHours * 60 * 60 * 1000;
  const candidates = actions
    .filter(a => a && typeof a.type === 'string' && a.type.indexOf('social_post') === 0)
    .filter(a => (a.classification || 'advisory') === 'advisory')
    .filter(a => a.approval && a.approval.status === 'pending')
    .filter(a => ap.platforms.indexOf(String(a.platform || '').toLowerCase()) !== -1)
    .filter(a => (new Date(a.created_at || a.createdAt || 0).getTime() || now) <= cutoff)
    .filter(a => !(a.execution && a.execution.status === 'success'))
    .filter(a => _qgPass(a, aqByActionId))
    .sort((x, y) => new Date(x.created_at || 0) - new Date(y.created_at || 0));

  log(candidates.length + ' eligible candidate(s), ' + slots + ' slot(s) available');
  const approved = [];
  for (const a of candidates) {
    if (slots <= 0) break;
    const qg = a.qualityGate || (aqByActionId[a.id] && aqByActionId[a.id].qualityGate) || {};
    a.approval.status = 'approved';
    a.approval.approved_by = 'system:grace-window';
    a.approval.approved_at = new Date().toISOString();
    a.approval.decision_note = 'Auto-approved by ' + ap.graceHours + 'h grace window — pending with no CEO action since ' +
      (a.created_at || '?') + '. Quality gate: PASS (confidence ' + (qg.confidence != null ? qg.confidence : '?') + ').';
    a._gracePublished = true;
    // Ride the existing scheduler rails: it only fires `social_post.schedule` with a due time.
    if (a.type === 'social_post.publish') a.type = 'social_post.schedule';
    if (!a.payload) a.payload = {};
    const sched = a.payload.scheduled_for ? new Date(a.payload.scheduled_for).getTime() : 0;
    if (!sched || sched < now) a.payload.scheduled_for = new Date(now + 5 * 60 * 1000).toISOString();
    a.updatedAt = new Date().toISOString();
    const q = aqByActionId[a.id];
    if (q && (q.status === 'pending' || !q.status)) {
      q.status = 'approved';
      q.resolvedAt = new Date().toISOString();
      q.decision_note = 'Auto-approved by grace window';
    }
    approved.push(a.id);
    slots--;
    await _logGovernance('auto-publish-grace', 'Grace window auto-approved ' + a.platform + ' post ' + a.id +
      ' (pending ' + Math.round((now - new Date(a.created_at || now).getTime()) / 36e5) + 'h, QG conf ' + (qg.confidence != null ? qg.confidence : '?') + ')',
      { actionId: a.id, platform: a.platform, graceHours: ap.graceHours, qgConfidence: qg.confidence != null ? qg.confidence : null, taskId: a._parentTaskId || null });
    log('auto-approved ' + a.id + ' (' + a.platform + ')');
  }

  if (approved.length > 0) {
    await storage.setState('actions', actions);
    await storage.setState('approvalQueue', aq);
  }
  return { enabled: true, approved: approved.length, approvedIds: approved, grantedToday: grantedToday + approved.length };
}

async function _logGovernance(type, summary, details) {
  try {
    const logArr = (await storage.getState('governanceLog')) || [];
    logArr.push({
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      type: type, agentId: 'system', summary: summary,
      cycle: 'grace-window', timestamp: new Date().toISOString(), details: details || {}
    });
    if (logArr.length > 500) logArr.splice(0, logArr.length - 500);
    await storage.setState('governanceLog', logArr);
  } catch (e) { /* governance logging is best-effort — never block the approval itself */ }
}

module.exports = { runGraceWindow, DEFAULTS, BREAKER_REJECTS, BREAKER_WINDOW_MS };
