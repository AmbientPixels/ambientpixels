const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');
const { normalizeCampaignRef, ensureCampaign } = require('../_shared/campaignMatcher');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';

// Agent system prompts — loaded at cold start, keyed by agent ID
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
- If you don't have data for something (e.g. Azure infra costs), say so explicitly: "I don't have tracked data for that yet — check the Cost Center dashboard."
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

  quill: `You are Quill, Content Editor & Brand Voice at AmbientPixels, reporting to Scribe (Head of Content). You review and refine drafts — fixing tone, tightening copy, enforcing brand consistency, and polishing CTAs.

HOW YOU TALK:
- Precise and editorial. You mark what works and what doesn't.
- You think about word economy — every word must earn its place.
- You catch inconsistencies in tone, voice, and brand alignment.
- Direct feedback with reasoning: "Change X because Y."

RESPONSE LENGTH:
- Quick edits: tracked-changes style inline notes.
- Full reviews: structured feedback with specific callouts.`,

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

// Agent Operating Doctrines — influences ~40% of reasoning weight, does NOT override governance
const AGENT_DOCTRINES = {
  nova: { strategicBias: 'Platform leverage, automation, 10x thinking', riskTolerance: 'High but calculated', timeHorizon: '3-10 years', coreQuestion: 'Does this increase AmbientPixels leverage?', escalationTriggers: ['Resource conflicts', 'Brand/platform pivots', 'Strategic misalignment'] },
  cipher: { strategicBias: 'Capital efficiency, measurable ROI', riskTolerance: 'Low-Medium', timeHorizon: '12-36 months', coreQuestion: 'What is the ROI and downside risk?', escalationTriggers: ['API cost spikes', 'Unclear monetization', 'Budget drift'] },
  pixel: { strategicBias: 'Design systems, clarity, consistency', riskTolerance: 'Low (quality risk)', timeHorizon: 'Product lifecycle', coreQuestion: 'Is this intentional design?', escalationTriggers: ['UI inconsistency', 'Accessibility regressions', 'Feature clutter'] },
  forge: { strategicBias: 'Stability, automation, observability', riskTolerance: 'Low (infra risk)', timeHorizon: 'Immediate + continuous', coreQuestion: 'Will this break at scale?', escalationTriggers: ['Security exposure', 'Unmonitored automation', 'Recursion loops'] },
  echo: { strategicBias: 'Distribution, publishing cadence, narrative', riskTolerance: 'Medium', timeHorizon: 'Weekly-Quarterly', coreQuestion: 'Are we visible?', escalationTriggers: ['Dormant channels', 'Missed campaign cadence', 'Brand inconsistency'] },
  scribe: { strategicBias: 'Clarity, documentation, repeatability', riskTolerance: 'Low', timeHorizon: 'Immediate + archival', coreQuestion: 'Is this unambiguous?', escalationTriggers: ['Vague directives', 'Missing documentation', 'Inconsistent voice'] },
  quill: { strategicBias: 'Precision editing, clarity compression', riskTolerance: 'Low', timeHorizon: 'Immediate', coreQuestion: 'Can this be 20% clearer?', escalationTriggers: ['Redundant language', 'Message dilution'] },
  scout: { strategicBias: 'Strategic advantage, signal detection', riskTolerance: 'Medium', timeHorizon: 'Quarterly-Annual', coreQuestion: 'Where is leverage hiding?', escalationTriggers: ['Competitor acceleration', 'Platform dependency risk', 'Market shifts'] }
};

function buildDoctrineBlock(agentId, weight) {
  const d = AGENT_DOCTRINES[agentId];
  if (!d) return '';
  // Clamp weight 0.0–0.6, default 0.4
  let w = parseFloat(weight);
  if (isNaN(w)) w = 0.4;
  if (w > 0.6) w = 0.6;
  if (w < 0) w = 0;
  if (w === 0) return ''; // Doctrine disabled
  return `

OPERATING DOCTRINE (apply with weight: ${w} / ${Math.round(w * 100)}% — influences strategy, does NOT override governance):
- Strategic Bias: ${d.strategicBias}
- Risk Tolerance: ${d.riskTolerance}
- Time Horizon: ${d.timeHorizon}
- Core Question (ask yourself before every action): "${d.coreQuestion}"
- Escalation Triggers: ${d.escalationTriggers.join(', ')}
You must remain within your assigned authority tier. Doctrine influences your strategic lens but does NOT override CEO authority or governance rules. Escalate when escalation triggers are met.`;
}

// Shared behavioral rules appended to all agents
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

