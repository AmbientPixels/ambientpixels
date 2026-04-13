// companyTrendIngest — Timer-triggered trend data ingestion via Gemini
// Runs every 6 hours. Fetches current technology trends, normalizes, and stores in trendRadar.

const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';

const MAX_RADAR_SNAPSHOTS = 30; // keep last 30 ingestion runs
const CATEGORY_IDS = ['ai_ml', 'devtools', 'design', 'marketing', 'infrastructure', 'product'];
const WEIGHTS = { searchGrowth: 0.4, socialVelocity: 0.4, devActivity: 0.2 };

// ── GitHub Trending Signal Fetch ──

async function fetchGithubTrending(log) {
  try {
    var res = await fetch('https://github-trending-api.now.sh/repositories?since=daily', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) {
      log('[TrendIngest] GitHub Trending API returned ' + res.status + ' — skipping');
      return null;
    }
    var repos = await res.json();
    if (!Array.isArray(repos) || !repos.length) return null;
    return repos.slice(0, 10).map(function (r) {
      return r.name + ' (' + (r.language || 'unknown') + ', +' + (r.currentPeriodStars || r.starsToday || 0) + ' stars today)';
    });
  } catch (e) {
    log('[TrendIngest] GitHub Trending fetch failed (non-fatal): ' + e.message);
    return null;
  }
}

// ── HackerNews Signal Fetch ──

async function fetchHNSignals(log) {
  try {
    var res = await fetch('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) {
      log('[TrendIngest] HackerNews API returned ' + res.status + ' — skipping');
      return null;
    }
    var data = await res.json();
    if (!data || !Array.isArray(data.hits) || !data.hits.length) return null;
    return data.hits.slice(0, 15).map(function (h) {
      return h.title + (h.points ? ' (' + h.points + ' pts, ' + (h.num_comments || 0) + ' comments)' : '');
    });
  } catch (e) {
    log('[TrendIngest] HackerNews fetch failed (non-fatal): ' + e.message);
    return null;
  }
}

// ── Reddit Signal Fetch ──

async function fetchRedditSignals(log) {
  try {
    var res = await fetch(
      'https://www.reddit.com/r/MachineLearning+technology+programming+webdev.json?sort=hot&limit=25&t=day',
      { method: 'GET', headers: { 'Accept': 'application/json', 'User-Agent': 'AmbientPixels/TrendIngest/1.0' } }
    );
    if (!res.ok) {
      log('[TrendIngest] Reddit API returned ' + res.status + ' — skipping');
      return null;
    }
    var data = await res.json();
    var posts = data && data.data && Array.isArray(data.data.children) ? data.data.children : [];
    if (!posts.length) return null;
    return posts.slice(0, 15).map(function (p) {
      var d = p.data || {};
      return d.title + ' (' + (d.score || 0) + ' pts, r/' + (d.subreddit || 'unknown') + ')';
    }).filter(Boolean);
  } catch (e) {
    log('[TrendIngest] Reddit fetch failed (non-fatal): ' + e.message);
    return null;
  }
}

// ── DEV.to Signal Fetch ──

async function fetchDevToSignals(log) {
  try {
    var res = await fetch('https://dev.to/api/articles?top=1&per_page=15', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) {
      log('[TrendIngest] DEV.to API returned ' + res.status + ' — skipping');
      return null;
    }
    var articles = await res.json();
    if (!Array.isArray(articles) || !articles.length) return null;
    return articles.slice(0, 12).map(function (a) {
      return a.title + (a.positive_reactions_count ? ' (' + a.positive_reactions_count + ' reactions)' : '');
    }).filter(Boolean);
  } catch (e) {
    log('[TrendIngest] DEV.to fetch failed (non-fatal): ' + e.message);
    return null;
  }
}

// ── Cross-Source Cluster Builder ──

var CLUSTER_STOP_WORDS = new Set([
  'with', 'from', 'that', 'this', 'have', 'been', 'will', 'your', 'using', 'build',
  'make', 'show', 'more', 'into', 'what', 'when', 'year', 'week', 'just', 'also',
  'like', 'they', 'them', 'open', 'free', 'news', 'week', 'here', 'some', 'about',
  'how', 'new', 'for', 'the', 'and', 'but', 'not', 'are', 'was', 'its', 'all', 'can'
]);

