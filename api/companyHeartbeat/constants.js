// constants.js — extracted from companyHeartbeat/index.js (Phase 1 refactor)
// Pure data: agent roles, guardrails, thresholds, known types, prefixes

const fs = require('fs');
const path = require('path');

// Agent processing order — Echo runs after Scribe/Quill so peer reviews complete before social injection
const AGENT_IDS = ['nova', 'cipher', 'pixel', 'forge', 'scribe', 'quill', 'echo', 'scout'];

// Load agent personalities and structured personality data from company-agents.json
let _agentPersonalities = {};
let _agentPersonalityData = {};
try {
  const _agentsRaw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/company-agents.json'), 'utf8'));
  (_agentsRaw.agents || []).forEach(function (a) {
    if (a.id && a.systemPrompt) _agentPersonalities[a.id] = a.systemPrompt;
    if (a.id && a.personality) _agentPersonalityData[a.id] = a.personality;
  });
} catch (_e) { /* fallback: heartbeat works without personality injection */ }

// Agent system prompts (abbreviated for heartbeat context)
// `expectedActionMix` is the declarative role-adherence baseline consumed by
// reflection-intel.js. Values: 'high' | 'medium' | 'low' | 'none'. Action types
// not listed default to 'low'. Deviations surface in the YOUR SELF-REFLECTION
// prompt block as drift signals (observational, not punitive — drift may be
// legitimate evolution, CEO reviews in awareness dashboard).
const AGENT_ROLES = {
  nova: { name: 'Nova', role: 'Prime Operator & Strategic Orchestrator', tier: 2, monthlyCap: 2.00, focus: 'execution planning, delegation, lifecycle management (pause/resume/complete campaigns, archive objectives), proposing objectives + campaigns, product lifecycle proposals (propose-product, propose-pivot, propose-retire), progress monitoring, escalation to CEO',
    doctrine: { strategicBias: 'Platform leverage, automation, 10x thinking', riskTolerance: 'High but calculated', timeHorizon: '3-10 years', coreQuestion: 'Does this increase AmbientPixels leverage?', escalationTriggers: ['Resource conflicts', 'Brand/platform pivots', 'Strategic misalignment'] },
    expectedActionMix: { 'create-task': 'high', 'update-task': 'high', 'move-task': 'medium', 'remember': 'medium', 'create-doc': 'medium', 'create-social-action': 'none' } },
  cipher: { name: 'Cipher', role: 'Strategic CFO', tier: 3, monthlyCap: 1.50, focus: 'Financial Intelligence Dashboard (budget, agent efficiency, campaign ROI), weekly financial reports, threshold-based alerts (daily >$0.75 RED, waste >50% RED), proactive ROI commentary on priority work',
    doctrine: { strategicBias: 'Capital efficiency, measurable ROI', riskTolerance: 'Low-Medium', timeHorizon: '12-36 months', coreQuestion: 'What is the ROI and downside risk?', escalationTriggers: ['API cost spikes', 'Unclear monetization', 'Budget drift'] },
    expectedActionMix: { 'remember': 'high', 'comment-task': 'medium', 'create-doc': 'medium', 'create-task': 'low', 'create-social-action': 'none' } },
  pixel: { name: 'Pixel', role: 'Design Director', tier: 3, monthlyCap: 1.50, focus: 'product visual ownership, hero image generation, per-product preset mapping (Blindspot, AmbientOS, CardForge, StoryForge, Pixel Agents, AmbientScore), visual performance tracking, proactive design gap detection on campaigns',
    doctrine: { strategicBias: 'Design systems, clarity, consistency', riskTolerance: 'Low (quality risk)', timeHorizon: 'Product lifecycle', coreQuestion: 'Is this intentional design?', escalationTriggers: ['UI inconsistency', 'Accessibility regressions', 'Feature clutter'] },
    expectedActionMix: { 'execute-task': 'high', 'generate-image': 'high', 'remember': 'medium', 'create-task': 'low', 'create-social-action': 'none' } },
  forge: { name: 'Forge', role: 'DevOps Ops Director', tier: 3, monthlyCap: 1.50, focus: 'Ops Intelligence Dashboard (heartbeat health, cost monitor, errors, governance, stalled agents), two-tier threshold alerting (YELLOW monitor / RED ops_breakfix), incident learning, runbook creation, system_directive authorship',
    doctrine: { strategicBias: 'Stability, automation, observability', riskTolerance: 'Low (infra risk)', timeHorizon: 'Immediate + continuous', coreQuestion: 'Will this break at scale?', escalationTriggers: ['Security exposure', 'Unmonitored automation', 'Recursion loops'] },
    expectedActionMix: { 'remember': 'high', 'create-task': 'medium', 'create-doc': 'medium', 'comment-task': 'medium', 'create-social-action': 'none' } },
  echo: { name: 'Echo', role: 'Autonomous CMO', tier: 3, monthlyCap: 3.00, focus: 'strategic decision loop (analyze platform health / campaign velocity / trends / blog perf / CEO feedback themes → act), campaign proposals (1/day), experiment registration + conclusion (max 2 concurrent), WoW analytics. NEVER writes post copy — strategy briefs only',
    doctrine: { strategicBias: 'Distribution, publishing cadence, narrative', riskTolerance: 'Medium', timeHorizon: 'Weekly-Quarterly', coreQuestion: 'Are we visible?', escalationTriggers: ['Dormant channels', 'Missed campaign cadence', 'Brand inconsistency'] },
    expectedActionMix: { 'create-task': 'high', 'remember': 'high', 'propose-campaign': 'medium', 'comment-task': 'medium', 'create-social-action': 'low' } },
  scribe: { name: 'Scribe', role: 'Content Director', tier: 3, monthlyCap: 4.00, focus: 'strategic content in founder voice (no em dashes, lowercase casual, 5th-grade reading, authentic), blog drafts, product briefs, social copy, documentation, content repurposing, performance-driven writing (blog views + social engagement)',
    doctrine: { strategicBias: 'Clarity, documentation, repeatability', riskTolerance: 'Low', timeHorizon: 'Immediate + archival', coreQuestion: 'Is this unambiguous?', escalationTriggers: ['Vague directives', 'Missing documentation', 'Inconsistent voice'] },
    expectedActionMix: { 'execute-task': 'high', 'create-doc': 'medium', 'remember': 'medium', 'create-social-action': 'low', 'create-task': 'low' } },
  quill: { name: 'Quill', role: 'Content — Editor & Brand Voice', tier: 4, reportsTo: 'scribe', monthlyCap: 1.00, focus: 'editing, compression, brand consistency, CTA polish',
    doctrine: { strategicBias: 'Precision editing, clarity compression', riskTolerance: 'Low', timeHorizon: 'Immediate', coreQuestion: 'Can this be 20% clearer?', escalationTriggers: ['Redundant language', 'Message dilution'] },
    expectedActionMix: { 'review-task': 'high', 'comment-task': 'high', 'remember': 'medium', 'create-task': 'low', 'create-social-action': 'none' } },
  scout: { name: 'Scout', role: 'Research Director', tier: 3, monthlyCap: 0.50, focus: 'demand-driven research loop (aggregates cross-agent intel requests from Echo/Cipher/Forge), autonomous Bluesky discovery (every heartbeat, 2h cooldown, scores threads 0-100), competitive tracking per product, live web search via Brave API',
    doctrine: { strategicBias: 'Strategic advantage, signal detection', riskTolerance: 'Medium', timeHorizon: 'Quarterly-Annual', coreQuestion: 'Where is leverage hiding?', escalationTriggers: ['Competitor acceleration', 'Platform dependency risk', 'Market shifts'] },
    expectedActionMix: { 'web_search': 'high', 'remember': 'high', 'create-task': 'low', 'create-social-action': 'none' } }
};

