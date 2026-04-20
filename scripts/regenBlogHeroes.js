#!/usr/bin/env node
// regenBlogHeroes.js — ONE-TIME backfill
//
// Regenerates hero images for all published blog posts under the new
// `ap-quiet-editorial` preset and repoints each post's hero_image_asset_id
// at the new asset. The old assets remain in imageAssets with
// status: 'replaced' for rollback.
//
// USAGE:
//   MSYS_NO_PATHCONV=1 node scripts/regenBlogHeroes.js --preview
//   MSYS_NO_PATHCONV=1 node scripts/regenBlogHeroes.js --run
//
// --preview  Generates a hero for the OLDEST post only, prints URL + meta,
//            and exits. No state is mutated. Use this to eyeball the style
//            before committing to the full batch.
// --run      Generates heroes for ALL posts, writes imageAssets + blogPosts
//            back to company-state in one pass. Prompts for yes/no first.
//
// REQUIREMENTS:
//   - AP_SECRET env var (defaults to 'pixelpusher')
//   - GEMINI_API_KEY env var (image engine calls Google AI Studio)
//   - AZURE_STORAGE_CONNECTION_STRING env var (image engine uploads to blob)
//
// The script imports the live image engine library directly, so it uses
// the same Gemini model, blob container, and validation as the API.

const https = require('https');
const readline = require('readline');
const path = require('path');

const API_BASE = process.env.AP_API_BASE || 'https://ambientpixels-nova-api.azurewebsites.net';
const SECRET = process.env.AP_SECRET || 'pixelpusher';
const PRESET = 'ap-quiet-editorial';
const OUTPUT_TYPE = 'hero_image';
const MODE_PREVIEW = process.argv.indexOf('--preview') !== -1;
const MODE_RUN = process.argv.indexOf('--run') !== -1;

if (!MODE_PREVIEW && !MODE_RUN) {
  console.error('Usage: node scripts/regenBlogHeroes.js --preview | --run');
  process.exit(2);
}
if (MODE_PREVIEW && MODE_RUN) {
  console.error('Pick one: --preview or --run (not both).');
  process.exit(2);
}

// GEMINI_API_KEY is always required (preview + run call Gemini).
// AZURE_STORAGE_CONNECTION_STRING is only required for --run (the blob upload).
if (!process.env.GEMINI_API_KEY) {
  // Fall back to api/local.settings.json — same pattern as generate-agent-portraits.js
  try {
    const settings = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'api', 'local.settings.json'), 'utf8'));
    if (settings.Values && settings.Values.GEMINI_API_KEY) process.env.GEMINI_API_KEY = settings.Values.GEMINI_API_KEY;
    if (settings.Values && settings.Values.AZURE_STORAGE_CONNECTION_STRING && !process.env.AZURE_STORAGE_CONNECTION_STRING) {
      process.env.AZURE_STORAGE_CONNECTION_STRING = settings.Values.AZURE_STORAGE_CONNECTION_STRING;
    }
  } catch (e) { /* file not present — user will get error below */ }
}
if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set. Set it in env or api/local.settings.json.');
  process.exit(2);
}
if (MODE_RUN && !process.env.AZURE_STORAGE_CONNECTION_STRING) {
  console.error('AZURE_STORAGE_CONNECTION_STRING not set. --run needs it to upload new assets to blob storage.');
  console.error('(--preview does NOT need this — it writes a local PNG instead.)');
  process.exit(2);
}

const fs = require('fs');
const imageEngine = require(path.join(__dirname, '..', 'api', '_lib', 'contentEngine', 'imageEngine'));

// ── HTTP helpers (company-state) ──

function apiGet(key) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + '/api/company-state?key=' + encodeURIComponent(key));
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'x-company-secret': SECRET }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('GET ' + key + ' HTTP ' + res.statusCode + ': ' + d.slice(0, 300)));
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('parse error on ' + key + ': ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function apiPost(key, value) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + '/api/company-state');
    const body = JSON.stringify({ key: key, value: value });
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-company-secret': SECRET
      }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('POST ' + key + ' HTTP ' + res.statusCode + ': ' + d.slice(0, 300)));
        resolve({ status: res.statusCode, body: d });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans); });
  });
}