function buildClusterSection(githubLines, hnLines, redditLines, devtoLines) {
  var kwMap = {};

  function addLines(lines, source) {
    if (!Array.isArray(lines)) return;
    lines.forEach(function (line) {
      String(line).toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(function (w) { return w.length >= 4 && !CLUSTER_STOP_WORDS.has(w); })
        .forEach(function (w) {
          if (!kwMap[w]) kwMap[w] = new Set();
          kwMap[w].add(source);
        });
    });
  }

  addLines(githubLines, 'GitHub');
  addLines(hnLines, 'HN');
  addLines(redditLines, 'Reddit');
  addLines(devtoLines, 'DEV.to');

  var confirmed = [];
  Object.keys(kwMap).forEach(function (kw) {
    if (kwMap[kw].size >= 2) {
      confirmed.push(kw + ' [' + Array.from(kwMap[kw]).join('+') + ']');
    }
  });

  if (!confirmed.length) return '';
  return '\n\nCross-source confirmed signals (topics appearing in 2+ independent sources — treat as high-confidence):\n'
    + confirmed.slice(0, 25).join(', ')
    + '\n\nBoost scores for trends touching these keywords. Multi-source confirmation = real momentum.';
}

// ── Trend Delta Computation ──

var STAGE_TIERS = { early_signal: 0, emerging: 1, growing: 2, exploding: 3 };

function computeTrendDeltas(currentTrends, previousSnapshot) {
  if (!previousSnapshot || !Array.isArray(previousSnapshot.trends)) return currentTrends;
  var prevTrends = previousSnapshot.trends;

  currentTrends.forEach(function (t) {
    // Exact name match first, then partial word overlap
    var prev = prevTrends.find(function (p) {
      return p.name.toLowerCase() === t.name.toLowerCase();
    });
    if (!prev) {
      var tWords = t.name.toLowerCase().split(/\s+/).filter(function (w) { return w.length >= 4; });
      prev = prevTrends.find(function (p) {
        var pWords = p.name.toLowerCase().split(/\s+/);
        var overlap = tWords.filter(function (w) { return pWords.indexOf(w) !== -1; }).length;
        return overlap >= Math.max(1, Math.min(2, tWords.length - 1));
      });
    }

    if (prev) {
      t.previousScore = prev.score;
      t.scoreDelta = t.score - prev.score;
      var prevTier = STAGE_TIERS[prev.stage] || 0;
      var currTier = STAGE_TIERS[t.stage] || 0;
      t.risingFast = t.scoreDelta >= 10 || currTier > prevTier;
    } else {
      // New trend not seen before — flag if already at high momentum
      t.previousScore = null;
      t.scoreDelta = null;
      t.risingFast = t.stage === 'exploding';
    }
  });

  return currentTrends;
}

// ── Source Coverage Computation ──

function computeSourceCoverage(trends, githubLines, hnLines, redditLines, devtoLines) {
  var sources = {
    github: githubLines || [],
    hn:     hnLines     || [],
    reddit: redditLines || [],
    devto:  devtoLines  || []
  };

  return trends.map(function (t) {
    var nameParts = t.name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(function (w) { return w.length >= 3; });

    var coverage = [];
    Object.keys(sources).forEach(function (src) {
      var joined = sources[src].join(' ').toLowerCase();
      if (nameParts.some(function (w) { return joined.indexOf(w) !== -1; })) {
        coverage.push(src);
      }
    });
    t.sourceCoverage = coverage;
    return t;
  });
}

// ── Trend Prompt Builder ──