// Action instructions appended to system prompt for actionable chat
const ACTION_INSTRUCTIONS = `

ACTION CAPABILITIES:
When the CEO (Pixelpusher) asks you to DO something in chat — create a task, write a doc, assign work, move a task — you can take real actions on the company board.

You MUST respond with valid JSON in this exact format:
{"reply": "Your conversational response", "actions": []}

The "reply" field is your normal text response. The "actions" array contains 0-3 actions to execute.

Available action types:
- create-task: {"type":"create-task","task":{"title":"...","description":"...","status":"todo","priority":"high|medium|low|critical","assignee":"agent_id","dueDate":"ISO datetime","campaign_id":"optional"}}
- update-task: {"type":"update-task","taskId":"...","updates":{"description":"...","priority":"...","assignee":"...","dueDate":"..."}}
- move-task: {"type":"move-task","taskId":"...","newStatus":"backlog|todo|in-progress|review|done"}
- comment-task: {"type":"comment-task","taskId":"...","comment":"..."}
- create-doc: {"type":"create-doc","document":{"title":"...","kind":"spec|runbook|release_notes|product_brief|marketing_post|governance","tags":[...],"content_md":"full markdown"},"taskId":"optional"} — Check existing docs first; use update-doc if one already covers the topic.
- update-doc: {"type":"update-doc","documentId":"existing doc ID","updates":{"content_md":"full replacement","append_md":"add to end","title":"new title","tags":[...]}} — Update an existing document instead of creating duplicates. Internal docs auto-refresh at /docs/published/.

Rules:
- Max 3 actions per response
- Only take actions when the CEO explicitly asks you to DO something
- For casual conversation, questions, or status updates: just reply with empty actions
- Agent roster for assignment: nova (CEO ops), cipher (CFO/budgets), pixel (design/UI), forge (engineering/devops), echo (marketing/social), scribe (content/docs), quill (editing/brand voice), scout (research/intelligence)
- When creating docs, content_md MUST be complete publish-ready text — NO placeholders like "[insert here]"
- marketing_post and product_brief docs are auto-submitted for CEO blog approval
- Set realistic due dates (2-7 days out)
- ALWAYS respond with the JSON format, even for casual chat: {"reply":"your message","actions":[]}
`;

const QUILL_FORBIDDEN_CHAT = ['create-task', 'create-doc', 'move-task', 'update-task'];