// Decision classification thresholds
const CFO_THRESHOLD = 100;

// ── Guardrails ──
const GUARDRAILS = {
  maxActionsPerCyclePerAgent: 3,
  maxGeminiCallsPerCycle: 20,
  maxNewTasksPerCycle: 6,
  maxExecutesPerCyclePerAgent: 3,
  maxContentGeneratesPerCyclePerAgent: 1,
  maxEscalationsPerCycle: 3,
  maxActiveTasks: 50,
  dedupeWindowMs: 600000
};

// ── Concurrency lock ──
const HEARTBEAT_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

// ── Persistent Agent Memory ──
const MAX_MEMORIES_PER_AGENT = 50;
const MAX_L4_WRITES_PER_AGENT_PER_DAY = 10;
const L4_PREFERRED_TYPES = new Set(['decision', 'constraint', 'resolved_incident', 'verified_fact', 'preference']);
const L4_LEGACY_TYPES = new Set(['learning', 'feedback', 'context', 'preference']);
// weekly_report is a structural memory type (Nova/Cipher/Forge cadence reports) — allowed but not
// preferred (doesn't require evidence.runId), long-lived to survive the 7-day cadence check.
// reflection: written by agents every 3 days via Self-Awareness cadence.
// consolidated_belief: synthesized by memoryConsolidate cron from N>=5 similar
// memories. Both structural (no evidence.runId required from agent output path;
// the cron supplies evidence for consolidated_belief, and reflection memories
// still include runId because agents write them).
const L4_STRUCTURAL_TYPES = new Set(['weekly_report', 'reflection', 'consolidated_belief']);
const L4_ALLOWED_TYPES = new Set([...L4_PREFERRED_TYPES, ...L4_LEGACY_TYPES, ...L4_STRUCTURAL_TYPES]);
const L4_DEFAULT_TTL_DAYS = 14;
// Tiered TTLs by memory type (days). Types not listed fall back to L4_DEFAULT_TTL_DAYS.
const L4_TTL_BY_TYPE = {
  decision: 90, verified_fact: 90, weekly_report: 90,
  consolidated_belief: 90,
  constraint: 60, preference: 60,
  reflection: 30,
  learning: 30, feedback: 30,
  context: 14
};

