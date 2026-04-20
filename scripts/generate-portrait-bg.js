#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Generate pre-blurred background variants of agent portraits
// Usage: node scripts/generate-portrait-bg.js
// Output: <slug>-bg.jpg alongside each <slug>.webp in pixel-agents/img/
//
// These tiny (~50px wide, ~2KB) variants are consumed by the .pa-hero-v3
// "portrait-as-atmosphere" layer. CSS scales them up and filters further;
// pre-generating avoids the mobile scroll penalty of CSS-blurring full-res
// portraits at runtime.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'api', 'node_modules', 'sharp'));

const IMG_DIR = path.join(__dirname, '..', 'pixel-agents', 'img');
const BG_WIDTH = 50;          // px — CSS scales this back up
const BG_QUALITY = 70;        // WebP quality
const BG_SUFFIX = '-bg.webp';

// Skip these — not agent portraits
const SKIP = new Set(['og-card.png', 'og-card.webp']);

async function generateBg(inputPath, outputPath) {
  await sharp(inputPath)
    .resize(BG_WIDTH, null, { fit: 'inside' })
    .webp({ quality: BG_QUALITY })
    .toFile(outputPath);
  const stat = fs.statSync(outputPath);
  return stat.size;
}

async function main() {
  const files = fs.readdirSync(IMG_DIR);

  // Prefer .webp (it's the source format used on the site); fall back to .png
  // if only .png exists. Skip duplicates — each agent produces one -bg.jpg.
  const agentPortraits = new Map();
  for (const file of files) {
    if (SKIP.has(file)) continue;
    if (file.endsWith(BG_SUFFIX)) continue;   // already a bg variant
    const ext = path.extname(file).toLowerCase();
    if (ext !== '.webp' && ext !== '.png') continue;
    const slug = path.basename(file, ext);
    const existing = agentPortraits.get(slug);
    if (!existing || (existing.endsWith('.png') && ext === '.webp')) {
      agentPortraits.set(slug, file);   // webp wins if both present
    }
  }

  console.log(`Found ${agentPortraits.size} agent portraits. Generating bg variants…\n`);
  let total = 0;
  let skipped = 0;
  for (const [slug, filename] of agentPortraits) {
    const inputPath = path.join(IMG_DIR, filename);
    const outputPath = path.join(IMG_DIR, `${slug}${BG_SUFFIX}`);
    if (fs.existsSync(outputPath)) {
      skipped++;
      continue;
    }
    try {
      const bytes = await generateBg(inputPath, outputPath);
      console.log(`  ✓ ${slug}${BG_SUFFIX} (${bytes} bytes) ← ${filename}`);
      total += bytes;
    } catch (err) {
      console.error(`  ✗ ${slug}: ${err.message}`);
    }
  }
  console.log(`\nDone. Generated ${agentPortraits.size - skipped} files, ${skipped} already existed.`);
  console.log(`Total size: ${(total / 1024).toFixed(1)} KB`);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { generateBg };
