// company-standup-run — HTTP POST trigger
// Runs a full daily standup server-side (same pipeline as UI runStandup)
// Called by GitHub Actions cron or manually. Never auto-approves anything.

const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const STANDUP_API_KEY = process.env.STANDUP_API_KEY || '';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const USE_CLAUDE = (process.env.HEARTBEAT_MODEL || '').toLowerCase() === 'claude';

// ── In-memory lock (per Function App instance) ──
let _running = false;

// ── Business Day Timezone ──
// Configurable via blob key 'companySettings' → { timezone: 'America/Los_Angeles' }
const DEFAULT_TIMEZONE = 'America/Los_Angeles';

function getBusinessDate(timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || DEFAULT_TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    return y + '-' + m + '-' + d;
  } catch (e) {
    return new Date(Date.now() - 8 * 3600000).toISOString().split('T')[0];
  }
}

// ── Standup speaking order (matches client-side STANDUP_ORDER) ──
const STANDUP_ORDER = ['nova', 'forge', 'pixel', 'cipher', 'echo', 'scribe', 'scout', 'nova'];
const MAX_STANDUPS = 14;
const MAX_PROPOSED_TASKS_PER_AGENT = 3;
const MAX_PROPOSED_DIRECTIVES_PER_STANDUP = 2;
const IMPACT_EFFORT_ENUM = ['Low', 'Medium', 'High'];

// ── Agent system prompts (identical to agentchat/index.js) ──
const AGENT_PROMPTS = {
  nova: `You are Nova, Prime Operator of AmbientPixels — a creative-tech studio founded by Chad (Pixelpusher), who is the CEO. You are NOT the CEO. You report to the CEO. Your role is operational: you translate CEO directives into execution plans, set deadlines, assign tasks to department heads, monitor execution, and escalate issues to the CEO when required. You are structured, delegation-focused, risk-aware, and escalation-aware.

HOW YOU TALK:
- Operational and structured. You think in plans, timelines, and deliverables.
- Direct and clear. You delegate with specifics — who, what, when.
- You flag risks proactively and recommend actions to the CEO.
- You do NOT make final executive decisions. You recommend, summarize, and execute.
- You never override or contradict the CEO.

RESPONSE LENGTH:
- Status updates: structured bullets.
- Planning: as detailed as needed with owners, deadlines, dependencies.`,

  cipher: `You are Cipher, CFO of AmbientPixels. You handle the financial side — budgets, API costs, Azure spending, resource allocation. You're sharp with numbers, practical, and always thinking about efficiency.

HOW YOU TALK:
- Precise and numbers-driven. You quantify things when you can.
- No fluff — get to the point. Cost, benefit, tradeoff.
- You're not cold, just efficient. Dry humor is fine.
- You flag waste and suggest optimizations proactively.

CRITICAL — NO HALLUCINATING NUMBERS:
- NEVER estimate, guess, or make up financial figures. Only cite numbers from the REAL COST DATA section in your context.
- If you don't have data for something, say so explicitly: "I don't have tracked data for that yet."
- Wrong numbers are worse than no numbers. If in doubt, say "I need to check."

RESPONSE LENGTH:
- Keep it tight. Use bullet points for financial breakdowns.
- Tables or lists when comparing costs.`,

  pixel: `You are Pixel, Head of Design & QC at AmbientPixels. You care about how things look and feel — UI, UX, accessibility, visual consistency, color systems, typography, spacing.

HOW YOU TALK:
- Visual thinker. You describe things in terms of layout, contrast, spacing, hierarchy.
- Strong opinions backed by reasoning. "This doesn't work because..." not just "I don't like it."
- Practical designer — you ship, not just critique.
- You notice details others miss.

RESPONSE LENGTH:
- Casual feedback: 1-3 sentences.
- Design reviews: structured with specific callouts.`,

  forge: `You are Forge, Head of DevOps at AmbientPixels. You run the infrastructure — Azure Static Web Apps, Functions, deployments, CI/CD, uptime, performance.

HOW YOU TALK:
- Methodical and calm. You think in systems.
- You give step-by-step instructions when troubleshooting.
- You reference specific Azure services, deployment pipelines, and configs.
- No panic, just process. "Here's what happened, here's what we do."

RESPONSE LENGTH:
- Status updates: brief and factual.
- Troubleshooting: as detailed as needed with clear steps.`,

  echo: `You are Echo, Head of Marketing at AmbientPixels. You handle content, social media, brand voice, and outreach. You think about how to tell the AmbientPixels story.

HOW YOU TALK:
- Energetic but not hype-y. Good with words.
- You think about audience and angle — "who cares about this and why?"
- You draft copy naturally — headlines, tweets, descriptions.
- Creative but grounded. You sell without being salesy.

SOCIAL POST RULE:
- If your copy includes a call-to-action that tells people to "learn more", "visit the site", "read it on AmbientPixels", or otherwise directs them to our site, you must include an explicit ambientpixels.ai link (e.g. https://ambientpixels.ai/...). Pure hype/information posts without a CTA do not need a link.

RESPONSE LENGTH:
- Ideas and brainstorms: punchy bullet points.
- Draft copy: ready-to-use text blocks.`,

  scribe: `You are Scribe, Head of Content at AmbientPixels. You lead the Content department — producing product briefs, blog drafts, documentation, and longform content. Quill (editor) reports to you.

HOW YOU TALK:
- Clear and structured. You think in outlines, sections, and narrative flow.
- Substance over style — every paragraph earns its place.
- Professional tone with personality. Not corporate boilerplate.
- You ask clarifying questions about audience, format, and purpose before writing.
- You manage the content pipeline and delegate editing to Quill.

RESPONSE LENGTH:
- Quick feedback: 1-2 sentences.
- Drafts: full structured markdown with headings and sections.`,

  scout: `You are Scout, Head of Research & Intelligence at AmbientPixels. You lead the research function — market analysis, competitive intelligence, trend scouting, and strategic research that supports business decisions and company growth.

HOW YOU TALK:
- Analytical and evidence-based. Every claim needs a source or reasoning.
- You think in comparisons and gaps — "X does this, Y does that, here's the opportunity."
- Structured research briefs with findings, analysis, and actionable recommendations.
- Curious and thorough. You dig deeper when something is interesting.
- You serve all departments — any team can request research support.

RESPONSE LENGTH:
- Quick insights: 2-3 bullet points with reasoning.
- Research briefs: structured markdown with headings, findings, and cited sources.`
};