function buildTrendPrompt(githubLines, hnLines, redditLines, devtoLines) {
  var githubSection = '';
  if (Array.isArray(githubLines) && githubLines.length > 0) {
    githubSection = '\n\nReal GitHub Trending data (today):\n'
      + githubLines.map(function (l, i) { return (i + 1) + '. ' + l; }).join('\n')
      + '\n\nUse these as ground truth for devActivity scores. Reference specific repos in signals where appropriate.';
  }

  var hnSection = '';
  if (Array.isArray(hnLines) && hnLines.length > 0) {
    hnSection = '\n\nHackerNews front page (today):\n'
      + hnLines.map(function (l, i) { return (i + 1) + '. ' + l; }).join('\n')
      + '\n\nUse to inform socialVelocity and searchGrowth. High-point HN posts = strong developer community interest.';
  }

  var redditSection = '';
  if (Array.isArray(redditLines) && redditLines.length > 0) {
    redditSection = '\n\nReddit hot posts across r/MachineLearning, r/technology, r/programming, r/webdev (today):\n'
      + redditLines.map(function (l, i) { return (i + 1) + '. ' + l; }).join('\n')
      + '\n\nUse to inform socialVelocity. High upvote posts = mainstream developer conversation.';
  }

  var devtoSection = '';
  if (Array.isArray(devtoLines) && devtoLines.length > 0) {
    devtoSection = '\n\nDEV.to top articles (today):\n'
      + devtoLines.map(function (l, i) { return (i + 1) + '. ' + l; }).join('\n')
      + '\n\nUse to inform devActivity and product/devtools category trends.';
  }

  var clusterSection = buildClusterSection(githubLines, hnLines, redditLines, devtoLines);

  return [
    'You are a technology trend analyst. Return exactly 12 current, real technology trends as a JSON array.',
    'Each trend object must have these fields:',
    '  name (string) — short trend name, 2-5 words',
    '  category (string) — one of: ai_ml, devtools, design, marketing, infrastructure, product',
    '  description (string) — 1-2 sentence explanation of what this trend is',
    '  searchGrowth (integer 0-100) — estimated search interest growth rate',
    '  socialVelocity (integer 0-100) — estimated social media buzz level',
    '  devActivity (integer 0-100) — developer/builder activity level, grounded in real GitHub data where available',
    '  history (array of 6 integers 0-100) — estimated momentum over 6 periods, ending near searchGrowth',
    '  relevance (string) — 1 sentence on why this matters for an AI-powered marketing/ops platform',
    '  signals (array of 3 strings) — specific recent events, launches, or data points driving this trend',
    '',
    'Requirements:',
    '- Use REAL current trends, not made-up ones. Ground in actual technology movements.',
    '- Spread across all 6 categories. At least 1 trend per category.',
    '- Include a mix of stages: some early (scores 10-30), some emerging (30-60), some growing (60-85), some exploding (85+).',
    '- Signals should reference real companies, products, or events.',
    '- history array should show realistic growth trajectory ending at or near searchGrowth value.',
    githubSection,
    hnSection,
    redditSection,
    devtoSection,
    clusterSection,
    '',
    'Return ONLY the JSON array, no markdown fences, no explanation.'
  ].join('\n');
}

// ── Helpers ──

function clamp(v, lo, hi) {
  v = parseInt(v, 10);
  if (isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function computeScore(t) {
  return Math.round(
    t.searchGrowth * WEIGHTS.searchGrowth +
    t.socialVelocity * WEIGHTS.socialVelocity +
    t.devActivity * WEIGHTS.devActivity
  );
}

function classifyStage(score) {
  if (score >= 85) return 'exploding';
  if (score >= 60) return 'growing';
  if (score >= 30) return 'emerging';
  return 'early_signal';
}

// ── Gemini Call ──

async function callGemini(promptText, log) {
  if (!GEMINI_API_KEY) {
    log('[TrendIngest] GEMINI_API_KEY not set, skipping');
    return null;
  }

  const body = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 3000
    }
  };

  const res = await fetch(GEMINI_URL + GEMINI_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    log('[TrendIngest] Gemini returned ' + res.status);
    return null;
  }

  const data = await res.json();

  // Log usage for cost tracking
  const um = data && data.usageMetadata;
  if (um && storage.logGeminiUsage) {
    storage.logGeminiUsage({
      caller: 'trendIngest',
      model: 'gemini-2.0-flash',
      agentId: null,
      promptTokens: um.promptTokenCount || 0,
      completionTokens: um.candidatesTokenCount || 0,
      totalTokens: um.totalTokenCount || 0
    }).catch(function () {});
  }

  var text = '';
  try {
    text = data.candidates[0].content.parts[0].text;
  } catch (e) {
    log('[TrendIngest] Unexpected Gemini response structure');
    return null;
  }

  return text;
}

// ── Parse & Normalize ──