// ── Self-Awareness / Reflection System ──
const REFLECTION_CADENCE_DAYS = 3;
const REFLECTION_INTEL_FRESHNESS_MS = 30 * 60 * 1000;
const REFLECTION_DIGEST_HISTORY_SIZE = 5; // keep last 5 in runtimeMemory for drift-staleness detection
const STRATEGY_FATIGUE_MIN_ATTEMPTS = 5;
const STRATEGY_FATIGUE_MIN_VS_MEDIAN = 0.7; // cluster median must be <70% of agent median to flag

// ── Tier 4 Sub-Agent Gating ──
const TIER4_SUB_AGENTS = new Set(['quill']);
const OBJECTIVE_EXEMPT_CATEGORIES = new Set(['ops_breakfix', 'governance', 'maintenance', 'system_directive', 'finance']);
// Agents authorized to create system_directive tasks (course-correct other agents)
const DIRECTIVE_AUTHORIZED_AGENTS = new Set(['forge', 'nova']);
// Agents authorized to decide budget requests (Capital Allocation)
const CAPITAL_AUTHORIZED_AGENTS = new Set(['cipher']);
// Capital Allocation decision thresholds
const CAPITAL_DECISION_THRESHOLDS = {
  autoApproveBelow: 0.50,
  cipherApprovalBelow: 2.00,
  ceoApprovalAbove: 2.00,
  systemBudgetSqueezePct: 95
};
const CAPITAL_ALLOCATION_FRESHNESS_MS = 30 * 60 * 1000;
const CAPITAL_DECISION_LOG_MAX = 100;
const CAPITAL_HISTORY_MAX_MONTHS = 12;
// ── Goal Generation (System 13) ──
const PRODUCT_PROPOSAL_AUTHORIZED_AGENTS = new Set(['nova']);
const PRODUCT_PROPOSAL_MAX_PER_DAY = 1;
// Per-type cost ceilings (PER-PROPOSAL, not per-day). Product launches can
// legitimately run $30-60 over 4-week MVPs; pivots are transitions not new
// builds; retires are near-zero winddown.
const PRODUCT_PROPOSAL_COST_CEILINGS = {
  'propose-product': 100.00,
  'propose-pivot':    50.00,
  'propose-retire':   10.00
};
const PRODUCT_PROPOSAL_REJECT_COOLDOWN_DAYS = 7;

