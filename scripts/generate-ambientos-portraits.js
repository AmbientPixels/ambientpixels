#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Generate AmbientOS Agent Portrait Images via Gemini 2.0 Flash
// Usage: node scripts/generate-ambientos-portraits.js
// Requires: GEMINI_API_KEY in environment or local.settings.json
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Config ──
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const OUTPUT_DIR = path.join(__dirname, '..', 'ambientos', 'img');

// ── Load API key ──
function getApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'api', 'local.settings.json'), 'utf8'));
    return settings.Values && settings.Values.GEMINI_API_KEY;
  } catch (e) {}
  try {
    const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const match = envFile.match(/GEMINI_API_KEY=(.+)/);
    if (match) return match[1].trim();
  } catch (e) {}
  return null;
}

// ── AmbientOS agent portraits ──
const PORTRAITS = [
  {
    id: 'nova',
    prompt: 'sharp commanding woman in her 30s, low angle shot looking up slightly commanding presence, sleek dark turtleneck, cool authoritative expression, hair pulled back cleanly, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'cipher',
    prompt: 'calculating man in his 40s, slight 3/4 angle body turned right arms crossed, cold analytical stare, reading glasses, sharp dark suit, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'pixel',
    prompt: 'creative androgynous figure in their late 20s, hand on chin thinking expression slight angle, artistic calm expression, stylish layered jacket, paint detail on collar, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'forge',
    prompt: 'rugged focused man in his 30s, leaning forward slightly elbows on surface, mechanical goggles pushed up on forehead, steady composed expression, worn utility jacket, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'echo',
    prompt: 'sharp strategic woman in her 30s, slight 3/4 angle body turned left face toward camera, structured blazer, confident composed expression, direct gaze, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'scout',
    prompt: 'alert curious figure in their late 20s, side profile with eyes cutting back toward camera, field jacket with small detail patches, observant scanning eyes, calm focused expression, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'scribe',
    prompt: 'measured thoughtful man in his 30s, leaning back relaxed confident posture, calm focused expression, casual dark shirt, slight tilt of head, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'quill',
    prompt: 'precise focused woman in her 40s, high angle shot looking down slightly contemplative, neat dark jacket, reading glasses perched on nose, critical but calm expression, pen visible at collar, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'pixelpusher',
    prompt: 'confident solo founder in his late 30s, slight 3/4 angle body turned right face toward camera, calm decisive expression, direct gaze, beard and glasses, dark casual jacket over dark shirt, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  }
];

// ── Gemini API call ──
function callGemini(apiKey, prompt) {
  return new Promise(function (resolve, reject) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey;

    var body = JSON.stringify({
      contents: [{ parts: [{ text: 'Generate a portrait image: ' + prompt }] }],
      generationConfig: {
        responseModalities: ['Image']
      }
    });

    var parsed = new URL(url);
    var options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 120000
    };

    var req = https.request(options, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString();
        try {
          var json = JSON.parse(raw);
          if (res.statusCode !== 200) {
            return reject(new Error('HTTP ' + res.statusCode + ': ' + (json.error && json.error.message || raw.slice(0, 200))));
          }

          var candidates = json.candidates || [];
          if (candidates.length === 0) return reject(new Error('No candidates returned'));

          var parts = candidates[0].content && candidates[0].content.parts || [];
          var imagePart = parts.find(function (p) { return p.inlineData; });
          if (!imagePart) return reject(new Error('No image data in response'));

          resolve({
            base64: imagePart.inlineData.data,
            mimeType: imagePart.inlineData.mimeType || 'image/png'
          });
        } catch (e) {
          reject(new Error('JSON parse error: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', function () { req.destroy(); reject(new Error('Request timed out (120s)')); });
    req.write(body);
    req.end();
  });
}

// ── Main ──
async function main() {
  var apiKey = getApiKey();
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY not found.');
    console.error('Set it in environment, local.settings.json, or .env file.');
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  var existing = new Set();
  try {
    fs.readdirSync(OUTPUT_DIR).forEach(function (f) {
      var id = f.replace(/\.(png|jpg|jpeg)$/i, '');
      existing.add(id);
    });
  } catch (e) {}

  var toGenerate = PORTRAITS.filter(function (p) { return !existing.has(p.id); });

  if (toGenerate.length === 0) {
    console.log('All ' + PORTRAITS.length + ' portraits already exist. Done.');
    return;
  }

  console.log('Generating ' + toGenerate.length + ' of ' + PORTRAITS.length + ' AmbientOS portraits...');
  console.log('Model: ' + MODEL);
  console.log('Output: ' + OUTPUT_DIR);
  console.log('Skipping ' + existing.size + ' existing images.');
  console.log('');

  var success = 0;
  var failed = 0;

  for (var i = 0; i < toGenerate.length; i++) {
    var agent = toGenerate[i];
    var label = '[' + (i + 1) + '/' + toGenerate.length + '] ' + agent.id;
    process.stdout.write(label + ' ... ');

    var attempts = 0;
    var maxRetries = 3;
    var generated = false;

    while (attempts < maxRetries && !generated) {
      attempts++;
      try {
        var result = await callGemini(apiKey, agent.prompt);
        var ext = result.mimeType.includes('jpeg') ? '.jpg' : '.png';
        var filePath = path.join(OUTPUT_DIR, agent.id + ext);
        fs.writeFileSync(filePath, Buffer.from(result.base64, 'base64'));

        var sizeKB = Math.round(fs.statSync(filePath).size / 1024);
        console.log('OK (' + sizeKB + ' KB)');
        success++;
        generated = true;

        if (i < toGenerate.length - 1) {
          await sleep(2000);
        }
      } catch (err) {
        if (attempts < maxRetries) {
          process.stdout.write('retry ' + attempts + '... ');
          await sleep(3000);
        } else {
          console.log('FAILED after ' + maxRetries + ' attempts: ' + err.message);
          failed++;
        }
      }
    }
  }

  console.log('');
  console.log('Done: ' + success + ' generated, ' + failed + ' failed, ' + existing.size + ' skipped.');
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

main().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
