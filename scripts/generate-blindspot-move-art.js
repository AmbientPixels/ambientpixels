#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Generate Blindspot Move Art (hybrid flat-illustration set)
// for the in-battle move card art panel. Output is a 3:1
// horizontal frame designed to sit BEHIND the existing CSS
// FX particle children (.bs-fx-*), which keep doing the
// state-communication work (idle drift, hover, charging,
// cooldown, combo-ready, exhausted, combo-triggered).
//
// Style: graphic/iconographic flat illustration. Hard edges,
// limited 3-4 color palette anchored on the move accent color,
// symbolic composition, riso-grain texture only. NOT the
// painterly forge-lit Vein language used for items/portraits.
//
// Forked from generate-blindspot-move-icons.js — that script
// is the previous photorealistic CG attempt and stays as
// reference. New output goes to .../moves/flat/ so the old
// archive isn't clobbered.
//
// Usage:
//   node scripts/generate-blindspot-move-art.js --only=strike
//   node scripts/generate-blindspot-move-art.js --force
//   node scripts/generate-blindspot-move-art.js
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');

// ── Post-process: extract center 3:1 horizontal band, resize, webp.
//    Gemini renders ~1024² regardless of prompt aspect hints
//    (see May 2 PM changelog — Gemini ignores aspect cues).
//    The style block tells the model to keep focal action in
//    the central 67% of width, so a 3:1 strip from vertical
//    center captures the hero composition cleanly.
const TARGET_W = 1200;
const TARGET_H = 400;   // 3:1
const WEBP_QUALITY = 85;

async function postProcess(pngPath) {
  const img = sharp(pngPath);
  const meta = await img.metadata();

  // Take a 3:1 band from the vertical center of the source.
  const bandH = Math.round(meta.width / 3);
  const top = Math.round((meta.height - bandH) / 2);

  const webpPath = pngPath.replace(/\.png$/i, '.webp');
  await sharp(pngPath)
    .extract({ left: 0, top: top, width: meta.width, height: bandH })
    .resize(TARGET_W, TARGET_H, { fit: 'cover' })
    .webp({ quality: WEBP_QUALITY })
    .toFile(webpPath);

  fs.unlinkSync(pngPath);
  return webpPath;
}

// ── Config ──
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const OUTPUT_DIR = path.join(__dirname, '..', 'blindspot', 'img', 'moves', 'flat');

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

// ── Locked style chassis. Prepended to every prompt. Defines
//    aspect, palette discipline, geometric construction, and
//    the Vein-language motif vocabulary. Bans painterly
//    rendering, photorealism, text, faces, UI elements.
const STYLE_BLOCK = [
  'Flat illustration in a graphic, iconographic style — bold negative shapes,',
  'hard edges, no painterly brushwork, no photorealism, no airbrush, no soft',
  'gradients, no lens flare. Subtle risograph print grain texture only.',
  'Symbolic composition over literal scene — this is a tarot card, not a',
  'screenshot. The frame is a horizontal panoramic banner; focal action is',
  'contained in the central 67% of width so the composition still reads when',
  'cropped narrower. Limited 3 to 4 color palette anchored on the accent',
  'color, supported by deep charcoal #100C08 negative space and one warm',
  'cream highlight #F5F0E8. Geometric construction — facets, hexagons,',
  'radial bursts, concentric rings, woodcut-style etched line work.',
  'Vein-language motifs: forged metal, eye-slash slits, ember sparks, runic',
  'fracture lines. NO text, NO logos, NO letters, NO numbers, NO runes with',
  'lettering, NO watermarks, NO UI elements, NO borders or frames around the',
  'image, NO human faces in detail (silhouettes only). Mood: ancient forge',
  'meets occult sci-fi. Centered or strong-diagonal composition only.'
].join(' ');

