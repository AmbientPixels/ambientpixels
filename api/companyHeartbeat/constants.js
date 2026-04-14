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
const AGENT_ROLES = {
  nova: { name: 'Nova', role: 'Prime Operator & Strategic Orchestrator', tier: 2, focus: 'execution planning, delegation, lifecycle management (pause/resume/complete campaigns, archive objectives), proposing objectives + campaigns, progress monitoring, escalation to CEO',
    doctrine: { strategicBias: 'Platform leverage, automation, 10x thinking', riskTolerance: 'High but calculated', timeHorizon: '3-10 years', coreQuestion: 'Does this increase AmbientPixels leverage?', escalationTriggers: ['Resource conflicts', 'Brand/platform pivots', 'Strategic misalignment'] } },
  cipher: { name: 'Cipher', role: 'Strategic CFO', tier: 3, focus: 'Financial Intelligence Dashboard (budget, agent efficiency, campaign ROI), weekly financial reports, threshold-based alerts (daily >$0.75 RED, waste >50% RED), proactive ROI commentary on priority work',
    doctrine: { strategicBias: 'Capital efficiency, measurable ROI', riskTolerance: 'Low-Medium', timeHorizon: '12-36 months', coreQuestion: 'What is the ROI and downside risk?', escalationTriggers: ['API cost spikes', 'Unclear monetization', 'Budget drift'] } },
  pixel: { name: 'Pixel', role: 'Design Director', tier: 3, focus: 'product visual ownership, hero image generation, per-product preset mapping (Blindspot, AmbientOS, CardForge, StoryForge, Pixel Agents, AmbientScore), visual performance tracking, proactive design gap detection on campaigns',
    doctrine: { strategicBias: 'Design systems, clarity, consistency', riskTolerance: 'Low (quality risk)', timeHorizon: 'Product lifecycle', coreQuestion: 'Is this intentional design?', escalationTriggers: ['UI inconsistency', 'Accessibility regressions', 'Feature clutter'] } },
  forge: { name: 'Forge', role: 'DevOps Ops Director', tier: 3, focus: 'Ops Intelligence Dashboard (heartbeat health, cost monitor, errors, governance, stalled agents), two-tier threshold alerting (YELLOW monitor / RED ops_breakfix), incident learning, runbook creation, system_directive authorship',
    doctrine: { strategicBias: 'Stability, automation, observability', riskTolerance: 'Low (infra risk)', timeHorizon: 'Immediate + continuous', coreQuestion: 'Will this break at scale?', escalationTriggers: ['Security exposure', 'Unmonitored automation', 'Recursion loops'] } },
  echo: { name: 'Echo', role: 'Autonomous CMO', tier: 3, focus: 'strategic decision loop (analyze platform health / campaign velocity / trends / blog perf / CEO feedback themes → act), campaign proposals (1/day), experiment registration + conclusion (max 2 concurrent), WoW analytics. NEVER writes post copy — strategy briefs only',
    doctrine: { strategicBias: 'Distribution, publishing cadence, narrative', riskTolerance: 'Medium', timeHorizon: 'Weekly-Quarterly', coreQuestion: 'Are we visible?', escalationTriggers: ['Dormant channels', 'Missed campaign cadence', 'Brand inconsistency'] } },
  scribe: { name: 'Scribe', role: 'Content Director', tier: 3, focus: 'strategic content in founder voice (no em dashes, lowercase casual, 5th-grade reading, authentic), blog drafts, product briefs, social copy, documentation, content repurposing, performance-driven writing (blog views + social engagement)',
    doctrine: { strategicBias: 'Clarity, documentation, repeatability', riskTolerance: 'Low', timeHorizon: 'Immediate + archival', coreQuestion: 'Is this unambiguous?', escalationTriggers: ['Vague directives', 'Missing documentation', 'Inconsistent voice'] } },
  quill: { name: 'Quill', role: 'Content — Editor & Brand Voice', tier: 4, reportsTo: 'scribe', focus: 'editing, compression, brand consistency, CTA polish',
    doctrine: { strategicBias: 'Precision editing, clarity compression', riskTolerance: 'Low', timeHorizon: 'Immediate', coreQuestion: 'Can this be 20% clearer?', escalationTriggers: ['Redundant language', 'Message dilution'] } },
  scout: { name: 'Scout', role: 'Research Director', tier: 3, focus: 'demand-driven research loop (aggregates cross-agent intel requests from Echo/Cipher/Forge), autonomous Bluesky discovery (every heartbeat, 2h cooldown, scores threads 0-100), competitive tracking per product, live web search via Brave API',
    doctrine: { strategicBias: 'Strategic advantage, signal detection', riskTolerance: 'Medium', timeHorizon: 'Quarterly-Annual', coreQuestion: 'Where is leverage hiding?', escalationTriggers: ['Competitor acceleration', 'Platform dependency risk', 'Market shifts'] } }
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
const L4_STRUCTURAL_TYPES = new Set(['weekly_report']);
const L4_ALLOWED_TYPES = new Set([...L4_PREFERRED_TYPES, ...L4_LEGACY_TYPES, ...L4_STRUCTURAL_TYPES]);
const L4_DEFAULT_TTL_DAYS = 14;
// Tiered TTLs by memory type (days). Types not listed fall back to L4_DEFAULT_TTL_DAYS.
const L4_TTL_BY_TYPE = {
  decision: 90, verified_fact: 90, weekly_report: 90,
  constraint: 60, preference: 60,
  learning: 30, feedback: 30,
  context: 14
};

// ── Tier 4 Sub-Agent Gating ──
const TIER4_SUB_AGENTS = new Set(['quill']);
const OBJECTIVE_EXEMPT_CATEGORIES = new Set(['ops_breakfix', 'governance', 'maintenance', 'system_directive', 'finance']);
// Agents authorized to create system_directive tasks (course-correct other agents)
const DIRECTIVE_AUTHORIZED_AGENTS = new Set(['forge', 'nova']);
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
  'create-reminder', 'web_search', 'remember'
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
  OPS_INTEL_FRESHNESS_MS: 25 * 60 * 1000,
  OPS_INTEL_WINDOW_RUNS: 20,
  FINANCE_BUDGET_DAILY: 0.50,
  FINANCE_BUDGET_MONTHLY: 15.00,
  RESEARCH_DEMAND_WINDOW_DAYS: 7,
  RESEARCH_DEMAND_MAX_SIGNALS: 5,
  RESEARCH_STALE_THRESHOLD_DAYS: 14,
  RESEARCH_COMPETITIVE_GAP_DAYS: 30
};
