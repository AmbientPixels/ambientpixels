/**
 * CHANGE SUMMARY
 * - New file: Azure Function for GridOS Form Intake v1
 * - POST /api/formIntake — write endpoint: validate, spam gates, blob storage, task spawning
 * - GET  /api/formIntake/recent — read recent submissions from daily index blobs
 * - GET  /api/formIntake/item   — read single canonical record by id
 * - CORS: origin allowlist (ambientpixels.ai + localhost dev)
 * - Anti-spam: honeypot, min-time-to-submit, IP rate limiting via blob counters
 * - Storage: canonical JSON per submission + daily JSON index
 * - Task spawning: contact/demo types create GridOS tasks; newsletter = store-only
 * - v1.1: Duplicate suppression — dedupe index blob per email+type key,
 *   60-min rolling window, always stores record but skips task if duplicate,
 *   appends comment to existing task on duplicate detection
 * - v1.2: Echo auto-draft replies — template-based reply drafts for new
 *   inbound tasks (contact/demo), created as child tasks assigned to Echo,
 *   skipped for duplicates and newsletters
 * - v1.5: Inbound status sync — computedStatus added to GET /recent response,
 *   derived from task state at read-time (stored_only, task_created, draft_ready,
 *   closed, duplicate). Batch task lookup for efficiency.
 * - v1.6: Replied loop closure — computedStatus 'replied' added (priority above
 *   closed), derived from task.repliedAt field set by POST /api/tasks/mark-replied.
 * - v1.7: Inbound timeline + deep links — lifecycle timestamps and deep link URLs
 *   added to GET /recent items. Draft tasks also batch-fetched for draftCreatedAt.
 */

const crypto = require('crypto');
const storage = require('../_utils/companyStorage');

// ══════════════════════════════════════════════════════
// ── CORS ──
// ══════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://ambientpixels.ai',
  'https://www.ambientpixels.ai'
];

function _isAllowedOrigin(origin) {
  if (!origin) return true; // no origin = same-origin or non-browser
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

function _isLocalOrigin(origin) {
  if (!origin) return false;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function _corsHeaders(origin) {
  var matched = _isAllowedOrigin(origin) ? (origin || ALLOWED_ORIGINS[0]) : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': matched,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
  };
}

// ══════════════════════════════════════════════════════
// ── Validation + Normalization ──
// ══════════════════════════════════════════════════════

var VALID_TYPES = ['contact', 'demo', 'newsletter'];
var LIMITS = { name: 120, email: 200, company: 200, role: 200, subject: 200, body: 8000 };
var MAX_BODY_BYTES = 32 * 1024;

function _trunc(str, max) {
  if (!str || typeof str !== 'string') return '';
  return str.substring(0, max).trim();
}

function _validatePayload(body) {
  var errors = [];
  if (!body || typeof body !== 'object') return { valid: false, errors: ['Invalid request body'] };
  if (!body.type || VALID_TYPES.indexOf(body.type) === -1) errors.push('type required: contact|demo|newsletter');
  if (!body.pageUrl || typeof body.pageUrl !== 'string') errors.push('pageUrl required');
  if (!body.contact || !body.contact.email || typeof body.contact.email !== 'string') errors.push('contact.email required');
  if (body.contact && body.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contact.email)) errors.push('contact.email invalid');
  if (body.type !== 'newsletter') {
    if (!body.consent || !body.consent.privacyAccepted) errors.push('consent.privacyAccepted required');
  }
  return { valid: errors.length === 0, errors: errors };
}

function _normalizePayload(body) {
  return {
    type: body.type,
    pageUrl: _trunc(body.pageUrl, 2000),
    referrer: _trunc(body.referrer, 2000),
    utm: (body.utm && typeof body.utm === 'object') ? {
      source: _trunc(body.utm.source, 200),
      medium: _trunc(body.utm.medium, 200),
      campaign: _trunc(body.utm.campaign, 200),
      content: _trunc(body.utm.content, 200),
      term: _trunc(body.utm.term, 200)
    } : null,
    contact: (body.contact && typeof body.contact === 'object') ? {
      name: _trunc(body.contact.name, LIMITS.name),
      email: _trunc(body.contact.email, LIMITS.email),
      company: _trunc(body.contact.company, LIMITS.company),
      role: _trunc(body.contact.role, LIMITS.role)
    } : null,
    message: (body.message && typeof body.message === 'object') ? {
      subject: _trunc(body.message.subject, LIMITS.subject),
      body: _trunc(body.message.body, LIMITS.body)
    } : null,
    consent: (body.consent && typeof body.consent === 'object') ? {
      privacyAccepted: !!body.consent.privacyAccepted,
      newsletterOptIn: !!body.consent.newsletterOptIn
    } : { privacyAccepted: false, newsletterOptIn: false },
    hp: typeof body.hp === 'string' ? body.hp : '',
    form_started_at_ms: typeof body.form_started_at_ms === 'number' ? body.form_started_at_ms : null
  };
}