// ── 10 move art entries. Each prompt = subject sentence + STYLE_BLOCK.
//    Order: 5 base moves, then 5 stat-family ability variants.
const MOVES = [
  {
    id: 'strike',
    subject: 'A clenched gauntleted fist frozen mid-impact at center, exploding outward in a faceted geometric shockwave of triangular shards. Sparks suspended mid-arc trail behind the fist on a sweeping NW-to-SE diagonal. The fist is solid charcoal silhouette only; the negative space behind carries the burst of ember orange light. Asymmetric weight on the lower-right. Palette: ember orange #ff7a3a, oxblood red, deep charcoal.'
  },
  {
    id: 'guard',
    subject: 'A concentric expansion of six hexagonal shield rings rippling outward from a centered figure-silhouette in a bracing stance. Front-and-center: a weathered iron shield face etched with a single horizontal slit (Vein eye-slash motif). Rings get fainter as they spread; the outermost ring barely visible. Palette: cobalt cyan #6cc4ff, steel grey, bone white on charcoal. Totally symmetrical.'
  },
  {
    id: 'ability',
    subject: 'A luminous angular sigil at dead center, cracking open along a vertical seam, leaking a single vertical line of pure light energy. Six geometric rune-glyphs (no letters, abstract shapes only) orbit in a hexagonal pattern around the breach. Violet bloom on charcoal, with one electric gold accent at the seam itself — the precise moment of release. Palette: arcane violet #b47cf5, electric gold, deep indigo. Dead-center radial composition.'
  },
  {
    id: 'heal',
    subject: 'An upward bloom of stylized geometric petals, six of them hexagonally arranged, unfurling around a glowing diamond-shaped heart-core at bottom-center. Bubbles or seed-shapes rise from the core and trail upward off the top of the frame. Bottom-weighted with strong upward motion. Palette: mint green #6cffb0, warm amber, bone white. The amber highlight appears only on the heart-core itself.'
  },
  {
    id: 'counter',
    subject: 'Two curved blades crossed in an X at dead center of the frame, sparks erupting from the crossing point in a golden starburst. Curved motion lines arc through the X — one blade is the incoming attack, the other deflects it back as a single sweeping curve. Palette: honey gold #ffd97a, bronze, deep oxblood. Sharp diagonal X composition.'
  },
  {
    id: 'powerstrike',
    subject: 'A colossal warhammer at the apex of an overhead swing, ground beneath it splitting into faceted geometric cracks radiating outward in a fan. The hammer is silhouette only; the cracks below are where heated red-orange light leaks through. Heavy weight at the top of the frame, the swing potential energy implied. Mountain-crushing scale. Palette: orange-red #ff5a2a, rust, bedrock grey, charcoal.'
  },
  {
    id: 'arcaneblast',
    subject: 'A focused horizontal beam of crystalline prismatic energy lancing outward from a hexagonal sigil anchored at the LEFT edge of the frame, refracting into faceted shard-rays as it travels right. The beam splits into three diverging rays at 80% of the frame width. Hot magenta core, violet outer halo, navy negative space. Palette: violet #b47cf5, electric magenta, deep navy. Strong left-to-right directional thrust.'
  },
  {
    id: 'shadowstrike',
    subject: 'A figure-silhouette mid-dash, captured at the END of its motion — three afterimages trailing behind in decreasing opacity, only the freshest still solid. The strike has already happened; you are seeing the wake. A single cold cyan glint at the very tip of the lead silhouette implies the blade. Diagonal SW-to-NE motion vector. Almost monochrome and atmospheric. Palette: indigo, plum, ash grey, cold cyan glint.'
  },
  {
    id: 'fortify',
    subject: 'A bulky figure-silhouette rooted to a bedrock plinth at center, layered concentric stone-and-iron armor rings blooming outward from the body like geological strata. The figure is unmoving; the armor is what is growing. Heavy bottom weight. Warm copper accents only at the seams between layers. Palette: iron grey, slate blue, warm copper highlight. Symmetrical, monumental, immovable.'
  },
  {
    id: 'wildcard',
    subject: 'A central circular chance-wheel split into six geometric pie-wedges, alternating gold and magenta, with stylized iconographic glyphs on each wedge: die-pip, horseshoe, eye, lightning bolt, coin, void-circle. The wheel is mid-spin, motion lines blurring the outer rim. A scatter of small geometric tokens orbits in an offset elliptical path around the wheel. Palette: honey gold #ffd97a, electric magenta, mint accent, charcoal. Centered, but the orbit pulls focus diagonally.'
  }
];

