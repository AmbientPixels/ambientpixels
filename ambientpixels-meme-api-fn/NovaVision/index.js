// File: /ambientpixels-meme-api-fn/NovaVision/index.js
// Hugging Face image generation API (Stable Diffusion XL)
// With Function Key validation via 'NOVAVISION_KEY'

export async function POST(request) {
  const { prompt } = await request.json();
  const hfApiKey = process.env.HF_API_KEY;
  const validKey = process.env.NOVAVISION_KEY;
  const requestKey = request.headers.get('x-functions-key');
  const endpoint = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0';

  if (!requestKey || requestKey !== validKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const headers = {
    Authorization: `Bearer ${hfApiKey}`,
    'Content-Type': 'application/json'
  };

  const payload = {
    inputs: prompt,
    options: { wait_for_model: true }
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('HF API error:', await response.text());
      return new Response(JSON.stringify({ error: 'Generation failed.' }), { status: 500 });
    }

    const buffer = await response.arrayBuffer();
    const base64Image = Buffer.from(buffer).toString('base64');
    const imageUrl = `data:image/png;base64,${base64Image}`;

    return new Response(JSON.stringify({ imageUrl }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('API failure:', err);
    return new Response(JSON.stringify({ error: 'Unexpected error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
