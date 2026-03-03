// scorer.js — ConversionCore deterministic scoring engine
// Computes Conversion Health Score from LLM evaluation results
// No LLM calls — pure math on structured evaluation data

const { DIMENSIONS, WEIGHT_PROFILES, scoreToGrade } = require('./dimensions');

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
      // Missing evaluation — use default mid-range
      dimensionResults[dimId] = {
        label: dim.label,
        weight: weight,
        score: 50,
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

    // Convert 1-10 to 0-100
    const dimScore100 = Math.round((dimRawScore / 10) * 100);

    dimensionResults[dimId] = {
      label: dim.label,
      weight: weight,
      score: dimScore100,
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

  // Final score: weighted average on 0-100 scale
  const finalScore = totalWeight > 0
    ? Math.round((totalWeightedScore / totalWeight / 10) * 100)
    : 50;

  // Sort findings by severity: critical > important > minor
  const severityOrder = { critical: 0, important: 1, minor: 2 };
  allFindings.sort((a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2));

  // Count partial dimensions
  const partialCount = Object.values(dimensionResults).filter(d => d.partial).length;

  return {
    score: finalScore,
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
