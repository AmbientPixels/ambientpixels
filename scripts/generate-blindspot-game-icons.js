#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Generate Blindspot game icon images via Gemini 2.5 Flash Image.
// Covers asset categories that currently use FA icons or need new art:
//   - Stats        (5):  str, agi, int, end, lck
//   - Classes      (12): Fighter, Enforcer, Berserker, Guardian, Caster, Scholar,
//                        Hacker, Scout, Rogue, Trickster, Medic, Pilot
//   - Elements     (5):  fire, earth, arcane, shadow, chaos
//   - Crates       (5):  battle, boss, weekly, ember, ascension
//   - Titles       (8):  heraldic wax seals
//   - Lobby-tiles  (1):  sparks-tile (matches crate-tile + collection-tile pair)
//   - Ranks        (6):  initiate, apprentice, veteran, champion, legend, mythic
//
// Usage:
//   node scripts/generate-blindspot-game-icons.js
//   node scripts/generate-blindspot-game-icons.js --force            # regenerate all
//   node scripts/generate-blindspot-game-icons.js --set stats        # only one category
//   node scripts/generate-blindspot-game-icons.js stats:str classes:fighter elements:fire
//
// Each set has its own STYLE_BLOCK so categories read as their own series.
// All output WebP at 256-512px / q82, alongside the source PNG kept as master.
//
// Requires GEMINI_API_KEY in env, api/local.settings.json, or .env.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const OUT_ROOT = path.join(__dirname, '..', 'blindspot', 'img');
const PAUSE_MS = 2000;
const MAX_RETRIES = 3;

