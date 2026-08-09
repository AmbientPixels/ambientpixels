#!/usr/bin/env node
/**
 * Generates vertical brand clips for Reels: Veo 3.1 background, brand text overlaid,
 * output at Instagram Reels spec.
 *
 *   node scripts/generate-brand-video.js            # first brief only (video costs real money)
 *   node scripts/generate-brand-video.js all        # every brief
 *   node scripts/generate-brand-video.js mechanism  # one by slug
 *
 * Standalone by design. Nothing here touches blob storage, the actions array or any
 * pipeline; it writes mp4s to disk for a human to look at before anything is posted.
 *
 * WHY NOT imageEngine: images are :generateContent, synchronous, base64 inline. Video is
 * :predictLongRunning — submit, poll an operation for ~1 minute, then download from a
 * signed URL. It does not fit that file's request/response shape.
 *
 * RESOLUTION: Veo defaults to 720x1280 on EVERY tier — lite and fast both measured at 720,
 * so paying for a higher tier buys no pixels. What actually unlocks Reels-native 1080x1920
 * is an undocumented `resolution: '1080p'` parameter, which works on the cheapest tier. The
 * model metadata endpoint lists no parameters at all, so the only way to find this was to
 * send it and see. Cheapest tier + native resolution + no upscaling.
 *
 * AUDIO: Veo attaches an effectively silent AAC track (measured: mean -63dB) even when the
 * prompt asks for none, so brand clips strip it with -an. CHARACTER clips are the exception:
 * they generate real speech and keep it.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const OUT = process.env.BRAND_VIDEO_OUT || 'c:/tmp/brand-video';
const WORK = path.join(OUT, 'work');

const MODEL = process.env.VEO_MODEL || 'veo-3.1-lite-generate-preview';
const DURATION = 8;
const W = 1080, H = 1920;

// ── Brand tokens (source of truth: scripts/generate-og-image.js) ──
const INK = '#0c0c0c', PAPER = '#f4f4f4', GOLD = '#d4a952';

// ── Reels safe zones at 1080x1920 ──
// Instagram overlays its own chrome: caption block and action buttons across the bottom,
// the action rail down the right, header at the top. Text outside these bounds gets
// covered by UI on a real phone even though it looks fine in a file preview.
const SAFE = { top: 260, bottom: 470, right: 190, left: 70 };

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const m = fs.readFileSync(path.join(REPO, '.env'), 'utf8').match(/GEMINI_API_KEY\s*=\s*(.+)/);
  if (!m) throw new Error('GEMINI_API_KEY not in env or ambientpixels/.env');
  return m[1].trim();
}

// ── Motion style. Deliberately NOT shared with imageEngine's ap-quiet-editorial string:
// the still preset says nothing about movement, and reusing it verbatim on the probe
// drifted warm — closer to gold-leaf-on-parchment than the matte near-black it asks for.
const STYLE =
  'Matte near-black canvas, deep preserved shadow across most of the frame. A single warm ' +
  'cream light source from the upper right with gentle falloff. Fine warm grain. ' +
  'Monochromatic warm-neutral palette of bone, cream, smoke and shadow with at most one ' +
  'small amber accent. Strictly dark overall: the frame should read as near-black with light ' +
  'in it, never as a bright or golden image. Editorial restraint, generous negative space, ' +
  'matte finish, no glass sheen, no glossy highlights.';

// A CHARACTER brief conditions Veo on an existing agent portrait as the first frame and
// keeps the generated speech, instead of producing an abstract background with text on it.
// The portrait is the same one on the Pixel Agents page, so the face people meet in the ad
// is the face on the product.
//
// Faces are banned in imageEngine's default prompt and allowed only under ap-arcane, which
// permits INVENTED characters. These portraits are exactly that: generated, not real people.
// That distinction is the whole reason this is OK, so do not point this at a photograph.
const CHARACTER_BRIEFS = [
  {
    slug: 'roast-character',
    image: 'pixel-agents/img/resume-roast.png',
    focusX: 0.55,   // she sits right of centre in the source; 0.5 crops her off-balance
    // 8 seconds is roughly 20-25 words of natural speech. Longer gets rushed or truncated.
    says: "Your resume says 'results-driven professional'. That means nothing. Paste it in. I'll tell you exactly what's wrong.",
    motion:
      'The woman in the image comes to life and speaks directly to camera. Subtle, natural performance: ' +
      'small head movements, one raised eyebrow, a knowing half-smile at the end. She stays seated in the ' +
      'same pose and the same room. Locked-off camera, no zoom, no cuts. Lighting and art style exactly ' +
      'match the source image.'
  }
];

const BRIEFS = [
  {
    slug: 'mechanism',
    hook: ['My AI agents', 'police each other', 'without asking me'],
    motion: 'A slow drift of fine luminous golden particles moving left to right across a dark field, ' +
            'dense at the left edge and dissolving into nothing toward the right.'
  },
  {
    slug: 'roast',
    hook: ['A free resume roast', 'that is not gentle'],
    motion: 'Sheets of pale paper stacked in deep shadow, one edge catching warm light, the stack ' +
            'shifting almost imperceptibly as if breathing. Extremely slow, almost static.'
  },
  {
    slug: 'pulse',
    hook: ['You can watch', 'the company run'],
    motion: 'A sparse field of faint points connected by thin lines drifting slowly in a dark volume, ' +
            'most of the frame empty, a few points pulsing gently in and out of visibility.'
  }
];

const GOAL =
  'Vertical 9:16 background for a short social video. Text will be overlaid across the upper ' +
  'and middle of the frame, so the centre must stay calm, dark and uncluttered with no bright ' +
  'hotspot and no focal subject there. Visual interest belongs at the edges and the lower third.';

// Character clips: the image carries the look, so the prompt only describes performance and
// the line. Restating style here fights the conditioning image and drifts the face.
function buildCharacterPrompt(b) {
  return [
    'Animate the provided image into a vertical 9:16 video clip.',
    '', 'ACTION: ' + b.motion,
    '', 'She says, clearly and at a natural conversational pace: "' + b.says + '"',
    '', 'REQUIREMENTS:',
    '- Keep her face, hair, glasses, clothing and the background IDENTICAL to the provided image.',
    '- Preserve the painted illustration style. Do not make it photorealistic.',
    '- Her voice is dry, confident and a little amused. Not angry, not perky, not a hard sell.',
    '- One continuous shot. No cuts, no camera movement, no zoom.',
    '- No music, no background score, no sound effects. Her voice only.',
    '- No text, captions, subtitles, logos or watermarks anywhere in frame.'
  ].join('\n');
}

function buildPrompt(b) {
  return [
    'Generate a high-quality vertical 9:16 video clip.',
    '', 'SUBJECT: ' + b.motion,
    '', 'VISUAL STYLE: ' + STYLE,
    '', 'PURPOSE: ' + GOAL,
    '', 'CAMERA: Locked off and completely still. No pans, no zooms, no cuts, no camera movement of any kind.',
    '', 'REQUIREMENTS:',
    '- No text, words, letters, numbers, logos or watermarks anywhere in frame.',
    '- No human faces, no people, no hands, no identifiable person.',
    '- No dialogue, no music, no voiceover, no sound effects.',
    '- Continuous and unhurried for the whole duration. Nothing enters or exits abruptly.'
  ].join('\n');
}

// ── HTTP ──
function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), data = JSON.stringify(body);
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    r.setTimeout(60000, () => { r.destroy(); reject(new Error('submit timeout')); });
    r.write(data); r.end();
  });
}
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); })
      .on('error', reject);
  });
}
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const go = (u, depth) => {
      if (depth > 5) return reject(new Error('too many redirects'));
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return go(res.headers.location, depth + 1); }
        if (res.statusCode !== 200) { let d = ''; res.on('data', c => d += c); return res.on('end', () => reject(new Error('download HTTP ' + res.statusCode + ': ' + d.slice(0, 200)))); }
        const f = fs.createWriteStream(dest);
        res.pipe(f); f.on('finish', () => f.close(() => resolve())); f.on('error', reject);
      }).on('error', reject);
    };
    go(url, 0);
  });
}

// Veo's response path has moved between revisions; walk it instead of hard-coding.
function findVideoUri(node, seen) {
  seen = seen || new Set();
  if (!node || typeof node !== 'object' || seen.has(node)) return null;
  seen.add(node);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (typeof v === 'string' && /^https?:\/\//.test(v) && /(video|\.mp4|files\/|download)/i.test(v)) return v;
    if (typeof v === 'object') { const hit = findVideoUri(v, seen); if (hit) return hit; }
  }
  return null;
}

/**
 * Square agent portraits have to become a 9:16 first frame before they can condition a
 * vertical clip.
 *
 * COVER-CROP, not pad. Padding a 1:1 portrait into 9:16 was tried first and Veo faithfully
 * animated the padding too: the subject sat in a band with ~44% of the Reel dead. Scaling to
 * fill the height and cropping the sides costs the outer edges of the frame (here, part of an
 * extended arm) and gains standard head-and-shoulders talking-head framing, which is what a
 * vertical video wants anyway.
 *
 * brief.focusX (0..1, default 0.5) shifts the crop window when the subject is off-centre.
 */
