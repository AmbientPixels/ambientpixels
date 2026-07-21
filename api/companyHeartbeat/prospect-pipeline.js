// prospect-pipeline.js — AmbientScore outbound prospect pipeline (2026-07-21)
//
// Pure cores + IO shell, house pattern (rewards-engine.js). The cron
// (api/asProspectCron) and manual trigger (api/as-prospect-trigger) call
// runProspectPipeline. Pure functions have NO IO so they stay unit-testable.
// Spec: docs/superpowers/specs/2026-07-21-as-prospect-pipeline-design.md

'use strict';

var _URL_RE = /https?:\/\/[^\s"'<>()]+/gi;

function _domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch (_e) { return null; }
}

function _isBlockedDomain(domain, block) {
  if (!domain) return true;
  var all = (block.ownDomains || []).concat(block.domainBlocklist || []);
  return all.some(function (b) {
    b = String(b).toLowerCase();
    return domain === b || domain.endsWith('.' + b);
  });
}

// candidate {links, text} → { siteUrl, domain } | null
function extractSiteUrl(candidate, block) {
  if (!candidate) return null;
  var pool = [];
  (Array.isArray(candidate.links) ? candidate.links : []).forEach(function (u) {
    pool.push({ u: u, fromText: false });
  });
  var m = String(candidate.text || '').match(_URL_RE) || [];
  m.forEach(function (u) { pool.push({ u: u, fromText: true }); });
  for (var i = 0; i < pool.length; i++) {
    // Trailing-punctuation stripping only applies to URLs pulled out of free
    // text via regex (which can capture sentence punctuation). Structured
    // link entries (facets/embeds) are exact URIs and must not be mangled —
    // e.g. https://en.wikipedia.org/wiki/Foo_(bar) has a meaningful ')'.
    var raw = pool[i].fromText
      ? String(pool[i].u).replace(/[.,!?;:)\]]+$/, '')
      : String(pool[i].u);
    if (!/^https?:\/\//i.test(raw)) continue;
    var domain = _domainOf(raw);
    if (!domain || _isBlockedDomain(domain, block)) continue;
    return { siteUrl: raw, domain: domain };
  }
  return null;
}

function _dayKey(iso) { return String(iso || '').substring(0, 10); }

function _countScansToday(prospects, nowMs) {
  var today = _dayKey(new Date(nowMs).toISOString());
  return prospects.filter(function (p) {
    return p && p.scanQueuedAt && _dayKey(p.scanQueuedAt) === today;
  }).length;
}

// candidates + existing prospects + config → NEW prospect entries (status
// 'discovered'), best-first, bounded by the daily scan budget.
function filterProspects(candidates, prospects, cfg, nowMs) {
  var out = [];
  var existing = Array.isArray(prospects) ? prospects : [];
  var seenAuthors = {};
  var seenDomains = {};
  existing.forEach(function (p) {
    if (p && p.author) seenAuthors[String(p.author).toLowerCase()] = true;
  });
  var domainCooldownDays = Number.isFinite(cfg.domainCooldownDays) ? cfg.domainCooldownDays : 30;
  var cooldownMs = domainCooldownDays * 86400e3;
  existing.forEach(function (p) {
    if (!p || !p.domain) return;
    var t = Date.parse(p.discoveredAt || 0);
    if (Number.isFinite(t) && nowMs - t < cooldownMs) seenDomains[p.domain] = true;
  });

  var maxScansPerDay = Number.isFinite(cfg.maxScansPerDay) ? cfg.maxScansPerDay : 3;
  var budget = Math.max(0, maxScansPerDay - _countScansToday(existing, nowMs));
  var maxPostAgeHours = Number.isFinite(cfg.maxPostAgeHours) ? cfg.maxPostAgeHours : 24;
  var maxAgeMs = maxPostAgeHours * 3600e3;
  var minEngagement = Number.isFinite(cfg.minEngagement) ? cfg.minEngagement : 1;

  for (var i = 0; i < (candidates || []).length && out.length < budget; i++) {
    var c = candidates[i];
    if (!c || !c.uri || !c.cid || !c.author) continue;
    var t = Date.parse(c.indexedAt || 0);
    if (!Number.isFinite(t) || nowMs - t > maxAgeMs) continue;
    if (((c.likeCount || 0) + (c.replyCount || 0)) < minEngagement) continue;
    var authorKey = String(c.author).toLowerCase();
    if (seenAuthors[authorKey]) continue;
    var site = extractSiteUrl(c, cfg);
    if (!site) continue;
    if (seenDomains[site.domain]) continue;
    seenAuthors[authorKey] = true;
    seenDomains[site.domain] = true;
    out.push({
      id: 'pros_' + nowMs + '_' + Math.random().toString(36).substring(2, 7),
      uri: c.uri, cid: c.cid, author: c.author, authorDid: c.authorDid || '',
      postText: String(c.text || '').substring(0, 500),
      siteUrl: site.siteUrl, domain: site.domain,
      discoveredAt: new Date(nowMs).toISOString(),
      status: 'discovered',
      scanScore: null, reportId: null, taskId: null, actionId: null,
      scanQueuedAt: null, promotedAt: null, scanId: null
    });
  }
  return out;
}