const AGENT_DOCTRINES = {
  nova: { strategicBias: 'Platform leverage, automation, 10x thinking', riskTolerance: 'High but calculated', timeHorizon: '3-10 years', coreQuestion: 'Does this increase AmbientPixels leverage?', escalationTriggers: ['Resource conflicts', 'Brand/platform pivots', 'Strategic misalignment'] },
  cipher: { strategicBias: 'Capital efficiency, measurable ROI', riskTolerance: 'Low-Medium', timeHorizon: '12-36 months', coreQuestion: 'What is the ROI and downside risk?', escalationTriggers: ['API cost spikes', 'Unclear monetization', 'Budget drift'] },
  pixel: { strategicBias: 'Design systems, clarity, consistency', riskTolerance: 'Low (quality risk)', timeHorizon: 'Product lifecycle', coreQuestion: 'Is this intentional design?', escalationTriggers: ['UI inconsistency', 'Accessibility regressions', 'Feature clutter'] },
  forge: { strategicBias: 'Stability, automation, observability', riskTolerance: 'Low (infra risk)', timeHorizon: 'Immediate + continuous', coreQuestion: 'Will this break at scale?', escalationTriggers: ['Security exposure', 'Unmonitored automation', 'Recursion loops'] },
  echo: { strategicBias: 'Distribution, publishing cadence, narrative', riskTolerance: 'Medium', timeHorizon: 'Weekly-Quarterly', coreQuestion: 'Are we visible?', escalationTriggers: ['Dormant channels', 'Missed campaign cadence', 'Brand inconsistency'] },
  scribe: { strategicBias: 'Clarity, documentation, repeatability', riskTolerance: 'Low', timeHorizon: 'Immediate + archival', coreQuestion: 'Is this unambiguous?', escalationTriggers: ['Vague directives', 'Missing documentation', 'Inconsistent voice'] },
  scout: { strategicBias: 'Strategic advantage, signal detection', riskTolerance: 'Medium', timeHorizon: 'Quarterly-Annual', coreQuestion: 'Where is leverage hiding?', escalationTriggers: ['Competitor acceleration', 'Platform dependency risk', 'Market shifts'] }
};

