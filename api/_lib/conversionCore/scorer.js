// scorer.js — ConversionCore deterministic scoring engine
// Computes Conversion Health Score from LLM evaluation results
// No LLM calls — pure math on structured evaluation data

const { DIMENSIONS, WEIGHT_PROFILES, scoreToGrade } = require('./dimensions');

/**
 * Decompression curve: converts LLM 1-10 scores to calibrated 0-100 scale.
 *
 * LLMs compress scores toward the 5-6.5 range despite anti-compression prompts.
 * Piecewise linear mapping gives exact control: steep differentiation in the
 * compressed 5-6.5 range while properly punishing low scores and rewarding high.
 *
 * Mapping: 1→0, 3→15, 4→35, 5→60, 5.5→68, 6→76, 6.5→83, 7→89, 8→95, 10→100
 */
const SCORE_BREAKPOINTS = [
  [1, 0], [3, 15], [4, 35], [5, 60],
  [5.5, 68], [6, 76], [6.5, 83], [7, 89], [8, 95], [10, 100]
];

function decompressScore(raw1to10) {
  const clamped = Math.max(1, Math.min(10, raw1to10));
  // Find surrounding breakpoints and interpolate
  for (let i = 0; i < SCORE_BREAKPOINTS.length - 1; i++) {
    if (clamped <= SCORE_BREAKPOINTS[i + 1][0]) {
      const [x0, y0] = SCORE_BREAKPOINTS[i];
      const [x1, y1] = SCORE_BREAKPOINTS[i + 1];
      return Math.round(y0 + (clamped - x0) * (y1 - y0) / (x1 - x0));
    }
  }
  return 100;
}

/**
 * Compute the overall Conversion Health Score from dimension evaluations.
 *
 * @param {Object} evaluations — keyed by dimension ID, each containing:
 *   { scores: { subCriterionId: { score: 1-10, reasoning: "..." } }, findings: [...] }
 * @param {string} [siteType] — site type for dynamic weight selection
 * @returns {Object} { score: 0-100, grade: A-F, dimensions: { ... }, findings: [...] }
 */
function computeScore(evaluations, siteType) {
  let totalWeightedScore = 0;
  let totalWeight = 0;
  const dimensionResults = {};
  const allFindings = [];

  // Get dynamic weights for this site type (fall back to defaults)
  const profile = siteType && WEIGHT_PROFILES[siteType] ? WEIGHT_PROFILES[siteType] : null;

  for (const [dimId, dim] of Object.entries(DIMENSIONS)) {
    const evalResult = evaluations[dimId];
    // Use site-type-specific weight if available, otherwise use default
    const weight = profile && profile.weights[dimId] != null ? profile.weights[dimId] : dim.weight;

    if (!evalResult || !evalResult.scores) {
      // Missing evaluation — use default mid-range (raw 5 → 60 → D)
      dimensionResults[dimId] = {
        label: dim.label,
        weight: weight,
        score: 60,
        grade: 'D',
        subScores: {},
        findings: [],
        partial: true
      };
      totalWeightedScore += 5 * weight; // 5/10 default
      totalWeight += weight;
      continue;
    }

    // Compute weighted dimension score from sub-criteria
    let dimRawScore = 0;
    const subScores = {};

    for (const criterion of dim.subCriteria) {
      const raw = evalResult.scores[criterion.id];
      const score = raw && typeof raw.score === 'number'
        ? Math.max(1, Math.min(10, Math.round(raw.score)))
        : 5; // default

      subScores[criterion.id] = {
        score: score,
        reasoning: (raw && raw.reasoning) || ''
      };

      dimRawScore += score * criterion.weight;
    }

    // Convert 1-10 to 0-100 using decompression curve
    const dimScore100 = decompressScore(dimRawScore);

    dimensionResults[dimId] = {
      label: dim.label,
      weight: weight,
      score: dimScore100,
      rawScore: Math.round(dimRawScore * 100) / 100, // LLM average 1-10, for audit
      grade: scoreToGrade(dimScore100),
      subScores: subScores,
      findings: evalResult.findings || [],
      partial: false
    };

    // Collect findings with dimension context
    if (evalResult.findings) {
      for (const f of evalResult.findings) {
        allFindings.push({
          dimension: dimId,
          dimensionLabel: dim.label,
          severity: f.severity || 'minor',
          evidence: f.evidence || '',
          finding: f.finding || '',
          recommendation: f.recommendation || '',
          estimatedImpact: f.estimatedImpact || 'medium'
        });
      }
    }

    totalWeightedScore += dimRawScore * weight;
    totalWeight += weight;
  }

  // Final score: weighted average on 1-10, then decompressed to 0-100
  const rawFinalAvg = totalWeight > 0
    ? totalWeightedScore / totalWeight
    : 5;
  const finalScore = decompressScore(rawFinalAvg);

  // Sort findings by severity: critical > important > minor
  const severityOrder = { critical: 0, important: 1, minor: 2 };
  allFindings.sort((a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2));

  // Count partial dimensions
  const partialCount = Object.values(dimensionResults).filter(d => d.partial).length;

  return {
    score: finalScore,
    rawScoreAvg: Math.round(rawFinalAvg * 100) / 100, // LLM weighted average 1-10, for audit
    grade: scoreToGrade(finalScore),
    dimensions: dimensionResults,
    findings: allFindings,
    teaserFindings: allFindings.slice(0, 3),
    totalFindings: allFindings.length,
    partialDimensions: partialCount,
    disclaimer: partialCount > 0
      ? partialCount + ' of 8 dimensions used estimated scores due to analysis limitations.'
      : null
  };
}

module.exports = { computeScore };