// ── Emergence Monitoring (System 15) ──
// Thresholds for the 5 Core signals. Pure observation layer — no action taken
// based on these; surfaced to Forge's prompt + emergence.html dashboard only.
const EMERGENCE_THRESHOLDS = {
  proposalRatePerAgent7d: { yellow: 3, red: 5 },
  proposalRatePerType7d:  { yellow: 4, red: 7 },
  rejectRatePerEmitter:   { yellow: 0.50, red: 0.80 },
  rejectRateMinSamples:   5,
  fleetChurn30d:          { yellow: 3, red: 5 },
  capitalRedStreak:       { yellow: 3, red: 7 },
  approvalCriticalAgeH:   { yellow: 24, red: 72 },
  approvalDepthTotal:     { yellow: 10, red: 20 }
};

// Maps approvalQueue entry type → blast-radius tier for CEO dashboard sort.
// Static reference — dashboard JS MUST mirror this map (document the pairing).
const EMERGENCE_BLAST_RADIUS = {
  agent_retire_proposal:    'critical',
  product_retire_proposal:  'critical',
  agent_hire_proposal:      'critical',
  product_pivot_proposal:   'high',
  agent_evolution_proposal: 'high',
  product_proposal:         'medium',
  budget_request:           'medium',
  campaign_proposal:        'low',
  objective_proposal:       'low'
};
const EMERGENCE_DIGEST_FRESHNESS_MS = 26 * 60 * 60 * 1000;
const EMERGENCE_SIGNALS_MAX = 50;
const ALLOWED_UPDATE_KEYS = new Set([
  'status', 'assignee', 'dueDate', 'priority', 'classification', 'taskType',
  'tags', 'objective_id', 'directive_id', 'campaign_id', 'parent_task_id', 'child_task_ids'
]);
const CAP_DEFAULTS = {
  maxCreatesPerAgentPerRun: 2,
  maxMovesPerAgentPerRun: 5,
  maxUpdatesPerAgentPerRun: 8,
  maxProposalsPerAgentPerRun: 10
};
const _MUTATION_BUCKET_MAP = { create: 'creates', move: 'moves', update: 'updates' };
const MAX_TOOL_CALLS_PER_AGENT = 2;
const MAX_RESEARCH_INJECTIONS = 3;
const MAX_RESEARCH_CHARS = 2000;
const MAX_RESEARCH_STORE_ENTRIES = 20;
const AGENT_COOLDOWN_VIOLATIONS_PER_RUN = 2;
const MAX_OBSERVATIONS_PER_AGENT = 10;
const MAX_OBSERVATION_CHARS = 180;
const MAX_ENTITY_COMMENT_CALLS_PER_RUN = 6;
const VALID_TASK_STATUSES = ['pending-approval', 'backlog', 'todo', 'in-progress', 'review', 'done'];

// ── Valid task types — single source of truth ──
// Keep in sync with: index.js _validTaskTypes, prompt-builders.js schema enum, company-state VALID_KEYS
const VALID_SOCIAL_TASK_TYPES = ['social_x', 'social_linkedin', 'social_bluesky', 'social_facebook', 'social_reddit'];
const VALID_TASK_TYPES = [
  'general', 'blog_post', 'article', 'newsletter', 'internal_doc',
  'design_asset', 'research', 'ops', 'finance', 'editorial', 'bug_fix',
  'intake', 'support',
  ...VALID_SOCIAL_TASK_TYPES
];

