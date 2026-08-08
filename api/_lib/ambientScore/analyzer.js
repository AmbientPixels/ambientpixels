// analyzer.js — AmbientScore pipeline orchestrator
// scrape → extract → 2 parallel grouped evals → score → synthesize → assemble report

// node-fetch and companyStorage were required here for the direct Anthropic
// call and its usage logging; both now live inside _lib/llm.
const { scrapeUrl } = require('./scraper');
const { buildClassificationPrompt, buildExtractionPrompt, buildGroupEvalPrompt, buildSynthesisPrompt } = require('./promptBuilder');
const { computeScore } = require('./scorer');
const { GROUPS, WEIGHT_PROFILES } = require('./dimensions');

const { callModel, LlmUnavailableError } = require('../llm');

// Output ceilings. Group evaluation is the largest generation in the pipeline —
// measured across 222 production calls: median ~5.2k, p90 ~5.8k, peak 6,998
// against this 8000 ceiling. The retry ceilings are deliberately far above the
// first attempt: truncation at a fixed budget is deterministic, so retrying at
// the same budget re-truncates.
const EVAL_MAX_TOKENS = 8000;
const EVAL_RETRY_MAX_TOKENS = 16000;
const SYNTHESIS_MAX_TOKENS = 8000;
const SYNTHESIS_RETRY_MAX_TOKENS = 16000;

// ── Claude Call ──────────────────────────────────────────────────

// Routed through _lib/llm (2026-08-07) so the paid paths that depend on this —
// the $9 Resume Roast rewrite, the $199 teardown, and the free scan — survive an
// Anthropic outage or an exhausted credit balance. Previously a non-2xx threw
// here and the caller's retry logic re-threw against the same dead provider, so
// a customer who had already paid raced through all three order retries and
// landed in `failed` within a minute.
//
// The thrown-error CONTRACT is deliberately unchanged: callers upstream
// (teardownComposer's TRANSIENT_ERR_RX, composer's retry ladder) match on these
// message shapes, so the strings still lead with "Claude returned <status>" and
// truncation still throws rather than returning partial JSON.
// `timeoutMs`/`deadlineAt` are optional and default to the old behaviour, so
// every existing caller is unaffected. They exist because the 200s default
// below is sized for AmbientScore's evaluators and is actively dangerous on a
// path with a shorter hard limit: the $9 rewrite composes inside an HTTP
// request that Azure kills at 230s, so ONE attempt at this default already
// spends 87% of the budget, and the 2-model chain can spend 400s.
async function callClaude(prompt, { temperature, maxOutputTokens, caller, timeoutMs, deadlineAt }) {
  let out;
  try {
    out = await callModel({
      model: 'claude-sonnet',
      prompt,
      maxTokens: maxOutputTokens || 2000,
      temperature: temperature || 0.3,
      json: true,
      caller: caller || 'ambientscore',
      // Was hardcoded to 'ambientscore' for every caller, which filed all of the
      // $9 rewrite's spend under AmbientScore in the by-agent cost breakdown.
      agentId: caller || 'ambientscore',
      // Group evaluation legitimately runs for minutes at a 16k ceiling; the
      // module's 60s default would abort a healthy call.
      timeoutMs: timeoutMs || 200000,
      deadlineAt: deadlineAt || undefined
    });
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      const first = err.attempts.find(a => a.status) || {};
      // Running out of OUR clock is not an upstream fault, and must not read
      // like one: teardownComposer's TRANSIENT_ERR_RX would match a "returned
      // 5xx"/"timeout" phrasing and spend the little budget that remains
      // sleeping between retries of a call there is no time to make. The
      // wording below deliberately trips none of those patterns, and
      // `.deadline` lets callers branch on it without matching strings.
      if (err.reason === 'deadline') {
        const dErr = new Error('Claude budget exhausted before completion — ' + err.message);
        dErr.deadline = true;
        throw dErr;
      }
      // Keep the "Claude returned <status>" prefix: teardownComposer's
      // TRANSIENT_ERR_RX greps for it to decide whether to back off and retry.
      throw new Error('Claude returned ' + (first.status || 503) + ': all models failed ('
        + err.reason + ') — ' + String(first.detail || '').substring(0, 200));
    }
    throw err;
  }

  if (out.truncated) {
    throw new Error('Claude truncated output at max_tokens=' + (maxOutputTokens || 2000) + ' (caller: ' + (caller || 'ambientscore') + ')');
  }

  const text = out.text;
  if (!text) throw new Error('Empty response from Claude (caller: ' + (caller || 'ambientscore') + ')');
  return text;
}

// ── JSON Parser (handles markdown code blocks) ───────────────────

