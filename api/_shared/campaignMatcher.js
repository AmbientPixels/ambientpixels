const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'for', 'to', 'of', 'in', 'on', 'with', '&']);

function normalizeCampaignRef(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (!obj.campaign_id && obj.campaignId) obj.campaign_id = obj.campaignId;
  if (obj.campaign_id === '') obj.campaign_id = null;
  return obj;
}

function tokenizeTitle(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function (t) {
      return t && t.length >= 3 && !STOPWORDS.has(t);
    });
}

function jaccard(tokensA, tokensB) {
  const a = new Set(tokensA || []);
  const b = new Set(tokensB || []);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach(function (t) { if (b.has(t)) inter++; });
  const union = new Set([].concat(Array.from(a), Array.from(b))).size || 1;
  return inter / union;
}

function _buildMatchKey(goalId, tokens) {
  const sorted = (tokens || []).slice().sort();
  return String(goalId || 'none') + '|' + sorted.join('|');
}

function _activeCampaigns(campaigns) {
  return (campaigns || []).filter(function (c) {
    return c && c.status === 'active' && !c.deletedAt;
  });
}

function _normalizeCampaign(c) {
  if (!c || typeof c !== 'object') return c;
  if (!c.status) c.status = 'active';
  if (!c.createdAt) c.createdAt = new Date().toISOString();
  if (!c.updatedAt) c.updatedAt = c.createdAt;
  if (!c.title) c.title = 'Untitled Campaign';
  if (c.description === undefined || c.description === null) c.description = '';
  return c;
}

function matchCampaign(params) {
  const title = (params && params.title) || '';
  const goalId = (params && params.goalId) || null;
  const division = (params && params.division) || null;
  const campaigns = (params && params.campaigns) || [];

  const inputTokens = tokenizeTitle(title);
  if (inputTokens.length === 0) {
    return { campaign: null, score: 0, overlapTokens: [], threshold: null, matchKey: _buildMatchKey(goalId, []) };
  }

  const inputSet = new Set(inputTokens);
  let best = null;
  let bestScore = 0;
  let bestOverlap = [];
  let bestThreshold = null;

  _activeCampaigns(campaigns).forEach(function (c) {
    const cTokens = tokenizeTitle(c.title || '');
    if (cTokens.length === 0) return;
    const cSet = new Set(cTokens);
    const overlap = [];
    inputSet.forEach(function (t) { if (cSet.has(t)) overlap.push(t); });
    if (overlap.length < 2) return;

    const base = jaccard(inputTokens, cTokens);
    const sameGoal = !!(goalId && c.objective_id && goalId === c.objective_id);
    let score = base + (sameGoal ? 0.08 : 0);
    if (division && c.division && division === c.division) score += 0.04;
    const threshold = sameGoal ? 0.18 : 0.30;
    if (score < threshold) return;

    if (!best || score > bestScore) {
      best = c;
      bestScore = score;
      bestOverlap = overlap;
      bestThreshold = threshold;
      return;
    }

    if (Math.abs(score - bestScore) < 0.0001) {
      const cu = c.updatedAt || c.createdAt || '';
      const bu = best.updatedAt || best.createdAt || '';
      if (cu > bu) {
        best = c;
        bestScore = score;
        bestOverlap = overlap;
        bestThreshold = threshold;
      }
    }
  });

  return {
    campaign: best,
    score: best ? bestScore : 0,
    overlapTokens: best ? bestOverlap : [],
    threshold: bestThreshold,
    matchKey: _buildMatchKey(goalId, inputTokens)
  };
}

