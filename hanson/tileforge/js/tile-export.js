// TileForge Tile Export Module
// PNG export via Canvas API and full-size preview modal for individual tiles

(function () {
  'use strict';

  // Returns actual (export) and display dimensions for the current template
  function getDims() {
    if (typeof window.templateSystem !== 'undefined') {
      const c = window.templateSystem.getCurrentConfig();
      if (c && c.name === 'Mobile Spotlight') {
        return { w: 694, h: 758, dw: 347, dh: 379 };
      }
    }
    return { w: 560, h: 315, dw: 280, dh: 140 };
  }

  // Extract background image src from a .tile-preview element
  function getImageSrc(tileEl) {
    if (!tileEl) return window.currentImageSrc || null;
    const bg = tileEl.style.backgroundImage;
    if (bg && bg !== 'none') {
      const m = bg.match(/url\(["']?(.+?)["']?\)/);
      if (m) return m[1];
    }
    return window.currentImageSrc || null;
  }

  // Read title/subtitle/status from a .tile-container element
  function getTileData(container) {
    const tileEl = container.querySelector('.tile-preview');
    const titleInput = container.querySelector('.card-title-input');
    const subtitleInput = container.querySelector('.card-subtitle-input');
    const titleEl = tileEl ? tileEl.querySelector('.tile-title') : null;
    const subtitleEl = tileEl ? tileEl.querySelector('.tile-subtitle') : null;
    const status = tileEl
      ? (tileEl.classList.contains('overflow') ? 'overflow'
        : tileEl.classList.contains('near-limit') ? 'near-limit' : 'clean')
      : 'clean';
    return {
      locale: container.dataset.locale || '',
      title: titleInput ? titleInput.value : (titleEl ? titleEl.textContent : ''),
      subtitle: subtitleInput ? subtitleInput.value : (subtitleEl ? subtitleEl.textContent : ''),
      status,
      imageSrc: getImageSrc(tileEl)
    };
  }

  // Word-wrap text to fit maxWidth; returns array of lines (capped at maxLines)
  function wrapText(ctx, text, maxWidth, maxLines) {
    const words = String(text || '').split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        if (lines.length >= maxLines) {
          lines[lines.length - 1] += '\u2026';
          return lines;
        }
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  // Draw gradient, title, and subtitle onto an already-sized canvas
  function paintCanvas(canvas, data, dims) {
    const ctx = canvas.getContext('2d');
    const scale = dims.w / dims.dw; // 2 for ToH, 2 for Mobile Spotlight
    const padH = Math.round(16 * scale);
    const padBottom = Math.round(16 * scale);
    const maxTW = dims.w - padH * 2;
    const titleSize = Math.round(18 * scale);
    const subSize = Math.round(16 * scale);
    const lh = 1.28;

    // Gradient overlay (matches CSS: transparent → rgba(0,0,0,0.8))
    const grad = ctx.createLinearGradient(0, 0, 0, dims.h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0.82)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, dims.w, dims.h);

    ctx.textBaseline = 'bottom';
    let yBottom = dims.h - padBottom;

    // Draw subtitle first (bottommost text)
    if (data.subtitle) {
      ctx.font = `${subSize}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
      const lines = wrapText(ctx, data.subtitle, maxTW, 2);
      const lineH = Math.round(subSize * lh);
      for (let i = lines.length - 1; i >= 0; i--) {
        ctx.fillStyle = '#dddddd';
        ctx.fillText(lines[i], padH, yBottom, maxTW);
        yBottom -= lineH;
      }
      yBottom -= Math.round(4 * scale); // gap between subtitle and title
    }

    // Draw title above subtitle
    if (data.title) {
      ctx.font = `600 ${titleSize}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
      const lines = wrapText(ctx, data.title, maxTW, 2);
      const lineH = Math.round(titleSize * lh);
      for (let i = lines.length - 1; i >= 0; i--) {
        ctx.fillStyle = '#ffffff';
        ctx.fillText(lines[i], padH, yBottom, maxTW);
        yBottom -= lineH;
      }
    }
  }

  // Export a single tile as a PNG download
  function exportPng(container) {
    const dims = getDims();
    const data = getTileData(container);
    const canvas = document.createElement('canvas');
    canvas.width = dims.w;
    canvas.height = dims.h;
    const ctx = canvas.getContext('2d');

    const finish = function () {
      paintCanvas(canvas, data, dims);
      const safe = data.locale.replace(/[^A-Za-z0-9_-]/g, '_');
      const a = document.createElement('a');
      a.download = 'tile_' + safe + '.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
      if (typeof window.showToast === 'function') {
        window.showToast('PNG exported: tile_' + safe + '.png');
      }
    };

    if (data.imageSrc) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        ctx.drawImage(img, 0, 0, dims.w, dims.h);
        finish();
      };
      img.onerror = function () {
        // Image blocked by CORS — paint dark background only
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, dims.w, dims.h);
        finish();
      };
      img.src = data.imageSrc;
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, dims.w, dims.h);
      finish();
    }
  }

  // Safe HTML escape for modal innerHTML
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Open a full-size preview modal for a tile
  function openPreview(container) {
    const dims = getDims();
    const data = getTileData(container);
    const localeName = (typeof LOCALE_NAMES !== 'undefined' && LOCALE_NAMES[data.locale]) || data.locale;
    const bgStyle = data.imageSrc ? 'background-image:url(' + esc(data.imageSrc) + ')' : '';
    const statusLabel = data.status === 'near-limit' ? 'Near Limit' : data.status.charAt(0).toUpperCase() + data.status.slice(1);
    const badgeChar = data.status === 'clean' ? '✓' : '⚠';

    const overlay = document.createElement('div');
    overlay.className = 'tf-preview-overlay';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    overlay.innerHTML = `
      <div class="tf-preview-modal" role="dialog" aria-modal="true" aria-label="Tile preview for ${esc(data.locale)}">
        <div class="tf-preview-header">
          <div class="tf-preview-title">
            <span class="country-badge">${esc(data.locale)}</span>
            <span>${esc(localeName)}</span>
          </div>
          <div class="tf-preview-btns">
            <button class="toolbar-btn tf-preview-export-btn" title="Export as PNG">
              <i class="fas fa-download" aria-hidden="true"></i> Export PNG
            </button>
            <button class="toolbar-btn tf-preview-close-btn" title="Close preview" aria-label="Close">
              <i class="fas fa-times" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <div class="tf-preview-body">
          <div class="tf-preview-tile-wrap" style="width:${dims.dw * 2}px;height:${dims.dh * 2}px;">
            <div class="tf-preview-tile-inner">
              <div class="tile-preview ${esc(data.status)}" style="width:${dims.dw}px;height:${dims.dh}px;${bgStyle}">
                <div class="tile-status-badge ${esc(data.status)}">${badgeChar}</div>
                <div class="tile-overlay">
                  <div class="tile-title">${esc(data.title)}</div>
                  ${data.subtitle ? '<div class="tile-subtitle">' + esc(data.subtitle) + '</div>' : ''}
                </div>
              </div>
            </div>
          </div>
          <div class="tf-preview-meta">
            <span class="tf-preview-meta-dim"><i class="fas fa-ruler-combined" aria-hidden="true"></i> ${dims.w} × ${dims.h} px export</span>
            <span class="tf-preview-meta-status tf-preview-status-${esc(data.status)}">${statusLabel}</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.tf-preview-close-btn').addEventListener('click', function () {
      overlay.remove();
    });
    overlay.querySelector('.tf-preview-export-btn').addEventListener('click', function () {
      exportPng(container);
    });

    const onKey = function (e) {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);

    // Focus the close button for accessibility
    const closeBtn = overlay.querySelector('.tf-preview-close-btn');
    if (closeBtn) closeBtn.focus();
  }

  window.TileExport = { openPreview: openPreview, exportPng: exportPng };
})();