function buildFirstFrame(brief) {
  const src = path.isAbsolute(brief.image) ? brief.image : path.join(REPO, brief.image);
  if (!fs.existsSync(src)) throw new Error('portrait not found: ' + src);
  const dest = path.join(WORK, 'firstframe-' + brief.slug + '.png');
  const fx = Number.isFinite(brief.focusX) ? Math.min(1, Math.max(0, brief.focusX)) : 0.5;
  execFileSync('ffmpeg', ['-y', '-i', src,
    '-vf', `scale=-1:${H}:flags=lanczos,crop=${W}:${H}:(iw-${W})*${fx}:0`,
    '-frames:v', '1', dest], { stdio: ['ignore', 'ignore', 'pipe'] });
  return dest;
}

async function generateBackground(brief, key) {
  const dest = path.join(WORK, 'bg-' + brief.slug + '.mp4');
  if (fs.existsSync(dest)) { console.log('  source clip cached, skipping generation'); return dest; }

  const isCharacter = !!brief.image;
  const instance = { prompt: isCharacter ? buildCharacterPrompt(brief) : buildPrompt(brief) };
  if (isCharacter) {
    const ff = buildFirstFrame(brief);
    instance.image = { bytesBase64Encoded: fs.readFileSync(ff).toString('base64'), mimeType: 'image/png' };
    console.log('  conditioning on ' + path.basename(ff));
  }

  const sub = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predictLongRunning?key=${key}`,
    { instances: [instance], parameters: { aspectRatio: '9:16', durationSeconds: DURATION, resolution: '1080p' } });
  if (sub.status !== 200) throw new Error('submit HTTP ' + sub.status + ': ' + sub.body.slice(0, 400));

  const op = JSON.parse(sub.body).name;
  const started = Date.now();
  let done = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const p = await get(`https://generativelanguage.googleapis.com/v1beta/${op}?key=${key}`);
    if (p.status !== 200) continue;
    const j = JSON.parse(p.body);
    if (j.done) { done = j; break; }
    process.stdout.write('  polling ' + Math.round((Date.now() - started) / 1000) + 's\r');
  }
  if (!done) throw new Error('operation never completed');
  if (done.error) throw new Error('operation error: ' + JSON.stringify(done.error).slice(0, 300));

  const uri = findVideoUri(done.response);
  if (!uri) {
    fs.writeFileSync(path.join(WORK, 'veo-response-' + brief.slug + '.json'), JSON.stringify(done, null, 2));
    throw new Error('no video URI in response; full body dumped to work/');
  }
  await download(uri + (uri.includes('?') ? '&' : '?') + 'key=' + key, dest);
  console.log('  generated ' + (fs.statSync(dest).size / 1048576).toFixed(2) + ' MB in ' + Math.round((Date.now() - started) / 1000) + 's');
  return dest;
}