// Each set: { id, dir, webpEdge, style, items: [{ id, subject }] }
// dir is relative to OUT_ROOT. webpEdge caps the WebP's longest dimension.
const SETS = [
  // ─── STATS ──────────────────────────────────────────────────────
  {
    id: 'stats',
    dir: 'stats',
    webpEdge: 256,
    style: 'Minimalist forged-metal symbol etched into dark iron, single bold glyph centered, deep recessed line traced by a soft coloured forge-glow, plain dark stone backdrop with subtle vignette, hand-rendered fantasy icon style, square 1:1 framing, no text, no UI, no logos.',
    items: [
      { id: 'str', subject: 'A clenched iron gauntlet symbol, knuckles raised, etched line glowing soft red-orange.' },
      { id: 'agi', subject: 'A stylized arrow-wing in profile with sharp curving line, etched line glowing soft cyan-green.' },
      { id: 'int', subject: 'A six-pointed star with a small open-eye in the center, etched line glowing soft violet.' },
      { id: 'end', subject: 'A tall kite-shield outline with a single cross brace across the middle, etched line glowing soft amber.' },
      { id: 'lck', subject: 'A four-leaf clover with a single die pip in the center, etched line glowing soft gold.' }
    ]
  },

  // ─── CLASSES ────────────────────────────────────────────────────
  {
    id: 'classes',
    dir: 'classes',
    webpEdge: 384,
    style: 'Painterly fantasy class emblem, single iconic helm or silhouette object representing the class archetype, centered on a dark forge-lit backdrop with amber and ember highlights from the upper left, deep shadows, hand-rendered in the spirit of Dark Souls / Bloodborne inventory art, square 1:1 framing, no text, no UI, no logos, slight vignette.',
    items: [
      { id: 'fighter',   subject: 'A simple weathered plate helm in three-quarter profile, brow guard prominent, dark iron catching warm forge rim-light along the crown.' },
      { id: 'enforcer',  subject: 'A heavy studded mace head resting upright on its haft, brutal weighted silhouette, dark iron and cracked grip, faint orange glow on the spikes.' },
      { id: 'berserker', subject: 'A horned beast-helm with a snarling visor and twin curving horns, dark blood-red glow leaking from the eye slits.' },
      { id: 'guardian',  subject: 'A tall kite shield centered with an embossed cross sigil, polished dark steel with golden trim catching forge-light along the rivets.' },
      { id: 'caster',    subject: 'A hooded robed silhouette in profile, a glowing violet orb floating just above an outstretched palm at chest level, soft arcane mist around the hand.' },
      { id: 'scholar',   subject: 'An open ancient leather-bound tome on a stone slab, runes glowing softly violet on the visible page, brass clasps and a long silk bookmark.' },
      { id: 'hacker',    subject: 'A weathered cipher mask in profile, circuit-like rune etching tracing across the cheek, faint cyan glow at the eye slit.' },
      { id: 'scout',     subject: 'A hooded archer silhouette with longbow drawn back, low angle, deep blue moonlight rather than forge glow.' },
      { id: 'rogue',     subject: 'A masked figure silhouette holding a curved dagger low at the side, mask with a single eye slit, faint amber blade glint.' },
      { id: 'trickster', subject: 'A weathered jester tricorn hat with three small bells at the points, mischievous curve, gold and red velvet trim under warm forge light.' },
      { id: 'medic',     subject: 'A heavy stone mortar and pestle with a small pile of glowing healing herbs spilling over the rim, warm amber glow.' },
      { id: 'pilot',     subject: 'A scarred leather aviator helm with brass-rimmed goggles pushed up onto the brow, frayed straps, warm amber rim-light.' }
    ]
  },

  // ─── ELEMENTS ───────────────────────────────────────────────────
  {
    id: 'elements',
    dir: 'elements',
    webpEdge: 256,
    style: 'Glowing magical rune sigil etched into a dark iron disc, single bold elemental glyph deeply carved into the centre, atmospheric coloured glow appropriate to the element tracing the rune lines, dark stone backdrop with subtle vignette, hand-rendered fantasy style, square 1:1 framing, no text, no UI, no logos.',
    items: [
      { id: 'fire',   subject: 'A bold flame rune deeply carved into dark iron, deep orange-red molten glow tracing the rune lines, faint heat shimmer.' },
      { id: 'earth',  subject: 'A bold leaf-over-mountain rune deeply carved into dark iron, cool moss-green glow tracing the rune lines.' },
      { id: 'arcane', subject: 'A bold star-with-crescent rune deeply carved into dark iron, cool violet glow tracing the rune lines, faint particles drifting up.' },
      { id: 'shadow', subject: 'A bold half-eye rune deeply carved into dark iron, cold blue-grey glow tracing the rune lines, the surrounding metal noticeably darker.' },
      { id: 'chaos',  subject: 'A bold spiraling vortex rune deeply carved into dark iron, prismatic shifting glow tracing the rune lines, the colours bleeding into each other.' }
    ]
  },

  // ─── CRATES ─────────────────────────────────────────────────────
  {
    id: 'crates',
    dir: 'crates',
    webpEdge: 512,
    style: 'Painterly fantasy treasure chest, single closed crate centered on dark stone, atmospheric forge-lit ambience with amber and ember highlights from the upper left, deep shadows, materials and embellishments matching the crate tier, hand-rendered in the spirit of Dark Souls / Bloodborne inventory art, square 1:1 framing, no text, no UI, no logos, slight vignette.',
    items: [
      { id: 'battle',    subject: 'A small dark wooden crate with simple iron bands and a brass padlock, faint warm orange glow leaking from the lid seam, weathered planks.' },
      { id: 'boss',      subject: 'A heavier ornate crate of dark iron and bone-trim, an embossed skull medallion centered on the lid, dark red glow leaking at the seams, scorched edges.' },
      { id: 'weekly',    subject: 'A weathered crate with brass clockwork gears along the lid edge and a small sundial face inset on the top, soft amber clockwork glow.' },
      { id: 'ember',     subject: 'A glowing red-hot crate with smouldering ember-light leaking from every seam, faint smoke rising, scorched dark stone beneath.' },
      { id: 'ascension', subject: 'A crate of polished dark obsidian stone with a single embedded violet crystal star centered on the lid, cold radiant violet light beaming softly outward.' }
    ]
  },

  // ─── RANKS (heraldic medallions for the all-up player level tiers) ─
  {
    id: 'ranks',
    dir: 'ranks',
    webpEdge: 384,
    style: 'Heraldic rank medallion, single circular metal disc embossed with a bold tier symbol centered, deep recessed embossing catching the light, dark stone backdrop with subtle vignette, hand-rendered fantasy crest style in the spirit of Dark Souls / Bloodborne menu art, square 1:1 framing, no text, no UI, no logos.',
    items: [
      { id: 'initiate',   subject: 'A worn dim-grey iron disc embossed with a simple bold kite-shield silhouette, faint torchlight catching the rim, the metal pitted and humble.' },
      { id: 'apprentice', subject: 'A polished dark bronze disc embossed with an ornate shield bearing a single cross brace, warm brown-orange gleam tracing the rim and embossed lines.' },
      { id: 'veteran',    subject: 'A burnished silver disc embossed with a regal three-pointed crown, cool moonlit gleam, slight age-tarnish at the edges, dignified.' },
      { id: 'champion',   subject: 'A polished gold disc embossed with a faceted gemstone-star, bright sunlit gleam, faint warm halo of light radiating outward from the embossing.' },
      { id: 'legend',     subject: 'A radiant platinum disc embossed with a brilliant-cut diamond shape, cold prismatic shimmer, faint icy-violet glow tracing the embossed lines.' },
      { id: 'mythic',     subject: 'A glowing dark obsidian disc embossed with a curling flame sigil, deep red-orange ember glow leaking from the embossed lines, faint smoke wisps drifting up.' }
    ]
  },

  // ─── LOBBY TILES (3rd peer to crate-tile + collection-tile) ─
  {
    id: 'lobby-tiles',
    dir: 'lobby',
    webpEdge: 1024,
    style: 'Painterly fantasy interior scene, dramatic close-up of a small forge-lit shop interior viewed from the customer side of the counter, dark stone walls and timber beams, hanging brass lanterns casting warm orange light, deep ember shadows in the corners, hand-rendered in the spirit of Dark Souls / Bloodborne menu art, slight vignette, no text, no UI, no logos, no people.',
    items: [
      { id: 'sparks-tile', subject: 'The interior of a small merchant\'s stall: a heavy weathered wooden counter in the foreground stacked with neat piles of glowing red-gold sparks-coins, an open ledger and a brass scale beside the coin stacks, behind the counter dusty shelves hold corked bottles of glowing potions, scrolls in cubbyholes, and iron-bound trinkets, a single brass lantern hanging from a beam casts warm forge-light across the scene, faint embers drifting in the air.' }
    ]
  },

  // ─── TITLES (heraldic wax seals — each title is an earned crest) ─
  {
    id: 'titles',
    dir: 'titles',
    webpEdge: 384,
    style: 'A heraldic wax seal pressed into a deep crimson disc, the embossed sigil prominently raised in the center of the wax, gold dust catching the rim, dark parchment backdrop with subtle vignette, hand-rendered fantasy crest style, square 1:1 framing, no text, no UI, no logos.',
    items: [
      { id: 'title_the_lucky',        subject: 'The embossed sigil is a four-leaf clover with a small die pip in the center.' },
      { id: 'title_the_brave',        subject: 'The embossed sigil is a stylized kite shield with a single bold cross brace.' },
      { id: 'title_crate_hunter',     subject: 'The embossed sigil is a small crossed-key over an open treasure chest.' },
      { id: 'title_shadow_walker',    subject: 'The embossed sigil is a half-mask with a single eye-slit, surrounded by faint smoke wisps.' },
      { id: 'title_loot_goblin',      subject: 'The embossed sigil is a coin-stuffed sack with three coins spilling from the top.' },
      { id: 'title_arena_champion',   subject: 'The embossed sigil is a laurel-wreathed trophy cup with two crossed swords behind it.' },
      { id: 'title_the_unstoppable',  subject: 'The embossed sigil is a roaring flame contained inside a circular ring, the flame breaking the ring at the top.' },
      { id: 'title_fortune_favored',  subject: 'The embossed sigil is a regal crown with a single radiant gemstone at its center, sun rays etched outward.' }
    ]
  }
];