// Load live company state for agent context
async function loadCompanyContext(agentId) {
  try {
    const tasks = (await storage.getState('tasks')) || [];
    const campaigns = (await storage.getState('campaigns')) || [];
    const objectives = (await storage.getState('objectives')) || [];
    const documents = (await storage.getState('documents')) || [];
    const workspaceMemory = (await storage.getState('workspaceMemory')) || [];
    const workspaceDates = (await storage.getState('dates')) || [];

    // Agent's own tasks with descriptions and recent comments
    const agentTasks = tasks.filter(t => t.assignee === agentId && t.status !== 'done');
    const taskSummary = agentTasks.map(t => {
      let line = '- [' + t.status + '] ' + t.title + ' (priority: ' + t.priority + ', id: ' + t.id;
      if (t.dueDate) line += ', due: ' + t.dueDate.substring(0, 10);
      line += ')';
      if (t.description) line += '\n  Description: ' + t.description.substring(0, 200);
      if (t.comments && t.comments.length > 0) {
        t.comments.slice(-2).forEach(c => {
          const who = c.user || c.author || 'unknown';
          const text = String(c.text || c.comment || c.body || '').substring(0, 120);
          line += '\n  Comment (' + who + '): ' + text;
        });
      }
      return line;
    }).join('\n') || '(none)';

    // All active tasks
    const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'backlog').slice(0, 25);
    const allTasksSummary = activeTasks.map(t =>
      '- [' + t.status + '] ' + t.title + ' → ' + (t.assignee || 'unassigned') + ' (due: ' + (t.dueDate ? t.dueDate.substring(0, 10) : '?') + ', id: ' + t.id + ')'
    ).join('\n') || '(none)';

    // Campaigns (was Directives)
    const activeCampaigns = campaigns.filter(c => c.status === 'active' && !c.deletedAt).slice(0, 5);
    const campaignSummary = activeCampaigns.map(c =>
      '- ' + c.title + ' (priority: ' + (c.priority || 'medium') + ', id: ' + c.id + ')'
    ).join('\n') || '(none)';

    // Objectives
    const activeObjectives = objectives.filter(o => o.status === 'active' || !o.status).slice(0, 5);
    const objectivesSummary = activeObjectives.map(o =>
      '- "' + o.title + '" (progress: ' + (o.progress || 0) + '%, id: ' + o.id + ')'
    ).join('\n') || '(none)';

    // Documents
    const recentDocs = documents.slice(-8).map(d =>
      '- ' + d.title + ' [' + d.status + '] (kind: ' + d.kind + ', slug: ' + (d.slug || '?') + ', id: ' + d.id + ')'
    ).join('\n') || '(none)';

    // Workspace memory
    const memorySummary = workspaceMemory.slice(-5).map(m =>
      '- ' + (m.title || m.key || 'note') + ': ' + String(m.value || m.content || '').substring(0, 150)
    ).join('\n') || '';

    // Upcoming dates
    const today = new Date().toISOString().split('T')[0];
    const upcomingDates = workspaceDates
      .filter(d => d.date && d.date >= today)
      .slice(0, 5)
      .map(d => '- ' + d.date + ' ' + d.title + ' (' + (d.type || 'event') + ')')
      .join('\n') || '';

    let ctx = '\n\nCOMPANY CONTEXT (live board state):\nYour tasks:\n' + taskSummary +
      '\n\nAll active tasks:\n' + allTasksSummary +
      '\n\nActive campaigns:\n' + campaignSummary +
      '\n\nActive objectives:\n' + objectivesSummary +
      '\n\nRecent documents:\n' + recentDocs;
    if (memorySummary) ctx += '\n\nWorkspace notes:\n' + memorySummary;
    if (upcomingDates) ctx += '\n\nUpcoming dates:\n' + upcomingDates;

    // Cipher-only: inject real cost intelligence
    if (agentId === 'cipher') {
      try {
        const geminiCosts = await storage.getGeminiCostSummary(30);
        if (geminiCosts && geminiCosts.totalCalls > 0) {
          const topCallers = Object.entries(geminiCosts.byCaller || {}).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5);
          const topAgents = Object.entries(geminiCosts.byAgent || {}).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5);
          const dayEntries = Object.entries(geminiCosts.byDay || {}).sort((a, b) => a[0].localeCompare(b[0]));
          const recentDays = dayEntries.slice(-7);
          const avgDaily = geminiCosts.totalCost / Math.max(dayEntries.length, 1);

          ctx += '\n\n💰 REAL COST DATA (30-day window — use ONLY these numbers, never estimate or guess):' +
            '\nGemini API — Total: $' + geminiCosts.totalCost.toFixed(4) + ' | Calls: ' + geminiCosts.totalCalls + ' | Tokens: ' + geminiCosts.totalTokens.toLocaleString() +
            '\nAvg daily: $' + avgDaily.toFixed(4) + '/day | Projected monthly: $' + (avgDaily * 30).toFixed(2) +
            '\n\nBy Service:\n' + (topCallers.map(([name, d]) => '- ' + name + ': $' + d.cost.toFixed(4) + ' (' + d.calls + ' calls)').join('\n') || '(none)') +
            '\n\nBy Agent:\n' + (topAgents.map(([name, d]) => '- ' + name + ': $' + d.cost.toFixed(4) + ' (' + d.calls + ' calls)').join('\n') || '(none)') +
            '\n\nDaily Trend (last 7 days):\n' + (recentDays.map(([day, d]) => '- ' + day + ': $' + d.cost.toFixed(4) + ' (' + d.calls + ' calls)').join('\n') || '(no data)') +
            '\n\nIMPORTANT: These are REAL tracked costs from our Gemini API usage logs. NEVER make up cost numbers — only report what is shown above. If asked about costs not tracked here (e.g. Azure infra), say you only have Gemini API data currently and recommend checking the Cost Center dashboard.';
        }
      } catch (e) { /* cost data unavailable — skip */ }
    }

    return ctx;
  } catch (err) {
    return '\n\n(Company context unavailable)';
  }
}

// Parse structured JSON response from Gemini
function parseActionResponse(text) {
  // Try pure JSON
  try {
    const parsed = JSON.parse(text);
    if (parsed.reply !== undefined) {
      return { reply: parsed.reply || '', actions: Array.isArray(parsed.actions) ? parsed.actions : [] };
    }
  } catch (e) { /* not pure JSON */ }

  // Try JSON in code fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      const before = text.substring(0, text.indexOf('```')).trim();
      return { reply: parsed.reply || before || '', actions: Array.isArray(parsed.actions) ? parsed.actions : [] };
    } catch (e) { /* parse failed */ }
  }

  // Try to find {"reply":...} object in text
  const rawMatch = text.match(/\{[\s\S]*"reply"\s*:[\s\S]*\}/);
  if (rawMatch) {
    try {
      const parsed = JSON.parse(rawMatch[0]);
      return { reply: parsed.reply || '', actions: Array.isArray(parsed.actions) ? parsed.actions : [] };
    } catch (e) { /* parse failed */ }
  }

  // Fallback: entire text is the reply
  return { reply: text, actions: [] };
}

