// Boss Gallery index page renderer.
// Consumed by scripts/build-boss-pages.js. Returns the HTML for the
// gallery index showing all 10 campaign bosses as tiles.

'use strict';

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function tileHtml(boss) {
  const heroImg = (boss.media || []).find(function (m) { return m.isHero; }) || (boss.media || [])[0] || {};
  const heroVideo = (boss.media || []).find(function (m) { return m.type === 'video'; });
  return '<a class="bg-tile" href="/blindspot/bosses/' + escHtml(boss.slug) + '/" data-tier="' + escHtml(String(boss.tier || 1)) + '">'
    + '<div class="bg-tile__media">'
      + '<img class="bg-tile__img" src="' + escHtml(heroImg.src || '') + '" alt="' + escHtml(boss.name) + '" loading="lazy">'
      + (heroVideo ? '<video class="bg-tile__video" muted loop playsinline preload="none" poster="' + escHtml(heroVideo.poster || heroImg.src || '') + '" aria-hidden="true"><source src="' + escHtml(heroVideo.src) + '" type="video/webm"></video>' : '')
      + '<span class="bg-tile__num">' + (boss.bossNumber ? String(boss.bossNumber).padStart(2, '0') : '') + '</span>'
    + '</div>'
    + '<div class="bg-tile__body">'
      + '<div class="bg-tile__chips">'
        + '<span class="bg-page__chip bg-page__chip--tier" data-tier="' + escHtml(String(boss.tier || 1)) + '">Tier ' + escHtml(String(boss.tier || 1)) + '</span>'
        + elementBadge(boss.element)
      + '</div>'
      + '<h2 class="bg-tile__name">' + escHtml(boss.name) + '</h2>'
      + '<p class="bg-tile__tagline">' + escHtml(boss.tagline || '') + '</p>'
      + '<span class="bg-tile__cta">Read the dossier <i class="fas fa-arrow-right" aria-hidden="true"></i></span>'
    + '</div>'
    + '</a>';
}

function jsonLd(bosses) {
  const items = bosses.map(function (b, i) {
    return {
      '@type': 'ListItem',
      position: i + 1,
      name: b.name,
      url: 'https://www.ambientpixels.ai/blindspot/bosses/' + b.slug + '/'
    };
  });
  const data = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Blindspot Boss Gallery',
    description: 'Complete dossier on every campaign boss in Blindspot — lore, combat strengths, weaknesses, and signature moves.',
    url: 'https://www.ambientpixels.ai/blindspot/bosses/',
    numberOfItems: bosses.length,
    itemListElement: items
  };
  return '<script type="application/ld+json">' + JSON.stringify(data, null, 2) + '<\/script>';
}

function breadcrumbLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'AmbientPixels', item: 'https://www.ambientpixels.ai/' },
      { '@type': 'ListItem', position: 2, name: 'Blindspot', item: 'https://www.ambientpixels.ai/blindspot/' },
      { '@type': 'ListItem', position: 3, name: 'Boss Gallery', item: 'https://www.ambientpixels.ai/blindspot/bosses/' }
    ]
  };
  return '<script type="application/ld+json">' + JSON.stringify(data, null, 2) + '<\/script>';
}

function render(ctx) {
  const description = 'Complete dossier on every campaign boss in Blindspot — lore, strengths, weaknesses, and signature moves for all 10 challenges.';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Boss Gallery — Blindspot</title>
  <meta name="description" content="${escHtml(description)}">
  <link rel="canonical" href="https://www.ambientpixels.ai/blindspot/bosses/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Boss Gallery — Blindspot">
  <meta property="og:description" content="${escHtml(description)}">
  <meta property="og:url" content="https://www.ambientpixels.ai/blindspot/bosses/">
  <meta property="og:image" content="https://www.ambientpixels.ai/blindspot/img/og-blindspot.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Boss Gallery — Blindspot">
  <meta name="twitter:description" content="${escHtml(description)}">
  <meta name="twitter:image" content="https://www.ambientpixels.ai/blindspot/img/og-blindspot.png">
  ${jsonLd(ctx.bosses)}
  ${breadcrumbLd()}
  <link rel="icon" href="/images/favicon.ico" type="image/x-icon">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous">
  <link rel="stylesheet" href="/blindspot/css/blindspot-tokens.css">
  <link rel="stylesheet" href="/blindspot/bosses/bosses.css">
</head>
<body class="bg-page bg-page--index">
  <header class="bg-topbar">
    <a class="bg-topbar__brand" href="/blindspot/" aria-label="Blindspot home">
      <i class="fas fa-eye-slash" aria-hidden="true"></i>
      <span>Blindspot</span>
    </a>
    <nav class="bg-topbar__nav" aria-label="Boss Gallery navigation">
      <a class="bg-topbar__link" href="/blindspot/bosses/" aria-current="page">Boss Gallery</a>
      <a class="bg-topbar__link bg-topbar__link--play" href="/blindspot/play.html">Play <i class="fas fa-arrow-right" aria-hidden="true"></i></a>
    </nav>
  </header>

  <main class="bg-index">
    <section class="bg-index__hero">
      <p class="bg-index__eyebrow">Blindspot · Campaign Codex</p>
      <h1 class="bg-index__title">Boss Gallery</h1>
      <p class="bg-index__lede">Ten challenges stand between a fresh fighter and the Forge Eternal. Every one of them has a tell, a story, and a weakness — if you know where to look.</p>
    </section>
    <section class="bg-grid" aria-label="All campaign bosses">
      ${ctx.bosses.map(tileHtml).join('\n      ')}
    </section>
  </main>

  <footer class="bg-footer">
    <div class="bg-footer__inner">
      <a class="bg-footer__brand" href="/blindspot/">
        <i class="fas fa-eye-slash" aria-hidden="true"></i> Blindspot
      </a>
      <p class="bg-footer__copy">A card arena combat game by <a href="https://www.ambientpixels.ai/">AmbientPixels</a>.</p>
    </div>
  </footer>

  <script>
  // Hover-to-play tile videos. Pure JS so no extra deps.
  document.querySelectorAll('.bg-tile').forEach(function (tile) {
    var v = tile.querySelector('.bg-tile__video');
    if (!v) return;
    tile.addEventListener('mouseenter', function () { v.play().catch(function(){}); });
    tile.addEventListener('mouseleave', function () { v.pause(); v.currentTime = 0; });
    tile.addEventListener('focusin', function () { v.play().catch(function(){}); });
    tile.addEventListener('focusout', function () { v.pause(); v.currentTime = 0; });
  });
  </script>
</body>
</html>
`;
}

module.exports = { render };
