// cardEngine.js — renders approved post copy onto a brand card, server-side, for $0.
//
// WHY THIS EXISTS
//
// Instagram cannot post text-only, and the pipeline is text-first: Echo briefs, Scribe
// writes, Quill reviews, the CEO approves WORDS. Nothing in that chain produces an image.
// This closes the gap without inventing anything — the card shows the copy that was already
// approved, and nothing else.
//
// Third sibling in contentEngine, and the only one that costs nothing:
//   imageEngine  → Gemini, ~$0.039, synchronous
//   videoEngine  → Veo,    ~$1.20,  submit-and-poll
//   cardEngine   → satori, $0,      deterministic
//
// No model runs here. That is the point: a generated image can assert something the approved
// copy does not, and there is no quality gate on a picture.
//
// WHY IT WORKS IN AZURE when the video overlay does not: satori renders to SVG and resvg
// rasterises it, both pure native/wasm. No browser, no ffmpeg. Proven in production by
// api/pixel-agent-share-card.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prefixBlobKey } = require('../../_utils/demoGuard');

// satori 0.10 ships an ESM-interop CJS build: require() returns a module object, not the
// function. Calling it directly throws "satori is not a function" on EVERY request. This cost
// pixel-agent-share-card a run of 500s — do not "simplify" these two lines away.
const _satoriModule = require('satori');
const satori = typeof _satoriModule === 'function' ? _satoriModule : _satoriModule.default;
const _resvgModule = require('@resvg/resvg-js');
const Resvg = _resvgModule.Resvg || (_resvgModule.default && _resvgModule.default.Resvg);

const ENGINE_VERSION = '1.0.0';

// 4:5 — the tallest ratio the Instagram feed allows, so the most phone screen per post.
const W = 1080;
const H = 1350;

// Brand tokens. Source of truth: scripts/generate-og-image.js.
const INK = '#0c0c0c';
const PAPER = '#f4f4f4';
const GOLD = '#d4a952';
const MUTED = 'rgba(244,244,244,0.42)';

const FONT_PATH = path.join(__dirname, 'fonts', 'ArchivoBlack-Regular.ttf');
let _fontData = null;
function _font() {
  if (!_fontData) _fontData = fs.readFileSync(FONT_PATH);
  return _fontData;
}

const CARDS_CONTAINER = process.env.GENERATED_CARDS_CONTAINER || 'generated-cards';

/**
 * Split copy into the lines the author actually wrote.
 *
 * Blank lines are paragraph breaks and are preserved as spacing, not collapsed. Each
 * remaining line is rendered as its own element and is NOT reflowed.
 *
 * The video spec records why: a deliberate 3-line hook became 5 visual lines with two words
 * stranded alone, because the renderer was allowed to re-wrap. Same lesson, different
 * renderer. Long lines shrink (see fitSize) rather than silently rewrapping into breaks
 * nobody chose.
 */
function splitLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim());
}

/**
 * Pick the largest font size at which the whole block still fits the card.
 *
 * The first attempt sized by the LONGEST LINE's character count, on the assumption that
 * nothing wraps. satori wraps by default, so a single 90-character paragraph drove the whole
 * card to the 30px floor and left 85% of a 4:5 frame empty. Explicit \n breaks are preserved
 * as separate blocks either way; what varies is how a long paragraph flows inside its block.
 *
 * So: estimate wrapped line count at a candidate size, compute block height, and take the
 * largest size that fits. Short copy gets big type, long copy gets smaller type, and the card
 * is full either way.
 *
 * 0.62em average advance for Archivo Black is approximate. It only has to be close: being
 * one size step conservative costs nothing, and availHeight already excludes the lockup.
 */
function fitSize(lines, maxWidth, opts) {
  opts = opts || {};
  const max = opts.max || 92;
  const min = opts.min || 26;
  const availHeight = opts.availHeight || 1000;
  const body = lines.filter(l => l.length > 0);
  if (!body.length) return max;

  for (let size = max; size >= min; size -= 2) {
    const charsPerLine = Math.max(8, Math.floor(maxWidth / (size * 0.62)));
    let rows = 0;
    for (const l of lines) {
      // Blank lines are paragraph gaps, not full rows.
      rows += l.length ? Math.ceil(l.length / charsPerLine) : 0.55;
    }
    if (rows * size * 1.22 <= availHeight) return size;
  }
  return min;
}

/**
 * Build the satori element tree. Pure — exported so tests can assert layout decisions
 * without rendering a PNG.
 */