// Task shape mirrors the CEO dashboard's Draft Reply flow
// (modules/company/bluesky-discovery.html ~line 349) — Scribe's drafter reads
// task.threadContext {uri, cid, author}. status 'backlog' keeps it invisible to
// agents until the scan comment lands (promoteReady flips it to 'todo').
// source 'asProspectCron' (≠ 'heartbeat') + assignee + dueDate rides the
// CEO/manual-task triage exception — no Nova-triage wait.
function buildReplyTask(prospect, nowMs) {
  var iso = new Date(nowMs).toISOString();
  return {
    id: 'task_' + nowMs + '_prospect_' + Math.random().toString(36).substring(2, 6),
    title: 'Outreach reply to @' + prospect.author + ' (AmbientScore prospect)',
    description:
      'PROSPECT FACT SHEET (use ONLY these facts + the scan comment below)\n'
      + '- Their post (verbatim): "' + prospect.postText + '"\n'
      + '- Their site: ' + prospect.siteUrl + '\n'
      + '- You are replying AS the AmbientPixels founder account.\n\n'
      + 'RULES:\n'
      + '- Reference exactly ONE specific finding from the [SCAN RESULT] comment on this task.\n'
      + '- Include the free shareable report link from that comment.\n'
      + '- Do NOT mention pricing. Do NOT claim anything the scan did not measure.\n'
      + '- Founder voice: under 280 chars, no em dashes, no hype, 5th grade reading level.\n'
      + '- If the post or site looks like spam, output an empty deliverable to decline.\n\n'
      + 'Output ONLY the reply text itself. No title, no "Reply:" label, no preamble.',
    taskType: 'bluesky_reply',
    category: 'maintenance',
    status: 'backlog',
    priority: 'medium',
    assignee: 'scribe',
    source: 'asProspectCron',
    created_by: 'asProspectCron',
    objective_id: 'obj-first-customer',
    createdAt: iso,
    updatedAt: iso,
    dueDate: new Date(nowMs + 3 * 86400e3).toISOString(),
    tags: ['bluesky-reply', 'as-prospect'],
    threadContext: {
      uri: prospect.uri, cid: prospect.cid,
      author: prospect.author, authorDid: prospect.authorDid,
      originalText: prospect.postText,
      indexedAt: prospect.discoveredAt
    },
    comments: []
  };
}

// Matches the asScanQueue entry shape written by the run-ambientscore-scan
// handler (agent-runner.js ~line 5183) — asScanRunner consumes url + taskId.
function buildScanJob(prospect, taskId, nowMs) {
  return {
    id: 'scan_' + nowMs + '_' + Math.random().toString(36).substring(2, 6),
    url: prospect.siteUrl,
    taskId: taskId,
    requestedBy: 'asProspectCron',
    note: 'Outbound prospect: @' + prospect.author + ' — ' + prospect.domain,
    status: 'queued',
    createdAt: new Date(nowMs).toISOString(),
    cycleId: 'asProspectCron'
  };
}