function parseJsonResponse(text) {
  // Strip markdown code block wrapping if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Salvage: extract the outermost JSON object/array if the model wrapped it
    // in prose. Does not recover truncated output — that stays a parse error.
    const first = cleaned.search(/[{[]/);
    const last = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (first !== -1 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }
    throw err;
  }
}

// ── Analysis Pipeline ────────────────────────────────────────────

async function analyze(url, opts) {
  const startTime = Date.now();
  const errors = [];

  // Progress is advisory: a caller running this in the background can pass
  // onStage to surface real pipeline position to a polling client. A failed
  // progress write must never fail the analysis itself.
  const onStage = opts && typeof opts.onStage === 'function' ? opts.onStage : null;
  const notify = async (stage) => {
    if (!onStage) return;
    try { await onStage(stage); } catch (e) { /* advisory only */ }
  };

  // Step 1: Scrape
  const scraped = await scrapeUrl(url);
  const scrapeTimeMs = Date.now() - startTime;
  await notify('extract');

  // Step 2: Extraction (Stage 1 LLM call)
  const extractionPrompt = buildExtractionPrompt(scraped);
  let extraction;
  try {
    const rawExtraction = await callClaude(extractionPrompt, {
      temperature: 0.3,
      maxOutputTokens: 4000,
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
      maxOutputTokens: 500,
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

  await notify('evaluate');

  // Step 3: Two grouped evaluations (Stage 2, parallel) — now site-type-aware
  //
  // A failed group is not a missing quarter of the report. scorer.js fills every
  // dimension the group owned with a constant 60, so a single transient failure
  // fabricates up to 55% of the customer's score (Group A's weight) and silently
  // drops all of that group's findings. Eval output also scales with how much is
  // wrong on the page, so the sites that most need the audit are the ones that
  // truncate. Retry once at a raised ceiling before accepting that outcome.
  const evalStartTime = Date.now();
  let evalRetries = 0;
  const evalPromises = Object.keys(GROUPS).map(async (groupId) => {
    const prompt = buildGroupEvalPrompt(groupId, extraction, siteType, !!scraped.jsRenderedWarning);
    try {
      const raw = await callClaude(prompt, {
        temperature: 0.1,
        maxOutputTokens: EVAL_MAX_TOKENS,
        caller: 'as-eval-group-' + groupId
      });
      return { groupId, status: 'ok', result: parseJsonResponse(raw) };
    } catch (err) {
      evalRetries++;
      try {
        const rawRetry = await callClaude(prompt, {
          temperature: 0.1,
          maxOutputTokens: EVAL_RETRY_MAX_TOKENS,
          caller: 'as-eval-group-' + groupId + '-retry'
        });
        return { groupId, status: 'ok', retried: true, result: parseJsonResponse(rawRetry) };
      } catch (retryErr) {
        errors.push('Group ' + groupId + ' evaluation failed: ' + err.message + ' :: retry: ' + retryErr.message);
        return { groupId, status: 'failed', error: retryErr.message };
      }
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
    const evalErrs = errors.filter(e => e.indexOf('evaluation failed') !== -1);
    throw new Error('Analysis failed: both evaluation groups returned errors' + (evalErrs.length ? ' :: ' + evalErrs.join(' :: ') : ''));
  }

  await notify('score');

  // Step 4: Compute deterministic score (site-type-aware weights)
  const scoreResult = computeScore(evaluations, siteType);

  // Step 5: Synthesis (Stage 3 LLM call)
  // Synthesis length scales with how much is wrong on the page, so a tight
  // output cap fails on exactly the sites with the most findings. Truncation
  // at a given budget is deterministic — the retry must raise the ceiling.
  let synthesis = null;
  let synthesisRetried = false;
  const synthPrompt = buildSynthesisPrompt(scoreResult, { _extraction: extraction, ...evaluations }, siteType);
  try {
    const rawSynthesis = await callClaude(synthPrompt, {
      temperature: 0.5,
      maxOutputTokens: SYNTHESIS_MAX_TOKENS,
      caller: 'as-synthesis'
    });
    synthesis = parseJsonResponse(rawSynthesis);
  } catch (err) {
    synthesisRetried = true;
    try {
      const rawRetry = await callClaude(synthPrompt, {
        temperature: 0.5,
        maxOutputTokens: SYNTHESIS_RETRY_MAX_TOKENS,
        caller: 'as-synthesis-retry'
      });
      synthesis = parseJsonResponse(rawRetry);
    } catch (retryErr) {
      errors.push('Synthesis failed: ' + err.message + ' :: retry: ' + retryErr.message);
      // Fallback: generate templated synthesis from scores
      synthesis = buildFallbackSynthesis(scoreResult);
    }
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
      contentWarning: scraped.contentWarning || null,
      hydratedCounters: scraped.hydratedCounters || 0,
      errors: errors.length > 0 ? errors : null,
      metadata: {
        scrapeTimeMs: scrapeTimeMs,
        evalTimeMs: evalTimeMs,
        totalTimeMs: totalTimeMs,
        claudeCalls: 5 - failedGroups + evalRetries + (synthesisRetried ? 1 : 0),
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
    degraded: true,
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

module.exports = { analyze, callClaude };
