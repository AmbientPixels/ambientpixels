/**
 * CHANGE SUMMARY
 * - New file: Azure Function for GridOS Form Intake Daily Digest v1.3
 * - GET /api/formIntakeDigest?date=YYYY-MM-DD — on-demand digest generator
 *   Reads daily index, computes stats, selects notable items (redacted),
 *   creates a Nova digest task, appends redacted L4 runtime memory entry.
 * - Redaction: email → domain only, names → first name, no message bodies,
 *   no phone numbers.
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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
  };
}

// ══════════════════════════════════════════════════════
// ── Redaction Helpers ──
// ══════════════════════════════════════════════════════

/**
 * Redact email to domain only: "jane@acme.com" => "@acme.com"
 */
function _redactEmail(email) {
  if (!email || typeof email !== 'string') return '';
  var at = email.indexOf('@');
  if (at === -1) return '***';
  return '@' + email.substring(at + 1).toLowerCase();
}

/**
 * Redact name to first name only.
 */
function _redactName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().split(/\s+/)[0];
}

/**
 * Strip phone numbers from text (basic patterns).
 */
function _stripPhones(text) {
  if (!text) return '';
  return text.replace(/(\+?\d[\d\-\.\s\(\)]{7,}\d)/g, '[PHONE REDACTED]');
}

/**
 * Summarize a message subject/body into a short 1-line intent (max ~60 chars).
 * Never returns the verbatim body.
 */
function _summarizeIntent(item, canonical) {
  var subject = '';
  var body = '';

  if (canonical && canonical.message) {
    subject = canonical.message.subject || '';
    body = canonical.message.body || '';
  } else if (item.name) {
    // Index-only fallback: no message available
    return item.type === 'demo' ? 'Demo request' : 'Contact inquiry';
  }

  if (subject) {
    var clean = _stripPhones(subject).substring(0, 60);
    return clean || (item.type === 'demo' ? 'Demo request' : 'Contact inquiry');
  }

  if (body && body.length > 10) {
    // Extract first sentence-like chunk, redact phones
    var first = _stripPhones(body).split(/[.\n!?]/)[0].trim();
    if (first.length > 60) first = first.substring(0, 57) + '...';
    return first || (item.type === 'demo' ? 'Demo request' : 'Contact inquiry');
  }

  return item.type === 'demo' ? 'Demo request' : 'Contact inquiry';
}

// ══════════════════════════════════════════════════════
// ── Blob Key Helpers (mirror formIntake/index.js) ──
// ══════════════════════════════════════════════════════

function _indexKey(dateStr) {
  return 'formIntake-index-' + dateStr;
}

function _canonicalKey(id) {
  var month = id.substring(3, 10);
  return 'formIntake-' + month + '-' + id;
}

async function _readIndex(dateStr) {
  return (await storage.getState(_indexKey(dateStr))) || [];
}

async function _readCanonical(id) {
  return await storage.getState(_canonicalKey(id));
}

// ══════════════════════════════════════════════════════
// ── Digest Computation ──
// ══════════════════════════════════════════════════════

/**
 * Build a digest object from the daily index entries.
 * Fetches canonical records only for top notable candidates (capped at 10).
 */
async function _buildDigest(dateStr, entries) {
  var stats = {
    total: entries.length,
    byType: { contact: 0, demo: 0, newsletter: 0, other: 0 },
    uniqueTasks: 0,
    duplicates: 0,
    filtered: 0
  };

  var seenTaskIds = {};
  var candidates = []; // For notable item selection

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];

    // Count by type
    if (stats.byType.hasOwnProperty(e.type)) {
      stats.byType[e.type]++;
    } else {
      stats.byType.other++;
    }

    // Unique tasks
    if (e.taskId && !seenTaskIds[e.taskId]) {
      seenTaskIds[e.taskId] = true;
      stats.uniqueTasks++;
    }

    // Duplicates
    if (e.status === 'duplicate' || e.duplicateOf) {
      stats.duplicates++;
    }

    // Filtered (spam)
    if (e.spamFlags && e.spamFlags.length > 0) {
      stats.filtered++;
    }

    // Candidate for notable: non-duplicate, demo or contact
    if (e.status !== 'duplicate' && !e.duplicateOf &&
        (!e.spamFlags || e.spamFlags.length === 0) &&
        (e.type === 'demo' || e.type === 'contact')) {
      candidates.push(e);
    }
  }

  // Sort candidates: demo first, then by receivedAt newest
  candidates.sort(function (a, b) {
    if (a.type === 'demo' && b.type !== 'demo') return -1;
    if (a.type !== 'demo' && b.type === 'demo') return 1;
    return (b.receivedAt || '').localeCompare(a.receivedAt || '');
  });

  // Take top candidates (cap canonical fetches at 10, pick 3 notables)
  var fetchLimit = Math.min(candidates.length, 10);
  var notables = [];

  for (var j = 0; j < fetchLimit && notables.length < 3; j++) {
    var cand = candidates[j];
    var canonical = null;
    try {
      canonical = await _readCanonical(cand.id);
    } catch (err) {
      // Non-fatal: skip this candidate
    }

    var intentSummary = _summarizeIntent(cand, canonical);
    var emailDomain = _redactEmail(cand.email || (canonical && canonical.contact ? canonical.contact.email : ''));
    var firstName = _redactName(cand.name || (canonical && canonical.contact ? canonical.contact.name : ''));
    var sourcePath = cand.pageUrl || '';
    if (sourcePath.length > 60) sourcePath = sourcePath.substring(0, 57) + '...';

    notables.push({
      type: cand.type,
      name: firstName,
      emailDomain: emailDomain,
      sourcePath: sourcePath,
      taskId: cand.taskId,
      draftTaskId: cand.draftTaskId || null,
      intent: intentSummary
    });
  }

  return { date: dateStr, stats: stats, notables: notables };
}