// ── Overlay, rendered at full 1080x1920 so text is native-resolution ──
function overlayHtml(brief) {
  const lines = brief.hook.map((l, i) =>
    `<div class="line"${i === brief.hook.length - 1 ? ' style="color:' + GOLD + '"' : ''}>${l}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap"/>
<style>
  html,body{margin:0;padding:0;width:${W}px;height:${H}px;background:transparent;overflow:hidden;
    font-family:'Archivo Black',sans-serif;-webkit-font-smoothing:antialiased;}
  .stage{position:relative;width:${W}px;height:${H}px;}
  /* Legibility floor: the background is generative and its brightness is not guaranteed
     frame to frame, so the type sits on its own gradient rather than trusting the video. */
  .scrim{position:absolute;left:0;right:0;top:0;height:1150px;
    background:linear-gradient(to bottom, rgba(12,12,12,0.86) 0%, rgba(12,12,12,0.72) 45%, rgba(12,12,12,0) 100%);}
  .hook{position:absolute;left:${SAFE.left}px;right:${SAFE.right}px;top:${SAFE.top + 300}px;}
  /* nowrap is load-bearing: each entry in brief.hook is a DELIBERATE line. Allowing the
     browser to re-wrap turned a 3-line hook into 5 visual lines with "other" and "me"
     stranded alone. fitHook() below shrinks the type until the author's breaks fit. */
  .line{color:${PAPER};font-size:96px;line-height:1.06;letter-spacing:-0.035em;
    white-space:nowrap;text-shadow:0 4px 44px rgba(0,0,0,0.85);margin-bottom:10px;}
  .lockup{position:absolute;left:${SAFE.left}px;bottom:${SAFE.bottom + 60}px;
    display:flex;align-items:center;gap:16px;}
  .grid{width:40px;height:40px;flex-shrink:0;}
  .wordmark{color:${PAPER};font-size:38px;letter-spacing:-0.03em;
    text-shadow:0 2px 24px rgba(0,0,0,0.85);}
</style></head><body>
  <div class="stage">
    <div class="scrim"></div>
    <div class="hook">${lines}</div>
    <div class="lockup">
      <svg class="grid" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><g fill="${PAPER}">
        <circle cx="2" cy="2" r="1.25" opacity="0.18"/><circle cx="10" cy="2" r="1.25" opacity="0.5"/>
        <circle cx="18" cy="2" r="1.25" opacity="0.18"/><circle cx="2" cy="10" r="1.25" opacity="0.5"/>
        <circle cx="10" cy="10" r="2"/><circle cx="18" cy="10" r="1.25" opacity="0.5"/>
        <circle cx="2" cy="18" r="1.25" opacity="0.18"/><circle cx="10" cy="18" r="1.25" opacity="0.5"/>
        <circle cx="18" cy="18" r="1.25" opacity="0.18"/></g></svg>
      <div class="wordmark">AmbientPixels.</div>
    </div>
  </div>
</body></html>`;
}

async function renderOverlay(brief, page) {
  const dest = path.join(WORK, 'overlay-' + brief.slug + '.png');
  await page.setViewportSize({ width: W, height: H });
  await page.setContent(overlayHtml(brief), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  // Shrink the hook until the author's line breaks fit on one line each. A long hook gets
  // smaller type rather than silently re-wrapped into lines nobody chose.
  const fitted = await page.evaluate(() => {
    const hook = document.querySelector('.hook');
    const lines = Array.from(document.querySelectorAll('.line'));
    if (!lines.length) return null;
    const max = hook.clientWidth;
    let size = 96;
    const overflows = () => lines.some(l => l.scrollWidth > max);
    while (size > 40 && overflows()) {
      size -= 2;
      lines.forEach(l => { l.style.fontSize = size + 'px'; });
    }
    return { size, widest: Math.max(...lines.map(l => l.scrollWidth)), max, fits: !overflows() };
  });
  if (fitted) {
    console.log(`  hook fitted at ${fitted.size}px (widest line ${fitted.widest}px / ${fitted.max}px available)` +
      (fitted.fits ? '' : ' — STILL OVERFLOWS at floor size, shorten the hook'));
  }

  await page.screenshot({ path: dest, omitBackground: true });  // alpha, so the video shows through
  return dest;
}

/**
 * @param {string|null} overlay  null for character clips — a talking head does not want a
 *                               wordmark parked over its face, and Instagram burns its own
 *                               captions in anyway.
 * @param {boolean} keepAudio    true for character clips (that's the speech) and false for
 *                               brand clips (that's Veo's silent placeholder track).
 */
function composite(bg, overlay, dest, keepAudio) {
  const args = ['-y', '-i', bg];
  if (overlay) args.push('-i', overlay);

  // The scale is an identity op now that we request 1080p, and stays as a safety net in
  // case a future model revision ignores the parameter and drops back to 720.
  if (overlay) {
    args.push('-filter_complex', `[0:v]scale=${W}:${H}:flags=lanczos,setsar=1[v0];[v0][1:v]overlay=0:0:format=auto[v]`, '-map', '[v]');
  } else {
    args.push('-vf', `scale=${W}:${H}:flags=lanczos,setsar=1`);
  }

  if (keepAudio) {
    // With an overlay we map [v] explicitly, so audio needs its own map. With -vf, ffmpeg's
    // default stream selection already picks up the audio track.
    if (overlay) args.push('-map', '0:a?');
    args.push('-c:a', 'aac', '-b:a', '160k');
  } else {
    args.push('-an');
  }

  args.push('-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-preset', 'slow', '-crf', '19', '-r', '30',
    '-movflags', '+faststart',   // metadata first, so it starts playing before it finishes loading
    dest);
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,duration', '-show_entries', 'format=size',
    '-of', 'default=noprint_wrappers=1:nokey=0', file]).toString();
  const o = {}; out.trim().split(/\r?\n/).forEach(l => { const [k, v] = l.split('='); o[k] = v; });
  const audio = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).toString().trim();
  return { ...o, audioStreams: audio ? audio.split(/\r?\n/).length : 0 };
}

