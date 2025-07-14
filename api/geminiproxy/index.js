// gemini-proxy Azure Static Web Apps HTTP function (diagnostic version)
const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + GEMINI_API_KEY;

// CORS support added by Cascade 2025-07-12
module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, api-key',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
    return;
  }
  if (req.method !== 'POST') {
    context.res = {
      status: 405,
      body: { error: 'Method Not Allowed' }
    };
    return;
  }
  if (!GEMINI_API_KEY) {
    context.log.error('Gemini API key not set.');
    context.res = {
      status: 500,
      body: { error: 'Gemini API key not set in environment.' }
    };
    return;
  }
  try {
    // Defensive: ensure req.body is parsed
    const body = req.body || {};
    const { prompt, ...options } = body;
    if (!prompt) {
      context.res = {
        status: 400,
        body: { error: 'Prompt required' }
      };
      return;
    }

    // Build Gemini API request body
    const geminiBody = {
      contents: [{ parts: [{ text: prompt }] }],
      ...options
    };

    context.log('[Gemini Proxy] Outgoing request:', JSON.stringify(geminiBody));

    const apiRes = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      context.log.error('[Gemini Proxy] Gemini API error:', apiRes.status, data);
      context.res = {
        status: apiRes.status,
        body: {
          error: 'Gemini API error',
          status: apiRes.status,
          geminiError: data
        }
      };
      return;
    }

    context.log('[Gemini Proxy] Gemini API success:', data);

    context.res = {
      status: 200,
      body: data
    };
  } catch (error) {
    context.log.error('[Gemini Proxy] Internal error:', error);
    context.res = {
      status: 500,
      body: { error: 'Internal server error', details: error.message }
    };
  }
};