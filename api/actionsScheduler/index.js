// actionsScheduler — Timer Trigger (every 5 minutes)
// Checks for approved social_post.schedule actions whose scheduled_for
// time has arrived, then executes them via the platform executor.

const storage = require('../_utils/companyStorage');
const { executeAction, isExecutable } = require('../actionsExecute/executors');

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

      // Must be social_post.schedule type
      const actionType = a.type || a.action_type;
      if (actionType !== 'social_post.schedule') continue;

      // Must be approved (or overridden)
      const approvalStatus = a.approval ? a.approval.status : null;
      if (approvalStatus !== 'approved' && approvalStatus !== 'overridden') continue;

      // Already succeeded — skip
      if (a.execution && a.execution.status === 'success') continue;

      // Stuck-running escape hatch: if running for >15 min, check receipt then mark
      if (a.execution && a.execution.status === 'running' && a.execution.started_at) {
        const runningFor = now - new Date(a.execution.started_at).getTime();
        if (runningFor > STUCK_THRESHOLD_MS) {
          // If action has a valid receipt, it actually succeeded — promote to success
          if (a.execution.receipt && (a.execution.receipt.post_id || a.execution.receipt.post_url || a.execution.receipt.public_url)) {
            context.log('[Scheduler] Action', a.id, 'was stuck but has valid receipt — marking success');
            a.execution.status = 'success';
            a.execution.finished_at = a.execution.receipt.published_at || new Date().toISOString();
            a.execution_status = 'success';
          } else {
            context.log.warn('[Scheduler] Action', a.id, 'stuck running for', Math.round(runningFor / 60000), 'min — marking failed');
            a.execution.status = 'failed';
            a.execution.finished_at = new Date().toISOString();
            a.execution.last_error = { code: 'RUN_STUCK', message: 'Execution stuck running for ' + Math.round(runningFor / 60000) + ' minutes' };
            a.execution_status = 'failed';
          }
          actions[i] = a;
        }
        continue; // either just resolved or still within threshold — skip
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

      const platform = a.platform || 'unknown';

      // Platform allowlist check
      if (enabledPlatforms.indexOf(platform) === -1) {
        context.log('[Scheduler] Platform', platform, 'not in SOCIAL_PLATFORMS_ENABLED, skipping', a.id);
        continue;
      }

      // Check if the platform adapter exists for publish
      if (!isExecutable('social_post.publish', platform)) {
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

      context.log('[Scheduler] Executing scheduled action:', a.id, 'platform:', platform);

      // Execute — override the type to social_post.publish for the executor
      const execAction = Object.assign({}, a, { type: 'social_post.publish' });

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
          scheduled_for: scheduledFor,
          post_url: (result.receipt && result.receipt.post_url) || null
        });

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
