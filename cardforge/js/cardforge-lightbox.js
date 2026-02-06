/**
 * CardForge Lightbox — Gallery card viewer with flip + navigation + shareable URLs
 * Created: 2025-02-05
 */
(function () {
  'use strict';

  // ===== STATE =====
  let galleryCards = [];
  let currentIndex = -1;
  let isFlipped = false;

  // ===== DOM REFS (resolved lazily) =====
  function el(id) { return document.getElementById(id); }

  // ===== ICON MAPS (mirror card-forge-editor.js) =====
  const socialIconMap = {
    twitter: 'fab fa-twitter',
    github: 'fab fa-github',
    instagram: 'fab fa-instagram',
    linkedin: 'fab fa-linkedin',
    x: 'fab fa-x-twitter',
    deviantart: 'fab fa-deviantart',
    facebook: 'fab fa-facebook',
    discord: 'fab fa-discord',
    tiktok: 'fab fa-tiktok'
  };

  const badgeIconMap = {
    star: 'fas fa-star',
    trophy: 'fas fa-trophy',
    medal: 'fas fa-medal',
    crown: 'fas fa-crown',
    shield: 'fas fa-shield-alt',
    gem: 'fas fa-gem',
    fire: 'fas fa-fire',
    heart: 'fas fa-heart',
    bolt: 'fas fa-bolt',
    target: 'fas fa-bullseye'
  };

  // ===== HTML GENERATORS =====
  function statsHTML(stats) {
    if (!stats || stats.length === 0) return '';
    return stats.map(s => {
      const pct = Math.min(s.value, 100);
      return `
        <div class="stat-item">
          <div class="stat-label">${s.name} <span class="stat-value">${s.value}</span></div>
          <div class="stat-bar">
            <div class="stat-progress" style="--target-width: ${pct}%"></div>
          </div>
        </div>`;
    }).join('');
  }

  function badgesHTML(badges) {
    if (!badges || badges.length === 0) return '';
    return badges.map(b => {
      const iconClass = badgeIconMap[b.icon] || 'fas fa-award';
      const icons = Array.from({ length: b.quantity || 1 }, () => `<i class="${iconClass}"></i>`).join('');
      return `
        <div class="badge-item" title="${b.description || b.category}">
          <div class="badge-icon">${icons}</div>
          <div class="badge-label">${b.category}</div>
        </div>`;
    }).join('');
  }

  function attributesHTML(attrs) {
    if (!attrs || attrs.length === 0) return '';
    return attrs.map(a => `
      <div class="attribute-item">
        <span class="attribute-key">${a.name}</span>
        <span class="attribute-value">${a.value}</span>
      </div>`).join('');
  }

  function socialHTML(links) {
    if (!links || links.length === 0) return '';
    return links.map(s => {
      const iconClass = socialIconMap[s.platform] || 'fas fa-link';
      const name = s.platform.charAt(0).toUpperCase() + s.platform.slice(1);
      return `<a href="${s.url}" target="_blank" rel="noopener noreferrer" class="social-link" title="Visit ${name}"><i class="${iconClass}"></i></a>`;
    }).join('');
  }

  // ===== MODULAR DEFAULTS (mirrors ModularState in card-forge-editor.js) =====
  const MODULAR_DEFAULTS = {
    horizontalAlignment: 'center',
    verticalAlignment: 'middle',
    alignmentWeight: 'balanced',
    alignmentStyle: 'padded',
    palette: 'neon',
    paletteVariant: 'light',
    textColor: 'auto',
    imageContainer: 'masked',
    imageContainerVariant: 'circle',
    imageEffect: 'none',
    imageEffectVariant: 'clean'
  };

  function buildModularClasses(design) {
    const s = Object.assign({}, MODULAR_DEFAULTS, design || {});
    return [
      `align-${s.horizontalAlignment}`,
      `align-vertical-${s.verticalAlignment}`,
      `align-weight-${s.alignmentWeight}`,
      `align-style-${s.alignmentStyle}`,
      `palette-${s.palette}`,
      `variant-${s.paletteVariant}`,
      `text-${s.textColor}`,
      `container-${s.imageContainer}`,
      `container-variant-${s.imageContainerVariant}`,
      `effect-${s.imageEffect}`,
      `effect-variant-${s.imageEffectVariant}`
    ].join(' ');
  }

  function buildDataAttributes(design, rarity) {
    const s = Object.assign({}, MODULAR_DEFAULTS, design || {});
    return [
      `data-alignment-type="${s.horizontalAlignment}"`,
      `data-alignment-weight="${s.alignmentWeight}"`,
      `data-alignment-style="${s.alignmentStyle}"`,
      `data-palette="${s.palette}"`,
      `data-palette-variant="${s.paletteVariant}"`,
      `data-image-container="${s.imageContainer}"`,
      `data-image-container-variant="${s.imageContainerVariant}"`,
      `data-image-effect="${s.imageEffect}"`,
      `data-image-effect-variant="${s.imageEffectVariant}"`,
      `data-rarity="${(rarity || '').toLowerCase()}"`
    ].join(' ');
  }

  // ===== CARD RENDERING =====

  // Try to find a richer version of the card from localStorage (has rendered HTML)
  function enrichFromLocal(card) {
    try {
      const saved = JSON.parse(localStorage.getItem('cardforge_saved_cards') || '[]');
      const match = saved.find(c => c.id === card.id);
      if (match && match.cardData && match.cardData.renderedFront) {
        console.log('🔍 [LIGHTBOX] Enriched card from localStorage');
        return match;
      }
    } catch (e) { /* ignore */ }
    return card;
  }

  function renderCard(card) {
    // Try localStorage first for richer card data with rendered HTML
    card = enrichFromLocal(card);
    const d = card.cardData || card;
    const name = d.name || card.name || 'Untitled Card';

    const container = el('lightbox-card-container');
    if (!container) return;

    // DEBUG: Log what data the lightbox receives
    console.log('🔍 [LIGHTBOX] card keys:', Object.keys(card));
    console.log('🔍 [LIGHTBOX] d keys:', Object.keys(d));
    console.log('🔍 [LIGHTBOX] has renderedFront:', !!d.renderedFront);
    console.log('🔍 [LIGHTBOX] has frontClasses:', !!d.frontClasses);
    console.log('🔍 [LIGHTBOX] has cardData:', !!card.cardData);

    // PRIMARY PATH: Use stored rendered HTML captured from the preview at save time
    if (d.renderedFront && d.frontClasses) {
      console.log('✅ [LIGHTBOX] Using STORED rendered HTML');
      const frontCls = d.frontClasses;
      const backCls = d.backClasses || d.frontClasses;
      container.innerHTML = `
        <div class="card-preview-canvas" style="perspective:1000px;">
          <div class="card-inner${isFlipped ? ' flipped' : ''}">
            <div class="${frontCls}">${d.renderedFront}</div>
            <div class="${backCls}">${d.renderedBack || ''}</div>
          </div>
        </div>`;
    } else {
      // FALLBACK: Re-render from data for legacy cards without stored HTML
      console.log('⚠️ [LIGHTBOX] FALLBACK: No stored HTML, re-rendering from data');
      const design = d.design || null;
      const modClasses = buildModularClasses(design);
      const dataAttrs = buildDataAttributes(design, d.rarity || card.rarity || '');
      const avatar = d.avatar || card.avatar || '';
      const charClass = d.characterClass || card.characterClass || '';
      const rarity = d.rarity || card.rarity || '';
      const quote = d.quote || card.quote || '';
      const bio = d.biography || '';
      const stats = d.stats || [];
      const badges = d.badges || [];
      const attributes = d.attributes || [];
      const socialLinks = d.socialLinks || [];
      const fallbackImg = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjE4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWExYTJlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzAwZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkNhcmQgSW1hZ2U8L3RleHQ+PC9zdmc+";

      const frontHTML = `
        <div class="card-hero-header">
          <div class="hero-image-container">
            <img src="${avatar}" alt="${name}" class="card-avatar" onerror="this.src='${fallbackImg}'" />
            <div class="hero-overlay">
              <h3 class="card-name">${name}</h3>
            </div>
          </div>
        </div>
        <div class="card-body">
          ${charClass ? `<div class="card-class">${charClass}</div>` : ''}
          ${rarity ? `<div class="card-rarity">${rarity}</div>` : ''}
          ${quote ? `<div class="card-quote">"${quote}"</div>` : ''}
          <div class="card-stats">${statsHTML(stats)}</div>
        </div>`;

      const backHTML = `
        <div class="card-back-content">
          <div class="back-header">
            <h3 class="card-name">${name}</h3>
            ${charClass ? `<div class="card-class">${charClass}</div>` : ''}
          </div>
          <div class="back-body">
            ${bio ? `
            <div class="biography-section">
              <h4 class="section-title">Biography</h4>
              <div class="biography-text">${bio}</div>
            </div>` : ''}
            <div class="info-grid">
              ${badges.length ? `
              <div class="back-section badges-section">
                <h4 class="section-title">Badges & Achievements</h4>
                <div class="badges-container">${badgesHTML(badges)}</div>
              </div>` : ''}
              ${attributes.length ? `
              <div class="back-section attributes-section">
                <h4 class="section-title">Attributes</h4>
                <div class="attributes-container">${attributesHTML(attributes)}</div>
              </div>` : ''}
            </div>
            ${socialLinks.length ? `
            <div class="social-section">
              <h4 class="section-title">Social Links</h4>
              <div class="social-links">${socialHTML(socialLinks)}</div>
            </div>` : ''}
          </div>
        </div>`;

      container.innerHTML = `
        <div class="card-preview-canvas" style="perspective:1000px;">
          <div class="card-inner${isFlipped ? ' flipped' : ''}">
            <div class="card-preview-canvas card-front ${modClasses}" ${dataAttrs}>${frontHTML}</div>
            <div class="card-preview-canvas card-back ${modClasses}" ${dataAttrs}>${backHTML}</div>
          </div>
        </div>`;
    }

    // Animate stat bars (staggered, mirrors card-forge-editor.js)
    setTimeout(() => {
      container.querySelectorAll('.stat-progress').forEach((bar, i) => {
        bar.classList.remove('animate');
        bar.style.width = '0';
        setTimeout(() => bar.classList.add('animate'), i * 200 + 300);
      });
    }, 100);

    // Update counter
    const counter = el('lightbox-counter');
    if (counter) counter.textContent = `${currentIndex + 1} / ${galleryCards.length}`;

    // Update card title in header
    const title = el('lightbox-card-title');
    if (title) title.textContent = name;
  }

  // ===== NAVIGATION =====
  function navigate(delta) {
    if (galleryCards.length === 0) return;
    isFlipped = false; // reset flip on nav
    currentIndex = (currentIndex + delta + galleryCards.length) % galleryCards.length;
    renderCard(galleryCards[currentIndex]);
    syncURL(galleryCards[currentIndex].id);
  }

  // ===== URL SYNC =====
  function syncURL(cardId) {
    const url = new URL(window.location);
    url.searchParams.set('card', cardId);
    history.replaceState(null, '', url);
  }

  function clearURL() {
    const url = new URL(window.location);
    url.searchParams.delete('card');
    history.replaceState(null, '', url);
  }

  // ===== OPEN / CLOSE =====
  function open(cards, index) {
    galleryCards = cards;
    currentIndex = index;
    isFlipped = false;

    const overlay = el('cardforge-lightbox');
    if (!overlay) return;

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    renderCard(galleryCards[currentIndex]);
    syncURL(galleryCards[currentIndex].id);
  }

  function close() {
    const overlay = el('cardforge-lightbox');
    if (!overlay) return;

    overlay.classList.remove('active');
    document.body.style.overflow = '';
    clearURL();
  }

  function flip() {
    isFlipped = !isFlipped;
    const inner = document.querySelector('#lightbox-card-container .card-inner');
    if (inner) inner.classList.toggle('flipped', isFlipped);
  }

  function share() {
    // Build a direct card link (not the lightbox page URL)
    const card = galleryCards[currentIndex];
    if (!card) return;
    const cardId = card.id || '';
    const origin = window.location.origin;
    const shareUrl = `${origin}/cardforge/?card=${encodeURIComponent(cardId)}`;

    navigator.clipboard.writeText(shareUrl).then(() => {
      const btn = el('lightbox-share');
      if (btn) {
        const icon = btn.querySelector('i');
        if (icon) { icon.className = 'fas fa-check'; }
        btn.title = 'Link copied!';
        setTimeout(() => {
          if (icon) { icon.className = 'fas fa-share-alt'; }
          btn.title = 'Copy Share Link';
        }, 2000);
      }
    }).catch(() => {
      window.prompt('Copy this link to share:', shareUrl);
    });
  }

  // ===== KEYBOARD =====
  function onKeyDown(e) {
    const overlay = el('cardforge-lightbox');
    if (!overlay || !overlay.classList.contains('active')) return;

    switch (e.key) {
      case 'Escape':
        close();
        break;
      case 'ArrowLeft':
        navigate(-1);
        break;
      case 'ArrowRight':
        navigate(1);
        break;
      case 'f':
      case 'F':
        flip();
        break;
    }
  }

  // ===== DEEP LINK =====
  function checkDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const cardId = params.get('card');
    if (!cardId) return;

    // Wait for gallery to load, then open the card
    const tryOpen = (attempts) => {
      if (attempts <= 0) return;
      const grid = document.getElementById('gallery-cards-grid');
      if (!grid || grid.querySelector('.gallery-loading')) {
        setTimeout(() => tryOpen(attempts - 1), 500);
        return;
      }
      // Gallery cards should be cached on the actions instance
      if (window.cardForgeActions && window.cardForgeActions._galleryCards) {
        const cards = window.cardForgeActions._galleryCards;
        const idx = cards.findIndex(c => c.id === cardId);
        if (idx >= 0) {
          open(cards, idx);
          return;
        }
      }
      // Fallback: try loading from API
      loadAndOpenCard(cardId);
    };
    tryOpen(10);
  }

  async function loadAndOpenCard(cardId) {
    try {
      const loadUrl = window.buildApiPath('loadCards');
      const resp = await fetch(loadUrl, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
      if (!resp.ok) return;
      const data = await resp.json();
      const cards = Array.isArray(data?.galleryCards) ? data.galleryCards : [];
      const idx = cards.findIndex(c => c.id === cardId);
      if (idx >= 0) open(cards, idx);
    } catch (e) {
      console.warn('Lightbox deep link failed:', e);
    }
  }

  // ===== INIT =====
  function init() {
    // Bind lightbox buttons
    const closeBtn = el('lightbox-close');
    const prevBtn = el('lightbox-prev');
    const nextBtn = el('lightbox-next');
    const flipBtn = el('lightbox-flip');
    const overlay = el('cardforge-lightbox');

    const shareBtn = el('lightbox-share');

    if (closeBtn) closeBtn.addEventListener('click', close);
    if (prevBtn) prevBtn.addEventListener('click', () => navigate(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => navigate(1));
    if (flipBtn) flipBtn.addEventListener('click', flip);
    if (shareBtn) shareBtn.addEventListener('click', share);

    // Close on backdrop click
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
    }

    // Keyboard
    document.addEventListener('keydown', onKeyDown);

    // Deep link check
    checkDeepLink();

    console.log('🔍 CardForge Lightbox initialized');
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ===== PUBLIC API =====
  window.CardForgeLightbox = { open, close, flip, navigate };
})();
