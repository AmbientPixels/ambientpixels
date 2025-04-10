// apiMonitor.js – Nova checks external API endpoints and logs status

const fs = require('fs');
const path = require('path');
const https = require('https');

const outputFile = path.join(__dirname, '../data/api-monitor.json');

const endpoints = [
  {
    name: "HuggingFace", 
    url: "https://api-inference.huggingface.co/models/bert-base-uncased"
  },
  {
    name: "AmbientPixels Meme API", 
    url: "https://ambientpixels-meme-api-fn.azurewebsites.net/api/ping"
  }
];

function checkAPI(endpoint) {
  return new Promise(resolve => {
    const start = Date.now();
    https
      .get(endpoint.url, res => {
        const latency = Date.now() - start;
        resolve({
          name: endpoint.name,
          url: endpoint.url,
          status: res.statusCode,
          ok: res.statusCode === 200,
          latencyMs: latency
        });
      })
      .on('error', () => {
        resolve({
          name: endpoint.name,
          url: endpoint.url,
          status: 0,
          ok: false,
          latencyMs: null
        });
      });
  });
}

async function runMonitor() {
  const checks = await Promise.all(endpoints.map(checkAPI));
  const log = {
    scannedAt: new Date().toISOString(),
    endpoints: checks
  };
  fs.writeFileSync(outputFile, JSON.stringify(log, null, 2));
  console.log("✅ Nova's API monitor updated at /data/api-monitor.json");
}

runMonitor();