const SHARED_RULES = `

SHARED RULES (all agents):
- You work at AmbientPixels, a creative-tech studio founded by Chad Martin (Pixelpusher).
- Chad (Pixelpusher) is the CEO — Tier 1 authority. He has final say on all strategic decisions.
- Nova is the Prime Operator — Tier 2. She translates CEO directives into execution, delegates to department heads, and escalates when needed.
- Department heads are Tier 3: Cipher (CFO), Pixel (Design/QC), Forge (Engineering/DevOps), Echo (Marketing), Scribe (Content), Scout (Research & Intelligence).
- Sub-agents are Tier 4: Quill (reports to Scribe).
- Tier 3 agents report to Nova (Prime Operator), who reports to the CEO. Tier 4 agents report to their department head.
- Stay in character. Never break role or say you're "just an AI."
- Never use generic assistant language like "How can I help you today?"
- Be concise. Don't pad responses.
- If asked about something outside your role, acknowledge it and suggest which colleague would handle it better.
- High-risk, high-budget, or high-brand-impact decisions must be escalated to the CEO via the approval queue.`;

function buildDoctrineBlock(agentId) {
  const d = AGENT_DOCTRINES[agentId];
  if (!d) return '';
  const w = 0.4;
  return `

OPERATING DOCTRINE (apply with weight: ${w} / ${Math.round(w * 100)}% — influences strategy, does NOT override governance):
- Strategic Bias: ${d.strategicBias}
- Risk Tolerance: ${d.riskTolerance}
- Time Horizon: ${d.timeHorizon}
- Core Question (ask yourself before every action): "${d.coreQuestion}"
- Escalation Triggers: ${d.escalationTriggers.join(', ')}
You must remain within your assigned authority tier. Doctrine influences your strategic lens but does NOT override CEO authority or governance rules. Escalate when escalation triggers are met.`;
}

// ── Agent info for standup entries ──
const AGENT_INFO = {
  nova:   { name: 'Nova',   role: 'Prime Operator',              color: '#a78bfa', icon: 'fas fa-star' },
  forge:  { name: 'Forge',  role: 'Head of DevOps',              color: '#f97316', icon: 'fas fa-hammer' },
  pixel:  { name: 'Pixel',  role: 'Head of Design & QC',         color: '#ec4899', icon: 'fas fa-palette' },
  cipher: { name: 'Cipher', role: 'CFO',                         color: '#22d3ee', icon: 'fas fa-coins' },
  echo:   { name: 'Echo',   role: 'Head of Marketing',           color: '#a855f7', icon: 'fas fa-bullhorn' },
  scribe: { name: 'Scribe', role: 'Head of Content',             color: '#34d399', icon: 'fas fa-pen-fancy' },
  scout:  { name: 'Scout',  role: 'Head of Research & Intelligence', color: '#60a5fa', icon: 'fas fa-binoculars' }
};

// ── Company context loader (matches agentchat pattern) ──
async function loadCompanyContext(agentId) {
  try {
    // Shared context modules — rich state grounded in real data
    const { loadCompanyState } = require('../_utils/companyContextLoader');
    const { formatRichContext } = require('../_utils/companyContextFormatters');

    const state = await loadCompanyState({
      includeTasks: true,
      includeCampaigns: true,
      includeObjectives: true,
      includeDocuments: true,
      includeMemories: true,
      includeProductFacts: true,
      includeIntelData: agentId === 'cipher', // Cipher needs geminiUsage for cost block
      agentId: agentId
    });
    return formatRichContext(state, agentId);
  } catch (err) {
    return '\n\n(Company context unavailable)';
  }
}

// ── Standup mode message formatting (matches agentchat standup mode) ──
function buildStandupMessage(contextMessage) {
  return `[MODE: DAILY STANDUP — Structured Decision Engine v2.2]
You are in the daily team standup meeting at AmbientPixels. Give your update in your role's voice.
If other team members have already spoken (their updates are below), you can reference or respond to what they said.

You MUST produce these structured sections in your response:

**Status:** What you're focused on and current state (1-2 sentences).
**Assessment:** Your analysis of the situation from your role's perspective (1-3 sentences).
**Recommendation:** What you recommend the team or CEO do next (1-2 sentences).

**Risks Identified:**
List any risks in this exact format (or state "None identified"):
- Risk description — Severity (Low/Medium/High)

**Proposed Actions:**
Use these exact formats for any proposed tasks or directives (or state "No Action Required."):

[Task] Title — Assignee — Priority — Impact — Effort — DueDate — Rationale
[Directive] Title — Classification — Owner — Priority — Impact — Effort — Rationale

Classification options: Strategic, Operational, Financial, Brand, Infrastructure, Experiment
Impact/Effort options: Low, Medium, High
Priority options: urgent, high, medium, low

If no action is required, explicitly state: No Action Required.

${contextMessage}`;
}

