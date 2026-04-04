// gemini.js — AI model wrapper for heartbeat agent calls
// Supports Gemini (default) and Claude Sonnet (HEARTBEAT_MODEL=claude)
// Same exports: callGemini(prompt, agentId), callGeminiExecute(prompt, agentId)

var fetch = require('node-fetch');
var storage = require('../_utils/companyStorage');

var GEMINI_API_KEY = process.env.GEMINI_API_KEY;
var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
var GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';
var CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_MODEL = 'claude-sonnet-4-6';

// Switch model: set HEARTBEAT_MODEL=claude in Azure Function App settings to use Claude
var USE_CLAUDE = (process.env.HEARTBEAT_MODEL || '').toLowerCase() === 'claude';

// ── Claude API call ──
async function _callClaude(prompt, agentId, maxTokens) {
  if (!ANTHROPIC_API_KEY) return null;

  try {
    var res = await fetch(CLAUDE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens || 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      var errText = '';
      try { errText = await res.text(); } catch (_) {}
      console.error('[Heartbeat] Claude returned', res.status, errText.substring(0, 200));
      return null;
    }

    var data = await res.json();
    var text = (data.content && data.content[0] && data.content[0].text) || null;

    // Log usage
    var inputTokens = (data.usage && data.usage.input_tokens) || 0;
    var outputTokens = (data.usage && data.usage.output_tokens) || 0;
    storage.logGeminiUsage({
      caller: 'heartbeat',
      model: CLAUDE_MODEL,
      agentId: agentId || null,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens
    }).catch(function () {});

    return text;
  } catch (err) {
    console.error('[Heartbeat] Claude call failed:', err.message);
    return null;
  }
}

// ── Gemini API call ──
async function _callGeminiRaw(prompt, agentId, maxTokens, temperature, caller) {
  if (!GEMINI_API_KEY) return null;

  var body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: temperature || 0.7,
      topP: 0.9,
      maxOutputTokens: maxTokens || 1500
    }
  };

  try {
    var res = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error('[Heartbeat] Gemini returned', res.status);
      return null;
    }

    var data = await res.json();
    var um = data && data.usageMetadata;
    if (um) {
      storage.logGeminiUsage({
        caller: caller || 'heartbeat',
        model: 'gemini-2.0-flash',
        agentId: agentId || null,
        promptTokens: um.promptTokenCount || 0,
        completionTokens: um.candidatesTokenCount || 0,
        totalTokens: um.totalTokenCount || 0
      }).catch(function () {});
    }
    return (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || null;
  } catch (err) {
    console.error('[Heartbeat] Gemini call failed:', err.message);
    return null;
  }
}

// ── Exported functions (same interface, model selected by env var) ──

async function callGemini(prompt, agentId) {
  if (USE_CLAUDE) return _callClaude(prompt, agentId, 1500);
  return _callGeminiRaw(prompt, agentId, 1500, 0.7, 'heartbeat');
}

async function callGeminiExecute(prompt, agentId) {
  if (USE_CLAUDE) return _callClaude(prompt, agentId, 1200);
  return _callGeminiRaw(prompt, agentId, 1200, 0.8, 'heartbeat-execute');
}

module.exports = { callGemini, callGeminiExecute };
