const axios = require('axios');
const { BlobServiceClient } = require('@azure/storage-blob');
const fetch = require('node-fetch');

/* updated by Cascade 2025-07-15 */
module.exports = async function (context, req) {
  // Add CORS headers to all responses
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-functions-key",
    "Content-Type": "application/json"
  };

  // CORS preflight
  if (req.method === "OPTIONS") {
    context.res = {
      status: 204,
      headers: corsHeaders,
      body: ''
    };
    return;
  }
  
  // Handle GET requests for API status checks
  /* updated by Cascade 2025-07-15 */
  if (req.method === "GET") {
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { status: "ok", message: "Nova Vision service is online" }
    };
    return;
  }

  const prompt = req.body?.prompt;
  const API_KEY = process.env.HUGGINGFACE_API_KEY;
  const HF_MODEL = "runwayml/stable-diffusion-v1-2"; // Change model to stable-diffusion-v1-2 for a more stable version

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
