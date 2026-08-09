// videoEngine.js — Content Engine Video Generation Library (Veo 3.1 via Google AI Studio)
//
// A SIBLING of imageEngine, not an outputType inside it. Images are :generateContent —
// synchronous, inline base64. Video is :predictLongRunning — submit, poll an operation for
// 40-100s, then download from a signed URL. That shape does not fit imageEngine's
// request/response model, and forcing it in would compromise both.
//
// SCOPE: character clips only. The Function App has NO ffmpeg and NO Playwright
// (api/package.json: satori, resvg, sharp — image tools), so anything requiring video
// compositing cannot run here. Character clips need none: Veo returns a finished mp4 with
// speech. Text-overlaid brand clips stay in scripts/generate-brand-video.js on a workstation.
//
// COST: video is dollars per clip, not the cents images cost. Every entry point below
// enforces a hard daily cap BEFORE submitting, and mirrors spend into geminiUsage so Cipher
// and the Cost Center can see it. Callers must additionally gate on CEO approval — this
// library will happily spend money if you ask it to.
//
// Env: GEMINI_API_KEY, VEO_MODEL, VIDEO_COST_ESTIMATE_PER_CLIP, VIDEO_MAX_PER_DAY,
//      AZURE_STORAGE_CONNECTION_STRING

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prefixBlobKey } = require('../../_utils/demoGuard');

const ENGINE_VERSION = '1.0.0';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const VEO_MODEL = process.env.VEO_MODEL || 'veo-3.1-lite-generate-preview';

// UNVERIFIED. Google's published Veo pricing has not been confirmed against a real invoice
// for this account, so this deliberately errs HIGH: an overestimate throttles early, an
// underestimate finds out via the bill. Correct it once AI Studio billing shows a real
// number, the same way IMAGE_COST_PER_IMAGE was corrected from 0.01 to 0.039.
const VIDEO_COST_PER_CLIP = parseFloat(process.env.VIDEO_COST_ESTIMATE_PER_CLIP) || 1.20;

// Hard ceiling, CEO-set 2026-08-09. Enforced BEFORE submit — a cap checked after the money
// is spent is not a cap.
const MAX_CLIPS_PER_DAY = parseInt(process.env.VIDEO_MAX_PER_DAY, 10) || 2;

const DURATION_SECONDS = 8;
const ASPECT = '9:16';
// Undocumented, and the only way to get Reels-native output: every tier returns 720x1280
// without it. See docs/superpowers/specs/2026-08-09-video-pipeline.md.
const RESOLUTION = '1080p';

const VIDEOS_CONTAINER = process.env.GENERATED_VIDEOS_CONTAINER || 'generated-videos';
const STATE_CONTAINER = 'company-state';

// Submit-plus-poll must finish inside the Azure 230s HTTP ceiling with room to spare for
// download and upload. Measured generation: 42-96s.
const POLL_INTERVAL_MS = 10000;
const MAX_POLL_MS = 165000;

// ── Conditioning images ──
//
// SECURITY: only files already in the repo under this directory may condition a clip.
// Never accept a caller-supplied URL or an arbitrary path — that is an SSRF vector and,
// worse, the route by which a photograph of a real person could end up animated and
// speaking words they never said. The agent portraits are INVENTED characters from the
// ap-arcane preset, and that is the entire basis on which animating a face is acceptable.
const PORTRAIT_DIR = path.resolve(__dirname, '..', '..', '..', 'pixel-agents', 'img');

function resolvePortrait(agentImageName) {
  const safe = String(agentImageName || '').trim();
  // Basename only. No traversal, no absolute paths, no URLs.
  if (!safe || !/^[a-z0-9][a-z0-9-]*\.(png|webp|jpg|jpeg)$/i.test(safe)) {
    throw new Error('Invalid portrait name: ' + safe + ' (expected a bare filename in pixel-agents/img)');
  }
  const full = path.join(PORTRAIT_DIR, safe);
  if (path.dirname(full) !== PORTRAIT_DIR) throw new Error('Portrait path escapes the portrait directory');
  if (!fs.existsSync(full)) throw new Error('Portrait not found: ' + safe);
  return full;
}

