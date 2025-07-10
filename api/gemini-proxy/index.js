// gemini-proxy Azure Static Web Apps HTTP function
// Place in /api/gemini-proxy/index.js with function.json for route config

const fetch = require('node-fetch');

// Load Gemini API key from environment variable or Azure secret
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Gemini API key not set. Please set GEMINI_API_KEY in your environment.');
}

// Gemini endpoint, adjust model/version as needed
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + GEMINI_API_KEY;

module.exports = async function (context, req) {
  if (req.method !== 'POST') {
    context.res = {
      status: 405,
      body: { error: 'Method Not Allowed' }
    };
    return;
  }
  try {
    const { prompt, ...options } = req.body || {};
    if (!prompt) {
      context.res = {
        status: 400,
        body: { error: 'Prompt required' }
      };
      return;
    }
    // Build request body for Gemini API
    const geminiBody = {
      contents: [{ parts: [{ text: prompt }] }],
      ...options
    };
    const apiRes = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });
    const data = await apiRes.json();
    context.res = {
      status: apiRes.status,
      body: data
    };
  } catch (error) {
    console.error('Gemini Proxy Error:', error);
    context.res = {
      status: 500,
      body: { error: 'Internal server error' }
    };
  }
};
