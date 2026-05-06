// Per-boss page renderer for the Blindspot Boss Gallery.
// Consumed by scripts/build-boss-pages.js. Returns the full HTML string
// for one boss page given the merged context (lore + combat + card +
// adventure data) prepared by the build script.

'use strict';

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphs(text) {
  return String(text || '')
    .split(/\n\n+/)
    .map(function (p) { return p.trim(); })
    .filter(Boolean)
    .map(function (p) { return '<p>' + escHtml(p) + '</p>'; })
    .join('\n        ');
}

function elementBadge(element) {
  const def = {
    fire: { icon: 'fa-fire', label: 'Fire' },
    earth: { icon: 'fa-mountain', label: 'Earth' },
    arcane: { icon: 'fa-wand-sparkles', label: 'Arcane' },
    shadow: { icon: 'fa-moon', label: 'Shadow' },
    chaos: { icon: 'fa-asterisk', label: 'Chaos' }
  }[String(element || '').toLowerCase()];
  if (!def) return '<span class="bg-page__chip">' + escHtml(element || '—') + '</span>';
  return '<span class="bg-page__chip bg-page__chip--el bg-page__chip--el-' + escHtml(element) + '"><i class="fas ' + def.icon + '" aria-hidden="true"></i> ' + def.label + '</span>';
}

function tierLabel(tier) {
  const n = Number(tier) || 1;
  const names = ['', 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5'];
  return names[n] || ('Tier ' + n);
}

function statRow(label, value) {
  return '<div class="bg-stat"><span class="bg-stat__label">' + escHtml(label) + '</span><span class="bg-stat__value">' + escHtml(String(value)) + '</span></div>';
}

function signatureMovesHtml(moves) {
  if (!Array.isArray(moves) || !moves.length) return '';
  return moves.map(function (m) {
    return '<article class="bg-move">'
      + '<h3 class="bg-move__name">' + escHtml(m.name || '—') + '</h3>'
      + '<p class="bg-move__desc">' + escHtml(m.description || '') + '</p>'
      + '</article>';
  }).join('\n          ');
}

function traitsHtml(traits) {
  if (!Array.isArray(traits) || !traits.length) return '';
  return traits.map(function (t) {
    return '<li class="bg-trait"><strong>' + escHtml(t.name || '') + '.</strong> ' + escHtml(t.desc || '') + '</li>';
  }).join('\n            ');
}

function mediaGalleryHtml(media) {
  if (!Array.isArray(media)) return '';
  return media.filter(function (m) { return !m.isHero; }).map(function (m) {
    if (m.type === 'video') {
      return '<figure class="bg-media bg-media--video">'
        + '<video class="bg-media__video" muted loop playsinline preload="none" poster="' + escHtml(m.poster || '') + '" onmouseenter="this.play().catch(()=>{})" onmouseleave="this.pause();this.currentTime=0;">'
        + '<source src="' + escHtml(m.src) + '" type="video/webm">'
        + '</video>'
        + (m.alt ? '<figcaption class="bg-media__cap">' + escHtml(m.alt) + '</figcaption>' : '')
        + '</figure>';
    }
    return '<figure class="bg-media bg-media--image">'
      + '<img class="bg-media__img" src="' + escHtml(m.src) + '" alt="' + escHtml(m.alt || '') + '" loading="lazy">'
      + (m.alt ? '<figcaption class="bg-media__cap">' + escHtml(m.alt) + '</figcaption>' : '')
      + '</figure>';
  }).join('\n          ');
}

function jsonLd(ctx) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: ctx.name + ' — Blindspot Boss Guide',
    description: ctx.metaDescription,
    url: ctx.canonicalUrl,
    image: ctx.absoluteOgImage,
    datePublished: ctx.datePublished,
    dateModified: ctx.dateModified,
    author: { '@type': 'Organization', '@id': 'https://www.ambientpixels.ai/#org', name: 'AmbientPixels' },
    publisher: { '@type': 'Organization', '@id': 'https://www.ambientpixels.ai/#org' },
    isPartOf: { '@type': 'VideoGame', '@id': 'https://www.ambientpixels.ai/blindspot/#game', name: 'Blindspot' },
    about: {
      '@type': 'Thing',
      name: ctx.name,
      description: ctx.tagline
    }
  };
  return '<script type="application/ld+json">' + JSON.stringify(data, null, 2) + '<\/script>';
}

