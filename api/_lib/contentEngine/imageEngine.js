// imageEngine.js — Content Engine Image Generation Library
// Generates images via Gemini / Imagen API, uploads to Azure Blob Storage.
// Env vars: GEMINI_API_KEY, GEMINI_IMAGE_MODEL, AZURE_STORAGE_CONNECTION_STRING

const https = require('https');
const crypto = require('crypto');

// ── Config ──
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'imagen-3.0-generate-002';
const STORAGE_ACCOUNT = 'cardforgeblobdata';
const IMAGES_CONTAINER = process.env.GENERATED_IMAGES_CONTAINER || 'generated-images';
const STATE_CONTAINER = 'company-state';

// ── Presets (server-side only — never accept arbitrary style text) ──
var PRESETS = {
  'ap-2d-flat': {
    label: '2D Flat',
    style: 'Clean 2D flat illustration style with bold saturated colors, minimal shadows, geometric shapes, modern vector-art aesthetic.'
  },
  'ap-neon-glass': {
    label: 'Neon Glass',
    style: 'Dark background with vibrant neon glow effects, glass-morphism translucent panels, cyberpunk color palette of electric blue, hot pink, and purple.'
  },
  'ap-ornate-frame': {
    label: 'Ornate Frame',
    style: 'Ornate decorative frame with detailed Art Nouveau borders, rich gold and deep jewel tones, vintage illustration quality.'
  },
  'ap-corporate-tech': {
    label: 'Corporate Tech',
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

async function _ensureContainer(containerName) {
  var client = _getBlobServiceClient();
  if (!client) throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
  var container = client.getContainerClient(containerName);
  await container.createIfNotExists();
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

  return parts.join('\n');
}

// ── Gemini / Imagen API ──

/**
 * Call Gemini image generation API.
 * Supports both Imagen models (:predict) and Gemini native (:generateContent).
 * @returns {Promise<{base64: string, mimeType: string}>}
 */
function callImageGeneration(prompt, aspectRatio) {
  if (!GEMINI_API_KEY) return Promise.reject(new Error('GEMINI_API_KEY not set'));

  var isImagen = GEMINI_IMAGE_MODEL.indexOf('imagen') !== -1;
  var endpoint = isImagen ? ':predict' : ':generateContent';
  var path = '/v1beta/models/' + GEMINI_IMAGE_MODEL + endpoint + '?key=' + GEMINI_API_KEY;

  var body;
  if (isImagen) {
    body = JSON.stringify({
      instances: [{ prompt: prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: aspectRatio || '16:9',
        personGeneration: 'DONT_ALLOW'
      }
    });
  } else {
    body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE']
      }
    });
  }

  return new Promise(function (resolve, reject) {
    var options = {
      hostname: 'generativelanguage.googleapis.com',
      path: path,
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
          var result = _extractImage(parsed, isImagen);
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
 * Extract base64 image data from API response.
 */
function _extractImage(parsed, isImagen) {
  if (isImagen) {
    // Imagen response: { predictions: [{ bytesBase64Encoded, mimeType }] }
    var preds = parsed.predictions || parsed.generatedImages || [];
    if (preds.length === 0) throw new Error('No predictions in Imagen response');
    var pred = preds[0];
    var b64 = pred.bytesBase64Encoded || (pred.image && pred.image.imageBytes) || '';
    if (!b64) throw new Error('No image data in Imagen prediction');
    return { base64: b64, mimeType: pred.mimeType || 'image/png' };
  } else {
    // Gemini generateContent response: { candidates: [{ content: { parts: [...] } }] }
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
    throw new Error('No inline image data found in Gemini response parts');
  }
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

  // Call Gemini
  var result = await callImageGeneration(prompt, purpose.aspect);
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
  var meta = {
    jobId: jobId,
    outputType: opts.outputType,
    preset: opts.preset,
    topic: opts.topic,
    goal: opts.goal,
    model: GEMINI_IMAGE_MODEL,
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

function _streamToString(stream) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    stream.on('data', function (c) { chunks.push(typeof c === 'string' ? Buffer.from(c) : c); });
    stream.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    stream.on('error', reject);
  });
}

// ── Exports ──
module.exports = {
  generateImage: generateImage,
  saveBrief: saveBrief,
  loadBrief: loadBrief,
  savePackage: savePackage,
  buildPrompt: buildPrompt,
  PRESETS: PRESETS,
  VALID_PRESETS: VALID_PRESETS,
  PURPOSES: PURPOSES,
  VALID_OUTPUTS: VALID_OUTPUTS
};
