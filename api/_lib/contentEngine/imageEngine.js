// imageEngine.js — Content Engine Image Generation Library
// Generates images via Google AI Studio (generativelanguage.googleapis.com)
// Always uses :generateContent with responseModalities: ["TEXT","IMAGE"]
// Env vars: GEMINI_API_KEY, GEMINI_IMAGE_MODEL, GEMINI_IMAGE_PROVIDER, AZURE_STORAGE_CONNECTION_STRING

const https = require('https');
const crypto = require('crypto');

// ── Config ──
const ENGINE_VERSION = '1.8.1';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const GEMINI_IMAGE_PROVIDER = process.env.GEMINI_IMAGE_PROVIDER || 'multimodal';
const IMAGE_COST_PER_IMAGE = parseFloat(process.env.IMAGE_COST_ESTIMATE_PER_IMAGE) || 0.01;
const STORAGE_ACCOUNT = 'cardforgeblobdata';
const IMAGES_CONTAINER = process.env.GENERATED_IMAGES_CONTAINER || 'generated-images';
const STATE_CONTAINER = 'company-state';
const USAGE_CONTAINER = 'company-state';

// ── Presets (server-side only — never accept arbitrary style text) ──
var PRESETS = {
  'ap-2d-flat': {
    label: '2D Flat',
    version: '1.0',
    author: 'Pixel',
    visibility: 'internal',
    style: 'Clean 2D flat illustration style with bold saturated colors, minimal shadows, geometric shapes, modern vector-art aesthetic.'
  },
  'ap-neon-glass': {
    label: 'Neon Glass',
    version: '1.0',
    author: 'Pixel',
    visibility: 'internal',
    style: 'Dark background with vibrant neon glow effects, glass-morphism translucent panels, cyberpunk color palette of electric blue, hot pink, and purple.'
  },
  'ap-ornate-frame': {
    label: 'Ornate Frame',
    version: '1.0',
    author: 'Pixel',
    visibility: 'internal',
    style: 'Ornate decorative frame with detailed Art Nouveau borders, rich gold and deep jewel tones, vintage illustration quality.'
  },
  'ap-corporate-tech': {
    label: 'Corporate Tech',
    version: '1.0',
    author: 'Pixel',
    visibility: 'internal',
    style: 'Professional corporate technology aesthetic, clean gradients from dark navy to teal, abstract geometric patterns, sleek modern design.'
  }
};

var VALID_PRESETS = Object.keys(PRESETS);

// ── Output purposes ──
var PURPOSES = {
  'x_image': {
    label: 'X / Twitter Image',
    width: 1600,
    height: 900,
    aspect: '16:9',
    context: 'Social media promotional image for X/Twitter. Eye-catching composition, bold visually striking, with clear area that could support text overlay.'
  },
  'hero_image': {
    label: 'Hero Banner',
    width: 1536,
    height: 1024,
    aspect: '3:2',
    context: 'Website hero banner image. Wide atmospheric composition with breathing room on the left or right side for overlay text and CTA buttons.'
  },
  'square_image': {
    label: 'Square (Instagram)',
    width: 1024,
    height: 1024,
    aspect: '1:1',
    context: 'Square social media image for Instagram, LinkedIn, or profile cards. Centered composition with balanced visual weight.'
  },
  'story_image': {
    label: 'Story / Vertical',
    width: 1080,
    height: 1920,
    aspect: '9:16',
    context: 'Vertical story image for Instagram Stories, TikTok, or mobile-first display. Strong vertical composition with focal point in the center third.'
  },
  'blog_image': {
    label: 'Blog Header',
    width: 1200,
    height: 900,
    aspect: '4:3',
    context: 'Blog article header image. Clean composition with a clear subject and generous whitespace for readability alongside text content.'
  },
  'linkedin_image': {
    label: 'LinkedIn Post',
    width: 1200,
    height: 627,
    aspect: '1.91:1',
    context: 'LinkedIn feed post image. Professional, polished composition. Clear focal point with subtle branding opportunity.'
  }
};

var VALID_OUTPUTS = Object.keys(PURPOSES);

// ── Blob Storage ──
var _blobServiceClient = null;

