#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Generate Pixel Agent Portrait Images via Gemini 2.0 Flash
// Usage: node scripts/generate-agent-portraits.js
// Requires: GEMINI_API_KEY in environment or local.settings.json
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Config ──
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const OUTPUT_DIR = path.join(__dirname, '..', 'pixel-agents', 'img');

// ── Load API key ──
function getApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  // Try local.settings.json
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'api', 'local.settings.json'), 'utf8'));
    return settings.Values && settings.Values.GEMINI_API_KEY;
  } catch (e) {}
  // Try .env file
  try {
    const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const match = envFile.match(/GEMINI_API_KEY=(.+)/);
    if (match) return match[1].trim();
  } catch (e) {}
  return null;
}

// ── Agent portraits (agent-id → prompt) ──
const PORTRAITS = [
  // ── Pixel Agents ──
  {
    id: 'roast-my-site',
    prompt: 'sharp critical woman in her 40s, arms crossed, slight downward angle looking at camera, piercing judgmental stare, short professional hair, dark fitted blazer, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'thread-it',
    prompt: 'energetic young man in his mid 20s, leaning forward slightly elbows on surface, wide charismatic grin, disheveled hair, open collar hoodie, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'validate-this',
    prompt: 'composed analytical woman in her 30s, slight 3/4 angle body turned left face toward camera, neutral confident expression, structured blazer, hair pulled back, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'vibe-check',
    prompt: 'androgynous creative in their late 20s, one arm raised gesture mid-thought, artistically detached gaze, tousled expressive hair, paint-streaked collar, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'fridge-raid',
    prompt: 'warm confident chef in their 30s, leaning back relaxed confident posture, slight knowing smirk, casual open jacket over dark shirt, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'resume-roast',
    prompt: 'stern professional woman in her 40s, slight 3/4 angle body turned right face toward camera, rectangular glasses, skeptical raised eyebrow, sharp blazer, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'signal',
    prompt: 'hooded operative in their 30s, side profile with eyes cutting back toward camera, deep hood casting shadow over brow, intense focused eyes, barely visible earpiece, dark tactical clothing, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'hivemind',
    prompt: 'androgynous analyst, high angle shot looking down slightly contemplative, unnervingly wide observant eyes, minimal expression, close-cropped hair, dark turtleneck, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'site-glow-up',
    prompt: 'confident creative designer in their late 20s, hand on chin thinking expression slight angle, subtle creative smirk, messy styled hair, paint-stained lapel on structured jacket, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'roast-my-linkedin',
    prompt: 'deadpan businessman in his 40s, arms crossed slight downward angle looking at camera, flat unimpressed stare, crisp business casual shirt, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'legal-eagle',
    prompt: 'sharp lawyer in their 40s, slight 3/4 angle body turned left face toward camera, rectangular reading glasses, no-nonsense expression, tailored dark suit with tie, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'code-roast',
    prompt: 'scruffy developer in their late 20s, leaning forward elbows on surface, tired dry expression, dark worn hoodie, stubble beard, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'debate-me',
    prompt: 'bold confident figure in their 30s, index finger raised mid-point one arm extended, combative grin, strong jaw, open collar shirt, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'name-storm',
    prompt: 'eccentric creative in their 30s, leaning back relaxed with wide inspired eyes, wild expressive hair, marker pen loosely held, slightly open mouth mid-thought, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'pitch-doctor',
    prompt: 'polished persuasive presenter in their 40s, low angle shot looking up slightly commanding presence, confident knowing smile, immaculate dark suit with pocket square, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'prompt-forge',
    prompt: 'precise methodical technician in their 30s, slight 3/4 angle body turned right face toward camera, mechanical goggles pushed up on forehead, focused expression, utility jacket, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'hype-check',
    prompt: 'gaming enthusiast in their 20s, leaning forward slightly elbows on surface, wide alert excited eyes, headset resting around neck, streetwear jacket, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'buzz-check',
    prompt: 'sharp journalist in their 30s, side profile with eyes cutting back toward camera, alert scanning expression, notepad held at chest, dark jacket, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm, text, letters, words, writing, badge'
  },
  {
    id: 'color-thief',
    prompt: 'stylish artistic figure in their late 20s, hand on chin thinking expression slight angle, sly knowing smirk, fanned color swatches held at chest, fashionable layered jacket, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'eli5',
    prompt: 'warm patient teacher in their 40s, slight 3/4 angle body turned left face toward camera, large round glasses, kind open expression, hands slightly raised in explanation gesture, soft cardigan, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'startup-obituary',
    prompt: 'world-weary analyst in their 40s, high angle shot looking down slightly contemplative, dark long coat, knowing melancholy expression, tired eyes, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'email-fixer',
    prompt: 'precise editor in their 30s, slight 3/4 angle body turned right face toward camera, red pen held at chest, reading glasses perched on nose, neat button-up shirt, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'meeting-killer',
    prompt: 'no-nonsense executive in their 40s, arms crossed slight downward angle looking at camera, stopwatch held firmly, impatient direct stare, sharp dark suit no tie, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'plot-twist',
    prompt: 'mysterious storyteller in their 30s, side profile with eyes cutting back toward camera, dramatic high collar framing face, mischievous knowing half-smile, dark layered jacket, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'dad-joke-judge',
    prompt: 'proud middle-aged dad in his 40s, leaning back relaxed, both hands in finger-gun pose, painfully delighted grin, polo shirt, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
  {
    id: 'excuse-engine',
    prompt: 'charming shifty figure in their 30s, both hands raised in innocent not-me gesture, disarming wide smile, slight lean back, casual open jacket, dark near-black background, chest and shoulders visible, in the style of Arcane League of Legends animated series --ar 16:9 --stylize 250 --no photorealistic, rain, wet, fire, smoke, action, weather, storm'
  },
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

          // Extract image data
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

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Check which agents already have images (skip them)
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

  console.log('Generating ' + toGenerate.length + ' of ' + PORTRAITS.length + ' portraits...');
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

        // Pause between requests to avoid rate limits
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
