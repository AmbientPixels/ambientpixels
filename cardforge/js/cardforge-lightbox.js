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
    tiktok: 'fab fa-tiktok',
    youtube: 'fab fa-youtube'
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
  const STAT_CAP = 5; // Max visible stats on card face

  function statsHTML(stats) {
    if (!stats || stats.length === 0) return '';
    const visible = stats.slice(0, STAT_CAP);
    const overflow = stats.length - STAT_CAP;
    let html = visible.map(s => {
      const raw = Number(s.value);
      const v = Number.isFinite(raw) ? raw : 0;
      const pct = Math.max(0, Math.min(100, v));
      return `
        <div class="stat-item">
          <div class="stat-label">${s.name} <span class="stat-value">${Math.round(v)}</span></div>
          <div class="stat-bar">
            <div class="stat-progress" data-target="${pct}" style="width:0%"></div>
          </div>
        </div>`;
    }).join('');
    if (overflow > 0) {
      html += `<div class="stats-overflow-indicator">+${overflow} more</div>`;
    }
    return html;
  }

  const BADGE_CAP = 6; // 2 rows × 3 columns

  function badgesHTML(badges) {
    if (!badges || badges.length === 0) return '';
    const visible = badges.slice(0, BADGE_CAP);
    const overflow = badges.length - BADGE_CAP;
    let html = visible.map(b => {
      const iconClass = badgeIconMap[b.icon] || 'fas fa-award';
      const icons = Array.from({ length: b.quantity || 1 }, () => `<i class="${iconClass}"></i>`).join('');
      return `
        <div class="badge-item" title="${b.description || b.category}">
          <div class="badge-icon">${icons}</div>
          <div class="badge-label">${b.category}</div>
        </div>`;
    }).join('');
    if (overflow > 0) {
      html += `<div class="badges-overflow-indicator">+${overflow} more</div>`;
    }
    return html;
  }

  const ATTRIBUTE_CAP = 6; // Max visible attributes on card face

  function attributesHTML(attrs) {
    if (!attrs || attrs.length === 0) return '';
    const visible = attrs.slice(0, ATTRIBUTE_CAP);
    const overflow = attrs.length - ATTRIBUTE_CAP;
    let html = visible.map(a => `
      <div class="attribute-item">
        <span class="attribute-key">${a.name}</span>
        <span class="attribute-value">${a.value}</span>
      </div>`).join('');
    if (overflow > 0) {
      html += `<div class="attributes-overflow-indicator">+${overflow} more</div>`;
    }
    return html;
  }

  const SOCIAL_CAP = 8; // Max visible social icons on card face

  function socialHTML(links) {
    if (!links || links.length === 0) return '';
    const visible = links.slice(0, SOCIAL_CAP);
    const overflow = links.length - SOCIAL_CAP;
    let html = visible.map(s => {
      const iconClass = socialIconMap[s.platform] || 'fas fa-link';
      const name = s.platform.charAt(0).toUpperCase() + s.platform.slice(1);
      return `<a href="${s.url}" target="_blank" rel="noopener noreferrer" class="social-link" title="Visit ${name}"><i class="${iconClass}"></i></a>`;
    }).join('');
    if (overflow > 0) {
      html += `<span class="social-overflow-indicator" title="${overflow} more links">+${overflow}</span>`;
    }
    return html;
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
    const shared = [
      `palette-${s.palette}`,
      `variant-${s.paletteVariant}`,
      `text-${s.textColor}`,
      `container-${s.imageContainer}`,
      `container-variant-${s.imageContainerVariant}`,
      `effect-${s.imageEffect}`,
      `effect-variant-${s.imageEffectVariant}`
    ].join(' ');
    const frontOnly = [
      `align-${s.horizontalAlignment}`,
      `align-vertical-${s.verticalAlignment}`,
      `align-style-${s.alignmentStyle}`
    ].join(' ');
    return { shared, frontOnly };
  }

  function buildDataAttributes(design, rarity) {
    const s = Object.assign({}, MODULAR_DEFAULTS, design || {});
    return [
      `data-alignment-type="${s.horizontalAlignment}"`,
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

    // PRIMARY PATH: Use stored rendered HTML captured from the preview at save time
    if (d.renderedFront && d.frontClasses) {
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
      const design = d.design || null;
      const { shared: modShared, frontOnly: modFront } = buildModularClasses(design);
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
              <div class="biography-text" data-full-bio="${bio.replace(/"/g, '&quot;')}">${bio}</div>
              <a class="bio-read-more" href="#">Read more &raquo;</a>
            </div>` : ''}
            <div class="info-grid">
              ${badges.length ? `
              <div class="back-section badges-section">
                <h4 class="section-title">Badges & Achievements</h4>
                <div class="badges-container" data-badge-count="${Math.min(badges.length, BADGE_CAP)}">${badgesHTML(badges)}</div>
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
            <div class="card-preview-canvas card-front ${modFront} ${modShared}" ${dataAttrs}>${frontHTML}</div>
            <div class="card-preview-canvas card-back ${modShared}" ${dataAttrs}>${backHTML}</div>
          </div>
        </div>`;
    }

    // Animate stat bars (staggered, rAF + forced reflow — mirrors card-forge-editor.js)
    setTimeout(() => {
      container.querySelectorAll('.stat-progress').forEach((bar, i) => {
        if (!bar.isConnected) return;
        const raw = Number(bar.dataset.target);
        const targetPct = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
        bar.style.transition = 'none';
        bar.style.width = '0%';
        void bar.offsetWidth; // force reflow
        requestAnimationFrame(() => {
          if (!bar.isConnected) { return; }
          requestAnimationFrame(() => {
            if (!bar.isConnected) { return; }
            bar.style.transition = 'width 450ms ease';
            setTimeout(() => {
              if (!bar.isConnected) return;
              bar.style.width = targetPct + '%';
            }, i * 120);
          });
        });
      });
    }, 50);

    // Detect biography truncation after layout settles
    requestAnimationFrame(() => {
      const bioText = container.querySelector('.biography-text');
      if (bioText) {
        if (bioText.scrollHeight > bioText.clientHeight + 1) {
          bioText.classList.add('is-truncated');
        } else {
          bioText.classList.remove('is-truncated');
        }
      }
    });

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

  function getShareInfo() {
    const card = galleryCards[currentIndex];
    if (!card) return null;
    const cardId = card.id || '';
    const name = card.name || card.title || 'Card';
    const url = window.buildApiPath ? window.buildApiPath('cardShare', { card: cardId }) : window.location.href;
    return { url, name };
  }

  function flashBtn(btn, origHtml) {
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    setTimeout(() => { btn.innerHTML = origHtml; }, 2000);
  }

  function shareCopyLink() {
    const info = getShareInfo();
    if (!info) return;
    const btn = el('lightbox-copy-link');
    navigator.clipboard.writeText(info.url).then(() => {
      if (btn) flashBtn(btn, '<i class="fas fa-link"></i> Copy Link');
    }).catch(() => window.prompt('Copy this link:', info.url));
  }

  function shareToX() {
    const info = getShareInfo();
    if (!info) return;
    const text = encodeURIComponent('Check out "' + info.name + '" on CardForge!');
    window.open('https://twitter.com/intent/tweet?url=' + encodeURIComponent(info.url) + '&text=' + text, '_blank', 'width=550,height=420');
  }

  function shareToReddit() {
    const info = getShareInfo();
    if (!info) return;
    window.open('https://reddit.com/submit?url=' + encodeURIComponent(info.url) + '&title=' + encodeURIComponent(info.name + ' — CardForge'), '_blank');
  }

  function shareToDiscord() {
    const info = getShareInfo();
    if (!info) return;
    const btn = el('lightbox-share-discord');
    const text = '**' + info.name + '** — ' + info.url;
    navigator.clipboard.writeText(text).then(() => {
      if (btn) flashBtn(btn, '<i class="fab fa-discord"></i> Discord');
    }).catch(() => window.prompt('Copy for Discord:', text));
  }

  async function exportCard(opts) {
    opts = opts || {};
    const format = opts.format || 'png';
    const scale = opts.scale || 1;
    const triggerId = opts.triggerId || 'lightbox-export-png-1x';

    const container = el('lightbox-card-container');
    if (!container) return;
    const card = galleryCards[currentIndex];
    const cardName = (card && (card.name || card.title)) || 'card';

    const btn = el(triggerId);
    let icon;
    if (btn) {
      icon = btn.querySelector('i');
      if (icon) icon.className = 'fas fa-spinner fa-spin';
      btn.disabled = true;
    }

    try {
      const frontFace = container.querySelector('.card-front') || container;
      const canvas = await html2canvas(frontFace, {
        backgroundColor: null,
        scale: scale,
        useCORS: true,
        allowTaint: true,
        logging: false,
        onclone: function(clonedDoc) {
          // Regex to match any modern CSS color function html2canvas 1.x can't parse
          var badColor = /color-mix|oklab|oklch|color\(|lab\(|lch\(/;

          function cleanRules(ruleList) {
            if (!ruleList) return;
            for (var r = 0; r < ruleList.length; r++) {
              var rule = ruleList[r];
              // Clean declarations in style rules
              if (rule.style) {
                for (var p = rule.style.length - 1; p >= 0; p--) {
                  var val = rule.style.getPropertyValue(rule.style[p]);
                  if (val && badColor.test(val)) {
                    rule.style.removeProperty(rule.style[p]);
                  }
                }
              }
              // Recurse into nested rules (@media, @supports, @keyframes, @layer, etc.)
              if (rule.cssRules) {
                cleanRules(rule.cssRules);
              }
            }
          }

          try {
            var sheets = clonedDoc.styleSheets;
            for (var s = 0; s < sheets.length; s++) {
              try { cleanRules(sheets[s].cssRules || sheets[s].rules); }
              catch(e) { /* cross-origin stylesheet, skip */ }
            }
          } catch(e) { console.warn('onclone style cleanup:', e); }

          // Inline computed styles for properties that used color-mix/oklab (now stripped)
          // This covers background gradients, box-shadow, border, outline, text colors
          var visualProps = ['background','backgroundColor','backgroundImage','boxShadow',
            'border','borderColor','borderRadius','outline','outlineColor','outlineOffset',
            'color','textShadow'];

          // Convert modern color(srgb r g b / a) to rgba() for html2canvas compat
          function sanitizeColor(val) {
            if (!val || !badColor.test(val)) return val;
            // Replace color(srgb r g b) or color(srgb r g b / a)
            return val.replace(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/g,
              function(_, r, g, b, a) {
                var ri = Math.round(parseFloat(r) * 255);
                var gi = Math.round(parseFloat(g) * 255);
                var bi = Math.round(parseFloat(b) * 255);
                return a !== undefined ? 'rgba(' + ri + ',' + gi + ',' + bi + ',' + a + ')' : 'rgb(' + ri + ',' + gi + ',' + bi + ')';
              }
            );
          }

          function inlineVisual(orig, clone) {
            if (!orig || !clone) return;
            var cs = getComputedStyle(orig);
            for (var i = 0; i < visualProps.length; i++) {
              try {
                var val = sanitizeColor(cs[visualProps[i]]);
                if (val) clone.style[visualProps[i]] = val;
              } catch(e) {}
            }
          }

          var origFront = container.querySelector('.card-front') || container;
          var cloneLb = clonedDoc.getElementById('lightbox-card-container');
          var cloneFront = cloneLb ? (cloneLb.querySelector('.card-front') || cloneLb) : null;
          if (origFront && cloneFront) {
            inlineVisual(origFront, cloneFront);
            // Also inline on key child elements that use palette colors
            var selectors = ['.card-body','.card-hero-header','.hero-overlay','.card-name',
              '.card-class','.card-rarity','.card-quote','.stat-row','.stat-progress',
              '.card-stats','.card-preview-canvas'];
            for (var i = 0; i < selectors.length; i++) {
              var origEls = origFront.querySelectorAll(selectors[i]);
              var cloneEls = cloneFront.querySelectorAll(selectors[i]);
              for (var j = 0; j < Math.min(origEls.length, cloneEls.length); j++) {
                inlineVisual(origEls[j], cloneEls[j]);
              }
            }
          }
        }
      });

      const ext = format === 'jpg' ? 'jpg' : 'png';
      const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
      const quality = format === 'jpg' ? 0.92 : undefined;

      const link = document.createElement('a');
      link.download = `${cardName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${scale}x.${ext}`;
      link.href = canvas.toDataURL(mime, quality);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Card export failed:', err);
      alert('Card export failed: ' + err.message);
    } finally {
      if (btn) {
        if (icon) icon.className = 'fas fa-download';
        btn.disabled = false;
      }
    }
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

    const copyLinkBtn = el('lightbox-copy-link');
    const shareXBtn = el('lightbox-share-x');
    const shareRedditBtn = el('lightbox-share-reddit');
    const shareDiscordBtn = el('lightbox-share-discord');

    if (closeBtn) closeBtn.addEventListener('click', close);
    if (prevBtn) prevBtn.addEventListener('click', () => navigate(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => navigate(1));
    if (flipBtn) flipBtn.addEventListener('click', flip);
    if (copyLinkBtn) copyLinkBtn.addEventListener('click', shareCopyLink);
    if (shareXBtn) shareXBtn.addEventListener('click', shareToX);
    if (shareRedditBtn) shareRedditBtn.addEventListener('click', shareToReddit);
    if (shareDiscordBtn) shareDiscordBtn.addEventListener('click', shareToDiscord);

    // Export buttons
    const exportConfigs = [
      { id: 'lightbox-export-png-1x', format: 'png', scale: 1 },
      { id: 'lightbox-export-png-2x', format: 'png', scale: 2 },
      { id: 'lightbox-export-png-4x', format: 'png', scale: 4 },
      { id: 'lightbox-export-jpg-2x', format: 'jpg', scale: 2 }
    ];
    exportConfigs.forEach(cfg => {
      const btn = el(cfg.id);
      if (btn) btn.addEventListener('click', () => exportCard({ format: cfg.format, scale: cfg.scale, triggerId: cfg.id }));
    });

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
