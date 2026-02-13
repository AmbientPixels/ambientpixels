// geminiproxy Azure Static Web Apps HTTP function (diagnostic version)
const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const DEFAULT_MODEL = 'gemini-2.0-flash';
const ALLOWED_MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash-image'];

/* updated by Cascade 2025-07-15 */
module.exports = async function (context, req) {
  // Add CORS headers to all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, api-key',
    'Content-Type': 'application/json'
  };

  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: corsHeaders,
      body: ''
    };
    return;
  }
  
  // Handle GET requests for API status checks
  /* updated by Cascade 2025-07-15 */
  if (req.method === 'GET') {
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { status: 'ok', message: 'Gemini Proxy service is online' }
    };
    return;
  }
  
  // Only allow POST for actual API requests
  if (req.method !== 'POST') {
    context.res = {
      status: 405,
      headers: corsHeaders,
      body: { error: 'Method Not Allowed' }
    };
    return;
  }
  if (!GEMINI_API_KEY) {
    context.log.error('Gemini API key not set.');
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Gemini API key not set in environment.' }
    };
    return;
  }
  try {
    // Defensive: ensure req.body is parsed
    const body = req.body || {};
    const { prompt, model, generationConfig, ...options } = body;
    if (!prompt) {
      context.res = {
        status: 400,
        body: { error: 'Prompt required' }
      };
      return;
    }

    // Resolve model — only allow whitelisted models
    const selectedModel = (model && ALLOWED_MODELS.includes(model)) ? model : DEFAULT_MODEL;
    const apiUrl = GEMINI_BASE + selectedModel + ':generateContent?key=' + GEMINI_API_KEY;

    // Build Gemini API request body
    const geminiBody = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    // Add generationConfig if provided (needed for image responseModalities)
    if (generationConfig) {
      geminiBody.generationConfig = generationConfig;
    }

    context.log('[Gemini Proxy] Model:', selectedModel, 'Request:', JSON.stringify(geminiBody));

    const apiRes = await fetch(apiUrl, {
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