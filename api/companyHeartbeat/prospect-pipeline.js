// prospect-pipeline.js — AmbientScore outbound prospect pipeline (2026-07-21)
//
// Pure cores + IO shell, house pattern (rewards-engine.js). The cron
// (api/asProspectCron) and manual trigger (api/as-prospect-trigger) call
// runProspectPipeline. Pure functions have NO IO so they stay unit-testable.
// Spec: docs/superpowers/specs/2026-07-21-as-prospect-pipeline-design.md

'use strict';

var _BP = require('./_utils/laneBackpressure');

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
      + '- Include the report link COPIED EXACTLY from that comment. The only real domain is '
      + 'ambientpixels.ai — ambientscore.ai and every other domain variant DO NOT EXIST, and '
      + 'invented/prettified URLs are auto-rejected.\n'
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

var ORPHAN_MIN_AGE_MS = 30 * 60e3;

// Repairs states a mid-run crash or a concurrent asScanQueue writer can strand.
// (a) 'scan_queued' with NO matching job and scanQueuedAt older than ORPHAN_MIN_AGE_MS
//     → revert to 'discovered' (clear taskId/scanId/scanQueuedAt); if its task exists,
//     close it via taskIdsToClose. Requeues cleanly on this same run's Pass 1? No —
//     sweep runs BEFORE Pass 2 but after Pass 1, so requeue happens next run. Fine.
// (b) 'task_ready' whose task exists and is still 'backlog' → re-flip via reflipTaskIds
//     (idempotent). 'task_ready' with NO task at all → 'dismissed' (rare; author stays
//     consumed — accepted).
// Age guard prevents sweeping entries a concurrent/just-finished run wrote seconds ago.
function sweepOrphans(prospects, scanQueue, tasks, nowMs) {
  var out = { reverted: [], taskIdsToClose: [], reflipTaskIds: [] };
  var jobs = {};
  (Array.isArray(scanQueue) ? scanQueue : []).forEach(function (j) {
    if (j && j.id) jobs[j.id] = j;
    if (j && j.taskId && !jobs['task:' + j.taskId]) jobs['task:' + j.taskId] = j;
  });
  var taskById = {};
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) { if (t && t.id) taskById[t.id] = t; });

  prospects.forEach(function (p) {
    if (!p) return;
    if (p.status === 'scan_queued') {
      var job = (p.scanId && jobs[p.scanId]) || jobs['task:' + p.taskId];
      if (job) return; // has a job — handled normally by promoteReady
      var age = nowMs - Date.parse(p.scanQueuedAt || 0);
      if (!Number.isFinite(age) || age < ORPHAN_MIN_AGE_MS) return; // too young — could be an in-flight write
      var existingTask = p.taskId && taskById[p.taskId];
      if (existingTask) out.taskIdsToClose.push(p.taskId);
      out.reverted.push(p.id);
      p.status = 'discovered';
      p.taskId = null;
      p.scanId = null;
      p.scanQueuedAt = null;
    } else if (p.status === 'task_ready') {
      var t = p.taskId && taskById[p.taskId];
      if (!t) { p.status = 'dismissed'; }
      else if (t.status === 'backlog') { out.reflipTaskIds.push(p.taskId); }
    }
  });
  return out;
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
      // Outreach quality floor: a near-zero score on a completed scan almost
      // always means the scraper hit a bot wall and audited an empty shell
      // (first prod case: amazon.ca product page → 7/100 "no headline
      // whatsoever"). Sending that "free report" would embarrass the brand —
      // dismiss instead of promoting.
      var _minScore = Number.isFinite(cfg.minOutreachScore) ? cfg.minOutreachScore : 15;
      if (Number.isFinite(job.score) && job.score < _minScore) {
        p.status = 'dismissed';
        p.scanScore = job.score;
        p.reportId = job.reportId || null;
        out.taskIdsToClose.push(p.taskId);
        continue;
      }
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
//
// 'sent' requires the reply action to be approved/executed, not merely to
// exist (a drafted-but-not-yet-approved reply is not outreach that happened).
// - approval.status === 'approved', OR execution.status === 'success', OR
//   execution_status === 'success' → sent.
// - approval.status === 'rejected' → declined.
// - anything else (pending / no verdict yet) → leave 'task_ready' untouched;
//   a later run re-evaluates once the approval/execution resolves.
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
    if (!reply) { p.status = 'declined'; return; }
    var approved = (reply.approval && reply.approval.status === 'approved')
      || (reply.execution && reply.execution.status === 'success')
      || reply.execution_status === 'success';
    if (approved) { p.status = 'sent'; p.actionId = reply.id; return; }
    var rejected = reply.approval &&
      (reply.approval.status === 'rejected' || reply.approval.status === 'cancelled');
    if (rejected) { p.status = 'declined'; return; }
    // pending: no stamp yet, a later run re-checks
  });
  var kept = prospects.filter(function (p) {
    if (!p) return false;
    var age = nowMs - Date.parse(p.discoveredAt || 0);
    if (!Number.isFinite(age)) return false;
    if (age > 60 * 86400e3) return false;
    if (p.status === 'dismissed' && age > 14 * 86400e3) return false;
    return true;
  });
  if (kept.length > 300) kept = kept.slice(-300);
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
  if (!Array.isArray(tasks)) tasks = [];
  var scanQueue = (await storage.getState('asScanQueue')) || [];
  if (!Array.isArray(scanQueue)) scanQueue = [];
  var actions = (await storage.getState('actions')) || [];
  if (!Array.isArray(actions)) actions = [];

  // Dirty flags: only rewrite tasks/asScanQueue if this run actually mutated
  // them. asProspects always persists (Pass 3 always runs). governanceLog
  // events are batched (see govEvents) and written once, after the three
  // main setStates succeed — a crash mid-run must not leave gov events
  // describing state that never landed.
  var tasksDirty = false;
  var scanQueueDirty = false;
  var govEvents = [];

  // ── Pass 1: DISCOVER + QUEUE ──
  var discovered = 0, queued = 0;
  try {
    // Lane-scoped: only laneless (AmbientScore) entries. The store is shared —
    // roast-lane entries (lane:'resumeRoast', siteUrl null) carried here get a
    // null-URL scan job, and the q.url === p.siteUrl dup check then dismisses
    // every OTHER null-siteUrl prospect against that job (null === null). This
    // ate both carried roast candidates on 2026-08-03's first cycle.
    var carried = prospects.filter(function (p) { return p && p.status === 'discovered' && !p.lane; });
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
    // Same backpressure as the roast lane below: both mint bluesky_reply tasks onto
    // Scribe, so they share one queue and must share one limit. Gating only one of
    // them would just move the overflow. Prospects that do not fit stay 'discovered'
    // and are retried next run — and their scan is not burned either, since the scan
    // job is only created alongside a task.
    var _asCap = _BP.laneCapacity(tasks, 'scribe', 'bluesky_reply');
    if (_asCap.remaining < budget) {
      log('[prospects] backpressure: scribe holds ' + _asCap.open + '/' + _asCap.depth
        + ' open reply tasks, minting ' + _asCap.remaining + ' instead of ' + budget);
      budget = _asCap.remaining;
    }
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
      tasksDirty = true;
      scanQueueDirty = true;
      p.taskId = task.id;
      p.scanId = job.id;
      p.status = 'scan_queued';
      p.scanQueuedAt = new Date(nowMs).toISOString();
      queued++;
      budget--;
      log('[prospects] queued @' + p.author + ' → ' + p.domain + ' (scan ' + job.id + ')');
    }
    if (discovered > 0) govEvents.push({ type: 'prospect-discovered', data: { count: discovered } });
  } catch (dErr) {
    log('[prospects] discovery failed (non-fatal): ' + String(dErr && dErr.message || dErr).substring(0, 200));
  }

  // ── Orphan sweep: repair state a mid-run crash or a concurrent asScanQueue
  // writer stranded. Runs after Pass 1 (so a freshly-queued prospect this run
  // isn't mistaken for an orphan) and before Pass 2 (so repaired prospects
  // are eligible for promotion/close in the same pass). ──
  var sweep = sweepOrphans(prospects, scanQueue, tasks, nowMs);

  // ── Pass 2: PROMOTE ──
  var promo = promoteReady(prospects, scanQueue, cfg, nowMs);
  var toTodo = promo.taskIdsToTodo.concat(sweep.reflipTaskIds);
  var todoSeen = {};
  toTodo.forEach(function (tid) {
    if (todoSeen[tid]) return;
    todoSeen[tid] = true;
    var t = tasks.find(function (x) { return x && x.id === tid; });
    if (t && t.status === 'backlog') { t.status = 'todo'; t.updatedAt = new Date(nowMs).toISOString(); tasksDirty = true; }
  });
  // Close-comment copy is branched by ORIGIN — the promote path closes
  // because a scan genuinely failed; the orphan-sweep path closes because
  // the job/task link was lost (crash or a concurrent asScanQueue write),
  // and the prospect is being reverted for a retry, not dismissed. Using
  // the promote copy on an orphan close would assert something false.
  var closeSeen = {};
  function _closeTaskWithCopy(tid, comment) {
    if (closeSeen[tid]) return;
    closeSeen[tid] = true;
    var t = tasks.find(function (x) { return x && x.id === tid; });
    if (t && t.status !== 'done') {
      t.status = 'done';
      t.updatedAt = new Date(nowMs).toISOString();
      t.comments = t.comments || [];
      t.comments.push({ id: 'cmt-prospect-' + nowMs, author: 'system', type: 'system',
        text: comment, createdAt: new Date(nowMs).toISOString() });
      tasksDirty = true;
    }
  }
  promo.taskIdsToClose.forEach(function (tid) {
    _closeTaskWithCopy(tid, 'Scan unusable for outreach (failed, or scored below the quality floor — usually a bot-blocked page) — dismissed by asProspectCron.');
  });
  sweep.taskIdsToClose.forEach(function (tid) {
    _closeTaskWithCopy(tid, 'Scan job lost (crash or concurrent queue write) — task closed, prospect re-queued by asProspectCron.');
  });
  if (toTodo.length > 0) {
    govEvents.push({ type: 'prospect-outreach-ready', data: { count: toTodo.length, taskIds: toTodo } });
  }
  if (sweep.reverted.length > 0) {
    log('[prospects] orphan sweep reverted ' + sweep.reverted.length + ' stranded prospect(s) for retry');
  }

  // ── Pass 3: TRACK / PRUNE ──
  var kept = reconcile(prospects, tasks, actions, nowMs);

  await storage.setState('asProspects', kept);
  if (tasksDirty) await storage.setState('tasks', tasks);
  if (scanQueueDirty) await storage.setState('asScanQueue', scanQueue.slice(-100));

  // Batched gov write — only after the state that the events describe has
  // actually landed.
  if (govEvents.length > 0) {
    try {
      var gov = (await storage.getState('governanceLog')) || [];
      govEvents.forEach(function (e) {
        gov.push({ id: 'gov-' + nowMs + '-' + Math.random().toString(36).substring(2, 6),
          type: e.type, data: e.data, timestamp: new Date(nowMs).toISOString() });
      });
      await storage.setState('governanceLog', gov.slice(-500));
    } catch (_e) { /* non-fatal */ }
  }

  var summary = { discovered: discovered, queued: queued, promoted: promo.taskIdsToTodo.length,
    dismissed: promo.taskIdsToClose.length, swept: sweep.reverted.length, total: kept.length };
  log('[prospects] run complete: ' + JSON.stringify(summary));
  return summary;
}