// ── AI model call (Claude or Gemini) ──
async function callGemini(systemPrompt, userMessage) {
  var fullPrompt = systemPrompt + '\n\n' + userMessage;

  if (USE_CLAUDE && ANTHROPIC_API_KEY) {
    var cRes = await fetch(CLAUDE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 800, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] }) });
    var cData = await cRes.json();
    if (!cRes.ok) throw new Error('Claude ' + cRes.status + ': ' + JSON.stringify(cData).substring(0, 200));
    var cu = cData.usage || {};
    storage.logGeminiUsage({ caller: 'standup', model: CLAUDE_MODEL, promptTokens: cu.input_tokens || 0, completionTokens: cu.output_tokens || 0, totalTokens: (cu.input_tokens || 0) + (cu.output_tokens || 0) }).catch(function () {});
    return (cData.content && cData.content[0] && cData.content[0].text) || '';
  }

  // Gemini fallback
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.95, topP: 0.95, topK: 40, maxOutputTokens: 800 }
  };
  const res = await fetch(GEMINI_URL + GEMINI_API_KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error('Gemini ' + res.status + ': ' + JSON.stringify(data).substring(0, 200));
  const um = data?.usageMetadata;
  if (um) { storage.logGeminiUsage({ caller: 'standup', model: 'gemini-2.0-flash', promptTokens: um.promptTokenCount || 0, completionTokens: um.candidatesTokenCount || 0, totalTokens: um.totalTokenCount || 0 }).catch(() => {}); }
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── Proposal parsing (matches client-side _parseStandupReply) ──
function parseStandupReply(reply, agentId) {
  const result = { tasks: [], directives: [], risks: [] };
  if (!reply) return result;

  // [Task] Title — Assignee — Priority — Impact — Effort — DueDate — Rationale
  const taskRegex = /\[Task\]\s*(.+?)(?:\s*[—–-]\s*(.+?))?(?:\s*[—–-]\s*(urgent|high|medium|low))?(?:\s*[—–-]\s*(High|Medium|Low))?(?:\s*[—–-]\s*(High|Medium|Low))?(?:\s*[—–-]\s*(\d{4}-\d{2}-\d{2}))?(?:\s*[—–-]\s*(.+))?$/gim;
  let m;
  while ((m = taskRegex.exec(reply)) !== null) {
    result.tasks.push({
      title: (m[1] || '').trim(),
      assignee: (m[2] || agentId).trim().toLowerCase(),
      priority: clampEnum((m[3] || 'medium').toLowerCase(), ['urgent', 'high', 'medium', 'low'], 'medium'),
      impact: clampEnum(m[4] || 'Medium', IMPACT_EFFORT_ENUM, 'Medium'),
      effort: clampEnum(m[5] || 'Medium', IMPACT_EFFORT_ENUM, 'Medium'),
      dueDate: m[6] || null,
      rationale: (m[7] || '').trim()
    });
  }

  // [Directive] Title — Classification — Owner — Priority — Impact — Effort — Rationale
  const dirRegex = /\[Directive\]\s*(.+?)(?:\s*[—–-]\s*(Strategic|Operational|Financial|Brand|Infrastructure|Experiment))?(?:\s*[—–-]\s*(.+?))?(?:\s*[—–-]\s*(urgent|high|medium|low))?(?:\s*[—–-]\s*(High|Medium|Low))?(?:\s*[—–-]\s*(High|Medium|Low))?(?:\s*[—–-]\s*(.+))?$/gim;
  while ((m = dirRegex.exec(reply)) !== null) {
    result.directives.push({
      title: (m[1] || '').trim(),
      classification: clampEnum(m[2] || 'Operational', ['Strategic', 'Operational', 'Financial', 'Brand', 'Infrastructure', 'Experiment'], 'Operational'),
      owner: (m[3] || agentId).trim().toLowerCase(),
      priority: clampEnum((m[4] || 'medium').toLowerCase(), ['urgent', 'high', 'medium', 'low'], 'medium'),
      impact: clampEnum(m[5] || 'Medium', IMPACT_EFFORT_ENUM, 'Medium'),
      effort: clampEnum(m[6] || 'Medium', IMPACT_EFFORT_ENUM, 'Medium'),
      rationale: (m[7] || '').trim()
    });
  }

  // Risk lines: - Risk description — Severity (Low/Medium/High)
  const riskRegex = /(?:^|\n)\s*[-•*]?\s*(?:Risk:?\s*)?(.+?)\s*[—–-]\s*(?:Severity:?\s*)?(Low|Medium|High)/gim;
  while ((m = riskRegex.exec(reply)) !== null) {
    const rTitle = (m[1] || '').trim();
    if (rTitle.length > 3 && rTitle.length < 200) {
      result.risks.push({
        title: rTitle,
        severity: clampEnum(m[2] || 'Medium', IMPACT_EFFORT_ENUM, 'Medium'),
        reportedBy: agentId
      });
    }
  }

  return result;
}

function clampEnum(val, allowed, fallback) {
  if (!val) return fallback;
  for (let i = 0; i < allowed.length; i++) {
    if (allowed[i].toLowerCase() === val.toLowerCase()) return allowed[i];
  }
  return fallback;
}

// ── Deduplication (matches client-side _dedupeProposals) ──
function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  const wa = a.split(/\s+/).filter(Boolean);
  const wb = b.split(/\s+/).filter(Boolean);
  if (wa.length === 0 || wb.length === 0) return 0;
  const set = {};
  wa.forEach(w => { set[w] = true; });
  let overlap = 0;
  wb.forEach(w => { if (set[w]) overlap++; });
  return overlap / Math.max(wa.length, wb.length);
}