async function ensureCampaign(params) {
  params = params || {};
  const store = params.store || null;
  const entrypoint = params.entrypoint || 'unknown';
  const debug = !!params.debug;
  const logger = typeof params.logger === 'function' ? params.logger : null;

  let campaigns = Array.isArray(params.campaigns) ? params.campaigns : null;
  if (!campaigns && store && typeof store.getState === 'function') {
    campaigns = (await store.getState('campaigns')) || [];
  }
  if (!Array.isArray(campaigns)) campaigns = [];

  campaigns.forEach(_normalizeCampaign);

  const title = params.title || '';
  const goalId = params.goalId || null;
  const division = params.division || null;
  const providedId = params.campaign_id || null;

  const debugRecord = {
    entrypoint: entrypoint,
    providedId: providedId,
    title: title,
    goalId: goalId,
    division: division
  };

  if (providedId) {
    const explicit = campaigns.find(function (c) { return c && c.id === providedId && !c.deletedAt; });
    if (explicit) {
      if (debug && logger) logger('[CampaignMatcher]', JSON.stringify(Object.assign({}, debugRecord, { chosenCampaignId: explicit.id, mode: 'explicit' })));
      return { campaignId: explicit.id, campaign: explicit, created: false, mode: 'explicit', overlapTokens: [], score: 1, matchKey: explicit.matchKey || null, changed: false };
    }
  }

  const tokens = tokenizeTitle(title);
  const matchKey = _buildMatchKey(goalId, tokens);

  // Idempotency path: exact cluster key reuse
  const sameCluster = _activeCampaigns(campaigns)
    .filter(function (c) { return c.matchKey && c.matchKey === matchKey; })
    .sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
    });
  if (sameCluster.length > 0) {
    const chosen = sameCluster[0];
    if (debug && logger) logger('[CampaignMatcher]', JSON.stringify(Object.assign({}, debugRecord, { chosenCampaignId: chosen.id, mode: 'match_key', matchKey: matchKey, overlapTokens: tokens })));
    return { campaignId: chosen.id, campaign: chosen, created: false, mode: 'match_key', overlapTokens: tokens, score: 1, matchKey: matchKey, changed: false };
  }

  const matched = matchCampaign({ title: title, goalId: goalId, division: division, campaigns: campaigns });
  if (matched.campaign) {
    if (debug && logger) {
      logger('[CampaignMatcher]', JSON.stringify(Object.assign({}, debugRecord, {
        chosenCampaignId: matched.campaign.id,
        mode: 'similarity',
        matchKey: matched.matchKey,
        overlapTokens: matched.overlapTokens,
        score: matched.score
      })));
    }
    return {
      campaignId: matched.campaign.id,
      campaign: matched.campaign,
      created: false,
      mode: 'similarity',
      overlapTokens: matched.overlapTokens,
      score: matched.score,
      matchKey: matched.matchKey,
      changed: false
    };
  }

  // Same-goal fallback: if this task belongs to a goal that already has active campaigns,
  // reuse the most recently updated one instead of creating a new campaign per task.
  // This prevents campaign explosion when agents create diverse tasks under one objective.
  if (goalId) {
    const sameGoalCampaigns = _activeCampaigns(campaigns)
      .filter(function(c) { return c.objective_id === goalId; })
      .sort(function(a, b) {
        return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
      });
    if (sameGoalCampaigns.length > 0) {
      const chosen = sameGoalCampaigns[0];
      if (debug && logger) logger('[CampaignMatcher]', JSON.stringify(Object.assign({}, debugRecord, { chosenCampaignId: chosen.id, mode: 'same_goal_fallback', matchKey: matchKey, overlapTokens: tokens })));
      return { campaignId: chosen.id, campaign: chosen, created: false, mode: 'same_goal_fallback', overlapTokens: tokens, score: 0, matchKey: matchKey, changed: false };
    }
  }

  const now = new Date().toISOString();
  const baseDescription = String(params.description || '').trim();
  const contextLine = 'I created this campaign to group related work and keep planning/execution aligned under one objective.';
  const created = {
    id: 'cmp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    title: title || 'Campaign',
    description: baseDescription ? (baseDescription + '\n\n' + contextLine) : contextLine,
    status: 'active',
    objective_id: goalId || null,
    division: division || null,
    provenance: params.provenance || null,
    matchKey: matchKey,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
  // Preserve campaign lifecycle fields if provided
  if (Array.isArray(params.allowedTaskTypes) && params.allowedTaskTypes.length > 0) created.allowedTaskTypes = params.allowedTaskTypes;
  else if (params.taskType) created.taskType = params.taskType;
  if (params.maxTasks) created.maxTasks = parseInt(params.maxTasks, 10) || null;
  if (params.cadence) created.cadence = params.cadence;
  if (params.startDate) created.startDate = params.startDate;
  if (params.endDate) created.endDate = params.endDate;
  if (params.autoComplete !== undefined) created.autoComplete = params.autoComplete !== false && params.autoComplete !== 'false';
  campaigns.push(created);

  if (debug && logger) {
    logger('[CampaignMatcher]', JSON.stringify(Object.assign({}, debugRecord, {
      chosenCampaignId: created.id,
      mode: 'created',
      matchKey: matchKey,
      overlapTokens: tokens,
      score: 0
    })));
  }

  return {
    campaignId: created.id,
    campaign: created,
    created: true,
    mode: 'created',
    overlapTokens: tokens,
    score: 0,
    matchKey: matchKey,
    changed: true
  };
}

module.exports = {
  normalizeCampaignRef,
  tokenizeTitle,
  jaccard,
  matchCampaign,
  ensureCampaign
};