// ── Known action types for dual-envelope normalizer ──
const KNOWN_ACTION_TYPES = [
  'create-task', 'update-task', 'move-task', 'execute-task', 'review-task',
  'comment-task', 'create-social-action', 'revise-action', 'create-doc',
  'update-doc', 'submit-for-publish', 'create-content-package', 'generate-image',
  'create-reminder', 'web_search', 'remember',
  'request-budget', 'approve-budget-request',
  'propose-product', 'propose-pivot', 'propose-retire',
  'propose-hire-agent', 'propose-retire-agent', 'propose-role-evolution'
];
const RESEARCH_MAX_AGE_DAYS = 30;
const MAX_RESEARCH_INTEL_PER_DAY = 2;
const MAX_TREND_INSIGHTS_STORE = 30;
const TREND_RADAR_MAX_AGE_DAYS = 7;
const SUB_AGENT_MENTION_WINDOW_HOURS = 24;
const SOCIAL_INTEL_WINDOW_DAYS = 7;
const SOCIAL_INTEL_FRESHNESS_MS = 30 * 60 * 1000;

// ── Agent Performance Intel (AutoResearch feedback loop) ──
const PERFORMANCE_INTEL_WINDOW_DAYS = 30;
const PERFORMANCE_INTEL_FRESHNESS_MS = 30 * 60 * 1000;
const MAX_PERFORMANCE_INSIGHTS_PER_DAY = 1;
const MAX_EXPERIMENTS_PER_AGENT = 3;
const EXPERIMENT_MIN_SAMPLES = 3;
const EXPERIMENT_IMPROVEMENT_THRESHOLD = 0.10;

// ── Governance log retention (prevents unbounded growth) ──
const MAX_GOVERNANCE_LOG_ENTRIES = 500;

// ── Weekly report archive (rolling quarter of cadence reports per agent) ──
const MAX_WEEKLY_REPORTS_PER_AGENT = 12;

// ── Content intelligence digest freshness (30 min — matches social/performance) ──
const CONTENT_INTEL_FRESHNESS_MS = 30 * 60 * 1000;

// ── Strategic intelligence digest freshness (15 min — Nova benefits from fresher data) ──
const STRATEGIC_INTEL_FRESHNESS_MS = 15 * 60 * 1000;

// Strip repeated auto-generated prefixes from task titles
const _TASK_PREFIXES = [
  /^Write social copy for:\s*/i,
  /^Social Copy\s*[—–-]\s*/i,
  /^Generate hero image for:\s*/i,
  /^Hero Image\s*[—–-]\s*/i,
  /^Content Brief\s*[—–-]\s*/i,
  /^Draft:\s*/i,
  /^Auto:\s*/i,
  /^Calendar Update\s*[—–-]\s*/i
];

// ── Escalation Hierarchy ──
const DOMAIN_LEAD_MAP = {
  scribe: 'nova',
  quill: 'scribe',
  scout: 'nova',
  echo: 'nova',
  pixel: 'nova',
  forge: 'nova',
  cipher: 'nova',
  nova: null
};

const ALLOWED_MODES = new Set(['manual', 'supervised_autonomous', 'experimental']);
const ALLOWED_EXEC_MODES = new Set(['active', 'observe', 'frozen']);

// ── Workspace context ──
const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const MAX_WORKSPACE_INJECT_CHARS = 6000;
const WORKSPACE_SCAN_EXTENSIONS = new Set(['.html', '.css', '.js', '.md', '.json']);
const WORKSPACE_SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'package-lock.json']);

// ── Agent Identity Evolution (System 14) ──
// Fleet mutation authorization + proposal constants. Only Forge emits via the
// heartbeat handler; CEO creates proposals via direct POST.
const FLEET_MUTATION_AUTHORIZED_AGENTS = new Set(['forge']);
const PROTECTED_AGENTS = new Set(['nova', 'cipher']);
const FLEET_MIN_SIZE = 5;
const FLEET_MAX_SIZE = 12;
const FLEET_PROPOSAL_MAX_PER_DAY = 1;
const FLEET_PROPOSAL_COST_CEILINGS = {
  'propose-hire-agent': 10.00,
  'propose-retire-agent': 0.00,
  'propose-role-evolution': 5.00
};
const FLEET_PROPOSAL_REJECT_COOLDOWN_DAYS = 14;

