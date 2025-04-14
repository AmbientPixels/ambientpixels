// File: /api/NovaVision/index.js
// Hugging Face image generation API (Stable Diffusion XL)

export async function POST(request) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  
    const { prompt } = await request.json();
    const HF_API_KEY = process.env.HF_API_KEY;
    const HF_ENDPOINT = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0';
  
    const headers = {
      Authorization: `Bearer ${HF_API_KEY}`,
      'Content-Type': 'application/json'
    };
  
    const payload = {
      inputs: prompt,
      options: { wait_for_model: true }
    };
  
    try {
      const response = await fetch(HF_ENDPOINT, {
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