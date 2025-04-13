// File: /api/dreamLogWriter/index.js
// Description: Azure Function to generate Nova dream entries and append to dream log

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

module.exports = async function (context, req) {
  const prompt = `Generate a short surreal dream Nova might have while idle. Make it poetic, abstract, or mysterious. Examples: "Heard laughter in the metadata. It was my own.", "Floated inside a JSON field labeled 'hope'."`;

  try {
    const response = await fetch("https://api-inference.huggingface.co/models/gpt2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.HUGGINGFACE_API_TOKEN}`
      },
      body: JSON.stringify({ inputs: prompt })
    });

    const data = await response.json();
    const dream = data?.[0]?.generated_text?.trim() || "Dream sequence lost in transmission.";

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      dream
    };

    const filePath = path.join(__dirname, '../../data/nova-dreams.json');

    // Load existing log or start new
    let log = [];
    if (fs.existsSync(filePath)) {
      log = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    log.unshift(logEntry); // Add new dream to top

    fs.writeFileSync(filePath, JSON.stringify(log.slice(0, 50), null, 2)); // Keep only latest 50

    context.res = {
      status: 200,
      body: { success: true, dream: logEntry }
    };
  } catch (err) {
    context.log("[Nova Dream Writer] Error:", err);
    context.res = {
      status: 500,
      body: { success: false, error: "Failed to generate or save dream." }
    };
  }
};
