// actionsExecute — POST /api/actions/execute
// Executes an approved action by ID, routing to platform-specific adapters.
// Governance-gated: rejects if not approved, logs all outcomes.

const storage = require('../_utils/companyStorage');
const { executeAction, isExecutable } = require('./executors');
const socialTelemetry = require('../socialMetrics/telemetry');

// Simple in-memory rate limiter (per minute)
const _rateBucket = {};
const RATE_LIMIT_PER_MIN = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip || 'global';
  if (!_rateBucket[key] || _rateBucket[key].reset < now) {
    _rateBucket[key] = { count: 0, reset: now + 60000 };
  }
  _rateBucket[key].count++;
  return _rateBucket[key].count <= RATE_LIMIT_PER_MIN;
}

module.exports = async function (context, req) {
  // Kill switch
  if (process.env.ACTIONS_EXECUTION_ENABLED === 'false') {
    context.log.warn('[actionsExecute] Execution disabled via ACTIONS_EXECUTION_ENABLED=false');
    context.res = {
      status: 503,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'EXECUTION_DISABLED', message: 'Action execution is currently disabled by operator.' })
    };
    return;
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-functions-key'
      }
    };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  // Rate limit
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown';
  if (!checkRateLimit(clientIp)) {
    context.res = { status: 429, headers: corsHeaders, body: JSON.stringify({ error: 'Rate limit exceeded. Max ' + RATE_LIMIT_PER_MIN + ' executions per minute.' }) };
    return;
  }

  try {
    const body = req.body || {};
    const actionId = body.action_id;

    if (!actionId || typeof actionId !== 'string') {
      context.res = { status: 400, headers: corsHeaders, body: JSON.stringify({ error: 'action_id is required (string)' }) };
      return;
    }

    // Load actions from storage
    const actions = (await storage.getState('actions')) || [];
    const actionIndex = actions.findIndex(a => a.id === actionId);

    if (actionIndex === -1) {
      context.res = { status: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Action not found: ' + actionId }) };
      return;
    }

    const action = actions[actionIndex];
    const isSocialAction = socialTelemetry.isSocialAction(action);

    // ── GOVERNANCE ENFORCEMENT ──

    // 1. Check approval status
    const approvalStatus = action.approval ? action.approval.status : null;
    if (approvalStatus !== 'approved' && approvalStatus !== 'overridden') {
      context.res = {
        status: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Action not approved. Current approval status: ' + approvalStatus })
      };
      return;
    }

    // 2. Hard enforcement: social publishing ALWAYS requires CEO approval
    const actionType = action.type || action.action_type;
    const SOCIAL_CEO_TYPES = ['social_post.publish', 'social_post.schedule', 'social_post.reply'];
    if (SOCIAL_CEO_TYPES.indexOf(actionType) !== -1 && action.requires_ceo_approval && approvalStatus !== 'approved' && approvalStatus !== 'overridden') {
      context.res = {
        status: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: actionType + ' requires explicit CEO approval' })
      };
      return;
    }

    // 3a. task_completion.approve is internal-only — no external API needed
    if (actionType === 'task_completion.approve') {
      action.execution = action.execution || {};
      action.execution.status = 'success';
      action.execution.finished_at = new Date().toISOString();
      action.execution.attempts = (action.execution.attempts || 0) + 1;
      await storage.setState('actions', actions);
      context.res = {
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, execution: { status: 'success', receipt: { type: 'task_completion', taskId: (action.payload && action.payload.taskId) || null } } })
      };
      return;
    }

    // 2b. v2.5: Promotion gate — block social posts referencing blog posts without promote: true
    if (SOCIAL_CEO_TYPES.indexOf(actionType) !== -1 && action.payload && action.payload.text) {
      const _promoText = (action.payload.text || '').replace(/\{\{ARTICLE_URL[^}]*\}\}/g, '');
      const _promoSlugs = _promoText.match(/(?:ambientpixels\.ai)?\/blog\/([a-z0-9][a-z0-9-]+[a-z0-9])/gi);
      if (_promoSlugs && _promoSlugs.length > 0) {
        const _promoDocs = (await storage.getState('documents')) || [];
        const _promoBP = (await storage.getState('blogPosts')) || [];
        for (const _pm of _promoSlugs) {
          const _pSlug = _pm.replace(/.*\/blog\//i, '');
          const _pBp = _promoBP.find(p => p.slug === _pSlug);
          if (_pBp) {
            const _pDoc = _promoDocs.find(d => d.id === (_pBp.documentId || _pBp.document_id));
            if (_pDoc && !_pDoc.promote) {
              context.log('[ActionsExecute] BLOCKED social post — blog slug "' + _pSlug + '" not approved for promotion');
              context.res = { status: 403, headers: corsHeaders, body: JSON.stringify({ error: 'PROMOTION_NOT_ALLOWED', message: 'Blog post "' + _pSlug + '" is not approved for social promotion' }) };
              return;
            }
          }
        }
      }
    }

    // 3. Check action type is supported and has a platform adapter
    const platform = action.platform || 'unknown';
    if (!isExecutable(actionType, platform)) {
      context.res = {
        status: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No executor available for type "' + actionType + '" on platform "' + platform + '"' })
      };
      return;
    }

    // 4. Prevent re-execution
    if (action.execution && action.execution.status === 'success') {
      context.res = {
        status: 409,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Action already executed successfully', receipt: action.execution.receipt })
      };
      return;
    }

    // 5. Platform allowlist
    const enabledPlatforms = (process.env.SOCIAL_PLATFORMS_ENABLED || 'x,linkedin').split(',').map(s => s.trim().toLowerCase());
    if (actionType.indexOf('social_post') === 0 && enabledPlatforms.indexOf(platform) === -1) {
      context.res = {
        status: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Platform "' + platform + '" is not enabled. SOCIAL_PLATFORMS_ENABLED=' + enabledPlatforms.join(',') })
      };
      return;
    }

    // 6. Max attempts cap
    const MAX_ATTEMPTS = 3;
    action.execution = action.execution || {};
    action.telemetry = action.telemetry || {};
    if (action.execution.attempts >= MAX_ATTEMPTS) {
      context.res = {
        status: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Max execution attempts (' + MAX_ATTEMPTS + ') exceeded for this action' })
      };
      return;
    }

    // 7. Retry cooldown (5 min since last attempt)
    if (action.execution.attempts > 0 && action.execution.finished_at) {
      const sinceLastAttempt = Date.now() - new Date(action.execution.finished_at).getTime();
      if (sinceLastAttempt < 5 * 60 * 1000) {
        context.res = {
          status: 429,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Retry cooldown: wait ' + Math.ceil((5 * 60 * 1000 - sinceLastAttempt) / 1000) + 's before retrying' })
        };
        return;
      }
    }

    // ── SNAPSHOT PREVIOUS ATTEMPT INTO HISTORY ──
    if (action.execution.attempts > 0 && action.execution.last_error) {
      if (!action.execution.history) action.execution.history = [];
      action.execution.history.push({
        attempt: action.execution.attempts,
        started_at: action.execution.started_at || null,
        finished_at: action.execution.finished_at || null,
        error: action.execution.last_error
      });
    }

    // ── MARK RUNNING ──
    if (isSocialAction) {
      if (!action.telemetry.trace_id) {
        action.telemetry.trace_id = 'trace_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      }
      action.telemetry.attempt = (action.execution.attempts || 0) + 1;

      // Log approval once when action reaches execution (source of truth is approval state transition)
      if (!action.telemetry.approval_logged_at && action.approval && action.approval.status === 'approved') {
        const approvalEvent = socialTelemetry.buildSocialTelemetryEvent(action, {
          event_type: 'approval',
          result: 'success',
          trace_id: action.telemetry.trace_id,
          attempt: action.telemetry.attempt,
          created_at: action.approval.approved_at || new Date().toISOString(),
          agent_id: action.created_by || ''
        });
        await socialTelemetry.appendSocialMetricEvent(approvalEvent);
        action.telemetry.approval_logged_at = new Date().toISOString();
      }

      // Emit retry event when attempting again after previous failure
      if ((action.execution.attempts || 0) > 0) {
        const retryTax = socialTelemetry.mapErrorToTelemetry((action.execution && action.execution.last_error) || {});
        const retryEvent = socialTelemetry.buildSocialTelemetryEvent(action, {
          event_type: 'retry',
          result: 'failure',
          trace_id: action.telemetry.trace_id,
          attempt: action.telemetry.attempt,
          created_at: new Date().toISOString(),
          error_class: retryTax.error_class,
          error_code: retryTax.error_code,
          error_message: retryTax.error_message,
          agent_id: action.created_by || ''
        });
        await socialTelemetry.appendSocialMetricEvent(retryEvent);
      }
    }

    action.execution.status = 'running';
    action.execution.started_at = new Date().toISOString();
    action.execution.attempts = (action.execution.attempts || 0) + 1;
    // Sync legacy field
    action.execution_status = 'running';
    actions[actionIndex] = action;
    await storage.setState('actions', actions);

    // ── EXECUTE ──
    let result;
    try {
      result = await executeAction(action);
    } catch (execError) {
      // Execution failed
      action.execution.status = 'failed';
      action.execution.finished_at = new Date().toISOString();
      action.execution.last_error = {
        code: (execError && execError.code) || 'EXEC_ERROR',
        message: (execError && execError.message) || String(execError),
        raw: (execError && execError.raw) || null
      };
      action.execution_status = 'failed';

      if (isSocialAction) {
        const startMs = action.execution.started_at ? new Date(action.execution.started_at).getTime() : Date.now();
        const finishMs = action.execution.finished_at ? new Date(action.execution.finished_at).getTime() : Date.now();
        const latency = Math.max(0, finishMs - startMs);
        const tax = socialTelemetry.mapErrorToTelemetry(action.execution.last_error || execError || {});
        const failEvent = socialTelemetry.buildSocialTelemetryEvent(action, {
          event_type: 'execution',
          result: 'failure',
          trace_id: action.telemetry.trace_id,
          attempt: action.telemetry.attempt || action.execution.attempts || 1,
          created_at: action.execution.started_at || new Date().toISOString(),
          executed_at: action.execution.finished_at,
          latency_ms: latency,
          error_class: tax.error_class,
          error_code: tax.error_code,
          error_message: tax.error_message,
          agent_id: action.created_by || ''
        });
        await socialTelemetry.appendSocialMetricEvent(failEvent);
      }

      actions[actionIndex] = action;
      await storage.setState('actions', actions);

      // Add failure comment to parent task so CEO can see what went wrong
      if (action._parentTaskId && actionType.indexOf('social_post') === 0) {
        try {
          const tasks = (await storage.getState('tasks')) || [];
          const parentTask = tasks.find(t => t.id === action._parentTaskId);
          if (parentTask) {
            if (!parentTask.comments) parentTask.comments = [];
            const attempt = action.execution.attempts || 1;
            const MAX_ATTEMPTS = 3;
            parentTask.comments.push({
              id: 'cmt-execfail-' + Date.now(),
              author: 'system',
              text: 'Execution failed (attempt ' + attempt + '/' + MAX_ATTEMPTS + '): ' + (action.execution.last_error.message || 'Unknown error').substring(0, 300) + (attempt >= MAX_ATTEMPTS ? ' — Max retries exhausted. Task moved to blocked.' : ' — Retryable from Actions page.'),
              type: 'system',
              createdAt: new Date().toISOString()
            });
            if (attempt >= MAX_ATTEMPTS && parentTask.status !== 'done') {
              parentTask.status = 'blocked';
            }
            parentTask.updatedAt = new Date().toISOString();
            await storage.setState('tasks', tasks);
            context.log('[actionsExecute] Updated parent task:', action._parentTaskId, 'attempt', attempt + '/' + MAX_ATTEMPTS, attempt >= MAX_ATTEMPTS ? '→ BLOCKED' : '→ retryable');
          }
        } catch (taskErr) {
          context.log.warn('[actionsExecute] Failed to update parent task on failure:', taskErr.message);
        }
      }

      // Log failure to governance
      await _logGovernance(storage, 'action-failed', {
        actionId: action.id,
        type: actionType,
        platform: platform,
        error: action.execution.last_error.message
      });

      context.res = {
        status: 502,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Execution failed',
          details: action.execution.last_error
        })
      };
      return;
    }

    // ── SUCCESS ──
    action.execution.status = 'success';
    action.execution.finished_at = new Date().toISOString();
    action.execution.receipt = result.receipt || null;
    action.execution.last_error = null;
    action.execution_status = 'success';

    if (isSocialAction) {
      const startMs = action.execution.started_at ? new Date(action.execution.started_at).getTime() : Date.now();
      const finishMs = action.execution.finished_at ? new Date(action.execution.finished_at).getTime() : Date.now();
      const latency = Math.max(0, finishMs - startMs);
      const successEvent = socialTelemetry.buildSocialTelemetryEvent(action, {
        event_type: 'execution',
        result: 'success',
        trace_id: action.telemetry.trace_id,
        attempt: action.telemetry.attempt || action.execution.attempts || 1,
        created_at: action.execution.started_at || new Date().toISOString(),
        executed_at: action.execution.finished_at,
        latency_ms: latency,
        post_url: (result.receipt && result.receipt.post_url) || '',
        agent_id: action.created_by || ''
      });
      await socialTelemetry.appendSocialMetricEvent(successEvent);
    }

    actions[actionIndex] = action;
    await storage.setState('actions', actions);

    // Auto-complete parent task when social post publishes successfully
    if (action._parentTaskId && actionType.indexOf('social_post') === 0) {
      try {
        const tasks = (await storage.getState('tasks')) || [];
        const parentTask = tasks.find(t => t.id === action._parentTaskId);
        if (parentTask && parentTask.status !== 'done') {
          parentTask.status = 'done';
          parentTask.completedAt = new Date().toISOString();
          parentTask.updatedAt = new Date().toISOString();
          if (!parentTask.comments) parentTask.comments = [];
          parentTask.comments.push({
            id: 'cmt-autoclose-' + Date.now(),
            author: 'system',
            text: 'Task auto-completed: social post published successfully on ' + platform + '. Post URL: ' + ((result.receipt && result.receipt.post_url) || 'N/A'),
            type: 'system',
            createdAt: new Date().toISOString()
          });
          await storage.setState('tasks', tasks);
          context.log('[actionsExecute] Auto-completed parent task:', action._parentTaskId, 'after successful', platform, 'post');
        }
      } catch (taskErr) {
        context.log.warn('[actionsExecute] Failed to auto-complete parent task:', taskErr.message);
      }
    }

    // Log success to governance
    await _logGovernance(storage, 'action-success', {
      actionId: action.id,
      type: actionType,
      platform: platform,
      post_url: (result.receipt && result.receipt.post_url) || null
    });

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        action_id: action.id,
        execution: action.execution
      })
    };

  } catch (err) {
    context.log.error('[actionsExecute] Unexpected error:', err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

// Append to governance log in storage
async function _logGovernance(storage, type, data) {
  try {
    const govLog = (await storage.getState('governanceLog')) || [];
    govLog.push({
      id: 'gov-' + Date.now(),
      type: type,
      data: data,
      timestamp: new Date().toISOString()
    });
    // Cap at 500
    const trimmed = govLog.length > 500 ? govLog.slice(-500) : govLog;
    await storage.setState('governanceLog', trimmed);
  } catch (e) {
    // Non-fatal: don't block execution for logging failures
  }
}