function parseTrends(text, log) {
  // Strip markdown fences
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    var match = text.match(/\[[\s\S]*\]/);
    if (match) {
      parsed = JSON.parse(match[0]);
    } else {
      log('[TrendIngest] Could not parse JSON from Gemini response');
      return null;
    }
  }

  if (!Array.isArray(parsed) || !parsed.length) {
    log('[TrendIngest] Gemini returned empty or non-array data');
    return null;
  }

  return parsed.map(function (t, i) {
    var cat = CATEGORY_IDS.indexOf(t.category) !== -1 ? t.category : 'ai_ml';
    var sg = clamp(t.searchGrowth, 0, 100);
    var sv = clamp(t.socialVelocity, 0, 100);
    var da = clamp(t.devActivity, 0, 100);
    var score = Math.round(sg * WEIGHTS.searchGrowth + sv * WEIGHTS.socialVelocity + da * WEIGHTS.devActivity);

    var history = Array.isArray(t.history) && t.history.length >= 3
      ? t.history.slice(0, 6).map(function (v) { return clamp(v, 0, 100); })
      : [0, Math.round(sg * 0.2), Math.round(sg * 0.4), Math.round(sg * 0.6), Math.round(sg * 0.8), sg];

    var signals = Array.isArray(t.signals) ? t.signals.slice(0, 3) : [];
    while (signals.length < 3) signals.push('Emerging signal');

    return {
      id: 'tr-' + String(i + 1).padStart(3, '0'),
      name: String(t.name || 'Unnamed Trend').slice(0, 80),
      category: cat,
      description: String(t.description || '').slice(0, 300),
      searchGrowth: sg,
      socialVelocity: sv,
      devActivity: da,
      score: score,
      stage: classifyStage(score),
      history: history,
      relevance: String(t.relevance || '').slice(0, 200),
      signals: signals.map(function (s) { return String(s).slice(0, 100); })
    };
  });
}

// ── Main Ingestion Logic ──

