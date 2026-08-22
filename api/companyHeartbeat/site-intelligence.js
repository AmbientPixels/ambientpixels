// site-intelligence.js — extracted from companyHeartbeat/index.js (Phase 2 refactor)
// Fetches real telemetry, social metrics, deploy config; formats for agent prompts

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { WORKSPACE_ROOT } = require('./constants');

// ── Fetch real telemetry, social metrics, deploy config ──
async function _fetchSiteIntel(context, storage) {
  const si = { telemetry: null, socialMetrics: null, deployConfig: null };

  // 1) Application Insights telemetry (same source as telemetrySummary API)
  const aiAppId = process.env.APPINSIGHTS_APP_ID || '';
  const aiKey = process.env.APPINSIGHTS_API_KEY || '';
  if (aiAppId && aiKey) {
    try {
      const kustoUrl = 'https://api.applicationinsights.io/v1/apps/' + aiAppId + '/query';
      const timespan = 'P7D';
      const queries = [
        // Top pages
        'pageViews | extend cleanUrl = tostring(split(url, "?")[0]) | summarize views = count() by path = cleanUrl | top 10 by views desc',
        // Top referrers
        'pageViews | extend ref = tostring(customDimensions["refUri"]) | where isnotempty(ref) | extend refHost = tostring(parse_url(ref).Host) | where refHost != "ambientpixels.ai" and refHost != "www.ambientpixels.ai" and refHost != "" | summarize sessions = dcount(session_Id) by referrer = refHost | top 10 by sessions desc',
        // Performance — HUMAN page loads only, with the sample size carried alongside.
        //
        // 2026-08-22: this query had no bot filter and no count, and it drove a RED
        // p95 alert that Forge escalated every six hours for five days as "a critical
        // architectural failure" requiring an Azure Durable Functions migration.
        // Measured that day: 83 pageviews in 7d, of which ~61 were crawlers. Applebot
        // alone was n=9 with p95=16102ms and WAS the entire alert — the exact figures
        // Forge kept quoting (14207, 12986) are individual Applebot page loads. Real
        // function latency over the same window was p95=921ms across 8516 requests,
        // with 2 FunctionTimeoutExceptions total. There was no latency problem.
        //
        // Two things were wrong and both are fixed here: bots dominate a low-traffic
        // site's tail, and a p95 over 83 samples is the 4th slowest row, not a
        // percentile. `n` is returned so the alert layer can refuse to fire on a
        // sample too small to mean anything (see SAMPLE_FLOOR in ops-intel.js).
        // !contains, NOT !has. Kusto's `has` matches whole TOKENS, so `has "bot"`
        // never matches "Googlebot 2.1" — the token there is "Googlebot". The first
        // version of this filter used !has, excluded exactly zero crawlers, and the
        // fleet went right on reporting p95=14207ms from Applebot. Verified against
        // live App Insights: !has leaves n=83, !contains gives n=22.
        'pageViews | where client_Type == "Browser" and client_Browser !contains "bot" and client_Browser !contains "spider" and client_Browser !contains "crawl" and client_Browser !contains "headless" | summarize n = count(), p50 = percentile(duration, 50), p95 = percentile(duration, 95)',
        // Errors
        'exceptions | summarize count_ = count() by name = type | top 5 by count_ desc',
        // Request volume — the DENOMINATOR for the error count above (2026-08-22).
        // Without it the digest reported "10 errors" as a bare figure and Forge
        // escalated it as a stability crisis; against 9363 requests it is 0.107%,
        // and the request failure rate is 0.053%. A count with no denominator is
        // not a signal, it is a number an agent will find a reason to act on.
        'requests | summarize n = count(), failed = countif(success == false)'
      ];
      const results = await Promise.all(queries.map(q =>
        fetch(kustoUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': aiKey },
          body: JSON.stringify({ query: q, timespan: timespan })
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      ));
      const _parseKusto = (result) => {
        if (!result || !result.tables || !result.tables[0]) return [];
        const cols = (result.tables[0].columns || []).map(c => c.name);
        return (result.tables[0].rows || []).map(row => {
          const obj = {};
          cols.forEach((name, i) => { obj[name] = row[i]; });
          return obj;
        });
      };
      const pages = _parseKusto(results[0]).map(r => ({ path: r.path || '/', views: r.views || 0 }));
      const referrers = _parseKusto(results[1]).map(r => ({ referrer: r.referrer || '', sessions: r.sessions || 0 }));
      const perfRows = _parseKusto(results[2]);
      const perf = perfRows.length > 0
        ? { n: perfRows[0].n || 0, p50: Math.round(perfRows[0].p50 || 0), p95: Math.round(perfRows[0].p95 || 0) }
        : null;
      const errors = _parseKusto(results[3]).map(r => ({ name: r.name || 'Unknown', count: r.count_ || 0 }));
      const reqRows = _parseKusto(results[4]);
      const requests = reqRows.length > 0
        ? { n: reqRows[0].n || 0, failed: reqRows[0].failed || 0 }
        : null;

      si.telemetry = { range: '7d', topPages: pages, topReferrers: referrers, performance: perf, errors: errors, requests: requests };
    } catch (telErr) {
      context.log('[Heartbeat] Telemetry fetch failed (non-fatal):', telErr.message);
    }
  }

  // 2) Social metrics from storage
  try {
    const rawEvents = (await storage.getState('socialMetricsEvents')) || [];
    if (Array.isArray(rawEvents) && rawEvents.length > 0) {
      const now = Date.now();
      const weekAgo = now - 7 * 86400000;
      const recent = rawEvents.filter(e => e.timestamp && new Date(e.timestamp).getTime() > weekAgo);
      const byPlatform = {};
      for (const e of recent) {
        const p = e.platform || 'unknown';
        if (!byPlatform[p]) byPlatform[p] = { posted: 0, failed: 0 };
        if (e.status === 'success' || e.status === 'posted') byPlatform[p].posted++;
        else if (e.status === 'error' || e.status === 'failed') byPlatform[p].failed++;
      }
      if (Object.keys(byPlatform).length > 0) {
        si.socialMetrics = { range: '7d', total: recent.length, byPlatform: byPlatform };
      }
    }
  } catch (smErr) {
    context.log('[Heartbeat] Social metrics fetch failed (non-fatal):', smErr.message);
  }

  // 3) Deployment config from filesystem
  try {
    const swaPath = path.resolve(WORKSPACE_ROOT, 'staticwebapp.config.json');
    if (fs.existsSync(swaPath)) {
      const raw = JSON.parse(fs.readFileSync(swaPath, 'utf8'));
      si.deployConfig = {
        routeCount: Array.isArray(raw.routes) ? raw.routes.length : 0,
        hasAuth: !!(raw.auth),
        hasHeaders: !!(raw.globalHeaders || raw.responseOverrides),
        platform: raw.platform || 'Azure Static Web Apps',
        navigationFallback: raw.navigationFallback || null,
        apiRoutes: Array.isArray(raw.routes) ? raw.routes.filter(r => r.route && r.route.startsWith('/api')).map(r => r.route).slice(0, 15) : []
      };
    }
  } catch (dcErr) {
    context.log('[Heartbeat] Deploy config read failed (non-fatal):', dcErr.message);
  }

  return si;
}

// ── Format site intel into prompt section based on agent role + task keywords ──
function _buildSiteIntelSection(agent, task, siteIntel) {
  if (!siteIntel) return '';
  const combined = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
  const sections = [];

  // Telemetry: inject for analytics/traffic/performance tasks, or for Forge/Scout/Echo/Nova
  const _wantsTelemetry = siteIntel.telemetry && (
    agent.name === 'Forge' || agent.name === 'Scout' || agent.name === 'Echo' || agent.name === 'Nova' ||
    /traffic|analytics|performance|seo|page.?load|error|monitor|audit|metric/.test(combined)
  );
  if (_wantsTelemetry) {
    const t = siteIntel.telemetry;
    let s = '\n📊 REAL SITE ANALYTICS (Application Insights, last 7 days — do NOT fabricate traffic numbers):';
    if (t.topPages && t.topPages.length > 0) {
      s += '\nTop Pages: ' + t.topPages.slice(0, 7).map(p => p.path + ' (' + p.views + ' views)').join(' | ');
    }
    if (t.topReferrers && t.topReferrers.length > 0) {
      s += '\nTop Referrers: ' + t.topReferrers.slice(0, 5).map(r => r.referrer + ' (' + r.sessions + ' sessions)').join(' | ');
    }
    if (t.performance) {
      s += '\nPage Load: p50=' + t.performance.p50 + 'ms, p95=' + t.performance.p95 + 'ms';
    }
    if (t.errors && t.errors.length > 0) {
      s += '\nTop Errors: ' + t.errors.map(e => e.name + ' (' + e.count + 'x)').join(' | ');
    }
    sections.push(s);
  }

  // Social metrics: inject for Echo (Marketing) or social-related tasks
  const _wantsSocial = siteIntel.socialMetrics && (
    agent.name === 'Echo' ||
    /social|linkedin|twitter|bluesky|post|campaign|engagement/.test(combined)
  );
  if (_wantsSocial) {
    const sm = siteIntel.socialMetrics;
    let s = '\n📱 REAL SOCIAL METRICS (last 7 days — do NOT fabricate engagement numbers):';
    s += '\nTotal events: ' + sm.total;
    for (const [platform, counts] of Object.entries(sm.byPlatform)) {
      s += '\n- ' + platform + ': ' + counts.posted + ' posted, ' + counts.failed + ' failed';
    }
    sections.push(s);
  }

  // Deploy config: inject for Forge or deployment/infrastructure tasks
  const _wantsDeploy = siteIntel.deployConfig && (
    agent.name === 'Forge' ||
    /deploy|infra|config|route|azure|hosting|security|header|auth/.test(combined)
  );
  if (_wantsDeploy) {
    const dc = siteIntel.deployConfig;
    let s = '\n🚀 REAL DEPLOYMENT CONFIG (staticwebapp.config.json):';
    s += '\nPlatform: ' + dc.platform + ' | Routes: ' + dc.routeCount + ' | Auth: ' + (dc.hasAuth ? 'Yes' : 'No') + ' | Custom headers: ' + (dc.hasHeaders ? 'Yes' : 'No');
    if (dc.navigationFallback) {
      s += '\nSPA fallback: ' + (dc.navigationFallback.rewrite || 'none');
    }
    if (dc.apiRoutes.length > 0) {
      s += '\nAPI routes: ' + dc.apiRoutes.join(', ');
    }
    sections.push(s);
  }

  return sections.length > 0 ? sections.join('\n') + '\n' : '';
}

// ── Format rich social intel digest for execute/review prompts ──
function _buildSocialIntelExecSection(agent, task, socialIntel) {
  if (!socialIntel) return '';
  const combined = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();

  // Determine if this agent/task needs social intel
  const alwaysShow = agent.name === 'Echo' || agent.name === 'Nova' || agent.name === 'Scout';
  const taskWants = /social|linkedin|twitter|bluesky|post|campaign|engagement|audience|content|brand/.test(combined);
  if (!alwaysShow && !taskWants) return '';

  const parts = [];
  parts.push('\n📱 REAL SOCIAL MEDIA DATA (live from platform APIs — do NOT fabricate engagement numbers):');

  // Account / followers
  const acct = socialIntel.account || {};
  const followers = acct.followers || {};
  if (followers.total > 0) {
    parts.push('Followers: X=' + (followers.x || 0) + ', LinkedIn=' + (followers.linkedin || 0) + ', Bluesky=' + (followers.bluesky || 0) + ' (total: ' + followers.total + ')');
  }

  // Delivery stats
  const del = socialIntel.delivery || {};
  if (del.successRate7d !== undefined) {
    parts.push('Delivery (7d): ' + del.successRate7d + '% success rate, ' + (del.publishedToday || 0) + ' posted today, ' + (del.failures24h || 0) + ' failures last 24h' + (del.topIssue24h ? ', top issue: ' + del.topIssue24h : ''));
  }

  // Engagement by platform
  const byPlatform = (socialIntel.engagement && socialIntel.engagement.byPlatform) || {};
  const platformNames = Object.keys(byPlatform);
  if (platformNames.length > 0) {
    parts.push('Engagement (7d):');
    for (const pName of platformNames) {
      const p = byPlatform[pName] || {};
      parts.push('  ' + pName + ': ' + (p.likes7d || 0) + ' likes, ' + (p.comments7d || 0) + ' comments, ' + (p.reposts7d || 0) + ' reposts (' + (p.posts7d || 0) + ' posts)');
    }
  }

  // Top performing posts
  const topPosts = (socialIntel.topPosts7d || []).slice(0, 3);
  if (topPosts.length > 0) {
    parts.push('Top Posts (7d):');
    for (const tp of topPosts) {
      parts.push('  - ' + (tp.platform || '?') + ': ' + (tp.likes || 0) + ' likes, ' + (tp.comments || 0) + ' comments, ' + (tp.reposts || 0) + ' reposts' + (tp.post_url ? ' (' + tp.post_url + ')' : ''));
    }
  }

  // Recommendations
  const recs = (socialIntel.recommendations || []).slice(0, 3);
  if (recs.length > 0 && (agent.name === 'Echo' || agent.name === 'Nova')) {
    parts.push('Recommendations: ' + recs.join(' | '));
  }

  // Mode warning
  if (socialIntel.mode && socialIntel.mode !== 'real') {
    parts.push('⚠ Data is mock/fallback — do not base strategy solely on these numbers.');
  }

  if (socialIntel.lastPulledAt) {
    parts.push('Last pulled: ' + socialIntel.lastPulledAt);
  }

  return parts.join('\n') + '\n';
}

module.exports = {
  _fetchSiteIntel,
  _buildSiteIntelSection,
  _buildSocialIntelExecSection
};
