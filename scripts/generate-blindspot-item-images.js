#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Generate Blindspot inventory item images via Gemini 2.5 Flash Image.
// Modeled on scripts/generate-agent-portraits.js.
//
// Usage:
//   node scripts/generate-blindspot-item-images.js
//   node scripts/generate-blindspot-item-images.js --force        # regenerate all
//   node scripts/generate-blindspot-item-images.js charm_power_surge endurance_tonic   # only these IDs
//
// For each item: generate PNG via Gemini, save to img/items/{id}.png, then
// resize+encode to img/items/{id}.webp at 512px max edge / q82. Skips items
// whose WebP already exists unless --force is passed (or specific IDs given).
//
// Requires GEMINI_API_KEY in env, api/local.settings.json, or .env.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const OUTPUT_DIR = path.join(__dirname, '..', 'blindspot', 'img', 'items');
const WEBP_MAX_EDGE = 512;
const WEBP_QUALITY = 82;
const PAUSE_MS = 2000;
const MAX_RETRIES = 3;

// Locked style. Every prompt is "<STYLE_BLOCK> <ITEM_SUBJECT>" so the
// inventory grid reads as one set across all 18 items.
const STYLE_BLOCK =
  'Painterly fantasy item, single object centered on a dark forge-lit backdrop, ' +
  'amber and ember highlights from the upper left, deep shadows, hand-rendered ' +
  'in the spirit of Dark Souls / Bloodborne inventory art, portrait 4:5 framing, ' +
  'no text, no UI, no logos, slight vignette.';

