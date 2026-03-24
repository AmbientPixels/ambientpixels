// analyzer.js — AmbientScore pipeline orchestrator
// scrape → extract → 2 parallel grouped evals → score → synthesize → assemble report

const fetch = require('node-fetch');
const storage = require('../../_utils/companyStorage');
const { scrapeUrl } = require('./scraper');
const { buildClassificationPrompt, buildExtractionPrompt, buildGroupEvalPrompt, buildSynthesisPrompt } = require('./promptBuilder');
const { computeScore } = require('./scorer');
const { GROUPS, WEIGHT_PROFILES } = require('./dimensions');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6-20250514';

// ── Claude Call ──────────────────────────────────────────────────

async function callClaude(prompt, { temperature, maxOutputTokens, caller }) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: maxOutputTokens || 2000,
    temperature: temperature || 0.3,
    messages: [{ role: 'user', content: prompt }]
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    timeout: 60000
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('Claude returned ' + res.status + ': ' + errText.substring(0, 200));
  }

  const data = await res.json();

  // Log usage (non-blocking)
  const usage = data?.usage;
  if (usage) {
    storage.logClaudeUsage({
      caller: caller || 'ambientscore',
      model: CLAUDE_MODEL,
      agentId: 'ambientscore',
      promptTokens: usage.input_tokens || 0,
      completionTokens: usage.output_tokens || 0,
      totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
    }).catch(() => {});
  }

  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Empty response from Claude');
  return text;
}

// ── JSON Parser (handles markdown code blocks) ───────────────────

