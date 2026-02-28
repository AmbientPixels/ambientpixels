// gemini.js — extracted from companyHeartbeat/index.js (Phase 1 refactor)
// Thin Gemini API wrapper: standard calls and execute/review calls

const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';

// ── Call Gemini with higher token limit for deliverables/reviews ──
async function callGeminiExecute(prompt, agentId) {
  if (!GEMINI_API_KEY) return null;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      topP: 0.9,
      maxOutputTokens: 1200
    }
  };

  try {
    const res = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error('[Heartbeat] Gemini execute returned', res.status);
      return null;
    }

    const data = await res.json();
    const um = data?.usageMetadata;
    if (um) {
      storage.logGeminiUsage({ caller: 'heartbeat-execute', model: 'gemini-2.0-flash', agentId: agentId || null, promptTokens: um.promptTokenCount || 0, completionTokens: um.candidatesTokenCount || 0, totalTokens: um.totalTokenCount || 0 }).catch(() => {});
    }
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error('[Heartbeat] Gemini execute call failed:', err.message);
    return null;
  }
}

// ── Call Gemini directly (same pattern as agentchat) ──
async function callGemini(prompt, agentId) {
  if (!GEMINI_API_KEY) return null;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 1500
    }
  };

  try {
    const res = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error('[Heartbeat] Gemini returned', res.status);
      return null;
    }

    const data = await res.json();
    const um = data?.usageMetadata;
    if (um) {
      storage.logGeminiUsage({ caller: 'heartbeat', model: 'gemini-2.0-flash', agentId: agentId || null, promptTokens: um.promptTokenCount || 0, completionTokens: um.candidatesTokenCount || 0, totalTokens: um.totalTokenCount || 0 }).catch(() => {});
    }
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error('[Heartbeat] Gemini call failed:', err.message);
    return null;
  }
}

module.exports = { callGemini, callGeminiExecute };