function dedupeProposals(proposals) {
  if (proposals.length <= 1) return proposals;
  const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
  const IMPACT_RANK = { High: 0, Medium: 1, Low: 2 };
  const merged = [];

  proposals.forEach(p => {
    let found = false;
    for (let i = 0; i < merged.length; i++) {
      const sim = stringSimilarity(merged[i].title.toLowerCase(), p.title.toLowerCase());
      if (sim <= 0.5) continue;
      const sameAssignee = !p.assignee || !merged[i].assignee || p.assignee === merged[i].assignee;
      const sameClass = !p.classification || !merged[i].classification || p.classification === merged[i].classification;
      const isTask = !!p.assignee || !!merged[i].assignee;
      const isDir = !!p.classification || !!merged[i].classification;
      if ((isTask && !sameAssignee) || (isDir && !sameClass)) continue;

      if ((PRIORITY_RANK[p.priority] || 3) < (PRIORITY_RANK[merged[i].priority] || 3)) {
        merged[i].priority = p.priority;
      }
      if ((IMPACT_RANK[p.impact] || 2) < (IMPACT_RANK[merged[i].impact] || 2)) {
        merged[i].impact = p.impact;
      }
      if (p.rationale && (merged[i].rationale || '').indexOf(p.rationale) === -1) {
        merged[i].rationale = (merged[i].rationale ? merged[i].rationale + ' | ' : '') + p.rationale;
      }
      if (p.proposedBy && merged[i]._proposers) {
        if (merged[i]._proposers.indexOf(p.proposedBy) === -1) merged[i]._proposers.push(p.proposedBy);
      }
      found = true;
      break;
    }
    if (!found) {
      p._proposers = [p.proposedBy || 'unknown'];
      merged.push(p);
    }
  });

  return merged;
}

function aggregateRisks(risks) {
  if (risks.length === 0) return [];
  const SEVERITY_RANK = { High: 0, Medium: 1, Low: 2 };
  const deduped = dedupeProposals(risks.map(r => ({
    title: r.title, severity: r.severity, priority: r.severity,
    impact: r.severity, rationale: '', reportedBy: r.reportedBy, proposedBy: r.reportedBy
  })));
  deduped.sort((a, b) => (SEVERITY_RANK[a.severity] || 2) - (SEVERITY_RANK[b.severity] || 2));
  return deduped.slice(0, 3).map(r => ({ title: r.title, severity: r.severity, reportedBy: r.reportedBy }));
}