// ── Prompt ──
//
// Describes performance and dialogue only. Restating visual style fights the conditioning
// image and drifts the face away from the one on the product page.
function buildVideoPrompt(opts) {
  const says = String(opts.says || '').trim();
  if (!says) throw new Error('says is required — a character clip with no line is just a portrait');
  // ~20-25 words is what fits 8s of natural speech; beyond that Veo rushes or truncates.
  const words = says.split(/\s+/).length;
  if (words > 30) throw new Error('says is ' + words + ' words; 8 seconds holds about 25. Shorten it.');

  return [
    'Animate the provided image into a vertical 9:16 video clip.',
    '',
    'ACTION: ' + (opts.motion ||
      'The character in the image comes to life and speaks directly to camera. Subtle, natural ' +
      'performance: small head movements, natural blinks, a slight change of expression on the ' +
      'final line. They stay in the same pose, in the same room. Locked-off camera, no zoom, no cuts.'),
    '',
    'They say, clearly and at a natural conversational pace: "' + says + '"',
    '',
    'REQUIREMENTS:',
    '- Keep the face, hair, clothing and background IDENTICAL to the provided image.',
    '- Preserve the painted illustration style. Do not make it photorealistic.',
    '- ' + (opts.tone || 'Delivery is dry, confident and a little amused. Not angry, not perky, not a hard sell.'),
    '- One continuous shot. No cuts, no camera movement, no zoom.',
    '- No music, no background score, no sound effects. Voice only.',
    '- No text, captions, subtitles, logos or watermarks anywhere in frame.'
  ].join('\n');
}

// ── Blob ──
let _blobServiceClient = null;
function _getBlobServiceClient() {
  if (_blobServiceClient) return _blobServiceClient;
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) return null;
  _blobServiceClient = require('@azure/storage-blob').BlobServiceClient.fromConnectionString(connStr);
  return _blobServiceClient;
}

const _containerReady = {};
async function _ensureContainer(name) {
  const client = _getBlobServiceClient();
  if (!client) throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
  const container = client.getContainerClient(name);
  if (!_containerReady[name]) {
    await container.createIfNotExists({ access: 'blob' });
    try { await container.setAccessPolicy('blob'); } catch (e) { /* already set */ }
    _containerReady[name] = true;
  }
  return container;
}

async function _uploadBlob(containerName, blobPath, buffer, contentType) {
  const container = await _ensureContainer(containerName);
  const blob = container.getBlockBlobClient(prefixBlobKey(blobPath));
  await blob.upload(buffer, buffer.length, { blobHTTPHeaders: { blobContentType: contentType }, overwrite: true });
  return blob.url;
}

// ── HTTP ──
function _postJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch (e) {}
        if (res.statusCode !== 200) return reject(new Error('Veo HTTP ' + res.statusCode + ': ' + ((j && j.error && j.error.message) || d.slice(0, 300))));
        resolve(j || {});
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Veo submit timed out')); });
    req.write(data); req.end();
  });
}

function _getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('Veo poll returned non-JSON')); } });
    }).on('error', reject);
  });
}

function _downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const go = (u, depth) => {
      if (depth > 5) return reject(new Error('too many redirects'));
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return go(res.headers.location, depth + 1); }
        if (res.statusCode !== 200) return reject(new Error('video download HTTP ' + res.statusCode));
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    };
    go(url, 0);
  });
}

/**
 * The generated-video URI has moved between Veo revisions. Walk the response for the first
 * https URL that looks like a video rather than hard-coding a path that may not exist.
 */
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

// ── Daily cap ──
/**
 * Counts clips generated today from the usage ledger. Returns {allowed, used, remaining}.
 *
 * FAILS CLOSED. imageEngine's equivalent fails open, which is right when the downstream
 * cost is $0.039 and wrong when it is dollars: if we cannot prove how much has been spent
 * today, we do not spend more.
 */
async function checkDailyCap() {
  try {
    const storage = require('../../_utils/companyStorage');
    const usage = (await storage.getState('geminiUsage')) || [];
    const rows = Array.isArray(usage) ? usage : (usage.entries || []);
    const today = new Date().toISOString().slice(0, 10);
    const used = rows.filter(r => r && typeof r.caller === 'string'
      && r.caller.indexOf('video-engine') === 0
      && String(r.timestamp || '').slice(0, 10) === today).length;
    return { allowed: used < MAX_CLIPS_PER_DAY, used, remaining: Math.max(0, MAX_CLIPS_PER_DAY - used), cap: MAX_CLIPS_PER_DAY };
  } catch (err) {
    return { allowed: false, used: null, remaining: 0, cap: MAX_CLIPS_PER_DAY,
      reason: 'Could not read the usage ledger to verify the daily cap — refusing to spend. (' + err.message + ')' };
  }
}

async function logSpend(record) {
  try {
    const storage = require('../../_utils/companyStorage');
    await storage.logGeminiUsage({
      caller: 'video-engine:' + (record.source || 'unknown'),
      model: VEO_MODEL,
      agentId: record.agentId || null,
      flatCost: Number(record.estimatedCost) || VIDEO_COST_PER_CLIP,
      timestamp: record.timestamp || new Date().toISOString()
    });
  } catch (err) {
    // Loud: an unlogged clip is an invisible dollar AND a hole in tomorrow's cap.
    console.error('[VideoEngine] SPEND NOT LOGGED — cap accounting is now short by one clip:', err.message);
  }
}