// ══════════════════════════════════════════════════════
// ── Anti-spam ──
// ══════════════════════════════════════════════════════

var FORM_INTAKE_SALT = process.env.FORM_INTAKE_SALT || 'gridos-intake-v1-default';
var RATE_LIMIT_MAX = 10;
var RATE_LIMIT_WINDOW_MIN = 15;
var MIN_SUBMIT_MS = 2500;

function _hashIp(ip) {
  return crypto.createHash('sha256').update((ip || 'unknown') + FORM_INTAKE_SALT).digest('hex').substring(0, 16);
}

function _rateBucketKey(ipHash) {
  var bucket = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_MIN * 60 * 1000));
  return 'formIntake-ratelimit-' + ipHash + '-' + bucket;
}

async function _checkRateLimit(ipHash) {
  try {
    var count = await storage.getState(_rateBucketKey(ipHash));
    return (count && typeof count === 'number') ? count : 0;
  } catch (e) { return 0; }
}

async function _incrementRateLimit(ipHash) {
  try {
    var key = _rateBucketKey(ipHash);
    var current = (await storage.getState(key)) || 0;
    await storage.setState(key, current + 1);
  } catch (err) {
    console.error('[formIntake] Rate limit increment failed:', err.message);
  }
}

// ══════════════════════════════════════════════════════
// ── Dedupe ──
// ══════════════════════════════════════════════════════

var DEDUPE_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

function _dedupeHash(email, type) {
  var key = (email || '').toLowerCase().trim() + '|' + (type || '');
  return crypto.createHash('sha256').update(key).digest('hex').substring(0, 20);
}

function _dedupeKey(hash) {
  return 'formIntake-dedupe-' + hash;
}

async function _readDedupe(hash) {
  try {
    return await storage.getState(_dedupeKey(hash));
  } catch (e) { return null; }
}

async function _writeDedupe(hash, doc) {
  try {
    await storage.setState(_dedupeKey(hash), doc);
  } catch (err) {
    console.error('[formIntake] Dedupe write failed:', err.message);
  }
}

/**
 * Check if a submission is a duplicate.
 * Returns { isDuplicate, existingSubmissionId, existingTaskId } or { isDuplicate: false }.
 */
async function _checkDedupe(email, type) {
  var hash = _dedupeHash(email, type);
  var doc = await _readDedupe(hash);
  if (!doc || !doc.lastReceivedAt || !doc.lastTaskId) {
    return { isDuplicate: false, hash: hash, doc: doc };
  }
  var elapsed = Date.now() - new Date(doc.lastReceivedAt).getTime();
  if (elapsed < DEDUPE_WINDOW_MS) {
    return {
      isDuplicate: true,
      hash: hash,
      doc: doc,
      existingSubmissionId: doc.lastSubmissionId,
      existingTaskId: doc.lastTaskId
    };
  }
  return { isDuplicate: false, hash: hash, doc: doc };
}

/**
 * Append a comment to an existing task (best-effort, non-fatal).
 */
async function _appendTaskComment(taskId, comment) {
  try {
    var tasks = (await storage.getState('tasks')) || [];
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === taskId) {
        if (!Array.isArray(tasks[i].comments)) tasks[i].comments = [];
        tasks[i].comments.push({
          id: 'cmt-' + Date.now(),
          author: 'system',
          text: comment,
          createdAt: new Date().toISOString()
        });
        await storage.setState('tasks', tasks);
        return true;
      }
    }
  } catch (err) {
    console.error('[formIntake] Task comment append failed:', err.message);
  }
  return false;
}

// ══════════════════════════════════════════════════════
// ── ID Generation ──
// ══════════════════════════════════════════════════════

function _generateId() {
  var now = new Date();
  var dateStr = now.toISOString().substring(0, 10); // YYYY-MM-DD
  var rand = Math.random().toString(36).substring(2, 9); // 7 chars
  return 'fi_' + dateStr + '_' + rand;
}

