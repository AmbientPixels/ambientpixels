// actionsScheduler — Timer Trigger (every 5 minutes)
// Checks for approved social_post.schedule actions whose scheduled_for
// time has arrived, then executes them via the platform executor.

const storage = require('../_utils/companyStorage');
const { executeAction, isExecutable } = require('../actionsExecute/executors');

module.exports = async function (context) {
  context.log('[Scheduler] Checking for due scheduled actions');

  try {
    const actions = (await storage.getState('actions')) || [];
    const now = Date.now();
    let executed = 0;

    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];

      // Must be social_post.schedule type
      const actionType = a.type || a.action_type;
      if (actionType !== 'social_post.schedule') continue;

      // Must be approved (or overridden)
      const approvalStatus = a.approval ? a.approval.status : null;
      if (approvalStatus !== 'approved' && approvalStatus !== 'overridden') continue;

      // Must not already be executed or running
      if (a.execution && (a.execution.status === 'success' || a.execution.status === 'running')) continue;

      // Must have a scheduled_for time that has passed
      const scheduledFor = (a.payload && a.payload.scheduled_for) || null;
      if (!scheduledFor) continue;
      const scheduledTime = new Date(scheduledFor).getTime();
      if (isNaN(scheduledTime) || scheduledTime > now) continue;

      // Don't execute if scheduled time is more than 24h ago (stale)
      if (now - scheduledTime > 24 * 60 * 60 * 1000) {
        context.log('[Scheduler] Skipping stale scheduled action:', a.id, '(scheduled_for:', scheduledFor, ')');
        a.execution = a.execution || {};
        a.execution.status = 'failed';
        a.execution.finished_at = new Date().toISOString();
        a.execution.last_error = { code: 'STALE_SCHEDULE', message: 'Scheduled time is more than 24h ago' };
        a.execution_status = 'failed';
        actions[i] = a;
        continue;
      }

      const platform = a.platform || 'unknown';

      // For scheduled posts, we execute as social_post.publish
      // Check if the platform adapter exists for publish
      if (!isExecutable('social_post.publish', platform)) {
        context.log('[Scheduler] No executor for', platform, ', skipping', a.id);
        continue;
      }

      // Mark running
      a.execution = a.execution || {};
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

    // Persist all changes
    await storage.setState('actions', actions);

    if (executed > 0) {
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
