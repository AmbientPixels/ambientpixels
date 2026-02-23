/**
 * CHANGE SUMMARY
 * - New file: POST /api/tasks/mark-replied v1.6
 * - Marks an inbound task as "replied" by setting repliedAt + appending
 *   [REPLY_SENT] audit comment. Idempotent: re-calls return already:true.
 * - Used by Inbound UI "Mark Replied" button for manual loop closure.
 */

const storage = require('../_utils/companyStorage');

// ══════════════════════════════════════════════════════
// ── CORS ──
// ══════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://ambientpixels.ai',
  'https://www.ambientpixels.ai'
];

function _isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

function _corsHeaders(origin) {
  var matched = _isAllowedOrigin(origin) ? (origin || ALLOWED_ORIGINS[0]) : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': matched,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
  };
}

// ══════════════════════════════════════════════════════
// ── Main Handler ──
// ══════════════════════════════════════════════════════

module.exports = async function (context, req) {
  var origin = (req.headers && req.headers.origin) || '';
  var headers = _corsHeaders(origin);

  // ── OPTIONS preflight ──
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: headers, body: '' };
    return;
  }

  // ── CORS origin check ──
  if (origin && !_isAllowedOrigin(origin)) {
    context.res = { status: 403, headers: headers, body: { ok: false, error: 'origin_not_allowed' } };
    return;
  }

  // ── POST /api/tasks/mark-replied ──
  if (req.method === 'POST') {
    try {
      var body = req.body || {};
      var taskId = body.taskId;
      var source = body.source || 'inbound';
      var submissionId = body.submissionId || null;

      if (!taskId || typeof taskId !== 'string') {
        context.res = { status: 400, headers: headers, body: { ok: false, error: 'taskId required' } };
        return;
      }

      var tasks = (await storage.getState('tasks')) || [];
      var taskIndex = -1;
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].id === taskId) {
          taskIndex = i;
          break;
        }
      }

      if (taskIndex === -1) {
        context.res = { status: 404, headers: headers, body: { ok: false, error: 'task_not_found' } };
        return;
      }

      var task = tasks[taskIndex];

      // Idempotent: already replied
      if (task.repliedAt) {
        context.log('[tasksMarkReplied] Already replied — taskId:', taskId, 'repliedAt:', task.repliedAt);
        context.res = {
          status: 200,
          headers: headers,
          body: { ok: true, already: true, repliedAt: task.repliedAt }
        };
        return;
      }

      // Set marker
      var now = new Date().toISOString();
      task.repliedAt = now;

      // Append audit comment
      if (!Array.isArray(task.comments)) task.comments = [];
      var commentText = '[REPLY_SENT] ' + now + ' via Inbound UI';
      if (submissionId) commentText += ' (submission: ' + submissionId + ')';
      task.comments.push({
        id: 'cmt-reply-' + Date.now(),
        author: 'system',
        text: commentText,
        createdAt: now
      });

      tasks[taskIndex] = task;
      await storage.setState('tasks', tasks);

      context.log('[tasksMarkReplied] Marked replied — taskId:', taskId, 'repliedAt:', now);

      context.res = {
        status: 200,
        headers: headers,
        body: { ok: true, repliedAt: now }
      };
    } catch (err) {
      context.log.error('[tasksMarkReplied] Error:', err.message, err.stack);
      context.res = { status: 500, headers: headers, body: { ok: false, error: 'internal_error' } };
    }
    return;
  }

  context.res = { status: 405, headers: headers, body: { ok: false, error: 'method_not_allowed' } };
};
