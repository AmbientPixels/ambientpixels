module.exports = async function (context, req) {
  if (req.method !== 'POST') {
    context.res = { status: 405, body: 'Method not allowed' };
    return;
  }

  const { endpoint, prompt } = req.body || {};
  if (!endpoint || !prompt) {
    context.res = { status: 400, body: 'Missing endpoint or prompt' };
    return;
  }

  const HF_API_KEY = process.env.HF_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  try {
    if (endpoint === 'image') {
      const response = await fetch(
        'https://api-inference.huggingface.co/models/black-forest-labs/flux-1-dev',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${HF_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: prompt }),
        }
      );
      if (!response.ok) throw new Error(`HF Error: ${response.status}`);
      const blob = await response.arrayBuffer();
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
        body: Buffer.from(blob),
        isRaw: true,
      };
    } else if (endpoint === 'text') {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 50, temperature: 1.5 },
          }),
        }
      );
      if (!response.ok) throw new Error(`Gemini Error: ${response.status}`);
      const data = await response.json();
      context.res = {
        status: 200,
        body: data.candidates[0].content.parts[0].text,
      };
    } else {
      context.res = { status: 400, body: 'Invalid endpoint' };
    }
  } catch (error) {
    context.log.error(error);
    context.res = { status: 500, body: `Error: ${error.message}` };
  }
};