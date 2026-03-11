// companyTrendIngest — Timer-triggered trend data ingestion via Gemini
// Runs every 6 hours. Fetches current technology trends, normalizes, and stores in trendRadar.

const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';

const MAX_RADAR_SNAPSHOTS = 30; // keep last 30 ingestion runs
const CATEGORY_IDS = ['ai_ml', 'devtools', 'design', 'marketing', 'infrastructure', 'product'];
const WEIGHTS = { searchGrowth: 0.4, socialVelocity: 0.4, devActivity: 0.2 };

const TREND_PROMPT = [
  'You are a technology trend analyst. Return exactly 12 current, real technology trends as a JSON array.',
  'Each trend object must have these fields:',
  '  name (string) — short trend name, 2-5 words',
  '  category (string) — one of: ai_ml, devtools, design, marketing, infrastructure, product',
  '  description (string) — 1-2 sentence explanation of what this trend is',
  '  searchGrowth (integer 0-100) — estimated search interest growth rate',
  '  socialVelocity (integer 0-100) — estimated social media buzz level',
  '  devActivity (integer 0-100) — estimated developer/builder activity level',
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
  '',
  'Return ONLY the JSON array, no markdown fences, no explanation.'
].join('\n');

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

async function callGemini(log) {
  if (!GEMINI_API_KEY) {
    log('[TrendIngest] GEMINI_API_KEY not set, skipping');
    return null;
  }

  const body = {
    contents: [{ role: 'user', parts: [{ text: TREND_PROMPT }] }],
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

  var rawText = await callGemini(log);
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