// ── Gemini API call (matches generate-blindspot-move-icons.js shape) ──
function callGemini(apiKey, prompt) {
  return new Promise(function (resolve, reject) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey;
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['Image'] }
    });
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 120000
    };
    const req = https.request(options, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const raw = Buffer.concat(chunks).toString();
        try {
          const json = JSON.parse(raw);
          if (res.statusCode !== 200) {
            return reject(new Error('HTTP ' + res.statusCode + ': ' + (json.error && json.error.message || raw.slice(0, 200))));
          }
          const candidates = json.candidates || [];
          if (candidates.length === 0) return reject(new Error('No candidates returned'));
          const parts = candidates[0].content && candidates[0].content.parts || [];
          const imagePart = parts.find(function (p) { return p.inlineData; });
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

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function main() {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY not found.');
    console.error('Set it in environment, api/local.settings.json, or .env file.');
    process.exit(1);
  }

  const force = process.argv.indexOf('--force') !== -1;
  const onlyArg = process.argv.find(function (a) { return a.indexOf('--only=') === 0; });
  const onlyFilter = onlyArg ? onlyArg.slice(7).split(',').map(function (s) { return s.trim(); }) : null;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const existing = new Set();
  try {
    fs.readdirSync(OUTPUT_DIR).forEach(function (f) {
      const id = f.replace(/\.(png|jpg|jpeg|webp)$/i, '');
      existing.add(id);
    });
  } catch (e) {}

  const toGenerate = MOVES.filter(function (m) {
    if (onlyFilter && onlyFilter.indexOf(m.id) === -1) return false;
    if (!force && existing.has(m.id)) return false;
    return true;
  });

  if (toGenerate.length === 0) {
    console.log('All ' + MOVES.length + ' move art images already exist. Use --force to regenerate.');
    return;
  }

  console.log('Generating ' + toGenerate.length + ' of ' + MOVES.length + ' move art images...');
  console.log('Model:  ' + MODEL);
  console.log('Output: ' + OUTPUT_DIR);
  console.log('Aspect: extract 3:1 center band → ' + TARGET_W + 'x' + TARGET_H + ' webp q' + WEBP_QUALITY);
  if (force) console.log('Mode:   FORCE (overwriting existing)');
  console.log('');

  let success = 0;
  let failed = 0;

  for (let i = 0; i < toGenerate.length; i++) {
    const move = toGenerate[i];
    const label = '[' + (i + 1) + '/' + toGenerate.length + '] ' + move.id;
    process.stdout.write(label + ' ... ');

    const prompt = move.subject + ' ' + STYLE_BLOCK;

    let attempts = 0;
    const maxRetries = 3;
    let generated = false;

    while (attempts < maxRetries && !generated) {
      attempts++;
      try {
        const result = await callGemini(apiKey, prompt);
        const pngPath = path.join(OUTPUT_DIR, move.id + '.png');
        fs.writeFileSync(pngPath, Buffer.from(result.base64, 'base64'));
        const webpPath = await postProcess(pngPath);
        const sizeKB = Math.round(fs.statSync(webpPath).size / 1024);
        console.log('OK (' + sizeKB + ' KB) → ' + path.basename(webpPath));
        success++;
        generated = true;
        if (i < toGenerate.length - 1) await sleep(2000);
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
}

main().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