// ── Load API key ──
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

function callGemini(apiKey, prompt) {
  return new Promise(function (resolve, reject) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey;
    var body = JSON.stringify({
      contents: [{ parts: [{ text: 'Generate a game asset image: ' + prompt }] }],
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

async function encodeWebp(srcPath, outPath, maxEdge) {
  await sharp(srcPath)
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toFile(outPath);
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  var apiKey = getApiKey();
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY not found.');
    process.exit(1);
  }

  // Parse CLI
  var args = process.argv.slice(2);
  var force = args.indexOf('--force') !== -1;
  var setIdx = args.indexOf('--set');
  var onlySet = setIdx !== -1 ? args[setIdx + 1] : null;
  var explicitTargets = args.filter(function (a) { return a.indexOf(':') !== -1; });

  // Build the work list as { setObj, item, outDir, pngPath, webpPath }
  var work = [];
  for (var s = 0; s < SETS.length; s++) {
    var set = SETS[s];
    if (onlySet && set.id !== onlySet) continue;

    var setOutDir = path.join(OUT_ROOT, set.dir);
    fs.mkdirSync(setOutDir, { recursive: true });

    for (var i = 0; i < set.items.length; i++) {
      var item = set.items[i];

      // If explicit targets given, skip unless this one matches
      if (explicitTargets.length > 0) {
        var targetKey = set.id + ':' + item.id;
        if (explicitTargets.indexOf(targetKey) === -1) continue;
      }

      var pngPath = path.join(setOutDir, item.id + '.png');
      var webpPath = path.join(setOutDir, item.id + '.webp');
      if (!force && explicitTargets.length === 0 && fs.existsSync(webpPath)) continue;
      work.push({ set: set, item: item, pngPath: pngPath, webpPath: webpPath });
    }
  }

  if (work.length === 0) {
    var total = SETS.reduce(function (n, s) { return n + s.items.length; }, 0);
    console.log('All ' + total + ' game icons already have WebP art. Nothing to do.');
    console.log('Pass --force to regenerate, --set <stats|classes|elements|crates> for one category, or set:item targets.');
    return;
  }

  console.log('Model: ' + MODEL);
  console.log('Output root: ' + OUT_ROOT);
  console.log('Generating ' + work.length + ' icons across ' + new Set(work.map(function (w) { return w.set.id; })).size + ' set(s).');
  console.log('');

  var success = 0, failed = 0;

  for (var w = 0; w < work.length; w++) {
    var job = work[w];
    var label = '[' + (w + 1) + '/' + work.length + '] ' + job.set.id + ':' + job.item.id;
    process.stdout.write(label.padEnd(48) + '... ');

    var attempts = 0;
    var done = false;
    while (attempts < MAX_RETRIES && !done) {
      attempts++;
      try {
        var prompt = job.set.style + ' ' + job.item.subject;
        var result = await callGemini(apiKey, prompt);
        fs.writeFileSync(job.pngPath, Buffer.from(result.base64, 'base64'));
        await encodeWebp(job.pngPath, job.webpPath, job.set.webpEdge);
        var pngKb = Math.round(fs.statSync(job.pngPath).size / 1024);
        var webpKb = Math.round(fs.statSync(job.webpPath).size / 1024);
        console.log('OK  png=' + pngKb + 'KB  webp=' + webpKb + 'KB');
        success++;
        done = true;
        if (w < work.length - 1) await sleep(PAUSE_MS);
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
}

main().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