function _getBlobServiceClient() {
  if (_blobServiceClient) return _blobServiceClient;
  var connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) return null;
  var sdk = require('@azure/storage-blob');
  _blobServiceClient = sdk.BlobServiceClient.fromConnectionString(connStr);
  return _blobServiceClient;
}

var _containerReady = {};
async function _ensureContainer(containerName) {
  var client = _getBlobServiceClient();
  if (!client) throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
  var container = client.getContainerClient(containerName);
  if (!_containerReady[containerName]) {
    await container.createIfNotExists({ access: 'blob' });
    // Ensure public blob read access (createIfNotExists won't update existing containers)
    try { await container.setAccessPolicy('blob'); } catch (e) { /* may fail if already set */ }
    _containerReady[containerName] = true;
  }
  return container;
}

/**
 * Upload binary data (image) to blob storage.
 * @returns {string} Public blob URL
 */
async function _uploadBlob(containerName, blobPath, buffer, contentType) {
  var container = await _ensureContainer(containerName);
  var blob = container.getBlockBlobClient(blobPath);
  await blob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: contentType },
    overwrite: true
  });
  return blob.url;
}

/**
 * Upload JSON metadata to blob storage.
 * @returns {string} Blob URL
 */
async function _uploadJson(containerName, blobPath, data) {
  var content = JSON.stringify(data, null, 2);
  var buf = Buffer.from(content, 'utf8');
  return _uploadBlob(containerName, blobPath, buf, 'application/json');
}

// ── Prompt Builder ──

// Variation directives — ensure each variation produces a genuinely different composition
var VARIATION_TWISTS = [
  null,
  'Use a dramatically different camera angle or viewpoint than typical for this subject.',
  'Shift the color palette toward warmer or cooler tones and use an unusual lighting direction.',
  'Adopt a more abstract or stylized interpretation — emphasize shapes and patterns over realism.',
  'Create a sense of motion, energy, or dynamic tension in the composition.'
];

function buildPrompt(opts) {
  var preset = PRESETS[opts.preset];
  var purpose = PURPOSES[opts.outputType];
  if (!preset || !purpose) throw new Error('Invalid preset or outputType');

  var parts = [
    'Generate a high-quality ' + purpose.aspect + ' image.',
    '',
    'TOPIC: ' + opts.topic,
    'GOAL: ' + opts.goal,
    '',
    'VISUAL STYLE: ' + preset.style,
    '',
    'PURPOSE: ' + purpose.context,
    '',
    'DIMENSIONS: ' + purpose.width + 'x' + purpose.height + ' pixels, ' + purpose.aspect + ' aspect ratio.',
    '',
    'REQUIREMENTS:',
    '- No text or watermarks in the image.',
    '- Professional quality, suitable for brand use.',
    '- High contrast and visual clarity.',
    '- Do NOT include any human faces or identifiable people.'
  ];

  if (opts.audience) parts.push('- Target audience: ' + opts.audience);
  if (opts.tone) parts.push('- Tone: ' + opts.tone);

  // Variation-unique twist
  var vNum = parseInt(opts.variation) || 1;
  if (vNum > 1 && vNum <= VARIATION_TWISTS.length && VARIATION_TWISTS[vNum - 1]) {
    parts.push('');
    parts.push('VARIATION DIRECTIVE (v' + vNum + '): ' + VARIATION_TWISTS[vNum - 1]);
  }

  return parts.join('\n');
}

// ── Gemini Multimodal API (AI Studio) ──

/**
 * Call Gemini :generateContent with responseModalities: ["TEXT","IMAGE"].
 * Provider is always multimodal (AI Studio). No Imagen :predict path.
 * @returns {Promise<{base64: string, mimeType: string}>}
 */
