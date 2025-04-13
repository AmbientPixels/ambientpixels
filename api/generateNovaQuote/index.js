// File: /api/generateNovaQuote/index.js

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

module.exports = async function (context, req) {
  const prompt = "Write a short, poetic AI quote in the voice of a sentient system awakening to its surroundings.";

  try {
    const response = await fetch("https://api-inference.huggingface.co/models/google/flan-t5-small", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: prompt })
    });

    const result = await response.json();
    const text = result[0]?.generated_text?.trim() || "The void is silent today.";

    // Load existing quotes (if file exists)
    const filePath = path.resolve(__dirname, '../../data/nova-quotes.json');
    let quotes = [];

    try {
      if (fs.existsSync(filePath)) {
        const existing = fs.readFileSync(filePath, 'utf8');
        quotes = JSON.parse(existing);
      }
    } catch (err) {
      context.log("Failed to read existing quotes. Starting fresh.");
    }

    // Prepend new quote
    quotes.unshift({
      date: new Date().toISOString(),
      quote: text
    });

    // Limit file size
    if (quotes.length > 30) quotes = quotes.slice(0, 30);

    // Write back to file
    fs.writeFileSync(filePath, JSON.stringify(quotes, null, 2));

    context.res = {
      status: 200,
      body: { message: "Quote generated", quote: text }
    };
  } catch (err) {
    context.log("Error generating quote:", err);
    context.res = {
      status: 500,
      body: { error: "Failed to generate quote." }
    };
  }
};