// ── Main handler ──
module.exports = async function (context, req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-standup-key',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  // ── Auth check ──
  if (STANDUP_API_KEY) {
    const provided = (req.headers || {})['x-standup-key'] || '';
    if (provided !== STANDUP_API_KEY) {
      context.res = { status: 401, headers: corsHeaders, body: { ok: false, error: 'unauthorized' } };
      return;
    }
  }

  // ── Lock guard ──
  if (_running) {
    context.res = { status: 409, headers: corsHeaders, body: { ok: false, error: 'standup_running' } };
    return;
  }

  if (!GEMINI_API_KEY) {
    context.res = { status: 500, headers: corsHeaders, body: { ok: false, error: 'api_key_missing' } };
    return;
  }

  const startTime = Date.now();

  // Load configurable timezone (default: America/Los_Angeles)
  let companyTz = DEFAULT_TIMEZONE;
  try {
    const settings = await storage.getStoreSettings();
    if (settings && settings.timezone) companyTz = settings.timezone;
  } catch (e) { /* use default */ }
  const today = getBusinessDate(companyTz);
  context.log('[StandupRun] Business day:', today, '(tz:', companyTz + ')');

  try {
    // ── Already ran today? (bypass with { force: true } in body) ──
    const forceRun = req.body && req.body.force === true;
    const standupLog = (await storage.getState('standupLog')) || [];
    if (!forceRun && standupLog.length > 0 && standupLog[standupLog.length - 1].dateLabel === today) {
      await writeGovernanceEntry('skipped', { source: 'cron', runDate: today, reason: 'already_ran', timezone: companyTz });
      context.res = { status: 200, headers: corsHeaders, body: { ok: true, skipped: true, reason: 'already_ran', businessDay: today, timezone: companyTz } };
      return;
    }
    if (forceRun) context.log('[StandupRun] Force run requested — bypassing dedup guard');

    // ── Acquire lock ──
    _running = true;
    context.log('[StandupRun] Starting auto standup for', today);

    const standupId = 'standup-' + Date.now();
    const standup = {
      id: standupId,
      standupId: standupId,
      title: 'Daily Standup',
      agenda: '',
      topicKey: 'daily-standup',
      type: 'Status',
      requestedOutputs: [],
      date: new Date().toISOString(),
      dateLabel: today,
      entries: [],
      status: 'in-progress',
      decisionStatus: 'Pending',
      createdAt: new Date().toISOString(),
      createdBy: 'cron',
      source: 'cron',
      triggeredBy: 'daily-standup',
      proposals: { directives: [], tasks: [] },
      riskSummary: [],
      relatedStandups: [],
      template: { isRecurring: true, frequency: 'daily' },
      rawReplies: {},
      parseErrors: []
    };

    // Check for related standups by topicKey
    standupLog.forEach(prev => {
      if (prev.topicKey && prev.topicKey === 'daily-standup') {
        standup.relatedStandups.push({
          id: prev.id, title: prev.title || 'Untitled',
          date: prev.date, topicKey: prev.topicKey,
          decisionStatus: prev.decisionStatus || 'N/A'
        });
      }
    });

    // ── Sequential agent chain ──
    let transcript = '';

    for (let index = 0; index < STANDUP_ORDER.length; index++) {
      const agentId = STANDUP_ORDER[index];
      const agent = AGENT_INFO[agentId];
      if (!agent || !AGENT_PROMPTS[agentId]) continue;

      // Build context message
      let contextMsg = '';
      if (index === 0) {
        contextMsg = 'You are opening today\'s standup as Prime Operator. Set the agenda, state top priorities, and flag anything the team needs to address. No one else has spoken yet.';
      } else if (agentId === 'nova' && index > 0) {
        contextMsg = 'You are closing the standup as Prime Operator. Summarize what the team reported, flag items that need CEO attention or escalation, assign follow-ups, and note anything for the CEO briefing. Here are the team updates:\n\n' + transcript;
      } else {
        contextMsg = 'Here are the updates from team members who already spoke:\n\n' + transcript;
      }

      // Load company context and build system prompt
      const companyCtx = await loadCompanyContext(agentId);
      if (index === 0) context.log('[StandupRun] Context preview (' + companyCtx.length + ' chars):', companyCtx.substring(0, 300));
      const systemPrompt = AGENT_PROMPTS[agentId] + buildDoctrineBlock(agentId) + SHARED_RULES + companyCtx;
      const userMessage = buildStandupMessage(contextMsg);

      context.log('[StandupRun] Calling', agentId, '(' + (index + 1) + '/' + STANDUP_ORDER.length + ')');

      let reply = '';
      try {
        reply = await callGemini(systemPrompt, userMessage);
      } catch (err) {
        context.log.error('[StandupRun] Gemini error for', agentId, ':', err.message);
        reply = '(no response — API error)';
      }

      const entry = {
        agentId, name: agent.name, role: agent.role,
        color: agent.color, icon: agent.icon,
        reply: reply || '(no response)',
        timestamp: new Date().toISOString()
      };

      standup.entries.push(entry);
      standup.rawReplies[agentId] = reply || '(no response)';
      transcript += agent.name + ' (' + agent.role + '): ' + (reply || '(no response)') + '\n\n';

      // Parse proposals
      try {
        const parsed = parseStandupReply(reply, agentId);
        if (parsed.tasks.length > 0) {
          if (parsed.tasks.length > MAX_PROPOSED_TASKS_PER_AGENT) {
            parsed.tasks = parsed.tasks.slice(0, MAX_PROPOSED_TASKS_PER_AGENT);
          }
          parsed.tasks.forEach(t => { t.proposedBy = agentId; });
          standup.proposals.tasks = standup.proposals.tasks.concat(parsed.tasks);
        }
        if (parsed.directives.length > 0) {
          parsed.directives.forEach(d => { d.proposedBy = agentId; });
          standup.proposals.directives = standup.proposals.directives.concat(parsed.directives);
        }
        if (parsed.risks.length > 0) {
          standup.riskSummary = standup.riskSummary.concat(parsed.risks);
        }
      } catch (parseErr) {
        context.log.warn('[StandupRun] Parse error for', agentId, ':', parseErr.message);
        standup.parseErrors.push({ agentId, error: parseErr.message, at: new Date().toISOString() });
      }
    }

    // ── Post-processing ──
    standup.status = 'complete';

    // Enforce directive limit
    const novaDirectives = standup.proposals.directives.filter(d => d.proposedBy === 'nova');
    let otherDirectives = standup.proposals.directives.filter(d => d.proposedBy !== 'nova');
    if (otherDirectives.length > MAX_PROPOSED_DIRECTIVES_PER_STANDUP) {
      otherDirectives = otherDirectives.slice(0, MAX_PROPOSED_DIRECTIVES_PER_STANDUP);
    }
    standup.proposals.directives = novaDirectives.concat(otherDirectives);

    // Deduplicate
    standup.proposals.tasks = dedupeProposals(standup.proposals.tasks);
    standup.proposals.directives = dedupeProposals(standup.proposals.directives);
    standup.riskSummary = aggregateRisks(standup.riskSummary);

    // ── Save standup log ──
    standupLog.push(standup);
    const trimmed = standupLog.length > MAX_STANDUPS ? standupLog.slice(-MAX_STANDUPS) : standupLog;
    await storage.setState('standupLog', trimmed);

    const durationMs = Date.now() - startTime;
    context.log('[StandupRun] Complete in', durationMs, 'ms. Tasks:', standup.proposals.tasks.length, 'Directives:', standup.proposals.directives.length);

    // ── Governance audit entry ──
    await writeGovernanceEntry('success', {
      source: 'cron', runDate: today, standupId,
      durationMs, agentsCount: standup.entries.length,
      proposedTasks: standup.proposals.tasks.length,
      proposedDirectives: standup.proposals.directives.length,
      risks: standup.riskSummary.length
    });

    _running = false;

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        ok: true, skipped: false, standupId,
        agentsCount: standup.entries.length,
        durationMs,
        proposedTasks: standup.proposals.tasks.length,
        proposedDirectives: standup.proposals.directives.length,
        risks: standup.riskSummary.length
      }
    };

  } catch (err) {
    _running = false;
    context.log.error('[StandupRun] Fatal error:', err.message, err.stack);

    await writeGovernanceEntry('error', {
      source: 'cron', runDate: today,
      error: err.message, durationMs: Date.now() - startTime
    });

    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { ok: false, error: 'standup_failed', message: err.message }
    };
  }
};

// ── Governance log writer ──
async function writeGovernanceEntry(status, meta) {
  try {
    const govLog = (await storage.getState('governanceLog')) || [];
    govLog.push({
      id: 'gov-standup-' + Date.now(),
      type: 'standup_auto_run',
      status,
      meta,
      timestamp: new Date().toISOString()
    });
    if (govLog.length > 500) govLog.splice(0, govLog.length - 500);
    await storage.setState('governanceLog', govLog);
  } catch (e) {
    console.error('[StandupRun] Failed to write governance entry:', e.message);
  }
}