// Single source of truth for every item the inventory can show. New items
// added later (e.g. when balance config introduces them) just need an entry
// here; no other script changes required.
const ITEMS = [
  // ─── Batch 1 (shipped 2026-05-02) ───────────────────────────────
  { id: 'charm_heal_potion', subject: 'A small thick-glass vial of crimson liquid with a wax-sealed cork, glowing softly from within, chipped iron stand beneath.' },
  { id: 'smoke_bomb', subject: 'A weathered iron sphere with a short braided fuse, faint wisps of grey smoke leaking from a hairline crack, resting on cracked stone.' },
  { id: 'lucky_coin', subject: 'A worn gold coin half-flipped mid-air, the obverse a single eye sigil, catching forge-light along its edge, soft motion blur on one side only.' },
  { id: 'focus_elixir', subject: 'A tall slender vial of pale violet liquid with a slow rising spiral of arcane mist, rune-etched silver collar at the neck.' },
  { id: 'prism_shard', subject: 'A jagged six-sided crystal shard, refracting amber forge-light into faint rainbow streaks across the surrounding stone.' },

  // ─── Batch 2 (shipped 2026-05-02) ───────────────────────────────
  { id: 'war_cry', subject: 'A curved bone-and-iron war horn wrapped in dark leather cord, brass mouthpiece catching forge-light, faint warm breath visible at the rim, set on a worn stone slab.' },
  { id: 'iron_skin', subject: 'A blackened iron medallion stamped with a deep rune-mark, hanging from a frayed leather thong, the metal pitted with hammer marks, faint heat-bloom along one edge.' },
  { id: 'healing_salve', subject: 'A small squat clay jar with a wax-sealed wooden stopper, pale poultice spilling slightly over the lip, twine wrapped around the neck, sitting on cracked dark stone.' },
  { id: 'stamina_potion', subject: 'A tall slender vial of viridian-green liquid with rising chains of tiny effervescent bubbles, copper-banded collar at the neck, cork stopper.' },
  { id: 'element_ward', subject: 'A weathered iron shield-sigil amulet, four elemental runes etched in a circle (flame, leaf, wave, eye), faint protective glow tracing the outer ring, hung on dark cord.' },

  // ─── Batch 3 (charm power family + element utility) ─────────────
  { id: 'charm_power_surge', subject: 'A blackened iron gauntlet-fist talisman the size of a coin, knuckles wreathed in faint orange forge-glow, hung on a frayed leather thong, set on a dark stone slab.' },
  { id: 'charm_shield_wall', subject: 'A miniature kite shield charm of dark steel with a single deep gouge across the face, gold rivets at the corners, leather strap looped through, lit from above by warm forge-glow.' },
  { id: 'charm_lucky_strike', subject: 'A small antler-handled dagger no longer than a finger, its blade shaped like a four-leafed clover, a single drop of amber set in the pommel catching the forge-light.' },
  { id: 'element_burst', subject: 'A jagged dark-iron disc cracked through the center, the crack itself filled with molten gold light spilling outward, set on cracked basalt stone.' },
  { id: 'element_shift', subject: 'A weathered brass compass-rose with four elemental glyphs (flame, leaf, wave, eye) at the cardinal points, the central needle spinning in a faint blur of motion, lit by warm forge ambience.' },

  // ─── Batch 4 (element resist charms — coherent set of 4) ────────
  { id: 'charm_resist_fire', subject: 'A blackened iron medallion stamped with a single bold flame rune, the rune carved deep and rimmed with cooling orange-red glow, hung on dark leather cord, set on dark stone.' },
  { id: 'charm_resist_earth', subject: 'A blackened iron medallion stamped with a single bold leaf-and-mountain rune, the rune carved deep and rimmed with cool moss-green glow, hung on dark leather cord, set on dark stone.' },
  { id: 'charm_resist_arcane', subject: 'A blackened iron medallion stamped with a single bold star-and-crescent rune, the rune carved deep and rimmed with cold violet glow, hung on dark leather cord, set on dark stone.' },
  { id: 'charm_resist_shadow', subject: 'A blackened iron medallion stamped with a single bold half-eye rune, the rune carved deep and rimmed with cold blue-grey glow, hung on dark leather cord, set on dark stone.' },

  // ─── Final 3 (fills inventory to 100%) ──────────────────────────
  { id: 'charm_charge_boost', subject: 'A copper-banded glass orb the size of a chestnut filled with crackling arcane energy arcs, brass cap at top, hung on chain, faint blue-white glow casting on the dark stone beneath.' },
  { id: 'endurance_tonic', subject: 'A short stout stoneware bottle with a wax-sealed cork, deep amber liquid visible through a sliver of glass at the side, leather wrap around the neck, sitting on dark stone.' },
  { id: 'second_wind', subject: 'A single white feather pinned beneath an iron clasp on a flat stone slab, faint wisps of pale wind rising from its tip, copper edging on the clasp glinting in forge-light.' },

  // ─── Batch 5 (game-config charm slot completion) ────────────────
  { id: 'charm_smoke_bomb', subject: 'A small dark iron amulet shaped like a sphere etched with a single billowing smoke glyph, faint grey wisps trailing from the carved line, hung on a leather thong, set on dark stone.' },
  { id: 'charm_iron_skin', subject: 'A wide-shouldered glass tonic bottle with a heavy iron stopper, dark steel-grey liquid inside catching warm forge-light along the bevels, brass label band stamped with a shield rune around the neck.' },
  { id: 'charm_combo_primer', subject: 'Three interlocking dark-iron rings the size of a coin, the inner ring etched with a pulsing chevron rune glowing soft amber, hung on a leather thong, set on dark stone.' },
  { id: 'charm_adrenaline_spike', subject: 'A small antler-handled syringe-spike with a brass plunger, a single drop of glowing yellow-green liquid at the needle tip, faint electric arc crackling along the haft, on dark stone.' },
  { id: 'battle_surge', subject: 'A pair of glowing twin-orb crystals fused at the center, one orb cool violet and one warm amber, hung on a heavy iron chain, faint shockwave ripples in the air around them, set on cracked basalt stone.' }
];

// ── Load API key (env -> api/local.settings.json -> .env) ──
function getApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'api', 'local.settings.json'), 'utf8'));
    if (settings.Values && settings.Values.GEMINI_API_KEY) return settings.Values.GEMINI_API_KEY;
  } catch (e) { /* fallthrough */ }
  try {
    const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const m = envFile.match(/GEMINI_API_KEY=(.+)/);
    if (m) return m[1].trim();
  } catch (e) { /* fallthrough */ }
  return null;
}

