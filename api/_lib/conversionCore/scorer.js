// scorer.js — ConversionCore deterministic scoring engine
// Computes Conversion Health Score from LLM evaluation results
// No LLM calls — pure math on structured evaluation data

const { DIMENSIONS, WEIGHT_PROFILES, scoreToGrade } = require('./dimensions');

/**
 * Decompression curve: converts LLM 1-10 scores to calibrated 0-100 scale.
 *
 * LLMs compress scores toward the 5-6.5 range despite anti-compression prompts.
 * A sigmoid centered at 5.0 creates steep differentiation in this narrow range,
 * punishing mediocre scores (4-5 → F) while rewarding good execution (6.5+ → B).
 *
 * Mapping: 1→0, 3→12, 4→27, 5→50, 6→73, 6.5→82, 7→88, 8→95, 10→100
 */
function decompressScore(raw1to10) {
  const clamped = Math.max(1, Math.min(10, raw1to10));
  if (clamped <= 1) return 0;
  if (clamped >= 10) return 100;
  // Sigmoid: center=5.0, steepness=1.0
  return Math.round(100 / (1 + Math.exp(-(clamped - 5.0))));
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
      // Missing evaluation — use default mid-range (raw 5 → sigmoid 50 → F)
      dimensionResults[dimId] = {
        label: dim.label,
        weight: weight,
        score: 50,
        grade: 'F',
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
