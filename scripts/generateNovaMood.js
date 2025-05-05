// generateNovaBoot.js – Combine Nova's daily awareness files into a unified memory file

const fs = require('fs');
const path = require('path');
const https = require('https');

const key = process.env.NOVA_MOOD_API_KEY;
const url = `https://ambientpixels-mood-api.azurewebsites.net/api/synthesizeNovaMood?code=${key}`;
const outputFile = path.join(__dirname, '../data/nova-synth-mood.json');

https.get(url, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      fs.writeFileSync(outputFile, JSON.stringify(json, null, 2), 'utf8');
      console.log("✅ Nova mood updated: nova-synth-mood.json");
    } catch (err) {
      console.error("❌ Failed to parse/write mood JSON:", err);
    }
  });
}).on('error', err => {
  console.error("❌ Azure Function call failed:", err.message);
});