// ── Gemini image generation ──
function callGemini(apiKey, prompt) {
  return new Promise(function (resolve, reject) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey;
    var body = JSON.stringify({
      contents: [{ parts: [{ text: 'Generate an inventory item image: ' + prompt }] }],
      generationConfig: { responseModalities: ['Image'] }
    });
    var parsed = new URL(url);
    var req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 120000
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString();
        try {
          var json = JSON.parse(raw);
          if (res.statusCode !== 200) {
            return reject(new Error('HTTP ' + res.statusCode + ': ' + (json.error && json.error.message || raw.slice(0, 200))));
          }
          var parts = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
          var imagePart = parts.find(function (p) { return p.inlineData; });
          if (!imagePart) return reject(new Error('No image data in response'));
          resolve({ base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType || 'image/png' });
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

// ── Resize + encode to WebP ──
async function encodeWebp(srcPath, outPath) {
  await sharp(srcPath)
    .resize({ width: WEBP_MAX_EDGE, height: WEBP_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 5 })
    .toFile(outPath);
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ── Main ──
async function main() {
  var apiKey = getApiKey();
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY not found in env, api/local.settings.json, or .env.');
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Parse CLI args
  var args = process.argv.slice(2);
  var force = args.indexOf('--force') !== -1;
  var explicitIds = args.filter(function (a) { return a !== '--force'; });

  var items;
  if (explicitIds.length > 0) {
    items = ITEMS.filter(function (it) { return explicitIds.indexOf(it.id) !== -1; });
    var unknown = explicitIds.filter(function (id) { return !items.find(function (it) { return it.id === id; }); });
    if (unknown.length > 0) {
      console.error('ERROR: unknown item IDs: ' + unknown.join(', '));
      console.error('Known IDs: ' + ITEMS.map(function (it) { return it.id; }).join(', '));
      process.exit(1);
    }
  } else if (force) {
    items = ITEMS.slice();
  } else {
    items = ITEMS.filter(function (it) {
      var webpPath = path.join(OUTPUT_DIR, it.id + '.webp');
      return !fs.existsSync(webpPath);
    });
  }

  if (items.length === 0) {
    console.log('All ' + ITEMS.length + ' items already have WebP art. Nothing to do.');
    console.log('Pass --force to regenerate, or list IDs to regenerate specific ones.');
    return;
  }

  console.log('Model: ' + MODEL);
  console.log('Output: ' + OUTPUT_DIR);
  console.log('Generating ' + items.length + ' of ' + ITEMS.length + ' items.');
  console.log('');

  var success = 0, failed = 0;

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var label = '[' + (i + 1) + '/' + items.length + '] ' + item.id;
    process.stdout.write(label + ' ... ');

    var attempts = 0;
    var done = false;
    while (attempts < MAX_RETRIES && !done) {
      attempts++;
      try {
        var prompt = STYLE_BLOCK + ' ' + item.subject;
        var result = await callGemini(apiKey, prompt);
        var pngPath = path.join(OUTPUT_DIR, item.id + '.png');
        var webpPath = path.join(OUTPUT_DIR, item.id + '.webp');
        fs.writeFileSync(pngPath, Buffer.from(result.base64, 'base64'));
        await encodeWebp(pngPath, webpPath);
        var pngKb = Math.round(fs.statSync(pngPath).size / 1024);
        var webpKb = Math.round(fs.statSync(webpPath).size / 1024);
        console.log('OK  png=' + pngKb + 'KB  webp=' + webpKb + 'KB');
        success++;
        done = true;
        if (i < items.length - 1) await sleep(PAUSE_MS);
      } catch (err) {
        if (attempts < MAX_RETRIES) {
          process.stdout.write('retry ' + attempts + '... ');
          await sleep(3000);
        } else {
          console.log('FAILED after ' + MAX_RETRIES + ' attempts: ' + err.message);
          failed++;
        }
      }
    }
  }

  console.log('');
  console.log('Done. ' + success + ' generated, ' + failed + ' failed.');
  if (success > 0) {
    console.log('');
    console.log('Next: add new IDs to ITEM_IMAGES in blindspot/js/lib/bs-charms.js then commit.');
  }
}

main().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
