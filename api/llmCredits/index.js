// llmCredits — GET estimated Anthropic credits remaining
//
// Anthropic exposes no balance API, so the CEO records the console balance in
// systemConfig.anthropicCredits = { balanceUsd, asOf } (saved from the Costs page).
// This endpoint subtracts estimated Claude spend since asOf, summed across BOTH
// usage rails: fleet calls in `geminiUsage` (model claude-*) and product calls in
// `claudeUsage` (pixel-agents, ambientscore, valechat).
//
// Caveats surfaced in the payload:
//  - usage keys retain ~30 days / 5000 entries; if asOf predates the oldest
//    retained entry, spend is undercounted → coverageComplete: false
//  - entries logged before the 2026-07-23 pricing fix underprice Claude ~10x;
//    re-sync the balance rather than trusting spend across that boundary.

const storage = require('../_utils/companyStorage');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

function isClaudeEntry(u) {
  return typeof u.model === 'string' && u.model.indexOf('claude') === 0;
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    const [systemConfig, geminiUsage, claudeUsage] = await Promise.all([
      storage.getState('systemConfig').then(v => v || {}),
      storage.getState('geminiUsage').then(v => v || []),
      storage.getState('claudeUsage').then(v => v || [])
    ]);

    const cfg = systemConfig.anthropicCredits || null;
    const allClaude = geminiUsage.filter(isClaudeEntry).concat(claudeUsage.filter(isClaudeEntry));

    // 7-day Claude burn (both rails) — reported even when no balance is configured
    const cutoff7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const spend7d = allClaude
      .filter(u => u.timestamp >= cutoff7d)
      .reduce((sum, u) => sum + (u.totalCost || 0), 0);
    const dailyBurn = spend7d / 7;

    if (!cfg || typeof cfg.balanceUsd !== 'number' || !cfg.asOf) {
      context.res = {
        status: 200,
        headers: corsHeaders,
        body: {
          configured: false,
          claudeBurn7dUsd: Math.round(spend7d * 10000) / 10000,
          note: 'Set your Anthropic console balance on the Costs page to enable the remaining-credits estimate.'
        }
      };
      return;
    }

    const spendSince = allClaude
      .filter(u => u.timestamp >= cfg.asOf)
      .reduce((sum, u) => sum + (u.totalCost || 0), 0);
    const remaining = cfg.balanceUsd - spendSince;

    // Coverage: spendSince undercounts only if entries since asOf could have been
    // pruned. Pruning happens two ways (see logGeminiUsage/logClaudeUsage): the
    // 30-day time cutoff, and the 5000-entry cap. An oldest-retained entry newer
    // than asOf is NOT evidence of pruning — logging may simply have started then.
    const retentionFloor = new Date(Date.now() - 30 * 86400000).toISOString();
    const oldest = arr => arr.length ? arr.reduce((m, u) => (u.timestamp < m ? u.timestamp : m), arr[0].timestamp) : null;
    const railCovered = arr => {
      if (cfg.asOf < retentionFloor) return false;
      if (arr.length >= 5000) {
        const o = oldest(arr);
        return o !== null && o <= cfg.asOf;
      }
      return true;
    };
    const coverageComplete = railCovered(geminiUsage) && railCovered(claudeUsage);

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        configured: true,
        balanceUsd: cfg.balanceUsd,
        asOf: cfg.asOf,
        claudeSpendSinceUsd: Math.round(spendSince * 10000) / 10000,
        remainingUsd: Math.round(remaining * 100) / 100,
        claudeBurn7dUsd: Math.round(spend7d * 10000) / 10000,
        dailyBurnUsd: Math.round(dailyBurn * 10000) / 10000,
        daysLeft: dailyBurn > 0 && remaining > 0 ? Math.floor(remaining / dailyBurn) : null,
        coverageComplete: coverageComplete
      }
    };

  } catch (err) {
    context.log.error('[LlmCredits] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'internal_error', message: err.message }
    };
  }
};