// Mutates prospects in place (house pattern: evaluateObjectives). Returns
// { taskIdsToTodo, taskIdsToClose } for the IO shell to apply to the tasks store.
// Promotion is capped by maxDraftsPerDay (counted from promotedAt today) so a
// scan burst can't flood Scribe/the approval queue.
function promoteReady(prospects, scanQueue, cfg, nowMs) {
  var out = { taskIdsToTodo: [], taskIdsToClose: [] };
  var jobs = {};
  (Array.isArray(scanQueue) ? scanQueue : []).forEach(function (j) {
    if (j && j.id) jobs[j.id] = j;
    if (j && j.taskId && !jobs['task:' + j.taskId]) jobs['task:' + j.taskId] = j;
  });
  var today = _dayKey(new Date(nowMs).toISOString());
  var promotedToday = prospects.filter(function (p) {
    return p && p.promotedAt && _dayKey(p.promotedAt) === today;
  }).length;
  var budget = Math.max(0, (Number.isFinite(cfg.maxDraftsPerDay) ? cfg.maxDraftsPerDay : 2) - promotedToday);

  for (var i = 0; i < prospects.length; i++) {
    var p = prospects[i];
    if (!p || p.status !== 'scan_queued') continue;
    var job = (p.scanId && jobs[p.scanId]) || jobs['task:' + p.taskId];
    if (!job) continue;
    if (job.status === 'error' || job.status === 'failed') {
      p.status = 'dismissed';
      out.taskIdsToClose.push(p.taskId);
    } else if (job.status === 'done') {
      if (budget <= 0) continue; // stays scan_queued, promoted on a later run
      budget--;
      p.status = 'task_ready';
      p.reportId = job.reportId || null;
      p.scanScore = Number.isFinite(job.score) ? job.score : null;
      p.promotedAt = new Date(nowMs).toISOString();
      out.taskIdsToTodo.push(p.taskId);
    }
  }
  return out;
}

// Stamp terminal outcomes from task/action state, then prune. Returns the
// kept list (caller persists it). NOTE on pruning vs the one-touch-per-author
// rule: pruning >60d entries means an author could theoretically be re-touched
// after 60 days. Accepted in the spec (retention 60d) — the 7-day reply-task
// dedup and domain cooldown still apply.
function reconcile(prospects, tasks, actions, nowMs) {
  var taskById = {};
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) { if (t && t.id) taskById[t.id] = t; });
  var replyByTask = {};
  (Array.isArray(actions) ? actions : []).forEach(function (a) {
    if (a && a.type === 'social_post.reply' && a._parentTaskId) replyByTask[a._parentTaskId] = a;
  });
  prospects.forEach(function (p) {
    if (!p || p.status !== 'task_ready') return;
    var t = taskById[p.taskId];
    if (!t || t.status !== 'done') return;
    var reply = replyByTask[p.taskId];
    if (reply) { p.status = 'sent'; p.actionId = reply.id; }
    else { p.status = 'declined'; }
  });
  var kept = prospects.filter(function (p) {
    if (!p) return false;
    var age = nowMs - Date.parse(p.discoveredAt || 0);
    if (!Number.isFinite(age)) return false;
    if (age > 60 * 86400e3) return false;
    if (p.status === 'dismissed' && age > 14 * 86400e3) return false;
    return true;
  });
  if (kept.length > 300) kept = kept.slice(0, 300);
  return kept;
}

var _DEFAULTS_FILE = require('../_data/as-prospect-keywords.json');

function _loadConfig(systemConfig) {
  var file = _DEFAULTS_FILE || {};
  var cfg = Object.assign({}, file.defaults || {});
  cfg.keywords = (file.keywords || []).slice();
  cfg.ownDomains = (file.ownDomains || []).slice();
  cfg.domainBlocklist = (file.domainBlocklist || []).slice();
  var over = (systemConfig && systemConfig.asProspecting) || {};
  Object.keys(over).forEach(function (k) { cfg[k] = over[k]; });
  return cfg;
}

async function _logGov(storage, type, data, nowMs) {
  try {
    var gov = (await storage.getState('governanceLog')) || [];
    gov.push({ id: 'gov-' + nowMs + '-' + Math.random().toString(36).substring(2, 6),
      type: type, data: data, timestamp: new Date(nowMs).toISOString() });
    await storage.setState('governanceLog', gov.slice(-500));
  } catch (_e) { /* non-fatal */ }
}

