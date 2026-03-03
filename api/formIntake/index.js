/**
 * CHANGE SUMMARY
 * - New file: Azure Function for AmbientCore Form Intake v1
 * - POST /api/formIntake — write endpoint: validate, spam gates, blob storage, task spawning
 * - GET  /api/formIntake/recent — read recent submissions from daily index blobs
 * - GET  /api/formIntake/item   — read single canonical record by id
 * - CORS: origin allowlist (ambientpixels.ai + localhost dev)
 * - Anti-spam: honeypot, min-time-to-submit, IP rate limiting via blob counters
 * - Storage: canonical JSON per submission + daily JSON index
 * - Task spawning: contact/demo types create AmbientCore tasks; newsletter = store-only
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

var VALID_TYPES = ['contact', 'demo', 'newsletter', 'conversioncore_strategy'];
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
  var normalized = {
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

  // ConversionCore strategy — carry CC-specific metadata
  if (body.type === 'conversioncore_strategy' && body.conversioncore && typeof body.conversioncore === 'object') {
    normalized.conversioncore = {
      reportId: _trunc(body.conversioncore.reportId, 100),
      score: typeof body.conversioncore.score === 'number' ? body.conversioncore.score : null,
      siteType: _trunc(body.conversioncore.siteType, 50),
      url: _trunc(body.conversioncore.url, 2000),
      primaryGoal: _trunc(body.conversioncore.primaryGoal, 200),
      monthlyTraffic: _trunc(body.conversioncore.monthlyTraffic, 100),
      budgetRange: _trunc(body.conversioncore.budgetRange, 100),
      timeline: _trunc(body.conversioncore.timeline, 100)
    };
  }

  return normalized;
}

// ══════════════════════════════════════════════════════
// ── Anti-spam ──
// ══════════════════════════════════════════════════════

var FORM_INTAKE_SALT = process.env.FORM_INTAKE_SALT || 'ambientcore-intake-v1-default';
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

function _extractLogText(entry) {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return '';
  if (typeof entry.text === 'string') return entry.text;
  if (typeof entry.body === 'string') return entry.body;
  if (typeof entry.message === 'string') return entry.message;
  return '';
}

function _extractIsoFromReplyMarker(text) {
  if (!text || typeof text !== 'string') return null;
  var m = text.match(/\[REPLY_SENT\].*?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/);
  return m && m[1] ? m[1] : null;
}

function _taskReplyMarkerTimestamp(task) {
  if (!task || typeof task !== 'object') return null;
  var buckets = [task.comments, task.activity, task.log];
  for (var bi = 0; bi < buckets.length; bi++) {
    var arr = buckets[bi];
    if (!Array.isArray(arr)) continue;
    for (var i = arr.length - 1; i >= 0; i--) {
      var text = _extractLogText(arr[i]);
      if (text.indexOf('[REPLY_SENT]') === -1) continue;
      var parsed = _extractIsoFromReplyMarker(text);
      if (parsed) return parsed;
      if (arr[i] && typeof arr[i] === 'object') {
        if (typeof arr[i].createdAt === 'string') return arr[i].createdAt;
        if (typeof arr[i].timestamp === 'string') return arr[i].timestamp;
      }
      return null;
    }
  }
  return null;
}

function _taskHasReplyMarker(task) {
  if (!task || typeof task !== 'object') return false;
  var buckets = [task.comments, task.activity, task.log];
  for (var bi = 0; bi < buckets.length; bi++) {
    var arr = buckets[bi];
    if (!Array.isArray(arr)) continue;
    for (var i = 0; i < arr.length; i++) {
      var text = _extractLogText(arr[i]);
      if (text.indexOf('[REPLY_SENT]') !== -1) return true;
    }
  }
  return false;
}

// ══════════════════════════════════════════════════════
// ── Demo Data Generator ──
// ══════════════════════════════════════════════════════

function _generateDemoInbound() {
  var submissions = [
    { type: 'demo', name: 'Sarah Chen', email: 'sarah.chen@gmail.com', company: '', role: 'Author', subject: 'Demo request — literary fiction manuscript', body: 'Hi, I just finished my second novel (literary fiction, ~85K words) and I\'m looking for structural feedback before querying agents. Can you tell me more about the Masterpiece tier and what the scene-by-scene heat-map looks like?', page: '/pricing', utm: { source: 'google', medium: 'cpc', campaign: 'dev_editing_2026' }, status: 'draft_ready', daysAgo: 1 },
    { type: 'contact', name: 'James Whitfield', email: 'j.whitfield@penguinrandom.com', company: 'Penguin Random House', role: 'Associate Editor', subject: 'Partnership inquiry', body: 'We\'re exploring AI-assisted tools for our debut author program. Would love to schedule a call to discuss how Story Stream could complement our editorial workflow. Is there an enterprise tier?', page: '/contact', utm: null, status: 'task_created', daysAgo: 1 },
    { type: 'newsletter', name: 'Maria Lopez', email: 'mariawritesbooks@yahoo.com', company: '', role: '', subject: '', body: '', page: '/blog/more-than-grammar-check', utm: { source: 'twitter', medium: 'social', campaign: 'blog_promo' }, status: 'stored_only', daysAgo: 2 },
    { type: 'demo', name: 'David Park', email: 'dpark.author@outlook.com', company: '', role: 'Author', subject: 'Sci-fi manuscript — 120K words', body: 'I have a completed sci-fi manuscript (120K words) and I\'m worried the middle section drags. Does your pacing analysis work well for genre fiction? Also, is 120K too long for the free Blueprint tier?', page: '/pricing', utm: { source: 'reddit', medium: 'social', campaign: '' }, status: 'replied', daysAgo: 2 },
    { type: 'contact', name: 'Angela Torres', email: 'angela@writersworkshopnyc.org', company: 'Writers Workshop NYC', role: 'Program Director', subject: 'Group pricing for writing workshop', body: 'We run a 12-week fiction workshop with 20 participants each cohort. Would love to explore bulk pricing for First Edition reports as part of our curriculum. Our next cohort starts in April.', page: '/contact', utm: null, status: 'task_created', daysAgo: 3 },
    { type: 'newsletter', name: 'Tyler Brooks', email: 'tbrooks.writes@gmail.com', company: '', role: '', subject: '', body: '', page: '/', utm: { source: 'linkedin', medium: 'social', campaign: 'founder_post' }, status: 'stored_only', daysAgo: 3 },
    { type: 'demo', name: 'Priya Sharma', email: 'priya.s@mfa.columbia.edu', company: 'Columbia MFA', role: 'MFA Candidate', subject: 'Student discount?', body: 'I\'m in my second year of Columbia\'s MFA program working on a novel. A classmate recommended Story Stream. Do you offer any academic pricing? My manuscript is about 60K words (YA contemporary).', page: '/pricing', utm: { source: 'referral', medium: '', campaign: '' }, status: 'draft_ready', daysAgo: 4 },
    { type: 'contact', name: 'Robert Kim', email: 'rkim@literaryagent.com', company: 'Kim Literary Agency', role: 'Literary Agent', subject: 'Recommending to clients?', body: 'I represent mostly debut novelists and I\'m always looking for ways to help them strengthen manuscripts before submission. Could I get a sample report to evaluate whether this is something I\'d recommend to my clients?', page: '/contact', utm: { source: 'google', medium: 'organic', campaign: '' }, status: 'closed', daysAgo: 5 },
    { type: 'newsletter', name: 'Emma Davis', email: 'emma.d.writes@gmail.com', company: '', role: '', subject: '', body: '', page: '/blog/what-is-developmental-editing', utm: { source: 'google', medium: 'organic', campaign: '' }, status: 'stored_only', daysAgo: 5 },
    { type: 'demo', name: 'Michael Foster', email: 'mfoster.thriller@gmail.com', company: '', role: 'Author', subject: 'Thriller manuscript ready for feedback', body: 'Just finished draft 3 of my thriller (92K words). Beta readers say the pacing is off in act two but I can\'t figure out where. The scene heat-map sounds like exactly what I need. Going to try the Blueprint first.', page: '/', utm: { source: 'twitter', medium: 'social', campaign: 'writing_community' }, status: 'replied', daysAgo: 6 }
  ];

  var items = [];
  for (var i = 0; i < submissions.length; i++) {
    var s = submissions[i];
    var receivedDate = new Date();
    receivedDate.setDate(receivedDate.getDate() - s.daysAgo);
    receivedDate.setHours(9 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60));
    var receivedAt = receivedDate.toISOString();
    var id = 'fi_' + receivedAt.substring(0, 10) + '_demo' + (i + 1);
    var taskId = (s.type !== 'newsletter') ? ('task-demo-inbound-' + (i + 1)) : null;
    var draftTaskId = (s.status === 'draft_ready' && taskId) ? (taskId + '-draft') : null;

    items.push({
      id: id, receivedAt: receivedAt, type: s.type,
      name: s.name, email: s.email, pageUrl: s.page,
      utm: s.utm,
      taskId: taskId, draftTaskId: draftTaskId,
      duplicateOf: null, status: s.type === 'newsletter' ? 'stored' : 'task_created',
      computedStatus: s.status,
      computedStatusReason: s.status === 'stored_only' ? 'no task spawned' : s.status === 'replied' ? 'replied' : s.status === 'closed' ? 'task done' : s.status === 'draft_ready' ? 'draft reply created' : 'task open',
      lifecycle: {
        submittedAt: receivedAt,
        taskCreatedAt: taskId ? receivedAt : null,
        draftCreatedAt: draftTaskId ? receivedAt : null,
        repliedAt: s.status === 'replied' ? new Date(receivedDate.getTime() + 3600000).toISOString() : null,
        closedAt: s.status === 'closed' ? new Date(receivedDate.getTime() + 7200000).toISOString() : null
      },
      links: {
        inboundTask: taskId ? ('/modules/company/tasks.html?task=' + taskId) : null,
        draftTask: draftTaskId ? ('/modules/company/tasks.html?task=' + draftTaskId) : null
      }
    });
  }
  return items;
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
// ── Time Slot Proposal (ConversionCore strategy) ──
// ══════════════════════════════════════════════════════

/**
 * Propose N available 30-min meeting slots within the next 14 business days.
 * Reads the dates blob for conflict checking via Intl timezone America/Los_Angeles.
 * Preferred times: 10:00 AM, 1:00 PM, 3:00 PM PT.
 *
 * Conflict logic:
 * - If a dates entry has a time field, compare at slot-level (same date+hour)
 * - Otherwise, compare at day-level (skip the entire day)
 * - Limitation: day-level entries without time block the whole day
 *
 * Returns array of { label, date, hour }
 */
