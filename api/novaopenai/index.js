// Azure Function: NovaOpenAI Proxy Handler
// Redeploy trigger: 2025-07-12

// updated by Cascade 2025-07-12

const axios = require('axios');

module.exports = async function (context, req) {
  context.log('NovaOpenAI proxy triggered:', req.method, req.url);

  // CORS preflight support
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
      body: ''
    };
    return;
  }

  // Handle GET requests for API status dashboard health checks
  /* updated by Cascade 2025-07-15 */
  if (req.method === 'GET') {
    context.res = {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: { status: "ok", message: "Nova OpenAI service is online" }
    };
    return;
  }

  if (req.method !== 'POST') {
    context.res = {
      status: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: { error: 'Method not allowed' }
    };
    return;
  }

  // Required env vars
  const AZURE_OPENAI_KEY = process.env["AZURE_OPENAI_KEY"];
  const AZURE_OPENAI_ENDPOINT = process.env["AZURE_OPENAI_ENDPOINT"];
  if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
    context.res = {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: { error: 'Missing Azure OpenAI credentials in environment variables.' }
    };
    return;
  }

  // Parse request
  const { operation, deployment, payload } = req.body || {};
  if (!operation || !deployment || !payload) {
    context.res = {
      status: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: { error: 'Missing required fields: operation, deployment, payload.' }
    };
    return;
  }

  // Build Azure OpenAI endpoint URL
  const apiUrl = `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${deployment}/${operation}?api-version=2024-02-15-preview`;

  try {
    const response = await axios.post(apiUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_OPENAI_KEY,
      },
      timeout: 30000,
    });
    context.res = {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: response.data
    };
  } catch (error) {
    context.log('Azure OpenAI proxy error:', error?.response?.data || error.message);
    context.res = {
      status: error.response?.status || 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: {
        error: error.response?.data || error.message || 'Unknown error'
      }
    };
  }
}; // updated by Cascade 2025-07-12: syntax fix, only one closing brace