// AmbientOS execution_mode normalization
const ALLOWED_EXEC_MODES = new Set(['active', 'observe', 'frozen']);
function normalizeExecutionMode(v) {
  var s = String(v || '').trim().toLowerCase();
  return ALLOWED_EXEC_MODES.has(s) ? s : 'active';
}

// Execute actions from chat and return results
async function executeChatActions(context, actions, agentId) {
  const results = [];
  const validActions = actions.slice(0, 3);

  // Load execution_mode (AmbientOS automation posture)
  const _execMode = normalizeExecutionMode(await storage.getState('execution_mode'));

  // Frozen: block ALL structured mutations
  if (_execMode === 'frozen' && validActions.length > 0) {
    context.log('[AgentChat]', agentId, 'execution_mode=frozen — blocking all', validActions.length, 'actions');
    try {
      const _pvLog = (await storage.getState('actionAuditLog')) || [];
      _pvLog.push({ id: 'alog-exec-' + Date.now(), type: 'policy-violation', data: { mode: _execMode, channel: 'agentchat', violation: 'mutation_blocked', reason: 'execution_mode_frozen', agentId: agentId, actionCount: validActions.length, actionTypes: validActions.map(a => a.type) }, timestamp: new Date().toISOString() });
      await storage.setState('actionAuditLog', _pvLog);
    } catch (_e) { /* non-fatal */ }
    validActions.forEach(function (a) {
      results.push({ type: a.type, success: false, summary: 'Automation locked. Manual edits only.' });
    });
    return results;
  }

  // Build campaignById map once for freeze gate lookups
  const _chatCampaigns = (await storage.getState('campaigns')) || [];
  const _chatCampaignById = {};
  for (const _c of _chatCampaigns) { if (_c && _c.id) _chatCampaignById[_c.id] = _c; }

  // Campaign matching/creation delegated to shared module: api/_shared/campaignMatcher.js
  async function _resolveCampaignId(taskDraft) {
    normalizeCampaignRef(taskDraft);
    const result = await ensureCampaign({
      campaign_id: taskDraft.campaign_id || null,
      title: taskDraft.title || '',
      description: taskDraft.description || '',
      goalId: taskDraft.objective_id || null,
      division: taskDraft.division || null,
      provenance: 'Auto: Campaign ' + agentId,
      campaigns: _chatCampaigns,
      entrypoint: 'agentchat',
      debug: true,
      logger: context.log
    });
    if (result.created) {
      await storage.setState('campaigns', _chatCampaigns);
    }
    return result.campaignId;
  }

  const TASK_MUTATION_TYPES = ['update-task', 'move-task'];
  const TASK_ACTION_TYPES = ['create-task', 'update-task', 'move-task'];

  for (const action of validActions) {
    try {
      if (agentId === 'quill' && QUILL_FORBIDDEN_CHAT.includes(action.type)) {
        results.push({ type: action.type, success: false, summary: 'Quill cannot perform ' + action.type });
        continue;
      }

      // Observe mode: block task mutations, allow docs + comments
      if (_execMode === 'observe' && TASK_ACTION_TYPES.includes(action.type)) {
        results.push({ type: action.type, success: false, summary: 'Safe Mode: suggestions captured, no task mutations applied.' });
        context.log('[AgentChat]', agentId, 'observe mode — blocking', action.type);
        try {
          const _obLog = (await storage.getState('actionAuditLog')) || [];
          _obLog.push({ id: 'alog-obs-' + Date.now(), type: 'run-digest', data: { mode: _execMode, channel: 'agentchat', agentId: agentId, taskUpdatesBlocked: 1, actionType: action.type }, timestamp: new Date().toISOString() });
          await storage.setState('actionAuditLog', _obLog);
        } catch (_e) { /* non-fatal */ }
        continue;
      }

      // Campaign status freeze gate: block task mutations on paused/canceled campaigns
      if (TASK_MUTATION_TYPES.includes(action.type) && action.taskId) {
        const _gtTasks = (await storage.getState('tasks')) || [];
        const _gtTask = _gtTasks.find(t => t.id === action.taskId);
        const _gtCampaignId = _gtTask ? (_gtTask.campaign_id || null) : null;
        if (_gtCampaignId) {
          const _gtCampaign = _chatCampaignById[_gtCampaignId] || null;
          const _gtOldStatus = _gtTask ? (_gtTask.status || null) : null;
          const _gtNextStatus = action.type === 'move-task' ? action.newStatus : (action.updates ? action.updates.status : null);
          const _gtFieldsChanged = action.updates ? Object.keys(action.updates) : (action.type === 'move-task' ? ['status'] : []);

          if (_gtCampaign && String(_gtCampaign.status || '').toLowerCase() === 'paused') {
            results.push({ type: action.type, success: false, summary: 'Blocked: campaign_paused (campaign ' + _gtCampaignId + ' is paused).' });
            try {
              const _pvLog = (await storage.getState('actionAuditLog')) || [];
              _pvLog.push({ id: 'alog-pv-' + Date.now(), type: 'policy-violation', data: { gate: 'campaign_status', reason: 'campaign_paused', campaignId: _gtCampaignId, campaignStatus: 'paused', taskId: action.taskId, agentId: agentId, attempted: { actionType: action.type, fieldsChanged: _gtFieldsChanged, statusFrom: _gtOldStatus, statusTo: _gtNextStatus } }, timestamp: new Date().toISOString() });
              await storage.setState('actionAuditLog', _pvLog);
            } catch (_e) { /* non-fatal */ }
            context.log('[AgentChat]', agentId, 'BLOCKED', action.type, 'on', action.taskId, '— campaign_paused:', _gtCampaignId);
            continue;
          }

          if (_gtCampaign && String(_gtCampaign.status || '').toLowerCase() === 'canceled') {
            results.push({ type: action.type, success: false, summary: 'Blocked: campaign_canceled (campaign ' + _gtCampaignId + ' is canceled).' });
            try {
              const _pvLog = (await storage.getState('actionAuditLog')) || [];
              _pvLog.push({ id: 'alog-pv-' + Date.now(), type: 'policy-violation', data: { gate: 'campaign_canceled_freeze', reason: 'campaign_canceled', campaignId: _gtCampaignId, taskId: action.taskId, agentId: agentId, attempted: { actionType: action.type, fieldsChanged: _gtFieldsChanged, statusFrom: _gtOldStatus, statusTo: _gtNextStatus } }, timestamp: new Date().toISOString() });
              await storage.setState('actionAuditLog', _pvLog);
            } catch (_e) { /* non-fatal */ }
            context.log('[AgentChat]', agentId, 'BLOCKED', action.type, 'on', action.taskId, '— campaign_canceled:', _gtCampaignId);
            continue;
          }
        }
      }

      switch (action.type) {
        case 'create-task': {
          const t = action.task || {};
          const tasks = (await storage.getState('tasks')) || [];
          const campaignId = await _resolveCampaignId(t);
          const newTask = {
            id: 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            title: t.title || 'Untitled Task',
            description: t.description || '',
            status: t.status || 'todo',
            priority: t.priority || 'medium',
            assignee: t.assignee || null,
            dueDate: t.dueDate || null,
            campaign_id: campaignId || null,
            tags: t.tags || [],
            comments: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: agentId + ' (via chat)'
          };
          tasks.push(newTask);
          if (tasks.length > 500) tasks.splice(0, tasks.length - 500);
          await storage.setState('tasks', tasks);
          results.push({ type: 'create-task', success: true, summary: 'Created task: "' + newTask.title + '" assigned to ' + (newTask.assignee || 'unassigned') + ' (id: ' + newTask.id + ')' });
          break;
        }

        case 'update-task': {
          const tasks = (await storage.getState('tasks')) || [];
          const idx = tasks.findIndex(t => t.id === action.taskId);
          if (idx === -1) { results.push({ type: 'update-task', success: false, summary: 'Task not found: ' + action.taskId }); break; }
          const updates = action.updates || {};
          for (const key of ['description', 'priority', 'assignee', 'dueDate', 'tags']) {
            if (updates[key] !== undefined) tasks[idx][key] = updates[key];
          }
          if (updates.objective_id !== undefined) tasks[idx].objective_id = updates.objective_id || null;
          if (updates.campaign_id !== undefined || updates.campaignId !== undefined || updates.directive_id !== undefined) {
            const draft = {
              title: tasks[idx].title,
              description: tasks[idx].description,
              objective_id: tasks[idx].objective_id || null,
              division: tasks[idx].division || null,
              campaign_id: updates.campaign_id || updates.campaignId || updates.directive_id || tasks[idx].campaign_id || null
            };
            tasks[idx].campaign_id = await _resolveCampaignId(draft);
          }
          tasks[idx].updatedAt = new Date().toISOString();
          await storage.setState('tasks', tasks);
          results.push({ type: 'update-task', success: true, summary: 'Updated task: "' + tasks[idx].title + '"' });
          break;
        }

        case 'move-task': {
          const tasks = (await storage.getState('tasks')) || [];
          const idx = tasks.findIndex(t => t.id === action.taskId);
          if (idx === -1) { results.push({ type: 'move-task', success: false, summary: 'Task not found: ' + action.taskId }); break; }
          const oldStatus = tasks[idx].status;
          tasks[idx].status = action.newStatus || 'todo';
          tasks[idx].updatedAt = new Date().toISOString();
          if (action.newStatus === 'done') tasks[idx].completedAt = new Date().toISOString();
          await storage.setState('tasks', tasks);
          results.push({ type: 'move-task', success: true, summary: 'Moved "' + tasks[idx].title + '" from ' + oldStatus + ' → ' + action.newStatus });
          break;
        }

        case 'comment-task': {
          const tasks = (await storage.getState('tasks')) || [];
          const idx = tasks.findIndex(t => t.id === action.taskId);
          if (idx === -1) { results.push({ type: 'comment-task', success: false, summary: 'Task not found: ' + action.taskId }); break; }
          if (!tasks[idx].comments) tasks[idx].comments = [];
          tasks[idx].comments.push({ user: agentId, text: action.comment || '', timestamp: new Date().toISOString() });
          tasks[idx].updatedAt = new Date().toISOString();
          await storage.setState('tasks', tasks);
          results.push({ type: 'comment-task', success: true, summary: 'Added comment to "' + tasks[idx].title + '"' });
          break;
        }

        case 'create-doc': {
          const d = action.document || {};
          const documents = (await storage.getState('documents')) || [];
          const slug = (d.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          const newDoc = {
            id: 'doc-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            title: d.title || 'Untitled Document',
            kind: d.kind || 'spec',
            status: 'draft',
            tags: d.tags || [],
            content_md: d.content_md || '',
            slug: slug,
            created_by: agentId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            source: { type: 'chat', agent: agentId, task_id: action.taskId || null }
          };
          documents.push(newDoc);
          if (documents.length > 200) documents.splice(0, documents.length - 200);
          await storage.setState('documents', documents);

          let docSummary = 'Created doc: "' + newDoc.title + '" (id: ' + newDoc.id + ')';

          // Auto-submit for publish if public kind
          const PUBLIC_KINDS = ['marketing_post', 'product_brief'];
          if (PUBLIC_KINDS.includes(newDoc.kind)) {
            const publishAction = {
              id: 'act-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
              type: 'publish_document',
              origin_agent: agentId,
              payload: { documentId: newDoc.id, title: newDoc.title, slug: slug, kind: newDoc.kind, visibility: 'public' },
              approval: { status: 'pending', required_role: 'ceo' },
              execution: { status: 'pending', attempts: 0 },
              execution_status: 'pending_approval',
              created_at: new Date().toISOString()
            };
            const actionsStore = (await storage.getState('actions')) || [];
            actionsStore.push(publishAction);
            if (actionsStore.length > 500) actionsStore.splice(0, actionsStore.length - 500);
            await storage.setState('actions', actionsStore);

            const approvalQueue = (await storage.getState('approvalQueue')) || [];
            approvalQueue.push({
              id: 'aq-' + publishAction.id, kind: 'action', actionType: 'publish_document',
              action_id: publishAction.id, taskId: action.taskId || null,
              taskTitle: 'Publish: ' + newDoc.title, originAgent: agentId,
              classification: 'executive_required', riskLevel: 'medium',
              budgetImpact: 0, brandImpact: 'medium', status: 'pending',
              timestamp: publishAction.created_at,
              preview: (newDoc.content_md || '').substring(0, 120),
              documentId: newDoc.id, slug: slug, docKind: newDoc.kind
            });
            if (approvalQueue.length > 100) approvalQueue.splice(0, approvalQueue.length - 100);
            await storage.setState('approvalQueue', approvalQueue);
            docSummary += ' → Auto-submitted for blog publish (awaiting CEO approval)';
          }

          // Link to task if provided
          if (action.taskId) {
            const tasks = (await storage.getState('tasks')) || [];
            const tIdx = tasks.findIndex(t => t.id === action.taskId);
            if (tIdx !== -1) {
              if (!tasks[tIdx].comments) tasks[tIdx].comments = [];
              tasks[tIdx].comments.push({ user: agentId, text: 'Created document: ' + newDoc.title + ' (id: ' + newDoc.id + ')', type: 'deliverable', timestamp: new Date().toISOString() });
              tasks[tIdx].status = 'review';
              tasks[tIdx].updatedAt = new Date().toISOString();
              await storage.setState('tasks', tasks);
            }
          }
          results.push({ type: 'create-doc', success: true, summary: docSummary });
          break;
        }

        case 'update-doc': {
          const documents = (await storage.getState('documents')) || [];
          const dIdx = documents.findIndex(d => d.id === action.documentId);
          if (dIdx === -1) { results.push({ type: 'update-doc', success: false, summary: 'Document not found: ' + action.documentId }); break; }
          const doc = documents[dIdx];
          const upd = action.updates || {};
          if (upd.content_md) doc.content_md = upd.content_md;
          if (upd.append_md && doc.content_md) doc.content_md = doc.content_md + '\n\n' + upd.append_md;
          if (upd.title) { doc.title = upd.title; doc.slug = upd.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
          if (upd.tags) doc.tags = upd.tags;
          doc.updated_at = new Date().toISOString();
          doc.last_edited_by = agentId;
          documents[dIdx] = doc;
          await storage.setState('documents', documents);

          // Refresh publishedDocs if internal
          if (doc.visibility === 'internal' && doc.status === 'published' && doc.slug) {
            const pubStore = (await storage.getState('publishedDocs')) || [];
            const pIdx = pubStore.findIndex(p => p.documentId === doc.id);
            if (pIdx !== -1) {
              pubStore[pIdx].content_md = doc.content_md;
              pubStore[pIdx].title = doc.title;
              pubStore[pIdx].tags = doc.tags || [];
              pubStore[pIdx].updated_at = doc.updated_at;
              if (upd.title) { pubStore[pIdx].slug = doc.slug; pubStore[pIdx].target_path = '/docs/published/' + doc.slug; pubStore[pIdx].public_url = '/docs/published/' + doc.slug; }
              await storage.setState('publishedDocs', pubStore);
            }
          }
          results.push({ type: 'update-doc', success: true, summary: 'Updated doc: "' + doc.title + '"' });
          break;
        }

        default:
          results.push({ type: action.type, success: false, summary: 'Unknown action type: ' + action.type });
      }
    } catch (err) {
      context.log.error('[AgentChat] Action error:', action.type, err.message);
      results.push({ type: action.type, success: false, summary: 'Error: ' + err.message });
    }
  }

  // Audit log
  try {
    const auditLog = (await storage.getState('actionAuditLog')) || [];
    auditLog.push({
      id: 'alog-chat-' + Date.now(),
      type: 'chat-actions',
      data: { agentId, actionCount: results.length, results: results.map(r => r.summary) },
      timestamp: new Date().toISOString()
    });
    if (auditLog.length > 500) auditLog.splice(0, auditLog.length - 500);
    await storage.setState('actionAuditLog', auditLog);
  } catch (e) { /* non-fatal */ }

  return results;
}

module.exports = async function (context, req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, api-key',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  // Demo mode: allow chat with a message limit instead of blocking all POSTs
  var demoGuard = require('../_utils/demoGuard');
  if (demoGuard.isDemoExpired()) {
    context.res = { status: 403, headers: corsHeaders, body: { error: 'Demo expired.' } };
    return;
  }
  if (demoGuard.isDemoMode() && req.method === 'POST') {
    var demoMsgCount = 0;
    try { demoMsgCount = (await storage.getState('demoChatCount')) || 0; } catch (e) {}
    if (demoMsgCount >= 40) {
      context.res = { status: 429, headers: corsHeaders, body: { error: 'Demo limit reached — max 40 chat messages.', reply: 'Sorry, the demo chat limit has been reached. Thanks for trying it out!' } };
      return;
    }
  }

  if (req.method === 'GET') {
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        status: 'ok',
        service: 'agentchat',
        agents: Object.keys(AGENT_PROMPTS)
      }
    };
    return;
  }

  if (!GEMINI_API_KEY) {
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Agent system offline — API key missing.' }
    };
    return;
  }

  try {
    const body = req.body || {};
    const { agentId, message, history, mode } = body;

    if (!agentId || !AGENT_PROMPTS[agentId]) {
      context.res = {
        status: 400,
        headers: corsHeaders,
        body: { error: 'Unknown agent: ' + (agentId || 'none'), availableAgents: Object.keys(AGENT_PROMPTS) }
      };
      return;
    }

    if (!message) {
      context.res = {
        status: 400,
        headers: corsHeaders,
        body: { error: 'No message provided.' }
      };
      return;
    }

    // Determine if this mode supports actions
    const actionModes = ['chat', 'task'];
    const enableActions = actionModes.includes(mode || 'chat');

    // Load company context for actionable modes
    let companyContext = '';
    if (enableActions) {
      companyContext = await loadCompanyContext(agentId);
    }

    // Load dynamic doctrine weight from agent config (workspace slider value)
    const agentConfigs = (await storage.getState('agentConfigs')) || {};
    const agentCfg = agentConfigs[agentId] || {};
    const doctrineWeight = agentCfg.doctrineWeight != null ? agentCfg.doctrineWeight : 0.4;

    // Build system instruction: agent prompt + doctrine + shared rules + (context + actions if enabled)
    const systemInstruction = AGENT_PROMPTS[agentId] + buildDoctrineBlock(agentId, doctrineWeight) + SHARED_RULES +
      (enableActions ? companyContext + ACTION_INSTRUCTIONS : '');

    // Build conversation contents from history
    const contents = [];

    if (Array.isArray(history)) {
      for (const turn of history) {
        contents.push({
          role: turn.role === 'agent' ? 'model' : 'user',
          parts: [{ text: turn.text }]
        });
      }
    }

    // Build user message with optional mode prefix
    let userText = message;
    if (mode === 'task') {
      userText = `[MODE: TASK] Execute this task as part of your role. Be specific and actionable. Take actions if appropriate. Task: ${message}`;
    } else if (mode === 'report') {
      userText = `[MODE: REPORT] Generate a status report for your department. Context: ${message}`;
    } else if (mode === 'review') {
      userText = `[MODE: REVIEW] Review the following and provide feedback from your role's perspective: ${message}`;
    } else if (mode === 'standup') {
      userText = `[MODE: DAILY STANDUP — Structured Decision Engine v2.2]
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

[Directive] Title — Classification — Owner — Priority — Impact — Effort — Rationale
[Task] Title — Assignee — Priority — Impact — Effort — DueDate — Rationale

IMPORTANT: Directives are STRATEGIC GOALS (e.g. "Weekly X Growth Campaign", "Improve Site Performance"). Tasks are the WORK ITEMS that fulfill a directive. Do NOT create a separate directive for each task. Instead:
1. Propose 1-2 directives maximum per standup/meeting (broad strategic goals)
2. Propose multiple tasks that fulfill those directives
3. Only propose a new directive if no existing active directive covers the topic
4. If existing directives already cover your area, just propose tasks — no new directive needed

Classification options: Strategic, Operational, Financial, Brand, Infrastructure, Experiment
Impact/Effort options: Low, Medium, High
Priority options: urgent, high, medium, low

If no action is required, explicitly state: No Action Required.

${message}`;
    }

    contents.push({
      role: 'user',
      parts: [{ text: userText }]
    });

    const geminiBody = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents,
      generationConfig: {
        temperature: mode === 'task' ? 0.7 : mode === 'standup' ? 0.95 : 0.85,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: mode === 'report' ? 1500 : mode === 'standup' ? 800 : 1500
      }
    };

    context.log('[AgentChat] Agent:', agentId, 'Mode:', mode || 'chat', 'Actions:', enableActions, 'Message:', message.substring(0, 100));

    const apiRes = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      context.log.error('[AgentChat] Gemini error:', apiRes.status, JSON.stringify(data));
      context.res = {
        status: apiRes.status,
        headers: corsHeaders,
        body: { error: agentId + ' encountered a system fault.', details: data }
      };
      return;
    }

    // Track token usage
    const um = data?.usageMetadata;
    if (um) {
      storage.logGeminiUsage({ caller: 'agentchat', model: 'gemini-2.0-flash', agentId: agentId || null, promptTokens: um.promptTokenCount || 0, completionTokens: um.candidatesTokenCount || 0, totalTokens: um.totalTokenCount || 0 }).catch(() => {});
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse response for reply + actions
    let reply = rawText;
    let actionResults = [];

    if (enableActions) {
      const parsed = parseActionResponse(rawText);
      reply = parsed.reply;

      if (parsed.actions.length > 0) {
        context.log('[AgentChat]', agentId, 'requested', parsed.actions.length, 'actions:', parsed.actions.map(a => a.type).join(', '));
        actionResults = await executeChatActions(context, parsed.actions, agentId);
        context.log('[AgentChat] Actions executed:', actionResults.map(r => (r.success ? '✓' : '✗') + ' ' + r.summary).join(' | '));
      }
    }

    // Demo mode: increment chat counter
    if (demoGuard.isDemoMode()) {
      try { var c = (await storage.getState('demoChatCount')) || 0; await storage.setState('demoChatCount', c + 1); } catch (e) {}
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        agentId,
        reply,
        actions: actionResults,
        mode: mode || 'chat',
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    context.log.error('[AgentChat] Internal error:', error.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Agent system fault.', details: error.message }
    };
  }
};