// IO shell. `discover` is injectable for tests; defaults to the shared
// Bluesky discovery engine. All passes are idempotent per prospect id —
// a crash mid-run reconciles from state on the next run.
// Queue rules (spec): queue FULL → prospect stays 'discovered', retried on a
// later run. URL already queued/running or scanned <7d → terminal 'dismissed'.
async function runProspectPipeline(opts) {
  var storage = opts.storage;
  var log = opts.log || function () {};
  var nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  var discover = opts.discover || function (keywords) {
    var bd = require('../_utils/blueskyDiscovery');
    return bd.discoverAcrossKeywords(keywords, { maxAgeMinutes: 24 * 60, minReplies: 0, limitPerKeyword: 15 });
  };

  var systemConfig = (await storage.getState('systemConfig')) || {};
  var cfg = _loadConfig(systemConfig);
  if (cfg.enabled === false) { log('[prospects] disabled via systemConfig.asProspecting.enabled'); return { skipped: 'disabled' }; }

  var prospects = (await storage.getState('asProspects')) || [];
  if (!Array.isArray(prospects)) prospects = [];
  var tasks = (await storage.getState('tasks')) || [];
  var scanQueue = (await storage.getState('asScanQueue')) || [];
  if (!Array.isArray(scanQueue)) scanQueue = [];
  var actions = (await storage.getState('actions')) || [];

  // ── Pass 1: DISCOVER + QUEUE ──
  var discovered = 0, queued = 0;
  try {
    var carried = prospects.filter(function (p) { return p && p.status === 'discovered'; });
    var fresh = [];
    var maxQueuedProspects = Number.isFinite(cfg.maxQueuedProspects) ? cfg.maxQueuedProspects : 10;
    if (carried.length < maxQueuedProspects) {
      var candidates = await discover(cfg.keywords);
      fresh = filterProspects(candidates, prospects, cfg, nowMs);
      fresh.forEach(function (p) { prospects.push(p); discovered++; });
    } else {
      log('[prospects] discovery skipped — discovered backlog at cap');
    }
    var budget = Math.max(0, (Number.isFinite(cfg.maxScansPerDay) ? cfg.maxScansPerDay : 3) - _countScansToday(prospects, nowMs));
    var queueCandidates = carried.concat(fresh);
    for (var i = 0; i < queueCandidates.length; i++) {
      var p = queueCandidates[i];
      if (budget <= 0) break; // remaining stay 'discovered' → retried next run
      var dup = scanQueue.some(function (q) {
        return q && q.url === p.siteUrl && (q.status === 'queued' || q.status === 'running' ||
          (q.finishedAt && nowMs - Date.parse(q.finishedAt) < 7 * 86400e3));
      });
      if (dup) { p.status = 'dismissed'; continue; }
      if (scanQueue.filter(function (q) { return q && q.status === 'queued'; }).length >= 20) break; // queue full → stays 'discovered'
      var task = buildReplyTask(p, nowMs);
      var job = buildScanJob(p, task.id, nowMs);
      tasks.push(task);
      scanQueue.push(job);
      p.taskId = task.id;
      p.scanId = job.id;
      p.status = 'scan_queued';
      p.scanQueuedAt = new Date(nowMs).toISOString();
      queued++;
      budget--;
      log('[prospects] queued @' + p.author + ' → ' + p.domain + ' (scan ' + job.id + ')');
    }
    if (discovered > 0) await _logGov(storage, 'prospect-discovered', { count: discovered }, nowMs);
  } catch (dErr) {
    log('[prospects] discovery failed (non-fatal): ' + String(dErr && dErr.message || dErr).substring(0, 200));
  }

  // ── Pass 2: PROMOTE ──
  var promo = promoteReady(prospects, scanQueue, cfg, nowMs);
  promo.taskIdsToTodo.forEach(function (tid) {
    var t = tasks.find(function (x) { return x && x.id === tid; });
    if (t && t.status === 'backlog') { t.status = 'todo'; t.updatedAt = new Date(nowMs).toISOString(); }
  });
  promo.taskIdsToClose.forEach(function (tid) {
    var t = tasks.find(function (x) { return x && x.id === tid; });
    if (t && t.status !== 'done') {
      t.status = 'done';
      t.updatedAt = new Date(nowMs).toISOString();
      t.comments = t.comments || [];
      t.comments.push({ id: 'cmt-prospect-' + nowMs, author: 'system', type: 'system',
        text: 'Scan failed for this prospect — outreach dismissed by asProspectCron.',
        createdAt: new Date(nowMs).toISOString() });
    }
  });
  if (promo.taskIdsToTodo.length > 0) {
    await _logGov(storage, 'prospect-outreach-ready', { count: promo.taskIdsToTodo.length, taskIds: promo.taskIdsToTodo }, nowMs);
  }

  // ── Pass 3: TRACK / PRUNE ──
  var kept = reconcile(prospects, tasks, actions, nowMs);

  await storage.setState('asProspects', kept);
  await storage.setState('tasks', tasks);
  await storage.setState('asScanQueue', scanQueue.slice(-100));

  var summary = { discovered: discovered, queued: queued, promoted: promo.taskIdsToTodo.length,
    dismissed: promo.taskIdsToClose.length, total: kept.length };
  log('[prospects] run complete: ' + JSON.stringify(summary));
  return summary;
}

module.exports = {
  extractSiteUrl: extractSiteUrl,
  filterProspects: filterProspects,
  buildReplyTask: buildReplyTask,
  buildScanJob: buildScanJob,
  promoteReady: promoteReady,
  reconcile: reconcile,
  runProspectPipeline: runProspectPipeline
};
