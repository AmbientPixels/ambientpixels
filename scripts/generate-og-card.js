#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Generate the Pixel Agents "Cast Card" OG preview (1200×630).
//
// Produces /pixel-agents/img/og-card.png — the social unfurl image
// served via <meta property="og:image">.
//
// Composition: manifesto headline left, Code Roast portrait right, near-black
// bg with soft red radial spotlight behind. Matches the landing hero.
//
// Usage: node scripts/generate-og-card.js
// Requires the API's node_modules (satori + @resvg/resvg-js).
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const apiNodeModules = path.join(__dirname, '..', 'api', 'node_modules');
// satori ships ESM primarily; use the explicit CJS build so require() returns a usable default.
const satoriFn = require(path.join(apiNodeModules, 'satori', 'dist', 'index.cjs')).default;
const { Resvg } = require(path.join(apiNodeModules, '@resvg', 'resvg-js'));
const sharp = require(path.join(apiNodeModules, 'sharp'));

// ── Config ──
// Agent slug via CLI arg (default: roast-my-site — flagship / order 1 / legendary)
const AGENT_SLUG  = process.argv[2] || 'roast-my-site';
const AGENTS_JSON = path.join(__dirname, '..', 'pixel-agents', 'data', 'pixel-agents.json');
const agents      = JSON.parse(fs.readFileSync(AGENTS_JSON, 'utf8'));
const agent       = agents.find(a => a.id === AGENT_SLUG);
if (!agent) {
  console.error(`Unknown agent slug: ${AGENT_SLUG}`);
  console.error('Available:', agents.map(a => a.id).join(', '));
  process.exit(1);
}

const FONT_PATH     = path.join(__dirname, '..', 'api', 'pixel-agent-share-card', 'SpaceGrotesk-Bold.ttf');
const PORTRAIT_PATH = path.join(__dirname, '..', 'pixel-agents', 'img', `${AGENT_SLUG}.webp`);
const OUTPUT_PATH   = path.join(__dirname, '..', 'pixel-agents', 'img', 'og-card.png');

const spaceGrotesk = fs.readFileSync(FONT_PATH);

// Helper — satori element factory. Every element needs display:flex (or absolute).
function el(type, style, children) {
  return { type, props: { style: { display: 'flex', ...style }, children } };
}
function txt(style, text) {
  return el('span', style, text);
}

const INK       = '#F4F1EA';
const INK_MUTED = 'rgba(244, 241, 234, 0.64)';
const PRIMARY   = '#E3442C';
const NEUTRAL   = '#0A0A0C';

// ── Composition ─────────────────────────────────────────────
function buildMarkup(portraitUri) { return el(
  'div',
  {
    width: '1200px',
    height: '630px',
    position: 'relative',
    fontFamily: 'Space Grotesk',
    color: INK,
    backgroundColor: NEUTRAL,
    backgroundImage:
      `radial-gradient(ellipse 80% 65% at 80% 25%, rgba(227, 68, 44, 0.28), rgba(227, 68, 44, 0.08) 32%, transparent 68%),` +
      `radial-gradient(ellipse 55% 50% at 20% 85%, rgba(232, 163, 58, 0.10), transparent 60%)`,
  },
  [
    // ── Left — wordmark + headline + subhead ─────────────
    el(
      'div',
      {
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 48px 56px 80px',
        width: '720px',
        height: '100%',
        boxSizing: 'border-box',
      },
      [
        // Wordmark row — single ink-colored wordmark. No red square: it was
        // stacking with the red eyebrow line below and creating a bouncing
        // double-red. The eyebrow's hairline rule carries the brand accent.
        txt(
          {
            fontSize: '16px',
            fontWeight: 700,
            letterSpacing: '4px',
            textTransform: 'uppercase',
            color: INK,
          },
          'Pixel Agents'
        ),

        // Headline block
        el(
          'div',
          { flexDirection: 'column' },
          [
            // Eyebrow
            el(
              'div',
              { alignItems: 'center', gap: '14px', marginBottom: '24px' },
              [
                el('div', { width: '28px', height: '1px', background: PRIMARY }, []),
                txt(
                  {
                    fontSize: '14px',
                    fontWeight: 700,
                    letterSpacing: '4px',
                    textTransform: 'uppercase',
                    color: PRIMARY,
                  },
                  'First Principle'
                ),
              ]
            ),
            // Three headline lines
            txt(
              {
                fontSize: '72px',
                fontWeight: 700,
                lineHeight: 1.0,
                letterSpacing: '-4px',
                textTransform: 'uppercase',
                color: INK,
              },
              'Build once.'
            ),
            txt(
              {
                fontSize: '72px',
                fontWeight: 700,
                lineHeight: 1.0,
                letterSpacing: '-4px',
                textTransform: 'uppercase',
                color: INK,
                marginTop: '4px',
              },
              'Deploy forever.'
            ),
            txt(
              {
                fontSize: '72px',
                fontWeight: 700,
                lineHeight: 1.0,
                letterSpacing: '-4px',
                textTransform: 'uppercase',
                color: PRIMARY,
                marginTop: '4px',
              },
              'Earn on every run.'
            ),
          ]
        ),

        // Subhead
        txt(
          {
            fontSize: '18px',
            fontWeight: 700,
            letterSpacing: '0.5px',
            color: INK_MUTED,
          },
          'AI agents for hire. Structured output. Zero prompt engineering.'
        ),
      ]
    ),

    // ── Right — Arcane portrait (full-bleed) ─────────────
    el(
      'div',
      { width: '480px', height: '630px', position: 'relative', overflow: 'hidden' },
      [
        {
          type: 'img',
          props: {
            src: portraitUri,
            width: 480,
            height: 630,
            style: {
              objectFit: 'cover',
              objectPosition: '50% 15%',
              width: '480px',
              height: '630px',
            },
          },
        },
        // Bottom darken for caption legibility
        el(
          'div',
          {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '220px',
            backgroundImage: 'linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.78))',
          },
          []
        ),
        // Left-edge fade blends portrait into text column
        el(
          'div',
          {
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '100px',
            backgroundImage: `linear-gradient(90deg, ${NEUTRAL}, transparent)`,
          },
          []
        ),
        // Agent caption
        el(
          'div',
          {
            position: 'absolute',
            left: '28px',
            bottom: '28px',
            flexDirection: 'column',
          },
          [
            txt(
              {
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '3px',
                textTransform: 'uppercase',
                color: PRIMARY,
                marginBottom: '4px',
              },
              'Agent of the Day'
            ),
            txt(
              {
                fontSize: '28px',
                fontWeight: 700,
                letterSpacing: '-0.5px',
                color: INK,
              },
              agent.name
            ),
          ]
        ),
      ]
    ),
  ]
); }

(async () => {
  // satori doesn't decode webp — convert portrait to PNG buffer first, then data URI.
  console.log('Converting portrait webp → png…');
  const portraitPng = await sharp(PORTRAIT_PATH).png().toBuffer();
  const portraitUri = 'data:image/png;base64,' + portraitPng.toString('base64');

  console.log('Rendering OG cast card (1200×630)…');
  const svg = await satoriFn(buildMarkup(portraitUri), {
    width: 1200,
    height: 630,
    fonts: [{ name: 'Space Grotesk', data: spaceGrotesk, weight: 700, style: 'normal' }],
  });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const pngBuffer = resvg.render().asPng();
  fs.writeFileSync(OUTPUT_PATH, pngBuffer);
  console.log(`✓ og-card.png written (${(pngBuffer.length / 1024).toFixed(1)} KB)`);
})().catch(err => {
  console.error('Failed:', err.stack || err);
  process.exit(1);
});