function buildMarkup(opts) {
  const lines = splitLines(opts.text).slice(0, 14);
  const body = lines.filter(l => l.length > 0);
  if (!body.length) throw new Error('cardEngine: text is empty after trimming');

  const PAD = 88;
  // Height available to the copy: card minus padding minus the lockup block at the bottom.
  const LOCKUP_H = 150;
  const fontSize = fitSize(lines, W - PAD * 2, {
    max: opts.maxFontSize, min: opts.minFontSize,
    availHeight: H - PAD * 2 - LOCKUP_H
  });

  // satori parses every style value it is given, including undefined ones — a stray
  // `height: undefined` throws "Cannot read properties of undefined (reading 'trim')" from
  // deep inside its CSS parser, which points nowhere near the property that caused it. Build
  // the style object conditionally rather than assigning undefined.
  const lineNodes = lines.map((l) => {
    const style = { display: 'flex', color: PAPER, fontSize: fontSize, lineHeight: 1.22, letterSpacing: '-0.02em' };
    // A blank line is a paragraph break: give it height, not a stray empty row.
    if (!l) style.height = Math.round(fontSize * 0.55) + 'px';
    return { type: 'div', props: { style: style, children: l || ' ' } };
  });

  return {
    type: 'div',
    props: {
      style: {
        width: W, height: H, display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: INK, padding: PAD + 'px', fontFamily: 'Archivo Black'
      },
      children: [
        // Copy block, top-aligned. Reads first because it is the message.
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'column' }, children: lineNodes } },
        // Lockup: gold rule + wordmark. Restrained on purpose — the card is the copy, and
        // branding that competes with the message is branding that loses.
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column' },
            children: [
              { type: 'div', props: { style: { display: 'flex', width: '96px', height: '5px', backgroundColor: GOLD, marginBottom: '22px' }, children: ' ' } },
              {
                type: 'div',
                props: {
                  style: { display: 'flex', alignItems: 'baseline' },
                  children: [
                    { type: 'span', props: { style: { fontSize: 30, color: PAPER, letterSpacing: '-0.02em' }, children: 'AmbientPixels.' } },
                    { type: 'span', props: { style: { fontSize: 17, color: MUTED, marginLeft: '16px', letterSpacing: '0.12em' }, children: (opts.handle || '@ambientpixels2022').toUpperCase() } }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  };
}

/**
 * Render copy to a JPEG buffer. Instagram's container endpoint wants JPEG; satori/resvg
 * produce PNG, so sharp converts. sharp is already a dependency.
 */
async function renderCard(opts) {
  const svg = await satori(buildMarkup(opts), {
    width: W, height: H,
    fonts: [{ name: 'Archivo Black', data: _font(), weight: 400, style: 'normal' }]
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
  const sharp = require('sharp');
  return await sharp(png).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
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
    // PUBLIC on purpose: Instagram fetches the image itself from a URL, exactly as
    // facebook.js hands /videos a file_url. If this container is ever made private,
    // publishing starts failing with an Instagram-side fetch error that points nowhere
    // near the container. Same trap videoEngine documents.
    await container.createIfNotExists({ access: 'blob' });
    try { await container.setAccessPolicy('blob'); } catch (e) { /* already set */ }
    _containerReady[name] = true;
  }
  return container;
}

/**
 * Render and upload. Returns a public https URL Instagram can fetch.
 * @param {Object} opts - { text, handle?, jobId?, maxFontSize?, minFontSize? }
 */
async function generateCard(opts) {
  if (!opts || !String(opts.text || '').trim()) throw new Error('cardEngine: text is required');
  const started = Date.now();
  const jobId = opts.jobId || ('card-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  const buf = await renderCard(opts);

  const now = new Date();
  const blobPath = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + jobId + '_' + W + 'x' + H + '.jpg';
  const container = await _ensureContainer(CARDS_CONTAINER);
  const blob = container.getBlockBlobClient(prefixBlobKey(blobPath));
  await blob.upload(buf, buf.length, { blobHTTPHeaders: { blobContentType: 'image/jpeg' }, overwrite: true });

  console.log('[CardEngine] ' + jobId + ' ' + (buf.length / 1024).toFixed(0) + 'KB in ' + (Date.now() - started) + 'ms');
  return {
    imageUrl: blob.url, jobId, bytes: buf.length,
    width: W, height: H, durationMs: Date.now() - started,
    engineVersion: ENGINE_VERSION, estimatedCost: 0
  };
}

module.exports = {
  generateCard,
  renderCard,
  buildMarkup,
  splitLines,
  fitSize,
  ENGINE_VERSION,
  WIDTH: W,
  HEIGHT: H,
  FONT_PATH
};
