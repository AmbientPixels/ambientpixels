// tasksPatch — POST /api/tasksPatch
// Surgical task mutation: server-side read-modify-write of a single task by id.
// Exists because POST /api/company-state requires the full tasks array, and the
// HTTP body parser caps around ~1MB — too small for the live tasks blob.
//
// Body: { taskId, patch?, comment? }
//   - patch: object with whitelisted keys only (silently drops anything else)
//   - comment: { author, text, type? } appended to task.comments[]
// Returns: { ok: true, task } or { ok: false, error }

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

const PATCH_WHITELIST = [
  'status', 'priority', 'assignee', 'taskType',
  'dueDate', 'completedAt', '_archived',
  'objective_id', 'campaign_id',
  'title', 'description'
];

const ALLOWED_STATUSES = [
  'todo', 'in-progress', 'review', 'done', 'canceled', 'escalated', 'backlog', 'archived'
];

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  const blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = { status: 401, headers: corsHeaders, body: { ok: false, error: 'unauthorized' } };
    return;
  }

  if (req.method !== 'POST') {
    context.res = { status: 405, headers: corsHeaders, body: { ok: false, error: 'method_not_allowed' } };
    return;
  }

  try {
    const body = req.body || {};
    const taskId = body.taskId;
    const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
    const comment = body.comment && typeof body.comment === 'object' ? body.comment : null;

    if (!taskId || typeof taskId !== 'string') {
      context.res = { status: 400, headers: corsHeaders, body: { ok: false, error: 'taskId required' } };
      return;
    }

    if (patch.status && ALLOWED_STATUSES.indexOf(patch.status) === -1) {
      context.res = { status: 400, headers: corsHeaders, body: { ok: false, error: 'invalid status: ' + patch.status, allowed: ALLOWED_STATUSES } };
      return;
    }

    const tasks = (await storage.getState('tasks')) || [];
    const idx = tasks.findIndex(function (t) { return t && t.id === taskId; });
    if (idx === -1) {
      context.res = { status: 404, headers: corsHeaders, body: { ok: false, error: 'task_not_found', taskId: taskId } };
      return;
    }

    const task = tasks[idx];
    const now = new Date().toISOString();
    const applied = {};

    for (const key of PATCH_WHITELIST) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        applied[key] = patch[key];
        task[key] = patch[key];
      }
    }

    task.updatedAt = now;

    if (comment && comment.text) {
      if (!Array.isArray(task.comments)) task.comments = [];
      task.comments.push({
        id: 'cmt-patch-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        author: String(comment.author || 'system'),
        text: String(comment.text).substring(0, 2000),
        type: String(comment.type || 'system'),
        createdAt: now
      });
    }

    tasks[idx] = task;
    await storage.setState('tasks', tasks);

    context.log('[tasksPatch] Patched task', taskId, 'fields:', Object.keys(applied).join(','));

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { ok: true, taskId: taskId, applied: applied, task: task }
    };
  } catch (err) {
    context.log.error('[tasksPatch] Error:', err.message, err.stack);
    context.res = { status: 500, headers: corsHeaders, body: { ok: false, error: 'internal_error', details: err.message } };
  }
};