// ── Main ──
/**
 * Generate one character clip end to end: submit, poll, download, upload, log.
 *
 * @param {Object} opts - { portrait, says, motion?, tone?, agentId?, source?, jobId? }
 * @returns {Promise<{videoUrl, jobId, model, durationMs, bytes, estimatedCost}>}
 */
async function generateCharacterClip(opts) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const cap = await checkDailyCap();
  if (!cap.allowed) {
    throw new Error('Daily video cap reached (' + cap.used + '/' + cap.cap + ')' + (cap.reason ? ' — ' + cap.reason : '') +
      '. This is a hard stop, not a rate limit: raise VIDEO_MAX_PER_DAY deliberately if you mean it.');
  }

  const portraitPath = resolvePortrait(opts.portrait);
  const prompt = buildVideoPrompt(opts);
  const jobId = opts.jobId || ('vid-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  const started = Date.now();

  console.log('[VideoEngine] submit job=' + jobId + ' model=' + VEO_MODEL + ' portrait=' + opts.portrait +
    ' (cap ' + cap.used + '/' + cap.cap + ')');

  const sub = await _postJson(
    'https://generativelanguage.googleapis.com/v1beta/models/' + VEO_MODEL + ':predictLongRunning?key=' + GEMINI_API_KEY,
    {
      instances: [{
        prompt: prompt,
        image: { bytesBase64Encoded: fs.readFileSync(portraitPath).toString('base64'), mimeType: 'image/png' }
      }],
      parameters: { aspectRatio: ASPECT, durationSeconds: DURATION_SECONDS, resolution: RESOLUTION }
    });

  const operation = sub.name;
  if (!operation) throw new Error('Veo submit returned no operation name');
  // Money is committed the moment the operation exists. Log the spend NOW, before polling,
  // so a timeout or crash below cannot produce an unbilled clip that the cap never sees.
  await logSpend({ source: opts.source || 'unknown', agentId: opts.agentId, estimatedCost: VIDEO_COST_PER_CLIP });

  let done = null;
  while (Date.now() - started < MAX_POLL_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const j = await _getJson('https://generativelanguage.googleapis.com/v1beta/' + operation + '?key=' + GEMINI_API_KEY);
    if (j && j.done) { done = j; break; }
  }
  if (!done) {
    // The clip may still finish server-side; the operation name is the only way to recover it.
    throw new Error('Veo did not finish within ' + Math.round(MAX_POLL_MS / 1000) + 's. Spend already counted. Operation: ' + operation);
  }
  if (done.error) throw new Error('Veo operation failed: ' + JSON.stringify(done.error).slice(0, 300));

  const uri = findVideoUri(done.response);
  if (!uri) throw new Error('No video URI in Veo response for operation ' + operation);

  const buf = await _downloadBuffer(uri + (uri.includes('?') ? '&' : '?') + 'key=' + GEMINI_API_KEY);
  const now = new Date();
  const basePath = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + jobId;
  const videoUrl = await _uploadBlob(VIDEOS_CONTAINER, basePath + '_character_1080x1920.mp4', buf, 'video/mp4');

  const meta = {
    jobId, kind: 'character', portrait: opts.portrait, says: opts.says,
    model: VEO_MODEL, engineVersion: ENGINE_VERSION,
    resolution: '1080x1920', durationSeconds: DURATION_SECONDS, hasAudio: true,
    bytes: buf.length, promptUsed: prompt, videoUrl,
    estimatedCost: VIDEO_COST_PER_CLIP, agentId: opts.agentId || null,
    generatedAt: now.toISOString()
  };
  await _uploadBlob(VIDEOS_CONTAINER, basePath + '.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf8'), 'application/json');

  const durationMs = Date.now() - started;
  console.log('[VideoEngine] done job=' + jobId + ' ' + (buf.length / 1048576).toFixed(2) + 'MB in ' + Math.round(durationMs / 1000) + 's');
  return { videoUrl, jobId, model: VEO_MODEL, durationMs, bytes: buf.length, estimatedCost: VIDEO_COST_PER_CLIP };
}

module.exports = {
  generateCharacterClip,
  buildVideoPrompt,
  resolvePortrait,
  checkDailyCap,
  findVideoUri,
  logSpend,
  ENGINE_VERSION,
  VEO_MODEL,
  VIDEO_COST_PER_CLIP,
  MAX_CLIPS_PER_DAY,
  PORTRAIT_DIR
};