// ══════════════════════════════════════════════════════
// ── Blob Storage Helpers ──
// ══════════════════════════════════════════════════════

function _canonicalKey(id) {
  // formIntake/2026-02/fi_2026-02-23_abc1234
  var month = id.substring(3, 10); // YYYY-MM from fi_YYYY-MM-DD_xxx
  return 'formIntake-' + month + '-' + id;
}

function _indexKey(dateStr) {
  // formIntake-index-2026-02-23
  return 'formIntake-index-' + dateStr;
}

async function _storeCanonical(record) {
  await storage.setState(_canonicalKey(record.id), record);
}

async function _appendIndex(dateStr, indexEntry) {
  var key = _indexKey(dateStr);
  var existing = (await storage.getState(key)) || [];
  existing.push(indexEntry);
  // Cap at 500 per day
  if (existing.length > 500) existing = existing.slice(-500);
  await storage.setState(key, existing);
}

async function _readIndex(dateStr) {
  return (await storage.getState(_indexKey(dateStr))) || [];
}

async function _readCanonical(id) {
  return await storage.getState(_canonicalKey(id));
}

// ══════════════════════════════════════════════════════
// ── Task Spawning ──
// ══════════════════════════════════════════════════════

async function _spawnTask(record) {
  if (record.type === 'newsletter') return null;

  var nameOrEmail = (record.contact && record.contact.name) ? record.contact.name : (record.contact ? record.contact.email : 'Unknown');
  var typeLabel = record.type.charAt(0).toUpperCase() + record.type.slice(1);

  var descParts = [
    '**Source:** Form Intake — ' + typeLabel,
    '**ID:** ' + record.id,
    '**Received:** ' + record.receivedAt,
    '**Page:** ' + (record.pageUrl || 'N/A')
  ];
  if (record.referrer) descParts.push('**Referrer:** ' + record.referrer);
  if (record.utm && record.utm.source) {
    descParts.push('**UTM:** ' + [record.utm.source, record.utm.medium, record.utm.campaign].filter(Boolean).join(' / '));
  }
  if (record.contact) {
    descParts.push('**Contact:** ' + [record.contact.name, record.contact.email, record.contact.company, record.contact.role].filter(Boolean).join(' · '));
  }
  if (record.message) {
    if (record.message.subject) descParts.push('**Subject:** ' + record.message.subject);
    if (record.message.body) descParts.push('**Message:**\n' + record.message.body);
  }

  var priority = record.type === 'demo' ? 'medium' : 'low';
  var assignee = record.type === 'demo' ? 'scout' : 'nova';

  var task = {
    id: 'task-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
    title: 'Inbound: ' + typeLabel + ' — ' + nameOrEmail,
    description: descParts.join('\n'),
    assignee: assignee,
    status: 'open',
    priority: priority,
    classification: 'advisory',
    risk_level: 'low',
    budget_impact: 'none',
    brand_impact: 'low',
    requires_ceo_approval: false,
    escalated: false,
    directive_id: null,
    objective_id: null,
    origin: 'form_intake',
    badge: '🌐 Form Intake',
    sourceType: record.type,
    sourceId: record.id,
    comments: [],
    createdAt: new Date().toISOString()
  };

  try {
    var tasks = (await storage.getState('tasks')) || [];
    tasks.push(task);
    if (tasks.length > 500) tasks.splice(0, tasks.length - 500);
    await storage.setState('tasks', tasks);
    return task.id;
  } catch (err) {
    console.error('[formIntake] Task creation failed:', err.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════
// ── Echo Auto-Draft Reply ──
// ══════════════════════════════════════════════════════

/**
 * Generate a template-based draft reply for an inbound submission.
 * Returns plain-text email-style body suitable for copy/paste.
 * Kept under ~160 words, professional, brand-level signature.
 */
function _generateDraftReply(record) {
  var name = (record.contact && record.contact.name) ? record.contact.name.split(' ')[0] : '';
  var greeting = name ? ('Hi ' + name + ',') : 'Hello,';
  var hasSubject = record.message && record.message.subject;
  var hasBody = record.message && record.message.body && record.message.body.length > 10;

  if (record.type === 'demo') {
    var lines = [
      greeting,
      '',
      'Thank you for your interest in working with AmbientPixels. We appreciate you reaching out' + (hasSubject ? (' regarding ' + record.message.subject) : '') + '.',
      '',
      'To help us prepare the best overview for you, it would be great to learn a bit more:',
      '- What problem or workflow are you looking to improve?',
      '- Do you have a timeline or launch window in mind?',
      '',
      'In the meantime, you can explore our project portfolio at https://ambientpixels.ai/projects/ to see examples of what we build.',
      '',
      'We\'ll follow up within two business days to schedule a walkthrough.',
      '',
      '— AmbientPixels / GridOS'
    ];
    return lines.join('\n');
  }

  // Default: contact
  var lines = [
    greeting,
    '',
    'Thank you for reaching out to AmbientPixels.' + (hasSubject ? (' We received your message regarding ' + record.message.subject + '.') : ' We received your message and appreciate you getting in touch.'),
    ''
  ];

  if (hasBody) {
    lines.push('We\'ve reviewed the details you shared and have a couple of quick questions to make sure we point you in the right direction:');
  } else {
    lines.push('To help us assist you effectively, could you share a bit more about:');
  }

  lines.push('- What\'s the primary goal or challenge you\'re looking to address?');
  lines.push('- Is there a particular timeline or urgency?');
  lines.push('');
  lines.push('We typically respond within two business days. If this is urgent, please note that in your reply and we\'ll prioritize accordingly.');
  lines.push('');
  lines.push('— AmbientPixels / GridOS');

  return lines.join('\n');
}

/**
 * Create a draft-reply child task assigned to Echo.
 * Returns the child task ID, or null on failure.
 * Non-fatal — intake proceeds regardless.
 */
async function _createReplyDraft(parentTaskId, parentTitle, record) {
  try {
    var draftBody = _generateDraftReply(record);
    var typeLabel = record.type.charAt(0).toUpperCase() + record.type.slice(1);

    var childTask = {
      id: 'task-' + Date.now() + '-draft-' + Math.random().toString(36).substring(2, 6),
      title: 'Draft reply — ' + parentTitle,
      description: [
        '[AUTO_DRAFT_REPLY]',
        'Submission ID: ' + record.id,
        'Type: ' + typeLabel,
        'Parent Task: ' + parentTaskId,
        '',
        '───── DRAFT REPLY ─────',
        '',
        draftBody,
        '',
        '───── END DRAFT ─────',
        '',
        'Review and send manually via email or direct message.',
        'Do NOT auto-send — this is a draft for CEO review.'
      ].join('\n'),
      assignee: 'echo',
      status: 'open',
      priority: 'low',
      classification: 'autonomous',
      risk_level: 'low',
      budget_impact: 'none',
      brand_impact: 'low',
      requires_ceo_approval: false,
      escalated: false,
      directive_id: null,
      objective_id: null,
      origin: 'form_intake_auto_draft',
      badge: '✉️ Draft Reply',
      sourceType: record.type,
      sourceId: record.id,
      parentTaskId: parentTaskId,
      comments: [],
      createdAt: new Date().toISOString()
    };

    var tasks = (await storage.getState('tasks')) || [];
    tasks.push(childTask);
    if (tasks.length > 500) tasks.splice(0, tasks.length - 500);
    await storage.setState('tasks', tasks);
    return childTask.id;
  } catch (err) {
    console.error('[formIntake] Draft reply creation failed:', err.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════
// ── Parse body (JSON or URL-encoded) ──
// ══════════════════════════════════════════════════════

function _parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { /* fall through */ }
    // Try URL-encoded
    try {
      var params = {};
      req.body.split('&').forEach(function (pair) {
        var parts = pair.split('=');
        if (parts.length === 2) params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1].replace(/\+/g, ' '));
      });
      return params;
    } catch (e) { return null; }
  }
  return null;
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

  var action = (req.params && req.params.action) || '';

  // ══════════════════════════════════════════════════
  // ── GET /api/formIntake/recent ──
  // ══════════════════════════════════════════════════
  if (req.method === 'GET' && action === 'recent') {
    try {
      var days = parseInt(req.query && req.query.days) || 7;
      var limit = parseInt(req.query && req.query.limit) || 50;
      if (days > 30) days = 30;
      if (limit > 200) limit = 200;

      var results = [];
      var now = new Date();
      for (var d = 0; d < days; d++) {
        var date = new Date(now);
        date.setDate(date.getDate() - d);
        var dateStr = date.toISOString().substring(0, 10);
        var dayEntries = await _readIndex(dateStr);
        for (var i = 0; i < dayEntries.length; i++) {
          var entry = dayEntries[i];
          // Redact ipHash from output
          if (entry.ipHash) delete entry.ipHash;
          results.push(entry);
        }
      }

      // Sort newest first
      results.sort(function (a, b) {
        return (b.receivedAt || '').localeCompare(a.receivedAt || '');
      });

      // Apply limit
      if (results.length > limit) results = results.slice(0, limit);

      // ── Compute lifecycle status from task state ──
      try {
        var taskIdSet = {};
        for (var ti = 0; ti < results.length; ti++) {
          if (results[ti].taskId) taskIdSet[results[ti].taskId] = true;
          if (results[ti].draftTaskId) taskIdSet[results[ti].draftTaskId] = true;
        }
        var taskMap = {};
        var uniqueIds = Object.keys(taskIdSet);
        if (uniqueIds.length > 0) {
          var allTasks = (await storage.getState('tasks')) || [];
          for (var tt = 0; tt < allTasks.length; tt++) {
            if (taskIdSet[allTasks[tt].id]) {
              taskMap[allTasks[tt].id] = allTasks[tt];
            }
          }
        }

        for (var ci = 0; ci < results.length; ci++) {
          var r = results[ci];
          if (r.status === 'duplicate' || r.duplicateOf) {
            r.computedStatus = 'duplicate';
            r.computedStatusReason = 'duplicate record';
          } else if (!r.taskId) {
            r.computedStatus = 'stored_only';
            r.computedStatusReason = 'no task spawned';
          } else {
            var linkedTask = taskMap[r.taskId];
            if (linkedTask && linkedTask.repliedAt) {
              r.computedStatus = 'replied';
              r.computedStatusReason = 'replied ' + linkedTask.repliedAt;
            } else if (linkedTask && (linkedTask.status === 'completed' || linkedTask.status === 'done')) {
              r.computedStatus = 'closed';
              r.computedStatusReason = 'task ' + linkedTask.status;
            } else if (r.draftTaskId) {
              r.computedStatus = 'draft_ready';
              r.computedStatusReason = 'draft reply created';
            } else {
              r.computedStatus = 'task_created';
              r.computedStatusReason = 'task open';
            }
          }
        }
        // ── Lifecycle timestamps + deep links (v1.7) ──
        var TASK_BASE = '/modules/company/tasks.html?task=';
        for (var li = 0; li < results.length; li++) {
          var item = results[li];
          var inbTask = item.taskId ? taskMap[item.taskId] : null;
          var draftTask = item.draftTaskId ? taskMap[item.draftTaskId] : null;

          var closedAt = null;
          if (inbTask && (inbTask.status === 'completed' || inbTask.status === 'done')) {
            closedAt = inbTask.completedAt || inbTask.closedAt || inbTask.statusChangedAt || inbTask.lastStatusAt || null;
          }

          item.lifecycle = {
            submittedAt: item.receivedAt || null,
            taskCreatedAt: inbTask ? (inbTask.createdAt || inbTask.created_at || inbTask.created || null) : null,
            draftCreatedAt: draftTask ? (draftTask.createdAt || draftTask.created_at || draftTask.created || null) : null,
            repliedAt: inbTask ? (inbTask.repliedAt || null) : null,
            closedAt: closedAt
          };

          item.links = {
            inboundTask: item.taskId ? (TASK_BASE + item.taskId) : null,
            draftTask: item.draftTaskId ? (TASK_BASE + item.draftTaskId) : null
          };
        }
      } catch (statusErr) {
        context.log.warn('[formIntake] computedStatus enrichment failed (non-fatal):', statusErr.message);
      }

      context.res = { status: 200, headers: headers, body: { ok: true, count: results.length, items: results } };
    } catch (err) {
      context.log.error('[formIntake] GET recent error:', err.message);
      context.res = { status: 500, headers: headers, body: { ok: false, error: 'internal_error' } };
    }
    return;
  }

  // ══════════════════════════════════════════════════
  // ── GET /api/formIntake/item?id=... ──
  // ══════════════════════════════════════════════════
  if (req.method === 'GET' && action === 'item') {
    try {
      var id = (req.query && req.query.id) || '';
      if (!id || !id.startsWith('fi_')) {
        context.res = { status: 400, headers: headers, body: { ok: false, error: 'id required (fi_...)' } };
        return;
      }

      var record = await _readCanonical(id);
      if (!record) {
        context.res = { status: 404, headers: headers, body: { ok: false, error: 'not_found' } };
        return;
      }

      // Redact sensitive fields
      if (record.antiSpam && record.antiSpam.ipHash) delete record.antiSpam.ipHash;
      if (record.raw && record.raw.ip) delete record.raw.ip;

      context.res = { status: 200, headers: headers, body: { ok: true, item: record } };
    } catch (err) {
      context.log.error('[formIntake] GET item error:', err.message);
      context.res = { status: 500, headers: headers, body: { ok: false, error: 'internal_error' } };
    }
    return;
  }

  // ══════════════════════════════════════════════════
  // ── POST /api/formIntake — Write endpoint ──
  // ══════════════════════════════════════════════════
  if (req.method === 'POST' && !action) {
    try {
      // Size check
      var rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
        context.res = { status: 413, headers: headers, body: { ok: false, error: 'payload_too_large' } };
        return;
      }

      var body = _parseBody(req);
      if (!body) {
        context.res = { status: 400, headers: headers, body: { ok: false, error: 'invalid_body' } };
        return;
      }

      // Normalize nested fields from flat form-encoded
      if (body['contact.name'] || body['contact.email']) {
        body.contact = {
          name: body['contact.name'] || body.name || '',
          email: body['contact.email'] || body.email || '',
          company: body['contact.company'] || body.company || '',
          role: body['contact.role'] || body.role || ''
        };
      }
      if (!body.contact && body.email) {
        body.contact = { name: body.name || '', email: body.email, company: body.company || '', role: body.role || '' };
      }
      if (body['message.body'] || body['message.subject']) {
        body.message = { subject: body['message.subject'] || body.subject || '', body: body['message.body'] || '' };
      }
      if (!body.message && body.body) {
        body.message = { subject: body.subject || '', body: body.body };
      }
      if (body.privacyAccepted !== undefined && !body.consent) {
        body.consent = { privacyAccepted: body.privacyAccepted === 'true' || body.privacyAccepted === true, newsletterOptIn: body.newsletterOptIn === 'true' || body.newsletterOptIn === true };
      }
      if (body.form_started_at_ms && typeof body.form_started_at_ms === 'string') {
        body.form_started_at_ms = parseInt(body.form_started_at_ms) || null;
      }

      // Validate
      var validation = _validatePayload(body);
      if (!validation.valid) {
        context.res = { status: 400, headers: headers, body: { ok: false, error: 'validation_failed', details: validation.errors } };
        return;
      }

      // Normalize
      var data = _normalizePayload(body);
      var now = new Date();
      var receivedAt = now.toISOString();
      var dateStr = receivedAt.substring(0, 10);

      // ── Anti-spam checks ──
      var spamFlags = [];
      var isLocal = _isLocalOrigin(origin);

      // Honeypot
      if (data.hp && data.hp.trim().length > 0) {
        context.log('[formIntake] Honeypot triggered — silent drop');
        context.res = { status: 200, headers: headers, body: { ok: true } };
        return;
      }

      // Min time-to-submit
      if (data.form_started_at_ms && !isLocal) {
        var dt = now.getTime() - data.form_started_at_ms;
        if (dt < MIN_SUBMIT_MS) {
          spamFlags.push('too_fast_' + dt + 'ms');
          context.res = { status: 400, headers: headers, body: { ok: false, error: 'invalid_request' } };
          return;
        }
      }

      // Rate limit
      var clientIp = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || 'unknown';
      if (clientIp.indexOf(',') !== -1) clientIp = clientIp.split(',')[0].trim();
      var ipHash = _hashIp(clientIp);

      var currentCount = await _checkRateLimit(ipHash);
      if (currentCount >= RATE_LIMIT_MAX) {
        context.log('[formIntake] Rate limit exceeded for ipHash:', ipHash);
        context.res = { status: 429, headers: headers, body: { ok: false, error: 'rate_limited' } };
        return;
      }

      // ── Store ──
      var id = _generateId();

      var record = {
        id: id,
        receivedAt: receivedAt,
        type: data.type,
        pageUrl: data.pageUrl,
        referrer: data.referrer,
        utm: data.utm,
        contact: data.contact,
        message: data.message,
        consent: data.consent,
        antiSpam: {
          ipHash: ipHash,
          formStartedAtMs: data.form_started_at_ms,
          submitDeltaMs: data.form_started_at_ms ? (now.getTime() - data.form_started_at_ms) : null,
          spamFlags: spamFlags,
          origin: origin || null
        },
        taskId: null,
        raw: body
      };

      // ── Dedupe check ──
      var email = data.contact ? data.contact.email : '';
      var dedupeResult = await _checkDedupe(email, data.type);
      var taskId = null;
      var duplicateOf = null;
      var status = 'new';

      if (dedupeResult.isDuplicate) {
        // Duplicate: reuse existing task, do NOT create a new one
        taskId = dedupeResult.existingTaskId;
        duplicateOf = dedupeResult.existingSubmissionId;
        status = 'duplicate';
        context.log('[formIntake] Duplicate detected for', email, data.type, '— linked to', duplicateOf);

        // Append note to existing task
        await _appendTaskComment(taskId,
          'Duplicate submission received at ' + receivedAt + ' from ' + (data.pageUrl || 'unknown') + ' (submissionId ' + id + ').'
        );

        // Update dedupe doc (bump count, keep lastTaskId)
        await _writeDedupe(dedupeResult.hash, {
          key: email.toLowerCase().trim() + '|' + data.type,
          hash: dedupeResult.hash,
          lastSubmissionId: id,
          lastTaskId: taskId,
          lastReceivedAt: receivedAt,
          lastPageUrl: data.pageUrl,
          countInWindow: ((dedupeResult.doc && dedupeResult.doc.countInWindow) || 1) + 1
        });
      } else {
        // Not a duplicate: spawn task normally
        taskId = await _spawnTask(record);
        status = taskId ? 'task_created' : (data.type === 'newsletter' ? 'stored' : 'new');

        // Write/update dedupe doc
        await _writeDedupe(dedupeResult.hash, {
          key: email.toLowerCase().trim() + '|' + data.type,
          hash: dedupeResult.hash,
          lastSubmissionId: id,
          lastTaskId: taskId,
          lastReceivedAt: receivedAt,
          lastPageUrl: data.pageUrl,
          countInWindow: 1
        });
      }

      record.taskId = taskId;
      record.duplicateOf = duplicateOf;
      record.status = status;

      // ── Echo auto-draft reply (only for newly created tasks) ──
      var draftTaskId = null;
      if (status === 'task_created' && taskId) {
        var nameOrEmail = (data.contact && data.contact.name) ? data.contact.name : (data.contact ? data.contact.email : 'Unknown');
        var typeLabel = data.type.charAt(0).toUpperCase() + data.type.slice(1);
        var parentTitle = 'Inbound: ' + typeLabel + ' — ' + nameOrEmail;
        draftTaskId = await _createReplyDraft(taskId, parentTitle, record);
        if (draftTaskId) {
          context.log('[formIntake] Draft reply created:', draftTaskId, 'for task:', taskId);
        }
      }
      record.draftReplyCreated = !!draftTaskId;
      record.draftTaskId = draftTaskId;

      // Store canonical record
      await _storeCanonical(record);

      // Append to daily index
      var indexEntry = {
        id: id,
        receivedAt: receivedAt,
        type: data.type,
        name: data.contact ? data.contact.name : '',
        email: data.contact ? data.contact.email : '',
        pageUrl: data.pageUrl,
        utm: data.utm,
        taskId: taskId,
        duplicateOf: duplicateOf,
        status: status,
        draftTaskId: draftTaskId,
        spamFlags: spamFlags
      };
      await _appendIndex(dateStr, indexEntry);

      // Increment rate limiter
      await _incrementRateLimit(ipHash);

      context.log('[formIntake] Stored:', id, 'type:', data.type, 'status:', status, 'taskId:', taskId || 'none', 'draftTaskId:', draftTaskId || 'none');

      context.res = {
        status: 200,
        headers: headers,
        body: {
          ok: true,
          id: id,
          type: data.type,
          status: status,
          duplicateOf: duplicateOf,
          taskCreated: status === 'task_created',
          draftTaskId: draftTaskId
        }
      };
    } catch (err) {
      context.log.error('[formIntake] POST error:', err.message, err.stack);
      context.res = { status: 500, headers: headers, body: { ok: false, error: 'internal_error' } };
    }
    return;
  }

  // ── Fallback ──
  context.res = { status: 404, headers: headers, body: { ok: false, error: 'not_found' } };
};