// Derive a prompt "goal" from a post. The stored `excerpt` on these legacy
// posts is often publish-pipeline metadata soup ("create-doc kind: ...
// content_md: | ..."), so detect that shape and fall through to content_md
// which has the clean source. Keep underscores — they're in real words.
function deriveGoal(post) {
  const rawExcerpt = (post.excerpt || '').trim();
  const isGarbageExcerpt =
    /^`{0,3}\s*create-doc\b/i.test(rawExcerpt) ||
    /^\w+\s*:\s*\w+[\s\S]{0,40}\bcontent_?md\s*:/i.test(rawExcerpt);
  if (rawExcerpt.length >= 10 && !isGarbageExcerpt) return rawExcerpt;

  let md = post.content_md || '';

  // Strip fenced publish-pipeline wrapper: ```create-doc ... content_md: | ...
  md = md.replace(/^`{0,3}\s*create-doc[\s\S]*?content_md\s*:\s*\|?\s*\n?/i, '');
  // Strip trailing code fence if present
  md = md.replace(/```\s*$/, '');

  md = md
    .replace(/^---[\s\S]*?---\s*/m, '')            // YAML frontmatter block
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')          // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')       // links → keep anchor text
    .replace(/^#{1,6}\s+/gm, '')                   // heading hashes
    .replace(/[*>`]/g, '')                         // emphasis / blockquote / code marks
    .replace(/\s+/g, ' ')
    .trim();

  // Drop the title if it's duplicated at the start of the body.
  if (post.title && md.toLowerCase().startsWith(post.title.toLowerCase())) {
    md = md.slice(post.title.length).trim();
  }

  if (md.length === 0) return 'Hero image for blog post: ' + (post.title || 'untitled');
  return md.slice(0, 280);
}

function newAssetId() {
  return 'img_' + Date.now() + '_' + Math.random().toString(16).slice(2, 8);
}

// ── Main ──

(async () => {
  console.log('[regen] mode:', MODE_PREVIEW ? 'PREVIEW' : 'RUN');
  console.log('[regen] API:', API_BASE);
  console.log('[regen] preset:', PRESET, '| outputType:', OUTPUT_TYPE);

  // 1. Load posts + assets (company-state returns { key, value } envelope)
  const postsWrap = await apiGet('blogPosts');
  const assetsWrap = await apiGet('imageAssets');
  const posts = (postsWrap && postsWrap.value) || (Array.isArray(postsWrap) ? postsWrap : []);
  const assets = (assetsWrap && assetsWrap.value) || (Array.isArray(assetsWrap) ? assetsWrap : []);
  const assetById = {};
  for (const a of assets) assetById[a.id] = a;

  const withHero = posts.filter(p => !!p.hero_image_asset_id);
  console.log('[regen] blogPosts total:', posts.length, '| with hero_image_asset_id:', withHero.length);

  if (withHero.length === 0) {
    console.log('[regen] nothing to do.');
    return;
  }

  // Sort oldest → newest so preview picks the hardest stress test.
  withHero.sort((a, b) => {
    const ta = a.published_at ? Date.parse(a.published_at) : 0;
    const tb = b.published_at ? Date.parse(b.published_at) : 0;
    return ta - tb;
  });

  // ── PREVIEW MODE ──
  // Local-only: uses the same buildPrompt + callImageGeneration that prod uses,
  // but skips the blob upload and writes the PNG straight to disk so the user
  // can eyeball the preset without needing Azure creds or mutating state.
  if (MODE_PREVIEW) {
    const target = withHero[0];
    const currentPreset = (assetById[target.hero_image_asset_id] || {}).preset || 'unknown';
    console.log('\n[preview] target post:');
    console.log('  title:       ', target.title);
    console.log('  id:          ', target.id);
    console.log('  published_at:', target.published_at || 'n/a');
    console.log('  current preset on hero:', currentPreset);

    const topic = target.title || 'AmbientPixels blog post';
    const goal = deriveGoal(target);
    console.log('\n[preview] generating with:');
    console.log('  preset:     ', PRESET);
    console.log('  outputType: ', OUTPUT_TYPE);
    console.log('  topic:      ', topic);
    console.log('  goal:       ', goal.slice(0, 120) + (goal.length > 120 ? '...' : ''));

    // Build the exact same prompt that prod would send, then call Gemini directly
    // (bypassing the blob upload inside generateImage()).
    const prompt = imageEngine.buildPrompt({
      topic, goal, preset: PRESET, outputType: OUTPUT_TYPE
    });

    const t0 = Date.now();
    const result = await imageEngine.callImageGeneration(prompt);
    const ms = Date.now() - t0;

    const buf = Buffer.from(result.base64, 'base64');
    const ext = result.mimeType === 'image/jpeg' ? '.jpg' : '.png';
    const slug = (topic || 'preview').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '');
    const outDir = path.join(__dirname, '..', '..', 'tmp');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, PRESET + '-preview-' + slug + '-' + Date.now() + ext);
    fs.writeFileSync(outPath, buf);

    console.log('\n[preview] done in', ms, 'ms:');
    console.log('  file:  ', outPath);
    console.log('  bytes: ', buf.length);
    console.log('  mime:  ', result.mimeType);
    console.log('\n[preview] NO state was mutated, NO blob was written. Open the file above to review.');
    console.log('[preview] Prompt used:\n---');
    console.log(prompt);
    console.log('---');
    console.log('\n[preview] If it looks right, re-run with --run to process all', withHero.length, 'posts.');
    return;
  }

  // ── RUN MODE ──
  console.log('\n[run] about to regenerate', withHero.length, 'hero images and swap their references.');
  console.log('[run] old assets will be marked status="replaced" (not deleted).');
  const ans = await prompt('[run] proceed? type "yes" to continue: ');
  if ((ans || '').trim().toLowerCase() !== 'yes') {
    console.log('[run] aborted.');
    return;
  }

  const results = [];
  const failures = [];

  for (let i = 0; i < withHero.length; i++) {
    const post = withHero[i];
    const oldAssetId = post.hero_image_asset_id;
    const oldAsset = assetById[oldAssetId];
    const topic = post.title || 'AmbientPixels blog post';
    const goal = deriveGoal(post);

    console.log('\n[run] [' + (i + 1) + '/' + withHero.length + '] "' + topic + '"');
    try {
      const t0 = Date.now();
      const result = await imageEngine.generateImage({
        topic, goal, preset: PRESET, outputType: OUTPUT_TYPE
      });
      const ms = Date.now() - t0;

      const newId = newAssetId();
      const nowIso = new Date().toISOString();
      const newAsset = {
        id: newId,
        url: result.imageUrl,
        thumbUrl: result.thumbUrl,
        metaUrl: result.metaUrl,
        purpose: OUTPUT_TYPE,
        outputType: OUTPUT_TYPE,
        preset: PRESET,
        aspect: '3:2',
        alt: topic,
        model: result.model,
        bytes: result.bytes,
        size: result.size,
        attachedTo: { type: 'blog_post', id: post.id, field: 'hero_image_asset_id' },
        createdBy: 'script:regenBlogHeroes',
        createdAt: nowIso,
        durationMs: ms,
        status: 'active',
        replaces: oldAssetId
      };

      assets.push(newAsset);

      if (oldAsset) {
        oldAsset.status = 'replaced';
        oldAsset.replacedAt = nowIso;
        oldAsset.replacedBy = newId;
      }

      // Mutate the post in place inside the posts array (not just withHero).
      const idx = posts.findIndex(p => p.id === post.id);
      if (idx !== -1) posts[idx].hero_image_asset_id = newId;

      results.push({ postId: post.id, title: post.title, oldAssetId, newAssetId: newId, url: result.imageUrl });
      console.log('  ✓ new asset', newId, '(' + ms + 'ms):', result.imageUrl);
    } catch (err) {
      failures.push({ postId: post.id, title: post.title, error: err.message });
      console.error('  ✗ FAILED:', err.message);
    }
  }

  // Cap imageAssets at 500 entries, matching agent-runner convention.
  const CAP = 500;
  let trimmedAssets = assets;
  if (assets.length > CAP) {
    trimmedAssets = assets.slice(-CAP);
    console.log('\n[run] imageAssets capped from', assets.length, '→', CAP);
  }

  if (results.length > 0) {
    console.log('\n[run] writing imageAssets (' + trimmedAssets.length + ' entries)...');
    await apiPost('imageAssets', trimmedAssets);
    console.log('[run] writing blogPosts (' + posts.length + ' entries)...');
    await apiPost('blogPosts', posts);
  } else {
    console.log('\n[run] no successful generations — skipping writes.');
  }

  // Summary
  console.log('\n[run] ── SUMMARY ──');
  console.log('  succeeded:', results.length);
  console.log('  skipped:  ', failures.length);
  if (results.length > 0) {
    console.log('\n[run] rollback map (postId → oldAssetId → newAssetId):');
    for (const r of results) {
      console.log('  ' + r.postId + '  ' + r.oldAssetId + '  →  ' + r.newAssetId);
    }
  }
  if (failures.length > 0) {
    console.log('\n[run] failures:');
    for (const f of failures) {
      console.log('  ' + f.postId + ' "' + f.title + '" — ' + f.error);
    }
    console.log('\n[run] re-run --run to retry failed posts (succeeded posts will regenerate again, so prefer fixing root cause first).');
  }
})().catch(err => {
  console.error('[regen] FATAL:', err.message);
  process.exit(1);
});
