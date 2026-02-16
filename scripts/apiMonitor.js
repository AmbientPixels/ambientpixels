// apiMonitor.js – Nova checks external API endpoints and logs status

const fs = require('fs');
const path = require('path');
const https = require('https');

const outputFile = path.join(__dirname, '../data/api-monitor.json');

const endpoints = [
  { name: "Gemini API",           url: "https://generativelanguage.googleapis.com/",                                                expect: [200, 404] },
  { name: "Azure Blob Storage",   url: "https://ambientpixelsstorage.blob.core.windows.net/",                                      expect: [200, 400, 409] },
  { name: "Azure Functions",      url: "https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=_ping",              expect: [200, 404] },
  { name: "DeviantArt",           url: "https://www.deviantart.com/",                                                               expect: [200, 301, 302] },
  { name: "HuggingFace",          url: "https://api-inference.huggingface.co/",                                                     expect: [200, 401, 404] },
  { name: "X (Twitter) API",      url: "https://api.x.com/2/openapi.json",                                                         expect: [200, 401, 403] },
  { name: "LinkedIn API",         url: "https://api.linkedin.com/",                                                                 expect: [200, 401, 403] },
  { name: "AmbientPixels Meme API", url: "https://ambientpixels-meme-api-fn.azurewebsites.net/api/ping",                            expect: [200] }
];

function checkAPI(endpoint) {
  return new Promise(resolve => {
    const start = Date.now();
    const req = https
      .get(endpoint.url, { timeout: 8000 }, res => {
        const latency = Date.now() - start;
        const expected = endpoint.expect || [200];
        res.resume();
        resolve({
          name: endpoint.name,
          url: endpoint.url,
          status: res.statusCode,
          reachable: expected.includes(res.statusCode),
          latencyMs: latency
        });
      });
    req.on('error', () => {
      resolve({
        name: endpoint.name,
        url: endpoint.url,
        status: 0,
        reachable: false,
        latencyMs: null
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({
        name: endpoint.name,
        url: endpoint.url,
        status: 0,
        reachable: false,
        latencyMs: 8000
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