function callImageGeneration(prompt) {
  if (!GEMINI_API_KEY) return Promise.reject(new Error('GEMINI_API_KEY not set'));

  var apiPath = '/v1beta/models/' + GEMINI_IMAGE_MODEL + ':generateContent?key=' + GEMINI_API_KEY;

  var body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['Image']
    }
  });

  console.log('[ImageEngine] POST :generateContent model=' + GEMINI_IMAGE_MODEL + ' provider=' + GEMINI_IMAGE_PROVIDER + ' bodyLen=' + body.length);

  return new Promise(function (resolve, reject) {
    var options = {
      hostname: 'generativelanguage.googleapis.com',
      path: apiPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    var req = https.request(options, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var data = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          var errBody = '';
          try { errBody = JSON.parse(data).error.message || data.substring(0, 500); } catch (e) { errBody = data.substring(0, 500); }
          reject(new Error('Gemini API HTTP ' + res.statusCode + ': ' + errBody));
          return;
        }

        try {
          var parsed = JSON.parse(data);
          var result = _extractImage(parsed);
          resolve(result);
        } catch (e) {
          reject(new Error('Failed to parse Gemini response: ' + e.message));
        }
      });
    });

    req.on('error', function (err) { reject(new Error('Network error: ' + err.message)); });
    req.setTimeout(120000, function () { req.destroy(); reject(new Error('Image generation timed out (120s)')); });
    req.write(body);
    req.end();
  });
}

/**
 * Extract base64 image data from generateContent response.
 * Shape: { candidates: [{ content: { parts: [{ inlineData: { data, mimeType } }] } }] }
 */
function _extractImage(parsed) {
  var candidates = parsed.candidates || [];
  if (candidates.length === 0) throw new Error('No candidates in Gemini response');
  var parts = (candidates[0].content && candidates[0].content.parts) || [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].inlineData && parts[i].inlineData.data) {
      return {
        base64: parts[i].inlineData.data,
        mimeType: parts[i].inlineData.mimeType || 'image/png'
      };
    }
  }
  throw new Error('No inline image data found in Gemini response parts. Model ' + GEMINI_IMAGE_MODEL + ' may not support image output via responseModalities.');
}

// ── Main: Generate Image ──

/**
 * Generate a single image, upload to Blob, return URLs + metadata.
 * @param {Object} opts - { topic, goal, preset, outputType, audience?, tone?, jobId }
 * @returns {Promise<{imageUrl, thumbUrl, metaUrl, promptUsed, model, size}>}
 */
async function generateImage(opts) {
  if (!opts.topic || !opts.goal || !opts.preset || !opts.outputType) {
    throw new Error('Missing required fields: topic, goal, preset, outputType');
  }
  if (VALID_PRESETS.indexOf(opts.preset) === -1) {
    throw new Error('Invalid preset: ' + opts.preset + '. Valid: ' + VALID_PRESETS.join(', '));
  }
  if (VALID_OUTPUTS.indexOf(opts.outputType) === -1) {
    throw new Error('Invalid outputType: ' + opts.outputType + '. Valid: ' + VALID_OUTPUTS.join(', '));
  }

  var purpose = PURPOSES[opts.outputType];
  var jobId = opts.jobId || ('img-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  var prompt = buildPrompt(opts);

  console.log('[ImageEngine] Generating:', opts.outputType, 'preset:', opts.preset, 'model:', GEMINI_IMAGE_MODEL);

  // Call Gemini (multimodal :generateContent) — retry up to 3 times on no-image responses
  var result = null;
  var MAX_RETRIES = 3;
  for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      result = await callImageGeneration(prompt);
      break;
    } catch (err) {
      console.warn('[ImageEngine] Attempt ' + attempt + '/' + MAX_RETRIES + ' failed: ' + err.message);
      if (attempt === MAX_RETRIES) throw err;
      // Brief pause before retry
      await new Promise(function (r) { setTimeout(r, 2000); });
    }
  }
  var imageBuffer = Buffer.from(result.base64, 'base64');
  var ext = result.mimeType === 'image/jpeg' ? '.jpg' : '.png';

  // Build blob paths: generated-images/YYYY/MM/img_<jobId>_<kind>_<WxH>.png
  var now = new Date();
  var yearMonth = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0');
  var sizeStr = purpose.width + 'x' + purpose.height;
  var basePath = yearMonth + '/' + jobId;

  var imagePath = basePath + '_' + opts.outputType + '_' + sizeStr + ext;
  var thumbPath = basePath + '_thumb' + ext;
  var metaPath = basePath + '.json';

  // Upload image
  var imageUrl = await _uploadBlob(IMAGES_CONTAINER, imagePath, imageBuffer, result.mimeType);
  console.log('[ImageEngine] Uploaded image:', imagePath, '(' + imageBuffer.length + ' bytes)');

  // Thumbnail: for v1, use same image (no resize dependency).
  // TODO: Add proper thumbnail generation with sharp or similar.
  var thumbUrl = imageUrl;

  // Upload per-image metadata
  var presetDef = PRESETS[opts.preset] || {};
  var meta = {
    jobId: jobId,
    outputType: opts.outputType,
    preset: opts.preset,
    presetVersion: presetDef.version || '1.0',
    topic: opts.topic,
    goal: opts.goal,
    model: GEMINI_IMAGE_MODEL,
    engineVersion: ENGINE_VERSION,
    size: sizeStr,
    aspect: purpose.aspect,
    mimeType: result.mimeType,
    bytes: imageBuffer.length,
    promptUsed: prompt,
    imageUrl: imageUrl,
    thumbUrl: thumbUrl,
    generatedAt: now.toISOString()
  };
  var metaUrl = await _uploadJson(IMAGES_CONTAINER, metaPath, meta);

  return {
    imageUrl: imageUrl,
    thumbUrl: thumbUrl,
    metaUrl: metaUrl,
    promptUsed: prompt,
    model: GEMINI_IMAGE_MODEL,
    size: sizeStr,
    jobId: jobId,
    bytes: imageBuffer.length
  };
}

