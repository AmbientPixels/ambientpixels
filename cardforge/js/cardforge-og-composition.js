/**
 * CardForge OG composition builder.
 *
 * Pure DOM constructor — no side effects, no DOM mounting. Caller mounts
 * the returned node off-screen (via .cf-og-offscreen wrapper), waits for
 * paint + image decode, captures via modern-screenshot, then removes
 * the node.
 *
 * Public API: window.buildOgComposition(cardData) -> HTMLElement
 *
 * cardData fields used (all optional, fail-soft):
 *   - name              : card name (top-right)
 *   - authorName        : creator handle (under name)
 *   - stats             : [{ name, value, ... }] freeform stats array
 *                         (top 3 by value rendered as pills)
 *   - renderedFront     : innerHTML snapshot of .card-front from the
 *                         editor preview (captured at save/publish)
 *   - frontClasses      : className of that same .card-front element
 *
 * If renderedFront/frontClasses are absent, the left zone renders empty.
 * The caller can detect via composition.querySelector('.card-front')
 * and decide whether to abort capture.
 */
(function () {
  'use strict';

  const TAGLINE = 'Design · Customize · Share';
  const URL_LINE = 'ambientpixels.ai/cardforge/';

  function pickTopStats(cardData) {
    // Freeform stats[] only — combatStats was removed in April 2026.
    const stats = cardData && cardData.stats;
    if (!Array.isArray(stats)) return [];
    return stats
      .filter(s => s && s.name && typeof s.value === 'number')
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map(s => ({
        name: String(s.name).toUpperCase().slice(0, 4),
        value: s.value
      }));
  }

  function getAuthorHandle(cardData) {
    const raw =
      (cardData && (cardData.authorName || cardData.author || cardData.creatorName)) || '';
    const trimmed = String(raw).trim();
    if (!trimmed) return '';
    const handle = trimmed.replace(/^@/, '');
    return '@' + (handle.length > 24 ? handle.slice(0, 24) + '…' : handle);
  }

  /**
   * Build a 1200x630 composition for cardData.
   * Returns a detached HTMLElement. Caller is responsible for mount/cleanup.
   */
  function buildOgComposition(cardData) {
    cardData = cardData || {};

    const canvas = document.createElement('div');
    canvas.className = 'cf-og-canvas';

    // --- LEFT ZONE: card preview ---
    const left = document.createElement('div');
    left.className = 'cf-og-canvas__left';

    const cardWrap = document.createElement('div');
    cardWrap.className = 'cf-og-canvas__card';

    // Inject the captured front-face HTML directly. Same path the
    // lightbox uses (cardforge-lightbox.js renderCard), so any card with
    // renderedFront/frontClasses on its data renders identically here.
    if (cardData.renderedFront && cardData.frontClasses) {
      // frontClasses already contains "card-front" + modular classes
      // (palette, container, effects, glow, name shadow). cardforge-card.css
      // styles them. innerHTML safe here because the source is our own
      // editor's serialized DOM, not user input.
      cardWrap.innerHTML =
        '<div class="' + cardData.frontClasses + '">' + cardData.renderedFront + '</div>';
    }

    left.appendChild(cardWrap);
    canvas.appendChild(left);

    // --- RIGHT ZONE: brand + name + stats + tagline ---
    const right = document.createElement('div');
    right.className = 'cf-og-canvas__right';

    // Top: eyebrow + wordmark
    const topBlock = document.createElement('div');
    const eyebrow = document.createElement('p');
    eyebrow.className = 'cf-og-canvas__eyebrow';
    eyebrow.textContent = 'CardForge';
    const wordmark = document.createElement('h2');
    wordmark.className = 'cf-og-canvas__wordmark';
    wordmark.innerHTML = 'Card<span class="ember-text">Forge</span>';
    topBlock.appendChild(eyebrow);
    topBlock.appendChild(wordmark);
    right.appendChild(topBlock);

    // Middle: name + author + stats
    const middleBlock = document.createElement('div');
    const name = document.createElement('h1');
    name.className = 'cf-og-canvas__name';
    name.textContent = String(cardData.name || 'Untitled Card');
    middleBlock.appendChild(name);

    const handle = getAuthorHandle(cardData);
    if (handle) {
      const author = document.createElement('p');
      author.className = 'cf-og-canvas__author';
      author.textContent = handle;
      middleBlock.appendChild(author);
    }

    const topStats = pickTopStats(cardData);
    if (topStats.length) {
      const statsRow = document.createElement('div');
      statsRow.className = 'cf-og-canvas__stats';
      topStats.forEach(s => {
        const pill = document.createElement('span');
        pill.className = 'cf-og-canvas__stat';
        pill.innerHTML =
          '<span class="cf-og-canvas__stat-name">' + s.name + '</span>' + s.value;
        statsRow.appendChild(pill);
      });
      middleBlock.appendChild(statsRow);
    }
    right.appendChild(middleBlock);

    // Bottom: tagline + URL
    const bottomBlock = document.createElement('div');
    const tagline = document.createElement('p');
    tagline.className = 'cf-og-canvas__tagline';
    tagline.textContent = TAGLINE;
    const url = document.createElement('p');
    url.className = 'cf-og-canvas__url';
    url.textContent = URL_LINE;
    bottomBlock.appendChild(tagline);
    bottomBlock.appendChild(url);
    right.appendChild(bottomBlock);

    canvas.appendChild(right);
    return canvas;
  }

  window.buildOgComposition = buildOgComposition;
})();
