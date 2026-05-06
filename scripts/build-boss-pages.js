#!/usr/bin/env node
/**
 * Build the Blindspot Boss Gallery: 1 index page + 10 per-boss pages.
 * Reads boss-lore.json (authored content) and joins it against
 * bosses.json + boss-cards.json + adventures/* (existing combat data).
 * Writes static .html files under blindspot/bosses/.
 *
 * Usage:
 *   node scripts/build-boss-pages.js
 *   node scripts/build-boss-pages.js --only gatekeeper
 *   node scripts/build-boss-pages.js --check     # validate only, no writes
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BLINDSPOT = path.join(ROOT, 'blindspot');
const DATA = path.join(BLINDSPOT, 'data');
const OUT = path.join(BLINDSPOT, 'bosses');

const pageTemplate = require('./_boss-page-template.js');
const indexTemplate = require('./_boss-index-template.js');

const args = process.argv.slice(2);
const onlySlug = (function () {
  const idx = args.indexOf('--only');
  return idx >= 0 ? args[idx + 1] : null;
})();
const checkOnly = args.includes('--check');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadAll() {
  const lore = readJson(path.join(DATA, 'boss-lore.json'));
  const bosses = readJson(path.join(DATA, 'bosses.json'));
  const cards = readJson(path.join(DATA, 'boss-cards.json'));

  const adventures = {};
  const advDir = path.join(DATA, 'adventures');
  for (let n = 1; n <= 10; n++) {
    const file = path.join(advDir, `bs-boss-${n}.json`);
    if (fs.existsSync(file)) {
      adventures[`bs-boss-${n}`] = readJson(file);
    }
  }

  // Index combat data by id for quick joins.
  const bossesById = {};
  bosses.forEach(function (b) { if (b.id) bossesById[b.id] = b; });

  return { lore, bossesById, cards: cards.bosses || {}, adventures };
}

function buildContext(loreEntry, sources, neighbors) {
  const combat = sources.bossesById[loreEntry.id] || {};
  const card = sources.cards[loreEntry.id] || {};
  const advs = sources.adventures[loreEntry.id] || null;

  const className = combat.class || card.archetype || '';
  const classThematic = (sources.lore._meta.classThematic || {})[className] || '';

  const tier = card.tier || 1;
  const hp = card.hp || 0;
  const stamina = card.stamina || 0;
  const combatStats = combat.combatStats || {};
  const traits = (card.traits || []).map(function (t) {
    return { name: t.name, desc: t.desc };
  });

  // Synthesize a focused 120-160 char meta description from tagline + class.
  const desc = (loreEntry.tagline + ' ' + (className ? className + ' boss · ' : '') + 'Tier ' + tier + ' Blindspot campaign opponent. Lore, stats, strengths, weaknesses, and signature moves.').trim();
  const metaDescription = desc.length > 160 ? desc.slice(0, 157) + '…' : desc;

  const canonicalUrl = 'https://www.ambientpixels.ai/blindspot/bosses/' + loreEntry.slug + '/';
  const ogImage = loreEntry.ogImage || (loreEntry.media && loreEntry.media[0] && loreEntry.media[0].src) || '/blindspot/img/og-blindspot.png';
  const absoluteOgImage = ogImage.startsWith('http') ? ogImage : ('https://www.ambientpixels.ai' + ogImage);

  return {
    id: loreEntry.id,
    slug: loreEntry.slug,
    name: combat.name || card.name || loreEntry.slug,
    bossNumber: combat.boss || null,
    tagline: loreEntry.tagline,
    bio: loreEntry.bio,
    domainName: loreEntry.domainName || (advs && advs.title) || '',
    domainDescription: loreEntry.domainDescription,
    strengthsProse: loreEntry.strengthsProse,
    weaknessesProse: loreEntry.weaknessesProse,
    classThematic: classThematic,
    signatureMoves: loreEntry.signatureMoves || [],
    media: loreEntry.media || [],
    class: className,
    archetype: card.archetype || className,
    element: combat.element || card.element || '',
    tier: tier,
    hp: hp,
    stamina: stamina,
    combatStats: combatStats,
    weakness: combat.weakness || '',
    rewardLabel: combat.reward && combat.reward.label || '',
    traits: traits,
    metaDescription: metaDescription,
    canonicalUrl: canonicalUrl,
    absoluteOgImage: absoluteOgImage,
    datePublished: '2026-05-05',
    dateModified: new Date().toISOString().slice(0, 10),
    prev: neighbors.prev,
    next: neighbors.next
  };
}

function validateContext(ctx) {
  const errors = [];
  const required = ['name', 'tagline', 'bio', 'domainDescription', 'strengthsProse', 'weaknessesProse', 'classThematic'];
  required.forEach(function (k) {
    if (!ctx[k] || String(ctx[k]).trim().length === 0) {
      errors.push(ctx.slug + ': missing or empty ' + k);
    }
  });
  if (!ctx.signatureMoves || !ctx.signatureMoves.length) {
    errors.push(ctx.slug + ': no signature moves');
  }
  if (!ctx.media || !ctx.media.length) {
    errors.push(ctx.slug + ': no media');
  }
  return errors;
}

function ensureOut() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
}

function writeFile(file, contents) {
  if (checkOnly) {
    console.log('  [check] would write', path.relative(ROOT, file), '(' + contents.length + ' bytes)');
    return;
  }
  fs.writeFileSync(file, contents, 'utf8');
  console.log('  wrote', path.relative(ROOT, file), '(' + contents.length + ' bytes)');
}

function main() {
  console.log('Building Blindspot Boss Gallery…');
  const sources = loadAll();
  const lore = sources.lore.bosses || [];
  if (!lore.length) {
    console.error('boss-lore.json has no bosses[] entries');
    process.exit(1);
  }
  ensureOut();

  // Pre-compute neighbors for prev/next nav.
  const neighbors = lore.map(function (b, i) {
    return {
      prev: i > 0 ? { slug: lore[i - 1].slug, name: lore[i - 1].slug } : null,
      next: i < lore.length - 1 ? { slug: lore[i + 1].slug, name: lore[i + 1].slug } : null
    };
  });

  // Build all contexts first so neighbor names are real boss names not slugs.
  const contexts = lore.map(function (b, i) {
    return buildContext(b, sources, { prev: null, next: null });
  });
  // Patch neighbor refs to use real names.
  contexts.forEach(function (c, i) {
    c.prev = i > 0 ? { slug: contexts[i - 1].slug, name: contexts[i - 1].name } : null;
    c.next = i < contexts.length - 1 ? { slug: contexts[i + 1].slug, name: contexts[i + 1].name } : null;
  });

  // Validate.
  const allErrors = [];
  contexts.forEach(function (ctx) {
    allErrors.push.apply(allErrors, validateContext(ctx));
  });
  if (allErrors.length) {
    console.error('\nValidation errors:');
    allErrors.forEach(function (e) { console.error('  ' + e); });
    if (checkOnly) {
      console.error('\n--check failed: ' + allErrors.length + ' issues');
      process.exit(2);
    } else {
      console.error('\nProceeding anyway. Fix above before deploy.');
    }
  }

  // Per-boss pages.
  let written = 0;
  contexts.forEach(function (ctx) {
    if (onlySlug && ctx.slug !== onlySlug) return;
    const html = pageTemplate.render(ctx);
    writeFile(path.join(OUT, ctx.slug + '.html'), html);
    written++;
  });

  // Index page (skip if --only is set on a single boss).
  if (!onlySlug) {
    const indexHtml = indexTemplate.render({ bosses: contexts });
    writeFile(path.join(OUT, 'index.html'), indexHtml);
    written++;
  }

  console.log('\nDone. ' + written + ' file' + (written === 1 ? '' : 's') + (checkOnly ? ' would be written.' : ' written to ' + path.relative(ROOT, OUT)));
  if (allErrors.length && !checkOnly) {
    console.log('Validation issues: ' + allErrors.length);
  }
}

main();
