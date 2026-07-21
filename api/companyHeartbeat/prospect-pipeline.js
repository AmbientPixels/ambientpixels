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

module.exports = {
  extractSiteUrl: extractSiteUrl,
  filterProspects: filterProspects,
  buildReplyTask: buildReplyTask,
  buildScanJob: buildScanJob,
  promoteReady: promoteReady
};
