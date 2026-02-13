// actionsExecute — POST /api/actions/execute
// Executes an approved action by ID, routing to platform-specific adapters.
// Governance-gated: rejects if not approved, logs all outcomes.

const storage = require('../_utils/companyStorage');
const { executeAction, isExecutable } = require('./executors');

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

    // ── MARK RUNNING ──
    action.execution = action.execution || {};
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
      actions[actionIndex] = action;
      await storage.setState('actions', actions);

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
    actions[actionIndex] = action;
    await storage.setState('actions', actions);

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
