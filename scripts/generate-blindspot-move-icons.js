#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Generate Blindspot Move Icon Images via Gemini 2.5 Flash
// Usage: node scripts/generate-blindspot-move-icons.js
// Requires: GEMINI_API_KEY in environment, local.settings.json, or .env
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');

// ── Post-process: crop outer margin (kills Gemini's rounded-corner frame),
//    resize, and convert to WebP. ──
const CROP_INSET = 0.07;   // crop 7% off each edge to remove the rounded app-icon frame
const OUTPUT_SIZE = 256;   // target square size in px
const WEBP_QUALITY = 85;

async function postProcess(pngPath) {
  var img = sharp(pngPath);
  var meta = await img.metadata();
  var inset = Math.round(Math.min(meta.width, meta.height) * CROP_INSET);
  var cropW = meta.width - inset * 2;
  var cropH = meta.height - inset * 2;

  var webpPath = pngPath.replace(/\.png$/i, '.webp');
  await sharp(pngPath)
    .extract({ left: inset, top: inset, width: cropW, height: cropH })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover' })
    .webp({ quality: WEBP_QUALITY })
    .toFile(webpPath);

  // Delete the source PNG after conversion
  fs.unlinkSync(pngPath);
  return webpPath;
}

// ── Config ──
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const OUTPUT_DIR = path.join(__dirname, '..', 'blindspot', 'img', 'moves');

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

// ── Shared style suffix (keeps the 5 icons visually cohesive) ──
// Photorealistic CG render style — matches Blindspot's cinematic forge vibe.
// Think Destiny 2 / Diablo 4 key art, not Hearthstone. Post-process crops edges.
const STYLE = 'hyperrealistic 3D render, Octane render, Unreal Engine 5 cinematic, PBR materials, photorealistic, physically based rendering, ultra detailed metal surfaces with microscratches and patina, real molten steel glowing cracks, real ember particles and volumetric sparks, cinematic studio lighting, shallow depth of field, subtle bokeh, dramatic rim light, deep charcoal near-black background, product render aesthetic, the subject fills the entire frame edge to edge, no text, no letters, no words, no numbers, no runes, no glyphs, no symbols, no writing, no UI elements, no borders, no frames, no painterly brushwork, no illustration, no cartoon, no cel shading, no anime, no stylized, not cute, not whimsical, grim dark gritty --ar 1:1';

// ── Move icons (id → prompt) ──
const ICONS = [
  {
    id: 'strike',
    prompt: 'extreme close-up product shot of a single forged iron armored fist mid-punch frozen in time, dark blued steel gauntlet with molten orange lava cracks pulsing through the knuckles, real volumetric ember sparks exploding off the impact, motion blur trailing, wisps of smoke, hero centered composition, ' + STYLE
  },
  {
    id: 'guard',
    prompt: 'extreme close-up product shot of a single battle-scarred dark steel kite shield facing the viewer head on, weathered dents and deep scratches across its face, glowing molten amber cracks running through the metal, real ember sparks raining down and deflecting off the surface, wisps of smoke, hero centered composition, ' + STYLE
  },
  {
    id: 'heal',
    prompt: 'extreme close-up product shot of a dark iron apothecary vial half full of glowing emerald green liquid, real liquid caustics and refraction, wrought iron cage wrapping the glass, a wisp of green vapor rising from the sealed cork stopper, amber ember sparks drifting in the background, hero centered composition, ' + STYLE
  },
  {
    id: 'counter',
    prompt: 'extreme close-up product shot of a single heavy circular polished dark steel disc with a concentric ring pattern, shown perfectly flat head on viewer perspective with no perspective distortion, molten amber cracks glowing across the surface, a bright incoming projectile impact flash exploding outward from the center in a ring of real volumetric sparks and shockwave, hero centered composition, ' + STYLE
  },
  {
    id: 'ability',
    prompt: 'extreme close-up product shot of a single sphere of crackling violet arcane plasma suspended in midair, real volumetric electric arcs branching outward, molten amber energy ribbons orbiting the sphere, glowing ember particles, raw untamed magical power, no frame no border no container, hero centered composition, ' + STYLE
  }
];

