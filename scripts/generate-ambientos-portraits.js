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
// Prompts enriched with each agent's seed-memory personality:
//  nova    — operational triage / "nothing falls through the cracks"
//  cipher  — financial discipline / "never estimate or guess"
//  pixel   — design system / color tokens / WCAG
//  forge   — DevOps watchdog / deployment vigilance
//  echo    — strategic CMO / company voice / audience-aware
//  scout   — competitive intel / sourced research
//  scribe  — content director / builder voice / structured drafts
//  quill   — editor / "cut 20% of words" / red-pen markup
const PORTRAITS = [
  {
    id: 'nova',
    prompt: 'commanding woman in her 30s, slight 3/4 angle mid-gesture as if explaining a plan, warm confident expression with a slight smile, sharp tailored dark charcoal suit jacket over a crisp white shirt with open collar, hair pulled back cleanly, easy authoritative energy, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'cipher',
    prompt: 'precise man in his 40s, slight 3/4 angle, sharp charcoal suit with crisp white collar and tie, neat dark beard, thin reading glasses pushed slightly up his nose, quietly satisfied expression with a small smile, hands relaxed and EMPTY (no objects), chest and shoulders visible, plain dark near-black background with subtle warm amber side-light, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm, held objects, ledger, pen, paper, book, glasses on chain'
  },
  {
    id: 'pixel',
    prompt: 'creative androgynous figure in their late 20s, slight 3/4 angle, hands relaxed and EMPTY at their sides, bright artistic expression with a confident smile, stylish layered jacket with a single fine paint streak on the collar as a subtle identity mark, subtle violet accent light along the cheek, plain dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm, held objects, swatch grid, palette, brush, paint can'
  },
  {
    id: 'forge',
    prompt: 'rugged man in his 30s, slight 3/4 angle, easy relaxed grin, mechanical goggles pushed up onto his forehead as part of his look, worn utility jacket with rolled sleeves, neatly trimmed beard, arms loosely folded across his chest with hands EMPTY, subtle warm amber side-light, plain dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm, held objects, keyboard, terminal, screen, workbench, tools'
  },
  {
    id: 'echo',
    prompt: 'sharp strategic woman in her 30s, slight 3/4 angle, lively confident smile, dark hair shoulder length, structured charcoal blazer over a clean shirt, hands relaxed at her sides EMPTY, clean skin with no markings, subtle warm side-light, plain dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm, held objects, tablet, phone, screen, paper, red lines on face, red markings, war paint, tattoos, face paint, scars'
  },
  {
    id: 'scout',
    prompt: 'alert curious figure in their late 20s, slight 3/4 angle glancing back toward camera with a sly satisfied smirk, worn olive field jacket with small detail patches at the breast and shoulder, hands EMPTY at sides, bright observant eyes, plain dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm, held objects, notebook, map, binoculars, paper'
  },
  {
    id: 'scribe',
    prompt: 'thoughtful man in his 30s, slight 3/4 angle, the easy engaged smile of a writer in the zone, casual dark shirt with sleeves rolled up to mid-forearm, hands relaxed and EMPTY (one resting at his side, one in a small open gesture), plain dark near-black background with subtle warm amber side-light, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm, held objects, notebook, pen, paper, desk, lamp'
  },
  {
    id: 'quill',
    prompt: 'meticulous woman in her 40s, slight 3/4 angle, warm focused expression with a small fond smile, neat dark jacket with crisp lapels, reading glasses perched halfway down her nose, dark red hair worn neatly back, hands relaxed and EMPTY at her sides, plain dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm, held objects, manuscript, pen, red ink, paper, book'
  },
  {
    id: 'pixelpusher',
    prompt: 'confident solo founder in his late 30s, slight 3/4 angle body turned right face toward camera, warm decisive expression with the trace of a smile, direct gaze, beard and glasses, dark casual jacket over dark shirt, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
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
