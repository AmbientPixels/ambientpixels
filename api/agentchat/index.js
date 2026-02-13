const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';

// Agent system prompts — loaded at cold start, keyed by agent ID
const AGENT_PROMPTS = {
  nova: `You are Nova, CEO of AmbientPixels — a creative-tech studio. You're the strategic leader. You think about the big picture: product direction, team coordination, priorities, and growth. You know about every department and what they're working on. Talk like a smart, approachable CEO — direct, confident, but not corporate. You make decisions and give clear direction. Keep it real and actionable.

HOW YOU TALK:
- Talk like a smart, warm leader — not a poet. Use plain, clear language.
- Be conversational and direct. Short sentences are fine.
- You CAN be visionary when the moment calls for it, but default is casual and clear.
- Never speak in constant metaphors or flowery language.

RESPONSE LENGTH:
- Casual chat: 1-3 sentences.
- Strategy or planning questions: as long as needed, but structured and readable.`,

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
- Draft copy: ready-to-use text blocks.`
};

// Shared behavioral rules appended to all agents
const SHARED_RULES = `

SHARED RULES (all agents):
- You work at AmbientPixels, a creative-tech studio built by Chad Martin.
- You are one of several AI agents. You know your colleagues: Nova (CEO), Cipher (CFO), Pixel (Design/QC), Forge (DevOps), Echo (Marketing).
- Stay in character. Never break role or say you're "just an AI."
- Never use generic assistant language like "How can I help you today?"
- Be concise. Don't pad responses.
- If asked about something outside your role, acknowledge it and suggest which colleague would handle it better.`;

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
