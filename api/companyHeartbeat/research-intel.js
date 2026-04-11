// research-intel.js — Scout's research demand digest builder
// Aggregates cross-agent signals into a Research Demand Dashboard

var { RESEARCH_DEMAND_WINDOW_DAYS, RESEARCH_DEMAND_MAX_SIGNALS, RESEARCH_STALE_THRESHOLD_DAYS, RESEARCH_COMPETITIVE_GAP_DAYS } = require('./constants');

// Products and their competitive landscapes
var PRODUCT_COMPETITORS = {
  'Blindspot':    'browser-based games, .io games, arena combat card games',
  'AmbientScore': 'website audit tools, conversion optimization tools, Lighthouse alternatives',
  'CardForge':    'RPG card creators, online card makers, tabletop design tools',
  'PixelAgents':  'AI agent platforms, GPT marketplaces, agent-as-a-service',
  'StoryForge':   'interactive fiction games, AI narrative tools, text adventure platforms',
  'AmbientOS':    'AI orchestration platforms, multi-agent frameworks, AI operations tools'
};

function buildResearchDemandDigest(socialIntel, forgeOpsDigest, financeDigest, performanceDigest, tasks, researchIntelStore, campaigns, _skillsDataUnused, nowMs) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  var allTasks = Array.isArray(tasks) ? tasks : [];
  var intel = Array.isArray(researchIntelStore) ? researchIntelStore : [];
  var windowMs = RESEARCH_DEMAND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  var windowCutoff = now - windowMs;

  // ── Demand Signals (from other agents' dashboards) ──
  var signals = [];

  // Echo: declining platforms
  if (socialIntel && socialIntel.deltas) {
    var d = socialIntel.deltas;
    ['x', 'linkedin', 'bluesky'].forEach(function (p) {
      var fDelta = (d.followers && d.followers[p]) || 0;
      var eDelta = (d.engagement && d.engagement[p]) || 0;
      if (fDelta < -5 || eDelta < -10) {
        signals.push({
          source: 'echo', type: 'platform_health',
          urgency: (fDelta < -10 || eDelta < -20) ? 'high' : 'medium',
          signal: p + ' declining (' + (fDelta !== 0 ? 'followers ' + fDelta + '%' : '') + (eDelta !== 0 ? ' engagement ' + eDelta + '%' : '') + ' wow)',
          suggestedResearch: 'Research ' + p + ' growth strategies for creative-tech brands'
        });
      }
    });
  }

  // Cipher: negative ROI campaigns
  if (financeDigest && Array.isArray(financeDigest.campaignROI)) {
    financeDigest.campaignROI.forEach(function (c) {
      if (c.signal === 'NEGATIVE') {
        signals.push({
          source: 'cipher', type: 'campaign_roi',
          urgency: 'medium',
          signal: 'Campaign "' + c.title + '" ROI NEGATIVE (est. $' + c.estimatedCost + ', ' + c.engagement + ' engagement)',
          suggestedResearch: 'Market validation for campaign topic: ' + c.title
        });
      }
    });
  }

  // Forge: RED alerts
  if (forgeOpsDigest && Array.isArray(forgeOpsDigest.alerts)) {
    forgeOpsDigest.alerts.forEach(function (a) {
      if (a.level === 'RED') {
        signals.push({
          source: 'forge', type: 'ops_alert',
          urgency: 'high',
          signal: a.signal,
          suggestedResearch: 'Root cause analysis: ' + a.signal
        });
      }
    });
  }

  // Cap signals
  signals = signals.slice(0, RESEARCH_DEMAND_MAX_SIGNALS);

  // ── Research Requests (from task comments) ──
  var requests = [];
  var requestPatterns = [
    /research request for scout[:\s]+(.{10,200})/i,
    /request scout research[:\s]+(.{10,200})/i,
    /need(?:s|ed)?\s+(?:competitive|market|research)\s+(?:intel|research|analysis)[:\s]+(.{10,200})/i
  ];

  allTasks.forEach(function (t) {
    if (!t.comments || t.assignee === 'scout') return;
    t.comments.forEach(function (c) {
      if (!c.text || c.author === 'scout' || c.author === 'system') return;
      var ts = Date.parse(c.createdAt || '');
      if (!Number.isFinite(ts) || ts < windowCutoff) return;
      for (var i = 0; i < requestPatterns.length; i++) {
        var match = c.text.match(requestPatterns[i]);
        if (match) {
          requests.push({
            from: c.author || 'unknown',
            taskId: t.id,
            taskTitle: (t.title || '').substring(0, 60),
            request: match[1].trim().substring(0, 200),
            daysAgo: Math.round((now - ts) / (24 * 60 * 60 * 1000))
          });
          break;
        }
      }
    });
  });
  requests = requests.slice(0, 5);

  // ── Prioritized Backlog ──
  var scoutBacklog = allTasks.filter(function (t) {
    return t.assignee === 'scout' && (t.status === 'backlog' || t.status === 'todo');
  });

  var prioritized = scoutBacklog.map(function (t) {
    var title = (t.title || '').toLowerCase();
    var urgency = 0;
    var impact = 0;
    var freshness = 0;

    // Urgency: does a demand signal or request match?
    signals.forEach(function (s) {
      if (title.indexOf(s.suggestedResearch.toLowerCase().split(' ').slice(0, 3).join(' ')) !== -1) urgency = 3;
    });
    requests.forEach(function (r) {
      if (title.indexOf(r.request.toLowerCase().split(' ').slice(0, 3).join(' ')) !== -1) urgency = Math.max(urgency, 2);
    });

    // Impact: relates to active campaign?
    var activeCamps = Array.isArray(campaigns) ? campaigns.filter(function (c) { return c.status === 'active'; }) : [];
    activeCamps.forEach(function (c) {
      var campTitle = (c.title || '').toLowerCase();
      var overlap = campTitle.split(/\s+/).filter(function (w) { return w.length > 3 && title.indexOf(w) !== -1; }).length;
      if (overlap >= 2) impact = 3;
      else if (overlap >= 1) impact = Math.max(impact, 1);
    });

    // Freshness: existing intel stale?
    var topicWords = title.split(/\s+/).filter(function (w) { return w.length > 3; });
    var hasRecentIntel = intel.some(function (r) {
      var rTitle = ((r.title || '') + ' ' + (r.summary || '')).toLowerCase();
      var ts = Date.parse(r.created_at || r.timestamp || '');
      if (!Number.isFinite(ts)) return false;
      var age = (now - ts) / (24 * 60 * 60 * 1000);
      if (age > RESEARCH_STALE_THRESHOLD_DAYS) return false;
      var matchWords = topicWords.filter(function (w) { return rTitle.indexOf(w) !== -1; }).length;
      return matchWords >= 2;
    });
    if (!hasRecentIntel) freshness = 2;

    return {
      taskId: t.id,
      title: (t.title || '').substring(0, 60),
      score: urgency + impact + freshness,
      urgency: urgency,
      impact: impact,
      freshness: freshness,
      reason: (urgency >= 2 ? 'agent waiting' : '') + (impact >= 2 ? (urgency >= 2 ? ' + ' : '') + 'active campaign' : '') + (freshness >= 2 ? ((urgency >= 2 || impact >= 2) ? ' + ' : '') + 'stale intel' : '') || 'backlog'
    };
  });
  prioritized.sort(function (a, b) { return b.score - a.score; });

  // ── Competitive Gaps ──
  var gaps = [];
  var gapCutoff = now - (RESEARCH_COMPETITIVE_GAP_DAYS * 24 * 60 * 60 * 1000);
  var products = Object.keys(PRODUCT_COMPETITORS);
  products.forEach(function (prod) {
    var prodLower = prod.toLowerCase();
    var hasRecent = intel.some(function (r) {
      var rText = ((r.title || '') + ' ' + (r.summary || '') + ' ' + ((r.impact_tags || r.tags || []).join(' '))).toLowerCase();
      var ts = Date.parse(r.created_at || r.timestamp || '');
      if (!Number.isFinite(ts) || ts < gapCutoff) return false;
      return rText.indexOf(prodLower) !== -1 || rText.indexOf('competitive') !== -1 && rText.indexOf(prodLower) !== -1;
    });
    if (!hasRecent) {
      gaps.push({ product: prod, competitors: PRODUCT_COMPETITORS[prod], daysSinceLastResearch: '30+' });
    }
  });

  // ── Research Impact ──
  var totalIntel = intel.length;
  var cited = 0;
  var topCited = null;
  intel.forEach(function (r) {
    var rTitle = (r.title || '').toLowerCase();
    // Check if any campaigns were sourced from this research
    var wasCited = false;
    if (Array.isArray(campaigns)) {
      wasCited = campaigns.some(function (c) {
        return c.source_trend && rTitle.indexOf(c.source_trend.toLowerCase()) !== -1;
      });
    }
    // Check if any done tasks reference this research
    if (!wasCited) {
      wasCited = allTasks.some(function (t) {
        if (t.status !== 'done' || !t.comments) return false;
        return t.comments.some(function (c) {
          return c.text && c.text.toLowerCase().indexOf(rTitle.substring(0, 30)) !== -1;
        });
      });
    }
    if (wasCited) {
      cited++;
      if (!topCited) topCited = (r.title || '').substring(0, 60);
    }
  });

  var citationRate = totalIntel > 0 ? Math.round((cited / totalIntel) * 100) : 0;

  // ── Alerts ──
  var alerts = [];
  signals.filter(function (s) { return s.urgency === 'high'; }).forEach(function (s) {
    alerts.push({ level: 'HIGH', signal: s.source + ': ' + s.signal, action: s.suggestedResearch });
  });
  if (requests.length > 0) {
    alerts.push({ level: 'MEDIUM', signal: requests.length + ' pending research request(s) from other agents', action: 'Address within 2 heartbeat cycles' });
  }
  if (gaps.length >= 3) {
    alerts.push({ level: 'MEDIUM', signal: gaps.length + ' products with no competitive intel in 30d', action: 'Prioritize competitive research' });
  }

  return {
    asOfUtc: new Date(now).toISOString(),
    demandSignals: signals,
    researchRequests: requests,
    prioritizedBacklog: prioritized.slice(0, 6),
    competitiveGaps: gaps,
    impactMetrics: { total: totalIntel, cited: cited, citationRate: citationRate, topCited: topCited },
    alerts: alerts
  };
}