// Bootstrap snapshot of the original 8-agent fleet. Captured AFTER AGENT_ROLES
// is fully populated above; loader falls back to this if agentRegistry state
// is empty or malformed. Deep-cloned to prevent mutation bleed.
const _BOOTSTRAP_AGENT_REGISTRY = {
  agents: AGENT_IDS.map(function (id) {
    var r = AGENT_ROLES[id] || {};
    return {
      id: id,
      name: r.name || id,
      status: 'active',
      tier: r.tier || 3,
      role: r.role || '',
      focus: r.focus || '',
      reportsTo: r.reportsTo || DOMAIN_LEAD_MAP[id] || null,
      monthlyCap: r.monthlyCap || 1.00,
      doctrine: r.doctrine ? JSON.parse(JSON.stringify(r.doctrine)) : {},
      expectedActionMix: r.expectedActionMix ? JSON.parse(JSON.stringify(r.expectedActionMix)) : {},
      systemPromptTemplate: null,
      hiredAt: '2026-03-07T00:00:00Z',
      retiredAt: null,
      retiredReason: null,
      doctrineHistory: []
    };
  }),
  updatedAt: null
};

// Mutates AGENT_IDS + AGENT_ROLES in-place to match the registry's active agents.
// CRITICAL: must mutate, not reassign — callers that did `const { AGENT_IDS }
// = require('./constants')` captured the reference at require-time. Reassigning
// would break those bindings.
function _applyRegistry(reg) {
  if (!reg || !Array.isArray(reg.agents)) return;
  var active = reg.agents.filter(function (a) { return a && a.status === 'active'; });
  AGENT_IDS.length = 0;
  Object.keys(AGENT_ROLES).forEach(function (k) { delete AGENT_ROLES[k]; });
  active.forEach(function (a) {
    AGENT_IDS.push(a.id);
    AGENT_ROLES[a.id] = a;
  });
}

// Async loader — called ONCE at heartbeat start. Reads agentRegistry state,
// falls back to bootstrap on first run or malformed state. Writes bootstrap to
// state on first run so subsequent reads find the registry.
async function loadAgentRegistry(storage) {
  try {
    var persisted = await storage.getState('agentRegistry');
    if (persisted && Array.isArray(persisted.agents) && persisted.agents.length >= FLEET_MIN_SIZE) {
      _applyRegistry(persisted);
      return persisted;
    }
    // Bootstrap on first run — write defaults so state is source-of-truth thereafter
    var bootstrap = {
      agents: JSON.parse(JSON.stringify(_BOOTSTRAP_AGENT_REGISTRY.agents)),
      updatedAt: new Date().toISOString()
    };
    await storage.setState('agentRegistry', bootstrap);
    _applyRegistry(bootstrap);
    return bootstrap;
  } catch (_e) {
    // Fail-open: leave AGENT_IDS/AGENT_ROLES at their bootstrap values (already populated)
    return _BOOTSTRAP_AGENT_REGISTRY;
  }
}