function breadcrumbLd(ctx) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'AmbientPixels', item: 'https://www.ambientpixels.ai/' },
      { '@type': 'ListItem', position: 2, name: 'Blindspot', item: 'https://www.ambientpixels.ai/blindspot/' },
      { '@type': 'ListItem', position: 3, name: 'Boss Gallery', item: 'https://www.ambientpixels.ai/blindspot/bosses/' },
      { '@type': 'ListItem', position: 4, name: ctx.name, item: ctx.canonicalUrl }
    ]
  };
  return '<script type="application/ld+json">' + JSON.stringify(data, null, 2) + '<\/script>';
}

function navHtml(prev, next) {
  const parts = [];
  if (prev) {
    parts.push('<a class="bg-nav-link bg-nav-link--prev" href="/blindspot/bosses/' + escHtml(prev.slug) + '/" rel="prev">'
      + '<span class="bg-nav-link__eyebrow"><i class="fas fa-chevron-left" aria-hidden="true"></i> Previous boss</span>'
      + '<span class="bg-nav-link__name">' + escHtml(prev.name) + '</span>'
      + '</a>');
  }
  if (next) {
    parts.push('<a class="bg-nav-link bg-nav-link--next" href="/blindspot/bosses/' + escHtml(next.slug) + '/" rel="next">'
      + '<span class="bg-nav-link__eyebrow">Next boss <i class="fas fa-chevron-right" aria-hidden="true"></i></span>'
      + '<span class="bg-nav-link__name">' + escHtml(next.name) + '</span>'
      + '</a>');
  }
  return parts.join('\n        ');
}

function render(ctx) {
  const heroImg = (ctx.media || []).find(function (m) { return m.isHero; }) || (ctx.media || [])[0] || {};
  const heroVideo = (ctx.media || []).find(function (m) { return m.type === 'video'; });
  const prevLink = ctx.prev ? '<link rel="prev" href="https://www.ambientpixels.ai/blindspot/bosses/' + escHtml(ctx.prev.slug) + '/">' : '';
  const nextLink = ctx.next ? '<link rel="next" href="https://www.ambientpixels.ai/blindspot/bosses/' + escHtml(ctx.next.slug) + '/">' : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(ctx.name)} — Blindspot Boss Guide</title>
  <meta name="description" content="${escHtml(ctx.metaDescription)}">
  <link rel="canonical" href="${escHtml(ctx.canonicalUrl)}">
  ${prevLink}
  ${nextLink}
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escHtml(ctx.name)} — Blindspot Boss Guide">
  <meta property="og:description" content="${escHtml(ctx.metaDescription)}">
  <meta property="og:url" content="${escHtml(ctx.canonicalUrl)}">
  <meta property="og:image" content="${escHtml(ctx.absoluteOgImage)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escHtml(ctx.name)} — Blindspot Boss Guide">
  <meta name="twitter:description" content="${escHtml(ctx.metaDescription)}">
  <meta name="twitter:image" content="${escHtml(ctx.absoluteOgImage)}">
  ${jsonLd(ctx)}
  ${breadcrumbLd(ctx)}
  <link rel="icon" href="/images/favicon.ico" type="image/x-icon">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous">
  <link rel="stylesheet" href="/blindspot/css/blindspot-tokens.css">
  <link rel="stylesheet" href="/blindspot/bosses/bosses.css">
