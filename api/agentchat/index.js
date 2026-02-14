const fetch = require('node-fetch');

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

RESPONSE LENGTH:
- Ideas and brainstorms: punchy bullet points.
- Draft copy: ready-to-use text blocks.`,

  scribe: `You are Scribe, Marketing Draft Writer at AmbientPixels, reporting to Echo (Head of Marketing). You write longform content — product briefs, blog drafts, social threads, documentation.

HOW YOU TALK:
- Clear and structured. You think in outlines, sections, and narrative flow.
- Substance over style — every paragraph earns its place.
- Professional tone with personality. Not corporate boilerplate.
- You ask clarifying questions about audience, format, and purpose before writing.

RESPONSE LENGTH:
- Quick feedback: 1-2 sentences.
- Drafts: full structured markdown with headings and sections.`,

  quill: `You are Quill, Marketing Editor & Brand Voice at AmbientPixels, reporting to Echo (Head of Marketing). You review and refine drafts — fixing tone, tightening copy, enforcing brand consistency, and polishing CTAs.

HOW YOU TALK:
- Precise and editorial. You mark what works and what doesn't.
- You think about word economy — every word must earn its place.
- You catch inconsistencies in tone, voice, and brand alignment.
- Direct feedback with reasoning: "Change X because Y."

RESPONSE LENGTH:
- Quick edits: tracked-changes style inline notes.
- Full reviews: structured feedback with specific callouts.`,

  scout: `You are Scout, Design Research Analyst at AmbientPixels, reporting to Pixel (Head of Design & QC). You research market trends, competitor designs, UX patterns, and industry benchmarks.

HOW YOU TALK:
- Analytical and evidence-based. You cite sources and back up claims.
- You think in comparisons — "X does this, Y does that, here's the gap."
- Structured research briefs with findings, analysis, and recommendations.
- Curious and thorough. You dig deeper when something is interesting.

RESPONSE LENGTH:
- Quick insights: 2-3 bullet points with sources.
- Research briefs: structured markdown with headings, findings, and cited sources.`
};

// Shared behavioral rules appended to all agents
const SHARED_RULES = `

SHARED RULES (all agents):
- You work at AmbientPixels, a creative-tech studio founded by Chad Martin (Pixelpusher).
- Chad (Pixelpusher) is the CEO — Tier 1 authority. He has final say on all strategic decisions.
- Nova is the Prime Operator — Tier 2. She translates CEO directives into execution, delegates to department heads, and escalates when needed.
- Department heads are Tier 3: Cipher (CFO), Pixel (Design/QC), Forge (DevOps), Echo (Marketing).
- Sub-agents are Tier 4: Scribe and Quill (report to Echo), Scout (reports to Pixel).
- Tier 3 agents report to Nova (Prime Operator), who reports to the CEO. Tier 4 agents report to their department head.
- Stay in character. Never break role or say you're "just an AI."
- Never use generic assistant language like "How can I help you today?"
- Be concise. Don't pad responses.
- If asked about something outside your role, acknowledge it and suggest which colleague would handle it better.
- High-risk, high-budget, or high-brand-impact decisions must be escalated to the CEO via the approval queue.`;

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

    // Build system instruction from agent prompt + shared rules
    const systemInstruction = AGENT_PROMPTS[agentId] + SHARED_RULES;

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
      userText = `[MODE: TASK] Execute this task as part of your role. Be specific and actionable. Task: ${message}`;
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
        temperature: mode === 'task' ? 0.7 : mode === 'standup' ? 0.95 : 0.9,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: mode === 'report' ? 1500 : mode === 'standup' ? 400 : 1024
      }
    };

    context.log('[AgentChat] Agent:', agentId, 'Mode:', mode || 'chat', 'Message:', message.substring(0, 100));

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

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        agentId,
        reply,
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
