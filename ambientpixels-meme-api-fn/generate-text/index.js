// File: generate-text/index.js

// ✅ Dynamic import for compatibility with Node 18+ and Azure Functions runtime
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

module.exports = async function (context, req) {
  const prompt = req.body?.prompt;
  context.log('📩 Received prompt:', prompt);

  if (!prompt) {
    context.res = {
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: { error: 'Missing prompt in request body.' }
    };
    return;
  }

  const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
  const HF_MODEL = 'gpt2';

  if (!HUGGINGFACE_API_KEY) {
    context.log('❌ API key is missing.');
    context.res = {
      status: 500,
      body: { error: 'Missing Hugging Face API Key' }
    };
    return;
  }

  try {
    const hfResponse = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: prompt })
    });

    const text = await hfResponse.text();
    context.log('📦 Hugging Face raw response:', text);

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      context.log('❌ Failed to parse JSON:', err);
      throw new Error('Hugging Face returned invalid JSON or HTML');
    }

    const resultText = data[0]?.generated_text || '⚠️ No generated text.';

    context.res = {
      status: hfResponse.ok ? 200 : 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: hfResponse.ok
        ? { text: resultText }
        : { error: 'Hugging Face error', details: data }
    };
  } catch (err) {
    context.log.error('🔥 Nova AI Function Error:', err);
    context.res = {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: { error: 'Internal server error', message: err.message }
    };
  }
};
