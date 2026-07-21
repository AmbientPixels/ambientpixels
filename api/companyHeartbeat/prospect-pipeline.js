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
  (Array.isArray(candidate.links) ? candidate.links : []).forEach(function (u) { pool.push(u); });
  var m = String(candidate.text || '').match(_URL_RE) || [];
  m.forEach(function (u) { pool.push(u); });
  for (var i = 0; i < pool.length; i++) {
    var raw = String(pool[i]).replace(/[.,!?;:)\]]+$/, '');
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
  var cooldownMs = (cfg.domainCooldownDays || 30) * 86400e3;
  existing.forEach(function (p) {
    if (!p || !p.domain) return;
    var t = Date.parse(p.discoveredAt || 0);
    if (Number.isFinite(t) && nowMs - t < cooldownMs) seenDomains[p.domain] = true;
  });

  var budget = Math.max(0, (cfg.maxScansPerDay || 3) - _countScansToday(existing, nowMs));
  var maxAgeMs = (cfg.maxPostAgeHours || 24) * 3600e3;

  for (var i = 0; i < (candidates || []).length && out.length < budget; i++) {
    var c = candidates[i];
    if (!c || !c.uri || !c.cid || !c.author) continue;
    var t = Date.parse(c.indexedAt || 0);
    if (!Number.isFinite(t) || nowMs - t > maxAgeMs) continue;
    if (((c.likeCount || 0) + (c.replyCount || 0)) < (cfg.minEngagement || 1)) continue;
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

module.exports = { extractSiteUrl: extractSiteUrl, filterProspects: filterProspects };