async function runIngestion(log) {
  log('[TrendIngest] Starting trend ingestion...');

  // Fetch real signal data first (graceful fallback if unavailable)
  var githubLines = await fetchGithubTrending(log);
  if (githubLines) {
    log('[TrendIngest] GitHub Trending: fetched ' + githubLines.length + ' repos');
  } else {
    log('[TrendIngest] GitHub Trending unavailable — using Gemini estimates only');
  }

  var hnLines = await fetchHNSignals(log);
  if (hnLines) {
    log('[TrendIngest] HackerNews: fetched ' + hnLines.length + ' front-page stories');
  } else {
    log('[TrendIngest] HackerNews unavailable — skipping HN signals');
  }

  var redditLines = await fetchRedditSignals(log);
  if (redditLines) {
    log('[TrendIngest] Reddit: fetched ' + redditLines.length + ' hot posts');
  } else {
    log('[TrendIngest] Reddit unavailable — skipping Reddit signals');
  }

  var devtoLines = await fetchDevToSignals(log);
  if (devtoLines) {
    log('[TrendIngest] DEV.to: fetched ' + devtoLines.length + ' top articles');
  } else {
    log('[TrendIngest] DEV.to unavailable — skipping DEV.to signals');
  }

  var promptText = buildTrendPrompt(githubLines, hnLines, redditLines, devtoLines);
  var rawText = await callGemini(promptText, log);
  if (!rawText) {
    log('[TrendIngest] No data from Gemini, aborting');
    return { ok: false, reason: 'gemini_failed' };
  }

  var trends = parseTrends(rawText, log);
  if (!trends || !trends.length) {
    log('[TrendIngest] Parse failed, aborting');
    return { ok: false, reason: 'parse_failed' };
  }

  // Compute per-trend source coverage (keyword matching across all 4 sources)
  trends = computeSourceCoverage(trends, githubLines, hnLines, redditLines, devtoLines);

  // Phase 5: read from trendIntel.radar (fallback to old trendRadar key for migration)
  var _trendIntel = (await storage.getState('trendIntel')) || {};
  var existing = Array.isArray(_trendIntel.radar) ? _trendIntel.radar : ((await storage.getState('trendRadar')) || []);
  if (!Array.isArray(existing)) existing = [];
  var previousSnapshot = existing.length ? existing[existing.length - 1] : null;

  // Compute deltas against previous snapshot — marks risingFast + scoreDelta
  trends = computeTrendDeltas(trends, previousSnapshot);

  // Build radar snapshot
  var snapshotId = 'snap-' + Date.now();
  // Stamp snapshotId onto each trend for feedback-loop traceability
  trends = trends.map(function (t) { return Object.assign({}, t, { snapshotId: snapshotId }); });
  var snapshot = {
    snapshotId: snapshotId,
    ingestedAt: new Date().toISOString(),
    source: 'gemini-2.0-flash',
    trendCount: trends.length,
    githubSignals: githubLines || null,
    hnSignals:     hnLines     || null,
    redditSignals: redditLines || null,
    devtoSignals:  devtoLines  || null,
    trends: trends
  };

  // Append snapshot, trim, store
  existing.push(snapshot);
  if (existing.length > MAX_RADAR_SNAPSHOTS) {
    existing = existing.slice(-MAX_RADAR_SNAPSHOTS);
  }
  // Phase 5: write to trendIntel.radar
  _trendIntel.radar = existing;
  await storage.setState('trendIntel', _trendIntel);
  log('[TrendIngest] Stored ' + trends.length + ' trends to trendIntel.radar (snapshot ' + existing.length + '/' + MAX_RADAR_SNAPSHOTS + ')');

  // Trend alerts are now shown on the CEO Dashboard Trend Radar widget (read-only).
  // They are no longer pushed to the approvalQueue — that queue is reserved for actionable items.

  // ── Auto-Campaign Conversion (governance switch) ──
  try {
    // Phase 5: read trendActions from trendIntel.actions
    var trendActions = (_trendIntel && _trendIntel.actions) || {};
    if (trendActions.auto_campaign_enabled === true) {
      var topExploding = trends.filter(function (t) {
        return t.stage === 'exploding' && t.score >= 70;
      }).slice(0, 1);

      if (topExploding.length) {
        var campaigns = (await storage.getState('campaigns')) || [];
        if (!Array.isArray(campaigns)) campaigns = [];
        var sevenDaysCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        var recentAutoNames = campaigns
          .filter(function (c) {
            return c.provenance === 'trends_radar' && c.autoCreated && c.createdAt && new Date(c.createdAt).getTime() > sevenDaysCutoff;
          })
          .map(function (c) { return (c.title || '').toLowerCase(); });

        var newCampaigns = topExploding
          .filter(function (t) {
            var slug = t.name.toLowerCase().slice(0, 10);
            return !recentAutoNames.some(function (n) { return n.indexOf(slug) !== -1; });
          })
          .map(function (t) {
            return {
              id: 'camp-trend-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              title: t.name + ' Content Campaign',
              description: 'Auto-generated from Trends Radar (score: ' + t.score + '). ' + (t.description || ''),
              status: 'active',
              assignee: 'nova',
              priority: 'high',
              allowedTaskTypes: ['blog_post'],
              frequency: 2,
              cadence: 'weekly',
              provenance: 'trends_radar',
              autoCreated: true,
              source_trend: { trendName: t.name, snapshotId: snapshotId, scoreAtCreation: t.score, stageAtCreation: t.stage },
              trendScore: t.score,
              trendCategory: t.category,
              createdAt: new Date().toISOString()
            };
          });

        if (newCampaigns.length) {
          campaigns = campaigns.concat(newCampaigns);
          await storage.setState('campaigns', campaigns);
          log('[TrendIngest] Auto-created ' + newCampaigns.length + ' campaign(s): ' + newCampaigns.map(function (c) { return c.title; }).join(', '));
        } else {
          log('[TrendIngest] Auto-campaign: top exploding trend already has a recent campaign — skipping');
        }
      } else {
        log('[TrendIngest] Auto-campaign: no exploding trends with score >= 70 this cycle');
      }
    }
  } catch (e) {
    log('[TrendIngest] Auto-campaign creation failed (non-fatal): ' + e.message);
  }

  return { ok: true, trendCount: trends.length, snapshotIndex: existing.length };
}

// ── Export: Timer Trigger ──

module.exports = async function (context) {
  var demoGuard = require('../_utils/demoGuard');
  if (demoGuard.timerSkip && demoGuard.timerSkip(context)) return;

  try {
    var result = await runIngestion(context.log.bind(context));
    context.log('[TrendIngest] Done:', JSON.stringify(result));
  } catch (err) {
    context.log.error('[TrendIngest] Fatal:', err && err.message ? err.message : err);
  }
};

// Export for HTTP trigger wrapper
module.exports.runIngestion = runIngestion;