function parseJsonResponse(text) {
  // Strip markdown code block wrapping if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

// ── Analysis Pipeline ────────────────────────────────────────────

async function analyze(url) {
  const startTime = Date.now();
  const errors = [];

  // Step 1: Scrape
  const scraped = await scrapeUrl(url);
  const scrapeTimeMs = Date.now() - startTime;

  // Step 2: Extraction (Stage 1 LLM call)
  const extractionPrompt = buildExtractionPrompt(scraped);
  let extraction;
  try {
    const rawExtraction = await callClaude(extractionPrompt, {
      temperature: 0.3,
      maxOutputTokens: 2000,
      caller: 'as-extraction'
    });
    extraction = parseJsonResponse(rawExtraction);
  } catch (err) {
    throw new Error('Extraction failed: ' + err.message);
  }

  // Step 2.5: Site-Type Classification (Stage 0 — after extraction, before eval)
  let siteType = 'direct_response_saas'; // fallback default
  let siteTypeConfidence = 'low';
  let siteTypeReasoning = 'Classification failed, using default';
  try {
    const classPrompt = buildClassificationPrompt(extraction);
    const rawClass = await callClaude(classPrompt, {
      temperature: 0.2,
      maxOutputTokens: 300,
      caller: 'as-classification'
    });
    const classification = parseJsonResponse(rawClass);
    if (classification.siteType && WEIGHT_PROFILES[classification.siteType]) {
      siteType = classification.siteType;
      siteTypeConfidence = classification.confidence || 'moderate';
      siteTypeReasoning = classification.reasoning || '';
    }
  } catch (err) {
    errors.push('Classification failed (using default): ' + err.message);
  }

  // Step 3: Two grouped evaluations (Stage 2, parallel) — now site-type-aware
  const evalStartTime = Date.now();
  const evalPromises = Object.keys(GROUPS).map(async (groupId) => {
    try {
      const prompt = buildGroupEvalPrompt(groupId, extraction, siteType, !!scraped.jsRenderedWarning);
      const raw = await callClaude(prompt, {
        temperature: 0.1,
        maxOutputTokens: 2500,
        caller: 'as-eval-group-' + groupId
      });
      return { groupId, status: 'ok', result: parseJsonResponse(raw) };
    } catch (err) {
      errors.push('Group ' + groupId + ' evaluation failed: ' + err.message);
      return { groupId, status: 'failed', error: err.message };
    }
  });

  const evalResults = await Promise.allSettled(evalPromises);
  const evalTimeMs = Date.now() - evalStartTime;

  // Merge evaluation results into a single object keyed by dimension ID
  const evaluations = {};
  let failedGroups = 0;
  for (const result of evalResults) {
    const val = result.status === 'fulfilled' ? result.value : { groupId: '?', status: 'failed', error: result.reason?.message };
    if (val.status === 'ok' && val.result) {
      // Each group returns an object with dimension IDs as keys
      Object.assign(evaluations, val.result);
    } else {
      failedGroups++;
    }
  }

  // If both groups failed, report is not viable
  if (failedGroups >= 2) {
    throw new Error('Analysis failed: both evaluation groups returned errors');
  }

  // Step 4: Compute deterministic score (site-type-aware weights)
  const scoreResult = computeScore(evaluations, siteType);

  // Step 5: Synthesis (Stage 3 LLM call)
  let synthesis = null;
  try {
    const synthPrompt = buildSynthesisPrompt(scoreResult, { _extraction: extraction, ...evaluations }, siteType);
    const rawSynthesis = await callClaude(synthPrompt, {
      temperature: 0.5,
      maxOutputTokens: 1500,
      caller: 'as-synthesis'
    });
    synthesis = parseJsonResponse(rawSynthesis);
  } catch (err) {
    errors.push('Synthesis failed: ' + err.message);
    // Fallback: generate templated synthesis from scores
    synthesis = buildFallbackSynthesis(scoreResult);
  }

  const totalTimeMs = Date.now() - startTime;

  // Assemble full report
  return {
    score: scoreResult.score,
    grade: scoreResult.grade,
    teaserFindings: scoreResult.teaserFindings,
    totalFindings: scoreResult.totalFindings,
    fullReport: {
      url: url,
      finalUrl: scraped.finalUrl,
      createdAt: new Date().toISOString(),
      unlocked: false,
      score: scoreResult.score,
      grade: scoreResult.grade,
      siteType: siteType,
      siteTypeLabel: WEIGHT_PROFILES[siteType] ? WEIGHT_PROFILES[siteType].label : siteType,
      siteTypeConfidence: siteTypeConfidence,
      dimensions: scoreResult.dimensions,
      findings: scoreResult.findings,
      teaserFindings: scoreResult.teaserFindings,
      synthesis: synthesis,
      extraction: extraction,
      disclaimer: scoreResult.disclaimer,
      jsRenderedWarning: scraped.jsRenderedWarning,
      errors: errors.length > 0 ? errors : null,
      metadata: {
        scrapeTimeMs: scrapeTimeMs,
        evalTimeMs: evalTimeMs,
        totalTimeMs: totalTimeMs,
        claudeCalls: 5 - failedGroups,
        wordCount: scraped.wordCount,
        analyzedUrl: scraped.finalUrl || url,
        siteTypeReasoning: siteTypeReasoning,
        rawScoreAvg: scoreResult.rawScoreAvg // LLM 1-10 weighted avg, for audit
      }
    }
  };
}

// ── Fallback Synthesis ───────────────────────────────────────────

function buildFallbackSynthesis(scoreResult) {
  const weakDims = Object.entries(scoreResult.dimensions)
    .filter(([, d]) => d.score < 60)
    .sort((a, b) => a[1].score - b[1].score)
    .slice(0, 3);

  const strongDims = Object.entries(scoreResult.dimensions)
    .filter(([, d]) => d.score >= 70)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 2);

  const weakList = weakDims.map(([, d]) => d.label.toLowerCase()).join(', ') || 'several areas';
  const strongList = strongDims.map(([, d]) => d.label.toLowerCase()).join(' and ') || 'some areas';

  let assessmentCopy;
  if (scoreResult.score >= 80) {
    assessmentCopy = 'Strong conversion health. Core elements are well-optimized with refinement opportunities remaining.';
  } else if (scoreResult.score >= 70) {
    assessmentCopy = 'Good foundation with clear upside. Targeted improvements to specific dimensions can yield measurable gains.';
  } else if (scoreResult.score >= 60) {
    assessmentCopy = 'Workable but underoptimized. Several conversion dimensions would benefit from deliberate CRO attention.';
  } else {
    assessmentCopy = 'Needs attention. Structural gaps across multiple dimensions are likely reducing conversion rates.';
  }

  return {
    executiveSummary: `This site scores ${scoreResult.score}/100 on conversion health. Areas for improvement include ${weakList}. ${strongList.charAt(0).toUpperCase() + strongList.slice(1)} show relative strength. Addressing the findings below could meaningfully improve conversion performance.`,
    conversionHealthAssessment: assessmentCopy,
    topPriorities: scoreResult.findings.slice(0, 3).map((f, i) => ({
      rank: i + 1,
      title: f.finding.substring(0, 60),
      description: f.recommendation,
      estimatedImpact: f.estimatedImpact,
      effort: 'medium'
    })),
    headlineRewrites: [],
    ctaRewrites: [],
    strategicOpportunities: ['Address the critical findings listed above to establish a stronger conversion foundation.']
  };
}

module.exports = { analyze };