// ── Deterministic report-link repair ─────────────────────────────────────────
// The drafter model has NEVER reliably copied the report link: the execute
// prompt truncates task comments to 200 chars, so the URL (at char ~560-840 of
// the [SCAN RESULT] comment) was invisible — Scribe invented URLs (fruitfop
// incident) and, once the fabricated-URL gate started rejecting those, learned
// to omit links entirely ("happy to share the report"). The link is the
// conversion path — splice the REAL report URL in server-side instead of
// trusting the model to copy it. Pure function; no scan comment → no-op.
var BSKY_REPLY_MAX = 296; // bluesky hard cap 300, headroom for trailing edges
var _OUR_URL_RE = /(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]*ambient(?:pixels|score)[a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s"')\]]*)?/gi;
var _HEDGE_RE = /\s*(?:happy to share[^.!?]*|let me know if[^.!?]*|just say the word[^.!?]*|if you(?:'d| would)? ?(?:like|want)[^.!?]*)[.!?]["']?\s*$/i;

function repairReplyLink(replyText, scanCommentText) {
  var m = String(scanCommentText || '').match(/https:\/\/ambientpixels\.ai\/ambientscore\/report\.html\?id=ccr_[a-z0-9_]+/i);
  if (!m) return String(replyText || '').trim();
  return repairReplyLinkTo(replyText, m[0], 'Full report:');
}

// Lane-agnostic core (extracted 2026-08-02 for the Resume Roast lane, whose
// canonical link is a static agent URL rather than a scan-comment report link).
// Same guarantees: the real link always ships, invented ambient* URLs are
// swapped for it, "want the link?" hedges are stripped before appending, and
// the TEXT is trimmed at the platform cap — never the link.
function repairReplyLinkTo(replyText, realUrl, appendLabel) {
  var text = String(replyText || '').trim();
  if (!realUrl || !text) return text;
  if (text.indexOf(realUrl) === -1) {
    if ((text.match(_OUR_URL_RE) || []).length > 0) {
      // Model invented an ambientpixels/ambientscore URL — swap the first for the
      // real link, drop any extras. The prospect's own domain is left untouched.
      var first = true;
      text = text.replace(_OUR_URL_RE, function () {
        if (first) { first = false; return realUrl; }
        return '';
      }).replace(/[ \t]{2,}/g, ' ').trim();
    } else {
      // No link at all — strip a trailing "want the link?" hedge, then append.
      text = text.replace(_HEDGE_RE, '').trim();
      if (text && !/[.!?]$/.test(text)) text += '.';
      text = (text ? text + ' ' : '') + (appendLabel || 'Link:') + ' ' + realUrl;
    }
  }
  return _fitWithLink(text, realUrl);
}

// Over the platform cap: trim the TEXT at a word boundary, never the link.
function _fitWithLink(text, realUrl) {
  if (text.length <= BSKY_REPLY_MAX) return text;
  var linkIdx = text.lastIndexOf(realUrl);
  if (linkIdx === -1) return text.substring(0, BSKY_REPLY_MAX);
  var tail = text.slice(linkIdx);
  var head = text.slice(0, linkIdx).trim();
  var budget = BSKY_REPLY_MAX - tail.length - 1;
  if (head.length > budget) {
    head = head.slice(0, budget);
    var sp = head.lastIndexOf(' ');
    if (sp > 40) head = head.slice(0, sp);
    head = head.replace(/[,;:\-\s]+$/, '');
    if (head && !/[.!?]$/.test(head)) head += '.';
  }
  return (head ? head + ' ' : '') + tail;
}

// One prospect, one reply. Returns the existing reply that should block a second
// draft for this task, or null.
//
// The original guard (0a9eb9ec, after the 07-24 fruitfop incident) matched only
// approval.status === 'pending' — a crash-recovery guard. But once the first reply
// is APPROVED and executed it stops matching, so the next cycle drafts another and
// the prospect gets messaged twice. That is how zimpirate.bsky.social received
// near-duplicate outreach on 07-28, four days after the guard shipped: 3 of 21
// 'sent' prospects ended up double-messaged.
//
// Anything not rejected blocks — the prospect either has the message or is about to.
// A REJECTED reply deliberately does NOT block: it never reached anyone, and
// redrafting after a rejection is how the copy improves. An absent/unknown status
// blocks, because we cannot prove it was never sent.
function findBlockingReply(actions, taskId) {
  if (!Array.isArray(actions) || !taskId) return null;
  return actions.find(function (a) {
    if (!a || a.type !== 'social_post.reply' || a._parentTaskId !== taskId) return false;
    var st = (a.approval && a.approval.status) || 'pending';
    return st !== 'rejected';
  }) || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// RESUME ROAST LANE (2026-08-02) — second outreach lane, same rails.
//
// Differences from the AmbientScore lane, by design:
//   - No scan step. A resume is not a URL — there is nothing to audit before
//     replying. Discovery mints the Scribe reply task DIRECTLY (status 'todo'),
//     so maxDraftsPerDay is enforced at mint time, not at a promote pass.
//   - No site URL required. Job-seeker posts usually carry no link; candidates
//     are filtered on intent keywords + post substance (minPostChars), not URLs.
//   - Static destination: the free Resume Roast agent
//     (/pixel-agents/run.html?agent=resume-roast). task.destinationUrl carries
//     it; the drafter's link repair (repairReplyLinkTo) guarantees it ships,
//     and the existing UTM stamp makes every click attributable.
//   - The store is SHARED (asProspects, entries stamped lane:'resumeRoast') so
//     one-touch-per-author holds ACROSS lanes — nobody gets a conversion-audit
//     reply one day and a resume pitch the next. reconcile() is lane-agnostic
//     and tracks sent/declined for these entries unchanged.
// ═══════════════════════════════════════════════════════════════════════════

// Bluesky search is LOOSE term matching, and this lane has no URL requirement
// to filter noise — the very first live run matched political posts about TV
// "interviews" and a "regular service will now resume" post (the VERB). Every
// candidate must show actual resume-noun intent:
//   - possessive usage ("my resume" / "my cv") = noun by construction, OR
//   - resume/cv mentioned ALONGSIDE a job-context word.
// Precision over recall: at 4 drafts/day, a missed prospect costs nothing;
// a pitch on a political rant costs the brand.
// (?![a-z]) instead of a trailing \b: JS \b is ASCII-only, so "résumé\b" never
// matches — é is a non-word char to \b and the boundary silently fails.
var _RESUME_POSSESSIVE_RE = /\b(?:my|our|his|her|their|your)\s+(?:resume|r[eé]sum[eé]|cv)(?![a-z])/i;
var _RESUME_NOUN_RE = /\b(?:resume|r[eé]sum[eé]|cv)(?![a-z])/i;
var _JOB_CONTEXT_RE = /\b(?:job|jobs|hiring|hired|interview|interviews|applicat\w*|career|laid off|layoff|recruiter|recruiting|ats|cover letter|unemploy\w*|job hunt\w*|job search\w*)\b/i;
function _hasResumeIntent(text) {
  var t = String(text || '');
  if (_RESUME_POSSESSIVE_RE.test(t)) return true;
  return _RESUME_NOUN_RE.test(t) && _JOB_CONTEXT_RE.test(t);
}

// ── Target suitability (2026-08-22) ─────────────────────────────────────────
// buildRoastReplyTask has told Scribe "If the post is venting or grief with no ask
// for help, output an EMPTY deliverable to decline. Never pitch at raw pain." since
// the lane opened. Measured against the 22 roast-lane replies sitting in the approval
// queue on 2026-08-22: 22 of 22 carried a pitch and a link. Zero declines. The rule
// held for exactly none of them, including a reply to "When I say I'm almost to my
// limit, I don't say it lightly" (aq-act_1787248864420) and one to somebody describing
// facing unemployment. A prompt rule the model overrides 100% of the time is not a
// control; this is the deterministic half.
//
// Two tiers, because the right answer is not the same for both:
//   'crisis'  → do not reply AT ALL. A brand account replying under a post about
//               self-harm is wrong even with the pitch stripped out.
//   'distress'→ still reply, with the offer and link suppressed. The best replies the
//               fleet has produced were exactly this shape and arrived by luck rather
//               than by rule: "Just remember they wanted to talk to you for a reason.
//               Hope it goes great tomorrow." — no link, no ask.
//
// Deliberately inclusive, unlike the domain filters above it. The costs are asymmetric
// in the opposite direction here: a false positive costs one suppressed link on a post
// that could have taken it, while a false negative is a bot reading somebody's despair
// as buying intent. When in doubt this drops the pitch and keeps the human reply.
// "end it all" / "end my life", never a bare "end it": \b(?:end it)\b happily matches
// across a word gap, so "it's mostly just bad luck on my END IT feels" read as suicidal
// ideation and dropped a plain job-hunt vent. A crisis matcher that fires on ordinary
// prose is worse than none — it silently deletes reachable people from the lane.
var _CRISIS_RE = /\b(?:suicid\w*|kill(?:ing)? myself|end(?:ing)? (?:it all|my (?:own )?life)|self[- ]harm|want(?:s|ed)? to die|don'?t want to (?:be here|live)|hurt(?:ing)? myself)\b/i;

var _DISTRESS_RE = new RegExp([
  // exhaustion and the end of the rope
  'at (?:my|the) limit', 'almost to my limit', 'breaking point', 'can\'?t (?:do this|take|keep going)',
  'burn(?:t|ed) out', 'burnout', 'exhaust\\w*', 'drain(?:ed|ing)', 'defeated', 'demoraliz\\w*',
  // hopelessness
  'losing hope', 'lost hope', 'hopeless', 'give? up', 'giving up', 'no luck', 'nothing (?:is )?work\\w*',
  'at a loss', 'nowhere', 'pointless', 'what\'?s the point',
  // material precarity
  'can\'?t afford', 'cannot afford', 'behind on rent', 'evict\\w*', 'homeless', 'broke af',
  'out of (?:money|savings)', 'need(?:s|ed)? (?:the )?money', 'desperat\\w*',
  'facing unemployment', '(?:going to be|about to be|soon be) unemployed', 'laid off',
  // acute need / stakes language
  'need this job', 'really need (?:this|a) job', 'last chance', 'running out of time',
  // mental-health vocabulary
  'depress\\w*', 'anxiet\\w*', 'anxious', 'panic attack', 'crying', 'cried', 'in tears',
  'mental health', 'cope', 'coping', 'struggling', 'struggle',
  // Fear. Added 2026-08-22 after the first post-gate run: somebody thanking friends
  // for support wrote "this is a very scary time" and drew a product pitch that
  // passed every check, because the list had exhaustion, hopelessness and precarity
  // but no word for being frightened. Common in job-loss posts and cheap to catch —
  // a false positive costs one suppressed link, a false negative pitches at fear.
  'scary', 'scared', 'terrif\\w*', 'frighten\\w*', 'dread\\w*', 'nervous', 'freaking out'
].join('|'), 'i');

/**
 * How much distress is this post carrying?
 * @returns {'none'|'distress'|'crisis'}
 */
function targetTone(text) {
  var t = String(text || '');
  if (_CRISIS_RE.test(t)) return 'crisis';
  if (_DISTRESS_RE.test(t)) return 'distress';
  return 'none';
}

// Topics we do not enter, shared with the participation lane so the list lives in
// one file. The roast lane never consulted these: _hasResumeIntent was the only
// content gate, which is how a Maine Senate primary thread drew a resume-tool pitch.
var _REL = require('./bluesky-relevance');
function _isUnsuitableTopic(text) {
  var t = String(text || '');
  if (_REL.NSFW_RE.test(t)) return 'nsfw';
  if (_REL.POLITICS_RE.test(t)) return 'politics';
  // Numbered thread openers ("1/2", "3/7") are broadcast content, not conversation —
  // replying under one is shouting into a lecture. The participation lane has refused
  // these since it opened; the roast lane pitched under a French "1/2 SEO sur votre
  // profil LinkedIn" thread (aq-act_1787270436932) because it never asked.
  if (_REL.BROADCAST_RE.test(t)) return 'broadcast';
  return null;
}

// Never prospect ourselves. Our own Resume Roast promo copy ("getting past the
// ATS... we built a free tool") satisfies _hasResumeIntent by design, so on
// 2026-08-07 the lane discovered our own post and queued a reply to it. The AS
// lane is immune because it requires a non-blocked site URL and ambientpixels.ai
// is in its ownDomains; the roast lane has no URL requirement, so it needs this
// guard explicitly. Also skips posts linking to our domains — our content, or
// somebody resharing it, is not a cold prospect either way.
function _isOwnRoastPost(candidate, cfg) {
  var author = String((candidate && candidate.author) || '').toLowerCase().replace(/^@/, '');
  var handles = (cfg.ownHandles || []).map(function (h) {
    return String(h).toLowerCase().replace(/^@/, '');
  });
  if (author && handles.indexOf(author) !== -1) return true;
  var text = String((candidate && candidate.text) || '').toLowerCase();
  return (cfg.ownDomains || []).some(function (d) {
    d = String(d).toLowerCase();
    return d && text.indexOf(d) !== -1;
  });
}

// candidates + existing prospects (ALL lanes) + cfg → new lane entries
// (status 'discovered'), bounded by maxQueuedProspects headroom.
function filterRoastProspects(candidates, prospects, cfg, nowMs) {
  var out = [];
  var existing = Array.isArray(prospects) ? prospects : [];
  var seenAuthors = {};
  existing.forEach(function (p) {
    if (p && p.author) seenAuthors[String(p.author).toLowerCase()] = true;
  });
  var maxPostAgeHours = Number.isFinite(cfg.maxPostAgeHours) ? cfg.maxPostAgeHours : 48;
  var maxAgeMs = maxPostAgeHours * 3600e3;
  var minEngagement = Number.isFinite(cfg.minEngagement) ? cfg.minEngagement : 0;
  var minPostChars = Number.isFinite(cfg.minPostChars) ? cfg.minPostChars : 25;
  var backlog = existing.filter(function (p) { return p && p.lane === 'resumeRoast' && p.status === 'discovered'; }).length;
  var maxQueued = Number.isFinite(cfg.maxQueuedProspects) ? cfg.maxQueuedProspects : 15;
  var headroom = Math.max(0, maxQueued - backlog);

  for (var i = 0; i < (candidates || []).length && out.length < headroom; i++) {
    var c = candidates[i];
    if (!c || !c.uri || !c.cid || !c.author) continue;
    if (_isOwnRoastPost(c, cfg)) continue;
    var t = Date.parse(c.indexedAt || 0);
    if (!Number.isFinite(t) || nowMs - t > maxAgeMs) continue;
    if (((c.likeCount || 0) + (c.replyCount || 0)) < minEngagement) continue;
    if (String(c.text || '').trim().length < minPostChars) continue;
    if (!_hasResumeIntent(c.text)) continue;
    // Topic guard — politics/NSFW are never ours to reply under, resume intent or not.
    if (_isUnsuitableTopic(c.text)) continue;
    // Crisis posts are dropped outright; distress posts are kept but flagged so the
    // task builder produces an empathy-only reply with no offer and no link.
    var _tone = targetTone(c.text);
    if (_tone === 'crisis') continue;
    var authorKey = String(c.author).toLowerCase();
    if (seenAuthors[authorKey]) continue;
    seenAuthors[authorKey] = true;
    out.push({
      id: 'pros_' + nowMs + '_' + Math.random().toString(36).substring(2, 7),
      lane: 'resumeRoast',
      uri: c.uri, cid: c.cid, author: c.author, authorDid: c.authorDid || '',
      postText: String(c.text || '').substring(0, 500),
      tone: _tone,
      siteUrl: null, domain: null,
      discoveredAt: new Date(nowMs).toISOString(),
      status: 'discovered',
      scanScore: null, reportId: null, taskId: null, actionId: null,
      scanQueuedAt: null, promotedAt: null, scanId: null
    });
  }
  return out;
}

// No scan to wait for → born 'todo', visible to Scribe next heartbeat.
// task.destinationUrl is the drafter-side contract: agent-runner's link repair
// guarantees this exact URL ships in the reply (and the UTM stamp follows it).
function buildRoastReplyTask(prospect, cfg, nowMs) {
  var iso = new Date(nowMs).toISOString();
  var dest = cfg.destinationUrl || 'https://ambientpixels.ai/pixel-agents/run.html?agent=resume-roast';
  // tone is stamped by filterRoastProspects. Absent (older queued prospects, hand-made
  // fixtures) → re-derive rather than defaulting to 'none', so a distress post that
  // predates this gate does not get a pitch on its way through.
  var tone = prospect.tone || targetTone(prospect.postText);
  var noPitch = (tone === 'distress');
  return {
    id: 'task_' + nowMs + '_roast_' + Math.random().toString(36).substring(2, 6),
    title: 'Roast-lane reply to @' + prospect.author + (noPitch ? ' (support reply — no pitch)' : ' (resume roast prospect)'),
    description: noPitch
      // Empathy-only variant. The link is not merely discouraged here, it is absent —
      // the drafter cannot paste a URL it was never given, and agent-runner's link
      // repair keys off task.destinationUrl, which this task deliberately omits.
      ? 'SUPPORT REPLY — THIS POST CARRIES DISTRESS. NO PITCH, NO LINK, NO PRODUCT.\n'
        + '- Their post (verbatim): "' + prospect.postText + '"\n'
        + '- You are replying AS the AmbientPixels founder account.\n\n'
        + 'RULES:\n'
        + '- Acknowledge their specific situation in their own words. That is the whole reply.\n'
        + '- Mention NO product, NO tool, NO offer, and include NO link of any kind. There is '
        + 'nothing to sell here and trying to is the failure this rule exists to prevent.\n'
        + '- Do not give unsolicited advice. Do not tell them what their resume probably needs.\n'
        + '- If you cannot say something warm and specific without selling, output an EMPTY '
        + 'deliverable to decline. Declining is a correct outcome, not a failed task.\n'
        + '- Founder voice: under 280 chars, no em dashes, no hype, 5th grade reading level.\n\n'
        + 'Output ONLY the reply text itself. No title, no "Reply:" label, no preamble.'
      : 'PROSPECT FACT SHEET (use ONLY these facts)\n'
        + '- Their post (verbatim): "' + prospect.postText + '"\n'
        + '- You are replying AS the AmbientPixels founder account.\n'
        + '- The offer: our free Resume Roast agent — paste a resume, get an ATS '
        + 'compatibility score and section-by-section feedback in seconds. Free runs, no signup.\n'
        + '- Link (copy EXACTLY, never shorten or prettify): ' + dest + '\n\n'
        + 'RULES:\n'
        + '- EMPATHY FIRST. Acknowledge their specific situation in their words before any offer.\n'
        + '- If the post is venting or grief with no ask for help, output an EMPTY deliverable '
        + 'to decline. Never pitch at raw pain.\n'
        + '- You have NOT seen their resume. Make NO claims about it — no scores, no findings, '
        + 'no "your resume probably...". The tool speaks after they run it, not you before.\n'
        + '- Do NOT mention pricing or paid tiers.\n'
        + '- Founder voice: under 280 chars, no em dashes, no hype, 5th grade reading level.\n\n'
        + 'Output ONLY the reply text itself. No title, no "Reply:" label, no preamble.',
    tone: tone,
    taskType: 'bluesky_reply',
    category: 'maintenance',
    status: 'todo',
    // High, not medium: MANDATORY PEER REVIEW claims Scribe's first action slot every
    // cycle unless she holds a high/critical task, and the cap is 3 actions. At medium
    // these replies never surfaced — 8 qualified prospects sat undrafted for up to four
    // days (2026-08-07 harvest: 0 replies sent since the lane opened 08-02). Outbound
    // replies are also time-sensitive; a four-day-old reply is a different, worse thing.
    priority: 'high',
    assignee: 'scribe',
    source: 'roastProspectCron',
    created_by: 'roastProspectCron',
    objective_id: 'obj-revenue-engine',
    // destinationUrl is the drafter-side link contract: agent-runner's repairReplyLink
    // GUARANTEES this URL ships in the reply and stamps a UTM after it. A support reply
    // must therefore not carry one, or the link lands back in the copy no matter what
    // the prompt said. null, not the dest string.
    destinationUrl: noPitch ? null : dest,
    createdAt: iso,
    updatedAt: iso,
    dueDate: new Date(nowMs + 3 * 86400e3).toISOString(),
    tags: noPitch ? ['bluesky-reply', 'roast-prospect', 'support-reply'] : ['bluesky-reply', 'roast-prospect'],
    threadContext: {
      uri: prospect.uri, cid: prospect.cid,
      author: prospect.author, authorDid: prospect.authorDid,
      originalText: prospect.postText,
      indexedAt: prospect.discoveredAt
    },
    comments: []
  };
}

var _ROAST_FILE = require('../_data/roast-prospect-keywords.json');

function _loadRoastConfig(systemConfig) {
  var file = _ROAST_FILE || {};
  var cfg = Object.assign({}, file.defaults || {});
  cfg.keywords = (file.keywords || []).slice();
  // Top-level file keys are not in `defaults`, so they must be copied across
  // explicitly — same pattern as cfg.ownDomains in the AS loader above.
  cfg.ownHandles = (file.ownHandles || []).slice();
  cfg.ownDomains = (file.ownDomains || []).slice();
  var over = (systemConfig && systemConfig.roastProspecting) || {};
  Object.keys(over).forEach(function (k) { cfg[k] = over[k]; });
  return cfg;
}

function _countRoastMintedToday(prospects, nowMs) {
  var today = _dayKey(new Date(nowMs).toISOString());
  return (prospects || []).filter(function (p) {
    return p && p.lane === 'resumeRoast' && p.promotedAt && _dayKey(p.promotedAt) === today;
  }).length;
}

// IO shell — runs after runProspectPipeline in the same cron. Ships DISABLED;
// flip systemConfig.roastProspecting = { enabled: true, ... } to start (no deploy).
async function runRoastLane(opts) {
  var storage = opts.storage;
  var log = opts.log || function () {};
  var nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  var discover = opts.discover || function (keywords) {
    var bd = require('../_utils/blueskyDiscovery');
    return bd.discoverAcrossKeywords(keywords, { maxAgeMinutes: 48 * 60, minReplies: 0, limitPerKeyword: 15 });
  };

  var systemConfig = (await storage.getState('systemConfig')) || {};
  var cfg = _loadRoastConfig(systemConfig);
  if (cfg.enabled !== true) { log('[roast-lane] disabled (systemConfig.roastProspecting.enabled !== true)'); return { skipped: 'disabled' }; }

  var prospects = (await storage.getState('asProspects')) || [];
  if (!Array.isArray(prospects)) prospects = [];
  var tasks = (await storage.getState('tasks')) || [];
  if (!Array.isArray(tasks)) tasks = [];
  var actions = (await storage.getState('actions')) || [];
  if (!Array.isArray(actions)) actions = [];

  var tasksDirty = false;
  var govEvents = [];
  var discovered = 0, minted = 0;

  // ── Pass 1: DISCOVER ──
  try {
    var candidates = await discover(cfg.keywords);
    var fresh = filterRoastProspects(candidates, prospects, cfg, nowMs);
    fresh.forEach(function (p) { prospects.push(p); discovered++; });
    if (discovered > 0) govEvents.push({ type: 'roast-prospect-discovered', data: { count: discovered } });
  } catch (dErr) {
    log('[roast-lane] discovery failed (non-fatal): ' + String(dErr && dErr.message || dErr).substring(0, 200));
  }

  // ── Pass 2: MINT reply tasks (carried backlog first, oldest first) ──
  // Two limits, and the tighter one wins.
  //
  // maxDraftsPerDay is a RATE, and a rate still accumulates whenever the drain rate
  // dips — which is how Scribe reached 55 open tasks against a drain of ~8/day. The
  // queue-depth check is the self-correcting half: it only reopens as Scribe actually
  // finishes things, so the lane slows itself when she is behind and speeds up when
  // she is not. Prospects are NOT dropped when it bites; they stay 'discovered' and
  // get minted on a later cycle, oldest first.
  var _cap = _BP.laneCapacity(tasks, 'scribe', 'bluesky_reply');
  var budget = Math.max(0, (Number.isFinite(cfg.maxDraftsPerDay) ? cfg.maxDraftsPerDay : 4) - _countRoastMintedToday(prospects, nowMs));
  if (_cap.remaining < budget) {
    log('[roast-lane] backpressure: scribe holds ' + _cap.open + '/' + _cap.depth
      + ' open reply tasks, minting ' + _cap.remaining + ' instead of ' + budget);
    budget = _cap.remaining;
  }
  var queue = prospects.filter(function (p) { return p && p.lane === 'resumeRoast' && p.status === 'discovered'; });
  for (var i = 0; i < queue.length && budget > 0; i++) {
    var p = queue[i];
    var task = buildRoastReplyTask(p, cfg, nowMs);
    tasks.push(task);
    tasksDirty = true;
    p.taskId = task.id;
    p.status = 'task_ready';
    p.promotedAt = new Date(nowMs).toISOString();
    minted++;
    budget--;
    log('[roast-lane] minted reply task for @' + p.author);
  }
  if (minted > 0) govEvents.push({ type: 'roast-outreach-ready', data: { count: minted } });

  // ── Pass 3: TRACK / PRUNE (shared, lane-agnostic) ──
  var kept = reconcile(prospects, tasks, actions, nowMs);

  await storage.setState('asProspects', kept);
  if (tasksDirty) await storage.setState('tasks', tasks);

  if (govEvents.length > 0) {
    try {
      var gov = (await storage.getState('governanceLog')) || [];
      govEvents.forEach(function (e) {
        gov.push({ id: 'gov-' + nowMs + '-' + Math.random().toString(36).substring(2, 6),
          type: e.type, data: e.data, timestamp: new Date(nowMs).toISOString() });
      });
      await storage.setState('governanceLog', gov.slice(-500));
    } catch (_e) { /* non-fatal */ }
  }

  var summary = { discovered: discovered, minted: minted, total: kept.length };
  log('[roast-lane] run complete: ' + JSON.stringify(summary));
  return summary;
}

module.exports = {
  findBlockingReply: findBlockingReply,
  extractSiteUrl: extractSiteUrl,
  filterProspects: filterProspects,
  buildReplyTask: buildReplyTask,
  buildScanJob: buildScanJob,
  promoteReady: promoteReady,
  sweepOrphans: sweepOrphans,
  reconcile: reconcile,
  repairReplyLink: repairReplyLink,
  repairReplyLinkTo: repairReplyLinkTo,
  filterRoastProspects: filterRoastProspects,
  buildRoastReplyTask: buildRoastReplyTask,
  _hasResumeIntent: _hasResumeIntent,
  targetTone: targetTone,
  _isUnsuitableTopic: _isUnsuitableTopic,
  runRoastLane: runRoastLane,
  runProspectPipeline: runProspectPipeline
};
