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

// ── Trend Prompt Builder ──

function buildTrendPrompt(githubLines, hnLines) {
  var githubSection = '';
  if (Array.isArray(githubLines) && githubLines.length > 0) {
    githubSection = '\n\nReal GitHub Trending data (today):\n'
      + githubLines.map(function (l, i) { return (i + 1) + '. ' + l; }).join('\n')
      + '\n\nUse these as ground truth for devActivity scores where relevant. Reference specific repos in signals where appropriate.';
  }

  var hnSection = '';
  if (Array.isArray(hnLines) && hnLines.length > 0) {
    hnSection = '\n\nHackerNews front page (today):\n'
      + hnLines.map(function (l, i) { return (i + 1) + '. ' + l; }).join('\n')
      + '\n\nUse these to inform socialVelocity and searchGrowth scores where relevant. High-point HN posts indicate strong developer/tech community interest.';
  }

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

  var promptText = buildTrendPrompt(githubLines, hnLines);
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

  // Build radar snapshot
  var snapshot = {
    ingestedAt: new Date().toISOString(),
    source: 'gemini-2.0-flash',
    trendCount: trends.length,
    githubSignals: githubLines || null,
    hnSignals: hnLines || null,
    trends: trends
  };

  // Read existing radar, append snapshot, trim
  var existing = (await storage.getState('trendRadar')) || [];
  if (!Array.isArray(existing)) existing = [];
  existing.push(snapshot);
  if (existing.length > MAX_RADAR_SNAPSHOTS) {
    existing = existing.slice(-MAX_RADAR_SNAPSHOTS);
  }

  await storage.setState('trendRadar', existing);

  log('[TrendIngest] Stored ' + trends.length + ' trends (snapshot ' + existing.length + '/' + MAX_RADAR_SNAPSHOTS + ')');
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