// ══════════════════════════════════════════════════════
// ── Action Suggestions ──
// ══════════════════════════════════════════════════════

function _generateActionSuggestions(digest) {
  var actions = [];

  // Demo follow-ups
  var demos = digest.notables.filter(function (n) { return n.type === 'demo'; });
  if (demos.length > 0) {
    var d = demos[0];
    actions.push('Review demo request from ' + (d.name || 'prospect') + ' (' + d.emailDomain + '); confirm timeline and schedule walkthrough.');
  }

  // Contact follow-ups
  var contacts = digest.notables.filter(function (n) { return n.type === 'contact'; });
  if (contacts.length > 0) {
    var c = contacts[0];
    actions.push('Follow up on contact inquiry from ' + (c.name || 'visitor') + ' (' + c.emailDomain + '); check Echo draft reply.');
  }

  // Volume-based
  if (digest.stats.duplicates > 2) {
    actions.push('High duplicate volume (' + digest.stats.duplicates + ') — review spam patterns or user experience friction.');
  }

  if (digest.stats.filtered > 0) {
    actions.push('Review ' + digest.stats.filtered + ' filtered submission(s) for false positives.');
  }

  // Fallback
  if (actions.length === 0) {
    if (digest.stats.total === 0) {
      actions.push('No inbound submissions today. Consider reviewing outreach or channel visibility.');
    } else {
      actions.push('All submissions processed. Verify Echo draft replies are ready for review.');
    }
  }

  // Cap at 3
  return actions.slice(0, 3);
}

// ══════════════════════════════════════════════════════
// ── Nova Digest Task ──
// ══════════════════════════════════════════════════════

