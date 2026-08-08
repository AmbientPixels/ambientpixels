// actionsScheduler — Timer Trigger (every 5 minutes)
// Checks for approved social_post.schedule actions whose scheduled_for
// time has arrived, then executes them via the platform executor.

const storage = require('../_utils/companyStorage');
const { executeAction, isExecutable } = require('../actionsExecute/executors');
const outcomeBaseline = require('../actionsExecute/executors/_utils/outcomeBaseline');
const { resolveStuckExecution } = require('./stuck-execution');

module.exports = async function (context) {
  var demoGuard = require('../_utils/demoGuard');
  if (demoGuard.timerSkip(context)) return;
  // Kill switch
  if (process.env.ACTIONS_EXECUTION_ENABLED === 'false') {
    context.log.warn('[Scheduler] Execution disabled via ACTIONS_EXECUTION_ENABLED=false');
    return;
  }

  context.log('[Scheduler] Checking for due scheduled actions');

  try {
    const actions = (await storage.getState('actions')) || [];
    const now = Date.now();
    let executed = 0;

    const MAX_ATTEMPTS = 3;
    const RETRY_COOLDOWN_MS = 5 * 60 * 1000; // 5 min between retries
    const STUCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 min = stuck
    const enabledPlatforms = (process.env.SOCIAL_PLATFORMS_ENABLED || 'x').split(',').map(s => s.trim().toLowerCase());

    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];

      // social_post.schedule (timed) AND social_post.reply (immediate-on-approval).
      // The reply support added 2026-07-23 was unreachable behind this filter for
      // a day — replies were dropped HERE before the isReply branch below ever ran.
      const actionType = a.type || a.action_type;
      if (actionType !== 'social_post.schedule' && actionType !== 'social_post.reply') continue;

      // Must be approved (or overridden)
      const approvalStatus = a.approval ? a.approval.status : null;
      if (approvalStatus !== 'approved' && approvalStatus !== 'overridden') continue;

      // Already succeeded — skip
      if (a.execution && a.execution.status === 'success') continue;

      // Parked for a human after an unverifiable dispatch. NEVER auto-retry
      // these: the whole point is that we do not know whether they already
      // posted. See stuck-execution.js for the double-post this prevents.
      if (a.execution && a.execution.requires_manual_review) continue;

      // Stuck-running escape hatch. The decision lives in stuck-execution.js
      // because the old inline version double-posted three Bluesky replies on
      // 2026-08-08: it decided "did this already post?" by reading
      // execution.receipt, which is written by the very write-back whose
      // failure is what leaves an action stuck. Absent by construction, so it
      // always concluded 'failed', and 'failed' is eligible.
      if (a.execution && a.execution.status === 'running') {
        const _stuck = resolveStuckExecution(a, now, STUCK_THRESHOLD_MS);
        if (_stuck.verdict === 'success') {
          context.log('[Scheduler] Action', a.id, 'was stuck but has valid receipt — marking success');
          a.execution.status = 'success';
          a.execution.finished_at = a.execution.receipt.published_at || new Date().toISOString();
          a.execution_status = 'success';
          actions[i] = a;
        } else if (_stuck.verdict === 'needs_review') {
          context.log.warn('[Scheduler] Action', a.id, 'dispatched but never confirmed — parking for manual review, NOT retrying (it may already be live)');
          a.execution.status = 'failed';
          a.execution.finished_at = new Date().toISOString();
          a.execution.last_error = _stuck.error;
          a.execution.requires_manual_review = true;
          a.execution_status = 'failed';
          actions[i] = a;
        } else if (_stuck.verdict === 'failed') {
          context.log.warn('[Scheduler] Action', a.id, 'stuck running —', _stuck.error.message);
          a.execution.status = 'failed';
          a.execution.finished_at = new Date().toISOString();
          a.execution.last_error = _stuck.error;
          a.execution_status = 'failed';
          actions[i] = a;
        }
        continue; // resolved, parked, or still within threshold — never dispatch this pass
      }

      // Max attempts cap
      if (a.execution && a.execution.attempts >= MAX_ATTEMPTS) {
        if (a.execution.status !== 'failed') {
          context.log.warn('[Scheduler] Action', a.id, 'exceeded max attempts (' + MAX_ATTEMPTS + ')');
          a.execution.status = 'failed';
          a.execution.finished_at = new Date().toISOString();
          a.execution.last_error = { code: 'MAX_ATTEMPTS', message: 'Exceeded max ' + MAX_ATTEMPTS + ' execution attempts' };
          a.execution_status = 'failed';
          actions[i] = a;
        }
        continue;
      }

      // Retry cooldown: don't retry if last attempt < 5 min ago
      if (a.execution && a.execution.attempts > 0 && a.execution.finished_at) {
        const sinceLastAttempt = now - new Date(a.execution.finished_at).getTime();
        if (sinceLastAttempt < RETRY_COOLDOWN_MS) continue;
      }

      // Manual platforms (Reddit, Facebook) — never expire, CEO posts manually
      const _manualPlatforms = ['reddit', 'facebook'];
      if (_manualPlatforms.indexOf((a.platform || '').toLowerCase()) !== -1) continue;

      // Replies execute IMMEDIATELY on approval — they answer live conversations
      // and never carry payload.scheduled_for, which the gate below would skip
      // forever. That gap meant NO approved social_post.reply ever posted (found
      // 2026-07-23: replies from 07-15/21/22 sitting approved with null execution
      // — the outreach pipeline's "sent" statuses were phantom). Staleness guard:
      // replying to a 3+ day-old thread reads as necro — fail it instead.
      const isReply = a.type === 'social_post.reply';
      if (isReply) {
        const replyAgeMs = now - new Date(a.created_at || 0).getTime();
        if (!Number.isFinite(replyAgeMs) || replyAgeMs > 3 * 24 * 60 * 60 * 1000) {
          a.execution = a.execution || {};
          a.execution.status = 'failed';
          a.execution.finished_at = new Date().toISOString();
          a.execution.last_error = { code: 'STALE_REPLY', message: 'Reply approved but older than 3 days — posting now would be necro. Not sent.' };
          a.execution_status = 'failed';
          actions[i] = a;
          continue;
        }
      } else {
        // Must have a scheduled_for time that has passed
        const scheduledFor = (a.payload && a.payload.scheduled_for) || null;
        if (!scheduledFor) continue;
        const scheduledTime = new Date(scheduledFor).getTime();
        if (isNaN(scheduledTime) || scheduledTime > now) continue;

        // If scheduled time is past but within 7 days, post now (CEO already approved)
        // Only fail if >7 days stale (content likely irrelevant)
        const staleMs = now - scheduledTime;
        if (staleMs > 7 * 24 * 60 * 60 * 1000) {
          context.log('[Scheduler] Skipping stale scheduled action:', a.id, '(scheduled_for:', scheduledFor, ', stale:', Math.round(staleMs / 86400000), 'd)');
          a.execution = a.execution || {};
          a.execution.status = 'failed';
          a.execution.finished_at = new Date().toISOString();
          a.execution.last_error = { code: 'STALE_SCHEDULE', message: 'Scheduled time is more than 7 days ago' };
          a.execution_status = 'failed';
          actions[i] = a;
          continue;
        }
        if (staleMs > 24 * 60 * 60 * 1000) {
          context.log('[Scheduler] Action', a.id, 'schedule was', Math.round(staleMs / 3600000), 'h ago — posting now (CEO approved)');
        }
      }

      const platform = a.platform || 'unknown';

      // Platform allowlist check
      if (enabledPlatforms.indexOf(platform) === -1) {
        context.log('[Scheduler] Platform', platform, 'not in SOCIAL_PLATFORMS_ENABLED, skipping', a.id);
        continue;
      }

      // Check if the platform adapter exists (replies route through the reply
      // executor, scheduled posts through publish)
      if (!isExecutable(isReply ? 'social_post.reply' : 'social_post.publish', platform)) {
        context.log('[Scheduler] No executor for', platform, ', skipping', a.id);
        continue;
      }

      // Snapshot previous attempt into history[] (if retrying)
      a.execution = a.execution || {};
      if (a.execution.attempts > 0 && a.execution.last_error) {
        if (!a.execution.history) a.execution.history = [];
        a.execution.history.push({
          attempt: a.execution.attempts,
          started_at: a.execution.started_at || null,
          finished_at: a.execution.finished_at || null,
          error: a.execution.last_error
        });
      }

      // Mark running (claim before execute)
      a.execution.status = 'running';
      a.execution.started_at = new Date().toISOString();
      a.execution.attempts = (a.execution.attempts || 0) + 1;
      a.execution_status = 'running';
      actions[i] = a;
      await storage.setState('actions', actions);

      context.log('[Scheduler] Executing', isReply ? 'approved reply' : 'scheduled action', ':', a.id, 'platform:', platform);

      // Execute — scheduled posts route through the publish executor; replies keep
      // their own type so the reply executor (AT-protocol root/parent) handles them.
      const execAction = Object.assign({}, a, { type: isReply ? 'social_post.reply' : 'social_post.publish' });

      try {
        const result = await executeAction(execAction);

        // Success
        a.execution.status = 'success';
        a.execution.finished_at = new Date().toISOString();
        a.execution.receipt = result.receipt || null;
        a.execution.last_error = null;
        a.execution_status = 'success';
        actions[i] = a;

        await _logGovernance(storage, 'scheduled-action-success', {
          actionId: a.id,
          type: actionType,
          platform: platform,
          scheduled_for: (a.payload && a.payload.scheduled_for) || (isReply ? 'immediate-reply' : null),
          post_url: (result.receipt && result.receipt.post_url) || null
        });

        // Social telemetry — grace-window posts publish via this path, which
        // skipped the emit the HTTP execute handler does (dead pipe since 06-11).
        try {
          const tel = require('../socialMetrics/telemetry');
          if (tel.isSocialAction(execAction)) {
            const startMs = a.execution.started_at ? new Date(a.execution.started_at).getTime() : Date.now();
            await tel.appendSocialMetricEvent(tel.buildSocialTelemetryEvent(execAction, {
              event_type: 'execution',
              result: 'success',
              created_at: a.execution.started_at || new Date().toISOString(),
              executed_at: a.execution.finished_at,
              latency_ms: Math.max(0, new Date(a.execution.finished_at).getTime() - startMs),
              post_url: (result.receipt && result.receipt.post_url) || ''
            }));
          }
        } catch (telErr) { context.log.warn('[Scheduler] Social telemetry emit failed:', telErr.message); }

        // Outcome Attribution t0 baseline — scheduled/grace-window posts publish via
        // this path, which skipped the writeBaseline hook the HTTP execute handler
        // has (same class of gap as the telemetry emit above). Consequence before
        // this fix: outcomeSnapshots frozen since 07-10 while every ship went through
        // the scheduler — engagement XP, outcome digests, and experiment conclusion
        // all starved. Helper is idempotent + non-fatal.
        try {
          await outcomeBaseline.writeBaseline(a, context);
        } catch (_obErr) { /* helper handles its own errors; defensive belt */ }

        // Parent-task auto-complete — scheduled/grace-window posts publish via
        // this path, which skipped the auto-close hook the HTTP execute handler
        // has (actionsExecute/index.js ~455). Third instance of the
        // handler-vs-scheduler hook gap, after telemetry (06-11) and outcome
        // baseline (07-10). Consequence before this fix: every scheduler-shipped
        // post left its parent task stuck in todo with _social_action_created
        // set — 9 published promo tasks were sitting as "stuck in todo"
        // dashboard warnings on 2026-07-29. Mirrors the HTTP hook; non-fatal.
        if (a._parentTaskId) {
          try {
            const tasks = (await storage.getState('tasks')) || [];
            const parentTask = tasks.find(function (t) { return t && t.id === a._parentTaskId; });
            if (parentTask && ['done', 'canceled', 'archived'].indexOf(parentTask.status) === -1) {
              parentTask.status = 'done';
              parentTask.completedAt = new Date().toISOString();
              parentTask.updatedAt = new Date().toISOString();
              if (!parentTask.comments) parentTask.comments = [];
              parentTask.comments.push({
                id: 'cmt-autoclose-' + Date.now(),
                author: 'system',
                text: 'Task auto-completed: social post published successfully on ' + platform + ' (scheduler). Post URL: ' + ((result.receipt && result.receipt.post_url) || 'N/A'),
                type: 'system',
                createdAt: new Date().toISOString()
              });
              await storage.setState('tasks', tasks);
              context.log('[Scheduler] Auto-completed parent task:', a._parentTaskId, 'after successful', platform, 'post');
            }
          } catch (taskErr) {
            context.log.warn('[Scheduler] Failed to auto-complete parent task (non-fatal):', taskErr.message);
          }
        }

        context.log('[Scheduler] Successfully executed scheduled action:', a.id);
        executed++;
      } catch (execError) {
        // Failure
        a.execution.status = 'failed';
        a.execution.finished_at = new Date().toISOString();
        a.execution.last_error = {
          code: (execError && execError.code) || 'EXEC_ERROR',
          message: (execError && execError.message) || String(execError),
          raw: (execError && execError.raw) || null
        };
        a.execution_status = 'failed';
        actions[i] = a;

        await _logGovernance(storage, 'scheduled-action-failed', {
          actionId: a.id,
          type: actionType,
          platform: platform,
          error: a.execution.last_error.message
        });

        try {
          const tel = require('../socialMetrics/telemetry');
          if (tel.isSocialAction(execAction)) {
            await tel.appendSocialMetricEvent(tel.buildSocialTelemetryEvent(execAction, Object.assign({
              event_type: 'execution',
              result: 'failure',
              executed_at: a.execution.finished_at
            }, tel.mapErrorToTelemetry(execError))));
          }
        } catch (telErr) { context.log.warn('[Scheduler] Social telemetry emit failed:', telErr.message); }

        context.log.warn('[Scheduler] Failed to execute scheduled action:', a.id, execError.message || execError.code);
      }

      // Cap at 5 executions per cycle to avoid rate limits
      if (executed >= 5) break;
    }

    // Persist only if something changed
    if (executed > 0) {
      await storage.setState('actions', actions);
      context.log('[Scheduler] Executed', executed, 'scheduled actions');
    } else {
      context.log('[Scheduler] No scheduled actions due');
    }

    // ── Approval-queue reconciliation (2026-07-23) ──
    // The dashboard removes a queue entry when the CEO decides its action, but a
    // heartbeat mid-run can clobber that removal with its own wholesale
    // approvalQueue write (observed: two rejected bluesky_reply drafts
    // resurrected as pending). Sweep: any PENDING entry whose linked action is
    // already decided (approved/rejected/cancelled or executed) is resolved
    // here, so a lost-update can strand an entry for at most one 10-min tick.
    try {
      const actionById = {};
      actions.forEach(function (a) { if (a && a.id) actionById[a.id] = a; });

      // ── Proposal-entry reconciliation (2026-08-01) ──
      // Same lost-update, different entry shape. proposalDecide writes the entity
      // FIRST and the approvalQueue flip LAST, so a clobbered AQ write leaves the
      // campaign/objective live while its proposal sits 'pending' forever. The sweep
      // above can't catch it: proposal entries carry no `action_id`, so they fall out
      // at the first guard. Observed on cprop_1785542400009_auto — campaign
      // camp-ms9nl7dy-dcbp went live, the entry stayed pending, and the dashboard's
      // overlap detector then flagged the proposal as overlapping its own twin.
      // Materialized entities stamp `proposalId` (proposalDecide/materialize.js), so
      // that back-link is the evidence the decision already happened.
      // The proposalId back-links are resolved once up front so the mutator below
      // stays synchronous and cheap to re-run if the conditional write conflicts.
      const materializedBy = {};
      for (const key of ['campaigns', 'objectives', 'tasks']) {
        let live = (await storage.getState(key)) || [];
        if (!Array.isArray(live)) live = [];
        live.forEach(function (e) { if (e && e.proposalId && !materializedBy[e.proposalId]) materializedBy[e.proposalId] = e; });
      }

      let pruned = 0;
      let healed = 0;
      const res = await storage.mutateState('approvalQueue', function (fresh) {
        pruned = 0; healed = 0; // recomputed from scratch on every attempt
        const aq = Array.isArray(fresh) ? fresh : [];

        const kept = aq.filter(function (entry) {
          if (!entry || entry.status !== 'pending' || !entry.action_id) return true;
          const act = actionById[entry.action_id];
          if (!act) return true; // action archived/unknown — leave for other prunes
          const decided = act.approval && ['approved', 'rejected', 'cancelled', 'overridden'].indexOf(act.approval.status) !== -1;
          const done = act.execution_status === 'success' || (act.execution && act.execution.status === 'success');
          return !(decided || done);
        });
        pruned = aq.length - kept.length;

        kept.forEach(function (entry) {
          if (!entry || entry.status !== 'pending' || entry.action_id) return;
          if (typeof entry.type !== 'string' || !/_proposal$/.test(entry.type)) return;
          const ent = materializedBy[entry.id];
          if (!ent) return;
          entry.status = 'approved';
          entry.approvedAt = new Date().toISOString();
          entry.resolvedBy = 'system:aq-reconciliation';
          entry.materializedId = ent.id;
          entry.reconcileNote = 'Entity ' + ent.id + ' already live from this proposal — approvalQueue flip was lost; healed by scheduler sweep.';
          healed++;
        });

        return (pruned > 0 || healed > 0) ? kept : undefined;
      });

      if (res.written) {
        context.log('[Scheduler] AQ reconciliation: resolved', pruned,
          'stranded entrie(s) whose actions were already decided;', healed,
          'proposal entrie(s) healed to approved (attempt', res.attempts + ')');
      }
    } catch (aqErr) {
      context.log.warn('[Scheduler] AQ reconciliation failed (non-fatal):', aqErr.message);
    }

  } catch (err) {
    context.log.error('[Scheduler] Fatal error:', err.message || err);
  }
};

async function _logGovernance(storage, type, data) {
  try {
    const govLog = (await storage.getState('governanceLog')) || [];
    govLog.push({
      id: 'gov-' + Date.now(),
      type: type,
      data: data,
      timestamp: new Date().toISOString()
    });
    const trimmed = govLog.length > 500 ? govLog.slice(-500) : govLog;
    await storage.setState('governanceLog', trimmed);
  } catch (e) {
    // Non-fatal
  }
}