// ── Class-specific ability icons (12 classes, output as ability-{class}.webp) ──
const ABILITY_ICONS = [
  {
    id: 'ability-fighter',
    prompt: 'extreme close-up product shot of a massive forged iron two-handed warhammer head mid-swing frozen in time, deep molten amber cracks glowing through the dark steel head, real volumetric ember sparks exploding around it, motion blur trailing from the swing, wisps of smoke, hero centered composition, ' + STYLE
  },
  {
    id: 'ability-enforcer',
    prompt: 'extreme close-up product shot of an armored brass and dark steel fist gauntlet with hydraulic pistons and studded iron knuckle plating, glowing amber energy coils wrapped around the wrist, real volumetric ember sparks, industrial brutalist design, hero centered composition, ' + STYLE
  },
  {
    id: 'ability-berserker',
    prompt: 'extreme close-up product shot of a battered dark steel greataxe head with jagged chipped edges, deep blood-red molten cracks pulsing through the metal, real flames licking the blade edge, volumetric ember sparks, savage feral weapon, hero centered composition, ' + STYLE
  },
  {
    id: 'ability-guardian',
    prompt: 'extreme close-up product shot of a massive dark iron tower shield planted upright in cracked stone ground, rugged spikes along the rim, deep molten amber cracks glowing through the weathered metal, real volumetric ember sparks deflecting off the surface, fortress bulwark, hero centered composition, ' + STYLE
  },
  {
    id: 'ability-caster',
    prompt: 'extreme close-up product shot of a single sphere of crackling violet arcane plasma suspended in midair, real volumetric electric arcs branching outward, molten amber energy ribbons orbiting the sphere, glowing ember particles, raw untamed magical power, no frame no border, hero centered composition, ' + STYLE
  },
  {
    id: 'ability-scholar',
    prompt: 'extreme close-up product shot of a single glowing cyan crystal spike floating in midair, sharp faceted edges refracting cold blue light, wisps of icy vapor curling around it, amber ember particles drifting in the background, intellectual mental power, no frame, hero centered composition, ' + STYLE
  },
  {
    id: 'ability-hacker',
    prompt: 'extreme close-up product shot of a dark metal grenade-sized device exploding with cyan digital circuit-board energy, glowing green data streams bursting outward, amber ember sparks, cyberpunk tech, volumetric light rays, hero centered composition, ' + STYLE
  },
  {
    id: 'ability-scout',
    prompt: 'extreme close-up product shot of a curved dark wood recurve bow drawn taut with a single ember-tipped arrow nocked, the arrowhead glowing molten amber, wisps of dark smoke trailing from the shaft, real volumetric sparks, precision hunter weapon, hero centered composition, ' + STYLE
  },
  {
    id: 'ability-rogue',
    prompt: 'extreme close-up product shot of twin curved obsidian daggers crossed in an X, blades coated in glowing emerald green venom dripping off the edges, wisps of dark shadow smoke curling around them, amber ember sparks in the background, hero centered composition, ' + STYLE
  },
  {
    id: 'ability-trickster',
    prompt: 'extreme close-up product shot of a single playing card suspended midair engulfed in chaotic amber and violet flames, the card edges burning away, sparks and glowing embers swirling around it, gambler mystique, no frame, hero centered composition, ' + STYLE
  },
  {
    id: 'ability-medic',
    prompt: 'extreme close-up product shot of a military combat stim injector syringe with dark metal casing and glowing red liquid inside, LED medical indicators, a bright red emergency cross embossed on the side, real volumetric sparks and steam, hero centered composition, ' + STYLE
  },
  {
    id: 'ability-pilot',
    prompt: 'extreme close-up product shot of a single rocket missile warhead with dark metal plating and exposed rivets, bright jet flame erupting from the tail, real volumetric smoke and sparks trailing behind it, industrial military weapon, hero centered composition, ' + STYLE
  }
];

// ── Gemini API call ──
function callGemini(apiKey, prompt) {
  return new Promise(function (resolve, reject) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey;

    var body = JSON.stringify({
      contents: [{ parts: [{ text: 'Generate a square game icon image: ' + prompt }] }],
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
    console.error('Set it in environment, api/local.settings.json, or .env file.');
    process.exit(1);
  }

  // CLI flag: --force regenerates all icons, otherwise skip existing
  var force = process.argv.indexOf('--force') !== -1;
  // CLI flag: --only=strike,guard to generate a subset
  var onlyArg = process.argv.find(function (a) { return a.indexOf('--only=') === 0; });
  var onlyFilter = onlyArg ? onlyArg.slice(7).split(',').map(function (s) { return s.trim(); }) : null;
  // CLI flag: --abilities generates the 12 class-specific ability icons instead of the base 5
  var abilitiesMode = process.argv.indexOf('--abilities') !== -1;
  var sourceSet = abilitiesMode ? ABILITY_ICONS : ICONS;
  var setLabel = abilitiesMode ? 'class ability icons' : 'move icons';

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  var existing = new Set();
  try {
    fs.readdirSync(OUTPUT_DIR).forEach(function (f) {
      var id = f.replace(/\.(png|jpg|jpeg|webp)$/i, '');
      existing.add(id);
    });
  } catch (e) {}

  var toGenerate = sourceSet.filter(function (icon) {
    if (onlyFilter && onlyFilter.indexOf(icon.id) === -1) return false;
    if (!force && existing.has(icon.id)) return false;
    return true;
  });

  if (toGenerate.length === 0) {
    console.log('All ' + sourceSet.length + ' ' + setLabel + ' already exist. Use --force to regenerate.');
    return;
  }

  console.log('Generating ' + toGenerate.length + ' of ' + sourceSet.length + ' ' + setLabel + '...');
  console.log('Model:  ' + MODEL);
  console.log('Output: ' + OUTPUT_DIR);
  if (force) console.log('Mode:   FORCE (overwriting existing)');
  console.log('');

  var success = 0;
  var failed = 0;

  for (var i = 0; i < toGenerate.length; i++) {
    var icon = toGenerate[i];
    var label = '[' + (i + 1) + '/' + toGenerate.length + '] ' + icon.id;
    process.stdout.write(label + ' ... ');

    var attempts = 0;
    var maxRetries = 3;
    var generated = false;

    while (attempts < maxRetries && !generated) {
      attempts++;
      try {
        var result = await callGemini(apiKey, icon.prompt);
        var pngPath = path.join(OUTPUT_DIR, icon.id + '.png');
        fs.writeFileSync(pngPath, Buffer.from(result.base64, 'base64'));

        // Crop outer frame + resize + convert to WebP
        var webpPath = await postProcess(pngPath);
        var sizeKB = Math.round(fs.statSync(webpPath).size / 1024);
        console.log('OK (' + sizeKB + ' KB) → ' + path.basename(webpPath));
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
  console.log('Done: ' + success + ' generated, ' + failed + ' failed.');
  if (success > 0) {
    console.log('');
    console.log('Next step: convert PNGs to WebP for production (optional):');
    console.log('  cwebp -q 85 blindspot/img/moves/strike.png -o blindspot/img/moves/strike.webp');
  }
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

main().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