async function _createDigestTask(digest) {
  var s = digest.stats;
  var datePretty = digest.date;

  var descParts = [
    '## Inbound Intake Digest — ' + datePretty,
    '',
    '### Summary',
    '- **Total submissions:** ' + s.total,
    '- **Contact:** ' + s.byType.contact + ' · **Demo:** ' + s.byType.demo + ' · **Newsletter:** ' + s.byType.newsletter + (s.byType.other > 0 ? (' · **Other:** ' + s.byType.other) : ''),
    '- **Unique tasks spawned:** ' + s.uniqueTasks,
    '- **Duplicates suppressed:** ' + s.duplicates,
    '- **Spam filtered:** ' + s.filtered,
    ''
  ];

  // Notables
  if (digest.notables.length > 0) {
    descParts.push('### Notable Items');
    for (var i = 0; i < digest.notables.length; i++) {
      var n = digest.notables[i];
      var line = (i + 1) + '. **' + n.type.charAt(0).toUpperCase() + n.type.slice(1) + '** — '
        + (n.name || 'Anonymous') + ' (' + n.emailDomain + ')';
      if (n.sourcePath) line += ' · Source: ' + n.sourcePath;
      if (n.taskId) line += ' · [Task: ' + n.taskId.substring(0, 16) + ']';
      if (n.draftTaskId) line += ' · [Draft: ' + n.draftTaskId.substring(0, 16) + ']';
      line += '\n   _Intent:_ ' + n.intent;
      descParts.push(line);
    }
    descParts.push('');
  }

  // Action suggestions
  var actions = _generateActionSuggestions(digest);
  descParts.push('### Suggested Actions');
  for (var a = 0; a < actions.length; a++) {
    descParts.push('- ' + actions[a]);
  }
  descParts.push('');
  descParts.push('_PII redacted in digest; see Inbound for full records._');

  var task = {
    id: 'task-' + Date.now() + '-digest-' + Math.random().toString(36).substring(2, 6),
    title: 'Daily Intake Digest — ' + datePretty,
    description: descParts.join('\n'),
    assignee: 'nova',
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
    origin: 'form_intake_digest',
    badge: '🧾 Intake Digest',
    sourceType: 'digest',
    sourceId: 'digest-' + datePretty,
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
    console.error('[formIntakeDigest] Task creation failed:', err.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════
// ── L4 Runtime Memory Entry ──
// ══════════════════════════════════════════════════════

/**
 * Append a redacted digest summary to the L4 runtime memory blob.
 * Key: "intake_digest_<date>"
 */
async function _appendRuntimeMemory(digest) {
  try {
    var runtimeMemory = (await storage.getState('runtimeMemory')) || {};

    var memKey = 'intake_digest_' + digest.date;

    var notableSummaries = digest.notables.map(function (n) {
      return n.type + ' from ' + (n.name || 'anon') + ' ' + n.emailDomain + ': ' + n.intent;
    });

    runtimeMemory[memKey] = {
      date: digest.date,
      createdAt: new Date().toISOString(),
      totalSubmissions: digest.stats.total,
      byType: digest.stats.byType,
      uniqueTasks: digest.stats.uniqueTasks,
      duplicates: digest.stats.duplicates,
      filtered: digest.stats.filtered,
      notables: notableSummaries,
      actions: _generateActionSuggestions(digest),
      _redacted: true,
      _source: 'form_intake_digest'
    };

    await storage.setState('runtimeMemory', runtimeMemory);
    return memKey;
  } catch (err) {
    console.error('[formIntakeDigest] Runtime memory write failed:', err.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════
// ── Idempotency Guard ──
// ══════════════════════════════════════════════════════

/**
 * Check if a digest task already exists for this date (prevent duplicates).
 */
async function _digestTaskExists(dateStr) {
  try {
    var tasks = (await storage.getState('tasks')) || [];
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].origin === 'form_intake_digest' &&
          tasks[i].sourceId === 'digest-' + dateStr) {
        return tasks[i].id;
      }
    }
  } catch (err) {
    // Non-fatal
  }
  return null;
}

/**
 * Append a regeneration comment to an existing digest task with fresh stats.
 * Returns true on success.
 */
async function _appendDigestRegenComment(taskId, digest) {
  try {
    var s = digest.stats;
    var comment = [
      '[REGENERATED] Digest regenerated at ' + new Date().toISOString(),
      'Updated stats — Total: ' + s.total + ', Contact: ' + s.byType.contact + ', Demo: ' + s.byType.demo + ', Newsletter: ' + s.byType.newsletter,
      'Tasks: ' + s.uniqueTasks + ', Duplicates: ' + s.duplicates + ', Filtered: ' + s.filtered
    ];
    if (digest.notables.length > 0) {
      comment.push('Notables: ' + digest.notables.map(function (n) {
        return n.type + ' ' + (n.name || 'anon') + ' ' + n.emailDomain;
      }).join('; '));
    }
    var tasks = (await storage.getState('tasks')) || [];
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === taskId) {
        if (!Array.isArray(tasks[i].comments)) tasks[i].comments = [];
        tasks[i].comments.push({
          id: 'cmt-regen-' + Date.now(),
          author: 'system',
          text: comment.join('\n'),
          createdAt: new Date().toISOString()
        });
        await storage.setState('tasks', tasks);
        return true;
      }
    }
  } catch (err) {
    console.error('[formIntakeDigest] Regen comment failed:', err.message);
  }
  return false;
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

  // ── GET /api/formIntakeDigest?date=YYYY-MM-DD ──
  if (req.method === 'GET') {
    try {
      // Resolve date: param or yesterday (server time)
      var dateStr = (req.query && req.query.date) || '';
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        var yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        dateStr = yesterday.toISOString().substring(0, 10);
      }

      context.log('[formIntakeDigest] Generating digest for date:', dateStr);

      // Idempotency: check if digest already created
      var force = (req.query && req.query.force === 'true');
      var existingTaskId = await _digestTaskExists(dateStr);
      if (existingTaskId && !force) {
        context.res = {
          status: 200,
          headers: headers,
          body: {
            ok: true,
            alreadyExists: true,
            date: dateStr,
            taskId: existingTaskId,
            message: 'Digest already created for ' + dateStr + '. Use ?force=true to regenerate.'
          }
        };
        return;
      }

      // Read daily index
      var entries = await _readIndex(dateStr);

      // Build digest
      var digest = await _buildDigest(dateStr, entries);

      var taskId;
      if (existingTaskId && force) {
        // Force regeneration: update existing task with comment, reuse ID
        await _appendDigestRegenComment(existingTaskId, digest);
        taskId = existingTaskId;
        context.log('[formIntakeDigest] Regenerated — appended comment to existing task:', taskId);
      } else {
        // First digest for this date: create new task
        taskId = await _createDigestTask(digest);
      }

      // Upsert L4 runtime memory (keyed by date, overwrites on regen)
      var memKey = await _appendRuntimeMemory(digest);

      context.log('[formIntakeDigest] Digest created — date:', dateStr,
        'total:', digest.stats.total, 'taskId:', taskId || 'failed',
        'memKey:', memKey || 'failed');

      context.res = {
        status: 200,
        headers: headers,
        body: {
          ok: true,
          date: dateStr,
          stats: digest.stats,
          notables: digest.notables,
          taskId: taskId,
          memoryKey: memKey,
          alreadyExists: false
        }
      };
    } catch (err) {
      context.log.error('[formIntakeDigest] Error:', err.message, err.stack);
      context.res = { status: 500, headers: headers, body: { ok: false, error: 'internal_error' } };
    }
    return;
  }

  context.res = { status: 405, headers: headers, body: { ok: false, error: 'method_not_allowed' } };
};