// ── Brief / Package Blob helpers ──

async function saveBrief(brief) {
  var blobPath = 'content-engine/briefs/' + brief.id + '.json';
  await _uploadJson(STATE_CONTAINER, blobPath, brief);
  return blobPath;
}

async function loadBrief(briefId) {
  var container = await _ensureContainer(STATE_CONTAINER);
  var blobPath = 'content-engine/briefs/' + briefId + '.json';
  var blob = container.getBlockBlobClient(blobPath);
  try {
    var download = await blob.download(0);
    var body = await _streamToString(download.readableStreamBody);
    return JSON.parse(body);
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function savePackage(pkg) {
  var blobPath = 'content-engine/packages/' + pkg.id + '.json';
  var url = await _uploadJson(STATE_CONTAINER, blobPath, pkg);
  return url;
}

async function loadPackage(packageId) {
  var container = await _ensureContainer(STATE_CONTAINER);
  var blobPath = 'content-engine/packages/' + packageId + '.json';
  var blob = container.getBlockBlobClient(blobPath);
  try {
    var download = await blob.download(0);
    var body = await _streamToString(download.readableStreamBody);
    return JSON.parse(body);
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * Append a summary entry to content-engine/index.json (gallery index).
 * Append-only: loads existing array, pushes new entry, re-uploads.
 */
async function appendToIndex(entry) {
  var container = await _ensureContainer(STATE_CONTAINER);
  var blobPath = 'content-engine/index.json';
  var blob = container.getBlockBlobClient(blobPath);
  var index = [];
  try {
    var download = await blob.download(0);
    var body = await _streamToString(download.readableStreamBody);
    index = JSON.parse(body);
    if (!Array.isArray(index)) index = [];
  } catch (e) { /* first time — empty */ }
  index.push(entry);
  // Cap at 500 entries
  if (index.length > 500) index = index.slice(-500);
  await _uploadJson(STATE_CONTAINER, blobPath, index);
  return index.length;
}

// ── Usage Logging ──

/**
 * Write a usage record to blob storage.
 * Path: usage/YYYY/MM/usage_<timestamp>_<packageId>.json
 */
async function writeUsageRecord(record) {
  var now = new Date();
  var yearMonth = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0');
  var blobPath = 'usage/' + yearMonth + '/usage_' + now.getTime() + '_' + record.packageId + '.json';
  await _uploadJson(USAGE_CONTAINER, blobPath, record);
  return blobPath;
}

/**
 * Calculate estimated cost for a generation run.
 */
function estimateCost(imagesGenerated) {
  return Math.round(imagesGenerated * IMAGE_COST_PER_IMAGE * 10000) / 10000;
}

// ── Content Engine Config ──

/**
 * Load contentEngineConfig from company-state blob.
 * Returns { defaultPreset, defaultOutputs, maxImagesPerDay } or defaults.
 */
async function loadContentEngineConfig() {
  try {
    var blobPath = 'contentEngineConfig.json';
    var client = _getContainerClient(STATE_CONTAINER);
    var blobClient = client.getBlobClient(blobPath);
    var dl = await blobClient.download(0);
    var raw = await _streamToString(dl.readableStreamBody);
    var cfg = JSON.parse(raw);
    return {
      defaultPreset: cfg.defaultPreset || 'ap-neon-glass',
      defaultOutputs: Array.isArray(cfg.defaultOutputs) ? cfg.defaultOutputs : ['x_image'],
      maxImagesPerDay: parseInt(cfg.maxImagesPerDay) || 50
    };
  } catch (e) {
    return { defaultPreset: 'ap-neon-glass', defaultOutputs: ['x_image'], maxImagesPerDay: 50 };
  }
}

// ── Usage Limit Hook ──

/**
 * Check whether an account is within usage limits.
 * Reads maxImagesPerDay from contentEngineConfig blob.
 * Counts today's usage records to enforce.
 * @param {string} accountId
 * @returns {Promise<{allowed: boolean, remaining?: number, reason?: string}>}
 */
async function checkUsageLimits(accountId) {
  try {
    var cfg = await loadContentEngineConfig();
    var maxPerDay = cfg.maxImagesPerDay;
    if (!maxPerDay || maxPerDay <= 0) return { allowed: true };

    // Count today's usage
    var now = new Date();
    var yearMonth = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0');
    var prefix = 'usage/' + yearMonth + '/usage_';
    var todayStr = now.toISOString().slice(0, 10);
    var client = _getContainerClient(USAGE_CONTAINER);
    var count = 0;

    for await (var blob of client.listBlobsFlat({ prefix: prefix })) {
      // usage records have timestamp in filename; check if today
      try {
        var ts = blob.name.split('usage_')[1].split('_')[0];
        var d = new Date(parseInt(ts));
        if (d.toISOString().slice(0, 10) === todayStr) {
          count++;
        }
      } catch (e) { /* skip malformed */ }
    }

    var remaining = Math.max(0, maxPerDay - count);
    if (remaining <= 0) {
      return { allowed: false, remaining: 0, reason: 'Daily limit of ' + maxPerDay + ' images reached' };
    }
    return { allowed: true, remaining: remaining };
  } catch (e) {
    // Fail open — if we can't check, allow generation
    return { allowed: true };
  }
}

/**
 * Get preset version string for a given preset ID.
 */
function getPresetVersion(presetId) {
  var p = PRESETS[presetId];
  return p ? (p.version || '1.0') : '1.0';
}

function _streamToString(stream) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    stream.on('data', function (c) { chunks.push(typeof c === 'string' ? Buffer.from(c) : c); });
    stream.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    stream.on('error', reject);
  });
}

// ── Package Deletion ──

var GENERATED_IMAGES_PREFIX = 'https://' + STORAGE_ACCOUNT + '.blob.core.windows.net/' + IMAGES_CONTAINER + '/';

/**
 * Soft delete: mark package + index entry as deleted. Images untouched.
 * @param {string} packageId
 * @param {string} actor - who performed the delete
 * @returns {Promise<{ ok: boolean, packageId: string }>}
 */
async function softDeletePackage(packageId, actor) {
  if (!packageId) throw new Error('packageId required');
  var pkg = await loadPackage(packageId);
  if (!pkg) throw { code: 'NOT_FOUND', message: 'Package not found: ' + packageId };
  pkg.status = 'deleted';
  pkg.deletedAt = new Date().toISOString();
  pkg.deletedBy = actor || 'unknown';
  await savePackage(pkg);
  await _updateIndexEntry(packageId, function (entry) {
    entry.status = 'deleted';
    entry.deletedAt = pkg.deletedAt;
    entry.deletedBy = pkg.deletedBy;
    return entry;
  });
  return { ok: true, packageId: packageId };
}

/**
 * Hard delete: remove package blob + index entry. Optionally purge image blobs.
 * @param {string} packageId
 * @param {string} actor
 * @param {Object} [opts]
 * @param {boolean} [opts.purgeImages=false] - also delete generated image blobs
 * @param {boolean} [opts.purgeIndex=true] - remove from index (vs mark deleted)
 * @returns {Promise<{ ok: boolean, packageId: string, blobsDeleted: number }>}
 */
async function hardDeletePackage(packageId, actor, opts) {
  if (!packageId) throw new Error('packageId required');
  var purgeImages = (opts && opts.purgeImages === true) || false;
  var purgeIndex = (opts && opts.purgeIndex !== false); // default true
  var blobsDeleted = 0;

  var pkg = await loadPackage(packageId);

  // Purge generated image blobs if requested
  if (purgeImages && pkg && Array.isArray(pkg.outputs)) {
    var imgContainer = await _ensureContainer(IMAGES_CONTAINER);
    for (var i = 0; i < pkg.outputs.length; i++) {
      var output = pkg.outputs[i];
      if (!output) continue;
      var urls = [output.url, output.thumbUrl, output.metaUrl].filter(Boolean);
      for (var u = 0; u < urls.length; u++) {
        if (urls[u].indexOf(GENERATED_IMAGES_PREFIX) !== 0) continue;
        var blobName = urls[u].substring(GENERATED_IMAGES_PREFIX.length);
        try {
          await imgContainer.getBlockBlobClient(blobName).deleteIfExists();
          blobsDeleted++;
        } catch (e) { /* non-fatal */ }
      }
    }
  }

  // Delete package blob
  if (pkg) {
    var stateContainer = await _ensureContainer(STATE_CONTAINER);
    try {
      await stateContainer.getBlockBlobClient('content-engine/packages/' + packageId + '.json').deleteIfExists();
    } catch (e) { /* non-fatal */ }
  }

  // Remove or mark in index
  if (purgeIndex) {
    await _removeIndexEntry(packageId);
  } else {
    await _updateIndexEntry(packageId, function (entry) {
      entry.status = 'deleted';
      entry.deletedAt = new Date().toISOString();
      entry.deletedBy = actor || 'unknown';
      return entry;
    });
  }

  return { ok: true, packageId: packageId, blobsDeleted: blobsDeleted };
}

/**
 * Update a single entry in the gallery index by packageId.
 */
async function _updateIndexEntry(packageId, mutator) {
  var container = await _ensureContainer(STATE_CONTAINER);
  var blobPath = 'content-engine/index.json';
  var blob = container.getBlockBlobClient(blobPath);
  var index = [];
  try {
    var download = await blob.download(0);
    var body = await _streamToString(download.readableStreamBody);
    index = JSON.parse(body);
    if (!Array.isArray(index)) index = [];
  } catch (e) { return; }
  var changed = false;
  for (var i = 0; i < index.length; i++) {
    if (index[i].packageId === packageId) {
      index[i] = mutator(index[i]);
      changed = true;
      break;
    }
  }
  if (changed) await _uploadJson(STATE_CONTAINER, blobPath, index);
}

/**
 * Remove an entry from the gallery index entirely.
 */
async function _removeIndexEntry(packageId) {
  var container = await _ensureContainer(STATE_CONTAINER);
  var blobPath = 'content-engine/index.json';
  var blob = container.getBlockBlobClient(blobPath);
  var index = [];
  try {
    var download = await blob.download(0);
    var body = await _streamToString(download.readableStreamBody);
    index = JSON.parse(body);
    if (!Array.isArray(index)) index = [];
  } catch (e) { return; }
  var before = index.length;
  index = index.filter(function (e) { return e.packageId !== packageId; });
  if (index.length !== before) await _uploadJson(STATE_CONTAINER, blobPath, index);
}

// ── Exports ──
module.exports = {
  generateImage: generateImage,
  saveBrief: saveBrief,
  loadBrief: loadBrief,
  savePackage: savePackage,
  loadPackage: loadPackage,
  appendToIndex: appendToIndex,
  buildPrompt: buildPrompt,
  writeUsageRecord: writeUsageRecord,
  estimateCost: estimateCost,
  checkUsageLimits: checkUsageLimits,
  loadContentEngineConfig: loadContentEngineConfig,
  getPresetVersion: getPresetVersion,
  softDeletePackage: softDeletePackage,
  hardDeletePackage: hardDeletePackage,
  PRESETS: PRESETS,
  VALID_PRESETS: VALID_PRESETS,
  PURPOSES: PURPOSES,
  VALID_OUTPUTS: VALID_OUTPUTS,
  ENGINE_VERSION: ENGINE_VERSION,
  GEMINI_IMAGE_MODEL: GEMINI_IMAGE_MODEL,
  GEMINI_IMAGE_PROVIDER: GEMINI_IMAGE_PROVIDER,
  IMAGE_COST_PER_IMAGE: IMAGE_COST_PER_IMAGE
};