(async () => {
  const ALL = BRIEFS.concat(CHARACTER_BRIEFS);
  const arg = (process.argv[2] || '').toLowerCase();
  const targets = !arg ? [ALL[0]] : arg === 'all' ? ALL : ALL.filter(b => b.slug === arg);
  if (!targets.length) { console.error('Unknown brief: ' + arg + '. Valid: ' + ALL.map(b => b.slug).join(', ') + ', all'); process.exit(1); }

  fs.mkdirSync(WORK, { recursive: true });
  const key = apiKey();
  const { chromium } = require(require.resolve('playwright', { paths: [REPO] }));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();

  console.log(`model ${MODEL} | ${targets.length} clip(s) | out ${OUT}\n`);
  const results = [];
  for (const b of targets) {
    console.log(b.slug);
    try {
      const isCharacter = !!b.image;
      const bg = await generateBackground(b, key);
      const ov = isCharacter ? null : await renderOverlay(b, page);
      const dest = path.join(OUT, 'reel-' + b.slug + '.mp4');
      composite(bg, ov, dest, isCharacter);
      const p = probe(dest);
      console.log(`  -> ${path.basename(dest)}  ${p.width}x${p.height} ${p.duration}s ${(p.size / 1048576).toFixed(2)}MB audio=${p.audioStreams}`);
      if (isCharacter && p.audioStreams === 0) console.log('  WARNING: character clip has no audio track — she is not speaking');
      results.push({ slug: b.slug, ok: true, file: dest, probe: p });
    } catch (e) {
      console.log('  FAILED: ' + e.message);
      results.push({ slug: b.slug, ok: false, error: e.message });
    }
  }
  await browser.close();

  const ok = results.filter(r => r.ok).length;
  console.log(`\n${ok}/${results.length} clip(s) written to ${OUT}`);
  if (ok !== results.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