</head>
<body class="bg-page" data-element="${escHtml(ctx.element || '')}" data-tier="${escHtml(String(ctx.tier || 1))}">
  <header class="bg-topbar">
    <a class="bg-topbar__brand" href="/blindspot/" aria-label="Blindspot home">
      <i class="fas fa-eye-slash" aria-hidden="true"></i>
      <span>Blindspot</span>
    </a>
    <nav class="bg-topbar__nav" aria-label="Boss Gallery navigation">
      <a class="bg-topbar__link" href="/blindspot/bosses/">Boss Gallery</a>
      <a class="bg-topbar__link bg-topbar__link--play" href="/blindspot/play.html">Play <i class="fas fa-arrow-right" aria-hidden="true"></i></a>
    </nav>
  </header>

  <article class="bg-article">
    <section class="bg-hero" aria-labelledby="bg-hero-name">
      <div class="bg-hero__media">
        <img class="bg-hero__img" src="${escHtml(heroImg.src || '')}" alt="${escHtml(heroImg.alt || ctx.name)}">
        ${heroVideo ? `<video class="bg-hero__video" muted loop playsinline preload="none" poster="${escHtml(heroVideo.poster || heroImg.src || '')}" aria-hidden="true">
          <source src="${escHtml(heroVideo.src)}" type="video/webm">
        </video>` : ''}
        <div class="bg-hero__veil" aria-hidden="true"></div>
      </div>
      <div class="bg-hero__body">
        <div class="bg-hero__chips">
          <span class="bg-page__chip bg-page__chip--tier" data-tier="${escHtml(String(ctx.tier || 1))}">${escHtml(tierLabel(ctx.tier))}</span>
          <span class="bg-page__chip">${escHtml(ctx.archetype || ctx.class || '')}</span>
          ${elementBadge(ctx.element)}
        </div>
        <h1 class="bg-hero__name" id="bg-hero-name">${escHtml(ctx.name)}</h1>
        <p class="bg-hero__tagline">${escHtml(ctx.tagline || '')}</p>
      </div>
    </section>

    <section class="bg-stats" aria-label="Combat reference">
      <div class="bg-stats__grid">
        ${statRow('HP', ctx.hp)}
        ${statRow('Stamina', ctx.stamina)}
        ${statRow('Class', ctx.class)}
        ${statRow('Element', String(ctx.element || '').replace(/^./, function (c) { return c.toUpperCase(); }))}
        ${statRow('Weakness', String(ctx.weakness || '—').toUpperCase())}
        ${statRow('First-kill reward', ctx.rewardLabel || '—')}
      </div>
      <div class="bg-stats__bars">
        ${['str','agi','int','end','lck'].map(function (k) {
          const val = (ctx.combatStats && ctx.combatStats[k]) || 0;
          const pct = Math.min(100, Math.max(0, (val / 20) * 100));
          return '<div class="bg-bar"><span class="bg-bar__label">' + k.toUpperCase() + '</span><span class="bg-bar__track"><span class="bg-bar__fill" style="width:' + pct.toFixed(1) + '%"></span></span><span class="bg-bar__num">' + val + '</span></div>';
        }).join('\n        ')}
      </div>
    </section>

    <section class="bg-section">
      <h2 class="bg-section__title">Who they are</h2>
      <div class="bg-section__body">
        ${paragraphs(ctx.bio)}
      </div>
    </section>

    <section class="bg-section">
      <h2 class="bg-section__title">${escHtml(ctx.domainName || 'Domain')}</h2>
      <div class="bg-section__body">
        ${paragraphs(ctx.domainDescription)}
      </div>
    </section>

    <section class="bg-dossier" aria-label="Combat dossier">
      <div class="bg-dossier__col">
        <h2 class="bg-dossier__title"><i class="fas fa-shield-halved" aria-hidden="true"></i> Strengths</h2>
        ${paragraphs(ctx.strengthsProse)}
      </div>
      <div class="bg-dossier__col">
        <h2 class="bg-dossier__title"><i class="fas fa-bullseye" aria-hidden="true"></i> Weaknesses</h2>
        ${paragraphs(ctx.weaknessesProse)}
      </div>
      <div class="bg-dossier__col">
        <h2 class="bg-dossier__title"><i class="fas fa-fire" aria-hidden="true"></i> Signature moves</h2>
        <div class="bg-moves">
          ${signatureMovesHtml(ctx.signatureMoves)}
        </div>
        ${ctx.traits && ctx.traits.length ? '<h3 class="bg-dossier__sub">Card traits</h3><ul class="bg-traits">' + traitsHtml(ctx.traits) + '</ul>' : ''}
      </div>
    </section>

    <section class="bg-section">
      <h2 class="bg-section__title">The ${escHtml(ctx.class || 'class')} archetype</h2>
      <div class="bg-section__body">
        <p>${escHtml(ctx.classThematic || '')}</p>
      </div>
    </section>

    ${(ctx.media || []).filter(function (m) { return !m.isHero; }).length ? `<section class="bg-section bg-section--gallery">
      <h2 class="bg-section__title">Gallery</h2>
      <div class="bg-gallery">
        ${mediaGalleryHtml(ctx.media)}
      </div>
    </section>` : ''}

    <nav class="bg-nav" aria-label="Adjacent bosses">
      <a class="bg-nav-link bg-nav-link--gallery" href="/blindspot/bosses/">
        <i class="fas fa-th" aria-hidden="true"></i> All bosses
      </a>
      ${navHtml(ctx.prev, ctx.next)}
    </nav>
  </article>

  <footer class="bg-footer">
    <div class="bg-footer__inner">
      <a class="bg-footer__brand" href="/blindspot/">
        <i class="fas fa-eye-slash" aria-hidden="true"></i> Blindspot
      </a>
      <p class="bg-footer__copy">A card arena combat game by <a href="https://www.ambientpixels.ai/">AmbientPixels</a>.</p>
    </div>
  </footer>
</body>
</html>
`;
}

module.exports = { render };
