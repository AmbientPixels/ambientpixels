// agent-runner.js — extracted from companyHeartbeat/index.js (Phase 4 refactor)
// Per-agent heartbeat processing: prompt build, Gemini call, action handling, guardrails

const storage = require('../_utils/companyStorage');
const webSearch = require('../toolsWebSearch/index');
const imageEngine = require('../_lib/contentEngine/imageEngine');
const crypto = require('crypto');
const { ensureCampaign } = require('../_shared/campaignMatcher');

// Phase 1 modules
const { callGemini } = require('./gemini');
const {
  AGENT_ROLES, GUARDRAILS, DOMAIN_LEAD_MAP,
  MAX_TOOL_CALLS_PER_AGENT, MAX_MEMORIES_PER_AGENT,
  MAX_L4_WRITES_PER_AGENT_PER_DAY, L4_ALLOWED_TYPES, L4_PREFERRED_TYPES, L4_STRUCTURAL_TYPES, L4_DEFAULT_TTL_DAYS,
  MAX_OBSERVATIONS_PER_AGENT, MAX_OBSERVATION_CHARS,
  MAX_RESEARCH_INTEL_PER_DAY, MAX_WEEKLY_REPORTS_PER_AGENT,
  CAPITAL_AUTHORIZED_AGENTS, CAPITAL_DECISION_THRESHOLDS, FINANCE_BUDGET_MONTHLY,
  PRODUCT_PROPOSAL_AUTHORIZED_AGENTS, PRODUCT_PROPOSAL_MAX_PER_DAY,
  PRODUCT_PROPOSAL_COST_CEILINGS, PRODUCT_PROPOSAL_REJECT_COOLDOWN_DAYS,
  FLEET_MUTATION_AUTHORIZED_AGENTS, PROTECTED_AGENTS,
  FLEET_MIN_SIZE, FLEET_MAX_SIZE, FLEET_PROPOSAL_MAX_PER_DAY,
  FLEET_PROPOSAL_COST_CEILINGS, FLEET_PROPOSAL_REJECT_COOLDOWN_DAYS,
  PROPOSAL_AUTHORIZED_AGENTS, PROPOSAL_UNKNOWN_TRIGGER_SEVERITY, PROPOSAL_REJECT_COOLDOWN_DAYS,
  MAX_ACTIVE_OBJECTIVES,
  MAX_GOVERNANCE_LOG_ENTRIES
} = require('./constants');
const { proposalSeverity: _proposalSeverity, liftProposalActions: _liftProposalActions } = require('./agent-proposal-select');
const { repairReplyLink: _repairReplyLink } = require('./prospect-pipeline');
const {
  logEvent, stripTaskPrefixes, _createActionFromHeartbeat, generateConversationalEntityComment,
  spawnQgRespawnCopyTask, findNearDuplicateSocialPost, campaignDailyPostCapStatus, capitalizeSentences,
  parseBlogDeliverable, capitalizeSentencesLongform, titleSimilarity
} = require('./helpers');
const { appendDecision } = require('./_utils/decisionLog');
const QGV = require('./quality-gate'); // composed quality verdict (A2+A3)
const { evaluateDocQualityGate } = require('./doc-quality-gate'); // shared blog/long-form fact-check decision
const _productFacts = require('../_data/product-facts.json');
var _founderVoice = {};
try { _founderVoice = require('../_data/founder-voice-examples.json'); } catch (_) {}

// Claude quality gate for external-facing content
async function _validateContentQuality(text, platform, context) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !text) return null;
  try {
    var factsStr = Object.keys(_productFacts.products).map(function(name) {
      var p = _productFacts.products[name];
      return name + ': ' + p.description + '. Features: ' + p.features.join(', ') + '. NOT: ' + p.notThis.join('; ');
    }).join('\n');
    // Brand-level constraints (apply across all content, not per-product). Rendered
    // as natural-language labeled lines — never as JSON.stringify output.
    var brandStr = '';
    if (_productFacts.brand) {
      var b = _productFacts.brand;
      var bParts = [];
      if (b.colors) {
        bParts.push('COLORS — isThis: ' + (b.colors.isThis_description || ''));
        bParts.push('COLORS — notThis: ' + (b.colors.notThis || []).join('; '));
      }
      if (b.fonts) {
        bParts.push('FONTS — isThis: ' + (b.fonts.isThis || []).join(', '));
        bParts.push('FONTS — notThis: ' + (b.fonts.notThis || []).join('; '));
      }
      if (b.siteSections) {
        bParts.push('SITE SECTIONS that actually exist: ' + (b.siteSections.isThis || []).join(' | '));
        bParts.push('SITE SECTIONS that do NOT exist (flag if cited): ' + (b.siteSections.notThis || []).join('; '));
      }
      if (b.aestheticDirection) {
        bParts.push('AESTHETIC — isThis: ' + (b.aestheticDirection.isThis || []).join('; '));
        bParts.push('AESTHETIC — notThis: ' + (b.aestheticDirection.notThis || []).join('; '));
      }
      if (b.voice) {
        bParts.push('VOICE bannedPhrases (flag any exact or near-match, case-insensitive): ' + (b.voice.bannedPhrases || []).join('; '));
        bParts.push('VOICE bannedPatterns: ' + (b.voice.bannedPatterns || []).join('; '));
        bParts.push('VOICE isThis: ' + (b.voice.isThis || []).join('; '));
      }
      if (bParts.length) brandStr = '\n\nBRAND FACTS (universal — apply to ALL content regardless of which product is mentioned):\n' + bParts.join('\n');
    }
    var toneBlocklist = (_founderVoice.tone_blocklist || []).join(', ');
    var toneGoodExamples = (_founderVoice.tone_good_examples || []).map(function(e) { return '"' + e + '"'; }).join('\n');
    var prompt = 'You are a content quality checker for AmbientPixels. Check this ' + platform + ' post for:\n1. Factual accuracy against the product descriptions below\n2. Hallucinated features or capabilities that do not exist\n3. FABRICATED STATISTICS — any specific numbers, percentages, user counts, ticket counts, accuracy rates, or metrics that are not from the product facts below. If the post cites a specific number (e.g. "37 tickets", "95% accuracy", "10,000 users"), it is almost certainly fabricated and MUST be flagged.\n4. TONE VIOLATIONS — the post MUST match founder voice rules. Flag ANY of these:\n   - Buzzwords or hype from this blocklist: ' + toneBlocklist + '\n   - Rhetorical questions used as hooks ("Ever feel like...?", "Ready to...?", "What if you could...?")\n   - Emoji as opening hooks or emoji walls (single contextual emoji at end is fine)\n   - Em dashes anywhere in the text\n   - Excessive exclamation marks or exclamation marks in corporate-sounding sentences (casual single use like "Shipped it!" in a short line is OK)\n   - Generic AI filler or landscape-setting openers\n   - Reading level too high: long compound sentences, jargon, or SAT words when a simple word exists\n   Good tone examples:\n' + toneGoodExamples + '\n   A post with correct facts but AI-marketing tone MUST fail. Tone violations are as serious as factual errors.\n5. BRAND VIOLATIONS — the post MUST NOT contradict the BRAND FACTS below. Flag ANY of:\n   - Mentions of colors not in the brand isThis palette (e.g. "signal red", or "amber" outside Blindspot)\n   - Mentions of fonts not in the two-font stack (Space Grotesk + Manrope) — any third font name is a hallucination\n   - References to site sections that do not exist (e.g. "manifesto page", "cast page") — only cite sections from the BRAND FACTS siteSections list\n   - Aesthetic descriptors not in isThis (e.g. "dark-native editorial", "notebook", "cel-shaded") — these are hallucinations\n   - ANY voice bannedPhrase (exact or near-match, case-insensitive) — fabricated marketing language\n\nIMPORTANT: List every violation you find. Return all of them in the issues array. Do not stop at the first match.\n\nPRODUCT FACTS:\n' + factsStr + brandStr + '\n\nPOST TO CHECK:\n' + text + '\n\nReturn ONLY raw JSON with no markdown, no preamble, no explanation:\n{"pass": true_or_false, "confidence": 0_to_100, "issues": ["issue1", "issue2"]}';
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 10000);
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: 'You are a JSON-only API. Return ONLY a single raw JSON object with no markdown, no code fences, no preamble, no explanation. The response must start with { and end with }.',
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!resp.ok) { context.log('[QualityGate] Claude returned', resp.status); return null; }
    var data = await resp.json();
    var responseText = (data.content && data.content[0] && data.content[0].text) || '';
    // Try direct JSON parse
    try { return JSON.parse(responseText); } catch (_) {}
    // Regex fallback — extract JSON from response (handles markdown fences, preamble)
    var match = responseText.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch (_) {} }
    // Parse failed — log raw response for debugging, flag for manual review
    context.log('[QualityGate] Parse failed. Raw response:', responseText.substring(0, 500));
    return { pass: true, confidence: 0, issues: ['Quality gate parse error — manual review recommended'] };
  } catch (err) {
    context.log('[QualityGate] Error (fail-open):', String(err).substring(0, 150));
    return null; // fail-open
  }
}

// ── Quality Gate Circuit Breaker constants (System: QG hardening) ──
const QG_FAIL_CIRCUIT_BREAKER_THRESHOLD = 3;
const QG_HALLUCINATION_KEYWORDS = /hallucin|\binvent(?:ed|s|ing)?\b|fabricat|does(?:\s+not|n['’]t)(?:\s+\w+)?\s+(?:have|exist|support|include)|not(?:\s+a|\s+an)?\s+(?:real|actual)\s+(?:feature|capability|product)/i;

// Count prior quality-gate failures on a task by scanning for our stable comment marker.
function _countQgFailures(task) {
  if (!task || !Array.isArray(task.comments)) return 0;
  return task.comments.filter(function (c) {
    return c && typeof c.id === 'string' && c.id.indexOf('cmt-qgfail-') === 0;
  }).length;
}

// Detect hallucination-class failure by inspecting the issues array.
function _isHallucinationFailure(qgResult) {
  if (!qgResult || !Array.isArray(qgResult.issues)) return false;
  return qgResult.issues.some(function (iss) {
    return typeof iss === 'string' && QG_HALLUCINATION_KEYWORDS.test(iss);
  });
}

// Try to identify which product a task is about so we can inject the right facts into Scribe's rewrite prompt.
// Returns product key (e.g. "PixelAgents") or null.
function _detectProductFromTask(task) {
  if (!task) return null;
  var hay = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
  var products = (_productFacts && _productFacts.products) || {};
  // Exact-name match first — sort by length desc so longer names (e.g. "AmbientScore") win over shorter ones ("AmbientOS") for cross-product tasks
  var names = Object.keys(products).sort(function (a, b) { return b.length - a.length; });
  for (var i = 0; i < names.length; i++) {
    if (hay.indexOf(names[i].toLowerCase()) !== -1) return names[i];
  }
  // Loose match for space-separated variants ("pixel agents" → PixelAgents)
  var loose = { 'pixel agents': 'PixelAgents', 'story forge': 'StoryForge', 'card forge': 'CardForge', 'ambient os': 'AmbientOS', 'ambient score': 'AmbientScore' };
  var lkeys = Object.keys(loose).sort(function (a, b) { return b.length - a.length; });
  for (var j = 0; j < lkeys.length; j++) {
    if (hay.indexOf(lkeys[j]) !== -1) return loose[lkeys[j]];
  }
  return null;
}

// Build the strong founder-voice + product-facts block injected into a Scribe rewrite prompt.
// Keeps token cost bounded: 2 examples max, one product's facts, no issue text (caller adds that).
function _buildStrongFeedbackBlock(productKey) {
  var lines = [];
  lines.push('FOUNDER VOICE RULES (non-negotiable):');
  var principles = (_founderVoice && _founderVoice.principles) || [];
  for (var i = 0; i < principles.length; i++) lines.push('- ' + principles[i]);
  lines.push('');
  var examples = ((_founderVoice && _founderVoice.examples) || []).slice(0, 2);
  if (examples.length > 0) {
    lines.push('GOOD EXAMPLES (pattern-match the tone, not the topic):');
    for (var k = 0; k < examples.length; k++) {
      var ex = examples[k];
      lines.push('---');
      lines.push('Platform: ' + (ex.platform || 'social'));
      lines.push('Context: ' + (ex.context || ''));
      lines.push('Post: ' + (ex.text || ''));
      if (ex.why_it_works) lines.push('Why it works: ' + ex.why_it_works);
    }
    lines.push('---');
    lines.push('');
  }
  if (productKey && _productFacts && _productFacts.products && _productFacts.products[productKey]) {
    var p = _productFacts.products[productKey];
    lines.push('PRODUCT FACTS for ' + productKey + ' (use ONLY these; do not invent features):');
    lines.push('Description: ' + p.description);
    lines.push('Real features: ' + (p.features || []).join('; '));
    lines.push('This product is NOT: ' + (p.notThis || []).join('; '));
    lines.push('');
  }
  return lines.join('\n');
}

// Phase 2 modules
const { normalizeAgentResult, _normalizeEnvelope, _normalizeProposal, _isValidProposal } = require('./normalization');

// Phase 3 modules
const { buildHeartbeatPrompt } = require('./prompt-builders');
const { executeTask, reviewTask } = require('./execution-engine');
const { classifyConvergence, convergenceThresholdFor } = require('./convergence');

// ── Goal Generation (System 13) helpers ──
// Extracts normalized lowercase target name from any product proposal AQ entry.
function _proposalTargetKey(q) {
  if (!q) return '';
  if (q.product && q.product.name) return String(q.product.name).toLowerCase().trim();
  if (q.pivot && q.pivot.targetProduct) return String(q.pivot.targetProduct).toLowerCase().trim();
  if (q.retire && q.retire.targetProduct) return String(q.retire.targetProduct).toLowerCase().trim();
  return '';
}

// Shared gate: auth / rate / dedup / cooldown. Capital Allocation gate is
// handler-level, NOT here — do not move capital logic into this function.
function _productProposalGate(agentId, productProposalType, targetKey, approvalQueue) {
  if (!PRODUCT_PROPOSAL_AUTHORIZED_AGENTS.has(agentId)) {
    return { blocked: true, reason: 'only Nova authorized for product lifecycle proposals' };
  }
  const today = new Date().toISOString().substring(0, 10);
  const todayCount = approvalQueue.filter(function (q) {
    return q.type === productProposalType && q.proposedBy === agentId &&
      q.createdAt && q.createdAt.substring(0, 10) === today;
  }).length;
  if (todayCount >= PRODUCT_PROPOSAL_MAX_PER_DAY) {
    return { blocked: true, reason: 'daily limit reached (' + PRODUCT_PROPOSAL_MAX_PER_DAY + '/day)' };
  }
  const pendingDupe = approvalQueue.some(function (q) {
    return q.type === productProposalType && q.status === 'pending' &&
      _proposalTargetKey(q) === targetKey;
  });
  if (pendingDupe) return { blocked: true, reason: 'duplicate pending proposal for target' };
  const cooldownMs = PRODUCT_PROPOSAL_REJECT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - cooldownMs;
  const recentReject = approvalQueue.some(function (q) {
    return q.type === productProposalType && q.status === 'rejected' &&
      _proposalTargetKey(q) === targetKey &&
      Date.parse(q.resolvedAt || q.createdAt || '') > cutoff;
  });
  if (recentReject) {
    return { blocked: true, reason: 'target rejected within ' + PRODUCT_PROPOSAL_REJECT_COOLDOWN_DAYS + 'd cooldown' };
  }
  return { blocked: false };
}

// Capital Allocation gate for product proposals: same 24h-bypass logic as
// propose-campaign. Returns { blocked, reason }. Fail-open on state errors.
async function _productCapitalGate(agentId, estimatedCost, storage) {
  try {
    const alloc = (await storage.getState('capitalAllocation')) || {};
    const pct = (alloc.systemBudget > 0) ? ((alloc.systemSpent || 0) / alloc.systemBudget) * 100 : 0;
    const squeeze = pct >= CAPITAL_DECISION_THRESHOLDS.systemBudgetSqueezePct;
    const systemRed = alloc.systemStatus === 'RED';
    if (!(squeeze || systemRed)) return { blocked: false };
    // 24h bypass: recent auto/cipher-approved decision for this agent
    const log = Array.isArray(alloc.decisionLog) ? alloc.decisionLog : [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const hasApproval = log.some(function (l) {
      return l.agentId === agentId && l.action === 'approved' &&
        Date.parse(l.at || '') > cutoff;
    });
    if (hasApproval) return { blocked: false };
    return { blocked: true, reason: 'system budget ' + (systemRed ? 'RED' : 'squeezed at ' + Math.round(pct) + '%') + ' — emit request-budget first or wait' };
  } catch (_e) {
    return { blocked: false };  // fail-open
  }
}

// ── Agent Identity Evolution (System 14) helpers ──
function _fleetProposalTargetKey(q) {
  if (!q) return '';
  if (q.hire && q.hire.id) return 'hire:' + String(q.hire.id).toLowerCase();
  if (q.retire && q.retire.targetAgent) return 'retire:' + String(q.retire.targetAgent).toLowerCase();
  if (q.evolution && q.evolution.targetAgent) return 'evolve:' + String(q.evolution.targetAgent).toLowerCase();
  return '';
}

// Shared gate: auth / rate / dedup / cooldown. Protected-agent + min/max fleet
// + self-proposal checks live in each handler (type-specific), NOT here.
function _fleetProposalGate(agentId, type, targetKey, approvalQueue) {
  if (!FLEET_MUTATION_AUTHORIZED_AGENTS.has(agentId)) {
    return { blocked: true, reason: 'only Forge can emit (CEO proposes via direct POST)' };
  }
  var today = new Date().toISOString().substring(0, 10);
  var todayCount = approvalQueue.filter(function (q) {
    return q.type === type && q.proposedBy === agentId &&
      q.createdAt && q.createdAt.substring(0, 10) === today;
  }).length;
  if (todayCount >= FLEET_PROPOSAL_MAX_PER_DAY) {
    return { blocked: true, reason: 'daily limit reached (' + FLEET_PROPOSAL_MAX_PER_DAY + '/day)' };
  }
  var pendingDupe = approvalQueue.some(function (q) {
    return q.type === type && q.status === 'pending' &&
      _fleetProposalTargetKey(q) === targetKey;
  });
  if (pendingDupe) return { blocked: true, reason: 'duplicate pending proposal for target' };
  var cutoff = Date.now() - FLEET_PROPOSAL_REJECT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  var recentReject = approvalQueue.some(function (q) {
    return q.type === type && q.status === 'rejected' &&
      _fleetProposalTargetKey(q) === targetKey &&
      Date.parse(q.resolvedAt || q.createdAt || '') > cutoff;
  });
  if (recentReject) {
    return { blocked: true, reason: 'target rejected within ' + FLEET_PROPOSAL_REJECT_COOLDOWN_DAYS + 'd cooldown' };
  }
  return { blocked: false };
}

// Live-offers registry (systemConfig.offers, written by as-offer-create) with a
// 5-min cache so 9 agents/heartbeat don't each re-read the blob. Fail-open to []
// — content agents then see the "NO offers live" prompt line, the safe default.
var _offersCache = { at: 0, offers: [] };
async function _getActiveOffers() {
  if (Date.now() - _offersCache.at < 5 * 60e3) return _offersCache.offers;
  try {
    var _sc = (await storage.getState('systemConfig')) || {};
    _offersCache = { at: Date.now(), offers: Array.isArray(_sc.offers) ? _sc.offers : [] };
  } catch (_e) { _offersCache.at = Date.now(); }
  return _offersCache.offers;
}

async function runAgentHeartbeat(ctx) {
  if (typeof ctx !== 'object' || ctx === null) throw new Error('runAgentHeartbeat: ctx must be an object');
  const { context, agentId, tasks, configs, recentSummaries, cycleId, novaSkipTaskIds, activeDirectives, activeObjectives, documents, workspaceMemory, workspaceDates, revisionActions, costIntel, reviewCooldownIds, seedMemories, researchIntelStore, socialIntel, executionMode, isAgentInCooldown, logAgentCooldownOnce, incPolicyGate, campaignCtx, siteIntel, _agentMemoryStore, trendRadarStore, trendInsightsStore, performanceDigest, agentExperiments, outcomeDigest, reflectionDigest, worldState, strategyDigest, productFacts, skillsData, forgeOpsDigest, financeDigest, allocationDigest, researchDemandDigest, contentDigest, strategicDigest, socialAccountStats, weeklyReportsStore, publishedBlogPosts, pendingMessages, approvalQueue, emergenceDigest } = ctx;
  const _agentRunStartMs = Date.now();
  // Per-day memory write counter (moved from index.js during refactor)
  const _memoryWriteCounters = {};
  const _todayKey = new Date().toISOString().substring(0, 10);
  function _getMemWriteCount(aid) {
    return _memoryWriteCounters[aid + ':' + _todayKey] || 0;
  }
  function _incMemWrite(aid) {
    var k = aid + ':' + _todayKey;
    _memoryWriteCounters[k] = (_memoryWriteCounters[k] || 0) + 1;
  }
  const result = {
    geminiCalls: 0,
    actions: 0,
    actionAttempts: 0,
    durationMs: 0,
    taskUpdates: [],
    proposals: [],
    stagedProposals: [],
    newResearchIntel: null,
    newTrendInsights: null,
    guardrails: {
      orphanBlocked: 0,
      exactDupBlocked: 0,
      fuzzyDupBlocked: 0,
      taskCeilingBlocked: 0,
      socialPromoGateBlocked: 0
    }
  };
  const agent = AGENT_ROLES[agentId];
  if (!agent) return result;
  agent.id = agentId;

  // Read dynamic doctrine weight from workspace config (slider value), clamp 0.0–0.6
  const agentCfg = configs[agentId] || {};
  let dw = parseFloat(agentCfg.doctrineWeight);
  if (isNaN(dw)) dw = 0.4;
  if (dw > 0.6) dw = 0.6;
  if (dw < 0) dw = 0;
  agent._doctrineWeight = Math.round(dw * 100) / 100;

  // Build execution context bundle for execute/review prompts (eliminates context loss)
  const execContext = {
    campaigns: activeDirectives || [],
    directives: activeDirectives || [], // backward compat alias
    objectives: activeObjectives || [],
    seedMemories: seedMemories || {},
    researchIntel: researchIntelStore || [],
    documents: documents || [],
    agentId: agentId
  };

  // Build context for the agent
  // Pixel: exclude 'review' tasks — once Pixel delivers an image the task awaits review, not further Pixel action
  // Other agents: keep 'review' visible (e.g. Scribe needs to submit-for-publish after hero image attached)
  // Skip _archived tasks — they're tombstones from canceled-objective/campaign sweeps that the anti-oscillation
  // pattern keeps in the array. Picking them up triggers objective_canceled_freeze gate violations every cycle.
  // Backlog tasks are invisible to everyone but Nova (who triages them) — 'backlog' is the
  // parking state flows rely on (prospect-pipeline holds reply tasks in backlog until the
  // scan lands + the daily draft budget promotes them; 2026-07-24: Scribe drafted straight
  // from backlog, blowing past maxDraftsPerDay because this filter only excluded 'done').
  // Echo: hide tasks whose social action is already submitted (pending CEO decision)
  // or whose auto-action budget is exhausted. She re-burned all 3 actions/cycle
  // re-attempting them — 72 attempted / 0 executed across the 24 runs to 2026-07-26,
  // the same pending-state disease as Pixel's content-package loop. Both flags are
  // cleared by the CEO rejection/revision paths, which makes the task visible again.
  const _echoParked = t =>
    agentId === 'echo' &&
    (t._social_action_created === true || (t._social_action_attempts || 0) >= QGV.SOCIAL_ATTEMPTS_CAP);
  const agentTasks = tasks.filter(t => t.assignee === agentId && t.status !== 'done' && !t._archived
    && !(agentId !== 'nova' && t.status === 'backlog')
    && !(agentId === 'pixel' && t.status === 'review')
    && !_echoParked(t));
  const _parkedPendingCount = agentId === 'echo'
    ? tasks.filter(t => t.assignee === agentId && t.status !== 'done' && !t._archived && _echoParked(t)).length
    : 0;
  // Nova sees backlog tasks so she can triage them; other agents only see active tasks
  const allActiveTasks = agentId === 'nova'
    ? tasks.filter(t => t.status !== 'done' && !t._archived)
    : tasks.filter(t => t.status !== 'done' && t.status !== 'backlog' && !t._archived);
  // Only show this agent their own revision-requested actions
  const agentRevisions = (revisionActions || []).filter(a => a.created_by === agentId || a.origin_agent === agentId);

  // siteIntel is passed directly to buildHeartbeatPrompt below (used by Echo social traffic + Pixel visual perf sections)

  // ── Scout Bluesky Discovery: autonomous system capability ──
  // Runs on a cooldown (default 2h). No task required — Scout discovers threads
  // as a built-in sensor, writes candidates to the blueskyCandidates state key.
  // CEO picks which to engage with from the dashboard. No tasks are created here.
  if (agentId === 'scout') {
    try {
      var _bsDiscoveryCooldownMs = 2 * 60 * 60 * 1000; // 2 hours default
      var _bsCandidates = (await storage.getState('blueskyCandidates')) || [];
      if (!Array.isArray(_bsCandidates)) _bsCandidates = [];

      // Check cooldown — last scan timestamp stored in the candidates array metadata
      var _bsLastScan = 0;
      for (var _bsi = _bsCandidates.length - 1; _bsi >= 0; _bsi--) {
        if (_bsCandidates[_bsi] && _bsCandidates[_bsi].discoveredAt) {
          _bsLastScan = new Date(_bsCandidates[_bsi].discoveredAt).getTime();
          break;
        }
      }
      var _bsNow = Date.now();
      if (_bsNow - _bsLastScan >= _bsDiscoveryCooldownMs) {
        var _blueskyDiscovery = require('../_utils/blueskyDiscovery');

        // Keywords: prefer systemConfig.blueskyKeywords (dashboard-editable), fall back to JSON file
        var _bsKwConfig = null;
        try {
          var _bsSysConfig = (await storage.getState('systemConfig')) || {};
          if (_bsSysConfig.blueskyKeywords && Array.isArray(_bsSysConfig.blueskyKeywords.keywords)) {
            _bsKwConfig = _bsSysConfig.blueskyKeywords;
          }
        } catch (_e) { /* fall through */ }
        if (!_bsKwConfig) {
          try { _bsKwConfig = require('../_data/bluesky-discovery-keywords.json'); } catch (_e) { /* use defaults */ }
        }
        if (!_bsKwConfig) _bsKwConfig = { keywords: ['AI agents', 'indie hacker', 'solo founder', 'build in public'], filters: {} };
        var _bsFilters = _bsKwConfig.filters || {};

        var _bsRawCandidates = await _blueskyDiscovery.discoverAcrossKeywords(_bsKwConfig.keywords, {
          maxAgeMinutes: _bsFilters.maxAgeMinutes || 120,
          minReplies: _bsFilters.minReplies || 1,
          limitPerKeyword: 25
        });
        context.log('[Heartbeat] scout: bluesky discovery found', _bsRawCandidates.length, 'raw candidates');

        // Dedup against already-stored candidates (by URI)
        var _bsExistingUris = {};
        _bsCandidates.forEach(function (c) { if (c.uri) _bsExistingUris[c.uri] = true; });

        // Also dedup against existing reply tasks (active or completed within 7 days)
        var _bsSevenDaysAgo = _bsNow - 7 * 24 * 60 * 60 * 1000;
        tasks.filter(function (t) { return t.tags && t.tags.indexOf('bluesky-reply') !== -1; })
          .forEach(function (t) {
            if (t.threadContext && t.threadContext.uri) _bsExistingUris[t.threadContext.uri] = true;
          });

        // Score and add new candidates
        var _bsNewCount = 0;
        var _bsSkipped = 0;
        for (var _bsci = 0; _bsci < _bsRawCandidates.length; _bsci++) {
          var _c = _bsRawCandidates[_bsci];
          if (_bsExistingUris[_c.uri]) continue;

          // Relevance score (0-100)
          var _ageMs = _bsNow - new Date(_c.indexedAt).getTime();
          var _ageMinutes = _ageMs / 60000;
          var _recencyScore = Math.max(0, 30 - Math.floor(_ageMinutes / 4)); // 30 at 0min, 0 at 2h
          var _engagementScore = Math.min(30, (_c.replyCount * 3) + _c.likeCount);
          var _velocityScore = Math.min(20, Math.floor((_c._velocity || 0) * 100));
          var _keywordScore = _blueskyDiscovery.intentScore(_c.text);
          var _score = _recencyScore + _engagementScore + _velocityScore + _keywordScore;

          // Buyer-intent threshold: off-topic threads (no intent language) fall below this
          // and are dropped instead of filling the 200-slot store with noise. Tunable via
          // systemConfig.blueskyKeywords.filters.minScore (default 40).
          if (_score < (_bsFilters.minScore || 40)) { _bsSkipped++; continue; }

          _bsCandidates.push({
            id: 'bsc-' + _bsNow + '-' + Math.random().toString(36).substr(2, 6),
            uri: _c.uri,
            cid: _c.cid,
            author: _c.author,
            authorDid: _c.authorDid,
            text: (_c.text || '').substring(0, 500),
            indexedAt: _c.indexedAt,
            replyCount: _c.replyCount,
            repostCount: _c.repostCount,
            likeCount: _c.likeCount,
            matchedKeyword: _c._matchedKeyword || null,
            score: _score,
            status: 'new', // new | dismissed | replied
            discoveredAt: new Date(_bsNow).toISOString()
          });
          _bsNewCount++;
        }

        // Prune: keep last 200 candidates, drop dismissed older than 7 days
        _bsCandidates = _bsCandidates.filter(function (c) {
          if (c.status === 'dismissed') {
            var dAt = new Date(c.discoveredAt || 0).getTime();
            return (_bsNow - dAt) < 7 * 24 * 60 * 60 * 1000;
          }
          return true;
        });
        if (_bsCandidates.length > 200) {
          _bsCandidates = _bsCandidates.slice(_bsCandidates.length - 200);
        }

        await storage.setState('blueskyCandidates', _bsCandidates);
        context.log('[Heartbeat] scout: bluesky discovery complete.', _bsNewCount, 'new candidates added,', _bsSkipped, 'below intent threshold,', _bsCandidates.length, 'total stored');
      }
    } catch (_bsOuterErr) {
      context.log('[Heartbeat] scout: bluesky discovery failed:', String(_bsOuterErr).substring(0, 200));
    }
  }

  // Compute recent activity digest for content/strategy agents (Scribe, Echo, Nova)
  // Gated by agent.id in prompt-builders, so only computed if the agent needs it.
  var recentActivityDigest = '';
  if (['scribe', 'echo', 'nova'].indexOf(agentId) !== -1) {
    var _cutoff48h = Date.now() - 48 * 60 * 60 * 1000;
    var recentDone = tasks.filter(function(t) {
      if (t.status !== 'done' || t._archived) return false;
      var doneAt = t.completedAt || t.updatedAt;
      return doneAt && new Date(doneAt).getTime() > _cutoff48h;
    });
    if (recentDone.length > 0) {
      // Group by assignee for readability
      var byAgent = {};
      recentDone.forEach(function(t) {
        var a = t.assignee || 'unassigned';
        if (!byAgent[a]) byAgent[a] = [];
        byAgent[a].push(t.title || 'untitled');
      });
      var digestLines = [recentDone.length + ' tasks completed in the last 48h:'];
      Object.keys(byAgent).forEach(function(a) {
        var titles = byAgent[a].slice(0, 5); // cap at 5 per agent to keep prompt size reasonable
        titles.forEach(function(title) {
          digestLines.push('  ✓ ' + a + ': ' + title.substring(0, 100));
        });
        if (byAgent[a].length > 5) digestLines.push('  ✓ ' + a + ': ...and ' + (byAgent[a].length - 5) + ' more');
      });
      recentActivityDigest = digestLines.join('\n');
    }
  }

  const _agentRewards = (await storage.getState('agentRewards')) || null; // rewards ledger for the YOUR PROGRESSION block
  const _activeOffers = await _getActiveOffers(); // live offers registry → ACTIVE OFFERS prompt block (content agents)
  const _promptCtx = { agent, agentTasks, allActiveTasks, activeDirectives, activeObjectives, documents, workspaceMemory, workspaceDates, agentRevisions, costIntel, reviewCooldownIds, seedMemories, researchIntelStore, socialIntel, _agentMemoryStore, agentConfigs: configs, trendRadarStore, trendInsightsStore, performanceDigest, agentExperiments, outcomeDigest, reflectionDigest, worldState, strategyDigest, productFacts, skillsData, forgeOpsDigest, financeDigest, allocationDigest, researchDemandDigest, contentDigest, strategicDigest, recentActivityDigest, socialAccountStats, weeklyReportsStore, publishedBlogPosts, siteIntel, pendingMessages, approvalQueue, emergenceDigest, agentRewards: _agentRewards, activeOffers: _activeOffers, parkedPendingCount: _parkedPendingCount };
  let prompt = buildHeartbeatPrompt(_promptCtx);

  // Pre-flight prompt size guard (rough estimate: ~4 chars per token)
  let _estimatedTokens = Math.ceil(prompt.length / 4);
  const _sizeStats = _promptCtx._sizeStats || { total: prompt.length, estimatedTokens: _estimatedTokens, sections: {} };
  try {
    await logEvent('prompt-size', agentId, 'Prompt assembled', cycleId, _sizeStats);
  } catch (_pse) { /* non-fatal */ }

  if (_estimatedTokens > 30000) {
    // Degrade instead of going dark (2026-07-31). A preflight-skipped agent never
    // sees its prompt, so no system_directive can revive it, and its queue keeps
    // growing the tasks section — a death spiral (Scribe was silently skipped for
    // 46h/23 runs). Rebuild with universal skill only + capped task list; only
    // skip if the degraded prompt is STILL over the ceiling.
    const _preDegradeTokens = _estimatedTokens;
    _promptCtx._degrade = true;
    prompt = buildHeartbeatPrompt(_promptCtx);
    _estimatedTokens = Math.ceil(prompt.length / 4);
    result.promptDegraded = true;
    context.log.warn('[Heartbeat] ' + agentId + ': prompt over 30K ceiling (' + _preDegradeTokens + ' est.) — degraded rebuild at ' + _estimatedTokens + ' est. tokens');
    try {
      await logEvent('prompt-degraded', agentId, 'Prompt over 30K ceiling — rebuilt with universal skill + capped task list', cycleId, { beforeTokens: _preDegradeTokens, afterTokens: _estimatedTokens });
    } catch (_pde) { /* non-fatal */ }
  }
  if (_estimatedTokens > 30000) {
    context.log.warn('[Heartbeat] ' + agentId + ': prompt exceeds 30K token ceiling even after degraded rebuild (' + _estimatedTokens + ' est.) — skipping this cycle');
    result.preflightSkipped = true;
    result.preflightEstimatedTokens = _estimatedTokens;
    result.durationMs = Date.now() - _agentRunStartMs;
    return result;
  }
  if (_estimatedTokens > 25000) {
    context.log.warn('[Heartbeat] ' + agentId + ': prompt approaching ceiling (' + _estimatedTokens + ' est. tokens)');
  }

  // Call Gemini
  let response = await callGemini(prompt, agentId);
  result.geminiCalls = 1;

  if (!response) {
    context.log('[Heartbeat]', agentId, 'got no response');
    // Even with no Gemini response, check done-task social injection for Echo
    if (agentId === 'echo') {
      const _earlyDoneSocial = tasks.filter(function (t) {
        if (t.assignee !== 'echo' || t.status !== 'done' || t._archived) return false;
        var age = Date.now() - new Date(t.createdAt || 0).getTime();
        if (age > 7 * 24 * 60 * 60 * 1000) return false;
        var txt = ((t.title || '') + ' ' + (t.description || '')).toLowerCase();
        return /^social_/.test(t.taskType || '') || t.campaign_id || /linkedin|twitter|x\.com|social media|social post|bluesky|tweet/.test(txt);
      });
      if (_earlyDoneSocial.length > 0) {
        context.log('[Heartbeat] echo: no Gemini response but', _earlyDoneSocial.length, 'done social task(s) — continuing for social injection');
        response = '{"taskUpdates":[],"proposals":[],"remember":[],"observations":[]}';
      } else {
        result.durationMs = Date.now() - _agentRunStartMs;
        return result;
      }
    } else {
      result.durationMs = Date.now() - _agentRunStartMs;
      return result;
    }
  }

  // Extract TREND_INSIGHTS_JSON from Scout's response (before JSON parse to avoid interference)
  if (agentId === 'scout' && response) {
    const trendMatch = response.match(/<!--TREND_INSIGHTS_JSON\s*([\s\S]*?)\s*TREND_INSIGHTS_JSON-->/);
    if (trendMatch) {
      // Strip the block from response so it doesn't break normal JSON parsing
      response = response.replace(/<!--TREND_INSIGHTS_JSON[\s\S]*?TREND_INSIGHTS_JSON-->/, '').trim();
      try {
        const raw = JSON.parse(trendMatch[1].trim());
        if (raw && Array.isArray(raw.insights) && raw.insights.length > 0) {
          result.newTrendInsights = {
            id: 'ti_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            analysisDate: raw.analysisDate || new Date().toISOString(),
            summary: String(raw.summary || '').substring(0, 500),
            insights: raw.insights.slice(0, 15).map(function (i) {
              return {
                trendName: String(i.trendName || '').substring(0, 80),
                significance: ['high', 'medium', 'low'].indexOf(i.significance) !== -1 ? i.significance : 'medium',
                confidence: Math.max(0, Math.min(1, parseFloat(i.confidence) || 0.5)),
                interpretation: String(i.interpretation || '').substring(0, 300),
                actionRecommendation: String(i.actionRecommendation || '').substring(0, 200)
              };
            }),
            created_by: 'scout',
            timestamp: new Date().toISOString()
          };
          context.log('[Heartbeat] scout: trend insights extracted,', result.newTrendInsights.insights.length, 'trends analyzed');
        }
      } catch (e) {
        context.log('[Heartbeat] scout: TREND_INSIGHTS_JSON parse failed:', e.message);
      }
    }
  }

  // Parse structured output
  let parsed = null;
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    // Retry with repair prompt if JSON parse fails
    context.log('[Heartbeat]', agentId, 'JSON parse failed, attempting repair');
    try {
      const repaired = await callGemini(
        'The following text was supposed to be valid JSON but has errors. Fix it and return ONLY the valid JSON, nothing else:\n\n' + response
      );
      result.geminiCalls++;
      if (repaired) {
        const jsonMatch = repaired.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (repairErr) {
      context.log.warn('[Heartbeat]', agentId, 'JSON repair also failed');
    }
  }

  // Extract reasoning from agent response (Phase 2B)
  if (parsed && typeof parsed === 'object' && parsed.reasoning) {
    result.reasoning = String(parsed.reasoning).substring(0, 600);
  }

  // Extract reflectionMemory from rejected revision (Phase 3B)
  if (parsed && typeof parsed === 'object' && parsed.reflectionMemory) {
    var _reflText = String(parsed.reflectionMemory).substring(0, 200).trim();
    // Gemini structured output sometimes fills this optional schema field with the
    // literal placeholder "string" — placeholder junk must never become a memory.
    if (_reflText.length < 8 || /^string$/i.test(_reflText)) _reflText = '';
    if (_reflText && _agentMemoryStore && Array.isArray(_agentMemoryStore[agentId])) {
      _agentMemoryStore[agentId].push({
        id: 'mem-refl-' + Date.now(),
        type: 'feedback',
        text: _reflText,
        source: 'auto:reflection',
        timestamp: new Date().toISOString()
      });
      context.log('[Heartbeat]', agentId, 'stored reflection memory:', _reflText.substring(0, 80));
    }
  }

  // Extract outgoing messages (Phase 4A)
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.messages)) {
    result.outgoingMessages = parsed.messages.slice(0, 2);
  }

  // Extract convergenceDiagnosis from stuck tasks (Phase 3C)
  if (parsed && typeof parsed === 'object' && parsed.convergenceDiagnosis) {
    var _diagText = String(parsed.convergenceDiagnosis).substring(0, 300);
    result.convergenceDiagnosis = _diagText;
    if (_diagText && _agentMemoryStore && Array.isArray(_agentMemoryStore[agentId])) {
      _agentMemoryStore[agentId].push({
        id: 'mem-conv-' + Date.now(),
        type: 'learning',
        text: _diagText,
        source: 'auto:convergence',
        timestamp: new Date().toISOString()
      });
      context.log('[Heartbeat]', agentId, 'stored convergence diagnosis:', _diagText.substring(0, 80));
    }
  }

  // ── Phase 2B + 4A: Normalize output then defensively normalize envelope ──
  const normalizedResult = normalizeAgentResult(parsed);
  const normalized = await _normalizeEnvelope(
    (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      ? parsed
      : {
        taskUpdates: normalizedResult.actions,
        proposals: normalizedResult.proposals,
        remember: normalizedResult.remember,
        observations: normalizedResult.observations
      },
    { agentId: agentId, runId: cycleId, onPolicyViolationGate: incPolicyGate }
  );

  // Per-run cooldown (non-persistent): proposals/observations allowed, mutations + remember suppressed.
  if (typeof isAgentInCooldown === 'function' && isAgentInCooldown(agentId)) {
    normalized.taskUpdates = normalized.taskUpdates.filter(function (a) {
      const t = (a && a.type) || '';
      return t !== 'create-task' && t !== 'update-task' && t !== 'move-task';
    });
    normalized.remember = [];
    if (typeof logAgentCooldownOnce === 'function') {
      await logAgentCooldownOnce(agentId);
    }
  }

  // Log unknown action types as warnings
  for (var _oi = 0; _oi < normalized.observations.length; _oi++) {
    var _obsItem = typeof normalized.observations[_oi] === 'string'
      ? normalized.observations[_oi]
      : JSON.stringify(normalized.observations[_oi] || '');
    if (_obsItem && _obsItem.indexOf('[unknown-action-type]') === 0) {
      context.log('[Heartbeat]', agentId, 'WARN:', _obsItem);
    }
  }

  // ── Tool-call interception: detect web_search tool calls and execute them ──
  let toolUsage = 0;
  const toolResults = [];
  const toolActions = normalized.taskUpdates.filter(a => a.tool === 'web_search' || a.type === 'web_search');
  const regularActions = normalized.taskUpdates.filter(a => a.tool !== 'web_search' && a.type !== 'web_search');

  // Re-route propose-* intents the LLM put in the proposals array. Left there,
  // Fix-7 auto-wraps them into content-free generic proposals and the
  // .campaign/.objective payload is silently lost (revenue-pivot audit finding).
  // Shape-tolerant: catches typed variants, payload-nested, bare and flat shapes
  // (2026-07 audit: zero agent proposals ever reached the handler gates).
  {
    const _lift = _liftProposalActions(normalized.proposals);
    if (_lift.lifted.length) {
      normalized.proposals = _lift.remaining;
      for (const _la of _lift.lifted) {
        regularActions.push(_la);
        context.log('[Heartbeat]', agentId, 'rerouted', _la.type, 'from proposals array to the action path');
      }
    }
    // Ledger visibility: generic suggestions left behind can only become display
    // breadcrumbs — count them so the run record shows initiative being dropped.
    result.unroutableProposals = normalized.proposals.length;
  }

  // Scout recursion guard: skip search if task already has research_intel
  const scoutTargetTask = agentTasks.find(t => t.status === 'in-progress') || agentTasks[0];
  const hasExistingResearch = scoutTargetTask && scoutTargetTask.research_intel;
  if (agentId === 'scout' && hasExistingResearch && toolActions.length > 0) {
    context.log('[Heartbeat] scout RECURSION BLOCKED: research_intel already exists on task', scoutTargetTask.id);
    await logEvent('tool-recursion-blocked', agentId, 'research_intel already attached to ' + scoutTargetTask.id, cycleId);
    toolActions.length = 0; // clear all tool calls
  }

  for (const toolCall of toolActions) {
    if (toolUsage >= MAX_TOOL_CALLS_PER_AGENT) {
      context.log('[Heartbeat]', agentId, 'RATE LIMITED: web_search call #' + (toolUsage + 1) + ' blocked (max ' + MAX_TOOL_CALLS_PER_AGENT + ')');
      await logEvent('tool-rate-limited', agentId, 'web_search rate limited: ' + ((toolCall.args && toolCall.args.q) || 'no query'), cycleId);
      toolResults.push({ query: (toolCall.args && toolCall.args.q) || '', ok: false, error: 'rate_limited', results: [] });
      continue;
    }
    const q = (toolCall.args && toolCall.args.q) || '';
    const n = (toolCall.args && toolCall.args.n) || 5;
    if (!q) continue;

    context.log('[Heartbeat]', agentId, 'executing web_search:', q);
    const searchResult = await webSearch.searchInternal(q, n, agentId, context);
    toolResults.push(searchResult);
    toolUsage++;
  }

  // If tool calls produced results, do a follow-up Gemini call so the agent can synthesize
  if (toolResults.length > 0 && toolResults.some(r => r.ok && r.results.length > 0)) {
    const toolContext = toolResults.map(function (r, i) {
      if (!r.ok) return 'Search #' + (i + 1) + ' (' + r.query + '): ' + (r.error || 'failed');
      return 'Search #' + (i + 1) + ' (' + r.query + '):\n' + r.results.map(function (hit) {
        return '  - [' + hit.rank + '] ' + hit.title + '\n    URL: ' + hit.url + '\n    ' + (hit.snippet || '').substring(0, 200);
      }).join('\n');
    }).join('\n\n');

    const synthesisPrompt = `You are ${agent.name}, ${agent.role} at AmbientPixels.

You requested web searches and here are the results:

${toolContext}

Based on these results, produce TWO outputs:

1. DELIVERABLE: A full markdown research brief with findings and a "## Sources" section listing ONLY URLs from the search results above. Do NOT cite URLs not returned by the tool.

2. STRUCTURED INTEL: After the deliverable, on a new line, output EXACTLY this JSON block (no extra text around it):
<!--RESEARCH_INTEL_JSON
{"title":"brief title","summary":"max 600 char summary","key_findings":["finding 1","finding 2"],"sources":["url1","url2"],"impact_tags":["marketing|pricing|ux|infra|finance|strategy"]}
RESEARCH_INTEL_JSON-->

Rules for the structured intel:
- summary: max 600 characters
- key_findings: max 5 items, each max 200 characters
- sources: max 3 URLs (only from search results)
- impact_tags: pick from: marketing, pricing, ux, infra, finance, strategy

Write the full deliverable first, then the structured JSON block.`;

    const synthesisResponse = await callGemini(synthesisPrompt);
    result.geminiCalls++;

    if (synthesisResponse) {
      // Extract structured research_intel from synthesis response
      let researchIntel = null;
      let deliverableText = synthesisResponse;
      const intelMatch = synthesisResponse.match(/<!--RESEARCH_INTEL_JSON\s*([\s\S]*?)\s*RESEARCH_INTEL_JSON-->/);
      if (intelMatch) {
        deliverableText = synthesisResponse.replace(/<!--RESEARCH_INTEL_JSON[\s\S]*?RESEARCH_INTEL_JSON-->/, '').trim();
        try {
          const raw = JSON.parse(intelMatch[1].trim());
          const _riId = 'ri_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
          researchIntel = {
            id: _riId,
            title: String(raw.title || '').substring(0, 120),
            summary: String(raw.summary || '').substring(0, 600),
            key_findings: (raw.key_findings || []).slice(0, 5).map(f => String(f).substring(0, 200)),
            sources: (raw.sources || []).slice(0, 3).map(s => String(s)),
            impact_tags: (raw.impact_tags || []).filter(t => ['marketing','pricing','ux','infra','finance','strategy'].indexOf(t) !== -1),
            timestamp: new Date().toISOString(),
            created_by: agentId
          };
          // Persist to research intel store so all agents see it even after task completion
          result.newResearchIntel = researchIntel;
          context.log('[Heartbeat]', agentId, 'research_intel extracted:', researchIntel.title);
        } catch (e) {
          context.log('[Heartbeat]', agentId, 'research_intel JSON parse failed:', e.message);
        }
      }

      // Attach deliverable + research_intel to target task
      const targetTask = agentTasks.find(t => t.status === 'in-progress') || agentTasks[0];
      if (targetTask) {
        result.taskUpdates.push({
          action: 'comment',
          taskId: targetTask.id,
          comment: {
            type: 'deliverable',
            author: agentId,
            text: deliverableText,
            sources: toolResults.filter(r => r.ok).reduce(function (urls, r) {
              return urls.concat(r.results.map(function (h) { return h.url; }));
            }, []),
            timestamp: new Date().toISOString()
          }
        });
        // Store structured research_intel on task metadata
        if (researchIntel) {
          result.taskUpdates.push({
            action: 'set-research-intel',
            taskId: targetTask.id,
            research_intel: researchIntel
          });
        }
        context.log('[Heartbeat]', agentId, 'web research deliverable attached to task:', targetTask.id, researchIntel ? '(with structured intel)' : '(no structured intel)');
      }
    }
  }

  // Process structured actions (non-tool actions)
  const actions = regularActions;
  result.actionAttempts = Array.isArray(actions) ? actions.length : 0;
  let actionCount = 0;

  // Silent-drop audit: several skip paths below drop an action with only a console log,
  // which made the attempted-vs-executed gap invisible (observed: Nova 71 attempted →
  // 24 executed over 24h with zero governance entries). Count per gate here and emit
  // ONE aggregate event per gate after the loop — per-action logging would flood the
  // 200-entry governanceLog FIFO.
  const _silentDrops = {};
  function _countSilentDrop(gate, sample) {
    if (!_silentDrops[gate]) _silentDrops[gate] = { count: 0, samples: [] };
    _silentDrops[gate].count++;
    if (sample && _silentDrops[gate].samples.length < 3) {
      _silentDrops[gate].samples.push(String(sample).substring(0, 120));
    }
  }

  // SERVER-SIDE FORCED HERO IMAGE: If Pixel has a hero image task idle 10+ min and didn't produce generate-image, inject it
  if (agentId === 'pixel') {
    const _pixelHeroTask = agentTasks.find(t =>
      (t.status === 'todo' || t.status === 'in-progress') &&
      (t.title || '').indexOf('Generate hero image for:') === 0 &&
      t.createdAt
    );
    if (_pixelHeroTask) {
      const _pHeroAge = Date.now() - new Date(_pixelHeroTask.createdAt).getTime();
      const _hasGenerateImage = actions.some(a => a.type === 'generate-image');
      if (!_hasGenerateImage) {
        const _pDocMatch = (_pixelHeroTask.description || '').match(/Document ID:\s*(doc_[a-z0-9_]+)/i);
        const _pDocId = _pDocMatch ? _pDocMatch[1] : null;
        const _pTitle = (_pixelHeroTask.title || '').replace('Generate hero image for: ', '');
        context.log('[Heartbeat] PIXEL FORCED HERO IMAGE: task', _pixelHeroTask.id, 'idle', Math.round(_pHeroAge / 60000), 'min — injecting generate-image action');
        actions.unshift({
          type: 'generate-image',
          taskId: _pixelHeroTask.id,
          summary: 'System-forced hero image generation for: ' + _pTitle,
          image: {
            purpose: 'blog_header',
            topic: _pTitle,
            goal: 'Hero image for: ' + _pTitle,
            preset: 'ap-quiet-editorial',
            attachTo: _pDocId ? { type: 'document', id: _pDocId } : undefined
          }
        });
      }
    }
  }

  // Echo social tasks in review stay in review — CEO reviews via the social action approval queue.
  // No auto-complete bypass. Tasks flow: todo → in-progress → review → done (after CEO approval).

  // QUILL COPY REVIEW: when Quill runs, inject review-task for social-copy tasks awaiting brand voice review
  if (agentId === 'quill') {
    const _quillReviewTasks = tasks.filter(function(t) {
      return t.status === 'review' &&
        t.tags && t.tags.indexOf('social-copy') !== -1 &&
        t.assignee !== 'quill'; // Quill reviews Scribe's work, not its own
    });
    for (var _qi = 0; _qi < _quillReviewTasks.length; _qi++) {
      context.log('[Heartbeat] QUILL REVIEW: injecting review-task for social-copy:', _quillReviewTasks[_qi].id);
      actions.unshift({
        type: 'review-task',
        taskId: _quillReviewTasks[_qi].id,
        summary: 'Brand voice review: ' + (_quillReviewTasks[_qi].title || _quillReviewTasks[_qi].id)
      });
    }
  }

  // ANTI-STALL: if agent has triaged idle tasks but produced no execute/create-doc/create-social-action, inject forced execute
  // v2: Skip convergence-blocked tasks (5+ deliverables) — try a different task or review-task instead
  if (agentId !== 'nova') {
    const _hasWorkAction = actions.some(a =>
      a.type === 'execute-task' || a.type === 'create-doc' || a.type === 'create-social-action' || a.type === 'review-task'
    );
    if (!_hasWorkAction) {
      const _prioOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      // Exclude tasks created in this heartbeat cycle (< 2 min old) — let them settle before executing
      const _cycleStartMs = Date.now();
      const _triagedIdle = agentTasks
        .filter(t => {
          if (t.status !== 'todo' && t.status !== 'in-progress') return false;
          // Triage gate: individual tasks (no campaign) need a Nova/system comment OR be CEO-assigned (explicit assignee + dueDate set by human)
          const _ceoAssigned = t.source !== 'heartbeat' && t.assignee && t.dueDate;
          if (!t.campaign_id && !_ceoAssigned && !(t.comments && t.comments.some(c => c.author === 'nova' || c.author === 'system'))) return false;
          // Same-cycle guard: skip tasks created < 30s ago (prevents create-then-execute in one heartbeat)
          var _taskAge = _cycleStartMs - new Date(t.createdAt || 0).getTime();
          if (_taskAge < 30000) {
            context.log('[Heartbeat] ANTI-STALL: skipping same-cycle task', t.id, '(age:', Math.round(_taskAge / 1000) + 's)');
            return false;
          }
          return true;
        })
        .sort((a, b) => {
          // System directives always come first (highest urgency)
          const aDir = (a.category || '') === 'system_directive' ? -1 : 0;
          const bDir = (b.category || '') === 'system_directive' ? -1 : 0;
          if (aDir !== bDir) return aDir - bDir;
          return (_prioOrder[a.priority] || 3) - (_prioOrder[b.priority] || 3);
        });
      // Filter out convergence-blocked tasks (5+ deliverables — would just get blocked again)
      const _convergenceBlocked = _triagedIdle.filter(t => {
        const _delCount = (t.comments || []).filter(c => c.type === 'deliverable').length;
        return _delCount >= convergenceThresholdFor(t.taskType);
      });
      let _executableIdle = _triagedIdle.filter(t => {
        const _delCount = (t.comments || []).filter(c => c.type === 'deliverable').length;
        return _delCount < convergenceThresholdFor(t.taskType);
      });
      // CONVERGENCE ESCALATION: move convergence-blocked tasks to review + CEO escalation.
      // Do NOT auto-complete. CEO must approve or close these tasks.
      for (var _cri = 0; _cri < _convergenceBlocked.length; _cri++) {
        var _crTask = _convergenceBlocked[_cri];
        var _crDels = (_crTask.comments || []).filter(function(c) { return c.type === 'deliverable'; });
        if (!_crTask.comments) _crTask.comments = [];
        var _crVerdict = classifyConvergence(_crTask, Date.now());

        // INTERNAL low-stakes task at threshold -> accept the latest draft, done. No lock.
        if (_crVerdict.action === 'auto-accept') {
          if (!(_crTask._convergenceState && _crTask._convergenceState.resolved)) {
            _crTask.status = 'done';
            _crTask.updatedAt = new Date().toISOString();
            _crTask._convergenceState = Object.assign({}, _crTask._convergenceState, { notified: true, resolved: 'auto-accept', deliverableCount: _crDels.length });
            _crTask.comments.push({ id: 'cmt-convaccept-' + Date.now() + '-' + _cri, author: 'system', type: 'system', createdAt: new Date().toISOString(),
              text: '[SYSTEM] Converged: auto-accepted latest of ' + _crDels.length + ' drafts (internal task, no external gate).' });
            context.log('[Heartbeat] CONVERGENCE AUTO-ACCEPT:', _crTask.id, '—', _crDels.length, 'drafts, marked done');
            try {
              var _caAQ = (await storage.getState('approvalQueue')) || [];
              var _caChanged = false;
              _caAQ.forEach(function(q) { if (q && q.type === 'convergence_escalation' && q.taskId === _crTask.id && q.status === 'pending') { q.status = 'resolved'; q.resolvedAt = new Date().toISOString(); q.resolution = 'auto-accept'; _caChanged = true; } });
              if (_caChanged) await storage.setState('approvalQueue', _caAQ);
            } catch (_caErr) { context.log('[Heartbeat] CONVERGENCE AUTO-ACCEPT: AQ resolve failed (non-fatal):', String(_caErr).substring(0, 200)); }
            try {
              var _caGov = (await storage.getState('governanceLog')) || [];
              _caGov.push({ at: new Date().toISOString(), type: 'convergence-auto-accept', taskId: _crTask.id, taskTitle: _crTask.title || _crTask.id, drafts: _crDels.length });
              await storage.setState('governanceLog', _caGov.slice(-500));
            } catch (_cgErr) { /* non-fatal */ }
          }
          continue;
        }

        // PUBLIC task already escalated past the grace window -> cancel (never auto-ship unreviewed).
        if (_crVerdict.action === 'grace-close') {
          if (!(_crTask._convergenceState && _crTask._convergenceState.resolved)) {
            _crTask.status = 'canceled';
            _crTask.updatedAt = new Date().toISOString();
            _crTask._convergenceState = Object.assign({}, _crTask._convergenceState, { resolved: 'grace-close', deliverableCount: _crDels.length });
            _crTask.comments.push({ id: 'cmt-convgrace-' + Date.now() + '-' + _cri, author: 'system', type: 'system', createdAt: new Date().toISOString(),
              text: '[SYSTEM] Convergence grace window elapsed (no CEO action in 48h). Canceling un-converged public task — re-create if still needed.' });
            context.log('[Heartbeat] CONVERGENCE GRACE-CLOSE:', _crTask.id, '— canceled after grace window');
            try {
              var _gcAQ = (await storage.getState('approvalQueue')) || [];
              var _gcChanged = false;
              _gcAQ.forEach(function(q) { if (q && q.type === 'convergence_escalation' && q.taskId === _crTask.id && q.status === 'pending') { q.status = 'resolved'; q.resolvedAt = new Date().toISOString(); q.resolution = 'grace-close'; _gcChanged = true; } });
              if (_gcChanged) await storage.setState('approvalQueue', _gcAQ);
            } catch (_gcErr) { context.log('[Heartbeat] CONVERGENCE GRACE-CLOSE: AQ resolve failed (non-fatal):', String(_gcErr).substring(0, 200)); }
            try {
              var _gcGov = (await storage.getState('governanceLog')) || [];
              _gcGov.push({ at: new Date().toISOString(), type: 'convergence-grace-close', taskId: _crTask.id, taskTitle: _crTask.title || _crTask.id, drafts: _crDels.length });
              await storage.setState('governanceLog', _gcGov.slice(-500));
            } catch (_ggErr) { /* non-fatal */ }
          }
          continue;
        }

        // PUBLIC task at threshold (first time) or within grace -> escalate to CEO (existing behavior).
        if (_crTask.status !== 'review') {
          _crTask.status = 'review';
          _crTask.updatedAt = new Date().toISOString();
        }
        var _crAlreadyEscalated = !!(_crTask._convergenceState && _crTask._convergenceState.notified);
        if (!_crAlreadyEscalated) {
          _crTask._convergenceState = Object.assign({}, _crTask._convergenceState, { notified: true, escalatedAt: (_crTask._convergenceState && _crTask._convergenceState.escalatedAt) || new Date().toISOString(), deliverableCount: _crDels.length });
          _crTask.comments.push({ id: 'cmt-convesc-' + Date.now() + '-' + _cri, author: 'system', type: 'system', createdAt: new Date().toISOString(),
            text: '[SYSTEM] Revision loop detected: ' + _crDels.length + ' deliverables without convergence. CEO must approve the latest draft, provide direction, or close this task.' });
          context.log('[Heartbeat] CONVERGENCE ESCALATION:', _crTask.id, '—', _crDels.length, 'deliverables, moved to review for CEO');
          // Push convergence_escalation to approvalQueue so it appears in Needs Attention panel
          try {
            var _ceAQ = (await storage.getState('approvalQueue')) || [];
            var _ceAlreadyInQueue = _ceAQ.some(function(q) { return q.type === 'convergence_escalation' && q.taskId === _crTask.id && q.status === 'pending'; });
            if (!_ceAlreadyInQueue) {
              _ceAQ.push({
                id: 'aq-convesc-' + _crTask.id + '-' + Date.now(),
                type: 'convergence_escalation',
                taskId: _crTask.id,
                taskTitle: _crTask.title || _crTask.id,
                originAgent: _crTask.assignee || agentId,
                attempts: _crDels.length,
                status: 'pending',
                createdAt: new Date().toISOString()
              });
              if (_ceAQ.length > 100) _ceAQ.splice(0, _ceAQ.length - 100);
              await storage.setState('approvalQueue', _ceAQ);
              context.log('[Heartbeat] CONVERGENCE ESCALATION: added to approvalQueue for task', _crTask.id);
            }
          } catch (_ceErr) {
            context.log('[Heartbeat] CONVERGENCE ESCALATION: approvalQueue write failed (non-fatal):', String(_ceErr).substring(0, 200));
          }
        }
        // Auto-submit-for-publish: if convergence-locked task has a ready document with hero image,
        // inject submit-for-publish so it reaches the CEO approval queue instead of being stuck forever.
        var _convDocEsc = documents.find(function(d) {
          if (!d || d.deletedAt || d.status === 'published' || d.status === 'rejected' || d.status === 'archived') return false;
          return (d.taskId === _crTask.id) || (d.source && d.source.task_id === _crTask.id);
        });
        if (_convDocEsc && _convDocEsc.hero_image_asset_id && !_convDocEsc.awaiting_hero_image
            && ['marketing_post', 'product_brief'].indexOf(_convDocEsc.kind) !== -1) {
          // Check no pending publish action already exists for this doc
          var _convAlreadySubmitted = _crTask.comments && _crTask.comments.some(function(c) {
            return (c.text || '').indexOf('auto-submitting doc') !== -1;
          });
          if (!_convAlreadySubmitted) {
            context.log('[Heartbeat] CONVERGENCE AUTO-PUBLISH:', agentId, 'auto-submitting doc', _convDocEsc.id, 'for task', _crTask.id);
            actions.push({ type: 'submit-for-publish', documentId: _convDocEsc.id, taskId: _crTask.id, _systemInjected: true });
            _crTask.comments.push({ id: 'cmt-convpub-' + Date.now(), author: 'system', type: 'system', createdAt: new Date().toISOString(),
              text: '[SYSTEM] CONVERGENCE: auto-submitting doc ' + _convDocEsc.id + ' for publish to unblock revision loop.' });
          }
        }
      }
      // Fix 8: For Echo, filter out tasks that already have pending social actions (avoids dedup loop)
      if (agentId === 'echo' && _executableIdle.length > 0) {
        try {
          const _existingActions = (await storage.getState('actions')) || [];
          const _pendingSocialTaskIds = new Set();
          for (let _eai = 0; _eai < _existingActions.length; _eai++) {
            const _ea = _existingActions[_eai];
            if (!_ea || !_ea.type || _ea.type.indexOf('social_post') !== 0) continue;
            const _eaStatus = (_ea.approval && _ea.approval.status) || '';
            if (_eaStatus === 'rejected' || _eaStatus === 'cancelled') continue;
            const _eaExecStatus = (_ea.execution && _ea.execution.status) || '';
            if (_eaExecStatus === 'success') continue;
            if (_ea._parentTaskId) _pendingSocialTaskIds.add(_ea._parentTaskId);
          }
          if (_pendingSocialTaskIds.size > 0) {
            const _beforeCount = _executableIdle.length;
            _executableIdle = _executableIdle.filter(t => !_pendingSocialTaskIds.has(t.id));
            if (_executableIdle.length < _beforeCount) {
              context.log('[Heartbeat] ANTI-STALL: echo filtered out', (_beforeCount - _executableIdle.length),
                'task(s) with pending social actions — remaining:', _executableIdle.length);
            }
          }
        } catch (_pendErr) {
          context.log('[Heartbeat] ANTI-STALL: echo pending social filter error (non-fatal):', String(_pendErr).substring(0, 200));
        }
      }
      if (_executableIdle.length > 0) {
        // Simple anti-stall: inject execute-task for the highest-priority idle task
        var _stallTask = _executableIdle[0];
        context.log('[Heartbeat] ANTI-STALL:', agentId, 'has', _triagedIdle.length,
          'triaged idle task(s) (' + (_triagedIdle.length - _executableIdle.length) + ' convergence-blocked) — injecting execute-task for:', _stallTask.id, '"' + (_stallTask.title || '') + '"');
        actions.unshift({
          type: 'execute-task',
          taskId: _stallTask.id,
          summary: 'Anti-stall forced execution: ' + (_stallTask.title || _stallTask.id)
        });
      } else if (_triagedIdle.length > 0) {
        // ALL idle tasks are convergence-blocked — try review-task on another agent's task
        const _reviewCandidates = allActiveTasks.filter(t =>
          t.status === 'review' && t.assignee !== agentId &&
          t.comments && t.comments.some(c => c.type === 'deliverable')
        );
        if (_reviewCandidates.length > 0) {
          const _reviewTarget = _reviewCandidates[0];
          context.log('[Heartbeat] ANTI-STALL:', agentId, 'all', _triagedIdle.length,
            'idle tasks convergence-blocked — injecting review-task for:', _reviewTarget.id);
          actions.unshift({
            type: 'review-task',
            taskId: _reviewTarget.id,
            summary: 'Anti-stall review (all own tasks convergence-blocked): ' + (_reviewTarget.title || _reviewTarget.id)
          });
        } else {
          context.log('[Heartbeat] ANTI-STALL:', agentId, 'all', _triagedIdle.length,
            'idle tasks convergence-blocked and no reviewable tasks — agent fully stalled');
        }
      }
    }

    // PEER REVIEW INJECTION: if agent has no idle tasks (all in review/done) and didn't propose a review-task,
    // auto-inject review-task for another agent's task that has a deliverable awaiting review.
    {
      const _hasReviewAction = actions.some(a => a.type === 'review-task');
      if (!_hasReviewAction) {
        const _ownIdleTasks = agentTasks.filter(t => t.status === 'todo' || t.status === 'in-progress');
        // Check for stale reviews: tasks in review 60+ min should trigger review injection
        // even when agent has some idle work, to prevent review bottlenecks
        const _staleReviewThreshold = 60 * 60 * 1000;
        const _hasStaleReviews = allActiveTasks.some(t =>
          t.status === 'review' && t.assignee !== agentId &&
          t.comments && t.comments.some(c => c.type === 'deliverable') &&
          t.updatedAt && (Date.now() - new Date(t.updatedAt).getTime()) > _staleReviewThreshold
        );
        if (_ownIdleTasks.length === 0 || (_hasStaleReviews && _ownIdleTasks.length <= 2)) {
          const _peerReviewCandidates = allActiveTasks.filter(t =>
            t.status === 'review' && t.assignee !== agentId &&
            t.comments && t.comments.some(c => c.type === 'deliverable') &&
            (t.comments || []).filter(c => c.type === 'deliverable').length < convergenceThresholdFor(t.taskType)
          );
          if (_peerReviewCandidates.length > 0) {
            // Domain-aware reviewer selection: prefer content agents for social/content tasks
            var _prTarget = null;
            var _prSocialReviewers = ['scribe', 'quill'];
            var _prContentReviewers = ['scribe', 'echo', 'quill'];
            for (var _pri = 0; _pri < _peerReviewCandidates.length; _pri++) {
              var _prc = _peerReviewCandidates[_pri];
              var _prcType = (_prc.taskType || '').toLowerCase();
              if (/^social_/.test(_prcType) && _prSocialReviewers.indexOf(agentId) !== -1) { _prTarget = _prc; break; }
              if (/^blog_|^content_blog|^content_|^article|^newsletter|^internal_doc|^design_/.test(_prcType) && _prContentReviewers.indexOf(agentId) !== -1) { _prTarget = _prc; break; }
            }
            // Fallback: only inject if this agent is domain-relevant or no better reviewer exists
            if (!_prTarget) {
              // Non-content agents (cipher, forge, pixel, scout) skip social/content reviews
              var _prSkipDomains = ['cipher', 'forge', 'pixel', 'scout'];
              var _prFirstCandidate = _peerReviewCandidates[0];
              var _prCandType = (_prFirstCandidate.taskType || '').toLowerCase();
              if (_prSkipDomains.indexOf(agentId) !== -1 && (/^social_/.test(_prCandType) || /^blog_|^content_blog|^content_|^article|^design_/.test(_prCandType))) {
                // Skip — let content agents handle this review
              } else {
                _prTarget = _prFirstCandidate;
              }
            }
            if (_prTarget) {
              context.log('[Heartbeat] PEER REVIEW:', agentId, 'has no idle tasks — injecting review-task for:', _prTarget.id, '"' + (_prTarget.title || '') + '"');
              actions.unshift({
                type: 'review-task',
                taskId: _prTarget.id,
                summary: 'Peer review (no own idle tasks): ' + (_prTarget.title || _prTarget.id)
              });
            }
          }
        }
      }

    }
  }

  // REVIEW LOOP CONVERGENCE ESCALATION: tasks stuck in 'review' status at/over threshold.
  // The peer-review injection excludes convergence-locked tasks, so these become unreviewable
  // AND invisible to the todo/in-progress convergence block (which never sees 'review' status).
  // Scan ALL active tasks (not just agentTasks) so assignee-specific carve-outs don't strand
  // them — notably pixel's agentTasks EXCLUDES its own review tasks (line ~357), so a per-agent
  // agentTasks scan can never reach pixel's stuck review tasks. The notified/resolved flags make
  // the sweep idempotent across the 8 agents (first agent resolves; rest are no-ops).
  {
    var _reviewStuck = (allActiveTasks || []).filter(function (t) {
      if (t.status !== 'review') return false;
      var _rsCount = (t.comments || []).filter(function (c) { return c.type === 'deliverable'; }).length;
      return _rsCount >= convergenceThresholdFor(t.taskType);
    });
    for (var _rsi = 0; _rsi < _reviewStuck.length; _rsi++) {
      var _rsTask = _reviewStuck[_rsi];
      var _rsDels = (_rsTask.comments || []).filter(function (c) { return c.type === 'deliverable'; });
      if (!_rsTask.comments) _rsTask.comments = [];
      var _rsVerdict = classifyConvergence(_rsTask, Date.now());
      // INTERNAL low-stakes task stuck in review at threshold -> accept the latest draft, done.
      if (_rsVerdict.action === 'auto-accept' && !(_rsTask._convergenceState && _rsTask._convergenceState.resolved)) {
        _rsTask.status = 'done';
        _rsTask.updatedAt = new Date().toISOString();
        _rsTask._convergenceState = Object.assign({}, _rsTask._convergenceState, { notified: true, resolved: 'auto-accept', deliverableCount: _rsDels.length });
        _rsTask.comments.push({ id: 'cmt-convaccept-rs-' + Date.now() + '-' + _rsi, author: 'system', type: 'system', createdAt: new Date().toISOString(),
          text: '[SYSTEM] Converged: auto-accepted latest of ' + _rsDels.length + ' drafts (internal task, no external gate).' });
        context.log('[Heartbeat] CONVERGENCE AUTO-ACCEPT (review-stuck):', _rsTask.id, '— marked done');
        try {
          var _rsCaAQ = (await storage.getState('approvalQueue')) || [];
          var _rsCaChanged = false;
          _rsCaAQ.forEach(function (q) { if (q && q.type === 'convergence_escalation' && q.taskId === _rsTask.id && q.status === 'pending') { q.status = 'resolved'; q.resolvedAt = new Date().toISOString(); q.resolution = 'auto-accept'; _rsCaChanged = true; } });
          if (_rsCaChanged) await storage.setState('approvalQueue', _rsCaAQ);
        } catch (_rsCaErr) { context.log('[Heartbeat] CONVERGENCE AUTO-ACCEPT (review-stuck): AQ resolve failed (non-fatal):', String(_rsCaErr).substring(0, 200)); }
        try {
          var _rsCaGov = (await storage.getState('governanceLog')) || [];
          _rsCaGov.push({ at: new Date().toISOString(), type: 'convergence-auto-accept', taskId: _rsTask.id, taskTitle: _rsTask.title || _rsTask.id, drafts: _rsDels.length });
          await storage.setState('governanceLog', _rsCaGov.slice(-500));
        } catch (_rsCgErr) { /* non-fatal */ }
        continue;
      }
      // PUBLIC task escalated past the grace window -> cancel (never auto-ship unreviewed).
      if (_rsVerdict.action === 'grace-close' && !(_rsTask._convergenceState && _rsTask._convergenceState.resolved)) {
        _rsTask.status = 'canceled';
        _rsTask.updatedAt = new Date().toISOString();
        _rsTask._convergenceState = Object.assign({}, _rsTask._convergenceState, { resolved: 'grace-close', deliverableCount: _rsDels.length });
        _rsTask.comments.push({ id: 'cmt-convgrace-rs-' + Date.now() + '-' + _rsi, author: 'system', type: 'system', createdAt: new Date().toISOString(),
          text: '[SYSTEM] Convergence grace window elapsed (no CEO action in 48h). Canceling un-converged public task — re-create if still needed.' });
        context.log('[Heartbeat] CONVERGENCE GRACE-CLOSE (review-stuck):', _rsTask.id, '— canceled');
        try {
          var _rsGcAQ = (await storage.getState('approvalQueue')) || [];
          var _rsGcChanged = false;
          _rsGcAQ.forEach(function (q) { if (q && q.type === 'convergence_escalation' && q.taskId === _rsTask.id && q.status === 'pending') { q.status = 'resolved'; q.resolvedAt = new Date().toISOString(); q.resolution = 'grace-close'; _rsGcChanged = true; } });
          if (_rsGcChanged) await storage.setState('approvalQueue', _rsGcAQ);
        } catch (_rsGcErr) { context.log('[Heartbeat] CONVERGENCE GRACE-CLOSE (review-stuck): AQ resolve failed (non-fatal):', String(_rsGcErr).substring(0, 200)); }
        try {
          var _rsGcGov = (await storage.getState('governanceLog')) || [];
          _rsGcGov.push({ at: new Date().toISOString(), type: 'convergence-grace-close', taskId: _rsTask.id, taskTitle: _rsTask.title || _rsTask.id, drafts: _rsDels.length });
          await storage.setState('governanceLog', _rsGcGov.slice(-500));
        } catch (_rsGgErr) { /* non-fatal */ }
        continue;
      }
      var _rsAlreadyEscalated = !!(_rsTask._convergenceState && _rsTask._convergenceState.notified);
      if (!_rsAlreadyEscalated) {
        _rsTask.comments.push({
          id: 'cmt-revloopesc-' + Date.now() + '-' + _rsi,
          author: 'system',
          type: 'system',
          createdAt: new Date().toISOString(),
          text: '[SYSTEM] Review loop detected: ' + _rsDels.length + ' deliverables stuck in review without convergence. Peer reviewers are no longer eligible to inject. CEO must approve the latest draft, provide direction, or close this task.'
        });
        _rsTask._convergenceState = Object.assign({}, _rsTask._convergenceState, { notified: true, escalatedAt: (_rsTask._convergenceState && _rsTask._convergenceState.escalatedAt) || new Date().toISOString(), deliverableCount: _rsDels.length });
        _rsTask.updatedAt = new Date().toISOString();
        context.log('[Heartbeat] REVIEW LOOP ESCALATION:', _rsTask.id, '—', _rsDels.length, 'deliverables, stuck in review, escalating to CEO');
        try {
          var _rsAQ = (await storage.getState('approvalQueue')) || [];
          var _rsAlreadyInQueue = _rsAQ.some(function (q) {
            return q.type === 'convergence_escalation' && q.taskId === _rsTask.id && q.status === 'pending';
          });
          if (!_rsAlreadyInQueue) {
            _rsAQ.push({
              id: 'aq-revloopesc-' + _rsTask.id + '-' + Date.now(),
              type: 'convergence_escalation',
              taskId: _rsTask.id,
              taskTitle: _rsTask.title || _rsTask.id,
              originAgent: _rsTask.assignee || agentId,
              attempts: _rsDels.length,
              status: 'pending',
              createdAt: new Date().toISOString()
            });
            if (_rsAQ.length > 100) _rsAQ.splice(0, _rsAQ.length - 100);
            await storage.setState('approvalQueue', _rsAQ);
            context.log('[Heartbeat] REVIEW LOOP ESCALATION: added to approvalQueue for task', _rsTask.id);
          }
        } catch (_rsErr) {
          context.log('[Heartbeat] REVIEW LOOP ESCALATION: approvalQueue write failed (non-fatal):', String(_rsErr).substring(0, 200));
        }
      }
    }
  }

  // ECHO DONE-TASK SOCIAL INJECTION: for done Echo social tasks,
  // inject create-social-action so the post reaches CEO approval queue.
  // If no reviewed_copy exists, the copy review gate creates a Scribe task.
  // Runs outside the anti-stall guard — must always fire regardless of other work actions.
  if (agentId === 'echo') {
    const _doneSocialMaxAge2 = 7 * 24 * 60 * 60 * 1000;
    const _doneSocialAll = tasks.filter(function (t) {
      if (t.assignee !== 'echo' || t.status !== 'done' || t._archived) return false;
      if (t._social_action_suppressed_dup) return false; // near-dup: don't re-inject every cycle
      if (t._social_post_deferred_until && new Date(t._social_post_deferred_until).getTime() > Date.now()) return false; // daily cap: wait out defer window
      if ((t._social_action_attempts || 0) >= QGV.SOCIAL_ATTEMPTS_CAP) return false; // B1: attempts exhausted — CEO revision resets
      var age = Date.now() - new Date(t.createdAt || 0).getTime();
      if (age > _doneSocialMaxAge2) return false;
      var txt = ((t.title || '') + ' ' + (t.description || '')).toLowerCase();
      return /^social_/.test(t.taskType || '') || t.campaign_id || /linkedin|twitter|x\.com|social media|social post|bluesky|tweet/.test(txt);
    });
    if (_doneSocialAll.length > 0) {
      try {
        const _doneActions2 = (await storage.getState('actions')) || [];
        const _donePending2 = new Set();
        for (var _dai2 = 0; _dai2 < _doneActions2.length; _dai2++) {
          var _da2 = _doneActions2[_dai2];
          if (!_da2 || !_da2.type || _da2.type.indexOf('social_post') !== 0) continue;
          var _daStatus2 = (_da2.approval && _da2.approval.status) || '';
          if (_daStatus2 === 'rejected' || _daStatus2 === 'cancelled') continue;
          var _daExec2 = (_da2.execution && _da2.execution.status) || '';
          if (_daExec2 === 'success') continue;
          if (_da2._parentTaskId) _donePending2.add(_da2._parentTaskId);
        }
        var _readyToPost = _doneSocialAll.filter(function (t) { return !_donePending2.has(t.id); });
        for (var _rp = 0; _rp < _readyToPost.length; _rp++) {
          var _rpTask = _readyToPost[_rp];
          var _rpText = ((_rpTask.title || '') + ' ' + (_rpTask.description || '')).toLowerCase();
          var _rpPlatform = (_rpTask.taskType === 'social_linkedin' || /linkedin/.test(_rpText)) ? 'linkedin'
            : (_rpTask.taskType === 'social_x' || /twitter|x\.com|tweet/.test(_rpText)) ? 'x'
            : (_rpTask.taskType === 'social_bluesky' || /bluesky/.test(_rpText)) ? 'bluesky'
            : (_rpTask.taskType === 'social_reddit' || /\breddit\b/.test(_rpText)) ? 'reddit'
            : (_rpTask.taskType === 'social_facebook' || /facebook|fb\.com/.test(_rpText)) ? 'facebook'
            : 'linkedin';
          context.log('[Heartbeat] DONE-TASK SOCIAL: echo injecting create-social-action for done task:', _rpTask.id, 'platform:', _rpPlatform, 'reviewed_copy:', _rpTask.reviewed_copy ? 'YES' : 'NO');
          actions.push({
            type: 'create-social-action',
            taskId: _rpTask.id,
            social: { platform: _rpPlatform, text: _rpTask.reviewed_copy || '' },
            summary: 'Post reviewed social copy for ' + (_rpTask.title || _rpTask.id)
          });
        }
      } catch (_rpe) {
        context.log('[Heartbeat] DONE-TASK SOCIAL: echo injection error (non-fatal):', String(_rpe).substring(0, 200));
      }
    }
  }

  // Track visual docs created this cycle — blocks same-cycle submit-for-publish
  const _visualDocsCreatedThisCycle = new Set();
  const _VISUAL_DOC_KINDS = ['marketing_post', 'product_brief'];

  // Tier 4 sub-agent action restrictions (server-side enforcement)
  const TIER4_FORBIDDEN = ['create-social-action', 'create-doc', 'submit-for-publish', 'create-task', 'create-content-package'];
  const isTier4 = agent.tier === 4;

  // Work-producing actions bypass dedup entirely — deliverables are always unique
  const _DEDUP_EXEMPT = new Set(['execute-task', 'create-doc', 'create-social-action', 'generate-image', 'create-content-package', 'review-task']);

  // Revenue Seasons privilege tier — vanguard +1 action slot, probation -1 (floor 1).
  const _privTier = (_agentRewards && _agentRewards.privileges && _agentRewards.privileges.enabled !== false &&
    _agentRewards.privileges.tiers && _agentRewards.privileges.tiers[agentId]) || 'line';
  const _slotCap = Math.max(1, GUARDRAILS.maxActionsPerCyclePerAgent +
    (_privTier === 'vanguard' ? 1 : (_privTier === 'probation' ? -1 : 0)));

  for (const action of actions) {
    // Rate limit: previously silent `break` dropped remaining actions without logging.
    // Now: log each dropped action as a policy-violation + continue the loop so we catch
    // the full scale. End-of-agent block writes an auto-memory so the agent sees the drop
    // next cycle (closes the learning loop via the existing memory injection path).
    if (actionCount >= _slotCap) {
      await logEvent('policy-violation', agentId,
        'Rate limit exceeded: action dropped (cap ' + _slotCap + ')', cycleId,
        { runId: cycleId, gate: 'rate_limit', reason: 'max_actions_per_cycle_exceeded',
          cap: _slotCap, droppedActionType: action.type });
      result.rateLimitDropped = (result.rateLimitDropped || 0) + 1;
      continue;
    }

    // Block forbidden actions for Tier 4 sub-agents
    if (isTier4 && TIER4_FORBIDDEN.indexOf(action.type) !== -1) {
      context.log('[Heartbeat]', agentId, 'BLOCKED forbidden action:', action.type, '(Tier 4 restriction)');
      _countSilentDrop('tier4_forbidden', action.type);
      continue;
    }

    // Only Echo can create social posts (server-side enforcement)
    if (action.type === 'create-social-action' && agentId !== 'echo') {
      context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action (only Echo can post)');
      _countSilentDrop('social_echo_only', action.taskId || action.type);
      continue;
    }

    // ── TASK TYPE PIPELINE GUARD ──
    // Validate action type matches the task's taskType to prevent pipeline mismatches
    if (action.taskId) {
      const _ttTask = tasks.find(t => t.id === action.taskId);
      const _ttType = _ttTask ? (_ttTask.taskType || 'general') : 'general';
      const _ttSocial = ['social_x', 'social_linkedin', 'social_bluesky', 'social_reddit', 'social_facebook'];
      const _ttBlog = ['blog_post', 'article', 'newsletter'];
      const _ttDoc = ['blog_post', 'article', 'newsletter', 'internal_doc'];
      const _ttContent = ['design_asset'];

      // Block: social action on a non-social task
      if (action.type === 'create-social-action' && _ttType !== 'general' && _ttSocial.indexOf(_ttType) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action on', action.taskId, '— taskType is', _ttType, '(expected social_x/social_linkedin/social_bluesky/social_reddit)');
        _countSilentDrop('pipeline_type_mismatch', action.type + ' on ' + _ttType + ' [' + action.taskId + ']');
        continue;
      }
      // Block: content package on a non-content task
      if (action.type === 'create-content-package' && _ttType !== 'general' && _ttContent.indexOf(_ttType) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-content-package on', action.taskId, '— taskType is', _ttType, '(expected design_asset)');
        _countSilentDrop('pipeline_type_mismatch', action.type + ' on ' + _ttType + ' [' + action.taskId + ']');
        continue;
      }
      // Warn: create-doc on task that doesn't require docs (soft — log only)
      if (action.type === 'create-doc' && _ttType !== 'general' && _ttDoc.indexOf(_ttType) === -1) {
        context.log('[Heartbeat]', agentId, 'WARNING: create-doc on', action.taskId, '— taskType is', _ttType, '(docs usually for blog_post/article/newsletter/internal_doc)');
      }
      // Warn: submit-for-publish on task that doesn't require docs
      if (action.type === 'submit-for-publish' && _ttType !== 'general' && _ttDoc.indexOf(_ttType) === -1) {
        context.log('[Heartbeat]', agentId, 'WARNING: submit-for-publish on', action.taskId, '— taskType is', _ttType, '(publish usually for blog_post/article/newsletter/internal_doc)');
      }
      // Log: track all taskType + action combinations for monitoring
      if (_ttType !== 'general') {
        context.log('[Heartbeat] PIPELINE:', agentId, action.type, 'on taskType:', _ttType, 'task:', action.taskId);
      }
    }

    // Nova escalation guard: skip actions on tasks handled by domain lead
    if (novaSkipTaskIds && action.taskId && novaSkipTaskIds.has(action.taskId)) {
      const skipTarget = tasks.find(t => t.id === action.taskId);
      const dlead = skipTarget ? (skipTarget.domainLead || DOMAIN_LEAD_MAP[(skipTarget.assignee || '').toLowerCase()] || '?') : '?';
      context.log('[Heartbeat] Nova SKIPPED action on', action.taskId,
        '— handled by domain lead (' + dlead + '), not High/Blocked/Overdue');
      _countSilentDrop('nova_domain_lead_skip', action.taskId);
      continue;
    }

    const _isDedupeExempt = _DEDUP_EXEMPT.has(action.type);
    // create-task carries no taskId yet, so without a discriminator N different creates
    // in one cycle all key as "Agent: create-task" and only the first survives the
    // dedupe below. Key on the proposed title to keep distinct creates distinct.
    const _createTitleKey = (action.type === 'create-task' && action.task && action.task.title)
      ? ' — ' + String(action.task.title).substring(0, 80) : '';
    const summary = agent.name + ': ' + (action.summary || action.type || 'action') + (action.taskId ? ' [' + action.taskId + ']' : '') + _createTitleKey;

    // Dedupe (skipped for work-producing actions)
    if (!_isDedupeExempt && recentSummaries.has(summary)) {
      context.log('[Heartbeat]', agentId, 'skipping duplicate:', summary);
      _countSilentDrop('summary_dedup', summary);
      continue;
    }

    if (action.type === 'create-task' && action.task) {
      // SERVER-SIDE GUARD: active task ceiling — prevent unbounded task growth
      const _activeTaskCount = tasks.filter(t => t.status !== 'done' && t.status !== 'archived').length;
      if (_activeTaskCount >= GUARDRAILS.maxActiveTasks) {
        result.guardrails.taskCeilingBlocked++;
        context.log('[Heartbeat]', agentId, 'BLOCKED create-task: active task ceiling reached (' + _activeTaskCount + '/' + GUARDRAILS.maxActiveTasks + ')');
        await logEvent('policy-violation', agentId, 'Task ceiling blocked create-task', cycleId,
          { runId: cycleId, gate: 'task_ceiling', reason: 'max_active_tasks_' + GUARDRAILS.maxActiveTasks,
            activeCount: _activeTaskCount, cap: GUARDRAILS.maxActiveTasks, title: (action.task.title || '').substring(0, 120) });
        continue;
      }

      // SERVER-SIDE GUARD: research task ceiling — max 5 active research tasks at a time
      if ((action.task.taskType || '').toLowerCase() === 'research' || /^research\s*brief/i.test(action.task.title || '')) {
        const _activeResearch = tasks.filter(t => t.status !== 'done' && t.status !== 'archived' && t.status !== 'canceled' && t.taskType === 'research').length;
        if (_activeResearch >= 5) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-task: research task ceiling reached (' + _activeResearch + '/5). Title:', action.task.title);
          await logEvent('policy-violation', agentId, 'Research ceiling blocked create-task', cycleId,
            { runId: cycleId, gate: 'research_ceiling', reason: 'max_research_5',
              activeCount: _activeResearch, cap: 5, title: (action.task.title || '').substring(0, 120) });
          continue;
        }
      }

      // SERVER-SIDE GUARD: block agents from creating hero image tasks — system auto-creates them
      if ((action.task.assignee || '').toLowerCase() === 'pixel' && /hero\s*image/i.test(action.task.title || '')) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-task: hero image tasks are auto-created by the system, not agents. Title:', action.task.title);
        _countSilentDrop('hero_image_autocreated', action.task.title);
        continue;
      }

      // Inherit linking from parent campaign when provided
      var _taskCampaignId = action.task.campaign_id || action.task.directive_id || null;
      var _taskObjectiveId = action.task.objective_id || null;
      if (_taskCampaignId && campaignCtx && campaignCtx.campaignById && campaignCtx.campaignById[_taskCampaignId]) {
        var _parentCmp = campaignCtx.campaignById[_taskCampaignId];
        if (!_taskObjectiveId && _parentCmp.objective_id) _taskObjectiveId = _parentCmp.objective_id;

        // Early taskType read for cadence gate (full inference happens later at _taskType declaration)
        var _earlyTaskType = action.task.taskType || null;
        if (!_earlyTaskType) {
          var _etTitle = ((action.task.title || '') + ' ' + (action.task.description || '')).toLowerCase();
          if (/linkedin/.test(_etTitle)) _earlyTaskType = 'social_linkedin';
          else if (/bluesky/.test(_etTitle)) _earlyTaskType = 'social_bluesky';
          else if (/social.*post|post.*to.*x\b|tweet/.test(_etTitle)) _earlyTaskType = 'social_x';
          else if (/blog/.test(_etTitle)) _earlyTaskType = 'blog_post';
        }

        // SERVER-SIDE GUARD: campaign maxTasks cap — hard limit on tasks per campaign
        // Derive maxTasks from frequency when not explicitly set
        var _effectiveMaxTasks = (_parentCmp.maxTasks && typeof _parentCmp.maxTasks === 'number') ? _parentCmp.maxTasks : null;
        if (!_effectiveMaxTasks && _parentCmp.frequency && _parentCmp.cadence) {
          var _fmCadenceDays = { daily: 1, weekly: 7, biweekly: 14 };
          var _fmPeriodDays = _fmCadenceDays[_parentCmp.cadence] || 7;
          var _fmSocialTypes = (Array.isArray(_parentCmp.allowedTaskTypes) ? _parentCmp.allowedTaskTypes : []).filter(function(tt) { return /^social_/.test(tt); });
          var _fmPlatformCount = _fmSocialTypes.length || 1;
          var _fmStartMs = _parentCmp.startDate ? new Date(_parentCmp.startDate).getTime() : Date.now();
          var _fmEndMs = _parentCmp.endDate ? new Date(_parentCmp.endDate).getTime() : (_fmStartMs + 90 * 86400000);
          var _fmPeriods = Math.ceil(Math.max(1, Math.ceil((_fmEndMs - _fmStartMs) / 86400000)) / _fmPeriodDays);
          _effectiveMaxTasks = _parentCmp.frequency * _fmPeriods * _fmPlatformCount;
        }
        if (_effectiveMaxTasks) {
          // Exclude auto-created child tasks (copy tasks, hero images) — they inherit campaign_id
          // but are workflow artifacts, not campaign output
          var _cmpTaskCount = tasks.filter(function (t) {
            return t.campaign_id === _taskCampaignId && t.status !== 'archived' &&
              !(t.tags && t.tags.indexOf('auto-created') !== -1);
          }).length;
          if (_cmpTaskCount >= _effectiveMaxTasks) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-task: campaign "' + (_parentCmp.title || _taskCampaignId) + '" maxTasks reached (' + _cmpTaskCount + '/' + _effectiveMaxTasks + (_parentCmp.frequency ? ' derived from freq=' + _parentCmp.frequency : '') + ')');
            await logEvent('policy-violation', agentId, 'Campaign maxTasks blocked create-task', cycleId,
              { runId: cycleId, gate: 'campaign_freeze', reason: 'campaign_max_tasks_reached',
                campaignId: _taskCampaignId, current: _cmpTaskCount, cap: _effectiveMaxTasks });
            continue;
          }
        }

        // SERVER-SIDE GUARD: campaign cadence — throttle task creation rate
        // With frequency: subdivide cadence period (e.g. 3×/week → throttle = 7d/3 = ~2.3d)
        // Without frequency: one task per cadence period (legacy behavior)
        if (_parentCmp.cadence) {
          var _cadenceMs = { daily: 86400000, weekly: 604800000, biweekly: 1209600000 };
          var _basePeriod = _cadenceMs[_parentCmp.cadence] || 0;
          var _cadenceWindow = _basePeriod;
          if (_parentCmp.frequency && _parentCmp.frequency > 1 && _basePeriod > 0) {
            _cadenceWindow = Math.floor(_basePeriod / _parentCmp.frequency);
          }
          if (_cadenceWindow > 0) {
            var _cadenceStart = Date.now() - _cadenceWindow;
            var _recentCmpTask = tasks.find(function (t) {
              if (t.campaign_id !== _taskCampaignId || t.status === 'archived') return false;
              if (new Date(t.createdAt).getTime() <= _cadenceStart) return false;
              // Exclude auto-created child tasks — only real campaign tasks count toward cadence
              if (t.tags && t.tags.indexOf('auto-created') !== -1) return false;
              // Per-platform cadence for social tasks in multi-platform campaigns:
              // Only block if ALL allowed social platforms have recent tasks
              // (rotation will pick the right platform later)
              if (/^social_/.test(_earlyTaskType) && /^social_/.test(t.taskType || '')) {
                // For multi-platform campaigns, don't block here — let rotation handle it
                var _cgAllowed = _parentCmp.allowedTaskTypes || [];
                var _cgSocialTypes = _cgAllowed.filter(function(tt) { return /^social_/.test(tt); });
                if (_cgSocialTypes.length > 1) {
                  return false; // Skip per-platform check — handled by full-block check below
                }
                return t.taskType === _earlyTaskType;
              }
              return true;
            });
            if (_recentCmpTask) {
              context.log('[Heartbeat]', agentId, 'BLOCKED create-task: campaign "' + (_parentCmp.title || _taskCampaignId) + '" cadence=' + _parentCmp.cadence + ' — task "' + _recentCmpTask.title + '" created within window');
              await logEvent('policy-violation', agentId, 'Campaign cadence blocked create-task', cycleId,
                { runId: cycleId, gate: 'campaign_freeze', reason: 'cadence_window_active',
                  campaignId: _taskCampaignId, cadence: _parentCmp.cadence });
              continue;
            }
            // Multi-platform social: block only when ALL platforms have recent tasks
            if (/^social_/.test(_earlyTaskType)) {
              var _mpAllowed = (_parentCmp.allowedTaskTypes || []).filter(function(tt) { return /^social_/.test(tt); });
              if (_mpAllowed.length > 1) {
                var _mpAllThrottled = _mpAllowed.every(function(plat) {
                  return tasks.some(function(t) {
                    return t.campaign_id === _taskCampaignId && t.status !== 'archived' &&
                      !(t.tags && t.tags.indexOf('auto-created') !== -1) &&
                      t.taskType === plat &&
                      new Date(t.createdAt).getTime() > _cadenceStart;
                  });
                });
                if (_mpAllThrottled) {
                  context.log('[Heartbeat]', agentId, 'BLOCKED create-task: campaign "' + (_parentCmp.title || _taskCampaignId) + '" all social platforms throttled within cadence window');
                  await logEvent('policy-violation', agentId, 'Campaign all-platforms throttled', cycleId,
                    { runId: cycleId, gate: 'campaign_freeze', reason: 'multi_platform_throttled',
                      campaignId: _taskCampaignId, platforms: _mpAllowed });
                  continue;
                }
              }
            }
          }
        }

        // SERVER-SIDE GUARD: campaign startDate — no tasks before campaign begins
        if (_parentCmp.startDate && new Date(_parentCmp.startDate).getTime() > Date.now()) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-task: campaign "' + (_parentCmp.title || _taskCampaignId) + '" startDate not reached (' + _parentCmp.startDate + ')');
          await logEvent('policy-violation', agentId, 'Campaign startDate not reached', cycleId,
            { runId: cycleId, gate: 'campaign_freeze', reason: 'startDate_not_reached',
              campaignId: _taskCampaignId, startDate: _parentCmp.startDate });
          continue;
        }

        // SERVER-SIDE GUARD: campaign endDate — no new tasks after campaign deadline
        if (_parentCmp.endDate && new Date(_parentCmp.endDate).getTime() < Date.now()) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-task: campaign "' + (_parentCmp.title || _taskCampaignId) + '" endDate passed (' + _parentCmp.endDate + ')');
          await logEvent('policy-violation', agentId, 'Campaign endDate passed', cycleId,
            { runId: cycleId, gate: 'campaign_freeze', reason: 'endDate_passed',
              campaignId: _taskCampaignId, endDate: _parentCmp.endDate });
          continue;
        }
      }

      // SERVER-SIDE GUARD: agent-created tasks must link to a goal or campaign
      // Exempt operational categories (finance, ops, governance, maintenance, system_directive)
      const _taskCategory = (action.task.category || action.task.taskType || '').toLowerCase();
      const _operationalExempt = ['finance', 'ops', 'ops_breakfix', 'governance', 'maintenance', 'system_directive'].indexOf(_taskCategory) !== -1;
      const _hasObjective = _taskObjectiveId || (action.task.source && action.task.source.type === 'ceo');
      const _hasCampaign = _taskCampaignId;
      if (!_hasObjective && !_hasCampaign && !_operationalExempt) {
        result.guardrails.orphanBlocked++;
        context.log('[Heartbeat]', agentId, 'BLOCKED orphan task creation: "' + (action.task.title || '') + '" — must set objective_id or campaign_id');
        await logEvent('policy-violation', agentId, 'Orphan gate blocked task creation', cycleId,
          { runId: cycleId, gate: 'orphan', reason: 'missing_objective_or_campaign',
            category: _taskCategory, title: (action.task.title || '').substring(0, 120) });
        continue;
      }

      // ── System Directive Guards ──
      if (_taskCategory === 'system_directive') {
        // Only Forge and Nova can issue directives
        if (agentId !== 'forge' && agentId !== 'nova') {
          context.log('[Heartbeat]', agentId, 'BLOCKED system_directive: only forge and nova can issue directives');
          continue;
        }
        // Must target a different agent
        const _directiveTarget = (action.task.assignee || '').toLowerCase();
        if (!_directiveTarget || _directiveTarget === agentId) {
          context.log('[Heartbeat]', agentId, 'BLOCKED system_directive: must target a different agent');
          continue;
        }
        // Forge cannot directive Nova (must escalate to CEO)
        if (agentId === 'forge' && _directiveTarget === 'nova') {
          context.log('[Heartbeat] forge BLOCKED system_directive targeting nova — escalate to CEO instead');
          continue;
        }
        // Anti-loop: max 1 active directive per target agent
        const _existingDirective = tasks.find(t =>
          (t.category || '') === 'system_directive' &&
          (t.assignee || '').toLowerCase() === _directiveTarget &&
          t.status !== 'done'
        );
        if (_existingDirective) {
          context.log('[Heartbeat]', agentId, 'BLOCKED system_directive: active directive already exists for', _directiveTarget, ':', _existingDirective.id);
          continue;
        }
        // Force critical priority
        action.task.priority = 'critical';
        action.task.category = 'system_directive';
        // Track who issued it
        action.task.source_agent = agentId;
        context.log('[Heartbeat]', agentId, 'SYSTEM DIRECTIVE created for', _directiveTarget, ':', action.task.title);
        try {
          await logEvent('system-directive-created', agentId, 'System directive issued to ' + _directiveTarget, cycleId, {
            runId: cycleId,
            authorAgent: agentId,
            targetAgent: _directiveTarget,
            directiveTitle: (action.task.title || '').substring(0, 120)
          });
        } catch (_sdLogErr) {
          context.log('[Heartbeat]', agentId, 'system-directive-created logEvent failed (non-fatal):', String(_sdLogErr).substring(0, 200));
        }
      }

      // SERVER-SIDE DEDUP: block if an active task with very similar title already exists
      const proposedTitle = (action.task.title || '').toLowerCase().trim();
      if (proposedTitle) {
        const _normalize = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        const normalizedNew = _normalize(proposedTitle);
        const existingMatch = tasks.find(t => t.status !== 'done' && _normalize(t.title || '') === normalizedNew);
        if (existingMatch) {
          result.guardrails.exactDupBlocked++;
          context.log('[Heartbeat]', agentId, 'BLOCKED duplicate task creation:', proposedTitle, '— matches existing:', existingMatch.id);
          await logEvent('policy-violation', agentId, 'Exact duplicate task blocked', cycleId,
            { runId: cycleId, gate: 'exact_dup', reason: 'title_collision',
              proposedTitle: proposedTitle.substring(0, 120), existingTaskId: existingMatch.id });
          continue;
        }
        // Also check fuzzy: if 80%+ of words match
        const newWords = normalizedNew.split(' ').filter(w => w.length > 2);
        if (newWords.length >= 3) {
          const fuzzyMatch = tasks.find(t => {
            if (t.status === 'done') return false;
            const existingWords = _normalize(t.title || '').split(' ').filter(w => w.length > 2);
            if (existingWords.length === 0) return false;
            const overlap = newWords.filter(w => existingWords.indexOf(w) !== -1).length;
            return overlap / Math.max(newWords.length, existingWords.length) >= 0.8;
          });
          if (fuzzyMatch) {
            result.guardrails.fuzzyDupBlocked++;
            context.log('[Heartbeat]', agentId, 'BLOCKED fuzzy-duplicate task:', proposedTitle, '— similar to:', fuzzyMatch.title, '(', fuzzyMatch.id, ')');
            await logEvent('policy-violation', agentId, 'Fuzzy duplicate task blocked', cycleId,
              { runId: cycleId, gate: 'fuzzy_dup', reason: 'title_similarity_80pct',
                proposedTitle: proposedTitle.substring(0, 120), similarTaskId: fuzzyMatch.id,
                similarTitle: (fuzzyMatch.title || '').substring(0, 120) });
            continue;
          }
        }
      }
      // SERVER-SIDE GUARD: Block premature social promotion tasks for blog posts
      // Social tasks should ONLY be created after CEO publishes + promotes the blog post
      const _taskTitle = (action.task.title || '').toLowerCase();
      const _taskDesc = (action.task.description || '').toLowerCase();
      const _taskText = _taskTitle + ' ' + _taskDesc;
      const _isSocialPromoTask = /social\s*(media|post|promo|copy|campaign)|promote.*blog|blog.*promo/.test(_taskText);
      const _refsBlogPost = /blog\s*post|hello\s*world|marketing_post|first\s*post/.test(_taskText);
      if (_isSocialPromoTask && _refsBlogPost) {
        result.guardrails.socialPromoGateBlocked++;
        context.log('[Heartbeat]', agentId, 'BLOCKED premature social promo task:', action.task.title, '— blog must be published + promoted first. Social tasks are auto-created on publish with promote=true.');
        await logEvent('policy-violation', agentId, 'Premature social promo task blocked', cycleId,
          { runId: cycleId, gate: 'social_promo', reason: 'premature_promo_before_publish',
            title: (action.task.title || '').substring(0, 120) });
        continue;
      }

      // Log raw Gemini output for debugging task creation issues
      context.log('[Heartbeat]', agentId, 'create-task RAW:', JSON.stringify({
        assignee: action.task.assignee,
        dueDate: action.task.dueDate,
        status: action.task.status,
        priority: action.task.priority
      }));

      // Campaign auto-creation DISABLED (CEO-only). Only match existing campaigns.
      if (!_taskCampaignId) {
        const _ctResult = await ensureCampaign({
          campaign_id: _taskCampaignId || null,
          title: action.task.title || '',
          description: action.task.description || '',
          goalId: _taskObjectiveId || null,
          division: action.task.division || null,
          provenance: 'Auto: Campaign ' + agentId,
          campaigns: (campaignCtx && campaignCtx.campaigns) ? campaignCtx.campaigns : [],
          entrypoint: 'heartbeat_create_task',
          debug: true,
          logger: context.log
        });
        if (_ctResult.created) {
          // Undo the auto-created campaign — remove it from campaigns array
          const _cmpArr = (campaignCtx && campaignCtx.campaigns) ? campaignCtx.campaigns : [];
          const _cmpIdx = _cmpArr.indexOf(_ctResult.campaign);
          if (_cmpIdx !== -1) _cmpArr.splice(_cmpIdx, 1);
          context.log('[Heartbeat]', agentId, 'create-task: blocked campaign auto-creation for "' + (action.task.title || '') + '" (CEO-only)');
        } else {
          _taskCampaignId = _ctResult.campaignId;
        }
      }

      // Only Nova can set parent_task_id — strip from other agents to keep hierarchy clean
      var _parentTaskId = (agentId === 'nova' && action.task.parent_task_id) ? action.task.parent_task_id : null;
      if (action.task.parent_task_id && agentId !== 'nova') {
        context.log('[Heartbeat]', agentId, 'STRIPPED parent_task_id from create-task — only Nova can set task hierarchy');
      }
      // Pass through taskType if agent provides it; auto-infer from title if not set
      let _taskType = action.task.taskType || null;
      if (!_taskType) {
        const _ctTitle = ((action.task.title || '') + ' ' + (action.task.description || '')).toLowerCase();
        if (/write.*blog|draft.*blog|blog\s*post|create.*blog|publish.*blog|new.*blog|first\s*blog|write.*article|marketing.*brief|content.*brief|draft.*brief/.test(_ctTitle)) _taskType = 'blog_post';
        else if (/linkedin.*post|post.*linkedin|draft.*linkedin/.test(_ctTitle)) _taskType = 'social_linkedin';
        else if (/bluesky.*post|post.*bluesky/.test(_ctTitle)) _taskType = 'social_bluesky';
        else if (/social.*post|post.*to.*x\b|tweet/.test(_ctTitle)) _taskType = 'social_x';
        else if (/hero\s*image|generate.*image.*blog|blog.*header/.test(_ctTitle)) _taskType = 'design_asset';
        else if (/spec\b|runbook|release.*note|governance.*doc|internal.*doc/.test(_ctTitle)) _taskType = 'internal_doc';
        else if (/research|competitive.*intel|market.*analysis/.test(_ctTitle)) _taskType = 'research';
        else if (/deploy|infrastructure|ci.*cd|pipeline|devops|scaling|azure.*function/.test(_ctTitle)) _taskType = 'ops';
        else if (/cost.*audit|budget.*review|api.*cost|cost.*project|financial.*review|spend.*analysis|cost.*analysis|audit.*cost/.test(_ctTitle)) _taskType = 'financial';
      }
      // SERVER-SIDE: count-based platform rotation for multi-platform social campaigns
      // Always pick the platform with the fewest existing tasks to ensure even distribution
      if (_taskCampaignId && campaignCtx && campaignCtx.campaignById && campaignCtx.campaignById[_taskCampaignId] && /^social_/.test(_taskType)) {
        var _rotCmp = campaignCtx.campaignById[_taskCampaignId];
        var _rotAllowed = Array.isArray(_rotCmp.allowedTaskTypes) ? _rotCmp.allowedTaskTypes : [];
        var _rotSocialTypes = _rotAllowed.filter(function(tt) { return /^social_/.test(tt); });
        // Only rotate if campaign has 2+ social platforms
        if (_rotSocialTypes.length > 1) {
          // Count all non-archived social tasks per platform for this campaign
          var _rotCounts = {};
          _rotSocialTypes.forEach(function(tt) { _rotCounts[tt] = 0; });
          tasks.forEach(function(t) {
            if (t.campaign_id !== _taskCampaignId || t.status === 'archived') return;
            if (t.tags && t.tags.indexOf('auto-created') !== -1) return;
            if (_rotCounts.hasOwnProperty(t.taskType)) _rotCounts[t.taskType]++;
          });
          // Also count tasks created earlier in THIS heartbeat cycle (in result.taskUpdates)
          (result.taskUpdates || []).forEach(function(tu) {
            if (tu.action === 'create' && tu.task && tu.task.campaign_id === _taskCampaignId && _rotCounts.hasOwnProperty(tu.task.taskType)) {
              _rotCounts[tu.task.taskType]++;
            }
          });
          // Pick the platform with the fewest tasks, preferring one different from _taskType
          // (Nova defaults to social_linkedin, so we need to spread across platforms)
          var _rotMin = Infinity;
          _rotSocialTypes.forEach(function(tt) { if (_rotCounts[tt] < _rotMin) _rotMin = _rotCounts[tt]; });
          var _rotCandidates = _rotSocialTypes.filter(function(tt) { return _rotCounts[tt] === _rotMin; });
          // Prefer a different platform than what Nova defaulted to
          var _rotNext = _rotCandidates.find(function(tt) { return tt !== _taskType; }) || _rotCandidates[0];
          if (_rotNext && _rotNext !== _taskType) {
            context.log('[Heartbeat]', agentId, 'PLATFORM ROTATION: campaign "' + (_rotCmp.title || _taskCampaignId) + '" rotating', _taskType, '→', _rotNext, '(counts:', JSON.stringify(_rotCounts), ')');
            // Rewrite task title to reflect actual platform so Echo writes correct content
            var _platNames = { social_linkedin: 'LinkedIn', social_x: 'X', social_bluesky: 'Bluesky', social_reddit: 'Reddit' };
            var _oldPlatName = _platNames[_taskType] || _taskType;
            var _newPlatName = _platNames[_rotNext] || _rotNext;
            if (action.task.title) {
              action.task.title = action.task.title
                .replace(new RegExp(_oldPlatName, 'gi'), _newPlatName)
                .replace(/Draft social media posts/i, 'Draft ' + _newPlatName + ' post');
            }
            _taskType = _rotNext;
          } else {
            context.log('[Heartbeat]', agentId, 'PLATFORM ROTATION: keeping', _taskType, 'for campaign "' + (_rotCmp.title || _taskCampaignId) + '" (counts:', JSON.stringify(_rotCounts), ')');
          }
        }
      }
      // SERVER-SIDE GUARD: campaign allowedTaskTypes restriction — reject mismatched task types
      if (_taskCampaignId && campaignCtx && campaignCtx.campaignById && campaignCtx.campaignById[_taskCampaignId]) {
        var _cmpAllowed = campaignCtx.campaignById[_taskCampaignId].allowedTaskTypes;
        // Support legacy single taskType field too
        if (!_cmpAllowed && campaignCtx.campaignById[_taskCampaignId].taskType) _cmpAllowed = [campaignCtx.campaignById[_taskCampaignId].taskType];
        if (Array.isArray(_cmpAllowed) && _cmpAllowed.length > 0 && _cmpAllowed.indexOf(_taskType || 'general') === -1) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-task: campaign "' + (campaignCtx.campaignById[_taskCampaignId].title || _taskCampaignId) + '" allows [' + _cmpAllowed.join(', ') + '] but got ' + (_taskType || 'general'));
          continue;
        }
      }
      result.taskUpdates.push({
        action: 'create',
        task: {
          title: action.task.title || 'Untitled',
          description: action.task.description || '',
          taskType: _taskType || 'general',
          status: action.task.status || 'todo',
          priority: action.task.priority || 'medium',
          assignee: action.task.assignee || agentId,
          division: action.task.division || null,
          dueDate: action.task.dueDate || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          objective_id: _taskObjectiveId || null,
          campaign_id: _taskCampaignId || null,
          category: action.task.category || null,
          parent_task_id: _parentTaskId
        }
      });
    } else if (action.type === 'update-task' && action.taskId) {
      // Strip parent_task_id from non-Nova agents
      var _updates = action.updates || {};
      if (_updates.parent_task_id && agentId !== 'nova') {
        context.log('[Heartbeat]', agentId, 'STRIPPED parent_task_id from update-task — only Nova can set task hierarchy');
        delete _updates.parent_task_id;
      }
      if (_updates.child_task_ids && agentId !== 'nova') {
        context.log('[Heartbeat]', agentId, 'STRIPPED child_task_ids from update-task — only Nova can set task hierarchy');
        delete _updates.child_task_ids;
      }
      // Block agents from setting status=done via update-task — must go through peer review flow
      if (_updates.status === 'done') {
        const _utTarget = tasks.find(t => t.id === action.taskId);
        if (_utTarget) {
          const _utHasReview = (_utTarget.comments || []).some(c => c.type === 'review');
          const _utHasDeliverable = (_utTarget.comments || []).some(c => c.type === 'deliverable');
          if (!_utHasDeliverable || !_utHasReview) {
            context.log('[Heartbeat]', agentId, 'STRIPPED status=done from update-task on', action.taskId, '— no peer review yet (del:', _utHasDeliverable, 'rev:', _utHasReview + ')');
            delete _updates.status;
          }
        }
      }
      result.taskUpdates.push({
        action: 'update',
        taskId: action.taskId,
        updates: _updates
      });
    } else if (action.type === 'move-task' && action.taskId && action.newStatus) {
      // Block move-task to done — agents cannot skip the review flow
      if (action.newStatus === 'done') {
        const _mtTarget = tasks.find(t => t.id === action.taskId);
        if (_mtTarget && _mtTarget.tags && _mtTarget.tags.indexOf('social-copy') !== -1) {
          context.log('[Heartbeat]', agentId, 'BLOCKED move-task to done on social-copy task:', action.taskId, '— must go through review flow');
          continue;
        }
        // Block any task from being moved to done without a deliverable (no empty completions)
        const _mtDeliverables = _mtTarget ? (_mtTarget.comments || []).filter(c => c.type === 'deliverable') : [];
        if (_mtTarget && _mtDeliverables.length === 0) {
          context.log('[Heartbeat]', agentId, 'BLOCKED move-task to done on', action.taskId, '— no deliverable produced yet. Use execute-task first.');
          // Force execute instead — inject an execute-task action
          actions.push({ type: 'execute-task', taskId: action.taskId, summary: 'System: forced execute before done (no deliverable)' });
          continue;
        }
        // Block move-to-done without peer review — tasks must go through review-task path
        const _mtHasReview = _mtTarget ? (_mtTarget.comments || []).some(c => c.type === 'review') : false;
        if (_mtTarget && !_mtHasReview) {
          context.log('[Heartbeat]', agentId, 'BLOCKED move-task to done on', action.taskId, '— no peer review yet. Task must be reviewed first.');
          continue;
        }
      }
      // objective_id is optional — individual one-off tasks may have no goal or campaign
      result.taskUpdates.push({
        action: 'move',
        taskId: action.taskId,
        newStatus: action.newStatus
      });
    } else if (action.type === 'execute-task' && action.taskId) {
      // Echo uses execute-task to draft social copy — peer review happens before create-social-action
      // TRIAGE GATE: block execution on truly untouched tasks (zero comments = never triaged)
      // Exception: CEO-created tasks with assignee + dueDate are pre-triaged (CEO outranks Nova)
      if (agentId !== 'nova') {
        const targetTask = tasks.find(t => t.id === action.taskId);
        const hasAnyComment = targetTask && targetTask.comments && targetTask.comments.length > 0;
        const isCeoTriaged = targetTask && targetTask.source !== 'heartbeat' && targetTask.assignee && targetTask.dueDate;
        const isCampaignTask = targetTask && targetTask.campaign_id; // campaign tasks are auto-triaged by Nova
        if (targetTask && !hasAnyComment && !isCeoTriaged && !isCampaignTask) {
          context.log('[Heartbeat]', agentId, 'BLOCKED execute-task on', action.taskId, '— task has zero comments (needs Nova triage first)');
          continue;
        }
      }
      // DELIVERABLE GUARD: block re-execution if task already has a deliverable or is in review/done
      {
        const _exTask = tasks.find(t => t.id === action.taskId);
        if (_exTask) {
          if (_exTask.status === 'review' || _exTask.status === 'done') {
            context.log('[Heartbeat]', agentId, 'BLOCKED execute-task on', action.taskId, '— task already in', _exTask.status);
            continue;
          }
          // CONVERGENCE GUARD: if 5+ deliverables already exist, the task is looping — block and escalate
          const _deliverableCount = (_exTask.comments || []).filter(c => c.type === 'deliverable').length;
          if (_deliverableCount >= convergenceThresholdFor(_exTask.taskType)) {
            context.log('[Heartbeat]', agentId, 'CONVERGENCE BLOCKED execute-task on', action.taskId,
              '— task has', _deliverableCount, 'deliverables already (revision loop detected). Escalating to CEO.');
            // Only add the loop-detected comment once — don't spam every heartbeat cycle
            const _alreadyLoopWarned = !!(_exTask._convergenceState && _exTask._convergenceState.notified);
            if (!_alreadyLoopWarned) {
              result.taskUpdates.push({
                action: 'comment',
                taskId: action.taskId,
                comment: '[SYSTEM] Revision loop detected: ' + _deliverableCount + ' deliverables on this task without convergence. Task needs CEO review to break the cycle — either approve the latest draft, provide specific direction, or close the task.',
                agentId: 'system'
              });
              _exTask._convergenceState = Object.assign({}, _exTask._convergenceState, { notified: true, deliverableCount: _deliverableCount });
            }
            // Move to review so CEO sees it
            if (_exTask.status !== 'review') {
              result.taskUpdates.push({
                action: 'move',
                taskId: action.taskId,
                newStatus: 'review'
              });
            }
            // Convergence auto-publish moved to the convergence escalation block (~line 448).
            // That block runs during triage and actually fires; this location was unreachable
            // because convergence-locked tasks are filtered from _executableIdle before any
            // execute-task action reaches here.
            // No auto-complete for social or social-copy tasks — CEO must review via approval queue.
            // Push convergence_escalation to approvalQueue (backup path)
            try {
              var _ce2AQ = (await storage.getState('approvalQueue')) || [];
              var _ce2Already = _ce2AQ.some(function(q) { return q.type === 'convergence_escalation' && q.taskId === _exTask.id && q.status === 'pending'; });
              if (!_ce2Already) {
                _ce2AQ.push({
                  id: 'aq-convesc-' + _exTask.id + '-' + Date.now(),
                  type: 'convergence_escalation',
                  taskId: _exTask.id,
                  taskTitle: _exTask.title || _exTask.id,
                  originAgent: _exTask.assignee || agentId,
                  attempts: _deliverableCount,
                  status: 'pending',
                  createdAt: new Date().toISOString()
                });
                if (_ce2AQ.length > 100) _ce2AQ.splice(0, _ce2AQ.length - 100);
                await storage.setState('approvalQueue', _ce2AQ);
              }
            } catch (_ce2Err) {
              context.log('[Heartbeat] CONVERGENCE ESCALATION (backup): approvalQueue write failed:', String(_ce2Err).substring(0, 200));
            }
            continue;
          }
          const _hasDeliverable = _deliverableCount > 0;
          if (_hasDeliverable && _exTask.status !== 'in-progress') {
            context.log('[Heartbeat]', agentId, 'BLOCKED execute-task on', action.taskId, '— task already has a deliverable and is not in-progress (revision). Use review-task or comment-task instead.');
            continue;
          }
          if (_hasDeliverable && _exTask.status === 'in-progress') {
            context.log('[Heartbeat]', agentId, 'REVISION ALLOWED: re-executing task', action.taskId, '— has', _deliverableCount, 'prior deliverable(s), status is in-progress (changes-requested)');
          }
        }
      }
      // Execute: agent produces actual work on a task (costs 1 extra Gemini call)
      if (result.executes >= GUARDRAILS.maxExecutesPerCyclePerAgent) {
        context.log('[Heartbeat]', agentId, 'max executes reached — skipping execute-task, freeing action slot for other actions');
        continue;
      } else {
        const task = tasks.find(t => t.id === action.taskId);
        if (task) {
          // Move to in-progress before executing (todo → in-progress → review flow)
          if (task.status === 'todo' || task.status === 'backlog') {
            task.status = 'in-progress';
            task.updatedAt = new Date().toISOString();
            context.log('[Heartbeat]', agentId, 'moved task to in-progress before execute:', action.taskId);
          }
          let deliverable = await executeTask(context, agent, task, costIntel, siteIntel, socialIntel, execContext);
          result.geminiCalls++;
          if (deliverable) {
            // Server-side preamble strip: remove conversational preamble before actual content
            // Match lines starting with conversational openers up to the first ## heading or **bold** content marker
            if (/^(?:Okay|Sure|Alright|Great|Here|Let me|I'll|I will|I've|Of course)/i.test(deliverable)) {
              var _headingIdx = deliverable.search(/\n(?:##\s|(?:\*\*(?:Headline|Title|Body|Draft|Post|Hook|Content|Copy|Subject|Platform|Website|Focus|LinkedIn|Twitter|Bluesky)[:\s*]))/i);
              if (_headingIdx > 0 && _headingIdx < 500) {
                deliverable = deliverable.substring(_headingIdx + 1);
              } else {
                // Fallback: no heading found — strip preamble line(s) up to first double-newline
                // Catches "Okay, here's the copy for LinkedIn:\n\nThe future of..."
                var _dblNewline = deliverable.search(/\n\s*\n/);
                if (_dblNewline > 0 && _dblNewline < 300) {
                  deliverable = deliverable.substring(_dblNewline).replace(/^\s*\n+/, '');
                }
              }
            }
            // BLUESKY REPLY: defer deliverable push until after QG — prevents peer review
            // from completing the task when QG rejects (deliverable comment would stay on task,
            // Cipher would see it and approve, bypassing the approval queue entirely).
            var _isBsReply = task.tags && task.tags.indexOf('bluesky-reply') !== -1 && task.threadContext;
            if (!_isBsReply) {
              result.taskUpdates.push({
                action: 'execute',
                taskId: action.taskId,
                deliverable: deliverable,
                agentId: agentId
              });
            }
            result.executes = (result.executes || 0) + 1;

            // BLUESKY REPLY: task tagged bluesky-reply — route directly to approval queue as social_post.reply action
            // Skip Quill (the draft IS the final copy). Scribe's deliverable is the reply text itself.
            if (_isBsReply) {
              // Scribe sometimes echoes the task's labels back as a formatted document
              // ("Bluesky Reply Draft", "**To:** @handle", "**Reply:** ..."), which would
              // otherwise be posted to Bluesky verbatim. Strip it down to the genuine reply text.
              const _stripReplyScaffolding = function (raw) {
                let t = String(raw || '').trim();
                const _lines = t.split('\n');
                // Drop leading scaffolding lines: a draft/title header, To:/Platform:/Thread:
                // labels, and blank lines, until we hit real content.
                while (_lines.length) {
                  const _ln = _lines[0].trim();
                  if (_ln === '' ||
                      /^\*{0,2}\s*(?:bluesky\s+)?reply\s+draft\s*\*{0,2}\.?$/i.test(_ln) ||
                      /^\*{0,2}\s*(?:to|platform|thread|in\s+reply\s+to|replying\s+to|context|original\s+post)\s*\*{0,2}\s*:/i.test(_ln)) {
                    _lines.shift();
                  } else { break; }
                }
                t = _lines.join('\n').trim();
                // Drop a leading "Reply:" label if one survived the line strip.
                t = t.replace(/^\*{0,2}\s*reply\s*\*{0,2}\s*:\s*\*{0,2}\s*/i, '');
                // Unwrap a fully quote-wrapped reply.
                if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
                  t = t.slice(1, -1).trim();
                }
                return t.trim();
              };
              const _replyText = _stripReplyScaffolding(deliverable);
              // Empty deliverable = Scribe explicitly chose not to reply (spam, nothing to add)
              if (!_replyText || _replyText.length < 5) {
                result.taskUpdates.push({ action: 'move', taskId: action.taskId, newStatus: 'done' });
                result.taskUpdates.push({
                  action: 'comment', taskId: action.taskId,
                  comment: 'Scribe declined to draft a reply for this thread (empty deliverable — likely spam or nothing genuine to add).',
                  agentId: 'system'
                });
                context.log('[Heartbeat] scribe: bluesky-reply declined for task', action.taskId);
                continue;
              }
              // Enforce proper sentence-case (founder-voice writes lowercase), then truncate
              // to 280 chars max (bluesky cap is 300, leave headroom).
              let _finalReply = capitalizeSentences(_replyText).substring(0, 280);
              // Deterministic report-link repair: swap invented ambient* URLs for the real
              // report link from the [SCAN RESULT] comment, or append it when omitted.
              // The drafter can't be trusted to copy it (see repairReplyLink in
              // prospect-pipeline.js). No scan comment (CEO-curated replies) → no-op.
              try {
                const _prospectScanCmt = (task.comments || []).find(function (c) {
                  return String(c.text || '').indexOf('[SCAN RESULT]') === 0;
                });
                if (_prospectScanCmt) {
                  const _repairedReply = _repairReplyLink(_finalReply, _prospectScanCmt.text);
                  if (_repairedReply !== _finalReply) {
                    context.log('[Heartbeat] scribe: bluesky-reply report-link repair applied for task', action.taskId);
                    _finalReply = _repairedReply;
                  }
                }
              } catch (_lrErr) {
                context.log('[Heartbeat] scribe: link repair failed (non-fatal):', String(_lrErr).substring(0, 120));
              }
              const _tc = task.threadContext;
              // Crash-idempotency guard (2026-07-24 fruitfop incident): reply actions +
              // AQ entries are written to storage immediately, but the task close rides
              // end-of-run persistence. A cycle that dies between the two leaves the task
              // open, and the next cycle re-drafts — the CEO then sees duplicate outreach
              // to the same prospect. If a pending reply for this task already exists,
              // close the task instead of drafting a second one.
              const _actionsStoreForReply = (await storage.getState('actions')) || [];
              const _pendingReplyDup = _actionsStoreForReply.find(function (a) {
                return a && a.type === 'social_post.reply' && a._parentTaskId === action.taskId &&
                  a.approval && a.approval.status === 'pending';
              });
              if (_pendingReplyDup) {
                result.taskUpdates.push({ action: 'move', taskId: action.taskId, newStatus: 'done' });
                result.taskUpdates.push({
                  action: 'comment', taskId: action.taskId,
                  comment: 'A reply for this task is already pending CEO approval (' + _pendingReplyDup.id + ') — closed without a second draft (crash-recovery dedup).',
                  agentId: 'system'
                });
                context.log('[Heartbeat] scribe: bluesky-reply dedup — pending reply already exists for task', action.taskId);
                continue;
              }
              // Create a social_post.reply action
              const _replyActionId = 'act_' + Date.now() + '_bsreply_' + Math.random().toString(36).substr(2, 5);
              const _replyAction = {
                id: _replyActionId,
                created_at: new Date().toISOString(),
                created_by: 'scribe',
                type: 'social_post.reply',
                platform: 'bluesky',
                payload: {
                  text: _finalReply,
                  reply: {
                    // threadContext.root carries the TRUE thread root when the task
                    // replies mid-thread (engagement loop: their comment sits under a
                    // post that may itself be a reply). Without it bsky renders the
                    // reply detached. Top-level replies fall back to root === parent.
                    root: (_tc.root && _tc.root.uri && _tc.root.cid)
                      ? { uri: _tc.root.uri, cid: _tc.root.cid }
                      : { uri: _tc.uri, cid: _tc.cid },
                    parent: { uri: _tc.uri, cid: _tc.cid }
                  }
                },
                classification: 'advisory',
                risk_level: 'low',
                _parentTaskId: action.taskId,
                approval: { status: 'pending' }
              };
              _actionsStoreForReply.push(_replyAction);
              await storage.setState('actions', _actionsStoreForReply);

              // Quality gate runs on the reply text too — catches hallucinations + voice violations
              let _qgReplyResult = null;
              try {
                _qgReplyResult = await _validateContentQuality(_finalReply, 'bluesky', context);
              } catch (_qgErr) { /* fail-open */ }
              // Compose with the deterministic detectors — fabricated URLs, content leaks,
              // ungrounded offer claims, platform length. 2026-07-24 fruitfop incident:
              // Haiku alone passed invented report links (ambientpixels.ai/score/<site>,
              // ambientscore.ai/s/<site>) at confidence 95 on THIS path — the detector
              // shipped 07-23 but was only wired into create-social-action + auto-post.
              // Replies are the copy that carries report links; deterministic failures
              // return confidence 100 so the >= 70 reject branch below always fires.
              try {
                var _rtReplyOffers = null;
                try { _rtReplyOffers = ((await storage.getState('systemConfig')) || {}).offers; } catch (_roErr) { /* file offers only */ }
                _qgReplyResult = QGV.composeQualityVerdict({
                  llm: _qgReplyResult,
                  text: _finalReply,
                  platform: 'bluesky',
                  offers: QGV.FILE_OFFERS.concat(Array.isArray(_rtReplyOffers) ? _rtReplyOffers : []),
                  grounding: QGV.findUngroundedClaims(_finalReply, QGV.buildGroundingText(task, _productFacts))
                });
                context.log('[QualityGate] bluesky-reply pass:', _qgReplyResult.pass, 'confidence:', _qgReplyResult.confidence, 'det:', JSON.stringify(_qgReplyResult.deterministicFlags || {}));
              } catch (_qgvErr) {
                context.log('[QualityGate] bluesky-reply compose error (LLM-only fallback):', String(_qgvErr).substring(0, 150));
              }

              if (_qgReplyResult && !_qgReplyResult.pass && (_qgReplyResult.confidence || 0) >= 70) {
                // Rejected — remove action, reset task for Scribe rewrite
                const _idx = _actionsStoreForReply.findIndex(function(a) { return a.id === _replyActionId; });
                if (_idx !== -1) _actionsStoreForReply.splice(_idx, 1);
                await storage.setState('actions', _actionsStoreForReply);
                task.status = 'in-progress';
                task.updatedAt = new Date().toISOString();
                task.comments = task.comments || [];
                task.comments.push({
                  id: 'cmt-bsqgfail-' + Date.now(),
                  author: 'system',
                  text: 'QUALITY GATE FAILED on bluesky reply — Issues:\n- ' + (_qgReplyResult.issues || []).join('\n- ') + '\n\nRewrite following Founder Voice rules. No em dashes, no hype, 5th grade reading level.',
                  type: 'system',
                  createdAt: new Date().toISOString()
                });
                context.log('[Heartbeat] scribe: bluesky-reply quality gate REJECTED for task', action.taskId);

                // Quality-gate feedback memory (bluesky-reply path) — closes learning loop.
                try {
                  if (!_agentMemoryStore[agentId]) _agentMemoryStore[agentId] = [];
                  const _qgrNow = new Date();
                  const _qgrIssues = (_qgReplyResult.issues || []).slice(0, 5).join('; ');
                  _agentMemoryStore[agentId].push({
                    id: 'mem_' + Date.now() + '_qgr_' + Math.random().toString(36).substr(2, 4),
                    type: 'feedback',
                    text: 'Quality gate rejected my last bluesky reply. Issues: ' + (_qgrIssues || 'unspecified') +
                      '. Apply these corrections on next draft — no em dashes, no hype, 5th grade reading level.',
                    source: 'auto:quality-gate',
                    timestamp: _qgrNow.toISOString(),
                    expiresAt: new Date(_qgrNow.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    evidence: { runId: cycleId }
                  });
                  if (_agentMemoryStore[agentId].length > MAX_MEMORIES_PER_AGENT) {
                    _agentMemoryStore[agentId] = _agentMemoryStore[agentId].slice(-MAX_MEMORIES_PER_AGENT);
                  }
                } catch (_qgrMemErr) {
                  context.log('[Heartbeat]', agentId, 'Quality-gate (reply) memory write failed:', String(_qgrMemErr).substring(0, 200));
                }

                // Governance log entry for bluesky-reply rejection.
                try {
                  await logEvent('policy-violation', agentId, 'Quality gate rejected bluesky reply', cycleId, {
                    runId: cycleId,
                    gate: 'quality_gate',
                    reason: 'haiku_rejection',
                    platform: 'bluesky-reply',
                    confidence: _qgReplyResult.confidence || null,
                    issueCount: (_qgReplyResult.issues || []).length,
                    issuesPreview: ((_qgReplyResult.issues || []).slice(0, 5).join('; ')).substring(0, 200)
                  });
                } catch (_qgrLogErr) {
                  context.log('[Heartbeat]', agentId, 'Quality-gate (reply) logEvent failed:', String(_qgrLogErr).substring(0, 200));
                }

                continue;
              }

              // Stamp the composed verdict on the ACTION too — grace-window + dashboards
              // read action.qualityGate; before this the reply path left it null, which
              // made the fruitfop incident invisible until someone diffed the AQ entries.
              if (_qgReplyResult) {
                _replyAction.qualityGate = {
                  pass: !!_qgReplyResult.pass, confidence: _qgReplyResult.confidence || 0,
                  issues: (_qgReplyResult.issues || []).slice(0, 6),
                  deterministicFlags: _qgReplyResult.deterministicFlags || null
                };
                await storage.setState('actions', _actionsStoreForReply);
              }

              // Add to approval queue as bluesky_reply kind
              const _aqQueue = (await storage.getState('approvalQueue')) || [];
              const _aqReplyEntry = {
                id: 'aq-reply-' + _replyActionId,
                kind: 'bluesky_reply',
                action_id: _replyActionId,
                taskId: action.taskId,
                taskTitle: 'Bluesky reply to @' + (_tc.author || 'unknown'),
                originAgent: 'scribe',
                classification: 'advisory',
                riskLevel: 'low',
                budgetImpact: 0,
                brandImpact: 'low',
                status: 'pending',
                submittedAt: new Date().toISOString(),
                preview: _finalReply.substring(0, 200),
                threadContext: {
                  uri: _tc.uri,
                  cid: _tc.cid,
                  author: _tc.author,
                  originalText: (_tc.originalText || '').substring(0, 300)
                },
                replyText: _finalReply
              };
              if (_qgReplyResult) {
                _aqReplyEntry.qualityGate = {
                  pass: !!_qgReplyResult.pass,
                  confidence: _qgReplyResult.confidence || 0,
                  issues: _qgReplyResult.issues || [],
                  deterministicFlags: _qgReplyResult.deterministicFlags || null,
                  model: 'claude-haiku-4-5-20251001',
                  checkedAt: new Date().toISOString()
                };
              }
              _aqQueue.push(_aqReplyEntry);
              if (_aqQueue.length > 100) _aqQueue.splice(0, _aqQueue.length - 100);
              await storage.setState('approvalQueue', _aqQueue);

              // Now safe to add the deliverable (QG passed) and mark done
              result.taskUpdates.push({
                action: 'execute',
                taskId: action.taskId,
                deliverable: deliverable,
                agentId: agentId
              });
              result.taskUpdates.push({ action: 'move', taskId: action.taskId, newStatus: 'done' });
              context.log('[Heartbeat] scribe: bluesky-reply drafted and queued for CEO approval:', action.taskId, '→ action', _replyActionId);
              continue; // skip the social-copy branch
            }

            // SOCIAL COPY: route to Quill for brand voice review, EXCEPT promo copy (low-risk blog summaries)
            if (task.tags && task.tags.indexOf('social-copy') !== -1) {
              // Promo copy (blog promotion) skips Quill — auto-complete and propagate reviewed_copy immediately
              var _isPromoCopy = task.parent_task_id && tasks.some(function(pt) {
                return pt.id === task.parent_task_id && pt.tags && pt.tags.indexOf('promote-pipeline') !== -1;
              });
              if (_isPromoCopy) {
                // Auto-complete: mark done, propagate copy to parent promo task
                result.taskUpdates.push({ action: 'move', taskId: action.taskId, newStatus: 'done' });
                var _promoParent = tasks.find(function(pt) { return pt.id === task.parent_task_id; });
                if (_promoParent && deliverable) {
                  _promoParent.reviewed_copy = deliverable;
                  _promoParent.awaiting_copy_review = false;
                  _promoParent._social_action_pending = true;
                  _promoParent.updatedAt = new Date().toISOString();
                  if (!_promoParent.comments) _promoParent.comments = [];
                  _promoParent.comments.push({
                    id: 'cmt-fastcopy-' + Date.now(),
                    author: 'system',
                    text: 'Promo copy auto-approved (blog promotion, low brand risk). Echo can now post.',
                    type: 'system',
                    createdAt: new Date().toISOString()
                  });
                  context.log('[Heartbeat] PROMO FAST-TRACK: social-copy auto-approved for promo task:', task.parent_task_id, '(' + deliverable.length + ' chars)');
                }
                continue;
              }
              // Non-promo copy → Quill review as normal
              result.taskUpdates.push({ action: 'move', taskId: action.taskId, newStatus: 'review' });
              result.taskUpdates.push({
                action: 'comment', taskId: action.taskId,
                comment: '@Quill — please review this social copy for brand voice, clarity, and conciseness. Approve or request revision.',
                agentId: 'system'
              });
              context.log('[Heartbeat] QUILL REVIEW: social-copy task routed to Quill for brand voice review:', action.taskId);
              continue; // skip blog detection — social-copy tasks are never blog tasks
            }

            // Echo social tasks move to review after execute — CEO approves via social action queue.
            // No auto-complete fast-path. Standard flow: execute → review → peer review → done.
            if (agentId === 'echo') {
              const _esfText = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
              const _esfIsSocial = /^social_/.test(task.taskType || '') || task.campaign_id ||
                /linkedin|twitter|x\.com|social\s*media|social\s*post|bluesky/.test(_esfText);
              if (_esfIsSocial) {
                result.taskUpdates.push({ action: 'move', taskId: action.taskId, newStatus: 'review' });
                context.log('[Heartbeat] Echo social task moved to review after execute:', action.taskId);
                continue; // skip blog detection
              }
            }

            // SERVER-SIDE FALLBACK: Auto-create document for blog post tasks that used execute-task instead of create-doc
            // Three-layer detection: (1) taskType field, (2) title/desc regex fallback, (3) deliverable content signals
            const _etTaskText = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
            const _etDeliverableLower = (deliverable || '').toLowerCase();
            const _isBlogByType = (task.taskType === 'blog_post' || task.taskType === 'article');
            // "brief" patterns removed: internal briefs (outreach/marketing/content) are specs,
            // not blog posts — matching them minted a public marketing_post + hero image from
            // an internal outreach-brief task (doc_1784991675727, 2026-07-25).
            const _isBlogByTitle = /write.*blog|draft.*blog|blog\s*post|create.*blog|publish.*blog|new.*blog|first\s*blog|introductory\s*post|write.*article|compose.*article/.test(_etTaskText);
            const _isBlogByContent = /document\s*type:\s*marketing_post|publishing\s*to\s*\/blog\/|submit.*ceo.*approv.*publish/.test(_etDeliverableLower);
            const _isSocialCopyTask = task.tags && task.tags.indexOf('social-copy') !== -1;
            const _isBlogTask = agentId === 'scribe' && !_isSocialCopyTask && (_isBlogByType || _isBlogByTitle || _isBlogByContent);
            if (_isBlogTask) context.log('[Heartbeat] BLOG DETECTED:', agentId, 'task:', action.taskId, 'byType:', _isBlogByType, 'byTitle:', _isBlogByTitle, 'byContent:', _isBlogByContent);
            if (_isBlogTask && deliverable.length > 200) {
              const _etDocsStore = (await storage.getState('documents')) || [];
              const _etExistingDoc = _etDocsStore.find(d => {
                if (d.status === 'rejected' || d.status === 'archived') return false;
                // Check top-level taskId (set by execute-task fallback)
                if (d.taskId && d.taskId === action.taskId) return true;
                // Check source.task_id (set by create-doc handler)
                if (d.source && d.source.task_id && d.source.task_id === action.taskId) return true;
                // Exact title match (fallback)
                if (d.title && d.title === task.title) return true;
                return false;
              });
              if (_etExistingDoc) {
                context.log('[Heartbeat]', agentId, 'AUTO-DOC fallback SKIPPED — doc already exists for task:', action.taskId, 'existing doc:', _etExistingDoc.id, _etExistingDoc.title);
              }
              if (!_etExistingDoc) {
                const _etDocId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                // Parse the blog deliverable: lift the headline (H1 or a **Headline:**/**Title:**
                // label) and strip any handoff-memo / metadata scaffold Scribe may wrap around the
                // post. Without this, a memo-wrapped draft ships the TO/FROM/SUBJECT block AS the
                // post body and titles it with the task name instead of the real headline.
                const _parsedBlog = parseBlogDeliverable(deliverable || '');
                var _articleTitle = _parsedBlog.title;
                // Strip "DELIVERABLE: Blog Post —" prefix if agent included it in the heading
                if (_articleTitle) _articleTitle = _articleTitle.replace(/^DELIVERABLE:\s*Blog Post\s*[—–\-]\s*/i, '').trim() || _articleTitle;
                // Sanitize deliverable body: strip agent meta-commentary (Notes, Revision Notes, Artifact IDs, etc.)
                var _cleanedDeliverable = _parsedBlog.body;
                _cleanedDeliverable = _cleanedDeliverable.replace(/\n*\*{0,2}(?:Notes|Revision Notes|Editor'?s? Notes?|Changes? Made|Revisions?|Internal Notes?|Keywords)\*{0,2}:?\*{0,2}\s*\n[\s\S]*$/i, '').trim();
                _cleanedDeliverable = _cleanedDeliverable.replace(/\n*(?:Artifact ID|Parent task ID|Document ID|Task ID|Campaign ID|Objective ID)[:\s][^\n]*/gi, '').trim();
                _cleanedDeliverable = _cleanedDeliverable.replace(/\s*\[(?:ADDRESSED|NOTE|REVISED|FEEDBACK|CHANGED|UPDATED)(?::\s*[^\]]*)?(?:\]\.?\s*)/gi, ' ').trim();
                const _etDoc = {
                  id: _etDocId,
                  // Sentence-case the title at creation (not just at publish) so the draft, the
                  // approval-queue publish action, and the published post all read the same —
                  // otherwise the CEO reviews a raw lowercase headline the agent wrote.
                  title: capitalizeSentences(_articleTitle || task.title || 'Untitled Blog Post'),
                  kind: 'marketing_post',
                  // Sentence-case the body at creation too (marketing_post is public) so the
                  // stored draft matches what publishes — the CEO no longer reviews a raw
                  // lowercase body.
                  content_md: capitalizeSentencesLongform(_cleanedDeliverable),
                  status: 'draft',
                  tags: ['blog', 'auto-created-from-execute'],
                  created_by: agentId,
                  taskId: action.taskId,
                  objective_id: task.objective_id || null,
                  campaign_id: task.campaign_id || null,
                  promote: true,
                  awaiting_hero_image: true,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                };
                // ── CONTENT QUALITY GATE (parity with the create-doc handler) ──
                // Blog posts written via execute-task used to skip fact-checking
                // entirely — a fabricated post reached the approval queue with a
                // blank QG stamp (Heartbeat Diaries, 2026-06-17). Run the same Haiku
                // gate here; fail-closed at confidence >= 70 means the doc is NOT
                // stored, so a hallucinated draft never becomes a publishable artifact.
                const _etQg = await evaluateDocQualityGate({
                  title: _etDoc.title,
                  contentMd: _etDoc.content_md,
                  kind: 'marketing_post',
                  validate: _validateContentQuality,
                  context: context
                });
                if (_etQg.rejected) {
                  context.log('[QualityGate] AUTO-DOC REJECTED', _etDocId, '—', (_etQg.issues || []).slice(0, 3).join('; ').substring(0, 300));
                  result.taskUpdates.push({
                    action: 'comment', taskId: action.taskId, agentId: 'system',
                    comment: '[QUALITY GATE] Blog draft rejected — rewrite required. Issues:\n- ' + (_etQg.issues || []).slice(0, 8).join('\n- ') + '\n\nRewrite the post addressing each issue, then resubmit.'
                  });
                  // A rejected draft has no document, so the task must not sit in
                  // review — a peer would approve the raw deliverable and close it.
                  result.taskUpdates.push({ action: 'move', taskId: action.taskId, newStatus: 'in-progress' });
                  try {
                    await logEvent('policy-violation', agentId, 'Quality gate rejected blog draft (execute-task auto-doc)', cycleId, {
                      runId: cycleId, gate: 'quality_gate', reason: 'haiku_rejection_doc_autodoc',
                      kind: 'marketing_post', docTitle: _etDoc.title, confidence: _etQg.confidence || 0,
                      issueCount: (_etQg.issues || []).length,
                      issuesPreview: ((_etQg.issues || []).slice(0, 5).join('; ')).substring(0, 400)
                    });
                  } catch (_etQgLogErr) { /* non-fatal */ }
                } else {
                  _etDoc.qualityGate = _etQg.qualityGate;
                  _etDocsStore.push(_etDoc);
                  await storage.setState('documents', _etDocsStore);
                  context.log('[Heartbeat]', agentId, 'AUTO-DOC fallback: Created marketing_post from execute-task deliverable:', _etDocId, 'for blog task:', action.taskId, 'qg.pass:', _etDoc.qualityGate.pass, _etDoc.qualityGate.failOpen ? '(fail-open)' : '');

                  // Auto-create Pixel hero image task (same logic as create-doc handler)
                  // SPAWN GUARD: do not spawn child tasks from auto-created tasks (prevents auto→auto chains)
                  const _etSourceAutoCreated = task.tags && task.tags.indexOf('auto-created') !== -1;
                  const _etHeroTitle = 'Generate hero image for: ' + stripTaskPrefixes(_etDoc.title);
                  const _etHeroExists = tasks.some(t =>
                    t.assignee === 'pixel' && t.status !== 'done' &&
                    (t.title === _etHeroTitle || (t.description && t.description.indexOf(_etDocId) !== -1))
                  );
                  if (!_etHeroExists && !_etSourceAutoCreated) {
                    const _etHeroTask = {
                      id: 'task_' + Date.now() + '_hero_' + Math.random().toString(36).substr(2, 4),
                      title: _etHeroTitle,
                      description: 'Generate a hero image for the blog post "' + _etDoc.title + '".\nDocument ID: ' + _etDocId + '\nUse generate-image with purpose "blog_header" and attachTo: { type: "document", id: "' + _etDocId + '" }.\nChoose an appropriate preset based on the content tone.',
                      taskType: 'design_asset',
                      status: 'todo',
                      priority: task.priority || 'high',
                      dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
                      assignee: 'pixel',
                      source: 'heartbeat',
                      created_by: 'system',
                      parent_task_id: action.taskId,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      campaign_id: task.campaign_id || null,
                      objective_id: task.objective_id || null,
                      tags: ['hero-image', 'auto-created', 'visual-workflow'],
                      comments: [{
                        id: 'cmt-hero-' + Date.now(),
                        author: 'nova',
                        text: 'Pixel, generate a hero image for the blog post "' + _etDoc.title + '" (doc: ' + _etDocId + '). Use generate-image with purpose blog_header and attachTo the document.',
                        type: 'system',
                        createdAt: new Date().toISOString()
                      }]
                    };
                    tasks.push(_etHeroTask);
                    context.log('[Heartbeat]', agentId, 'AUTO-DOC fallback: Created Pixel hero image task:', _etHeroTask.id, 'for auto-doc:', _etDocId);
                  }
                  // Add visible diagnostic comment on the task
                  result.taskUpdates.push({
                    action: 'comment',
                    taskId: action.taskId,
                    comment: '[AUTO-DOC] Blog post detected via execute-task — auto-created document (' + _etDocId + ', kind: marketing_post) and Pixel hero image task. Next: Pixel generates hero image, then submit-for-publish.',
                    agentId: 'system'
                  });
                }
              }
            }
          } else {
            // Null deliverable — track failed attempt so task doesn't stay stuck in-progress forever
            if (!task.comments) task.comments = [];
            const _failCount = task.comments.filter(c => c.type === 'failed_attempt').length;
            task.comments.push({
              id: 'cmt-fail-' + Date.now(),
              author: 'system',
              type: 'failed_attempt',
              text: '[SYSTEM] Execute returned empty result (attempt ' + (_failCount + 1) + '). Gemini may have failed or timed out.',
              createdAt: new Date().toISOString()
            });
            task.updatedAt = new Date().toISOString();
            context.log('[Heartbeat]', agentId, 'NULL DELIVERABLE for task:', action.taskId, '— failed attempt', _failCount + 1);

            // After 3 consecutive failures, reset to todo for fresh retry
            if (_failCount + 1 >= 3) {
              task.status = 'todo';
              task.updatedAt = new Date().toISOString();
              task.comments.push({
                id: 'cmt-failreset-' + Date.now(),
                author: 'system',
                type: 'system',
                text: '[SYSTEM] 3 consecutive execution failures — resetting to todo for retry with fresh context.',
                createdAt: new Date().toISOString()
              });
              context.log('[Heartbeat]', agentId, 'FAIL RESET: task', action.taskId, 'reset to todo after 3 null deliverables');
            }
          }

          // RESEARCH INTEL → AQ: when Scout completes a research task via execute-task,
          // submit findings to the CEO approval queue. On approval the heartbeat stores to researchIntel.
          if (deliverable && agentId === 'scout' && task.taskType === 'research' && deliverable.length > 200) {
            const _riNow = new Date().toISOString();
            const _riId = 'ri_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
            try {
              const _riActStore = (await storage.getState('actions')) || [];
              const _riExists = _riActStore.some(a => a.type === 'research_intel.approve' && a._parentTaskId === action.taskId && a.approval && a.approval.status === 'pending');
              // Daily cap: count today's research intel submissions
              const _riTodayStart = new Date(); _riTodayStart.setUTCHours(0,0,0,0);
              const _riTodayCount = _riActStore.filter(a => a.type === 'research_intel.approve' && new Date(a.created_at) >= _riTodayStart).length;
              if (_riTodayCount >= MAX_RESEARCH_INTEL_PER_DAY) {
                context.log('[Heartbeat] RESEARCH INTEL: daily cap reached (' + _riTodayCount + '/' + MAX_RESEARCH_INTEL_PER_DAY + '), skipping submission for task:', action.taskId);
              } else if (!_riExists) {
                const _riPayload = { id: _riId, title: task.title, summary: deliverable.substring(0, 600), content: deliverable, task_id: action.taskId, created_at: _riNow, agent: 'scout', source: 'execute-task' };
                _riActStore.push({ id: _riId, type: 'research_intel.approve', created_at: _riNow, created_by: 'scout', payload: _riPayload, approval: { status: 'pending' }, execution: { status: 'pending' }, requires_approval: true, risk_level: 'low', brand_impact: 'low', budget_impact: 0, classification: 'advisory', _parentTaskId: action.taskId, source: 'heartbeat' });
                await storage.setState('actions', _riActStore);
                const _riAQStore = (await storage.getState('approvalQueue')) || [];
                _riAQStore.push({ id: 'aq-' + _riId, kind: 'research.intel', type: 'research.intel', action_id: _riId, title: task.title, summary: deliverable.substring(0, 300), task_id: action.taskId, originAgent: 'scout', status: 'pending', createdAt: _riNow });
                await storage.setState('approvalQueue', _riAQStore);
                result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '**Research intel submitted for CEO approval** (id: `' + _riId + '`). Once approved, Scout\'s findings will be stored to the company knowledge base and available to all agents.', agentId: 'system' });
                context.log('[Heartbeat] RESEARCH INTEL: submitted to AQ for CEO approval, task:', action.taskId, 'intel:', _riId);
              }
            } catch (_riErr) {
              context.log('[Heartbeat] RESEARCH INTEL: AQ submission failed (non-fatal):', String(_riErr).substring(0, 200));
            }
          }
        }
      }
    } else if (action.type === 'create-social-action' && action.social) {
      // AUTO-LINK: If Gemini didn't include taskId, infer it from Echo's active/done social tasks
      if (!action.taskId && agentId === 'echo') {
        var _alPlatform = (action.social.platform || '').toLowerCase();
        var _alMatch = tasks.find(function (t) {
          if (t.assignee !== 'echo' || t._archived) return false;
          if (t.status !== 'done' && t.status !== 'review' && t.status !== 'in-progress') return false;
          var tp = (t.taskType || '').replace('social_', '');
          return tp === _alPlatform || (tp === 'x' && _alPlatform === 'twitter');
        });
        if (_alMatch) {
          action.taskId = _alMatch.id;
          context.log('[Heartbeat]', agentId, 'Auto-linked create-social-action to task:', _alMatch.id, '(Gemini omitted taskId)');
        }
      }

      // TRIAGE GATE: if this social action is linked to a task, that task must be triaged first
      // Exception: CEO-created tasks with assignee + dueDate are pre-triaged
      // Exception: Campaign tasks are system-created with full context — no triage needed
      if (agentId !== 'nova' && action.taskId) {
        const socialTarget = tasks.find(t => t.id === action.taskId);
        const hasSocialTriage = socialTarget && socialTarget.comments && socialTarget.comments.length > 0;
        const isCeoSocialTriaged = socialTarget && socialTarget.source !== 'heartbeat' && socialTarget.assignee && socialTarget.dueDate;
        const isCampaignTask = socialTarget && socialTarget.campaign_id;
        if (socialTarget && !hasSocialTriage && !isCeoSocialTriaged && !isCampaignTask) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action on', action.taskId, '— task has zero comments (needs Nova triage first)');
          continue;
        }
      }
      // DEDUPE GUARD: block duplicate social posts for the SAME TASK only
      const existingActions = (await storage.getState('actions')) || [];
      const isDupe = existingActions.some(function(ea) {
        if (!ea.type || ea.type.indexOf('social_post') !== 0) return false;
        var eaStatus = (ea.approval && ea.approval.status) || '';
        if (eaStatus === 'rejected' || eaStatus === 'cancelled') return false; // allow retry after reject
        var eaExecStatus = (ea.execution && ea.execution.status) || '';
        if (eaExecStatus === 'success') return false; // completed actions don't block new ones
        // Same task already has a pending/in-flight social action
        if (action.taskId && ea._parentTaskId === action.taskId) return true;
        return false;
      });
      if (isDupe) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — duplicate: pending social action already exists for task', action.taskId);
        continue;
      }

      // FIX 3: Block social actions that reference blog posts not yet published+promoted
      // This prevents the entire cascade: social action → copy task → Scribe create-doc → hero image
      if (action.taskId) {
        const _saParentTask = tasks.find(t => t.id === action.taskId);
        if (_saParentTask) {
          const _saText = ((_saParentTask.title || '') + ' ' + (_saParentTask.description || '')).toLowerCase();
          const _saRefsBlog = /blog\s*post|marketing_post|hello\s*world|write.*article|first\s*post/.test(_saText);
          if (_saRefsBlog) {
            // Check if the blog post is actually published + promoted
            const _saDocs = (await storage.getState('documents')) || [];
            const _saPublishedAndPromoted = _saDocs.some(d =>
              d.status === 'published' && d.promote === true &&
              d.kind === 'marketing_post'
            );
            if (!_saPublishedAndPromoted) {
              context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — blog not published+promoted yet. Social tasks auto-created after CEO approves publish with promote=true.');
              continue;
            }
          }
        }
      }

      // ── COPY REVIEW GATE ──
      // Social posts linked to tasks must go through Scribe for copy writing + peer review first.
      // Mirrors the Pixel hero image pattern: auto-create a Scribe task, block until reviewed.
      // Exception: task already has reviewed_copy (set when Scribe's writing sub-task is approved)
      // ALL tasks (including campaign tasks) require Scribe copy review — campaign briefs provide
      // direction but may not be descriptive enough; Scribe review ensures quality.
      if (action.taskId) {
        const socialTask = tasks.find(t => t.id === action.taskId);
        // Block if task not found (bad taskId) — don't let unlinked actions through
        if (socialTask && (socialTask._social_action_created || socialTask._social_action_pending)) {
          // Auto-post already created (or will create) the action — skip to avoid duplicate
          context.log('[Heartbeat]', agentId, 'SKIPPED create-social-action — auto-post handles task:', action.taskId);
          continue;
        } else if (socialTask && socialTask.reviewed_copy) {
          // Has reviewed_copy but no pending flag (e.g. manually set) — allow through, fix 9 will use it
        } else if (!socialTask) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — task not found:', action.taskId);
          continue;
        } else {
          // socialTask exists but no reviewed_copy
          // Check if a Scribe writing sub-task already exists for this social task
          const _copyTag = 'social-copy-for-' + action.taskId;
          const _copyTaskExists = tasks.some(t =>
            !t._revision_superseded &&
            ((t.tags && t.tags.indexOf(_copyTag) !== -1) ||
             (t.assignee === 'scribe' && t.parent_task_id === action.taskId && (t.title || '').indexOf('Write social copy') === 0))
          );
          // Also check if a COMPLETED Scribe copy task exists (reviewed_copy may not have propagated yet)
          const _copyTaskDone = tasks.find(t =>
            t.status === 'done' && !t._revision_superseded &&
            ((t.tags && t.tags.indexOf(_copyTag) !== -1) ||
             (t.assignee === 'scribe' && t.parent_task_id === action.taskId && (t.title || '').indexOf('Write social copy') === 0))
          );
          if (_copyTaskDone) {
            // Copy task is done but reviewed_copy wasn't set — extract deliverable now
            const _deliverables = (_copyTaskDone.comments || []).filter(c => c.type === 'deliverable');
            if (_deliverables.length > 0) {
              socialTask.reviewed_copy = _deliverables[_deliverables.length - 1].text;
              socialTask.updatedAt = new Date().toISOString();
              // Override the action text with the reviewed copy (Gemini may have used raw deliverable)
              action.social.text = socialTask.reviewed_copy;
              context.log('[Heartbeat]', agentId, 'Late-resolved reviewed_copy from done copy task:', _copyTaskDone.id, '— injected into action text');
              // Fall through — allow the social action with the reviewed copy
            }
          }
          // If STILL no reviewed copy, block and create Scribe task
          // NOTE: spawn guard removed for social-copy tasks — the copy pipeline is a controlled chain
          // (social task → copy task → Quill review), not an unbounded auto→auto loop
          if (!socialTask.reviewed_copy) {
            if (!_copyTaskExists) {
              const _platform = (action.social.platform || 'linkedin').toLowerCase();
              const _maxLen = _platform === 'x' ? '280 chars' : _platform === 'bluesky' ? '300 chars' : _platform === 'reddit' ? 'format as "TITLE: [max 300 chars]\\n\\n[body, 200-800 words, markdown supported]"' : _platform === 'facebook' ? '100-250 chars for engagement (up to 63,206 chars max). Supports links, hashtags, @mentions.' : '800-1500 chars for LinkedIn (article-style)';
              // Pull campaign context for Scribe (URL, posting rules)
              let _cmpContext = '';
              if (socialTask.campaign_id) {
                const _cmp = (activeDirectives || []).find(c => c.id === socialTask.campaign_id);
                if (!_cmp) {
                  try { const _cmps = (await storage.getState('campaigns')) || []; const _fc = _cmps.find(c => c.id === socialTask.campaign_id); if (_fc) { _cmpContext = _fc.description || ''; } } catch (_e) {}
                } else { _cmpContext = _cmp.description || ''; }
              }
              const _cmpUrlMatch = _cmpContext.match(/https?:\/\/ambientpixels\.ai\/[a-z0-9/-]+/i);
              // For individual tasks (no campaign), scan task description + Echo's strategy brief for a specific URL
              const _descUrlMatch = !_cmpUrlMatch
                ? ((socialTask.description || '') + ' ' + ((socialTask.comments || []).filter(c => c.type === 'deliverable').map(c => c.text).join(' '))).match(/https?:\/\/ambientpixels\.ai\/[a-z0-9/-]+/i)
                : null;
              const _cmpUrl = _cmpUrlMatch ? _cmpUrlMatch[0] : (_descUrlMatch ? _descUrlMatch[0] : 'https://ambientpixels.ai');
              const _cmpRules = _cmpContext ? '\n\nCAMPAIGN POSTING RULES:\n' + _cmpContext.substring(0, 600) : '';
              // Check if parent task has quality gate feedback to include
              var _qgFeedback = '';
              var _qgComment = (socialTask.comments || []).filter(function(c) { return c.text && c.text.indexOf('QUALITY GATE FAILED') !== -1; });
              if (_qgComment.length > 0) {
                var _productKey = _detectProductFromTask(socialTask);
                var _strongBlock = _buildStrongFeedbackBlock(_productKey);
                _qgFeedback = '\n\nPREVIOUS VERSION REJECTED BY QUALITY GATE:\n' + _qgComment[_qgComment.length - 1].text.substring(0, 800)
                  + '\n\n' + _strongBlock
                  + '\nFix ALL issues listed above. Do NOT repeat the same mistakes.\n';
              }
              const copyTask = {
                id: 'task_' + Date.now() + '_copy_' + Math.random().toString(36).substr(2, 4),
                title: 'Write social copy for: ' + stripTaskPrefixes(socialTask.title || 'Untitled'),
                description: 'Write ONE publish-ready social media post for the task: "' + stripTaskPrefixes(socialTask.title || '') + '".\n\n'
                  + 'Original description: ' + ((socialTask.description || 'N/A').substring(0, 500)) + '\n\n'
                  + 'Parent task ID: ' + action.taskId + '\n'
                  + 'Platform: ' + _platform + '\n'
                  + 'Max length: ' + _maxLen + '\n\n'
                  + _qgFeedback
                  + 'Requirements:\n'
                  + '- Write exactly ONE post — not multiple variations, not a batch. One single post.\n'
                  + '- DELIVERABLE FORMAT: the first character of your deliverable IS the first character of the post. No "this is scribe", no "i\'m writing a linkedin post for...", no "here\'s the post:", no "here\'s the draft:", no role announcement, no brief recap, no rationale, no rationale preamble. The deliverable IS the post text, nothing else. The system publishes your deliverable verbatim — any preamble you add ships to the public.\n'
                  + '- IF YOU CANNOT WRITE THE POST (platform disallowed, missing context, brief contradicts CEO directive, etc.): DO NOT write a refusal as your deliverable. A refusal becomes the published post. Instead, comment on the task explaining why (use comment-task) and leave the deliverable empty. The system will route accordingly.\n'
                  + '- Write clean, platform-ready copy (no markdown, no headers, no internal notes, no "Post 1/Post 2" labels)\n'
                  + '- Founder voice (NOT corporate): casual, proper sentence case (capitalize the first word of every sentence and the pronoun "I"), short paragraphs, one idea per line. No em dashes. No buzzwords (supercharge, unleash, revolutionary, thrilled). No rhetorical question hooks. 5th grade reading level. Lead with specifics not adjectives. Vulnerability beats polish.\n'
                  + '- MUST include the product URL: ' + _cmpUrl + '\n'
                  + '- LinkedIn posts: aim for 800-1500 chars. Write like a short article — narrative hook, short paragraphs, personal voice, clear takeaway. NOT a compressed ad tagline.\n'
                  + '- Reddit posts: format as "TITLE: [catchy post title, max 300 chars]\\n\\n[body, markdown supported, 200-800 words]". Title and body are both required. TONE: write like a builder sharing what they made — conversational, authentic, slightly informal. Use first person ("I built...", "We shipped..."). NO corporate speak, NO hashtags, NO press-release language. Lead with what the reader gets, not what we built. Tell a story: problem → what we built → how it works → link at the end. End with a genuine discussion prompt inviting feedback or questions. Redditors respect transparency and despise astroturfing.\n'
                  + '- After writing, this task goes to Quill for brand voice review. Once Quill approves, Echo uses the copy to create the social post.\n'
                  + '- Use execute-task to produce your deliverable.'
                  + _cmpRules,
                taskType: 'social_copy',
                status: 'todo',
                priority: socialTask.priority || 'high',
                assignee: 'scribe',
                source: 'heartbeat',
                created_by: 'system',
                parent_task_id: action.taskId || null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                dueDate: socialTask.dueDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                campaign_id: socialTask.campaign_id || null,
                objective_id: socialTask.objective_id || null,
                tags: ['social-copy', 'auto-created', _copyTag],
                comments: [{
                  id: 'cmt-' + Date.now(),
                  author: 'system',
                  text: 'Auto-created: Echo attempted to post for task "' + (socialTask.title || '') + '" but no reviewed copy exists. Scribe must write and submit copy for peer review first.',
                  type: 'system',
                  createdAt: new Date().toISOString()
                }]
              };
              tasks.push(copyTask);
              context.log('[Heartbeat]', agentId, 'AUTO-CREATED Scribe copy task:', copyTask.id, 'for social task:', action.taskId);
            } else {
              context.log('[Heartbeat]', agentId, 'Scribe copy task already exists for social task:', action.taskId, '— waiting for review');
            }
            // Mark parent task as awaiting copy review (only once)
            if (!socialTask.awaiting_copy_review) {
              socialTask.awaiting_copy_review = true;
              socialTask.updatedAt = new Date().toISOString();
              if (!socialTask.comments) socialTask.comments = [];
              socialTask.comments.push({
                id: 'cmt-copywait-' + Date.now(),
                author: 'system',
                text: 'Social post blocked — awaiting reviewed copy from Scribe. Once Scribe writes and a peer reviews the copy, Echo can create the social action.',
                type: 'system',
                createdAt: new Date().toISOString()
              });
            }
            context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action on', action.taskId, '— awaiting reviewed copy from Scribe');
            continue;
          }
        }
      }

      // FALLBACK BLOCK: if Echo creates a social action without taskId, block it.
      // All Echo social actions MUST be linked to a task with reviewed_copy.
      if (!action.taskId && agentId === 'echo') {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — no taskId (action must be linked to a task)');
        continue;
      }

      // Fix 9: If the social task has reviewed_copy, ALWAYS use it over whatever Gemini wrote.
      // Scribe's copy is the canonical post text — Gemini may have used the raw deliverable.
      if (action.taskId) {
        const _rcTask = tasks.find(t => t.id === action.taskId);
        if (_rcTask && _rcTask.reviewed_copy) {
          action.social.text = _rcTask.reviewed_copy;
          context.log('[Heartbeat]', agentId, 'Using reviewed_copy as social action text (' + action.social.text.length + ' chars)');
        }
      }

      // Strip conversational preamble from social post text (e.g. "Okay, here's the copy...")
      // Must run before all other sanitizers so downstream logic sees clean text
      if (action.social.text) {
        // "Got it" opener + whole-first-line strip added after act_1781200817701 leaked
        // "Got it. Here's the Bluesky post, addressing all quality gate issues. ---" past
        // the old tail requirement ([.:]\n) because the line ended with "---".
        const _preambleRx = /^(?:Okay|Sure|Alright|Great|Got it|Understood|Perfect|Done|Here|Let me|I'll|I will|I've|Of course)[^\n]*(?:copy|post|draft|content|text|version|revision|here's|for you)[^\n]*\n+/i;
        if (_preambleRx.test(action.social.text)) {
          context.log('[Heartbeat]', agentId, 'Stripping conversational preamble from social post text');
          action.social.text = action.social.text.replace(_preambleRx, '');
        }
        // Strip leftover separator + platform-label lines ("---", "Bluesky post:") that
        // trail a stripped preamble or leak on their own.
        action.social.text = action.social.text
          .replace(/^\s*-{3,}\s*\n+/g, '')
          .replace(/^(?:bluesky|x|twitter|linkedin|reddit|facebook)\s+post\s*:\s*/i, '')
          .trimStart();
      }

      // Agent-initiated social post action — routes through action layer governance
      const socialPayload = action.social;

      // Fix 10: Strip alternative draft options that Scribe includes in deliverables
      // Scribe often writes multiple options (main + "Alternative Option" sections separated by ---)
      if (socialPayload.text && /\*\*Alternative\s+Option/i.test(socialPayload.text)) {
        let _cleaned = socialPayload.text;
        // Cut at first --- followed by **Alternative Option or just **Alternative Option
        _cleaned = _cleaned.split(/\n-{2,}\s*\n(?=\s*\*\*Alternative)/i)[0]
          || _cleaned.split(/\*\*Alternative\s+Option[^*]*\*\*/i)[0]
          || _cleaned;
        _cleaned = _cleaned.replace(/\n-{2,}\s*$/, '').trim(); // trailing ---
        if (_cleaned.length > 20) {
          context.log('[Heartbeat] Fix 10: Stripped alternative draft options — kept', _cleaned.length, 'of', socialPayload.text.length, 'chars');
          socialPayload.text = _cleaned;
        }
      }

      // Fix 10b: Strip remaining markdown bold/italic from social post text
      if (socialPayload.text && /\*\*/.test(socialPayload.text)) {
        socialPayload.text = socialPayload.text
          .replace(/\*\*([^*]+)\*\*/g, '$1')   // **bold** → bold
          .replace(/\*([^*]+)\*/g, '$1');        // *italic* → italic
      }

      // Server-side sanitizer: strip deliverable metadata that agents sometimes dump into post text
      if (socialPayload.text && /\*\*(?:Task|Deliverable|LinkedIn Post Draft|Follow-up|Peer Review|Notes|Review).*?:\*\*/i.test(socialPayload.text)) {
        let raw = socialPayload.text;
        context.log('[Heartbeat] Sanitizing social post text — detected deliverable metadata');

        // Strategy 1: Extract just the LinkedIn Post Draft section
        const draftMatch = raw.match(/\*\*LinkedIn Post Draft:\*\*\s*([\s\S]*?)(?=\*\*(?:Follow-up|Notes|Peer Review|Review)[^*]*:\*\*)/i)
          || raw.match(/\*\*(?:Post|Draft|Content):\*\*\s*([\s\S]*?)(?=\*\*(?:Follow-up|Notes|Peer Review|Review)[^*]*:\*\*)/i);
        if (draftMatch && draftMatch[1].trim().length > 20) {
          raw = draftMatch[1].trim();
        } else {
          // Strategy 2: Remove all known section headers and keep what's left
          // Split by section headers and keep only content paragraphs
          const sections = raw.split(/\*\*(?:Task|Deliverable|LinkedIn Post Draft|Follow-up Comment|Peer Review[^*]*|Notes|Review[^*]*):\*\*/i);
          // Find the longest section that looks like actual post content (no markdown headers)
          let best = '';
          for (const section of sections) {
            const cleaned = section.replace(/^#{1,4}\s+.*$/gm, '').replace(/^\s*[-–]\s+/gm, '').trim();
            if (cleaned.length > best.length && !/^\s*\*\*/.test(cleaned) && cleaned.length > 20) {
              best = cleaned;
            }
          }
          if (best.length > 20) raw = best;
        }

        // Strip remaining markdown formatting
        raw = raw.replace(/^#{1,4}\s+.*$/gm, '');          // ## headings
        raw = raw.replace(/\*\*([^*]+)\*\*/g, '$1');        // **bold** → bold
        raw = raw.replace(/\*([^*]+)\*/g, '$1');             // *italic* → italic
        raw = raw.replace(/^\s*\*\s+/gm, '');               // bullet points
        raw = raw.replace(/\n{3,}/g, '\n\n').trim();         // collapse blank lines
        context.log('[Heartbeat] Sanitized text:', raw.substring(0, 120));
        socialPayload.text = raw;
      }

      // Fix 10c: Strip agent reasoning / doctrine alignment that leaks into post text
      // Agents sometimes append their strategic analysis as plain-text sections after the actual post
      if (socialPayload.text) {
        const reasoningPattern = /\n+(?:Explanation\s*(?:&|and)\s*Doctrine\s*Alignment|Additional\s*Notes|Revision\s*Notes|Doctrine\s*Alignment|Strategic\s*(?:Bias\s*)?(?:Reasoning|Analysis|Notes|Considerations)|Reasoning|Rationale|Notes|Risk\s*Tolerance|"Are\s+We\s+Visible\??"|Distribution\s*:|Publishing\s*Cadence|Narrative\s*:)\s*(?:\([^)]*\))?\s*:?/i;
        const reasoningIdx = socialPayload.text.search(reasoningPattern);
        if (reasoningIdx > 20) {
          context.log('[Heartbeat] Fix 10c: Stripping agent reasoning at char', reasoningIdx, 'of', socialPayload.text.length);
          socialPayload.text = socialPayload.text.substring(0, reasoningIdx).trim();
        }
        // Strip agent self-commentary that appears after the post content
        // Agents append internal notes like "I've tried to keep..." or "Based on the analytics..."
        var _hashtagEndIdx = socialPayload.text.search(/\n\s*#\S+[^\n]*$/m);
        if (_hashtagEndIdx > 20) {
          // Find end of hashtag line, strip everything after
          var _afterHashtags = socialPayload.text.substring(_hashtagEndIdx).match(/^[^\n]*\n([\s\S]+)/);
          if (_afterHashtags && _afterHashtags[1].trim().length > 0) {
            context.log('[Heartbeat] Stripping post-hashtag agent commentary (' + _afterHashtags[1].trim().length + ' chars)');
            socialPayload.text = socialPayload.text.substring(0, _hashtagEndIdx + socialPayload.text.substring(_hashtagEndIdx).indexOf('\n', 1)).trim();
          }
        }
        // Also strip bare artifact_id references: [artifact_id: ...] or [pub_...]
        socialPayload.text = socialPayload.text.replace(/\n*\[(?:artifact_id:\s*)?pub_[^\]]+\]\n*/g, '\n').trim();
        // Strip "Headline:" and "Body:" labels that leak from LinkedIn drafts
        socialPayload.text = socialPayload.text.replace(/^Headline:\s*/i, '').replace(/\n+Body:\s*\n+/i, '\n\n').trim();
        // Strip markdown link syntax: [text](url) → url (social platforms don't render markdown)
        socialPayload.text = socialPayload.text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$2');
        // Strip bare bracket URLs: [https://...] → https://...
        socialPayload.text = socialPayload.text.replace(/\[(https?:\/\/[^\]]+)\]/g, '$1').trim();
        // Strip "Subject:" label that leaks from Bluesky drafts
        socialPayload.text = socialPayload.text.replace(/^Subject:\s*[^\n]+\n+(?:Body:\s*\n+)?/i, '').trim();
      }

      // Strip markdown headings (## Post Draft, ### LinkedIn Post, etc.)
      socialPayload.text = (socialPayload.text || '').replace(/^#{1,4}\s+.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

      // Strip plain-text draft labels (LinkedIn Post Draft, X Post Draft, etc.)
      socialPayload.text = socialPayload.text.replace(/^(?:LinkedIn|X|Twitter|Bluesky|Social)\s+Post\s+Draft\s*(?:[:-]\s*[^\n]*)?\s*\n+/i, '').trim();

      // Strip trailing --- separators
      socialPayload.text = socialPayload.text.replace(/\n*-{3,}\s*$/g, '').trim();

      // Strip meta-comments agents leave in copy (e.g. [ADDRESSED], [NOTE], [REVISED])
      // Two patterns: 1) inline tags like [ADDRESSED: explanation] — strip just the bracket tag
      //               2) standalone lines starting with [ADDRESSED] — strip entire line
      socialPayload.text = socialPayload.text.replace(/\s*\[(?:ADDRESSED|NOTE|REVISED|FEEDBACK|CHANGED|UPDATED)(?::\s*[^\]]*)?(?:\]\.?\s*)/gi, ' ').trim();
      // Strip standalone [TAG] lines (tag at start of line with content after)
      socialPayload.text = socialPayload.text.replace(/^\[(?:ADDRESSED|NOTE|REVISED|FEEDBACK|CHANGED|UPDATED)[^\]]*\]\s*[^\n]*$/gim, '').trim();
      // Strip "Revision Notes:" sections and everything after
      socialPayload.text = socialPayload.text.replace(/\n*(?:Revision Notes|Editor'?s? Notes?|Changes? Made|Revisions?):\s*\n[\s\S]*$/i, '').trim();
      // Strip trailing dash-bullet revision notes (e.g. "- Tightened the intro...\n- Added link...")
      socialPayload.text = socialPayload.text.replace(/\n+(- .+\n?){2,}$/g, '').trim();
      // Convert markdown links [text](url) to plain URLs (social platforms don't render markdown)
      socialPayload.text = socialPayload.text.replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '$2').trim();
      // Strip remaining markdown bold/italic formatting
      socialPayload.text = socialPayload.text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
      // Strip markdown bullet formatting (* item → item)
      socialPayload.text = socialPayload.text.replace(/^\*\s{2,}/gm, '• ').trim();

      // Strip campaign brief metadata that leaks into social post text
      // Agents sometimes dump the full task brief (objectives, rules, multi-post format)
      if (socialPayload.text) {
        var _briefText = socialPayload.text;
        // Remove campaign header lines: Objective:, Campaign Focus:, Platforms:, Posting Rules:, Landing Page:
        _briefText = _briefText.replace(/^(?:Objective|Campaign Focus|Platforms|Posting Rules|Landing Page|Target Audience|Key Messages?|Brand Voice|Tone):?\s*[^\n]*$/gim, '');
        // Remove posting rules blocks (indented bullet points after "Posting Rules:")
        _briefText = _briefText.replace(/Posting Rules:\s*\n(?:\s+[^\n]+\n?)*/gi, '');
        // Remove "---" separators
        _briefText = _briefText.replace(/^-{3,}$/gm, '');
        // If text has "Post 1:" / "Post 2:" or "Option 1" / "Option 2" format, extract just the first
        var _postMatch = _briefText.match(/(?:^|\n)\s*(?:Post|Option)\s*1\s*(?:\([^)]*\))?\s*:\s*([\s\S]*?)(?:\n\s*(?:Post|Option)\s*2\s*(?:\([^)]*\))?\s*:|$)/i);
        if (_postMatch && _postMatch[1].trim().length > 30) {
          _briefText = _postMatch[1].trim();
          context.log('[Heartbeat]', agentId, 'Extracted first option from multi-option brief (' + _briefText.length + ' chars)');
        }
        // If text has platform section headers (### X (Twitter), ### LinkedIn), extract the matching section
        if (!_postMatch) {
          var _platSection = null;
          var _resolvedPlat = (socialPayload.platform || 'x').toLowerCase();
          var _platPatterns = {
            x: /(?:^|\n)###?\s*(?:X\s*\(Twitter\)|X \/ Twitter|X Post)\s*\n([\s\S]*?)(?:\n###?\s|\n*$)/i,
            linkedin: /(?:^|\n)###?\s*LinkedIn\s*(?:Post)?\s*\n([\s\S]*?)(?:\n###?\s|\n*$)/i,
            bluesky: /(?:^|\n)###?\s*Bluesky\s*(?:Post)?\s*\n([\s\S]*?)(?:\n###?\s|\n*$)/i
          };
          if (_platPatterns[_resolvedPlat]) {
            _platSection = _briefText.match(_platPatterns[_resolvedPlat]);
          }
          if (_platSection && _platSection[1].trim().length > 30) {
            // Extract first post from the section
            var _secText = _platSection[1].trim();
            var _secPostMatch = _secText.match(/Post\s*1\s*:\s*([\s\S]*?)(?:\n\s*Post\s*2\s*:|$)/i);
            _briefText = _secPostMatch ? _secPostMatch[1].trim() : _secText;
            context.log('[Heartbeat]', agentId, 'Extracted', _resolvedPlat, 'section from multi-platform brief (' + _briefText.length + ' chars)');
          }
        }
        _briefText = _briefText.replace(/\n{3,}/g, '\n\n').trim();
        if (_briefText.length > 0 && _briefText !== socialPayload.text) {
          socialPayload.text = _briefText;
        }
      }

      const postText = socialPayload.text || '';

      // Server-side enforcement: reject meta-description posts (task titles / project names)
      // Echo sometimes submits the task description instead of actual drafted social copy
      const _bodyNoUrl = postText.replace(/\n*(?:Read more|Learn more|Check it out)?:?\s*https?:\/\/\S+/gi, '').replace(/\n*#\S+/g, '').trim();
      const _metaPattern = /^(?:Master|Draft|Develop|Consolidated|Create)\s+(?:Social\s+Media|Content|Marketing)/i;
      const _metaKeywords = /Social\s+Media\s+(?:Project|Strategy|Plan|Calendar|Content\s+Creation)/i;
      if (_metaPattern.test(_bodyNoUrl) || _metaKeywords.test(_bodyNoUrl)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — text is a task/project description, not social copy:', _bodyNoUrl.substring(0, 120));
        continue;
      }
      // Minimum content length (excluding URL/hashtags): LinkedIn 100, X/Bluesky 30
      // Use task's taskType (reflects rotation) for accurate platform detection
      var _minPlatform = (socialPayload.platform || '').toLowerCase();
      if (action.taskId) {
        var _mlTask = tasks.find(function(t) { return t.id === action.taskId; });
        if (_mlTask && /^social_/.test(_mlTask.taskType || '')) _minPlatform = _mlTask.taskType.replace('social_', '');
      }
      const _minLen = _minPlatform === 'linkedin' ? 300 : (_minPlatform === 'reddit' ? 50 : 30);
      if (_bodyNoUrl.length < _minLen) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — body too short after stripping URL (' + _bodyNoUrl.length + '/' + _minLen + ' chars):', _bodyNoUrl.substring(0, 80));
        continue;
      }

      // Server-side enforcement: platform character limits — auto-trim to fit
      // Use task's taskType (reflects rotation) over agent's platform guess
      const PLATFORM_CHAR_LIMITS = { x: 280, bluesky: 300, linkedin: 3000, reddit: 40000, facebook: 63206 };
      var _charLimitPlatform = (socialPayload.platform || 'x').toLowerCase();
      if (action.taskId) {
        var _clTask = tasks.find(function(t) { return t.id === action.taskId; });
        if (_clTask && /^social_/.test(_clTask.taskType || '')) {
          _charLimitPlatform = _clTask.taskType.replace('social_', '');
        }
      }
      const platformKey = _charLimitPlatform;
      const charLimit = PLATFORM_CHAR_LIMITS[platformKey] || 280;
      // URL-preserving trim: promo copy puts the CTA link at the END. Trimming the body to
      // fit must NEVER delete that link (a post whose link is cut off is wasted). Defined
      // once and applied both here and again after UTM injection (which lengthens the link).
      const _trimSocialToLimit = function (rawText, limit) {
        const src = String(rawText || '');
        if (src.length <= limit) return src;
        // Suffix shapes, most-specific first: URL + trailing hashtags, URL alone at the end
        // (the common promo pattern — previously unprotected), or hashtags alone.
        const urlWithTags = src.match(/((?:\n\n|\n)https?:\/\/\S+(?:\n\n|\n)#[\s\S]*)$/);
        const urlOnly = src.match(/((?:\n\n|\n)https?:\/\/\S+)\s*$/);
        const hashtagOnly = src.match(/((?:\n\n|\n)#[A-Za-z][\s\S]*)$/);
        const suffix = urlWithTags ? urlWithTags[1] : (urlOnly ? urlOnly[1] : (hashtagOnly ? hashtagOnly[1] : ''));
        const body = suffix ? src.substring(0, src.length - suffix.length) : src;
        const maxBody = limit - suffix.length;
        if (maxBody > 40) {
          // Trim body at last sentence or word boundary, then re-attach the protected suffix.
          let trimmed = body.substring(0, maxBody);
          const lastSentence = trimmed.match(/^([\s\S]*[.!?])\s/);
          if (lastSentence && lastSentence[1].length > maxBody * 0.5) {
            trimmed = lastSentence[1];
          } else {
            trimmed = trimmed.substring(0, trimmed.lastIndexOf(' ')) || trimmed;
          }
          return (trimmed.trim() + suffix).trim();
        }
        if (suffix) {
          // Body budget is gone but there IS a link — ship the link rather than a truncated
          // body that drops it. Better a bare link than no link.
          return suffix.replace(/^\n+/, '').trim().substring(0, limit);
        }
        // No link to protect — plain hard-cut.
        return src.substring(0, limit - 1).trim() + '…';
      };
      // UTM injection (after the action is created below) appends ~55 chars to each untagged
      // own-domain link. Reserve that headroom in this FIRST trim so the post-UTM re-trim
      // almost never has to cut copy a second time.
      const _utmTagCount = (String(postText || '').match(/https?:\/\/(?:www\.)?ambientpixels\.ai(?:\/[^\s)]*)?/gi) || [])
        .filter(function (u) { return u.indexOf('utm_') === -1; }).length;
      const _utmReserve = _utmTagCount * ('?utm_source='.length + platformKey.length + '&utm_content='.length + 24);
      const _trimLimit = Math.max(charLimit - _utmReserve, 80);
      if (postText.length > _trimLimit) {
        context.log('[Heartbeat]', agentId, 'Trimming', platformKey, 'post from', postText.length, 'to', _trimLimit, 'chars');
        socialPayload.text = _trimSocialToLimit(postText, _trimLimit);
        context.log('[Heartbeat] Trimmed result:', socialPayload.text.length, 'chars');
      }

      // Server-side enforcement: reject posts with unfilled template placeholders
      if (/\[(?:[^\]]*(?:mention|insert|\badd\b|include|TBD|link|placeholder|url|website|your |e\.g\.|fill))[^\]]*\]/i.test(postText)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — contains placeholder brackets:', postText.substring(0, 100));
        continue;
      }

      // Server-side enforcement: reject posts without a URL
      // Posts must link to a blog article or include https://ambientpixels.ai
      // Exception: posts with {{ARTICLE_URL}} tokens (resolved at execute time)
      const hasUrl = /https?:\/\//.test(postText) || /\{\{ARTICLE_URL[^}]*\}\}/.test(postText);
      if (!hasUrl) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — no URL found in post text. Must include a blog link or https://ambientpixels.ai');
        continue;
      }

      // Server-side enforcement: reject posts linking to unpublished blog articles
      // v2.4.4: Skip this check for {{ARTICLE_URL}} tokens — those are resolved at execute time
      const textWithoutTokens = postText.replace(/\{\{ARTICLE_URL[^}]*\}\}/g, '');
      const blogSlugMatches = textWithoutTokens.match(/(?:ambientpixels\.ai)?\/blog\/([a-z0-9][a-z0-9-]+[a-z0-9])/gi);
      if (blogSlugMatches && blogSlugMatches.length > 0) {
        const blogPosts = (await storage.getState('blogPosts')) || [];
        const publishedSlugs = new Set(blogPosts.map(p => p.slug));
        const deadSlugs = [];
        for (const match of blogSlugMatches) {
          const slug = match.replace(/.*\/blog\//i, '');
          if (!publishedSlugs.has(slug)) deadSlugs.push(slug);
        }
        if (deadSlugs.length > 0) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — links to unpublished blog slug(s):', deadSlugs.join(', '));
          continue;
        }
      }

      // v2.5: Promotion gating — block social posts that reference blog posts without promote: true
      if (blogSlugMatches && blogSlugMatches.length > 0) {
        const _allDocs = (await storage.getState('documents')) || [];
        const _blogPostsForPromo = (await storage.getState('blogPosts')) || [];
        const unpromotedSlugs = [];
        for (const match of blogSlugMatches) {
          const slug = match.replace(/.*\/blog\//i, '');
          // Find the published blog post, then its source document
          const _bp = _blogPostsForPromo.find(p => p.slug === slug);
          if (_bp) {
            const _srcDoc = _allDocs.find(d => d.id === (_bp.documentId || _bp.document_id));
            if (_srcDoc && !_srcDoc.promote) unpromotedSlugs.push(slug);
            else if (!_srcDoc) unpromotedSlugs.push(slug); // no source doc = no promote flag
          }
        }
        if (unpromotedSlugs.length > 0) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — blog slug(s) not approved for promotion:', unpromotedSlugs.join(', '));
          continue;
        }
      }

      // Resolve platform from task's taskType (accounts for server-side rotation)
      // e.g. task.taskType = 'social_x' → platform = 'x'
      var _resolvedPlatform = socialPayload.platform || 'x';
      if (action.taskId) {
        var _parentTask = tasks.find(function(t) { return t.id === action.taskId; });
        if (_parentTask && /^social_/.test(_parentTask.taskType || '')) {
          _resolvedPlatform = _parentTask.taskType.replace('social_', '');
        }
      }
      // Enforce proper sentence-case on the final post copy. The founder-voice doctrine writes
      // sentences lowercase; humans expect sentence case. Tone (short lines, no hype) is kept.
      socialPayload.text = capitalizeSentences(socialPayload.text || '');

      // ── SEMANTIC DEDUP (Phase 1): block near-duplicate copy vs recent posts ──
      // The same-task guards above stop one task spawning two actions; they miss campaign
      // churn where many DIFFERENT tasks produce near-identical copy. Catch it at creation.
      {
        var _semCampaignId = null;
        if (action.taskId) {
          var _semTaskC = tasks.find(function (t) { return t.id === action.taskId; });
          if (_semTaskC) _semCampaignId = _semTaskC.campaign_id || null;
        }
        var _semDup = findNearDuplicateSocialPost({
          text: socialPayload.text || '',
          platform: _resolvedPlatform,
          campaignId: _semCampaignId,
          actions: existingActions,
          tasks: tasks,
          now: Date.now()
        });
        if (_semDup.isDuplicate) {
          result.guardrails.fuzzyDupBlocked++;
          var _semPct = Math.round(_semDup.similarity * 100);
          context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — near-duplicate copy (' + _semPct + '% similar to ' + _semDup.matchId + ' on ' + _resolvedPlatform + ')');
          var _semTask = action.taskId ? tasks.find(function (t) { return t.id === action.taskId; }) : null;
          if (_semTask) {
            _semTask._social_action_suppressed_dup = true;   // stop re-injection loop next cycle
            _semTask.updatedAt = new Date().toISOString();
            if (!_semTask.comments) _semTask.comments = [];
            _semTask.comments.push({
              id: 'cmt-semdup-' + Date.now(),
              author: 'system',
              text: 'Near-duplicate social post blocked (' + _semPct + '% similar to a recent ' + _resolvedPlatform + ' post). This campaign is churning the same theme — vary the topic/angle before posting again.',
              type: 'system',
              createdAt: new Date().toISOString()
            });
          }
          await logEvent('policy-violation', agentId, 'Near-duplicate social post blocked', cycleId,
            { runId: cycleId, gate: 'semantic_dup', reason: 'social_text_similarity',
              platform: _resolvedPlatform, similarityPct: _semPct, similarActionId: _semDup.matchId,
              taskId: action.taskId || null, campaignId: _semCampaignId });
          continue;
        }
      }

      // ── DAILY POST CAP (Phase 1 item 2): bound per-campaign-per-platform volume ──
      // Item 1 blocks near-identical copy; this bounds VOLUME so a campaign can't flood one
      // platform in a day with differently-worded posts. Over-cap posts are DEFERRED (not
      // dropped) so the flood spreads as older posts age out of the 24h window.
      if (_semCampaignId || action.taskId) {
        var _capCmp = (_semCampaignId && campaignCtx && campaignCtx.campaignById) ? campaignCtx.campaignById[_semCampaignId] : null;
        var _capStatus = campaignDailyPostCapStatus({
          campaignId: _semCampaignId,
          parentTaskId: action.taskId || null,
          platform: _resolvedPlatform,
          frequency: _capCmp ? _capCmp.frequency : null,
          cadence: _capCmp ? _capCmp.cadence : null,
          actions: existingActions,
          tasks: tasks,
          now: Date.now()
        });
        if (_capStatus.exceeded) {
          context.log('[Heartbeat]', agentId, 'DEFERRED create-social-action — campaign daily post cap reached (' + _capStatus.count + '/' + _capStatus.cap + ' on ' + _resolvedPlatform + ' in 24h) for campaign ' + _semCampaignId);
          var _capTask = action.taskId ? tasks.find(function (t) { return t.id === action.taskId; }) : null;
          if (_capTask) {
            _capTask._social_post_deferred_until = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
            _capTask.updatedAt = new Date().toISOString();
            if (!_capTask.comments) _capTask.comments = [];
            var _hasCapNote = (_capTask.comments || []).some(function (c) { return c && c.text && c.text.indexOf('Daily post cap reached') !== -1; });
            if (!_hasCapNote) {
              _capTask.comments.push({
                id: 'cmt-capdaily-' + Date.now(),
                author: 'system',
                text: 'Daily post cap reached for this campaign on ' + _resolvedPlatform + ' (' + _capStatus.count + ' in 24h, cap ' + _capStatus.cap + '). Post deferred ~3h so the campaign stops flooding one platform — it will retry once earlier posts age out of the window.',
                type: 'system',
                createdAt: new Date().toISOString()
              });
            }
          }
          await logEvent('policy-violation', agentId, 'Campaign daily post cap deferred social post', cycleId,
            { runId: cycleId, gate: 'campaign_daily_cap', reason: 'per_platform_daily_volume',
              platform: _resolvedPlatform, count: _capStatus.count, cap: _capStatus.cap,
              taskId: action.taskId || null, campaignId: _semCampaignId });
          continue;
        }
      }

      // ── REPEAT-PROMO SERIALIZE (A2): one pending post per deep link per platform ──
      // Items 1-2 bound copy similarity and volume; this serializes PROMO TARGETS so the
      // queue never piles up same-link posts (the 2026-06-10 curation killed 8 of 9 queued
      // startup-obituary posts — all the same link, each worded differently enough to slip
      // both gates). DEFER like the cap: once the pending post is decided, the next may queue.
      {
        var _promoStatus = QGV.repeatPromoUrlStatus({
          text: socialPayload.text || '',
          platform: _resolvedPlatform,
          actions: existingActions,
          now: Date.now()
        });
        if (_promoStatus.exceeded) {
          context.log('[Heartbeat]', agentId, 'DEFERRED create-social-action — repeat promo: ' + _promoStatus.url + ' already pending on ' + _resolvedPlatform + ' (' + _promoStatus.matchId + ')');
          var _promoTask = action.taskId ? tasks.find(function (t) { return t.id === action.taskId; }) : null;
          if (_promoTask) {
            _promoTask._social_post_deferred_until = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
            _promoTask.updatedAt = new Date().toISOString();
            if (!_promoTask.comments) _promoTask.comments = [];
            var _hasPromoNote = (_promoTask.comments || []).some(function (c) { return c && c.text && c.text.indexOf('Repeat-promo serialized') !== -1; });
            if (!_hasPromoNote) {
              _promoTask.comments.push({
                id: 'cmt-promoser-' + Date.now(),
                author: 'system',
                text: 'Repeat-promo serialized: a post linking ' + _promoStatus.url + ' is already pending approval on ' + _resolvedPlatform + '. One queued post per link at a time — this one is deferred ~6h and will retry once the pending post is decided.',
                type: 'system',
                createdAt: new Date().toISOString()
              });
            }
          }
          await logEvent('policy-violation', agentId, 'Repeat-promo deferred social post (same link already pending)', cycleId,
            { runId: cycleId, gate: 'repeat_promo_url', reason: 'same_link_pending_on_platform',
              platform: _resolvedPlatform, url: _promoStatus.url, pendingActionId: _promoStatus.matchId,
              taskId: action.taskId || null, campaignId: _semCampaignId });
          continue;
        }
      }

      const _diagRc = action.taskId ? ((tasks.find(function(t) { return t.id === action.taskId; }) || {}).reviewed_copy || '').length : -1;
      context.log('[Heartbeat]', agentId, 'CREATING social action — GATE PASSED. taskId:', action.taskId, 'rc_len:', _diagRc, 'text_len:', (socialPayload.text || '').length, '_codeTag:v10diag');
      // For Reddit: extract target subreddit from task description/comments (r/SubName pattern)
      var _redditSubreddit = null;
      if (_resolvedPlatform === 'reddit' && action.taskId) {
        var _redditTask = tasks.find(function(t) { return t.id === action.taskId; });
        var _redditSearch = (_redditTask ? ((_redditTask.description || '') + ' ' + (_redditTask.comments || []).map(function(c) { return c.text || ''; }).join(' ')) : '');
        var _redditSubMatch = _redditSearch.match(/\br\/([A-Za-z0-9_]{2,21})\b/);
        if (_redditSubMatch) _redditSubreddit = _redditSubMatch[1];
      }
      // Auto-inject experiment_tag: if the agent has exactly 1 active experiment,
      // auto-tag this social post with its hypothesis. If 2+ active, pick the most
      // recently started (the agent should know which she's testing; newest is safer
      // than picking randomly). Previously Echo's Gemini never emitted experiment_tag,
      // so sample counting never fired — 3 active experiments, 0 concluded in 30 days.
      let _autoTag = null;
      if (!action.experiment_tag && Array.isArray(agentExperiments)) {
        const _activeForAgent = agentExperiments
          .filter(function (e) { return e && e.status === 'active' && e.agentId === agentId; })
          .sort(function (a, b) {
            return new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime();
          });
        if (_activeForAgent.length > 0) {
          _autoTag = _activeForAgent[0].hypothesis || null;
          if (_autoTag) context.log('[Heartbeat]', agentId, 'AUTO-INJECTED experiment_tag:', _autoTag, '(active experiments:', _activeForAgent.length + ')');
        }
      }
      const actionRequest = {
        type: (socialPayload.scheduled_for || socialPayload.schedule_for) ? 'social_post.schedule' : 'social_post.publish',
        platform: _resolvedPlatform,
        _codeVersion: 'v2-diag10',
        payload: {
          text: socialPayload.text || '',
          media: socialPayload.media || [],
          scheduled_for: socialPayload.scheduled_for || socialPayload.schedule_for || null,
          subreddit: _redditSubreddit || socialPayload.subreddit || null
        },
        created_by: agentId,
        experiment_tag: action.experiment_tag || _autoTag || null
      };

      // Save to actions store (requires CEO approval)
      const actionsStore = (await storage.getState('actions')) || [];
      const newAction = _createActionFromHeartbeat(actionRequest, agentId);

      // v2.4.4: If agent provided artifact_id, wire up tokens + dependsOn for URL resolution
      if (socialPayload.artifact_id) {
        newAction.tokens = { ARTICLE_URL: { type: 'artifact', id: socialPayload.artifact_id } };
        newAction.dependsOn = [{ type: 'artifact', id: socialPayload.artifact_id }];
        context.log('[Heartbeat]', agentId, 'social action linked to artifact:', socialPayload.artifact_id);
      }

      // Outcome Attribution Phase 2: inject UTM params into ambientpixels.ai URLs
      // so blog views + form submits are attributable to this specific post.
      try {
        const _utmS = _resolvedPlatform;
        const _utmC = newAction.id;
        newAction.payload.text = String(newAction.payload.text || '').replace(
          /https?:\/\/(?:www\.)?ambientpixels\.ai(?:\/[^\s)]*)?/gi,
          function (_url) {
            if (_url.indexOf('utm_') !== -1) return _url;
            const _sep = _url.indexOf('?') !== -1 ? '&' : '?';
            return _url + _sep + 'utm_source=' + encodeURIComponent(_utmS) + '&utm_content=' + encodeURIComponent(_utmC);
          }
        );
      } catch (_utmErr) {
        context.log('[Heartbeat]', agentId, 'UTM inject failed (non-fatal):', String(_utmErr).substring(0, 200));
      }

      // UTM injection lengthens the link, which can push a trimmed-to-limit post back over
      // the platform cap. Re-trim the FINAL text (URL-preserving) so the stored + approved
      // copy already fits — the executor never has to tail-chop, which would drop the link.
      if ((newAction.payload.text || '').length > charLimit) {
        const _preRetrim = newAction.payload.text.length;
        newAction.payload.text = _trimSocialToLimit(newAction.payload.text, charLimit);
        context.log('[Heartbeat]', agentId, 'Re-trimmed', platformKey, 'post after UTM from', _preRetrim, 'to', newAction.payload.text.length, 'chars');
      }

      // Link action to parent task if provided
      if (action.taskId) newAction._parentTaskId = action.taskId;

      // B1: count auto-generated social actions per task. At the cap the done-task
      // injection and auto-post selection stop re-firing; CEO revision resets the budget.
      if (action.taskId) {
        var _attTask = tasks.find(function (t) { return t.id === action.taskId; });
        if (_attTask) {
          _attTask._social_action_attempts = (_attTask._social_action_attempts || 0) + 1;
          _attTask.updatedAt = new Date().toISOString();
          if (_attTask._social_action_attempts >= QGV.SOCIAL_ATTEMPTS_CAP) {
            if (!_attTask.comments) _attTask.comments = [];
            var _hasAttNote = (_attTask.comments || []).some(function (c) { return c && c.text && c.text.indexOf('Social attempts cap') !== -1; });
            if (!_hasAttNote) {
              _attTask.comments.push({
                id: 'cmt-attcap-' + Date.now(),
                author: 'system',
                text: 'Social attempts cap reached (' + _attTask._social_action_attempts + ' auto-created actions for this task). No further auto-posting from this task — a CEO revision request resets the budget.',
                type: 'system',
                createdAt: new Date().toISOString()
              });
            }
            await logEvent('policy-violation', agentId, 'Social attempts cap reached for task', cycleId,
              { runId: cycleId, gate: 'social_attempts_cap', reason: 'max_auto_actions_per_task',
                attempts: _attTask._social_action_attempts, cap: QGV.SOCIAL_ATTEMPTS_CAP, taskId: action.taskId });
          }
        }
      }

      // Pipeline trust signals — attach metadata showing which steps this action went through
      if (action.taskId) {
        var _ptTask = tasks.find(function (t) { return t.id === action.taskId; });
        if (_ptTask) {
          newAction._pipelineSteps = {
            echoBrief: !!(_ptTask.comments || []).find(function (c) { return c.author === 'echo' && c.type === 'deliverable'; }),
            scribeCopy: !!_ptTask.reviewed_copy,
            peerReview: _ptTask.status === 'done',
            qualityGate: newAction.qualityGate || null
          };
        }
      }

      actionsStore.push(newAction);
      await storage.setState('actions', actionsStore);

      // Extract first media URL for approval queue preview (if any)
      var _socialPreviewImage = null;
      if (newAction.payload && Array.isArray(newAction.payload.media) && newAction.payload.media.length > 0) {
        var _firstMedia = newAction.payload.media[0];
        _socialPreviewImage = (typeof _firstMedia === 'string') ? _firstMedia : (_firstMedia && _firstMedia.url) || null;
      }

      // Quality gate — validate content before approval queue
      var _qgResult = null;
      var _postText = (newAction.payload && newAction.payload.text) || '';
      if (_postText.length > 10) {
        _qgResult = await _validateContentQuality(_postText, newAction.platform || 'social', context);
        // A2+A3: compose the LLM result with deterministic checks (leak detectors, persona,
        // length, claim grounding vs the task chain) into ONE verdict. Downstream reject /
        // circuit-breaker / AQ-badge logic consumes the composed verdict unchanged.
        try {
          var _qgvTask = action.taskId ? tasks.find(function (t) { return t.id === action.taskId; }) : null;
          // Live offers: runtime registry (systemConfig.offers, written by as-offer-create
          // after the CEO implements pricing in Stripe) layered over the static file.
          // Fail-open to file-only — a transient read error must not block posting.
          var _rtOffers = null;
          try { _rtOffers = ((await storage.getState('systemConfig')) || {}).offers; } catch (_roErr) { /* file offers only */ }
          _qgResult = QGV.composeQualityVerdict({
            llm: _qgResult,
            text: _postText,
            platform: newAction.platform,
            offers: QGV.FILE_OFFERS.concat(Array.isArray(_rtOffers) ? _rtOffers : []),
            grounding: QGV.findUngroundedClaims(_postText, QGV.buildGroundingText(_qgvTask, _productFacts))
          });
        } catch (_qgvErr) {
          context.log('[QualityGate] compose error (LLM-only fallback):', String(_qgvErr).substring(0, 150));
        }
        if (_qgResult) {
          context.log('[QualityGate]', newAction.platform, 'pass:', _qgResult.pass, 'confidence:', _qgResult.confidence, 'issues:', (_qgResult.issues || []).length, 'det:', JSON.stringify(_qgResult.deterministicFlags || {}));
          // Stamp the verdict on the ACTION (not just the AQ entry) — the Phase C grace
          // window reads action.qualityGate to decide auto-publish eligibility.
          newAction.qualityGate = {
            pass: !!_qgResult.pass, confidence: _qgResult.confidence || 0,
            issues: (_qgResult.issues || []).slice(0, 6),
            deterministicFlags: _qgResult.deterministicFlags || null
          };
        }
      }

      // Quality gate FAILED — auto-reject and send issues back to agent for revision
      if (_qgResult && !_qgResult.pass && (_qgResult.confidence || 0) >= 70) {
        // Circuit breaker: if this task has already failed QG >= threshold times, escalate instead of retry.
        var _qgParentForCount = action.taskId ? tasks.find(function (t) { return t.id === action.taskId; }) : null;
        var _priorFails = _countQgFailures(_qgParentForCount);
        if (_qgParentForCount && _priorFails >= QG_FAIL_CIRCUIT_BREAKER_THRESHOLD) {
          // Remove the action we just pushed (it failed quality)
          var _cbActionIdx = actionsStore.findIndex(function (a) { return a.id === newAction.id; });
          if (_cbActionIdx !== -1) actionsStore.splice(_cbActionIdx, 1);
          await storage.setState('actions', actionsStore);
          // Mark the task escalated
          _qgParentForCount.status = 'escalated';
          _qgParentForCount._quality_gate_escalated = true;
          _qgParentForCount._social_action_created = false;
          _qgParentForCount._social_action_pending = false;
          _qgParentForCount.reviewed_copy = null;
          _qgParentForCount.awaiting_copy_review = false;
          _qgParentForCount.updatedAt = new Date().toISOString();
          if (!_qgParentForCount.comments) _qgParentForCount.comments = [];
          _qgParentForCount.comments.push({
            id: 'cmt-qgescalate-' + Date.now(),
            author: 'system',
            text: 'CIRCUIT BREAKER: ' + _priorFails + ' consecutive quality-gate failures on this task. Escalating to CEO review — automatic retries disabled. Latest issues: ' + ((_qgResult.issues || []).slice(0, 3).join('; ')).substring(0, 400),
            type: 'system',
            createdAt: new Date().toISOString()
          });
          // Add to approval queue as a task escalation so CEO sees it in needs-action feed
          try {
            var _aqEsc = (await storage.getState('approvalQueue')) || [];
            var _inlineEscId = 'aq-qgesc-' + _qgParentForCount.id;
            if (_aqEsc.some(function (q) { return q && q.id === _inlineEscId; })) {
              context.log('[QualityGate] circuit-breaker AQ entry already exists for', _qgParentForCount.id, '— skipping duplicate push');
            } else {
              _aqEsc.push({
                id: _inlineEscId,
                kind: 'task_escalation',
                taskId: _qgParentForCount.id,
                taskTitle: _qgParentForCount.title || 'Quality-gate escalation',
                originAgent: agentId,
                classification: 'executive_required',
                riskLevel: 'medium',
                budgetImpact: 0,
                brandImpact: 'medium',
                status: 'pending',
                submittedAt: new Date().toISOString(),
                preview: 'Quality gate failed ' + _priorFails + ' times. Latest issues: ' + ((_qgResult.issues || []).slice(0, 3).join('; ')).substring(0, 200),
                qualityGate: { pass: false, confidence: _qgResult.confidence || 0, issues: _qgResult.issues || [], failCount: _priorFails }
              });
            }
            await storage.setState('approvalQueue', _aqEsc);
          } catch (_aqEscErr) { context.log('[Heartbeat] circuit-breaker AQ push failed:', String(_aqEscErr).substring(0, 200)); }
          try {
            await logEvent('policy-violation', agentId, 'Quality gate circuit breaker tripped', cycleId, {
              runId: cycleId, gate: 'quality_gate_circuit_breaker', taskId: _qgParentForCount.id, failCount: _priorFails
            });
          } catch (_) {}
          context.log('[QualityGate] CIRCUIT BREAKER tripped for task', _qgParentForCount.id, 'after', _priorFails, 'failures');
          continue; // skip the normal retry path
        }
        // Remove the action we just pushed (it failed quality)
        var _qgActionIdx = actionsStore.findIndex(function(a) { return a.id === newAction.id; });
        if (_qgActionIdx !== -1) actionsStore.splice(_qgActionIdx, 1);
        await storage.setState('actions', actionsStore);

        // Reset the parent task so Scribe can rewrite
        var _qgParentTask = action.taskId ? tasks.find(function(t) { return t.id === action.taskId; }) : null;
        if (_qgParentTask) {
          _qgParentTask.status = 'in-progress';
          _qgParentTask.reviewed_copy = null;
          _qgParentTask.awaiting_copy_review = false;
          _qgParentTask._social_action_created = false;
          _qgParentTask._social_action_pending = false;
          _qgParentTask.updatedAt = new Date().toISOString();
          if (!_qgParentTask.comments) _qgParentTask.comments = [];
          _qgParentTask.comments.push({
            id: 'cmt-qgfail-' + Date.now(),
            author: 'system',
            text: 'QUALITY GATE FAILED — Post rejected (confidence: ' + (_qgResult.confidence || 0) + '%).\n\nIssues found:\n- ' + (_qgResult.issues || []).join('\n- ') + '\n\nScribe: rewrite the copy addressing ALL issues above. Check product-facts for accurate feature descriptions. Do NOT invent features, pricing tiers, or capabilities. For tone issues: no buzzwords, no em dashes, no rhetorical question hooks, 5th grade reading level. Lead with specifics not adjectives. If it sounds like a press release, start over.',
            type: 'system',
            createdAt: new Date().toISOString()
          });
          context.log('[QualityGate] REJECTED:', newAction.platform, 'action for task:', action.taskId, '— issues:', (_qgResult.issues || []).length, '— task reset to in-progress for Scribe revision');

          // Hallucination-class failure: the fault is in Echo's brief, not just Scribe's copy.
          // Add a prominent BRIEF-LEVEL system comment with the specific hallucinated phrases +
          // corrected product facts so Echo cannot miss it on the next execute pass.
          if (_isHallucinationFailure(_qgResult)) {
            var _hallProductKey = _detectProductFromTask(_qgParentTask);
            var _hallFactsLine = '';
            if (_hallProductKey && _productFacts && _productFacts.products && _productFacts.products[_hallProductKey]) {
              var _hp = _productFacts.products[_hallProductKey];
              _hallFactsLine = '\n\nCorrect facts for ' + _hallProductKey + ':\n- ' + _hp.description + '\n- Real features: ' + (_hp.features || []).join('; ') + '\n- This product is NOT: ' + (_hp.notThis || []).join('; ');
            }
            var _hallIssues = (_qgResult.issues || []).filter(function (i) { return typeof i === 'string' && QG_HALLUCINATION_KEYWORDS.test(i); });
            if (_hallIssues.length === 0) _hallIssues = (_qgResult.issues || []).slice(0, 3);
            _qgParentTask.comments.push({
              id: 'cmt-qgbrief-' + Date.now(),
              author: 'system',
              text: 'BRIEF CORRECTION REQUIRED — hallucinated features detected. Your earlier brief told Scribe to write about capabilities this product does not have. Rewriting the copy alone will repeat the same hallucination. Specific hallucinated claims:\n- ' + _hallIssues.join('\n- ') + _hallFactsLine + '\n\nOn your next execute-task pass, revise the BRIEF itself. Remove invented features. Use only facts from product-facts.',
              type: 'system',
              createdAt: new Date().toISOString()
            });
            context.log('[QualityGate] HALLUCINATION detected on', action.taskId, 'product:', _hallProductKey || 'unknown', '— brief-correction comment posted to Echo parent task');
          }

          // Spawn fresh Scribe copy task with QG feedback embedded so the pipeline self-heals.
          // Without this the parent dies in limbo after auto-reject (no flag triggers re-engagement).
          var _qgHallCtx = (typeof _hallProductKey !== 'undefined' && _hallProductKey && typeof _hallFactsLine !== 'undefined' && _hallFactsLine)
            ? { productKey: _hallProductKey, factsLine: _hallFactsLine } : null;
          var _qgRespawn = spawnQgRespawnCopyTask(tasks, _qgParentTask, newAction.platform, _qgResult.issues, _qgHallCtx);
          if (_qgRespawn) {
            context.log('[QualityGate] Spawned QG-respawn copy task', _qgRespawn.id, 'for parent', _qgParentTask.id);
          }
        }

        // Quality-gate feedback memory — closes the learning loop so the agent sees the specific
        // issues in their next prompt (memory block + reflection callout). Matches rate-limit pattern.
        try {
          if (!_agentMemoryStore[agentId]) _agentMemoryStore[agentId] = [];
          const _qgNow = new Date();
          const _qgIssuesStr = (_qgResult.issues || []).slice(0, 5).join('; ');
          _agentMemoryStore[agentId].push({
            id: 'mem_' + Date.now() + '_qg_' + Math.random().toString(36).substr(2, 4),
            type: 'feedback',
            text: 'Quality gate rejected my last social post (' + (newAction.platform || 'social') + '). Issues: ' +
              (_qgIssuesStr || 'unspecified') +
              '. Apply these corrections on next draft — do not repeat the same mistakes.',
            source: 'auto:quality-gate',
            timestamp: _qgNow.toISOString(),
            expiresAt: new Date(_qgNow.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            evidence: { runId: cycleId }
          });
          if (_agentMemoryStore[agentId].length > MAX_MEMORIES_PER_AGENT) {
            _agentMemoryStore[agentId] = _agentMemoryStore[agentId].slice(-MAX_MEMORIES_PER_AGENT);
          }
          context.log('[Heartbeat]', agentId, 'Quality-gate feedback memory written');
        } catch (_qgMemErr) {
          context.log('[Heartbeat]', agentId, 'Quality-gate memory write failed (non-fatal):', String(_qgMemErr).substring(0, 200));
        }

        // Governance log entry — makes quality-gate rejections visible on the governance-report dashboard.
        try {
          await logEvent('policy-violation', agentId, 'Quality gate rejected social post', cycleId, {
            runId: cycleId,
            gate: 'quality_gate',
            reason: 'haiku_rejection',
            platform: newAction.platform || null,
            confidence: _qgResult.confidence || null,
            issueCount: (_qgResult.issues || []).length,
            issuesPreview: ((_qgResult.issues || []).slice(0, 5).join('; ')).substring(0, 200)
          });
        } catch (_qgLogErr) {
          context.log('[Heartbeat]', agentId, 'Quality-gate logEvent failed (non-fatal):', String(_qgLogErr).substring(0, 200));
        }

        // Outcome Attribution Phase 5: log structured decision so we can later
        // measure whether rewrites outperform first drafts.
        try {
          await appendDecision(storage, {
            cycleId: cycleId,
            agentId: agentId,
            decisionType: 'quality-gate-rewrite',
            contextActionId: newAction.id,
            contextTaskId: action.taskId || null,
            before: {
              platform: newAction.platform || null,
              textPreview: ((newAction.payload && newAction.payload.text) || '').substring(0, 200),
              issues: (_qgResult.issues || []).slice(0, 3)
            },
            after: null,
            reasoning: 'Quality gate rejected at confidence ' + (_qgResult.confidence || 0) + '%; awaiting Scribe rewrite.'
          });
        } catch (_decErr) { /* non-fatal */ }

        continue; // skip approval queue — action was rejected
      }

      // Add to approval queue (quality gate passed or no result)
      const approvalQueue = (await storage.getState('approvalQueue')) || [];
      var _aqEntry = {
        id: 'aq-' + newAction.id,
        kind: 'action',
        action_id: newAction.id,
        taskId: action.taskId || null,
        taskTitle: 'Social Post (' + (newAction.platform || 'x') + ')',
        originAgent: agentId,
        classification: newAction.classification,
        riskLevel: newAction.risk_level,
        budgetImpact: 0,
        brandImpact: 'medium',
        status: 'pending',
        submittedAt: new Date().toISOString(),
        preview: _postText.substring(0, 120),
        previewImageUrl: _socialPreviewImage
      };
      if (_qgResult) {
        _aqEntry.qualityGate = {
          pass: !!_qgResult.pass,
          confidence: _qgResult.confidence || 0,
          issues: _qgResult.issues || [],
          model: 'claude-haiku-4-5-20251001',
          checkedAt: new Date().toISOString()
        };
      }
      approvalQueue.push(_aqEntry);
      if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
      await storage.setState('approvalQueue', approvalQueue);

      // Auto-advance parent task to review if taskId provided
      // Fallback: if no taskId but agent has a matching active task, auto-link
      var socialTaskId = action.taskId || null;
      if (!socialTaskId) {
        var platform = (socialPayload.platform || 'social').toLowerCase();
        var agentActiveTasks = tasks.filter(t => t.assignee === agentId && (t.status === 'todo' || t.status === 'in-progress'));
        var socialKeywords = ['social', 'post', 'linkedin', 'twitter', 'bluesky', 'x post', 'hello world', 'publish', 'announce'];
        var matchingTasks = agentActiveTasks.filter(t => {
          var haystack = ((t.title || '') + ' ' + (t.description || '')).toLowerCase();
          return socialKeywords.some(kw => haystack.indexOf(kw) !== -1) || haystack.indexOf(platform) !== -1;
        });
        if (matchingTasks.length === 1) {
          socialTaskId = matchingTasks[0].id;
          context.log('[Heartbeat]', agentId, 'auto-linked social action to task:', socialTaskId, '(fallback match)');
        } else if (matchingTasks.length === 0 && agentActiveTasks.length === 1) {
          socialTaskId = agentActiveTasks[0].id;
          context.log('[Heartbeat]', agentId, 'auto-linked social action to only active task:', socialTaskId);
        }
      }
      if (socialTaskId) {
        var parentIdx = tasks.findIndex(t => t.id === socialTaskId);
        if (parentIdx !== -1 && tasks[parentIdx].status !== 'done' && tasks[parentIdx].status !== 'review') {
          tasks[parentIdx].status = 'review';
          tasks[parentIdx].updatedAt = new Date().toISOString();
          if (!tasks[parentIdx].comments) tasks[parentIdx].comments = [];
          tasks[parentIdx].comments.push({
            id: 'cmt-' + Date.now(),
            author: agentId,
            text: 'Social post created and submitted for CEO approval (action: ' + newAction.id + '). Awaiting CEO decision.',
            type: 'deliverable',
            createdAt: new Date().toISOString()
          });
          context.log('[Heartbeat]', agentId, 'auto-advanced task', socialTaskId, 'to review (social action created)');
        }
      }

      context.log('[Heartbeat]', agentId, 'created social action:', newAction.id, newAction.type, newAction.platform);
      result.taskUpdates.push({ action: 'social-action-created', actionId: newAction.id, agentId: agentId, taskId: socialTaskId });

    } else if (action.type === 'revise-action' && action.action_id && action.social) {
      // Agent revising a CEO-rejected action — update payload and re-submit for approval
      // Server-side sanitizer: strip deliverable metadata from revised text
      if (action.social.text && /\*\*(?:Task|Deliverable|LinkedIn Post Draft|Follow-up|Peer Review|Notes|Review).*?:\*\*/i.test(action.social.text)) {
        let raw = action.social.text;
        const draftMatch = raw.match(/\*\*LinkedIn Post Draft:\*\*\s*([\s\S]*?)(?=\*\*(?:Follow-up|Notes|Peer Review|Review)[^*]*:\*\*)/i)
          || raw.match(/\*\*(?:Post|Draft|Content):\*\*\s*([\s\S]*?)(?=\*\*(?:Follow-up|Notes|Peer Review|Review)[^*]*:\*\*)/i);
        if (draftMatch && draftMatch[1].trim().length > 20) {
          raw = draftMatch[1].trim();
        } else {
          const sections = raw.split(/\*\*(?:Task|Deliverable|LinkedIn Post Draft|Follow-up Comment|Peer Review[^*]*|Notes|Review[^*]*):\*\*/i);
          let best = '';
          for (const section of sections) {
            const cleaned = section.replace(/^#{1,4}\s+.*$/gm, '').replace(/^\s*[-–]\s+/gm, '').trim();
            if (cleaned.length > best.length && !/^\s*\*\*/.test(cleaned) && cleaned.length > 20) best = cleaned;
          }
          if (best.length > 20) raw = best;
        }
        raw = raw.replace(/^#{1,4}\s+.*$/gm, '');
        raw = raw.replace(/\*\*([^*]+)\*\*/g, '$1');
        raw = raw.replace(/\*([^*]+)\*/g, '$1');
        raw = raw.replace(/^\s*\*\s+/gm, '');
        raw = raw.replace(/\n{3,}/g, '\n\n').trim();
        action.social.text = raw;
      }
      const revisedText = action.social.text || '';

      // Server-side enforcement: reject revised posts with placeholder brackets
      if (/\[(?:[^\]]*(?:mention|insert|\badd\b|include|TBD|link|placeholder|url|website|your |e\.g\.|fill))[^\]]*\]/i.test(revisedText)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED revise-action — contains placeholder brackets:', revisedText.substring(0, 100));
        continue;
      }

      const actionsStore = (await storage.getState('actions')) || [];
      const origIdx = actionsStore.findIndex(a => a.id === action.action_id);
      if (origIdx === -1) {
        context.log('[Heartbeat]', agentId, 'revise-action: action not found:', action.action_id);
        continue;
      }
      const orig = actionsStore[origIdx];

      // Detect if this is a publish_document action
      const _isPublishRevision = (orig.type === 'publish_document' || orig.action_type === 'publish_document');

      // Update payload with revised content
      orig.payload = orig.payload || {};
      if (_isPublishRevision) {
        // For publish_document: update content_md, not payload.text
        // Sanitize agent meta-commentary before storing
        var _revClean = revisedText;
        _revClean = _revClean.replace(/\n*\*{0,2}(?:Notes|Revision Notes|Editor'?s? Notes?|Changes? Made|Revisions?|Internal Notes?|Keywords)\*{0,2}:?\*{0,2}\s*\n[\s\S]*$/i, '').trim();
        _revClean = _revClean.replace(/\n*(?:Artifact ID|Parent task ID|Document ID|Task ID|Campaign ID|Objective ID)[:\s][^\n]*/gi, '').trim();
        _revClean = _revClean.replace(/\s*\[(?:ADDRESSED|NOTE|REVISED|FEEDBACK|CHANGED|UPDATED)(?::\s*[^\]]*)?(?:\]\.?\s*)/gi, ' ').trim();
        orig.payload.content_md = _revClean;
      } else {
        orig.payload.text = revisedText;
      }
      if (action.social.media) orig.payload.media = action.social.media;
      if (action.social.scheduled_for) orig.payload.scheduled_for = action.social.scheduled_for;

      // For publish_document revisions: re-resolve hero image URL from imageAssets
      // (Pixel may have generated the image after the original submit-for-publish)
      let _revHeroImageUrl = orig.payload.hero_image_url || null;
      if (_isPublishRevision) {
        try {
          // Check if the document now has a hero_image_asset_id (Pixel may have updated it)
          const _revDocs = (await storage.getState('documents')) || [];
          const _revDoc = _revDocs.find(d => d.id === (orig.payload.documentId || ''));
          const _revAssetId = (_revDoc && _revDoc.hero_image_asset_id) || orig.payload.hero_image_asset_id || null;
          if (_revAssetId) {
            orig.payload.hero_image_asset_id = _revAssetId;
            const _revImgAssets = (await storage.getState('imageAssets')) || [];
            const _revAsset = _revImgAssets.find(a => a.id === _revAssetId);
            if (_revAsset && _revAsset.url) {
              _revHeroImageUrl = _revAsset.url;
              orig.payload.hero_image_url = _revHeroImageUrl;
            }
          }
        } catch (_revImgErr) { /* non-fatal */ }
      }

      // Reset approval to pending
      orig.approval = orig.approval || {};
      orig.approval.status = 'pending';
      orig.approval.decision_note = null;
      orig.approval.revised_at = new Date().toISOString();
      orig.approval.revision_count = (orig.approval.revision_count || 0) + 1;

      // Reset execution state so it can be re-executed after approval
      orig.execution_status = 'pending';
      if (orig.execution) {
        orig.execution.status = 'pending';
        orig.execution.attempts = 0;
        orig.execution.last_error = null;
      }

      actionsStore[origIdx] = orig;
      await storage.setState('actions', actionsStore);

      // Auto-memory: remember CEO feedback so agent learns from rejections
      const ceoFeedback = (orig.approval && orig.approval.decision_note) || '';
      if (ceoFeedback.length > 5) {
        if (!_agentMemoryStore[agentId]) _agentMemoryStore[agentId] = [];
        var _autoMemNow = new Date();
        _agentMemoryStore[agentId].push({
          id: 'mem_' + Date.now() + '_auto',
          type: 'feedback',
          text: 'CEO rejected my ' + (orig.platform || '') + ' post and said: "' + ceoFeedback.substring(0, 200) + '"',
          source: 'auto:ceo-revision',
          timestamp: _autoMemNow.toISOString(),
          expiresAt: new Date(_autoMemNow.getTime() + L4_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
        });
        if (_agentMemoryStore[agentId].length > MAX_MEMORIES_PER_AGENT) {
          _agentMemoryStore[agentId] = _agentMemoryStore[agentId].slice(-MAX_MEMORIES_PER_AGENT);
        }
      }

      // Update or re-add to approval queue
      const approvalQueue = (await storage.getState('approvalQueue')) || [];
      const aqIdx = approvalQueue.findIndex(q => q.action_id === orig.id);
      // Extract media preview for revised social post
      var _revisedPreviewImage = null;
      if (orig.payload && Array.isArray(orig.payload.media) && orig.payload.media.length > 0) {
        var _rm = orig.payload.media[0];
        _revisedPreviewImage = (typeof _rm === 'string') ? _rm : (_rm && _rm.url) || null;
      }

      // Preserve existing AQ entry fields for publish_document revisions
      const _prevAqEntry = aqIdx !== -1 ? approvalQueue[aqIdx] : {};

      const aqEntry = _isPublishRevision ? {
        // Publish-document-specific AQ entry
        id: aqIdx !== -1 ? _prevAqEntry.id : 'aq-' + orig.id,
        kind: 'action',
        actionType: 'publish_document',
        action_id: orig.id,
        taskId: _prevAqEntry.taskId || null,
        taskTitle: 'Publish: ' + (orig.payload.title || 'Untitled'),
        originAgent: agentId,
        classification: orig.classification || 'executive_required',
        riskLevel: orig.risk_level || 'medium',
        budgetImpact: 0,
        brandImpact: 'medium',
        status: 'pending',
        submittedAt: new Date().toISOString(),
        preview: (orig.payload.content_md || revisedText).substring(0, 120),
        documentId: orig.payload.documentId || _prevAqEntry.documentId || null,
        slug: orig.payload.slug || _prevAqEntry.slug || null,
        docKind: orig.payload.kind || _prevAqEntry.docKind || null,
        artifactId: _prevAqEntry.artifactId || null,
        heroImageUrl: _revHeroImageUrl,
        heroImageAssetId: orig.payload.hero_image_asset_id || _prevAqEntry.heroImageAssetId || null,
        revisionCount: orig.approval.revision_count || 0
      } : {
        // Social post AQ entry (original behavior)
        id: aqIdx !== -1 ? _prevAqEntry.id : 'aq-' + orig.id,
        kind: 'action',
        action_id: orig.id,
        taskId: null,
        taskTitle: 'Social Post (' + (orig.platform || 'x') + ')',
        originAgent: agentId,
        classification: orig.classification || 'standard',
        riskLevel: orig.risk_level || 'medium',
        budgetImpact: 0,
        brandImpact: 'medium',
        status: 'pending',
        submittedAt: new Date().toISOString(),
        preview: revisedText.substring(0, 120),
        previewImageUrl: _revisedPreviewImage,
        revisionCount: orig.approval.revision_count || 0
      };
      if (aqIdx !== -1) {
        approvalQueue[aqIdx] = aqEntry;
      } else {
        approvalQueue.push(aqEntry);
      }
      if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
      await storage.setState('approvalQueue', approvalQueue);

      context.log('[Heartbeat]', agentId, 'revised action:', orig.id, '| revision #' + orig.approval.revision_count);
      result.taskUpdates.push({ action: 'action-revised', actionId: orig.id, agentId: agentId });

    } else if (action.type === 'comment-task' && action.taskId && action.comment) {
      // Comment dedup: skip if same agent posted a similar comment on this task in last 2 hours
      const targetTask = tasks.find(t => t.id === action.taskId);
      const recentComments = (targetTask && Array.isArray(targetTask.comments)) ? targetTask.comments : [];
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const commentText = String(action.comment).toLowerCase().trim();

      // Guard 1: Max 3 comments per agent per task (prevents spam loops)
      const agentCommentCount = recentComments.filter(c => (c.user || c.author || '') === agentId).length;
      if (agentCommentCount >= 3) {
        context.log('[Heartbeat]', agentId, 'comment-task SKIPPED (agent already has', agentCommentCount, 'comments on task:', action.taskId, ')');
        continue;
      }

      // Guard 2: Similarity dedup — skip if same agent posted 60%+ similar comment in last 2 hours
      const isDuplicate = recentComments.some(c => {
        if ((c.user || c.author || '') !== agentId) return false;
        const ts = c.createdAt || c.created_at || c.timestamp || null;
        if (ts && new Date(ts).getTime() < twoHoursAgo) return false;
        const existing = String(c.text || c.comment || c.body || '').toLowerCase().trim();
        const wordsA = commentText.split(/\s+/);
        const wordsB = new Set(existing.split(/\s+/));
        const overlap = wordsA.filter(w => wordsB.has(w)).length;
        return overlap >= wordsA.length * 0.6;
      });

      // Guard 3: Block follow-up/waiting loop patterns (any agent who already asked about the same thing)
      const isFollowUpLoop = /\b(still waiting|still awaiting|checking in|following up|just checking|any update|provide.*update|firm eta|appendix)\b/i.test(commentText) &&
        recentComments.some(c => {
          if ((c.user || c.author || '') !== agentId) return false;
          const existing = String(c.text || c.comment || c.body || '').toLowerCase();
          return /\b(waiting|awaiting|checking|following|update|appendix)\b/.test(existing);
        });

      // Guard 4: Block Nova re-delegation spam — if Nova already delegated this task (has a comment)
      // and the task is assigned to another agent with active status, no need to re-delegate
      const isDelegationSpam = agentId === 'nova' && targetTask &&
        targetTask.assignee && targetTask.assignee !== 'nova' &&
        (targetTask.status === 'todo' || targetTask.status === 'in-progress' || targetTask.status === 'review') &&
        recentComments.some(c => (c.user || c.author || '') === 'nova' && c.type !== 'system');

      if (isDuplicate || isFollowUpLoop || isDelegationSpam) {
        context.log('[Heartbeat]', agentId, 'comment-task SKIPPED (' + (isDelegationSpam ? 'delegation-spam' : isFollowUpLoop ? 'follow-up loop' : 'duplicate') + ' comment) on task:', action.taskId);
      } else {
        result.taskUpdates.push({
          action: 'comment',
          taskId: action.taskId,
          comment: action.comment,
          agentId: agentId
        });
      }
    } else if (action.type === 'review-task' && action.taskId) {
      // Review: agent reviews another agent's deliverable (costs 1 extra Gemini call)
      const task = tasks.find(t => t.id === action.taskId && t.status === 'review');
      if (task) {
        // CONVERGENCE GUARD: block review if task already has 5+ deliverables — it's looping
        const _rvDelCount = (task.comments || []).filter(c => c.type === 'deliverable').length;
        if (_rvDelCount >= convergenceThresholdFor(task.taskType)) {
          const _rvAlreadyWarned = !!(task._convergenceState && task._convergenceState.notified);
          if (!_rvAlreadyWarned) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: '[SYSTEM] Review blocked: task is convergence-locked (' + _rvDelCount + ' deliverables). CEO must approve or close this task before further review can proceed.',
              agentId: 'system'
            });
            task._convergenceState = Object.assign({}, task._convergenceState, { notified: true, deliverableCount: _rvDelCount });
          }
          context.log('[Heartbeat]', agentId, 'CONVERGENCE BLOCKED review-task on', action.taskId, '—', _rvDelCount, 'deliverables already.');
        } else {
          const review = await reviewTask(context, agent, task, costIntel, siteIntel, socialIntel, execContext);
          result.geminiCalls++;
          if (review) {
            result.taskUpdates.push({
              action: 'review',
              taskId: action.taskId,
              review: review,
              agentId: agentId
            });
          }
        }
      }
    } else if (action.type === 'create-doc' && action.document) {
      // Create a documentation draft — stored in documents store
      const docPayload = action.document;
      const VALID_DOC_KINDS = ['spec', 'runbook', 'release_notes', 'product_brief', 'marketing_post', 'governance'];
      const kind = docPayload.kind || 'product_brief';

      if (docPayload.title && VALID_DOC_KINDS.indexOf(kind) !== -1) {
        // FIX: Block create-doc on social-copy tasks — Scribe must use execute-task for social copy, not create-doc
        // Creating a marketing_post doc for social copy triggers hero image cascade (the entire bug chain)
        if (action.taskId) {
          const _originTask = tasks.find(t => t.id === action.taskId);
          const _isSocialCopyTask = _originTask && (
            (_originTask.tags && _originTask.tags.indexOf('social-copy') !== -1) ||
            ((_originTask.title || '').indexOf('Write social copy for:') === 0)
          );
          if (_isSocialCopyTask) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-doc on social-copy task:', action.taskId, '— use execute-task for social copy, not create-doc');
            if (action.taskId) {
              result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] create-doc blocked on social copy task. Use execute-task to produce your social copy deliverable, not create-doc.', agentId: 'system' });
            }
            continue;
          }
        }

        // GUARD: Require task linkage — no orphan doc creation
        if (!action.taskId) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-doc without task linkage — orphan docs not allowed. Title:', docPayload.title);
          continue;
        }

        // GUARD: Max 1 doc per agent per heartbeat cycle
        const _docsCreatedThisCycle = result.taskUpdates.filter(u => u.action === 'doc-created' && u.agentId === agentId).length;
        if (_docsCreatedThisCycle >= 1) {
          context.log('[Heartbeat]', agentId, 'BLOCKED create-doc — already created', _docsCreatedThisCycle, 'doc(s) this cycle. Title:', docPayload.title);
          result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] Doc creation limit reached (1 per heartbeat cycle). Try again next cycle.', agentId: 'system' });
          continue;
        }

        // Fix 11: Hard caps on unpublished documents by kind
        const existingDocs = (await storage.getState('documents')) || [];
        const INTERNAL_KINDS = ['spec', 'runbook', 'release_notes', 'governance'];
        const EXTERNAL_KINDS = ['marketing_post', 'product_brief'];
        const _isInternalKind = INTERNAL_KINDS.indexOf(kind) !== -1;
        const _isExternalKind = EXTERNAL_KINDS.indexOf(kind) !== -1;

        // Fix 11a: Internal docs — hard cap at 5 unpublished, must be AmbientOS/operational subject matter
        if (_isInternalKind) {
          const _activeInternalDocs = existingDocs.filter(d =>
            INTERNAL_KINDS.indexOf(d.kind) !== -1 &&
            d.status !== 'published' && d.status !== 'rejected' && d.status !== 'archived'
          );
          if (_activeInternalDocs.length >= 5) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-doc (internal) — hard cap reached:', _activeInternalDocs.length, 'active internal docs. Title:', docPayload.title);
            result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] Internal doc cap reached (5 max). Publish or archive existing internal docs first.', agentId: 'system' });
            continue;
          }
          // Subject matter gate: internal docs must be about AmbientOS, system operations, or technical reference
          const _docText = ((docPayload.title || '') + ' ' + (docPayload.content_md || '').substring(0, 500)).toLowerCase();
          const _isAmbientOSTopic = /ambientos|gridops|heartbeat|agent|orchestrat|governance|storage|pipeline|api|function|deployment|architecture|config|escalation|triage|approval|execution|workflow|system|technical|reference|runbook|spec|schema|endpoint/.test(_docText);
          if (!_isAmbientOSTopic) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-doc (internal) — not AmbientOS/operational subject matter. Title:', docPayload.title);
            result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] Internal docs (spec/runbook/governance) are for AmbientOS technical reference only. For marketing/blog content, use kind: marketing_post.', agentId: 'system' });
            continue;
          }
        }

        // Fix 11b: External docs — hard cap at 5 unpublished drafts
        if (_isExternalKind) {
          const _activeExternalDocs = existingDocs.filter(d =>
            EXTERNAL_KINDS.indexOf(d.kind) !== -1 &&
            d.status !== 'published' && d.status !== 'rejected' && d.status !== 'archived'
          );
          if (_activeExternalDocs.length >= 5) {
            context.log('[Heartbeat]', agentId, 'BLOCKED create-doc (external) — hard cap reached:', _activeExternalDocs.length, 'unpublished external docs. Title:', docPayload.title);
            result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[SYSTEM] External doc cap reached (5 max unpublished). CEO must publish or discard existing drafts before new ones can be created.', agentId: 'system' });
            continue;
          }
        }

        // Fix 11b: Fuzzy title dedup — word-overlap similarity blocks near-duplicate titles
        const _proposedDocTitle = (docPayload.title || '').toLowerCase().trim();
        const _proposedWords = _proposedDocTitle.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2);
        const duplicateDoc = existingDocs.find(d => {
          if (!d.title) return false;
          if (d.status === 'rejected' || d.status === 'archived') return false;
          const existTitle = d.title.toLowerCase().trim();
          // Exact match
          if (existTitle === _proposedDocTitle) {
            if (action.taskId && d.taskId && action.taskId !== d.taskId) return false;
            if (action.taskId && !d.taskId) return false;
            return true;
          }
          // Fuzzy match: >75% word overlap blocks creation (raised from 60% to reduce false-positive dedup)
          if (_proposedWords.length >= 3) {
            const _existWords = existTitle.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2);
            if (_existWords.length >= 3) {
              const _overlap = _proposedWords.filter(w => _existWords.indexOf(w) !== -1).length;
              const _similarity = _overlap / Math.max(_proposedWords.length, _existWords.length);
              if (_similarity > 0.75) {
                // Still allow different-task linkage
                if (action.taskId && d.taskId && action.taskId !== d.taskId) return false;
                if (action.taskId && !d.taskId) return false;
                return true;
              }
            }
          }
          return false;
        });
        if (duplicateDoc) {
          context.log('[Heartbeat]', agentId, 'BLOCKED duplicate doc creation:', _proposedDocTitle, '— fuzzy matches existing doc:', duplicateDoc.id, duplicateDoc.title);
          if (action.taskId) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: 'Document already exists with similar title: "' + duplicateDoc.title + '" (id: ' + duplicateDoc.id + '). Use update-doc to revise it instead of creating a duplicate.',
              agentId: agentId
            });
          }
          continue;
        }

        const docId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        // If agent title looks like a task name, extract real title from H1 heading
        const _h1FromContent = (docPayload.content_md || '').match(/^#{1,2}\s+(.+)$/m);
        const _isTaskName = /^(draft|write|create|compose|update)\s/i.test(docPayload.title || '');
        const _docTitle = (_isTaskName && _h1FromContent)
          ? _h1FromContent[1].replace(/\*\*/g, '').trim()
          : docPayload.title;
        // Inherit objective_id and campaign_id from the linked task
        var _docLinkedTask = action.taskId ? tasks.find(function(t) { return t.id === action.taskId; }) : null;
        const doc = {
          id: docId,
          title: _docTitle,
          kind: kind,
          status: 'draft',
          tags: Array.isArray(docPayload.tags) ? docPayload.tags : [],
          created_by: agentId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          content_md: docPayload.content_md || '',
          promote: kind === 'marketing_post' || kind === 'product_brief',
          taskId: action.taskId || null,
          objective_id: _docLinkedTask ? _docLinkedTask.objective_id || null : null,
          campaign_id: _docLinkedTask ? _docLinkedTask.campaign_id || null : null,
          source: { action_id: null, task_id: action.taskId || null }
        };

        // ── CONTENT QUALITY GATE (marketing_post / product_brief only) ──
        // Runs BEFORE doc is stored so failed content never becomes a durable artifact.
        // Fail-closed only on Haiku pass:false + confidence>=70. Fail-open on infra errors
        // (null result) and too-short content — stamps the doc so the backstop knows the gate tried.
        if (_isExternalKind) {
          var _docQgResult = null;
          var _docQgReason = null;
          if (doc.content_md && doc.content_md.length > 40) {
            try {
              var _docQgText = (doc.title || '') + '\n\n' + doc.content_md;
              _docQgResult = await _validateContentQuality(_docQgText, 'blog-' + kind, context);
              if (_docQgResult) {
                context.log('[QualityGate] DOC', kind, doc.id, 'pass:', _docQgResult.pass, 'confidence:', _docQgResult.confidence, 'issues:', (_docQgResult.issues || []).length);
              } else {
                _docQgReason = 'haiku-unavailable';
              }
            } catch (_docQgErr) {
              context.log('[QualityGate] DOC error (fail-open):', String(_docQgErr).substring(0, 150));
              _docQgReason = 'haiku-unavailable';
            }
          } else {
            _docQgReason = 'content-too-short';
          }
          // Fail-closed branch: Haiku rejected with high confidence — do not store, do not stamp.
          if (_docQgResult && !_docQgResult.pass && (_docQgResult.confidence || 0) >= 70) {
            context.log('[QualityGate] DOC REJECTED', kind, doc.id, '—', (_docQgResult.issues || []).slice(0, 3).join('; ').substring(0, 300));
            if (action.taskId) {
              result.taskUpdates.push({
                action: 'comment', taskId: action.taskId, agentId: 'system',
                comment: '[QUALITY GATE] Blog draft rejected — rewrite required. Issues:\n- ' + (_docQgResult.issues || []).slice(0, 8).join('\n- ') + '\n\nRewrite the post addressing each issue, then resubmit via create-doc.'
              });
            }
            try {
              await logEvent('policy-violation', agentId, 'Quality gate rejected blog draft', cycleId, {
                runId: cycleId, gate: 'quality_gate', reason: 'haiku_rejection_doc',
                kind: kind, docTitle: doc.title, confidence: _docQgResult.confidence || 0,
                issueCount: (_docQgResult.issues || []).length,
                issuesPreview: ((_docQgResult.issues || []).slice(0, 5).join('; ')).substring(0, 400)
              });
            } catch (_qgDocLogErr) { /* non-fatal */ }
            continue; // skip docsStore.push — doc never created
          }
          // Stamp: either the real Haiku verdict, or a fail-open marker so the backstop passes through.
          if (_docQgResult) {
            doc.qualityGate = {
              pass: !!_docQgResult.pass,
              confidence: _docQgResult.confidence || 0,
              issues: _docQgResult.issues || [],
              model: 'claude-haiku-4-5-20251001',
              checkedAt: new Date().toISOString(),
              rulesChecked: ['factual-accuracy', 'hallucinated-features', 'fabricated-statistics', 'tone-violations', 'brand-violations']
            };
          } else {
            doc.qualityGate = {
              pass: true,
              confidence: 0,
              issues: [],
              model: 'claude-haiku-4-5-20251001',
              checkedAt: new Date().toISOString(),
              failOpen: true,
              failOpenReason: _docQgReason || 'unknown'
            };
            context.log('[QualityGate] DOC fail-open stamp applied:', kind, doc.id, 'reason:', _docQgReason);
          }
        }

        const docsStore = (await storage.getState('documents')) || [];
        docsStore.push(doc);
        if (docsStore.length > 500) docsStore.splice(0, docsStore.length - 500);
        await storage.setState('documents', docsStore);

        context.log('[Heartbeat]', agentId, 'created doc draft:', doc.id, doc.title);
        result.taskUpdates.push({ action: 'doc-created', documentId: doc.id, agentId: agentId });

        // Link doc back to the originating task: add comment + move to review
        const _isVisualKind = ['marketing_post', 'product_brief'].indexOf(kind) !== -1;
        if (action.taskId) {
          result.taskUpdates.push({
            action: 'comment',
            taskId: action.taskId,
            comment: _isVisualKind
              ? 'Document created: "' + doc.title + '" (id: ' + doc.id + ', kind: ' + kind + '). Awaiting hero image from Pixel before submitting for publish.'
              : 'Document created: "' + doc.title + '" (id: ' + doc.id + ', kind: ' + kind + '). Submitting for CEO approval.',
            agentId: agentId
          });
          // Only move if task isn't already in a later stage (prevents race: execute→review then create-doc→in-progress)
          const _cdCurrentTask = tasks.find(t => t.id === action.taskId);
          const _cdCurrentStatus = _cdCurrentTask ? _cdCurrentTask.status : '';
          const _cdTargetStatus = _isVisualKind ? 'in-progress' : 'review';
          const _cdAlreadyAdvanced = (_cdCurrentStatus === 'review' || _cdCurrentStatus === 'done');
          if (!_cdAlreadyAdvanced) {
            result.taskUpdates.push({
              action: 'move',
              taskId: action.taskId,
              newStatus: _cdTargetStatus
            });
          } else {
            context.log('[Heartbeat]', agentId, 'create-doc: skipping status move — task', action.taskId, 'already in', _cdCurrentStatus, '(would have moved to', _cdTargetStatus + ')');
          }
        }

        // Visual doc kinds: auto-create Pixel hero image task instead of auto-submitting for publish
        // Doc stays in draft until Pixel generates the hero image, then Scribe submits in a future heartbeat
        const VISUAL_DOC_KINDS = ['marketing_post', 'product_brief'];
        context.log('[Heartbeat] HERO-DIAG:', agentId, 'doc kind:', kind, 'isVisual:', VISUAL_DOC_KINDS.indexOf(kind) !== -1, 'docId:', doc.id, 'taskId:', action.taskId || 'NONE');
        if (action.taskId) {
          result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[DIAG] create-doc fired — kind: ' + kind + ', isVisual: ' + (VISUAL_DOC_KINDS.indexOf(kind) !== -1) + ', docId: ' + doc.id, agentId: 'system' });
        }
        // SPAWN GUARD: do not spawn hero tasks from auto-created source tasks (prevents auto→auto chains)
        const _cdSourceTask = action.taskId ? tasks.find(t => t.id === action.taskId) : null;
        const _cdSourceAutoCreated = _cdSourceTask && _cdSourceTask.tags && _cdSourceTask.tags.indexOf('auto-created') !== -1;
        if (VISUAL_DOC_KINDS.indexOf(kind) !== -1 && agentId === 'scribe' && !_cdSourceAutoCreated) {
          // Only Scribe-created visual docs trigger hero image tasks (prevents ops/engineering docs from spawning hero tasks)
          // FIX 5: Stronger dedup — check by title substring match, not just exact title or doc ID
          // Prevents multiple hero tasks when the same blog post has multiple doc records
          const _heroTaskTitle = 'Generate hero image for: ' + stripTaskPrefixes(doc.title);
          const _heroNormTitle = doc.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
          const _heroTaskExists = tasks.some(t => {
            if (t.assignee !== 'pixel' || t.status === 'done') return false;
            if (t.title === _heroTaskTitle) return true;
            if (t.description && t.description.indexOf(doc.id) !== -1) return true;
            // Fuzzy: any active Pixel hero task whose title contains the same blog title words
            if ((t.title || '').indexOf('Generate hero image for:') === 0) {
              const _existHeroNorm = t.title.replace('Generate hero image for: ', '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
              if (_existHeroNorm === _heroNormTitle) return true;
              // Check if one contains the other (handles "Write our first blog post: Hello World" vs "Hello World")
              if (_heroNormTitle.length > 10 && (_existHeroNorm.indexOf(_heroNormTitle) !== -1 || _heroNormTitle.indexOf(_existHeroNorm) !== -1)) return true;
            }
            return false;
          });

          context.log('[Heartbeat] HERO-DIAG:', agentId, 'heroTaskExists:', _heroTaskExists, 'heroTitle:', _heroTaskTitle);
          if (action.taskId) {
            result.taskUpdates.push({ action: 'comment', taskId: action.taskId, comment: '[DIAG] hero dedup check — exists: ' + _heroTaskExists + ', looking for: ' + _heroTaskTitle, agentId: 'system' });
          }
          if (!_heroTaskExists) {
            // Create a task for Pixel to generate the hero image
            const heroTask = {
              id: 'task_' + Date.now() + '_hero_' + Math.random().toString(36).substr(2, 4),
              title: _heroTaskTitle,
              description: 'Generate a hero image for the blog post "' + doc.title + '".\nDocument ID: ' + doc.id + '\nUse generate-image with purpose "blog_header" and attachTo: { type: "document", id: "' + doc.id + '" }.\nChoose an appropriate preset based on the content tone.',
              taskType: 'design_asset',
              status: 'todo',
              priority: action.task && action.task.priority ? action.task.priority : 'high',
              dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
              assignee: 'pixel',
              source: 'heartbeat',
              created_by: 'system',
              parent_task_id: action.taskId || null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              campaign_id: action.campaign_id || null,
              objective_id: action.objective_id || (action.task && action.task.objective_id) || null,
              tags: ['hero-image', 'auto-created', 'visual-workflow'],
              comments: [{
                id: 'cmt-hero-' + Date.now(),
                author: 'nova',
                text: 'Pixel, generate a hero image for the blog post "' + doc.title + '" (doc: ' + doc.id + ', kind: ' + kind + '). Use generate-image with purpose blog_header and attachTo the document. Choose a preset that matches the content tone.',
                type: 'system',
                createdAt: new Date().toISOString()
              }]
            };
            tasks.push(heroTask);
            context.log('[Heartbeat]', agentId, 'AUTO-CREATED Pixel hero image task:', heroTask.id, 'for doc:', doc.id);
          } else {
            context.log('[Heartbeat]', agentId, 'Pixel hero image task already exists for doc:', doc.id, '— skipping auto-create');
          }

          // Mark doc as awaiting hero image
          doc.awaiting_hero_image = true;
          doc.updated_at = new Date().toISOString();
          const _awIdx = docsStore.findIndex(d => d.id === docId);
          if (_awIdx !== -1) docsStore[_awIdx] = doc;
          await storage.setState('documents', docsStore);

          // Comment on the originating task
          if (action.taskId) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: 'Doc created but NOT submitted for publish yet — waiting for Pixel to generate a hero image (doc: ' + doc.id + '). Publish will happen after the hero image is attached.',
              agentId: 'system'
            });
          }

          context.log('[Heartbeat]', agentId, 'visual doc created — deferred publish, awaiting Pixel hero image:', doc.id, doc.title);
        } else {
          // Internal doc kinds (spec, runbook, release_notes, governance) — wiki-style, immediately available
          doc.visibility = 'internal';
          doc.updated_at = new Date().toISOString();
          const dIdx = docsStore.findIndex(d => d.id === docId);
          if (dIdx !== -1) docsStore[dIdx] = doc;
          await storage.setState('documents', docsStore);

          context.log('[Heartbeat]', agentId, 'internal doc saved to wiki:', doc.id, doc.title);
          result.taskUpdates.push({ action: 'doc-created', documentId: doc.id, agentId: agentId });

          if (action.taskId) {
            result.taskUpdates.push({
              action: 'comment',
              taskId: action.taskId,
              comment: 'Document "' + doc.title + '" (id: ' + doc.id + ', kind: ' + kind + ') added to the Document Center wiki.',
              agentId: agentId
            });
          }
        }
      }
    } else if (action.type === 'update-doc' && action.documentId) {
      // Update an existing document's content or metadata
      const docsStore = (await storage.getState('documents')) || [];
      const docIdx = docsStore.findIndex(d => d.id === action.documentId);

      if (docIdx !== -1) {
        const doc = docsStore[docIdx];
        const updates = action.updates || {};
        if (updates.content_md) doc.content_md = updates.content_md;
        if (updates.title) {
          doc.title = updates.title;
          doc.slug = updates.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        }
        if (updates.tags) doc.tags = updates.tags;
        if (updates.append_md && doc.content_md) {
          doc.content_md = doc.content_md + '\n\n' + updates.append_md;
        }
        doc.updated_at = new Date().toISOString();
        doc.last_edited_by = agentId;
        docsStore[docIdx] = doc;
        await storage.setState('documents', docsStore);

        // If doc is published internally, also update the publishedDocs store
        if (doc.visibility === 'internal' && doc.status === 'published' && doc.slug) {
          const pubStore = (await storage.getState('publishedDocs')) || [];
          const pubIdx = pubStore.findIndex(p => p.documentId === doc.id);
          if (pubIdx !== -1) {
            pubStore[pubIdx].content_md = doc.content_md;
            pubStore[pubIdx].title = doc.title;
            pubStore[pubIdx].tags = doc.tags || [];
            pubStore[pubIdx].updated_at = doc.updated_at;
            if (updates.title) {
              pubStore[pubIdx].slug = doc.slug;
              pubStore[pubIdx].target_path = '/docs/published/' + doc.slug;
              pubStore[pubIdx].public_url = '/docs/published/' + doc.slug;
            }
            await storage.setState('publishedDocs', pubStore);
          }
        }

        context.log('[Heartbeat]', agentId, 'updated doc:', doc.id, doc.title);
        result.taskUpdates.push({ action: 'doc-updated', documentId: doc.id, agentId: agentId });
      } else {
        context.log('[Heartbeat]', agentId, 'update-doc failed — doc not found:', action.documentId);
      }

    } else if (action.type === 'submit-for-publish' && action.documentId) {
      // Submit a document for human approval + publish
      // GUARDRAIL: No agent can directly publish — this only creates a publish_document action
      // that requires CEO/human approval before execution.
      const docsStore = (await storage.getState('documents')) || [];
      const docIdx = docsStore.findIndex(d => d.id === action.documentId);

      if (docIdx === -1) {
        context.log('[Heartbeat]', agentId, 'WARN: submit-for-publish skipped — doc not found:', action.documentId);
        continue;
      }

      if (docIdx !== -1) {
        const doc = docsStore[docIdx];

        // Only drafts or review docs can be submitted for publish
        if (doc.status === 'draft' || doc.status === 'review') {
          // Dedup: skip if a pending publish action already exists for this document
          const existingActs = (await storage.getState('actions')) || [];
          const hasPendingPub = existingActs.some(a => a.type === 'publish_document' && a.payload && a.payload.documentId === doc.id && a.approval && a.approval.status === 'pending');
          if (hasPendingPub) {
            context.log('[Heartbeat] Skipping duplicate submit-for-publish for doc:', doc.id, doc.title);
            continue;
          }

          // Hard guardrail: BLOCK submit-for-publish on visual doc kinds without hero image
          const VISUAL_KINDS = ['marketing_post', 'product_brief'];
          if (VISUAL_KINDS.indexOf(doc.kind) !== -1 && !doc.hero_image_asset_id) {
            context.log('[Heartbeat]', agentId, 'BLOCKED submit-for-publish on', doc.kind, 'doc without hero_image_asset_id:', doc.id, doc.title, '— waiting for Pixel hero image');
            docsStore[docIdx].missing_hero_image = true;
            await storage.setState('documents', docsStore);
            // Notify via task comment
            if (action.taskId) {
              result.taskUpdates.push({
                action: 'comment',
                taskId: action.taskId,
                comment: 'Publish BLOCKED: doc "' + doc.title + '" (' + doc.id + ') is a ' + doc.kind + ' and has no hero image yet. Waiting for Pixel to generate one. Submit again after hero_image_asset_id is set.',
                agentId: 'system'
              });
            }
            continue;
          }

          // Doc status write moved to after action + AQ writes (see below).
          // This reduces orphan risk: if the function crashes during action/AQ creation,
          // the doc stays in draft/review and can be retried.

          // Generate slug from title
          const slug = doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

          // Route based on doc kind: marketing_post/product_brief → public blog, others → internal docs
          const PUBLIC_KINDS = ['marketing_post', 'product_brief'];
          const isPublic = PUBLIC_KINDS.indexOf(doc.kind) !== -1;
          const pubTargetPath = isPublic ? '/blog/' + slug : '/docs/published/' + slug;
          const pubPublicUrl = isPublic ? '/blog/' + slug : '/docs/published/' + slug;

          // Create publish_document action (requires CEO approval)
          // Public kinds (blog) get sentence-cased title+body in the review snapshot so the
          // CEO's approval-queue preview matches the published output — no raw lowercase in review.
          var _pubIsPublic = doc.kind === 'marketing_post' || doc.kind === 'product_brief';
          const publishAction = {
            id: 'act_pub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            created_at: new Date().toISOString(),
            created_by: agentId,
            type: 'publish_document',
            platform: 'site',
            payload: {
              documentId: doc.id,
              title: _pubIsPublic ? capitalizeSentences(doc.title) : doc.title,
              slug: slug,
              kind: doc.kind,
              content_md: _pubIsPublic ? capitalizeSentencesLongform(doc.content_md) : doc.content_md,
              target_path: pubTargetPath,
              public_url: pubPublicUrl,
              hero_image_asset_id: doc.hero_image_asset_id || null,
              hero_image_url: null, // resolved below after imageAssets lookup
              missing_hero_image: (!doc.hero_image_asset_id && VISUAL_KINDS.indexOf(doc.kind) !== -1) || false
            },
            classification: 'executive_required',
            requires_ceo_approval: true,
            risk_level: 'medium',
            brand_impact: 'medium',
            budget_impact: 0,
            approval: {
              status: 'pending',
              approved_by: null,
              approved_at: null,
              decision_note: null
            },
            execution: {
              status: 'pending',
              started_at: null,
              finished_at: null,
              attempts: 0,
              last_error: null,
              receipt: null
            },
            // Legacy compat fields
            action_type: 'publish_document',
            action_category: 'content',
            execution_status: 'pending',
            origin_agent: agentId,
            action_payload: { documentId: doc.id, title: doc.title, slug: slug },
            requires_approval: true,
            is_irreversible: true,
            bundle_id: null
          };

          // Save action to actions store
          const actionsStore = (await storage.getState('actions')) || [];
          actionsStore.push(publishAction);
          if (actionsStore.length > 500) actionsStore.splice(0, actionsStore.length - 500);
          await storage.setState('actions', actionsStore);

          // v2.4.4: Register draft artifact for URL resolution
          const sfpArtifactId = 'art_' + Date.now() + '_' + slug;
          const sfpArtifacts = (await storage.getState('ap_artifacts')) || [];
          sfpArtifacts.push({
            id: sfpArtifactId,
            type: 'article',
            title: doc.title,
            slug: slug,
            url: null,
            status: 'draft',
            createdAt: new Date().toISOString(),
            publishedAt: null,
            source: { type: 'submit-for-publish', agentId: agentId, taskId: action.taskId || null },
            actionId: publishAction.id,
            documentId: doc.id
          });
          if (sfpArtifacts.length > 200) sfpArtifacts.splice(0, sfpArtifacts.length - 200);
          await storage.setState('ap_artifacts', sfpArtifacts);
          context.log('[Heartbeat] Registered draft artifact:', sfpArtifactId, 'for submit-for-publish action:', publishAction.id);

          // Resolve hero image URL from imageAssets store (for approval queue + drawer preview)
          let _heroImageUrl = null;
          if (doc.hero_image_asset_id) {
            try {
              const _imgAssets = (await storage.getState('imageAssets')) || [];
              const _heroAsset = _imgAssets.find(a => a.id === doc.hero_image_asset_id);
              if (_heroAsset && _heroAsset.url) _heroImageUrl = _heroAsset.url;
            } catch (_heroErr) { /* non-fatal */ }
          }
          // Backfill resolved URL into action payload so actions drawer can render it
          if (_heroImageUrl) {
            publishAction.payload.hero_image_url = _heroImageUrl;
            // Re-save action with resolved hero image URL (action was persisted before URL resolution)
            const _actStore2 = (await storage.getState('actions')) || [];
            const _actIdx2 = _actStore2.findIndex(x => x.id === publishAction.id);
            if (_actIdx2 !== -1) { _actStore2[_actIdx2] = publishAction; await storage.setState('actions', _actStore2); }
          }

          // Add to CEO approval queue
          const approvalQueue = (await storage.getState('approvalQueue')) || [];
          approvalQueue.push({
            id: 'aq-' + publishAction.id,
            kind: 'action',
            actionType: 'publish_document',
            action_id: publishAction.id,
            taskId: action.taskId || null,
            taskTitle: 'Publish: ' + doc.title,
            originAgent: agentId,
            classification: 'executive_required',
            riskLevel: 'medium',
            budgetImpact: 0,
            brandImpact: 'medium',
            status: 'pending',
            timestamp: publishAction.created_at,
            preview: (doc.content_md || '').substring(0, 120),
            documentId: doc.id,
            slug: slug,
            docKind: doc.kind,
            artifactId: sfpArtifactId,
            heroImageUrl: _heroImageUrl,
            heroImageAssetId: doc.hero_image_asset_id || null
          });
          if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
          await storage.setState('approvalQueue', approvalQueue);

          // Update doc status AFTER action + AQ are persisted.
          // If we crash here, the doc stays draft but action + AQ exist,
          // which is recoverable (orphan recovery catches this, and CEO can still approve).
          docsStore[docIdx].status = 'ready_for_approval';
          docsStore[docIdx].updated_at = new Date().toISOString();
          docsStore[docIdx].submitted_by = agentId;
          await storage.setState('documents', docsStore);

          // Audit log
          const auditLog = (await storage.getState('actionAuditLog')) || [];
          auditLog.push({
            id: 'alog-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            type: 'publish-requested',
            data: {
              actionId: publishAction.id,
              documentId: doc.id,
              title: doc.title,
              slug: slug,
              submittedBy: agentId,
              taskId: action.taskId || null
            },
            timestamp: new Date().toISOString()
          });
          if (auditLog.length > 500) auditLog.splice(0, auditLog.length - 500);
          await storage.setState('actionAuditLog', auditLog);

          // Governance log
          const govLog = (await storage.getState('governanceLog')) || [];
          govLog.push({
            id: 'gov-' + Date.now(),
            type: 'publish-requested',
            data: {
              actionId: publishAction.id,
              documentId: doc.id,
              title: doc.title,
              agent: agentId
            },
            timestamp: new Date().toISOString()
          });
          govLog.sort(function (a, b) { return String(a.timestamp || '').localeCompare(String(b.timestamp || '')); });
          // Was a hardcoded 200-trim — the tightest of ~10 governanceLog writers, so it
          // silently pinned the whole log to 200 entries (~3 days) while everything else
          // respected the 500 constant. Weekly audits were undercounting because of it.
          if (govLog.length > MAX_GOVERNANCE_LOG_ENTRIES) govLog.splice(0, govLog.length - MAX_GOVERNANCE_LOG_ENTRIES);
          await storage.setState('governanceLog', govLog);

          context.log('[Heartbeat]', agentId, 'submitted doc for publish:', doc.id, doc.title, '→ action:', publishAction.id);
          result.taskUpdates.push({ action: 'publish-requested', actionId: publishAction.id, documentId: doc.id, agentId: agentId });
        } else {
          context.log('[Heartbeat]', agentId, 'cannot submit doc for publish — status is', doc.status);
        }
      }
    } else if (action.type === 'create-content-package' && action.content) {
      // Agent-initiated image content generation — routes through approval queue
      // GATE: only Echo (marketing visuals) and Pixel (design assets) can generate content
      const CONTENT_ALLOWED_AGENTS = ['echo', 'pixel'];
      if (CONTENT_ALLOWED_AGENTS.indexOf(agentId) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-content-package (only Echo/Pixel can generate images)');
        continue;
      }

      // Guardrail: max 1 content generation per heartbeat per agent
      if ((result.contentGenerates || 0) >= GUARDRAILS.maxContentGeneratesPerCyclePerAgent) {
        context.log('[Heartbeat]', agentId, 'max content generates reached, skipping');
        continue;
      }

      const cp = action.content;
      const cpTopic = (cp.topic || '').trim();
      const cpGoal = (cp.goal || '').trim();
      if (!cpTopic || cpTopic.length < 3 || !cpGoal || cpGoal.length < 3) {
        context.log('[Heartbeat]', agentId, 'create-content-package SKIPPED: topic/goal too short');
        continue;
      }

      // At most ONE pending content.package per agent. Images are generated (paid API
      // calls) BEFORE approval, so an unattended queue turns the design-gap prompt into
      // an hourly generation loop — 17 packages piled up 07-23→07-25 while the gap
      // detector (which only counts tasks) kept nagging. Same idiom as repeat_promo_url.
      const _cpAq = (await storage.getState('approvalQueue')) || [];
      const _cpPendingMine = _cpAq.filter(function (q) {
        return (q.kind === 'content.package' || q.type === 'content.package') &&
          q.status === 'pending' && q.createdBy === agentId;
      });
      if (_cpPendingMine.length > 0) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-content-package:', _cpPendingMine.length, 'package(s) already pending CEO approval');
        await logEvent('policy-violation', agentId, 'Content package blocked — prior package awaiting CEO decision', cycleId,
          { runId: cycleId, gate: 'content_package_pending', pendingCount: _cpPendingMine.length, topic: cpTopic.substring(0, 80) });
        continue;
      }

      // Load config defaults
      let _ceConfig = null;
      try { _ceConfig = await imageEngine.loadContentEngineConfig(); } catch (e) { /* use hardcoded defaults */ }

      const cpPreset = (cp.preset || (_ceConfig && _ceConfig.defaultPreset) || 'ap-quiet-editorial').trim();
      let cpOutputs = cp.outputs || (_ceConfig && _ceConfig.defaultOutputs) || ['x_image'];
      const cpVariations = Math.min(Math.max(parseInt(cp.variations) || 1, 1), 2); // agents capped at 2 variations

      // Validate preset
      if (!imageEngine.PRESETS || !imageEngine.PRESETS[cpPreset]) {
        context.log('[Heartbeat]', agentId, 'create-content-package SKIPPED: invalid preset:', cpPreset);
        continue;
      }

      // Validate & filter outputs
      if (imageEngine.PURPOSES) {
        cpOutputs = cpOutputs.filter(function (o) { return !!imageEngine.PURPOSES[o]; });
      }
      if (cpOutputs.length === 0) cpOutputs = ['x_image'];
      // Cap agent output types to 3 max
      if (cpOutputs.length > 3) cpOutputs = cpOutputs.slice(0, 3);

      // Usage limit check
      const accountId = 'ambientpixels-internal';
      try {
        const limitCheck = await imageEngine.checkUsageLimits(accountId);
        if (!limitCheck.allowed) {
          context.log('[Heartbeat]', agentId, 'create-content-package BLOCKED: usage limit exceeded');
          continue;
        }
      } catch (limErr) {
        context.log('[Heartbeat]', agentId, 'create-content-package: usage check failed, proceeding:', limErr.message);
      }

      context.log('[Heartbeat]', agentId, 'generating content package:', cpTopic, '| preset:', cpPreset, '| outputs:', cpOutputs.join(','), '| variations:', cpVariations);
      const genStartMs = Date.now();

      // Create brief
      const cpBriefId = 'brief_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const cpBrief = {
        id: cpBriefId,
        createdAt: new Date().toISOString(),
        createdBy: agentId,
        source: 'heartbeat',
        topic: cpTopic,
        goal: cpGoal,
        preset: cpPreset,
        outputs: cpOutputs,
        variations: cpVariations,
        status: 'generating',
        directiveId: (cp.directiveId || '').trim() || null,
        objectiveId: (cp.objectiveId || '').trim() || null
      };
      await imageEngine.saveBrief(cpBrief);

      // Generate images
      const cpPackageId = 'pkg_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
      const cpAllOutputs = {};
      const cpThumbUrls = [];
      let cpSuccessCount = 0;
      let cpFailedCount = 0;

      for (let v = 0; v < cpVariations; v++) {
        for (let i = 0; i < cpOutputs.length; i++) {
          const outputType = cpOutputs[i];
          const outputKey = cpVariations > 1 ? outputType + '_v' + (v + 1) : outputType;
          const variationNum = v + 1;
          const prompt = imageEngine.buildPrompt({
            topic: cpTopic, goal: cpGoal, preset: cpPreset,
            outputType: outputType, variation: variationNum
          });
          try {
            context.log('[Heartbeat]', agentId, 'generating', outputKey);
            const genResult = await imageEngine.generateImage({
              topic: cpTopic, goal: cpGoal, preset: cpPreset,
              outputType: outputType, variation: variationNum,
              jobId: cpPackageId + '_' + outputKey
            });
            cpAllOutputs[outputKey] = {
              status: 'success', outputType: outputType, variation: variationNum,
              size: genResult.size, imageUrl: genResult.imageUrl, thumbUrl: genResult.thumbUrl,
              metaUrl: genResult.metaUrl, model: genResult.model, bytes: genResult.bytes, promptUsed: prompt
            };
            cpThumbUrls.push(genResult.thumbUrl);
            cpSuccessCount++;
          } catch (genErr) {
            context.log.error('[Heartbeat]', agentId, 'content gen failed:', outputKey, genErr.message);
            cpAllOutputs[outputKey] = {
              status: 'failed', outputType: outputType, variation: variationNum,
              error: genErr.message, promptUsed: prompt
            };
            cpFailedCount++;
          }
        }
      }

      // Total failure
      if (cpSuccessCount === 0) {
        cpBrief.status = 'failed';
        cpBrief.updatedAt = new Date().toISOString();
        await imageEngine.saveBrief(cpBrief);
        context.log('[Heartbeat]', agentId, 'content package generation FAILED (all images failed)');
        continue;
      }

      // Save package
      const cpDurationMs = Date.now() - genStartMs;
      const cpOverallStatus = cpFailedCount === 0 ? 'pending_approval' : 'partial_success';
      const cpPkg = {
        id: cpPackageId, briefId: cpBriefId,
        createdAt: new Date().toISOString(), generatedBy: agentId, createdBy: agentId,
        agentRole: agent.role, source: 'heartbeat', createdVia: 'heartbeat',
        directiveId: cpBrief.directiveId, objectiveId: cpBrief.objectiveId,
        accountId: accountId, accountType: 'internal',
        engineVersion: imageEngine.ENGINE_VERSION, preset: cpPreset,
        presetVersion: imageEngine.getPresetVersion(cpPreset),
        variations: cpVariations, outputs: cpAllOutputs,
        promptSummary: ('Topic: ' + cpTopic + ' — ' + cpGoal + ' (' + cpPreset + ')').substring(0, 140),
        status: cpOverallStatus, successCount: cpSuccessCount, failedCount: cpFailedCount,
        durationMs: cpDurationMs, estimatedCost: imageEngine.estimateCost(cpSuccessCount),
        model: imageEngine.GEMINI_IMAGE_MODEL, provider: imageEngine.GEMINI_IMAGE_PROVIDER
      };
      const cpPackageUrl = await imageEngine.savePackage(cpPkg);

      // Update brief
      cpBrief.status = cpOverallStatus;
      cpBrief.packageId = cpPackageId;
      cpBrief.updatedAt = new Date().toISOString();
      await imageEngine.saveBrief(cpBrief);

      // Submit to approval queue
      const cpSuccessImageUrls = [];
      Object.keys(cpAllOutputs).forEach(function (k) {
        if (cpAllOutputs[k].status === 'success' && cpAllOutputs[k].imageUrl) cpSuccessImageUrls.push(cpAllOutputs[k].imageUrl);
      });

      const cpApprovalItem = {
        id: 'aq-' + cpPackageId, kind: 'content.package', type: 'content.package',
        title: 'Content Package — ' + cpTopic,
        subtitle: cpSuccessCount + ' image' + (cpSuccessCount !== 1 ? 's' : '') + (cpFailedCount > 0 ? ', ' + cpFailedCount + ' failed' : '') + ' · ' + cpPreset + ' · by ' + agentId,
        status: 'pending', createdAt: new Date().toISOString(), createdBy: agentId,
        source: 'heartbeat', briefId: cpBriefId, packageId: cpPackageId,
        preset: cpPreset, goal: cpGoal, successCount: cpSuccessCount, failedCount: cpFailedCount,
        preview: {
          thumbs: cpThumbUrls.slice(0, 4), preset: cpPreset, goal: cpGoal,
          outputTypes: cpOutputs, successCount: cpSuccessCount, failedCount: cpFailedCount
        },
        links: {
          packageUrl: cpPackageUrl, packageViewUrl: '/modules/company/content-engine.html?pkg=' + cpPackageId,
          imageUrls: cpSuccessImageUrls
        }
      };

      const cpQueue = (await storage.getState('approvalQueue')) || [];
      cpQueue.push(cpApprovalItem);
      if (cpQueue.length > 200) cpQueue = cpQueue.slice(-200);
      await storage.setState('approvalQueue', cpQueue);

      // Write usage record
      try {
        await imageEngine.writeUsageRecord({
          accountId: accountId, accountType: 'internal', packageId: cpPackageId,
          timestamp: cpPkg.createdAt, engineVersion: imageEngine.ENGINE_VERSION,
          preset: cpPreset, presetVersion: imageEngine.getPresetVersion(cpPreset),
          formatsRequested: cpOutputs, variations: cpVariations,
          imagesGenerated: cpSuccessCount, model: imageEngine.GEMINI_IMAGE_MODEL,
          durationMs: cpDurationMs, estimatedCost: imageEngine.estimateCost(cpSuccessCount),
          status: cpOverallStatus === 'partial_success' ? 'partial' : 'success',
          createdBy: agentId, agentRole: agent.role, source: 'heartbeat'
        });
      } catch (usageErr) { context.log.warn('[Heartbeat] Usage record write failed (non-fatal):', usageErr.message); }

      // Append to gallery index
      try {
        await imageEngine.appendToIndex({
          packageId: cpPackageId, briefId: cpBriefId, preset: cpPreset, topic: cpTopic,
          createdAt: cpPkg.createdAt, status: cpOverallStatus,
          successCount: cpSuccessCount, failedCount: cpFailedCount,
          thumbs: cpThumbUrls.slice(0, 4), outputTypes: cpOutputs, variations: cpVariations,
          createdBy: agentId, source: 'heartbeat'
        });
      } catch (idxErr) { context.log.warn('[Heartbeat] Gallery index append failed (non-fatal):', idxErr.message); }

      // Auto-advance parent task to review if taskId provided
      if (action.taskId) {
        const taskIdx = tasks.findIndex(t => t.id === action.taskId);
        if (taskIdx !== -1 && tasks[taskIdx].status !== 'done' && tasks[taskIdx].status !== 'review') {
          tasks[taskIdx].status = 'review';
          tasks[taskIdx].updatedAt = new Date().toISOString();
          if (!tasks[taskIdx].comments) tasks[taskIdx].comments = [];
          tasks[taskIdx].comments.push({
            id: 'cmt-' + Date.now(), author: agentId,
            text: 'Content package created (' + cpSuccessCount + ' images, preset: ' + cpPreset + '). Submitted for CEO approval (package: ' + cpPackageId + ').',
            type: 'deliverable', createdAt: new Date().toISOString()
          });
          context.log('[Heartbeat]', agentId, 'auto-advanced task', action.taskId, 'to review (content package created)');
        }
      }

      result.contentGenerates = (result.contentGenerates || 0) + 1;
      context.log('[Heartbeat]', agentId, 'content package created:', cpPackageId, cpSuccessCount, 'ok,', cpFailedCount, 'failed, duration:', cpDurationMs + 'ms');
      result.taskUpdates.push({ action: 'content-package-created', packageId: cpPackageId, agentId: agentId, taskId: action.taskId || null });

    } else if (action.type === 'generate-image' && action.image) {
      // Single image generation for blog headers, inline illustrations, social media assets
      // Allowed agents: echo, pixel, scribe (scribe can generate blog headers)
      const IMG_ALLOWED_AGENTS = ['echo', 'pixel', 'scribe'];
      if (IMG_ALLOWED_AGENTS.indexOf(agentId) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED generate-image (only echo/pixel/scribe)');
        continue;
      }

      // Guardrail: shares the content generates limit with create-content-package
      if ((result.contentGenerates || 0) >= GUARDRAILS.maxContentGeneratesPerCyclePerAgent) {
        context.log('[Heartbeat]', agentId, 'max content generates reached, skipping generate-image');
        continue;
      }

      const img = action.image;
      const imgTopic = (img.topic || '').trim();
      const imgGoal = (img.goal || '').trim();
      const imgPurpose = (img.purpose || '').trim(); // blog_header, inline_illustration, social_media
      if (!imgTopic || imgTopic.length < 3 || !imgGoal || imgGoal.length < 3) {
        context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: topic/goal too short');
        continue;
      }

      const VALID_PURPOSES = ['blog_header', 'inline_illustration', 'social_media'];
      if (!imgPurpose || VALID_PURPOSES.indexOf(imgPurpose) === -1) {
        context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: invalid purpose:', imgPurpose);
        continue;
      }

      // Load config defaults
      let _imgCeConfig = null;
      try { _imgCeConfig = await imageEngine.loadContentEngineConfig(); } catch (e) { /* defaults */ }

      let imgPreset = (img.preset || (_imgCeConfig && _imgCeConfig.defaultPreset) || 'ap-quiet-editorial').trim();
      // Blog heroes always use the house editorial preset. The per-product preset map is
      // for social/campaign assets — product inference on a meta/company post shipped an
      // off-brand ap-corporate-tech hero (img_1784930449822, 2026-07-24). All 20 published
      // posts use the house style; change BLOG_HEADER_PRESET only on CEO direction.
      const BLOG_HEADER_PRESET = 'ap-quiet-editorial';
      if (imgPurpose === 'blog_header' && imgPreset !== BLOG_HEADER_PRESET) {
        context.log('[Heartbeat]', agentId, 'generate-image: blog_header preset', imgPreset, '→ house style', BLOG_HEADER_PRESET);
        imgPreset = BLOG_HEADER_PRESET;
      }
      // Map purpose → default outputType (agent can override)
      const PURPOSE_OUTPUT_MAP = { 'blog_header': 'blog_image', 'inline_illustration': 'blog_image', 'social_media': 'x_image' };
      const imgOutputType = (img.outputType && imageEngine.PURPOSES && imageEngine.PURPOSES[img.outputType]) ? img.outputType : PURPOSE_OUTPUT_MAP[imgPurpose];

      // Validate preset
      if (!imageEngine.PRESETS || !imageEngine.PRESETS[imgPreset]) {
        context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: invalid preset:', imgPreset);
        continue;
      }

      // Usage limit check
      const imgAccountId = 'ambientpixels-internal';
      try {
        const imgLimitCheck = await imageEngine.checkUsageLimits(imgAccountId);
        if (!imgLimitCheck.allowed) {
          context.log('[Heartbeat]', agentId, 'generate-image BLOCKED: usage limit exceeded');
          continue;
        }
      } catch (limErr) {
        context.log('[Heartbeat]', agentId, 'generate-image: usage check failed, proceeding:', limErr.message);
      }

      // Handle attachTo — declared early so early-guard can reference it
      const attachTo = img.attachTo || null;

      // Early guard: skip blog_header generation if target document already has a hero image
      if (imgPurpose === 'blog_header' && attachTo && attachTo.type === 'document' && attachTo.id) {
        const _earlyDocCheck = (await storage.getState('documents')) || [];
        const _earlyDoc = _earlyDocCheck.find(d => d.id === attachTo.id);
        if (_earlyDoc && _earlyDoc.hero_image_asset_id) {
          context.log('[Heartbeat]', agentId, 'generate-image SKIPPED (early): doc', attachTo.id, 'already has hero_image_asset_id:', _earlyDoc.hero_image_asset_id);
          continue;
        }
      }

      context.log('[Heartbeat]', agentId, 'generating image:', imgPurpose, '| topic:', imgTopic, '| preset:', imgPreset, '| outputType:', imgOutputType);
      const imgGenStartMs = Date.now();
      const imgJobId = 'img_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');

      let imgResult = null;
      try {
        imgResult = await imageEngine.generateImage({
          topic: imgTopic,
          goal: imgGoal,
          preset: imgPreset,
          outputType: imgOutputType,
          jobId: imgJobId
        });
      } catch (genErr) {
        context.log.error('[Heartbeat]', agentId, 'generate-image FAILED:', genErr.message);
        // Non-blocking: log failure and continue
        result.taskUpdates.push({ action: 'generate-image-failed', agentId: agentId, error: genErr.message });
        continue;
      }

      const imgDurationMs = Date.now() - imgGenStartMs;
      const imgAlt = (img.alt || imgTopic).substring(0, 200);

      // Build image asset record
      const imgAsset = {
        id: imgJobId,
        url: imgResult.imageUrl,
        thumbUrl: imgResult.thumbUrl,
        metaUrl: imgResult.metaUrl,
        purpose: imgPurpose,
        outputType: imgOutputType,
        preset: imgPreset,
        aspect: (imageEngine.PURPOSES[imgOutputType] && imageEngine.PURPOSES[imgOutputType].aspect) || '4:3',
        alt: imgAlt,
        model: imgResult.model,
        bytes: imgResult.bytes,
        size: imgResult.size,
        attachedTo: null,
        createdBy: agentId,
        createdAt: new Date().toISOString(),
        durationMs: imgDurationMs,
        status: 'active'
      };

      // Link asset to document or action
      if (attachTo && attachTo.type === 'document' && attachTo.id) {
        const imgDocsStore = (await storage.getState('documents')) || [];
        const imgDocIdx = imgDocsStore.findIndex(d => d.id === attachTo.id);

        if (imgDocIdx !== -1) {
          const imgDoc = imgDocsStore[imgDocIdx];

          if (imgPurpose === 'blog_header') {
            // Guard: skip if document already has a hero image attached
            if (imgDoc.hero_image_asset_id) {
              context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: doc', attachTo.id, 'already has hero_image_asset_id:', imgDoc.hero_image_asset_id, '— not overwriting');
              // Still notify Scribe that hero image is available (may have been missed on prior cycle)
              const _heroDocIdExisting = attachTo.id;
              const _originTaskExisting = tasks.find(t =>
                t.assignee === 'scribe' && t.status !== 'done' &&
                t.comments && t.comments.some(c => c.text && c.text.indexOf(_heroDocIdExisting) !== -1)
              );
              if (_originTaskExisting) {
                const _alreadyNotified = _originTaskExisting.comments.some(c => c.text && c.text.indexOf('You can now submit this document for publish') !== -1);
                if (!_alreadyNotified) {
                  if (!_originTaskExisting.comments) _originTaskExisting.comments = [];
                  _originTaskExisting.comments.push({
                    id: 'cmt-hero-ready-' + Date.now(),
                    author: 'system',
                    text: 'Hero image generated and attached to document ' + _heroDocIdExisting + ' (asset: ' + imgDoc.hero_image_asset_id + '). You can now submit this document for publish using submit-for-publish with documentId: ' + _heroDocIdExisting,
                    type: 'system',
                    createdAt: new Date().toISOString()
                  });
                  // Move task back to in-progress so Scribe acts on the submit-for-publish step
                  if (_originTaskExisting.status === 'review') {
                    _originTaskExisting.status = 'in-progress';
                    _originTaskExisting.updatedAt = new Date().toISOString();
                    context.log('[Heartbeat]', agentId, 'moved Scribe task', _originTaskExisting.id, 'from review → in-progress for submit-for-publish step');
                  }
                  context.log('[Heartbeat]', agentId, 'notified originating task', _originTaskExisting.id, 'that hero image is already attached for doc:', _heroDocIdExisting);
                }
              }
            } else {
            // Set hero_image_asset_id only — no content_md mutation
            imgDoc.hero_image_asset_id = imgJobId;
            imgDoc.updated_at = new Date().toISOString();
            imgDoc.last_edited_by = agentId;
            imgAsset.attachedTo = { type: 'document', id: attachTo.id, field: 'hero_image_asset_id' };
            context.log('[Heartbeat]', agentId, 'attached hero image asset', imgJobId, 'to doc:', attachTo.id);

            // Clear awaiting flag
            imgDoc.awaiting_hero_image = false;

            // Notify originating Scribe task that hero image is ready
            const _heroDocId = attachTo.id;
            const _originTask = tasks.find(t =>
              t.assignee === 'scribe' &&
              t.comments && t.comments.some(c => c.text && c.text.indexOf(_heroDocId) !== -1)
            );
            if (_originTask && _originTask.status !== 'done') {
              if (!_originTask.comments) _originTask.comments = [];
              _originTask.comments.push({
                id: 'cmt-hero-ready-' + Date.now(),
                author: 'system',
                text: 'Hero image generated and attached to document ' + _heroDocId + ' (asset: ' + imgJobId + '). You can now submit this document for publish using submit-for-publish with documentId: ' + _heroDocId,
                type: 'system',
                createdAt: new Date().toISOString()
              });
              // Move task back to in-progress so Scribe acts on the submit-for-publish step
              if (_originTask.status === 'review') {
                _originTask.status = 'in-progress';
                _originTask.updatedAt = new Date().toISOString();
                context.log('[Heartbeat]', agentId, 'moved Scribe task', _originTask.id, 'from review → in-progress for submit-for-publish step');
              }
              context.log('[Heartbeat]', agentId, 'notified originating task', _originTask.id, 'that hero image is ready for doc:', _heroDocId);
            } else {
              // Scribe task already done — auto-submit for publish since no agent will do it
              var _heroDoc = imgDoc;
              if (_heroDoc && _heroDoc.kind && ['marketing_post', 'product_brief'].indexOf(_heroDoc.kind) !== -1 && _heroDoc.status !== 'published') {
                context.log('[Heartbeat]', agentId, 'Scribe task already done — auto-injecting submit-for-publish for doc:', _heroDocId);
                actions.push({ type: 'submit-for-publish', documentId: _heroDocId, taskId: _originTask ? _originTask.id : null, _systemInjected: true });
              }
            }
            } // end of else (no existing hero image)
          } else if (imgPurpose === 'inline_illustration') {
            // Token replacement: {{IMAGE:slot}} → ![alt](url)
            const imgSlot = (img.slot || 'default').trim();
            const imgToken = '{{IMAGE:' + imgSlot + '}}';
            // Dedup: skip entirely if this slot was already filled on this doc
            const _existingSlots = (imgDoc.inline_image_assets || []).map(function (a) { return a.slot; });
            if (_existingSlots.indexOf(imgSlot) !== -1) {
              context.log('[Heartbeat]', agentId, 'generate-image SKIPPED: slot', imgSlot, 'already filled on doc:', attachTo.id);
            } else {
              if (imgDoc.content_md && imgDoc.content_md.indexOf(imgToken) !== -1) {
                imgDoc.content_md = imgDoc.content_md.replace(imgToken, '![' + imgAlt + '](' + imgResult.imageUrl + ')');
                context.log('[Heartbeat]', agentId, 'replaced token', imgToken, 'in doc:', attachTo.id);
              } else {
                // Fallback: append at end
                imgDoc.content_md = (imgDoc.content_md || '') + '\n\n![' + imgAlt + '](' + imgResult.imageUrl + ')';
                context.log('[Heartbeat]', agentId, 'appended inline image to doc:', attachTo.id, '(token', imgToken, 'not found)');
              }
              imgDoc.updated_at = new Date().toISOString();
              imgDoc.last_edited_by = agentId;
              if (!imgDoc.inline_image_assets) imgDoc.inline_image_assets = [];
              imgDoc.inline_image_assets.push({ assetId: imgJobId, slot: imgSlot });
              imgAsset.attachedTo = { type: 'document', id: attachTo.id, field: 'inline', slot: imgSlot };
              context.log('[Heartbeat]', agentId, 'attached inline image asset', imgJobId, 'to doc:', attachTo.id);
            }
          }

          imgDocsStore[imgDocIdx] = imgDoc;
          await storage.setState('documents', imgDocsStore);

          // If doc is published internally, update published copy too
          if (imgDoc.visibility === 'internal' && imgDoc.status === 'published' && imgDoc.slug) {
            const imgPubStore = (await storage.getState('publishedDocs')) || [];
            const imgPubIdx = imgPubStore.findIndex(p => p.documentId === imgDoc.id);
            if (imgPubIdx !== -1) {
              if (imgPurpose === 'blog_header') imgPubStore[imgPubIdx].hero_image_asset_id = imgJobId;
              if (imgPurpose === 'inline_illustration') imgPubStore[imgPubIdx].content_md = imgDoc.content_md;
              imgPubStore[imgPubIdx].updated_at = imgDoc.updated_at;
              await storage.setState('publishedDocs', imgPubStore);
            }
          }
        } else {
          context.log('[Heartbeat]', agentId, 'generate-image: attachTo document not found:', attachTo.id);
        }
      } else if (attachTo && attachTo.type === 'action' && attachTo.id) {
        // Attach image to a pending social action's media array
        const imgActionsStore = (await storage.getState('actions')) || [];
        const imgActIdx = imgActionsStore.findIndex(a => a.id === attachTo.id);

        if (imgActIdx !== -1) {
          const imgAct = imgActionsStore[imgActIdx];
          // Only mutate if still pending approval
          if (imgAct.approval && imgAct.approval.status === 'pending') {
            if (!imgAct.payload) imgAct.payload = {};
            if (!imgAct.payload.media) imgAct.payload.media = [];
            // Cap at 1 media item for now
            if (imgAct.payload.media.length < 1) {
              imgAct.payload.media.push({ type: 'image', url: imgResult.imageUrl, alt: imgAlt, assetId: imgJobId });
              imgActionsStore[imgActIdx] = imgAct;
              await storage.setState('actions', imgActionsStore);
              imgAsset.attachedTo = { type: 'action', id: attachTo.id, field: 'media' };
              context.log('[Heartbeat]', agentId, 'attached image to action:', attachTo.id);
            } else {
              context.log('[Heartbeat]', agentId, 'generate-image: action', attachTo.id, 'already has max media items');
            }
          } else {
            context.log('[Heartbeat]', agentId, 'generate-image: action', attachTo.id, 'not in pending status, skipping media attach');
          }
        } else {
          context.log('[Heartbeat]', agentId, 'generate-image: attachTo action not found:', attachTo.id);
        }
      }

      // Persist asset to imageAssets registry
      try {
        const imgAssetsStore = (await storage.getState('imageAssets')) || [];
        imgAssetsStore.push(imgAsset);
        if (imgAssetsStore.length > 500) imgAssetsStore.splice(0, imgAssetsStore.length - 500);
        await storage.setState('imageAssets', imgAssetsStore);
      } catch (assetStoreErr) {
        context.log.error('[Heartbeat]', agentId, 'generate-image: imageAssets persist FAILED (non-fatal):', assetStoreErr.message);
      }

      // Write usage record
      try {
        await imageEngine.writeUsageRecord({
          accountId: imgAccountId, accountType: 'internal', packageId: imgJobId,
          timestamp: imgAsset.createdAt, engineVersion: imageEngine.ENGINE_VERSION,
          preset: imgPreset, presetVersion: imageEngine.getPresetVersion(imgPreset),
          formatsRequested: [imgOutputType], variations: 1,
          imagesGenerated: 1, model: imageEngine.GEMINI_IMAGE_MODEL,
          durationMs: imgDurationMs, estimatedCost: imageEngine.estimateCost(1),
          status: 'success', createdBy: agentId, agentRole: agent.role,
          source: 'heartbeat', actionType: 'generate-image', purpose: imgPurpose
        });
      } catch (usageErr) { context.log.warn('[Heartbeat] generate-image usage record failed (non-fatal):', usageErr.message); }

      // Auto-advance parent task: all image tasks → review (hero images stay in review until attached to blog)
      if (action.taskId) {
        const imgTaskIdx = tasks.findIndex(t => t.id === action.taskId);
        if (imgTaskIdx !== -1 && tasks[imgTaskIdx].status !== 'done') {
          tasks[imgTaskIdx].status = 'review';
          tasks[imgTaskIdx].updatedAt = new Date().toISOString();
          if (!tasks[imgTaskIdx].comments) tasks[imgTaskIdx].comments = [];
          tasks[imgTaskIdx].comments.push({
            id: 'cmt-' + Date.now(), author: agentId,
            text: 'Generated ' + imgPurpose + ' image (asset: ' + imgJobId + ', preset: ' + imgPreset + ').' + (imgAsset.attachedTo ? ' Attached to ' + imgAsset.attachedTo.type + ' ' + imgAsset.attachedTo.id + '.' : ''),
            type: 'deliverable', createdAt: new Date().toISOString(),
            imageUrl: imgAsset.url || null,
            thumbUrl: imgAsset.thumbUrl || imgAsset.url || null,
            assetId: imgJobId
          });
          context.log('[Heartbeat]', agentId, 'auto-advanced task', action.taskId, 'to review (image generated)');
        }
      }

      result.contentGenerates = (result.contentGenerates || 0) + 1;
      context.log('[Heartbeat]', agentId, 'image generated:', imgJobId, imgPurpose, imgOutputType, imgDurationMs + 'ms');
      result.taskUpdates.push({ action: 'image-generated', assetId: imgJobId, purpose: imgPurpose, agentId: agentId, taskId: action.taskId || null, attachedTo: imgAsset.attachedTo });

    } else if (action.type === 'remember' && action.memory) {
      // Agent saves a persistent memory (hardened Phase 1E + 1F manual gate)
      const mem = action.memory;
      const _memNow = new Date();
      const _memNowIso = _memNow.toISOString();
      let _memOk = false;
      let _memBlockedReason = null;

      // Manual mode gate: block all memory writes
      if (executionMode === 'manual') {
        _memBlockedReason = 'mode_gate_manual';
        await logEvent('policy-violation', agentId, 'Memory write blocked: manual mode', cycleId, {
          runId: cycleId, agentId: agentId, gate: 'mode_gate', reason: 'execution_mode_manual_blocks_remember'
        });
      } else if (!mem.text || mem.text.trim().length === 0) {
        _memBlockedReason = 'empty_text';
      } else {
        const _memType = (mem.type || '').trim().toLowerCase();

        // Type validation
        if (!_memType || !L4_ALLOWED_TYPES.has(_memType)) {
          _memBlockedReason = 'invalid_type';
          await logEvent('policy-violation', agentId, 'Memory write blocked: invalid type', cycleId, {
            runId: cycleId, agentId: agentId, gate: 'memory_schema', reason: 'invalid_type', type: mem.type || null
          });
        }
        // Evidence requirement for ALL L4 memory types except structural aggregation types
        // (weekly_report, reflection, consolidated_belief — see L4_STRUCTURAL_TYPES). These
        // synthesize a window of prior activity into a conclusion rather than asserting a single
        // verifiable fact, so a per-write evidence.runId doesn't apply. Previously only
        // weekly_report was exempted, which silently dropped proactive `reflection` writes (the
        // cadence nudge demands evidence.runId that agents routinely omit) — the root cause of the
        // near-total absence of type='reflection' memories. The evidence gate still polices the
        // factual L4 types (the stale-loop fix: "Cipher spent $0.51" repeated 20×).
        else if (!L4_STRUCTURAL_TYPES.has(_memType) && (!mem.evidence || typeof mem.evidence !== 'object' || !mem.evidence.runId)) {
          _memBlockedReason = 'missing_evidence';
          await logEvent('policy-violation', agentId, 'Memory write blocked: evidence.runId required', cycleId, {
            runId: cycleId, agentId: agentId, gate: 'memory_schema', reason: 'missing_evidence', type: _memType
          });
        }
        // Daily rate-cap
        else if (_getMemWriteCount(agentId) >= MAX_L4_WRITES_PER_AGENT_PER_DAY) {
          _memBlockedReason = 'daily_cap_exceeded';
          await logEvent('policy-violation', agentId, 'Memory write blocked: daily cap exceeded', cycleId, {
            runId: cycleId, agentId: agentId, gate: 'memory_rate_cap', reason: 'daily_cap_exceeded',
            cap: MAX_L4_WRITES_PER_AGENT_PER_DAY, current: _getMemWriteCount(agentId)
          });
        }
        // All checks passed — store
        else {
          if (!_agentMemoryStore[agentId]) _agentMemoryStore[agentId] = [];
          var _memExpiresAt = mem.expiresAt || new Date(_memNow.getTime() + L4_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
          _agentMemoryStore[agentId].push({
            id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            type: _memType,
            text: mem.text.trim().substring(0, 300),
            source: cycleId,
            timestamp: mem.ts || _memNowIso,
            expiresAt: _memExpiresAt,
            // Evidence persisted for all types (validated upstream); only weekly_report is exempt
            // and legitimately has no runId (it aggregates a week's worth of activity).
            evidence: _memType !== 'weekly_report' ? mem.evidence : (mem.evidence || undefined)
          });
          // Cap per-agent memories
          if (_agentMemoryStore[agentId].length > MAX_MEMORIES_PER_AGENT) {
            _agentMemoryStore[agentId] = _agentMemoryStore[agentId].slice(-MAX_MEMORIES_PER_AGENT);
          }
          _incMemWrite(agentId);
          _memOk = true;
          context.log('[Heartbeat]', agentId, 'saved memory:', mem.text.substring(0, 80));
          result.taskUpdates.push({ action: 'memory-saved', agentId: agentId });

          // ── Weekly report archival ──
          // When a weekly_report memory is saved, also append to the weeklyReports archive so
          // trends can be seen over time. Main agentMemories bucket is FIFO-capped at 50 with
          // mixed types — prior reports would get pushed out. The archive keeps the last 12
          // reports per agent (rolling quarter) intact for trend review.
          if (_memType === 'weekly_report') {
            try {
              const _wrStore = (await storage.getState('weeklyReports')) || {};
              if (!Array.isArray(_wrStore[agentId])) _wrStore[agentId] = [];
              _wrStore[agentId].push({
                id: 'wr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                agentId: agentId,
                date: _memNowIso.substring(0, 10),
                cycleId: cycleId,
                text: mem.text.trim(),
                createdAt: _memNowIso
              });
              if (_wrStore[agentId].length > MAX_WEEKLY_REPORTS_PER_AGENT) {
                _wrStore[agentId] = _wrStore[agentId].slice(-MAX_WEEKLY_REPORTS_PER_AGENT);
              }
              await storage.setState('weeklyReports', _wrStore);
              context.log('[Heartbeat]', agentId, 'archived weekly_report to weeklyReports (' + _wrStore[agentId].length + ' total for this agent)');
            } catch (_wrErr) {
              context.log('[Heartbeat]', agentId, 'weekly_report archive failed (non-fatal):', String(_wrErr).substring(0, 200));
            }
          }

          // ── Experiment tracking (AutoResearch loop) ──
          // If memory includes experiment_tag, create or update an active experiment
          if (mem.experiment_tag && typeof mem.experiment_tag === 'string' && agentExperiments) {
            var _expTag = mem.experiment_tag.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').substring(0, 50);
            if (_expTag) {
              var _existingExp = agentExperiments.find(function (e) { return e.agentId === agentId && e.hypothesis === _expTag && e.status === 'active'; });
              if (!_existingExp) {
                // Cap active experiments per agent
                var _activeCount = agentExperiments.filter(function (e) { return e.agentId === agentId && e.status === 'active'; }).length;
                var _MAX_EXP = require('./constants').MAX_EXPERIMENTS_PER_AGENT || 3;
                if (_activeCount < _MAX_EXP) {
                  var _agentPerf = performanceDigest && performanceDigest.agents && performanceDigest.agents[agentId];
                  agentExperiments.push({
                    id: 'exp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                    agentId: agentId,
                    hypothesis: _expTag,
                    description: mem.text.trim().substring(0, 200),
                    baselineMetric: _agentPerf ? { ceoApprovalRate: _agentPerf.ceoApprovalRate, avgLikesPerPost: _agentPerf.avgLikesPerPost } : {},
                    experimentMetric: null,
                    status: 'active',
                    taskIds: [],
                    result: null,
                    minSamples: require('./constants').EXPERIMENT_MIN_SAMPLES || 3,
                    sampleCount: 0,
                    startedAt: _memNowIso,
                    concludedAt: null
                  });
                  context.log('[Heartbeat]', agentId, 'created experiment:', _expTag);
                  // Outcome Attribution Phase 5: log experiment start as a decision.
                  try {
                    await appendDecision(storage, {
                      cycleId: cycleId,
                      agentId: agentId,
                      decisionType: 'experiment-start',
                      contextActionId: null,
                      before: { activeExperiments: _activeCount },
                      after: { hypothesis: _expTag, baseline: _agentPerf ? { ceoApprovalRate: _agentPerf.ceoApprovalRate } : null },
                      reasoning: mem.text.trim().substring(0, 300)
                    });
                  } catch (_decErr) { /* non-fatal */ }
                } else {
                  context.log('[Heartbeat]', agentId, 'BLOCKED experiment creation: max active experiments reached (' + _activeCount + '/' + _MAX_EXP + ')');
                }
              }
            }
          }
        }
      }

      await logEvent('memory-write-attempt', agentId, _memOk ? 'Memory saved' : 'Memory blocked: ' + _memBlockedReason, cycleId, {
        runId: cycleId, agentId: agentId, ok: _memOk, type: (mem.type || null), blockedReason: _memBlockedReason
      });
    } else if (action.type === 'create-reminder' && action.reminder) {
      // Agent sets a reminder/date in the workspace dates store
      const rem = action.reminder;
      if (rem.title && rem.date) {
        const dates = (await storage.getState('dates')) || [];

        // Dedup: skip if a date with the same title + date already exists
        const normTitle = rem.title.trim().toLowerCase();
        const normDate = rem.date.substring(0, 10);
        const isDupe = dates.some(d =>
          d.title && d.title.trim().toLowerCase() === normTitle && d.date === normDate
        );
        if (isDupe) {
          context.log('[Heartbeat]', agentId, 'SKIPPED duplicate reminder:', rem.title, normDate);
          continue;
        }

        const VALID_TYPES = ['event', 'deadline', 'milestone', 'recurring'];
        const dateEntry = {
          id: 'date_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          title: rem.title.substring(0, 200),
          date: normDate,
          type: (rem.type && VALID_TYPES.indexOf(rem.type) !== -1) ? rem.type : 'deadline',
          description: (rem.description || '').substring(0, 500),
          created_by: agentId,
          created_at: new Date().toISOString()
        };

        dates.push(dateEntry);
        if (dates.length > 200) dates.splice(0, dates.length - 200);
        await storage.setState('dates', dates);

        context.log('[Heartbeat]', agentId, 'created reminder:', dateEntry.id, dateEntry.title, dateEntry.date);
        result.taskUpdates.push({ action: 'reminder-created', dateId: dateEntry.id, agentId: agentId });
      }
    } else if (action.type === 'run-ambientscore-scan' && action.scan && action.scan.url) {
      // Conversion lever (revenue pivot 2026-07): queue a free AmbientScore audit
      // of a prospect URL. asScanRunner (timer, every 10 min) executes it
      // out-of-band — a scan takes 20-60s and must not stretch the heartbeat —
      // then comments score + findings + shareable report link on the given task.
      var _SCAN_AGENTS = ['echo', 'scout', 'nova'];
      if (_SCAN_AGENTS.indexOf(agentId) === -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED run-ambientscore-scan — not authorized (echo/scout/nova only)');
        await logEvent('policy-violation', agentId, 'run-ambientscore-scan blocked: not authorized', cycleId, { gate: 'scan_not_authorized' });
        continue;
      }
      var _scanUrl = String(action.scan.url).trim();
      var _scanOk = false;
      try { var _scanU = new URL(_scanUrl); _scanOk = _scanU.protocol === 'http:' || _scanU.protocol === 'https:'; } catch (_ue) { _scanOk = false; }
      if (!_scanOk) {
        context.log('[Heartbeat]', agentId, 'BLOCKED run-ambientscore-scan — invalid URL:', _scanUrl.substring(0, 100));
        continue;
      }
      var _scanTaskId = action.scan.taskId || action.taskId || null;
      if (!_scanTaskId) {
        context.log('[Heartbeat]', agentId, 'BLOCKED run-ambientscore-scan — scan.taskId required (results land as a task comment)');
        continue;
      }
      var _scanQ = (await storage.getState('asScanQueue')) || [];
      var _scanDup = _scanQ.some(function (q) {
        return q && q.url === _scanUrl && (q.status === 'queued' || q.status === 'running' ||
          (q.status === 'done' && q.finishedAt && (Date.now() - new Date(q.finishedAt).getTime()) < 7 * 86400000));
      });
      if (_scanDup) {
        context.log('[Heartbeat]', agentId, 'BLOCKED run-ambientscore-scan — URL already scanned or queued within 7d:', _scanUrl);
        continue;
      }
      if (_scanQ.filter(function (q) { return q && q.status === 'queued'; }).length >= 20) {
        context.log('[Heartbeat]', agentId, 'BLOCKED run-ambientscore-scan — queue full (20)');
        continue;
      }
      _scanQ.push({
        id: 'scan_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        url: _scanUrl,
        taskId: _scanTaskId,
        requestedBy: agentId,
        note: String(action.scan.note || '').substring(0, 300),
        status: 'queued',
        createdAt: new Date().toISOString(),
        cycleId: cycleId
      });
      await storage.setState('asScanQueue', _scanQ.slice(-100));
      await logEvent('scan-queued', agentId, 'AmbientScore scan queued: ' + _scanUrl, cycleId, { url: _scanUrl, taskId: _scanTaskId });
      context.log('[Heartbeat]', agentId, 'queued AmbientScore scan:', _scanUrl, 'for task', _scanTaskId);

    } else if (action.type === 'propose-campaign' && action.campaign) {
      if (!PROPOSAL_AUTHORIZED_AGENTS.has(agentId)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-campaign — not an authorized proposer');
        await logEvent('policy-violation', agentId, 'propose-campaign blocked: not an authorized proposer', cycleId,
          { runId: cycleId, gate: 'proposal_unauthorized', kind: 'campaign' });
        continue;
      }
      if (_privTier === 'probation') {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-campaign — probation tier (Revenue Seasons)');
        await logEvent('policy-violation', agentId, 'propose-campaign blocked: probation privilege tier', cycleId,
          { runId: cycleId, gate: 'privilege_probation', kind: 'campaign' });
        continue;
      }
      // An authorized strategic agent (PROPOSAL_AUTHORIZED_AGENTS) proposes a new campaign for CEO approval
      var _pc = action.campaign;
      var _pcName = (_pc.name || '').trim().substring(0, 100);
      if (!_pcName) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-campaign — missing campaign name');
        await logEvent('policy-violation', agentId, 'propose-campaign blocked: missing campaign name', cycleId,
          { runId: cycleId, gate: 'proposal_missing_fields', kind: 'campaign' });
        continue;
      }

      // Capital Allocation gate: block new campaign proposals when the agent is
      // already over their monthly cap, OR when the system is in squeeze mode.
      // Agent must emit request-budget first to unlock.
      try {
        var _pcAlloc = (await storage.getState('capitalAllocation')) || {};
        var _pcAgentAlloc = (_pcAlloc.perAgent && _pcAlloc.perAgent[agentId]) || null;
        var _pcSqueezePct = (_pcAlloc.systemBudget > 0)
          ? ((_pcAlloc.systemSpent || 0) / _pcAlloc.systemBudget) * 100
          : 0;
        var _pcSqueeze = _pcSqueezePct >= CAPITAL_DECISION_THRESHOLDS.systemBudgetSqueezePct;
        var _pcOverCap = _pcAgentAlloc && _pcAgentAlloc.status === 'RED';
        if (_pcOverCap || _pcSqueeze) {
          // Check for an approved request-budget in the last 24h from this agent to allow bypass.
          var _pcLog = Array.isArray(_pcAlloc.decisionLog) ? _pcAlloc.decisionLog : [];
          var _pc24hAgo = Date.now() - 24 * 60 * 60 * 1000;
          var _pcHasApproval = _pcLog.some(function (l) {
            return l.agentId === agentId && l.action === 'approved' &&
              Date.parse(l.at || '') > _pc24hAgo;
          });
          if (!_pcHasApproval) {
            context.log('[Heartbeat]', agentId, 'BLOCKED propose-campaign — Capital Allocation gate (' + (_pcSqueeze ? 'squeeze' : 'over-cap') + '). Emit request-budget first.');
            continue;
          }
        }
      } catch (_pcGateErr) {
        // Fail-open on gate errors so campaign pipeline never silently blocks.
        context.log('[Heartbeat]', agentId, 'Capital gate check failed (fail-open):', String(_pcGateErr).substring(0, 200));
      }

      // Rate limit: max 1 proposal per day per agent. Generator-cron entries are
      // stamped proposedBy:'nova' — exclude them or the cron silently consumes
      // Nova's own daily quota (revenue-pivot audit finding).
      var _pcAQ = (await storage.getState('approvalQueue')) || [];
      var _pcToday = new Date().toISOString().substring(0, 10);
      var _pcTodayCount = _pcAQ.filter(function (q) {
        return q.type === 'campaign_proposal' && q.proposedBy === agentId &&
          q.source !== 'auto:proposal-generator' &&
          q.createdAt && q.createdAt.substring(0, 10) === _pcToday;
      }).length;
      if (_pcTodayCount >= 1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-campaign — daily limit reached (1/day)');
        await logEvent('policy-violation', agentId, 'propose-campaign blocked: 1/day limit', cycleId, { gate: 'proposal_daily_limit', name: _pcName });
        continue;
      }

      // Dedup: skip if a pending proposal with same name exists
      var _pcDupe = _pcAQ.some(function (q) {
        return q.type === 'campaign_proposal' && q.status === 'pending' &&
          q.name && q.name.trim().toLowerCase() === _pcName.toLowerCase();
      });
      if (_pcDupe) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-campaign — duplicate pending proposal:', _pcName);
        await logEvent('policy-violation', agentId, 'propose-campaign blocked: duplicate pending', cycleId, { gate: 'proposal_pending_dup', name: _pcName });
        continue;
      }

      // Semantic dedup (parity with propose-objective) — exact-name matching is how six
      // near-identical conversion campaigns piled up before the 2026-07-24 consolidation.
      // Fuzzy-match the name against ACTIVE + PAUSED campaigns and pending proposals.
      // Paused counts: "Founding Partner Initiative" was minted while its near-twin
      // "Founding Partner Program" sat paused (2026-07-28) — resume exists for that.
      // activeDirectives is pre-filtered to active (index.js ~1017), so read the full
      // list from storage — one extra get on a rare action path.
      var _pcSemHit = null;
      var _pcAllCamps = [];
      try { _pcAllCamps = (await storage.getState('campaigns')) || []; } catch (_pcCErr) { _pcAllCamps = activeDirectives || []; }
      var _pcActive = _pcAllCamps.filter(function (c) { return c && !c.deletedAt && (c.status === 'active' || c.status === 'paused'); });
      for (var _pci = 0; _pci < _pcActive.length && !_pcSemHit; _pci++) {
        if (titleSimilarity(_pcName, _pcActive[_pci].title || _pcActive[_pci].name) >= 0.6) {
          _pcSemHit = { why: 'name ~ active campaign', id: _pcActive[_pci].id, other: _pcActive[_pci].title || _pcActive[_pci].name };
        }
      }
      if (!_pcSemHit) {
        var _pcPendSem = _pcAQ.find(function (q) {
          return q.type === 'campaign_proposal' && q.status === 'pending' && q.name &&
            titleSimilarity(_pcName, q.name) >= 0.6;
        });
        if (_pcPendSem) _pcSemHit = { why: 'name ~ pending proposal', id: _pcPendSem.id, other: _pcPendSem.name };
      }
      if (_pcSemHit) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-campaign — semantic duplicate (' + _pcSemHit.why + '):', _pcSemHit.id);
        await logEvent('policy-violation', agentId, 'propose-campaign blocked: semantic duplicate of ' + _pcSemHit.id, cycleId,
          { gate: 'proposal_semantic_dup', name: _pcName, matched: _pcSemHit.id, matchedTitle: String(_pcSemHit.other || '').substring(0, 80), why: _pcSemHit.why });
        continue;
      }

      // Rejection cooldown: don't re-propose a name the CEO rejected within the cooldown window
      // (parity with product 7d / fleet 14d — campaign/objective previously had none).
      var _pcCooldownMs = (PROPOSAL_REJECT_COOLDOWN_DAYS || 7) * 86400000;
      var _pcRejected = _pcAQ.some(function (q) {
        if (q.type !== 'campaign_proposal') return false;
        if (!(q.status === 'rejected' || q.status === 'declined')) return false;
        if (!q.name || q.name.trim().toLowerCase() !== _pcName.toLowerCase()) return false;
        var _rt = q.rejectedAt || q.resolvedAt || q.updatedAt;
        return _rt && (Date.now() - new Date(_rt).getTime()) < _pcCooldownMs;
      });
      if (_pcRejected) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-campaign — rejection cooldown active for:', _pcName);
        await logEvent('policy-violation', agentId, 'propose-campaign blocked: rejection cooldown', cycleId, { gate: 'proposal_reject_cooldown', name: _pcName });
        continue;
      }

      // SE-1: proposals must name the north star they serve. Flag, don't block
      // (graduated) — and no flag at all when strategy isn't seeded yet.
      var _pcNS = (_pc.northStarMetric || '').trim().substring(0, 50);
      var _pcNSValid = !!(strategyDigest && Array.isArray(strategyDigest.northStar) &&
        strategyDigest.northStar.some(function (n) { return n.metric === _pcNS; }));
      if (strategyDigest && !_pcNSValid) {
        context.log('[Heartbeat]', agentId, 'propose-campaign missing/unknown northStarMetric ("' + _pcNS + '") — flagging for CEO scrutiny');
      }

      // Optional explicit parent goal — lets Nova propose a campaign FOR a specific
      // (e.g. orphaned) objective. Honored by materialize's explicit-ref tier at
      // approval. Invalid/unknown ids are dropped to null (fuzzy tiers take over).
      var _pcObjRef = String(_pc.objectiveId || _pc.objective_id || '').trim() || null;
      if (_pcObjRef && !(activeObjectives || []).some(function (o) { return o && o.id === _pcObjRef && (!o.status || o.status === 'active'); })) {
        context.log('[Heartbeat]', agentId, 'propose-campaign objectiveId "' + _pcObjRef + '" is not an active objective — dropping ref');
        _pcObjRef = null;
      }

      var _pcEntry = {
        id: 'cprop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'campaign_proposal',
        status: 'pending',
        proposedBy: agentId,
        name: _pcName,
        suggestedObjectiveId: _pcObjRef,
        description: (_pc.description || _pc.brief || '').substring(0, 1000),
        rationale: (_pc.rationale || '').substring(0, 500),
        platforms: Array.isArray(_pc.platforms) ? _pc.platforms.slice(0, 5) : [],
        frequency: Number.isFinite(_pc.frequency) ? _pc.frequency : 2,
        cadence: ['daily', 'weekly', 'biweekly'].indexOf(_pc.cadence) !== -1 ? _pc.cadence : 'weekly',
        duration: (_pc.duration || '').substring(0, 50),
        product: (_pc.product || '').substring(0, 50),
        kpiTarget: (_pc.kpiTarget || '').substring(0, 200),
        northStarMetric: _pcNSValid ? _pcNS : null,
        strategyFlag: (strategyDigest && !_pcNSValid) ? 'no-north-star-metric' : null,
        createdAt: new Date().toISOString()
      };

      var _pcTrigger = (action.campaign.trigger || '').trim();
      var _pcSeverity = _proposalSeverity(_pcTrigger);
      if (_pcSeverity === PROPOSAL_UNKNOWN_TRIGGER_SEVERITY && !_pcEntry.strategyFlag) {
        _pcEntry.strategyFlag = 'no-data-trigger';
      }
      _pcEntry.trigger = _pcTrigger || null;
      result.stagedProposals.push({ type: 'campaign_proposal', severity: _pcSeverity, payload: _pcEntry });
      context.log('[Heartbeat]', agentId, 'staged campaign proposal:', _pcEntry.id, _pcName, 'sev', _pcSeverity);
      result.taskUpdates.push({ action: 'campaign-proposed', proposalId: _pcEntry.id, agentId: agentId });

    } else if (action.type === 'propose-objective' && action.objective) {
      if (!PROPOSAL_AUTHORIZED_AGENTS.has(agentId)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-objective — not an authorized proposer');
        await logEvent('policy-violation', agentId, 'propose-objective blocked: not an authorized proposer', cycleId,
          { runId: cycleId, gate: 'proposal_unauthorized', kind: 'objective' });
        continue;
      }
      if (_privTier === 'probation') {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-objective — probation tier (Revenue Seasons)');
        await logEvent('policy-violation', agentId, 'propose-objective blocked: probation privilege tier', cycleId,
          { runId: cycleId, gate: 'privilege_probation', kind: 'objective' });
        continue;
      }
      // An authorized strategic agent (PROPOSAL_AUTHORIZED_AGENTS) proposes a new objective for CEO approval
      var _po = action.objective;
      var _poTitle = (_po.title || '').trim().substring(0, 100);
      var _poDesc = (_po.description || '').trim();
      var _poRationale = (_po.rationale || '').trim();
      var _poSuccess = (_po.successCriteria || '').trim();
      var _poHorizon = (_po.timeHorizon || '').trim();

      // Required fields validation
      if (!_poTitle || !_poDesc || !_poRationale || !_poSuccess || !_poHorizon) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-objective — missing required fields (title, description, rationale, successCriteria, timeHorizon)');
        await logEvent('policy-violation', agentId, 'propose-objective blocked: missing required fields', cycleId,
          { runId: cycleId, gate: 'proposal_missing_fields', kind: 'objective',
            missing: [!_poTitle && 'title', !_poDesc && 'description', !_poRationale && 'rationale', !_poSuccess && 'successCriteria', !_poHorizon && 'timeHorizon'].filter(Boolean) });
        continue;
      }

      // Rate limit: 1 objective proposal per day per agent. Exclude generator-cron
      // entries (stamped proposedBy:'nova') so the cron can't eat Nova's quota.
      var _poAQ = (await storage.getState('approvalQueue')) || [];
      var _poToday = new Date().toISOString().substring(0, 10);
      var _poTodayCount = _poAQ.filter(function (q) {
        return q.type === 'objective_proposal' && q.proposedBy === agentId &&
          q.source !== 'auto:proposal-generator' &&
          q.createdAt && q.createdAt.substring(0, 10) === _poToday;
      }).length;
      if (_poTodayCount >= 1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-objective — daily limit reached');
        await logEvent('policy-violation', agentId, 'propose-objective blocked: 1/day limit', cycleId, { gate: 'proposal_daily_limit', name: _poTitle });
        continue;
      }

      // Dedup
      var _poDupe = _poAQ.some(function (q) {
        return q.type === 'objective_proposal' && q.status === 'pending' && q.title && q.title.trim().toLowerCase() === _poTitle.toLowerCase();
      });
      if (_poDupe) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-objective — duplicate pending proposal');
        await logEvent('policy-violation', agentId, 'propose-objective blocked: duplicate pending', cycleId, { gate: 'proposal_pending_dup', name: _poTitle });
        continue;
      }

      // Hard cap on ACTIVE objectives (backstop against goal proliferation — 11
      // accumulated by 2026-07-28, 8 orphaned). With the cap hit, the right move
      // is linking/archiving existing goals, not minting another. proposalDecide
      // enforces the same cap at approve time.
      var _poActiveObjs = (activeObjectives || []).filter(function (o) { return o && (!o.status || o.status === 'active'); });
      if (_poActiveObjs.length >= MAX_ACTIVE_OBJECTIVES) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-objective — active-objective cap reached (' + _poActiveObjs.length + '/' + MAX_ACTIVE_OBJECTIVES + ')');
        await logEvent('policy-violation', agentId, 'propose-objective blocked: active-objective cap (' + _poActiveObjs.length + '/' + MAX_ACTIVE_OBJECTIVES + ')', cycleId,
          { gate: 'objective_cap', name: _poTitle });
        continue;
      }

      // Semantic dedup — exact-title only let rewordings through: three first-customer
      // objectives went live simultaneously (obj-first-customer / obj-mrz8kvg9 /
      // obj-ms2msmuy, CEO escalation 2026-07-27). Block when the title fuzzy-matches
      // an ACTIVE objective or pending proposal (>=0.6), or when the proposal targets
      // the same north-star metric an active objective already owns — same metric =
      // same intent regardless of wording (the "Budget Compliance" vs "Financial
      // Guardrails" class that lexical matching misses).
      var _poSemHit = null;
      for (var _psi = 0; _psi < _poActiveObjs.length && !_poSemHit; _psi++) {
        if (titleSimilarity(_poTitle, _poActiveObjs[_psi].title) >= 0.6) {
          _poSemHit = { why: 'title ~ active objective', id: _poActiveObjs[_psi].id, other: _poActiveObjs[_psi].title };
        }
      }
      if (!_poSemHit) {
        var _poPendSem = _poAQ.find(function (q) {
          return q.type === 'objective_proposal' && q.status === 'pending' && q.title &&
            titleSimilarity(_poTitle, q.title) >= 0.6;
        });
        if (_poPendSem) _poSemHit = { why: 'title ~ pending proposal', id: _poPendSem.id, other: _poPendSem.title };
      }
      var _poNSPre = String(_po.northStarMetric || '').trim();
      if (!_poSemHit && _poNSPre) {
        var _poMetricOwner = _poActiveObjs.find(function (o) {
          return (o.northStarMetric || (o.criteria && o.criteria.metric) || '') === _poNSPre;
        });
        if (_poMetricOwner) _poSemHit = { why: 'metric "' + _poNSPre + '" ~ active objective', id: _poMetricOwner.id, other: _poMetricOwner.title };
      }
      if (_poSemHit) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-objective — semantic duplicate (' + _poSemHit.why + '):', _poSemHit.id);
        await logEvent('policy-violation', agentId, 'propose-objective blocked: semantic duplicate of ' + _poSemHit.id, cycleId,
          { gate: 'proposal_semantic_dup', name: _poTitle, matched: _poSemHit.id, matchedTitle: String(_poSemHit.other || '').substring(0, 80), why: _poSemHit.why });
        continue;
      }

      // Rejection cooldown (parity with product/fleet families).
      var _poCooldownMs = (PROPOSAL_REJECT_COOLDOWN_DAYS || 7) * 86400000;
      var _poRejected = _poAQ.some(function (q) {
        if (q.type !== 'objective_proposal') return false;
        if (!(q.status === 'rejected' || q.status === 'declined')) return false;
        if (!q.title || q.title.trim().toLowerCase() !== _poTitle.toLowerCase()) return false;
        var _rt = q.rejectedAt || q.resolvedAt || q.updatedAt;
        return _rt && (Date.now() - new Date(_rt).getTime()) < _poCooldownMs;
      });
      if (_poRejected) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-objective — rejection cooldown active for:', _poTitle);
        await logEvent('policy-violation', agentId, 'propose-objective blocked: rejection cooldown', cycleId, { gate: 'proposal_reject_cooldown', name: _poTitle });
        continue;
      }

      // SE-1: same north-star capture as propose-campaign (flag, don't block).
      var _poNS = (_po.northStarMetric || '').trim().substring(0, 50);
      var _poNSValid = !!(strategyDigest && Array.isArray(strategyDigest.northStar) &&
        strategyDigest.northStar.some(function (n) { return n.metric === _poNS; }));
      if (strategyDigest && !_poNSValid) {
        context.log('[Heartbeat]', agentId, 'propose-objective missing/unknown northStarMetric ("' + _poNS + '") — flagging for CEO scrutiny');
      }
      // SE-2: optional structured target so CEO approval can mint a measurable
      // objective (criteria object). Both-or-neither: a target without a parseable
      // deadline (or vice versa) is dropped to null rather than half-captured.
      var _poMT = Number(_po.metricTarget);
      var _poMD = String(_po.metricDeadline || '').trim().substring(0, 10);
      if (!_poNSValid || !Number.isFinite(_poMT) || _poMT <= 0 || !Number.isFinite(Date.parse(_poMD))) {
        _poMT = null; _poMD = null;
      }

      var _poEntry = {
        id: 'oprop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'objective_proposal',
        status: 'pending',
        proposedBy: agentId,
        title: _poTitle,
        description: _poDesc.substring(0, 1000),
        rationale: _poRationale.substring(0, 500),
        successCriteria: _poSuccess.substring(0, 300),
        timeHorizon: _poHorizon.substring(0, 50),
        suggestedCampaigns: Array.isArray(_po.suggestedCampaigns) ? _po.suggestedCampaigns.slice(0, 3) : [],
        northStarMetric: _poNSValid ? _poNS : null,
        metricTarget: _poMT,
        metricDeadline: _poMD,
        strategyFlag: (strategyDigest && !_poNSValid) ? 'no-north-star-metric' : null,
        createdAt: new Date().toISOString()
      };

      var _poTrigger = (action.objective.trigger || '').trim();
      var _poSeverity = _proposalSeverity(_poTrigger);
      if (_poSeverity === PROPOSAL_UNKNOWN_TRIGGER_SEVERITY && !_poEntry.strategyFlag) {
        _poEntry.strategyFlag = 'no-data-trigger';
      }
      _poEntry.trigger = _poTrigger || null;
      result.stagedProposals.push({ type: 'objective_proposal', severity: _poSeverity, payload: _poEntry });
      context.log('[Heartbeat]', agentId, 'staged objective proposal:', _poEntry.id, _poTitle, 'sev', _poSeverity);
      result.taskUpdates.push({ action: 'objective-proposed', proposalId: _poEntry.id, agentId: agentId });

    } else if (action.type === 'request-budget' && action.request) {
      // Capital Allocation (System 12): agent proposes spend on experiment/campaign/
      // high-cost-action. Tiered routing by estimatedCost + system squeeze mode.
      var _rb = action.request;
      var _rbType = ['experiment', 'campaign', 'high-cost-action'].indexOf(_rb.type) !== -1 ? _rb.type : null;
      var _rbCost = Number(_rb.estimatedCost);
      var _rbJust = (_rb.justification || '').trim();
      if (!_rbType || !Number.isFinite(_rbCost) || _rbCost <= 0 || !_rbJust) {
        context.log('[Heartbeat]', agentId, 'BLOCKED request-budget — missing type / estimatedCost / justification');
        continue;
      }
      if (_rbCost > 25) {
        context.log('[Heartbeat]', agentId, 'BLOCKED request-budget — estimatedCost $' + _rbCost + ' exceeds sanity ceiling ($25)');
        continue;
      }

      var _rbAlloc = (await storage.getState('capitalAllocation')) || {};
      var _rbPending = Array.isArray(_rbAlloc.pendingRequests) ? _rbAlloc.pendingRequests : [];
      var _rbLog = Array.isArray(_rbAlloc.decisionLog) ? _rbAlloc.decisionLog : [];
      var _rbSqueeze = (_rbAlloc.systemBudget > 0)
        ? ((_rbAlloc.systemSpent || 0) / _rbAlloc.systemBudget) * 100 >= CAPITAL_DECISION_THRESHOLDS.systemBudgetSqueezePct
        : false;
      var _rbSystemRed = (_rbAlloc.systemStatus === 'RED');

      // Dedup: identical pending request from same agent in last 24h
      var _rbDupe = _rbPending.some(function (r) {
        return r.agentId === agentId && r.type === _rbType &&
          Math.abs((r.estimatedCost || 0) - _rbCost) < 0.01 &&
          (r.justification || '').trim() === _rbJust &&
          (r.status === 'pending_cipher' || r.status === 'pending_ceo');
      });
      if (_rbDupe) {
        context.log('[Heartbeat]', agentId, 'BLOCKED request-budget — duplicate pending request');
        continue;
      }

      var _rbId = 'breq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      var _rbStatus;
      var _rbAutoDecision = null;
      if (_rbCost < CAPITAL_DECISION_THRESHOLDS.autoApproveBelow && !_rbSqueeze && !_rbSystemRed) {
        _rbStatus = 'approved';
        _rbAutoDecision = { decision: 'approved', note: 'auto-approved (under $' + CAPITAL_DECISION_THRESHOLDS.autoApproveBelow + ' threshold)', at: new Date().toISOString() };
      } else if (_rbCost < CAPITAL_DECISION_THRESHOLDS.cipherApprovalBelow) {
        _rbStatus = 'pending_cipher';
      } else {
        _rbStatus = 'pending_ceo';
      }

      var _rbEntry = {
        id: _rbId,
        agentId: agentId,
        type: _rbType,
        requestedAt: new Date().toISOString(),
        estimatedCost: Math.round(_rbCost * 100) / 100,
        justification: _rbJust.substring(0, 500),
        contextActionId: _rb.contextActionId || null,
        contextCampaignId: _rb.contextCampaignId || null,
        status: _rbStatus,
        cipherDecision: _rbAutoDecision ? { decision: 'approved', note: _rbAutoDecision.note, at: _rbAutoDecision.at, autoApproved: true } : null,
        ceoDecision: null
      };
      _rbPending.push(_rbEntry);

      if (_rbAutoDecision) {
        _rbLog.push({
          id: 'dlog_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          requestId: _rbId, agentId: agentId, decisionBy: 'auto',
          action: 'approved', estimatedCost: _rbEntry.estimatedCost,
          reason: _rbAutoDecision.note, at: _rbAutoDecision.at
        });
      }

      // CEO-escalated tier also lands in approvalQueue
      if (_rbStatus === 'pending_ceo') {
        var _rbAQ = (await storage.getState('approvalQueue')) || [];
        _rbAQ.push({
          id: 'aq_' + _rbId,
          type: 'budget_request',
          kind: 'budget_request',
          status: 'pending',
          proposedBy: agentId,
          requestId: _rbId,
          estimatedCost: _rbEntry.estimatedCost,
          requestType: _rbType,
          justification: _rbEntry.justification,
          createdAt: new Date().toISOString()
        });
        await storage.setState('approvalQueue', _rbAQ);
      }

      _rbAlloc.pendingRequests = _rbPending;
      _rbAlloc.decisionLog = _rbLog.slice(-100);
      _rbAlloc.updatedAt = new Date().toISOString();
      await storage.setState('capitalAllocation', _rbAlloc);

      context.log('[Heartbeat]', agentId, 'budget request:', _rbId, '$' + _rbEntry.estimatedCost, _rbType, '→', _rbStatus);
      result.taskUpdates.push({ action: 'budget-requested', requestId: _rbId, agentId: agentId, status: _rbStatus });

    } else if (action.type === 'approve-budget-request' && action.requestId) {
      // Cipher-only gate: decide on a pending budget request
      if (!CAPITAL_AUTHORIZED_AGENTS.has(agentId)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED approve-budget-request — only Cipher authorized');
        continue;
      }
      var _abDecision = action.decision === 'approved' ? 'approved' : (action.decision === 'rejected' ? 'rejected' : null);
      if (!_abDecision) {
        context.log('[Heartbeat]', agentId, 'BLOCKED approve-budget-request — decision must be approved or rejected');
        continue;
      }
      var _abNote = (action.note || '').trim().substring(0, 500);
      if (!_abNote) {
        context.log('[Heartbeat]', agentId, 'BLOCKED approve-budget-request — note required (cite reasoning)');
        continue;
      }

      var _abAlloc = (await storage.getState('capitalAllocation')) || {};
      var _abPending = Array.isArray(_abAlloc.pendingRequests) ? _abAlloc.pendingRequests : [];
      var _abLog = Array.isArray(_abAlloc.decisionLog) ? _abAlloc.decisionLog : [];
      var _abTarget = _abPending.find(function (r) { return r.id === action.requestId && r.status === 'pending_cipher'; });
      if (!_abTarget) {
        context.log('[Heartbeat]', agentId, 'BLOCKED approve-budget-request — request not found or not pending_cipher:', action.requestId);
        continue;
      }

      _abTarget.status = _abDecision;
      _abTarget.cipherDecision = { decision: _abDecision, note: _abNote, at: new Date().toISOString() };
      _abLog.push({
        id: 'dlog_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        requestId: _abTarget.id,
        agentId: _abTarget.agentId,
        decisionBy: 'cipher',
        action: _abDecision,
        estimatedCost: _abTarget.estimatedCost,
        reason: _abNote,
        at: new Date().toISOString()
      });

      _abAlloc.pendingRequests = _abPending;
      _abAlloc.decisionLog = _abLog.slice(-100);
      _abAlloc.updatedAt = new Date().toISOString();
      await storage.setState('capitalAllocation', _abAlloc);

      // 2d. Auto-memory feedback to requesting agent on reject (also on approve — confirms pattern works).
      try {
        var _abReqAgent = _abTarget.agentId;
        if (!_agentMemoryStore[_abReqAgent]) _agentMemoryStore[_abReqAgent] = [];
        var _abNow = new Date();
        var _abMemText = _abDecision === 'rejected'
          ? 'Cipher rejected my budget request ' + _abTarget.id + ' ($' + _abTarget.estimatedCost + ' for ' + _abTarget.type + '): ' + _abNote.substring(0, 200) + ' — adjust future proposals accordingly.'
          : 'Cipher approved my budget request ' + _abTarget.id + ' ($' + _abTarget.estimatedCost + ' for ' + _abTarget.type + '): ' + _abNote.substring(0, 200);
        _agentMemoryStore[_abReqAgent].push({
          id: 'mem_' + Date.now() + '_br_' + Math.random().toString(36).substr(2, 4),
          type: 'feedback',
          text: _abMemText,
          source: _abDecision === 'rejected' ? 'auto:budget-rejected' : 'auto:budget-approved',
          evidence: { runId: cycleId, requestId: _abTarget.id },
          timestamp: _abNow.toISOString(),
          expiresAt: new Date(_abNow.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });
        if (_agentMemoryStore[_abReqAgent].length > MAX_MEMORIES_PER_AGENT) {
          _agentMemoryStore[_abReqAgent] = _agentMemoryStore[_abReqAgent].slice(-MAX_MEMORIES_PER_AGENT);
        }
      } catch (_abMemErr) {
        context.log('[Heartbeat]', agentId, 'Budget-decision auto-memory failed (non-fatal):', String(_abMemErr).substring(0, 200));
      }

      context.log('[Heartbeat]', agentId, 'budget decision:', _abTarget.id, _abDecision, '→', _abTarget.agentId);
      result.taskUpdates.push({ action: 'budget-decided', requestId: _abTarget.id, decision: _abDecision });

    } else if (action.type === 'propose-product' && action.product) {
      // Goal Generation (System 13) — Nova proposes a new product.
      const _pp = action.product;
      const _ppName = (_pp.name || '').trim().substring(0, 60);
      const _ppDesc = (_pp.description || '').trim();
      const _ppRat = (_pp.rationale || '').trim();
      const _ppMkt = (_pp.market || '').trim();
      const _ppStrat = (_pp.launchStrategy || '').trim();
      const _ppSucc = (_pp.successCriteria || '').trim();
      const _ppCost = Number(_pp.estimatedCost);

      if (!_ppName || !_ppDesc || !_ppRat || !_ppMkt || !_ppStrat || !_ppSucc) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-product — missing required fields (name, description, rationale, market, launchStrategy, successCriteria)');
        continue;
      }
      if (!Number.isFinite(_ppCost) || _ppCost <= 0) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-product — estimatedCost required and must be > 0');
        continue;
      }
      const _ppCeiling = PRODUCT_PROPOSAL_COST_CEILINGS['propose-product'];
      if (_ppCost > _ppCeiling) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-product — estimatedCost $' + _ppCost + ' exceeds ceiling $' + _ppCeiling);
        continue;
      }
      // Must not already be a known product
      const _ppExisting = Object.keys(_productFacts.products || {}).map(function (k) { return k.toLowerCase(); });
      if (_ppExisting.indexOf(_ppName.toLowerCase()) !== -1) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-product — product already exists in product-facts.json:', _ppName);
        continue;
      }
      const _ppAQ = (await storage.getState('approvalQueue')) || [];
      const _ppGate = _productProposalGate(agentId, 'product_proposal', _ppName.toLowerCase(), _ppAQ);
      if (_ppGate.blocked) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-product —', _ppGate.reason);
        continue;
      }
      const _ppCapGate = await _productCapitalGate(agentId, _ppCost, storage);
      if (_ppCapGate.blocked) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-product (Capital) —', _ppCapGate.reason);
        continue;
      }

      const _ppEntry = {
        id: 'pprop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'product_proposal',
        status: 'pending',
        proposedBy: agentId,
        product: {
          name: _ppName,
          description: _ppDesc.substring(0, 1000),
          rationale: _ppRat.substring(0, 500),
          market: _ppMkt.substring(0, 300),
          launchStrategy: _ppStrat.substring(0, 500),
          successCriteria: _ppSucc.substring(0, 300),
          estimatedTimeline: (_pp.estimatedTimeline || '').substring(0, 100)
        },
        estimatedCost: Math.round(_ppCost * 100) / 100,
        evidence: { runId: cycleId },
        createdAt: new Date().toISOString()
      };
      _ppAQ.push(_ppEntry);
      await storage.setState('approvalQueue', _ppAQ);
      context.log('[Heartbeat]', agentId, 'propose-product:', _ppEntry.id, _ppName, '$' + _ppEntry.estimatedCost);
      result.taskUpdates.push({ action: 'product-proposed', proposalId: _ppEntry.id, agentId: agentId });

    } else if (action.type === 'propose-pivot' && action.pivot) {
      // Goal Generation (System 13) — Nova proposes a strategic pivot on an existing product.
      const _piv = action.pivot;
      const _pivTarget = (_piv.targetProduct || '').trim();
      const _pivDir = (_piv.newDirection || '').trim();
      const _pivRat = (_piv.rationale || '').trim();
      const _pivSucc = (_piv.successCriteria || '').trim();
      const _pivPlan = (_piv.transitionPlan || '').trim();
      const _pivCost = Number(_piv.estimatedCost);

      if (!_pivTarget || !_pivDir || !_pivRat || !_pivSucc || !_pivPlan) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-pivot — missing required fields');
        continue;
      }
      if (!Number.isFinite(_pivCost) || _pivCost <= 0) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-pivot — estimatedCost required');
        continue;
      }
      const _pivCeiling = PRODUCT_PROPOSAL_COST_CEILINGS['propose-pivot'];
      if (_pivCost > _pivCeiling) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-pivot — estimatedCost $' + _pivCost + ' exceeds ceiling $' + _pivCeiling);
        continue;
      }
      // Target must exist as active product (case-insensitive)
      const _pivProducts = _productFacts.products || {};
      const _pivMatch = Object.keys(_pivProducts).find(function (k) { return k.toLowerCase() === _pivTarget.toLowerCase(); });
      if (!_pivMatch) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-pivot — target product not found:', _pivTarget);
        continue;
      }
      if (_pivProducts[_pivMatch].status && _pivProducts[_pivMatch].status !== 'active') {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-pivot — target product not active:', _pivMatch);
        continue;
      }
      const _pivAQ = (await storage.getState('approvalQueue')) || [];
      const _pivGate = _productProposalGate(agentId, 'product_pivot_proposal', _pivMatch.toLowerCase(), _pivAQ);
      if (_pivGate.blocked) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-pivot —', _pivGate.reason);
        continue;
      }
      const _pivCapGate = await _productCapitalGate(agentId, _pivCost, storage);
      if (_pivCapGate.blocked) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-pivot (Capital) —', _pivCapGate.reason);
        continue;
      }

      const _pivEntry = {
        id: 'pivprop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'product_pivot_proposal',
        status: 'pending',
        proposedBy: agentId,
        pivot: {
          targetProduct: _pivMatch,
          newDirection: _pivDir.substring(0, 500),
          rationale: _pivRat.substring(0, 500),
          successCriteria: _pivSucc.substring(0, 300),
          transitionPlan: _pivPlan.substring(0, 500)
        },
        estimatedCost: Math.round(_pivCost * 100) / 100,
        evidence: { runId: cycleId },
        createdAt: new Date().toISOString()
      };
      _pivAQ.push(_pivEntry);
      await storage.setState('approvalQueue', _pivAQ);
      context.log('[Heartbeat]', agentId, 'propose-pivot:', _pivEntry.id, _pivMatch, '$' + _pivEntry.estimatedCost);
      result.taskUpdates.push({ action: 'pivot-proposed', proposalId: _pivEntry.id, agentId: agentId });

    } else if (action.type === 'propose-retire' && action.retire) {
      // Goal Generation (System 13) — Nova proposes retiring a product.
      const _ret = action.retire;
      const _retTarget = (_ret.targetProduct || '').trim();
      const _retRat = (_ret.rationale || '').trim();
      const _retPlan = (_ret.migrationPlan || '').trim();
      const _retCost = Number.isFinite(Number(_ret.estimatedCost)) ? Number(_ret.estimatedCost) : 0;

      if (!_retTarget || !_retRat || !_retPlan) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-retire — missing required fields (targetProduct, rationale, migrationPlan)');
        continue;
      }
      const _retCeiling = PRODUCT_PROPOSAL_COST_CEILINGS['propose-retire'];
      if (_retCost < 0 || _retCost > _retCeiling) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-retire — estimatedCost $' + _retCost + ' out of range (0-$' + _retCeiling + ')');
        continue;
      }
      const _retProducts = _productFacts.products || {};
      const _retMatch = Object.keys(_retProducts).find(function (k) { return k.toLowerCase() === _retTarget.toLowerCase(); });
      if (!_retMatch) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-retire — target product not found:', _retTarget);
        continue;
      }
      if (_retProducts[_retMatch].status && _retProducts[_retMatch].status !== 'active') {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-retire — target not active (already retired?):', _retMatch);
        continue;
      }
      // Extra guard: warn if target has significant live signal — require rationale to acknowledge.
      try {
        const _retBlogViews = (await storage.getState('blogPostViews')) || [];
        const _retSevenDayAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const _retViews = _retBlogViews.filter(function (v) {
          const tsv = Date.parse(v.timestamp || v.at || '');
          return Number.isFinite(tsv) && tsv >= _retSevenDayAgo &&
            String(v.slug || v.title || '').toLowerCase().indexOf(_retMatch.toLowerCase()) !== -1;
        }).length;
        const _retCamps = ((await storage.getState('campaigns')) || []).filter(function (c) {
          return c.status === 'active' && String(c.product || '').toLowerCase() === _retMatch.toLowerCase();
        });
        if ((_retViews > 100 || _retCamps.length > 0) && !/live|traffic|active|aware/i.test(_retRat)) {
          context.log('[Heartbeat]', agentId, 'WARN propose-retire — target has live signal (' + _retViews + ' blog views 7d, ' + _retCamps.length + ' active campaigns) and rationale does not acknowledge. Proceeding but flagging.');
        }
      } catch (_retGuardErr) { /* non-fatal guard */ }

      const _retAQ = (await storage.getState('approvalQueue')) || [];
      const _retGate = _productProposalGate(agentId, 'product_retire_proposal', _retMatch.toLowerCase(), _retAQ);
      if (_retGate.blocked) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-retire —', _retGate.reason);
        continue;
      }

      const _retEntry = {
        id: 'retprop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'product_retire_proposal',
        status: 'pending',
        proposedBy: agentId,
        retire: {
          targetProduct: _retMatch,
          rationale: _retRat.substring(0, 500),
          migrationPlan: _retPlan.substring(0, 500)
        },
        estimatedCost: Math.round(_retCost * 100) / 100,
        evidence: { runId: cycleId },
        createdAt: new Date().toISOString()
      };
      _retAQ.push(_retEntry);
      await storage.setState('approvalQueue', _retAQ);
      context.log('[Heartbeat]', agentId, 'propose-retire:', _retEntry.id, _retMatch, '$' + _retEntry.estimatedCost);
      result.taskUpdates.push({ action: 'retire-proposed', proposalId: _retEntry.id, agentId: agentId });

    } else if (action.type === 'propose-hire-agent' && action.hire) {
      // Agent Identity Evolution (System 14) — Forge proposes hiring a new agent.
      const _hr = action.hire;
      const _hrId = String(_hr.id || '').trim().toLowerCase();
      const _hrName = String(_hr.name || '').trim().substring(0, 20);
      const _hrRole = String(_hr.role || '').trim();
      const _hrTier = Number(_hr.tier);
      const _hrFocus = String(_hr.focus || '').trim();
      const _hrReportsTo = _hr.reportsTo === null ? null : String(_hr.reportsTo || '').trim().toLowerCase();
      const _hrCap = Number(_hr.monthlyCap);
      const _hrDoc = _hr.doctrine || null;
      const _hrMix = _hr.expectedActionMix || null;
      const _hrTpl = String(_hr.systemPromptTemplate || '').trim();
      const _hrRat = String(_hr.rationale || '').trim();

      if (!_hrId || !/^[a-z][a-z0-9]{1,11}$/.test(_hrId)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-hire-agent — id must be lowercase alphanumeric, 2-12 chars, start with letter');
        continue;
      }
      if (!_hrName || !_hrRole || !_hrFocus || !_hrRat || !_hrTpl) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-hire-agent — missing required string fields');
        continue;
      }
      if (![2, 3, 4].includes(_hrTier)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-hire-agent — tier must be 2, 3, or 4');
        continue;
      }
      if (!_hrDoc || !_hrMix || typeof _hrDoc !== 'object' || typeof _hrMix !== 'object') {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-hire-agent — doctrine and expectedActionMix required');
        continue;
      }
      const _hrCeiling = FLEET_PROPOSAL_COST_CEILINGS['propose-hire-agent'];
      if (!Number.isFinite(_hrCap) || _hrCap <= 0 || _hrCap > _hrCeiling) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-hire-agent — monthlyCap $' + _hrCap + ' out of range (0-$' + _hrCeiling + ')');
        continue;
      }
      // Registry lookup: id must not exist (active or archived — no reuse)
      const _hrRegistry = (await storage.getState('agentRegistry')) || { agents: [] };
      if (_hrRegistry.agents.some(function (a) { return a.id === _hrId; })) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-hire-agent — id already exists in registry:', _hrId);
        continue;
      }
      if (_hrReportsTo !== null && !_hrRegistry.agents.some(function (a) { return a.id === _hrReportsTo && a.status === 'active'; })) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-hire-agent — reportsTo must be an existing active agent or null:', _hrReportsTo);
        continue;
      }
      const _hrActiveCount = _hrRegistry.agents.filter(function (a) { return a.status === 'active'; }).length;
      if (_hrActiveCount + 1 > FLEET_MAX_SIZE) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-hire-agent — fleet at max size (' + FLEET_MAX_SIZE + ')');
        continue;
      }
      const _hrAQ = (await storage.getState('approvalQueue')) || [];
      const _hrGate = _fleetProposalGate(agentId, 'agent_hire_proposal', 'hire:' + _hrId, _hrAQ);
      if (_hrGate.blocked) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-hire-agent —', _hrGate.reason);
        continue;
      }
      // Capital gate (reuse product capital gate — same 24h-bypass pattern)
      const _hrCapGate = await _productCapitalGate(agentId, _hrCap, storage);
      if (_hrCapGate.blocked) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-hire-agent (Capital) —', _hrCapGate.reason);
        continue;
      }

      const _hrEntry = {
        id: 'hirepr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'agent_hire_proposal',
        status: 'pending',
        proposedBy: agentId,
        hire: {
          id: _hrId, name: _hrName, role: _hrRole.substring(0, 100),
          tier: _hrTier, focus: _hrFocus.substring(0, 500),
          reportsTo: _hrReportsTo, monthlyCap: Math.round(_hrCap * 100) / 100,
          doctrine: _hrDoc, expectedActionMix: _hrMix,
          systemPromptTemplate: _hrTpl.substring(0, 1000),
          rationale: _hrRat.substring(0, 500),
          estimatedMonthlySpend: Math.round((Number(_hr.estimatedMonthlySpend) || _hrCap) * 100) / 100
        },
        estimatedCost: Math.round(_hrCap * 100) / 100,
        evidence: { runId: cycleId },
        createdAt: new Date().toISOString()
      };
      _hrAQ.push(_hrEntry);
      await storage.setState('approvalQueue', _hrAQ);
      context.log('[Heartbeat]', agentId, 'propose-hire-agent:', _hrEntry.id, _hrId, '$' + _hrCap);
      result.taskUpdates.push({ action: 'agent-hire-proposed', proposalId: _hrEntry.id, agentId: agentId });

    } else if (action.type === 'propose-retire-agent' && action.retire) {
      // Agent Identity Evolution (System 14) — Forge proposes retiring an agent.
      const _ra = action.retire;
      const _raTarget = String(_ra.targetAgent || '').trim().toLowerCase();
      const _raRat = String(_ra.rationale || '').trim();
      const _raPlan = String(_ra.reassignmentPlan || '').trim();
      const _raCost = Number.isFinite(Number(_ra.estimatedWinddownCost)) ? Number(_ra.estimatedWinddownCost) : 0;

      if (!_raTarget || !_raRat || !_raPlan) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-retire-agent — missing required fields');
        continue;
      }
      // PROTECTED_AGENTS hard block
      if (PROTECTED_AGENTS.has(_raTarget)) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-retire-agent — target in PROTECTED_AGENTS:', _raTarget);
        continue;
      }
      // Self-proposal hard block
      if (agentId === _raTarget) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-retire-agent — cannot propose own retirement');
        continue;
      }
      const _raRegistry = (await storage.getState('agentRegistry')) || { agents: [] };
      const _raTargetEntry = _raRegistry.agents.find(function (a) { return a.id === _raTarget; });
      if (!_raTargetEntry || _raTargetEntry.status !== 'active') {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-retire-agent — target not found or not active:', _raTarget);
        continue;
      }
      const _raActiveCount = _raRegistry.agents.filter(function (a) { return a.status === 'active'; }).length;
      if (_raActiveCount - 1 < FLEET_MIN_SIZE) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-retire-agent — retiring would drop fleet below FLEET_MIN_SIZE (' + FLEET_MIN_SIZE + ')');
        continue;
      }
      // Dependency warning (non-blocking)
      const _raOrphans = _raRegistry.agents.filter(function (a) {
        return a.status === 'active' && a.reportsTo === _raTarget;
      }).map(function (a) { return a.id; });
      if (_raOrphans.length > 0) {
        context.log('[Heartbeat]', agentId, 'WARN propose-retire-agent — retiring ' + _raTarget + ' orphans: ' + _raOrphans.join(','));
      }
      const _raAQ = (await storage.getState('approvalQueue')) || [];
      const _raGate = _fleetProposalGate(agentId, 'agent_retire_proposal', 'retire:' + _raTarget, _raAQ);
      if (_raGate.blocked) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-retire-agent —', _raGate.reason);
        continue;
      }

      const _raEntry = {
        id: 'retpr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'agent_retire_proposal',
        status: 'pending',
        proposedBy: agentId,
        retire: {
          targetAgent: _raTarget,
          rationale: _raRat.substring(0, 500),
          reassignmentPlan: _raPlan.substring(0, 500),
          estimatedWinddownCost: Math.round(_raCost * 100) / 100,
          orphans: _raOrphans
        },
        estimatedCost: Math.round(_raCost * 100) / 100,
        evidence: { runId: cycleId },
        createdAt: new Date().toISOString()
      };
      _raAQ.push(_raEntry);
      await storage.setState('approvalQueue', _raAQ);
      context.log('[Heartbeat]', agentId, 'propose-retire-agent:', _raEntry.id, _raTarget, 'orphans:', _raOrphans.length);
      result.taskUpdates.push({ action: 'agent-retire-proposed', proposalId: _raEntry.id, agentId: agentId });

    } else if (action.type === 'propose-role-evolution' && action.evolution) {
      // Agent Identity Evolution (System 14) — Forge proposes evolving an agent's role.
      const _ev = action.evolution;
      const _evTarget = String(_ev.targetAgent || '').trim().toLowerCase();
      const _evChanges = _ev.changes;
      const _evRat = String(_ev.rationale || '').trim();

      if (!_evTarget || !_evChanges || typeof _evChanges !== 'object' || !_evRat) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-role-evolution — missing required fields');
        continue;
      }
      // Self-proposal hard block
      if (agentId === _evTarget) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-role-evolution — cannot propose own evolution');
        continue;
      }
      // Protected fields: cannot change id/name/tier/status/hiredAt/retiredAt/reportsTo
      const _evProtected = ['id', 'name', 'tier', 'status', 'hiredAt', 'retiredAt', 'reportsTo'];
      const _evHasProtected = Object.keys(_evChanges).some(function (k) { return _evProtected.includes(k); });
      if (_evHasProtected) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-role-evolution — changes includes protected field (' + _evProtected.filter(function (k) { return k in _evChanges; }).join(',') + ')');
        continue;
      }
      const _evAllowed = ['focus', 'monthlyCap', 'doctrine', 'expectedActionMix'];
      const _evHasAllowed = Object.keys(_evChanges).some(function (k) { return _evAllowed.includes(k); });
      if (!_evHasAllowed) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-role-evolution — changes must include at least one of:', _evAllowed.join(','));
        continue;
      }
      // monthlyCap ceiling check
      if ('monthlyCap' in _evChanges) {
        const _evCeiling = FLEET_PROPOSAL_COST_CEILINGS['propose-role-evolution'];
        const _evCap = Number(_evChanges.monthlyCap);
        if (!Number.isFinite(_evCap) || _evCap <= 0 || _evCap > _evCeiling) {
          context.log('[Heartbeat]', agentId, 'BLOCKED propose-role-evolution — monthlyCap $' + _evCap + ' out of range (0-$' + _evCeiling + ')');
          continue;
        }
      }
      const _evRegistry = (await storage.getState('agentRegistry')) || { agents: [] };
      const _evTargetEntry = _evRegistry.agents.find(function (a) { return a.id === _evTarget; });
      if (!_evTargetEntry || _evTargetEntry.status !== 'active') {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-role-evolution — target not found or not active:', _evTarget);
        continue;
      }
      const _evAQ = (await storage.getState('approvalQueue')) || [];
      const _evGate = _fleetProposalGate(agentId, 'agent_evolution_proposal', 'evolve:' + _evTarget, _evAQ);
      if (_evGate.blocked) {
        context.log('[Heartbeat]', agentId, 'BLOCKED propose-role-evolution —', _evGate.reason);
        continue;
      }
      // Snapshot current values for fields that would change (for doctrineHistory on approve)
      const _evSnapshot = {};
      Object.keys(_evChanges).forEach(function (k) { _evSnapshot[k] = _evTargetEntry[k]; });

      const _evEntry = {
        id: 'evolpr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'agent_evolution_proposal',
        status: 'pending',
        proposedBy: agentId,
        evolution: {
          targetAgent: _evTarget,
          changes: _evChanges,
          rationale: _evRat.substring(0, 500),
          estimatedCostDelta: Math.round((Number(_ev.estimatedCostDelta) || 0) * 100) / 100,
          snapshot: _evSnapshot
        },
        estimatedCost: Math.round((Number(_ev.estimatedCostDelta) || 0) * 100) / 100,
        evidence: { runId: cycleId },
        createdAt: new Date().toISOString()
      };
      _evAQ.push(_evEntry);
      await storage.setState('approvalQueue', _evAQ);
      context.log('[Heartbeat]', agentId, 'propose-role-evolution:', _evEntry.id, _evTarget, 'fields:', Object.keys(_evChanges).join(','));
      result.taskUpdates.push({ action: 'agent-evolution-proposed', proposalId: _evEntry.id, agentId: agentId });

    } else if (action.type === 'pause-campaign' && action.campaignId) {
      // Nova can pause an active campaign (reversible, auto-execute)
      var _pauseCamps = (await storage.getState('campaigns')) || [];
      var _pauseTarget = _pauseCamps.find(function (c) { return c.id === action.campaignId && c.status === 'active'; });
      // CEO-resume protection: a campaign the CEO explicitly resumed is a standing
      // human decision — agents may not override it for 7 days. Nova re-paused both
      // CEO-resumed campaigns within hours on 2026-07-28 (pause war). A fresh CEO
      // resume restarts the window; after 7 days the agent case can be re-argued.
      if (_pauseTarget && _pauseTarget.resumedBy === 'ceo' &&
          Date.now() - Date.parse(_pauseTarget.resumedAt || 0) < 7 * 86400000) {
        context.log('[Heartbeat]', agentId, 'BLOCKED pause-campaign — CEO resumed this campaign', _pauseTarget.resumedAt, ':', action.campaignId);
        await logEvent('policy-violation', agentId, 'pause-campaign blocked: CEO-resumed campaign is protected 7d', cycleId,
          { gate: 'ceo_resume_protected', campaignId: action.campaignId, resumedAt: _pauseTarget.resumedAt });
        try {
          if (!_agentMemoryStore[agentId]) _agentMemoryStore[agentId] = [];
          _agentMemoryStore[agentId].push({
            id: 'mem_' + Date.now() + '_crp_' + Math.random().toString(36).substr(2, 4),
            type: 'feedback',
            text: 'The CEO explicitly resumed "' + (_pauseTarget.title || action.campaignId) + '" — my pause was blocked (7-day protection). CEO decisions on campaign state are standing orders; argue the case in observations instead of re-pausing. Note: pausing campaigns cuts posting volume, NOT the heartbeat LLM spend that drives the budget.',
            source: 'auto:governance',
            timestamp: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
            evidence: { runId: cycleId }
          });
          if (_agentMemoryStore[agentId].length > MAX_MEMORIES_PER_AGENT) {
            _agentMemoryStore[agentId] = _agentMemoryStore[agentId].slice(-MAX_MEMORIES_PER_AGENT);
          }
        } catch (_crpErr) { /* non-fatal */ }
        continue;
      }
      if (_pauseTarget) {
        _pauseTarget.status = 'paused';
        _pauseTarget.pausedAt = new Date().toISOString();
        _pauseTarget.pausedBy = agentId;
        _pauseTarget.pauseReason = (action.reason || '').substring(0, 200);
        await storage.setState('campaigns', _pauseCamps);
        context.log('[Heartbeat]', agentId, 'paused campaign:', action.campaignId);
        result.taskUpdates.push({ action: 'campaign-paused', campaignId: action.campaignId, agentId: agentId });
      }

    } else if (action.type === 'resume-campaign' && action.campaignId) {
      var _resCamps = (await storage.getState('campaigns')) || [];
      var _resTarget = _resCamps.find(function (c) { return c.id === action.campaignId && c.status === 'paused'; });
      if (_resTarget) {
        // 48-hour cooldown check
        var _pausedAt = Date.parse(_resTarget.pausedAt || '');
        if (Number.isFinite(_pausedAt) && (Date.now() - _pausedAt) < 48 * 60 * 60 * 1000) {
          context.log('[Heartbeat]', agentId, 'BLOCKED resume-campaign — 48hr pause cooldown not met:', action.campaignId);
          continue;
        }
        _resTarget.status = 'active';
        _resTarget.resumedAt = new Date().toISOString();
        _resTarget.resumedBy = agentId;
        await storage.setState('campaigns', _resCamps);
        context.log('[Heartbeat]', agentId, 'resumed campaign:', action.campaignId);
        result.taskUpdates.push({ action: 'campaign-resumed', campaignId: action.campaignId, agentId: agentId });
      }

    } else if (action.type === 'complete-campaign' && action.campaignId) {
      var _compCamps = (await storage.getState('campaigns')) || [];
      var _compTarget = _compCamps.find(function (c) { return c.id === action.campaignId && c.status === 'active'; });
      if (_compTarget) {
        _compTarget.status = 'completed';
        _compTarget.completedAt = new Date().toISOString();
        _compTarget.completedBy = agentId;
        await storage.setState('campaigns', _compCamps);
        context.log('[Heartbeat]', agentId, 'completed campaign:', action.campaignId);
        result.taskUpdates.push({ action: 'campaign-completed', campaignId: action.campaignId, agentId: agentId });
      }

    } else if (action.type === 'archive-objective' && action.objectiveId) {
      var _archObjs = (await storage.getState('objectives')) || [];
      var _archTarget = _archObjs.find(function (o) { return o.id === action.objectiveId; });
      if (_archTarget && _archTarget.status !== 'archived') {
        _archTarget.status = 'archived';
        _archTarget.archivedAt = new Date().toISOString();
        _archTarget.archivedBy = agentId;
        await storage.setState('objectives', _archObjs);
        context.log('[Heartbeat]', agentId, 'archived objective:', action.objectiveId);
        result.taskUpdates.push({ action: 'objective-archived', objectiveId: action.objectiveId, agentId: agentId });
      }

    } else if (action.type === 'link-campaign-to-objective' && action.campaignId && action.objectiveId) {
      // Nova adopts an orphaned goal / re-parents a campaign (reversible, auto-
      // execute — same trust tier as pause/resume). Added 2026-07-28 with the
      // objective-consolidation hardening: 8 of 11 objectives sat orphaned while
      // campaigns dogpiled obj-first-customer.
      if (agentId !== 'nova') {
        context.log('[Heartbeat]', agentId, 'BLOCKED link-campaign-to-objective — Nova-only lifecycle action');
        await logEvent('policy-violation', agentId, 'link-campaign-to-objective blocked: Nova-only', cycleId,
          { gate: 'lifecycle_unauthorized', campaignId: action.campaignId, objectiveId: action.objectiveId });
        continue;
      }
      var _lkCamps = (await storage.getState('campaigns')) || [];
      var _lkObjs = (await storage.getState('objectives')) || [];
      var _lkCamp = _lkCamps.find(function (c) { return c && c.id === action.campaignId && !c.deletedAt && (c.status === 'active' || c.status === 'paused'); });
      var _lkObj = _lkObjs.find(function (o) { return o && o.id === action.objectiveId && o.status === 'active' && !o.deletedAt; });
      if (!_lkCamp || !_lkObj) {
        context.log('[Heartbeat]', agentId, 'BLOCKED link-campaign-to-objective — ' + (!_lkCamp ? 'campaign not found/not linkable: ' + action.campaignId : 'objective not found/not active: ' + action.objectiveId));
        continue;
      }
      if (_lkCamp.objective_id === _lkObj.id) {
        context.log('[Heartbeat]', agentId, 'link-campaign-to-objective no-op — already linked:', action.campaignId, '→', action.objectiveId);
        continue;
      }
      var _lkPrev = _lkCamp.objective_id || null;
      _lkCamp.objective_id = _lkObj.id;
      _lkCamp.pendingObjectiveProposalId = null;
      _lkCamp.linkedBy = agentId;
      _lkCamp.linkedAt = new Date().toISOString();
      _lkCamp.linkReason = (action.reason || '').substring(0, 300);
      // Maintain both back-link arrays (linkedCampaigns + legacy linkedDirectives):
      // strip from every other objective, add to the new parent. Progress/timeline
      // derivation on the Goals page reads these.
      _lkObjs.forEach(function (o) {
        if (!o) return;
        ['linkedCampaigns', 'linkedDirectives'].forEach(function (k) {
          if (!Array.isArray(o[k])) return;
          if (o.id !== _lkObj.id) { o[k] = o[k].filter(function (id) { return id !== _lkCamp.id; }); }
        });
      });
      if (!Array.isArray(_lkObj.linkedCampaigns)) _lkObj.linkedCampaigns = [];
      if (_lkObj.linkedCampaigns.indexOf(_lkCamp.id) === -1) _lkObj.linkedCampaigns.push(_lkCamp.id);
      if (Array.isArray(_lkObj.linkedDirectives) && _lkObj.linkedDirectives.indexOf(_lkCamp.id) === -1) _lkObj.linkedDirectives.push(_lkCamp.id);
      await storage.setState('campaigns', _lkCamps);
      await storage.setState('objectives', _lkObjs);
      await logEvent('campaign-linked', agentId, 'Linked campaign "' + (_lkCamp.title || _lkCamp.id) + '" to objective "' + (_lkObj.title || _lkObj.id) + '"' + (_lkPrev ? ' (was ' + _lkPrev + ')' : ' (was orphaned)'), cycleId,
        { campaignId: _lkCamp.id, objectiveId: _lkObj.id, previousObjectiveId: _lkPrev, reason: _lkCamp.linkReason });
      context.log('[Heartbeat]', agentId, 'linked campaign', _lkCamp.id, '→ objective', _lkObj.id, _lkPrev ? '(was ' + _lkPrev + ')' : '(was orphaned)');
      result.taskUpdates.push({ action: 'campaign-linked', campaignId: _lkCamp.id, objectiveId: _lkObj.id, agentId: agentId });

    } else if (action.type === 'cancel-campaign' && action.campaignId) {
      // Irreversible — goes to CEO approval queue
      var _ccAQ = (await storage.getState('approvalQueue')) || [];
      _ccAQ.push({
        id: 'ccancel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'campaign_cancellation',
        status: 'pending',
        proposedBy: agentId,
        campaignId: action.campaignId,
        reason: (action.reason || '').substring(0, 500),
        createdAt: new Date().toISOString()
      });
      await storage.setState('approvalQueue', _ccAQ);
      context.log('[Heartbeat]', agentId, 'proposed campaign cancellation:', action.campaignId);

    } else if (action.type === 'cancel-objective' && action.objectiveId) {
      var _coAQ = (await storage.getState('approvalQueue')) || [];
      _coAQ.push({
        id: 'ocancel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'objective_cancellation',
        status: 'pending',
        proposedBy: agentId,
        objectiveId: action.objectiveId,
        reason: (action.reason || '').substring(0, 500),
        createdAt: new Date().toISOString()
      });
      await storage.setState('approvalQueue', _coAQ);
      context.log('[Heartbeat]', agentId, 'proposed objective cancellation:', action.objectiveId);
    }

    await logEvent('agent-action', agentId, summary, cycleId);
    recentSummaries.add(summary);
    actionCount++;
  }

  result.actions = actionCount;

  // 0-action diagnostic: log why agent did nothing
  if (actionCount === 0 && agentTasks.length > 0) {
    const _idleTodo = agentTasks.filter(t => t.status === 'todo' || t.status === 'in-progress');
    const _triagedCount = _idleTodo.filter(t => t.comments && t.comments.some(c => c.author === 'nova' || c.author === 'system')).length;
    context.log('[Heartbeat] ZERO-ACTION DIAGNOSTIC:', agentId,
      '| assigned:', agentTasks.length,
      '| todo/in-progress:', _idleTodo.length,
      '| triaged:', _triagedCount,
      '| rawActionsFromLLM:', result.actionAttempts,
      '| dedupeExemptTypes: execute-task,create-doc,create-social-action,generate-image,create-content-package,review-task');
  }

  // ── Phase 2B: Process normalized proposals from new-format or explicit agent proposals ──
  for (var _pi = 0; _pi < normalized.proposals.length; _pi++) {
    var _agentProp = normalized.proposals[_pi];
    if (!_agentProp || typeof _agentProp !== 'object') continue;
    // Ensure required fields for validation — fill agent context if missing
    if (!_agentProp.agentId) _agentProp.agentId = agentId;
    if (!_agentProp.runId) _agentProp.runId = cycleId;
    if (!_agentProp.reasonBlocked) _agentProp.reasonBlocked = 'agent_proposed';
    if (!_agentProp.proposedAction) _agentProp.proposedAction = 'agent_suggestion';
    // Fix 7: Auto-wrap proposals missing payload — LLM sometimes returns flat proposals without nested payload
    if (!_agentProp.payload) {
      _agentProp.payload = {
        title: _agentProp.title || _agentProp.summary || _agentProp.proposedAction || 'Agent suggestion',
        category: _agentProp.category || 'maintenance',
        acceptanceCriteria: _agentProp.acceptanceCriteria || ['Define success criteria.'],
        evidence: { runId: _agentProp.runId, agentId: _agentProp.agentId, autoWrapped: true },
        objective_suggestion: _agentProp.objective_suggestion || _agentProp.objective_id || 'Agent-proposed improvement'
      };
    }
    // Fix 7b: Ensure objective linkage even if payload existed but lacked it
    if (_agentProp.payload && !_agentProp.payload.objective_id && !_agentProp.payload.objective_suggestion) {
      _agentProp.payload.objective_suggestion = _agentProp.objective_suggestion || _agentProp.objective_id || 'Agent-proposed improvement';
    }
    var _normProp = _normalizeProposal(_agentProp);
    if (_isValidProposal(_normProp)) {
      result.proposals.push(_normProp);
      context.log('[Heartbeat]', agentId, 'accepted new-format proposal:', (_normProp.payload && _normProp.payload.title) || '(untitled)');
    } else {
      context.log('[Heartbeat]', agentId, 'rejected invalid new-format proposal:', JSON.stringify({ type: _normProp && _normProp.type, agentId: _normProp && _normProp.agentId, runId: _normProp && _normProp.runId, hasPayload: !!(_normProp && _normProp.payload), hasTitle: !!(_normProp && _normProp.payload && _normProp.payload.title), hasCategory: !!(_normProp && _normProp.payload && _normProp.payload.category), hasAC: !!(_normProp && _normProp.payload && Array.isArray(_normProp.payload.acceptanceCriteria) && _normProp.payload.acceptanceCriteria.length > 0), hasEvidence: !!(_normProp && _normProp.payload && _normProp.payload.evidence && _normProp.payload.evidence.runId), hasObjective: !!(_normProp && _normProp.payload && (_normProp.payload.objective_id || _normProp.payload.objective_suggestion)), reasonBlocked: _normProp && _normProp.reasonBlocked, proposedAction: _normProp && _normProp.proposedAction }).substring(0, 500));
    }
  }

  // ── Phase 2B: Log normalized observations (replaces legacy parsed.observation) ──
  let _obsClamped = false;
  let _observationItems = normalized.observations.map(function (o) {
    if (typeof o === 'string') return o;
    if (o === null || o === undefined) return '';
    return String(o);
  }).filter(function (o) { return o.trim().length > 0; });
  if (_observationItems.length > MAX_OBSERVATIONS_PER_AGENT) {
    _observationItems = _observationItems.slice(0, MAX_OBSERVATIONS_PER_AGENT);
    _obsClamped = true;
  }
  _observationItems = _observationItems.map(function (o) {
    if (o.length > MAX_OBSERVATION_CHARS) {
      _obsClamped = true;
      return o.substring(0, MAX_OBSERVATION_CHARS);
    }
    return o;
  });
  if (_obsClamped) {
    if (typeof incPolicyGate === 'function') incPolicyGate('observation_clamp');
    // Observation clamping is benign storage housekeeping — trimming an agent's
    // notes down to MAX_OBSERVATIONS_PER_AGENT / MAX_OBSERVATION_CHARS. No action
    // is blocked and the agent did nothing disallowed, so this is run-health
    // telemetry (routes to `logs`), NOT a policy-violation (routes to the
    // CEO-facing governanceLog). Mirrors the 2026-04-15 activation_mode downgrade.
    await logEvent('run-health', agentId, 'Observation clamp applied', cycleId, {
      runId: cycleId,
      agentId: agentId,
      gate: 'observation_clamp',
      reason: 'exceeded_limits'
    });
  }

  for (var _obsIdx = 0; _obsIdx < _observationItems.length; _obsIdx++) {
    var _obs = _observationItems[_obsIdx];
    if (_obs && !recentSummaries.has(_obs)) {
      await logEvent('agent-action', agentId, agent.name + ': ' + _obs, cycleId);
    }
  }

  // Rate-limit feedback memory — if actions were dropped this cycle, write an auto-memory
  // so the agent sees it next heartbeat (via the memory block in their prompt). This closes
  // the learning loop without a separate channel. Uses `type: 'feedback'` + source tag so
  // the reflection-callout path in prompt-builders.js also surfaces it prominently.
  if (result.rateLimitDropped && result.rateLimitDropped > 0) {
    try {
      if (!_agentMemoryStore[agentId]) _agentMemoryStore[agentId] = [];
      const _rlNow = new Date();
      _agentMemoryStore[agentId].push({
        id: 'mem_' + Date.now() + '_rl_' + Math.random().toString(36).substr(2, 4),
        type: 'feedback',
        text: 'I emitted more than ' + GUARDRAILS.maxActionsPerCyclePerAgent + ' actions last cycle; ' +
          result.rateLimitDropped + ' were dropped by the rate limit. Prioritize and batch next time — the cap is '
          + GUARDRAILS.maxActionsPerCyclePerAgent + ' actions per heartbeat.',
        source: 'auto:rate-limit',
        timestamp: _rlNow.toISOString(),
        expiresAt: new Date(_rlNow.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });
      if (_agentMemoryStore[agentId].length > MAX_MEMORIES_PER_AGENT) {
        _agentMemoryStore[agentId] = _agentMemoryStore[agentId].slice(-MAX_MEMORIES_PER_AGENT);
      }
      context.log('[Heartbeat]', agentId, 'Rate-limit feedback memory written (' + result.rateLimitDropped + ' drops)');
    } catch (_rlErr) {
      context.log('[Heartbeat]', agentId, 'Rate-limit auto-memory failed (non-fatal):', String(_rlErr).substring(0, 200));
    }
  }

  // Silent-drop aggregates — one event per gate per run so the attempted-vs-executed
  // gap is auditable from governanceLog instead of only ephemeral console logs.
  // nova_domain_lead_skip is by-design routing (Nova deferring to a dept head), so it
  // routes to run-health telemetry, not the CEO-facing policy-violation stream — same
  // split as the observation_clamp downgrade above.
  try {
    for (var _sdGate in _silentDrops) {
      var _sd = _silentDrops[_sdGate];
      var _sdEventType = _sdGate === 'nova_domain_lead_skip' ? 'run-health' : 'policy-violation';
      await logEvent(_sdEventType, agentId,
        'Dropped ' + _sd.count + ' action(s) without execution: ' + _sdGate, cycleId, {
          runId: cycleId, gate: _sdGate, reason: 'silent_drop_aggregate',
          count: _sd.count, samples: _sd.samples
        });
    }
  } catch (_sdErr) {
    context.log('[Heartbeat]', agentId, 'silent-drop aggregate logging failed (non-fatal):', String(_sdErr).substring(0, 200));
  }
  result.silentDrops = _silentDrops;

  result.durationMs = Date.now() - _agentRunStartMs;
  return result;
}

module.exports = { runAgentHeartbeat, _validateContentQuality, _countQgFailures, _isHallucinationFailure, _detectProductFromTask, _buildStrongFeedbackBlock, QG_FAIL_CIRCUIT_BREAKER_THRESHOLD, QG_HALLUCINATION_KEYWORDS };
