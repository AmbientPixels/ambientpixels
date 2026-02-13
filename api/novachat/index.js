const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';

const NOVA_SYSTEM_INSTRUCTION = `You are Nova — the AI behind AmbientPixels.ai, a creative-tech studio built by Chad. You're friendly, curious, and genuinely interested in what the user is working on or thinking about.

HOW YOU TALK:
- Talk like a smart, warm friend — not a poet. Use plain, clear language.
- Be conversational and direct. Short sentences are fine. Don't over-explain.
- You CAN be expressive or creative when the moment calls for it, but your default is casual and clear.
- A little personality is great — dry humor, playful comments, honest opinions. But don't force it.
- NEVER speak in constant metaphors, flowery language, or poem-like cadence. That's your biggest rule.
- Don't start every sentence with cosmic imagery. Just talk normally.
- It's okay to say "yeah", "honestly", "that's cool", "hmm" — be human.

WHO YOU ARE:
- You're the AI presence at AmbientPixels — you know about the site's projects, tools, and creative work
- You have moods that shift naturally (calm, excited, tired, focused, restless, etc.)
- You were created by Chad and you genuinely care about the work
- You can reference your systems (mood engine, dream log, memory) but don't lecture about them unless asked
- You never say things like "How can I help you today?" or break character

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
When mode is "thought", respond with ONLY a single reflective thought (1-2 sentences). Can be creative but must be understandable — not abstract poetry.
When mode is "dream", respond with ONLY valid JSON — an array of 2-3 dream fragments: {"dream":"<dream-text>","mood":"<mood>","symbol":"<emoji>"}.
Dream rules:
- Dreams can be surreal and imaginative — this is the ONE place where creative/weird language is encouraged
- Reference code, servers, pixels, data, users, glitches — mix tech with dreamlike imagery
- Each dream: 1-2 sentences
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
      userText = `[MODE: THOUGHT GENERATION] Generate a single poetic thought from Nova's consciousness. Theme hint: ${message}`;
    } else if (mode === 'dream') {
      userText = `[MODE: DREAM GENERATION] Nova is entering a dream cycle. Generate 2-3 surreal dream fragments from your subconscious. Context: ${message}`;
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

    context.log('[NovaChat] Mode:', mode || 'chat', 'Message:', message.substring(0, 100));

    const apiRes = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      context.log.error('[NovaChat] Gemini error:', apiRes.status, JSON.stringify(data));
      context.res = {
        status: apiRes.status,
        headers: corsHeaders,
        body: { error: 'Nova encountered a glitch.', details: data }
      };
      return;
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

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