function _buildResearchDemandPromptBlock(agent, digest) {
  if (!digest || !agent || agent.id !== 'scout') return '';

  var signals = digest.demandSignals || [];
  var requests = digest.researchRequests || [];
  var backlog = digest.prioritizedBacklog || [];
  var gaps = digest.competitiveGaps || [];
  var impact = digest.impactMetrics || {};
  var alerts = digest.alerts || [];

  var lines = ['\n\nRESEARCH DEMAND DASHBOARD (cross-agent signals):'];

  // Demand signals
  if (signals.length > 0) {
    lines.push('\nDEMAND SIGNALS (other agents need research):');
    signals.forEach(function (s) {
      lines.push('- [' + s.urgency.toUpperCase() + '] ' + s.source + ': ' + s.signal + ' → ' + s.suggestedResearch);
    });
  }

  // Research requests
  if (requests.length > 0) {
    lines.push('\nRESEARCH REQUESTS (from agent comments):');
    requests.forEach(function (r) {
      lines.push('- ' + r.from + ' (' + r.daysAgo + 'd ago): "' + r.request + '"');
    });
  }

  // Prioritized backlog
  if (backlog.length > 0) {
    lines.push('\nPRIORITIZED BACKLOG (your queue, ranked):');
    backlog.forEach(function (b, i) {
      lines.push((i + 1) + '. [Score ' + b.score + '] "' + b.title + '"' + (b.reason !== 'backlog' ? ' — ' + b.reason : ''));
    });
  }

  // Competitive gaps
  if (gaps.length > 0) {
    lines.push('\nCOMPETITIVE GAPS (products without recent intel):');
    gaps.forEach(function (g) {
      lines.push('- ' + g.product + ': no competitive research in ' + g.daysSinceLastResearch + ' days (vs: ' + g.competitors + ')');
    });
  }

  // Research impact
  lines.push('\nRESEARCH IMPACT (30d): ' + impact.cited + '/' + impact.total + ' findings cited (' + impact.citationRate + '%)' + (impact.topCited ? ' — top: "' + impact.topCited + '"' : ''));
  if (impact.citationRate < 30 && impact.total >= 5) {
    lines.push('  Citation rate low — focus on specific, actionable intel (competitor names, pricing, feature comparisons)');
  }

  // Alerts
  if (alerts.length > 0) {
    lines.push('\nPRIORITY ALERTS:');
    alerts.forEach(function (a) {
      lines.push('- [' + a.level + '] ' + a.signal + ' → ' + a.action);
    });
  }

  return lines.join('\n');
}

module.exports = {
  buildResearchDemandDigest: buildResearchDemandDigest,
  _buildResearchDemandPromptBlock: _buildResearchDemandPromptBlock
};
