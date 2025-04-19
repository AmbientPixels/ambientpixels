// Azure Function: novavision - generates an image from a prompt via Hugging Face
const fetch = require('node-fetch');

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-functions-key"
      }
    };
    return;
  }

  const prompt = req.body?.prompt;
  const API_KEY = process.env.HUGGINGFACE_API_KEY;
  const HF_MODEL = "runwayml/stable-diffusion-v1-5"; // Example model

  if (!prompt || !API_KEY) {
    context.res = {
      status: 400,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: { error: "Missing prompt or API key" }
    };
    return;
  }

  try {
    const response = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: prompt })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Hugging Face error: ${error}`);
    }

    const buffer = await response.buffer();
    const base64Image = buffer.toString("base64");
    const imageUrl = `data:image/png;base64,${base64Image}`;

    context.res = {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: { imageUrl }
    };
  } catch (err) {
    context.log("NovaVision Error:", err);
    context.res = {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: { error: "Image generation failed", message: err.message }
    };
  }
};