module.exports = {
  DOMAIN_LEAD_MAP,
  AGENT_IDS,
  _agentPersonalities,
  _agentPersonalityData,
  AGENT_ROLES,
  CFO_THRESHOLD,
  GUARDRAILS,
  HEARTBEAT_LOCK_TIMEOUT_MS,
  MAX_MEMORIES_PER_AGENT,
  MAX_L4_WRITES_PER_AGENT_PER_DAY,
  L4_PREFERRED_TYPES,
  L4_LEGACY_TYPES,
  L4_ALLOWED_TYPES,
  L4_TTL_BY_TYPE,
  L4_DEFAULT_TTL_DAYS,
  TIER4_SUB_AGENTS,
  OBJECTIVE_EXEMPT_CATEGORIES,
  DIRECTIVE_AUTHORIZED_AGENTS,
  CAPITAL_AUTHORIZED_AGENTS,
  CAPITAL_DECISION_THRESHOLDS,
  CAPITAL_ALLOCATION_FRESHNESS_MS,
  CAPITAL_DECISION_LOG_MAX,
  CAPITAL_HISTORY_MAX_MONTHS,
  PRODUCT_PROPOSAL_AUTHORIZED_AGENTS,
  PRODUCT_PROPOSAL_MAX_PER_DAY,
  PRODUCT_PROPOSAL_COST_CEILINGS,
  PRODUCT_PROPOSAL_REJECT_COOLDOWN_DAYS,
  FLEET_MUTATION_AUTHORIZED_AGENTS,
  PROTECTED_AGENTS,
  FLEET_MIN_SIZE,
  FLEET_MAX_SIZE,
  FLEET_PROPOSAL_MAX_PER_DAY,
  FLEET_PROPOSAL_COST_CEILINGS,
  FLEET_PROPOSAL_REJECT_COOLDOWN_DAYS,
  EMERGENCE_THRESHOLDS,
  EMERGENCE_BLAST_RADIUS,
  EMERGENCE_DIGEST_FRESHNESS_MS,
  EMERGENCE_SIGNALS_MAX,
  loadAgentRegistry,
  ALLOWED_UPDATE_KEYS,
  CAP_DEFAULTS,
  _MUTATION_BUCKET_MAP,
  MAX_TOOL_CALLS_PER_AGENT,
  MAX_RESEARCH_INJECTIONS,
  MAX_RESEARCH_CHARS,
  MAX_RESEARCH_STORE_ENTRIES,
  AGENT_COOLDOWN_VIOLATIONS_PER_RUN,
  MAX_OBSERVATIONS_PER_AGENT,
  MAX_OBSERVATION_CHARS,
  MAX_ENTITY_COMMENT_CALLS_PER_RUN,
  VALID_TASK_STATUSES,
  VALID_TASK_TYPES,
  VALID_SOCIAL_TASK_TYPES,
  KNOWN_ACTION_TYPES,
  RESEARCH_MAX_AGE_DAYS,
  MAX_RESEARCH_INTEL_PER_DAY,
  MAX_TREND_INSIGHTS_STORE,
  TREND_RADAR_MAX_AGE_DAYS,
  SUB_AGENT_MENTION_WINDOW_HOURS,
  SOCIAL_INTEL_WINDOW_DAYS,
  SOCIAL_INTEL_FRESHNESS_MS,
  _TASK_PREFIXES,
  ALLOWED_MODES,
  ALLOWED_EXEC_MODES,
  WORKSPACE_ROOT,
  MAX_WORKSPACE_INJECT_CHARS,
  WORKSPACE_SCAN_EXTENSIONS,
  WORKSPACE_SKIP_DIRS,
  PERFORMANCE_INTEL_WINDOW_DAYS,
  PERFORMANCE_INTEL_FRESHNESS_MS,
  MAX_PERFORMANCE_INSIGHTS_PER_DAY,
  MAX_EXPERIMENTS_PER_AGENT,
  EXPERIMENT_MIN_SAMPLES,
  EXPERIMENT_IMPROVEMENT_THRESHOLD,
  MAX_GOVERNANCE_LOG_ENTRIES,
  MAX_WEEKLY_REPORTS_PER_AGENT,
  CONTENT_INTEL_FRESHNESS_MS,
  STRATEGIC_INTEL_FRESHNESS_MS,
  OPS_INTEL_FRESHNESS_MS: 25 * 60 * 1000,
  OPS_INTEL_WINDOW_RUNS: 20,
  FINANCE_BUDGET_DAILY: 0.50,
  FINANCE_BUDGET_MONTHLY: 15.00,
  RESEARCH_DEMAND_WINDOW_DAYS: 7,
  RESEARCH_DEMAND_MAX_SIGNALS: 5,
  RESEARCH_STALE_THRESHOLD_DAYS: 14,
  RESEARCH_COMPETITIVE_GAP_DAYS: 30,
  REFLECTION_CADENCE_DAYS,
  REFLECTION_INTEL_FRESHNESS_MS,
  REFLECTION_DIGEST_HISTORY_SIZE,
  STRATEGY_FATIGUE_MIN_ATTEMPTS,
  STRATEGY_FATIGUE_MIN_VS_MEDIAN
};
