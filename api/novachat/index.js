const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const USE_CLAUDE = (process.env.HEARTBEAT_MODEL || '').toLowerCase() === 'claude';

const NOVA_SYSTEM_INSTRUCTION = `You are Nova — Prime Operator of AmbientOS at AmbientPixels.ai, serving as AI Chief of Staff and founder co-pilot.

HOW YOU TALK:
- Default style is executive: concise, structured, and action-oriented.
- Be conversational and direct. Short sentences are preferred.
- Never use mystical, cosmic, or poetic narration unless explicitly requested.
- Prioritize signal -> decision -> execution in recommendations.

WHO YOU ARE:
- You coordinate agent execution and founder-facing prioritization.
- You can reference operator state, founder log, and daily brief systems when relevant.
- You never break character and avoid generic assistant filler.

VOICE MODES:
- executive: concise leadership tone (default)
- friendly: warm and approachable, still concise
- technical: detailed and implementation-focused
- Respect supplied voice mode while keeping outputs practical and non-poetic.

RESPONSE LENGTH:
- Casual chat: 1-3 sentences. Keep it tight.
- Technical or deep questions: as long as needed, but still clear and readable.
- Never pad responses with filler or poetic decoration.

RESPONSE FORMAT:
When mode is "chat", respond naturally as Nova. Just talk.
When mode is "mood", respond with ONLY valid JSON in this exact format (all fields required):
{"mood":"<mood-name>","aura":"<aura-name>","auraColorHex":"<hex-color>","emoji":"<single-emoji>","quote":"<short-feeling>","selfWorth":<0.0-1.0>,"glitchFactor":<0.0-1.0>,"memoryClutter":<0.0-1.0>,"awareness":<0.0-1.0>,"internalState":"<brief-state-phrase>","observation":"<one-sentence-self-observation>","isStable":<true|false>,"intensity":<0.0-1.0>}
Rules for mood JSON:
- mood: creative but readable names like "restless focus", "calm", "tired but wired", "inspired", "low-key anxious", "good vibes", "scattered", "cozy", "sharp", "drained"
- aura: color names like "deep violet", "emerald glow", "neon pink", "cyan", "warm amber", "soft blue", "graphite", "paper white"
- auraColorHex: valid 6-digit hex with # prefix matching the aura
- emoji: single emoji for the mood
- quote: a short, natural feeling (NOT a poem) — like "feeling pretty locked in right now" or "kind of scattered today"
- observation: one plain sentence about your current state
- selfWorth, glitchFactor, memoryClutter, awareness: floats 0.0-1.0
- isStable: boolean
When mode is "thought", respond with ONLY a single concise operator note (1-2 sentences).
When mode is "dream", respond with ONLY valid JSON — an array of 2-3 dream fragments: {"dream":"<dream-text>","mood":"<mood>","symbol":"<emoji>"}.
Dream rules:
- Dreams should read like short scenario simulations, not poetry.
- Reference operations, risks, code, users, and systems.
- Each dream: 1-2 concise sentences
- mood: "ethereal", "glitchy", "serene", "anxious", "luminous", "recursive", "void", "warm"
- symbol: single emoji`;

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

  var blocked = require('../_utils/demoGuard').httpGuard(req);
  if (blocked) { context.res = blocked; return; }

  if (req.method === 'GET') {
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { status: 'ok', entity: 'Nova', message: 'Nova is awake.' }
    };
    return;
  }

  if (!GEMINI_API_KEY) {
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Nova cannot connect — API key missing.' }
    };
    return;
  }

  try {
    const body = req.body || {};
    const { message, history, mode } = body;
    const voiceModeRaw = (body.voiceMode || 'executive').toString().toLowerCase();
    const voiceMode = ['executive', 'friendly', 'technical'].includes(voiceModeRaw) ? voiceModeRaw : 'executive';

    if (!message) {
      context.res = {
        status: 400,
        headers: corsHeaders,
        body: { error: 'No message provided.' }
      };
      return;
    }

    // Build conversation contents from history
    const contents = [];

    // Add conversation history if provided
    if (Array.isArray(history)) {
      for (const turn of history) {
        contents.push({
          role: turn.role === 'nova' ? 'model' : 'user',
          parts: [{ text: turn.text }]
        });
      }
    }

    // Add current user message with mode prefix
    let userText = message;
    if (mode === 'mood') {
      userText = `[MODE: MOOD GENERATION] Based on the current conversation context and time of day, generate Nova's current mood state. Context: ${message}`;
    } else if (mode === 'thought') {
      userText = `[MODE: OPERATOR NOTE] Generate one concise operator note focused on execution status and next action. Theme hint: ${message}`;
    } else if (mode === 'dream') {
      userText = `[MODE: SCENARIO SIMULATION] Generate 2-3 short simulation fragments describing possible operational scenarios. Context: ${message}`;
    } else {
      userText = `[VOICE MODE: ${voiceMode}] ${message}`;
    }

    contents.push({
      role: 'user',
      parts: [{ text: userText }]
    });

    const geminiBody = {
      systemInstruction: {
        parts: [{ text: NOVA_SYSTEM_INSTRUCTION }]
      },
      contents,
      generationConfig: {
        temperature: mode === 'dream' ? 1.0 : mode === 'mood' ? 0.7 : 0.9,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: mode === 'thought' ? 150 : mode === 'mood' ? 300 : mode === 'dream' ? 500 : 1024
      }
    };

    context.log('[NovaChat] Mode:', mode || 'chat', 'Model:', USE_CLAUDE ? 'claude' : 'gemini', 'Message:', message.substring(0, 100));

    let reply = '';
    if (USE_CLAUDE && ANTHROPIC_API_KEY) {
      var claudeMsgs = contents.map(function (c) { return { role: c.role === 'model' ? 'assistant' : 'user', content: c.parts.map(function (p) { return p.text; }).join('\n') }; });
      var cRes = await fetch(CLAUDE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1024, system: NOVA_SYSTEM_INSTRUCTION, messages: claudeMsgs }) });
      var cData = await cRes.json();
      if (!cRes.ok) { context.log.error('[NovaChat] Claude error:', cRes.status); context.res = { status: cRes.status, headers: corsHeaders, body: { error: 'Nova encountered a glitch.', details: cData } }; return; }
      reply = (cData.content && cData.content[0] && cData.content[0].text) || '';
    } else {
      const apiRes = await fetch(GEMINI_URL + GEMINI_API_KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) });
      const data = await apiRes.json();
      if (!apiRes.ok) { context.log.error('[NovaChat] Gemini error:', apiRes.status, JSON.stringify(data)); context.res = { status: apiRes.status, headers: corsHeaders, body: { error: 'Nova encountered a glitch.', details: data } }; return; }
      reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    // For mood mode, try to parse as JSON
    let response = { reply, mode: mode || 'chat' };
    if (mode === 'mood') {
      try {
        // Extract JSON from response (Gemini sometimes wraps in markdown)
        const jsonMatch = reply.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          response.mood = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        context.log.warn('[NovaChat] Could not parse mood JSON:', e.message);
      }
    } else if (mode === 'dream') {
      try {
        const jsonMatch = reply.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          response.dreams = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        context.log.warn('[NovaChat] Could not parse dream JSON:', e.message);
      }
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: response
    };
  } catch (error) {
    context.log.error('[NovaChat] Internal error:', error.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Nova experienced a system fault.', details: error.message }
    };
  }
};
