// Azure Function: novaopenai
// General-purpose proxy for Azure OpenAI REST API (chat, completions, embeddings, etc.)
// Uses AZURE_OPENAI_KEY env var. Default deployment: gpt-4o-nova
// Updated by Cascade 2025-07-12

const fetch = require('node-fetch');

const OPENAI_API_ENDPOINT = 'https://novaaicore.openai.azure.com/';
const DEFAULT_DEPLOYMENT_ID = 'gpt-4o-nova';

// CORS and Azure OpenAI proxy handler - updated by Cascade 2025-07-12
module.exports = async function (context, req) {
  // Preflight: Only allow POST
  if (req.method !== 'POST') {
    context.res = {
      status: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, api-key'
      },
      body: { error: 'Method Not Allowed' }
    };
    return;
  }

  const apiKey = process.env.AZURE_OPENAI_KEY;
  if (!apiKey) {
    context.res = {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, api-key'
      },
      body: { error: 'AZURE_OPENAI_KEY env variable not set' }
    };
    return;
  }

  // Expect: { operation: 'chat/completions', deploymentId?, payload: { ... } }
  const { operation, deploymentId, payload } = req.body || {};
  if (!operation || !payload) {
    context.res = {
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, api-key'
      },
      body: { error: 'Missing required fields: operation, payload' }
    };
    return;
  }

  // ECHO TEST: Just return the received payload and operation for debugging
  context.res = {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, api-key'
    },
    body: {
      debug: 'Echo test successful',
      operation,
      deploymentId: depId,
      payload
    }
  };
  return;
    context.res = {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, api-key'
      },
      body: { error: 'Request to Azure OpenAI failed', details: err.message }
    };
  }
};

// Example request body:
// {
//   "operation": "chat/completions",
//   "deploymentId": "gpt-4o-nova", // optional
//   "payload": {
//     "messages": [{ "role": "user", "content": "Hello!" }]
//   }
// }

// Windsurf Protocol: Replace, never append. All edits traceable by comment above.