async function _proposeTimeSlots(count) {
  var existingEntries = [];
  try {
    var datesState = await storage.getState('dates');
    if (Array.isArray(datesState)) {
      existingEntries = datesState.map(function (d) {
        return { date: d.date || '', time: d.time || null };
      });
    }
  } catch (e) { /* non-critical — propose without conflict data */ }

  // Build conflict lookup: { "YYYY-MM-DD": [hourInt, ...] | "all" }
  var conflicts = {};
  existingEntries.forEach(function (e) {
    if (!e.date) return;
    if (e.time) {
      var h = parseInt(e.time.split(':')[0], 10);
      if (!conflicts[e.date]) conflicts[e.date] = [];
      if (Array.isArray(conflicts[e.date])) conflicts[e.date].push(h);
    } else {
      conflicts[e.date] = 'all';
    }
  });

  function isConflict(dateStr, hour) {
    var c = conflicts[dateStr];
    if (!c) return false;
    if (c === 'all') return true;
    return c.indexOf(hour) !== -1;
  }

  var ptFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  var ptParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  });

  var slots = [];
  var now = new Date();
  var preferredHours = [10, 13, 15]; // 10am, 1pm, 3pm PT

  for (var d = 1; d <= 14 && slots.length < count; d++) {
    var candidate = new Date(now.getTime() + d * 86400000);

    var parts = ptParts.formatToParts(candidate);
    var weekday = '';
    parts.forEach(function (p) { if (p.type === 'weekday') weekday = p.value; });
    if (weekday === 'Sun' || weekday === 'Sat') continue;

    var yPart = '', mPart = '', dPart = '';
    parts.forEach(function (p) {
      if (p.type === 'year') yPart = p.value;
      if (p.type === 'month') mPart = p.value;
      if (p.type === 'day') dPart = p.value;
    });
    var ptDateStr = yPart + '-' + mPart + '-' + dPart;

    if (conflicts[ptDateStr] === 'all') continue;

    var hour = preferredHours[slots.length % preferredHours.length];
    if (isConflict(ptDateStr, hour)) continue;

    var ampm = hour < 12 ? 'AM' : 'PM';
    var displayHour = hour > 12 ? hour - 12 : hour;
    var formattedDate = ptFormatter.format(candidate);

    slots.push({
      label: formattedDate + ' at ' + displayHour + ':00 ' + ampm + ' PT',
      date: ptDateStr,
      hour: hour
    });
  }
  return slots;
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

  // ConversionCore strategy — enrich description, route to Nova
  if (record.type === 'conversioncore_strategy') {
    var cc = record.conversioncore || {};
    typeLabel = 'Conversioncore Strategy';
    descParts.push('**Report ID:** ' + (cc.reportId || 'N/A'));
    descParts.push('**Score:** ' + (cc.score != null ? cc.score : 'N/A') + ' | **Site Type:** ' + (cc.siteType || 'N/A'));
    descParts.push('**Website:** ' + (cc.url || 'N/A'));
    descParts.push('**Goal:** ' + (cc.primaryGoal || 'N/A'));
    descParts.push('**Traffic:** ' + (cc.monthlyTraffic || 'N/A'));
    if (cc.budgetRange) descParts.push('**Budget:** ' + cc.budgetRange);
    if (cc.timeline) descParts.push('**Timeline:** ' + cc.timeline);
    if (record.scheduling && record.scheduling.proposedSlots && record.scheduling.proposedSlots.length > 0) {
      descParts.push('');
      descParts.push('**Proposed Meeting Slots:**');
      record.scheduling.proposedSlots.forEach(function (s, i) {
        descParts.push('  ' + (i + 1) + '. ' + s.label);
      });
    }
    assignee = 'nova';
    priority = 'medium';
  }

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
    campaign_id: null,
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

  // ConversionCore strategy — scheduling-aware draft
  if (record.type === 'conversioncore_strategy') {
    var cc = record.conversioncore || {};
    var slots = (record.scheduling && record.scheduling.proposedSlots) || [];
    var ccLines = [
      greeting,
      '',
      'Thank you for requesting a strategy session based on your ConversionCore audit' +
        (cc.score != null ? ' (Score: ' + cc.score + '/100)' : '') + '.',
      '',
      'We\'ve reviewed the findings for ' + (cc.url || 'your site') +
        ' and have some initial thoughts on quick wins and structural improvements.',
      '',
      'Here are a few times we can connect for a 30-minute strategy call:',
      ''
    ];
    if (slots.length > 0) {
      slots.forEach(function (s, i) {
        ccLines.push('  ' + (i + 1) + '. ' + s.label);
      });
    } else {
      ccLines.push('  (We\'ll follow up with specific times shortly.)');
    }
    ccLines.push('');
    ccLines.push('Reply with your preferred slot (or suggest an alternative) and we\'ll confirm.');
    ccLines.push('');
    ccLines.push('— AmbientPixels / ConversionCore');
    return ccLines.join('\n');
  }

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
      '— AmbientPixels / AmbientCore'
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
  lines.push('— AmbientPixels / AmbientCore');

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
      campaign_id: null,
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
  // ── Demo mode: return generated inbound data ──
  // ══════════════════════════════════════════════════
  if (process.env.DEMO_MODE === 'true' && req.method === 'GET' && action === 'recent') {
    var demoItems = _generateDemoInbound();
    context.res = { status: 200, headers: headers, body: { ok: true, count: demoItems.length, items: demoItems } };
    return;
  }

  if (process.env.DEMO_MODE === 'true' && req.method === 'GET' && action === 'item') {
    context.res = { status: 200, headers: headers, body: { ok: true, item: { id: (req.query && req.query.id) || 'fi_demo', type: 'contact', message: { subject: 'Demo inquiry', body: 'This is a demo submission.' } } } };
    return;
  }

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
            var markerReplyAt = linkedTask ? _taskReplyMarkerTimestamp(linkedTask) : null;
            if (linkedTask && (linkedTask.repliedAt || _taskHasReplyMarker(linkedTask))) {
              var derivedReplyAt = linkedTask.repliedAt || markerReplyAt;
              r.computedStatus = 'replied';
              r.computedStatusReason = 'replied ' + (derivedReplyAt || 'marker');
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
          var markerReplyAt = inbTask ? _taskReplyMarkerTimestamp(inbTask) : null;

          var closedAt = null;
          if (inbTask && (inbTask.status === 'completed' || inbTask.status === 'done')) {
            closedAt = inbTask.completedAt || inbTask.closedAt || inbTask.statusChangedAt || inbTask.lastStatusAt || null;
          }

          item.lifecycle = {
            submittedAt: item.receivedAt || null,
            taskCreatedAt: inbTask ? (inbTask.createdAt || inbTask.created_at || inbTask.created || null) : null,
            draftCreatedAt: draftTask ? (draftTask.createdAt || draftTask.created_at || draftTask.created || null) : null,
            repliedAt: inbTask ? (inbTask.repliedAt || markerReplyAt || null) : null,
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
    var blocked = require('../_utils/demoGuard').httpGuard(req);
    if (blocked) { context.res = blocked; return; }

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

      // ── ConversionCore strategy metadata + proposed time slots ──
      if (data.type === 'conversioncore_strategy' && data.conversioncore) {
        record.conversioncore = data.conversioncore;
        var proposedSlots = await _proposeTimeSlots(3);
        record.scheduling = {
          mode: 'agent_propose',
          timezone: 'America/Los_Angeles',
          durationMinutes: 30,
          businessHours: { start: '09:00', end: '17:00', days: ['MO','TU','WE','TH','FR'] },
          bufferMinutes: 15,
          proposedSlots: proposedSlots
        };
      }

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
