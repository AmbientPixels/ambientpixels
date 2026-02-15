const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');

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
- create-task: {"type":"create-task","task":{"title":"...","description":"...","status":"todo","priority":"high|medium|low|critical","assignee":"agent_id","dueDate":"ISO datetime","directive_id":"optional"}}
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
    const directives = (await storage.getState('directives')) || [];
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

    // Directives
    const activeDirectives = directives.filter(d => d.status === 'active').slice(0, 5);
    const directiveSummary = activeDirectives.map(d =>
      '- ' + d.title + ' (priority: ' + (d.priority || 'medium') + ', id: ' + d.id + ')'
    ).join('\n') || '(none)';

    // Objectives
    const activeObjectives = objectives.filter(o => o.status === 'active' || !o.status).slice(0, 5);
    const objectivesSummary = activeObjectives.map(o =>
      '- "' + o.title + '" Q' + (o.quarter || '?') + ' (progress: ' + (o.progress || 0) + '%, id: ' + o.id + ')'
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
      '\n\nActive CEO directives:\n' + directiveSummary +
      '\n\nActive objectives:\n' + objectivesSummary +
      '\n\nRecent documents:\n' + recentDocs;
    if (memorySummary) ctx += '\n\nWorkspace notes:\n' + memorySummary;
    if (upcomingDates) ctx += '\n\nUpcoming dates:\n' + upcomingDates;
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

// Execute actions from chat and return results
async function executeChatActions(context, actions, agentId) {
  const results = [];
  const validActions = actions.slice(0, 3);

  for (const action of validActions) {
    try {
      if (agentId === 'quill' && QUILL_FORBIDDEN_CHAT.includes(action.type)) {
        results.push({ type: action.type, success: false, summary: 'Quill cannot perform ' + action.type });
        continue;
      }

      switch (action.type) {
        case 'create-task': {
          const t = action.task || {};
          const tasks = (await storage.getState('tasks')) || [];
          const newTask = {
            id: 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            title: t.title || 'Untitled Task',
            description: t.description || '',
            status: t.status || 'todo',
            priority: t.priority || 'medium',
            assignee: t.assignee || null,
            dueDate: t.dueDate || null,
            directive_id: t.directive_id || null,
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

    // Build system instruction: agent prompt + shared rules + (context + actions if enabled)
    const systemInstruction = AGENT_PROMPTS[agentId] + SHARED_RULES +
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
      userText = `[MODE: DAILY STANDUP] You are in the daily team standup meeting at AmbientPixels. Give your update in your role's voice. Keep it concise (3-5 sentences max). Cover: what you're focused on, any blockers or concerns, and one priority for today. If other team members have already spoken (their updates are below), you can reference or respond to what they said — agree, push back, ask a question, or build on their point. Be natural, like a real standup.\n\n${message}`;
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
        maxOutputTokens: mode === 'report' ? 1500 : mode === 'standup' ? 400 : 1500
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
