/**
 * Blindspot Card Share — canvas renderer + export (PNG download / clipboard)
 *
 * Renders a card to an HTML5 canvas with stats, title, border tier, and history.
 * No external dependencies (no html2canvas).
 *
 * API: window.BsCardShare
 *   .render(card, opts) → Promise<canvas>
 *   .download(card)     → triggers PNG download
 *   .copyToClipboard(card) → copies PNG to clipboard
 *   .showShareModal(card)  → opens share overlay
 */
window.BsCardShare = (function () {
  'use strict';

  var CARD_W = 400;
  var CARD_H = 560;
  var PADDING = 20;
  var ART_H = 260;

  var PALETTE_BG = {
    earth: '#1a1510', ocean: '#0d1520', neon: '#0a0a1a', fire: '#1a0c0a',
    monochrome: '#111111', sunset: '#1a1210', inferno: '#1a0505', frost: '#0a1520'
  };
  var PALETTE_ACCENT = {
    earth: '#EF9F27', ocean: '#3a9fff', neon: '#00ff88', fire: '#ff5252',
    monochrome: '#cccccc', sunset: '#ff9100', inferno: '#ff3333', frost: '#88ddff'
  };

  var STAT_COLORS = { str: '#ff5252', agi: '#00e676', int: '#7b2fff', end: '#ff9100', lck: '#ffd740' };
  var STAT_LABELS = { str: 'STR', agi: 'AGI', int: 'INT', end: 'END', lck: 'LCK' };

  var TIER_COLORS = {
    plain: null, bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700',
    platinum: '#E5E4E2', radiant: '#B9F2FF'
  };

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  async function renderToCanvas(card, opts) {
    opts = opts || {};
    if (!card) return null;

    var _CR = window.BsCardRenderer;
    if (_CR) _CR.ensureCombatStats(card);
    var cs = card.combatStats || {};
    var palette = card.palette || 'earth';
    var bg = PALETTE_BG[palette] || PALETTE_BG.earth;
    var accent = PALETTE_ACCENT[palette] || PALETTE_ACCENT.earth;
    var name = card.name || 'Unknown';
    var cls = card.class || card.characterClass || '';
    var rarity = (card.rarity || 'Common');

    // Border tier
    var borderTier = _CR ? _CR.getCardBorderTier(card.id) : null;
    var tierColor = borderTier ? TIER_COLORS[borderTier.id] : null;
    var tierLabel = borderTier ? borderTier.label : '';

    // Card history
    var prog = window.BsState ? window.BsState.progress : {};
    var ch = card.id && prog.cardHistory ? prog.cardHistory[card.id] : null;

    // Best earned title
    var earnedTitles = _CR ? _CR.getCardEarnedTitles(card.id) : [];
    var bestTitle = earnedTitles.length > 0 ? earnedTitles[earnedTitles.length - 1] : null;

    // Title from cosmetic or earned
    var titleText = '';
    var _Cos = window.BsCosmetics;
    if (_Cos) {
      var equipped = _Cos.getEquipped();
      if (equipped && equipped.title) {
        var titleDef = _Cos.find(equipped.title);
        if (titleDef && titleDef.title) titleText = titleDef.title;
      }
    }
    if (!titleText && bestTitle) titleText = bestTitle.title;
    if (!titleText && prog.cardTitle) titleText = prog.cardTitle;

    var canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    var ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, CARD_W, CARD_H, 16, true, false);

    // Border
    ctx.strokeStyle = tierColor || accent;
    ctx.lineWidth = tierColor ? 3 : 1.5;
    roundRect(ctx, 1, 1, CARD_W - 2, CARD_H - 2, 16, false, true);

    // Tier glow
    if (tierColor) {
      ctx.shadowColor = tierColor;
      ctx.shadowBlur = 12;
      roundRect(ctx, 1, 1, CARD_W - 2, CARD_H - 2, 16, false, true);
      ctx.shadowBlur = 0;
    }

    // Avatar
    var avatarImg = await loadImage(card.avatar);
    var artY = PADDING;
    var artW = CARD_W - PADDING * 2;
    if (avatarImg) {
      ctx.save();
      roundRect(ctx, PADDING, artY, artW, ART_H, 10, false, false);
      ctx.clip();
      // Cover fit
      var imgRatio = avatarImg.width / avatarImg.height;
      var drawW, drawH, drawX, drawY;
      if (imgRatio > artW / ART_H) {
        drawH = ART_H;
        drawW = ART_H * imgRatio;
        drawX = PADDING - (drawW - artW) / 2;
        drawY = artY;
      } else {
        drawW = artW;
        drawH = artW / imgRatio;
        drawX = PADDING;
        drawY = artY - (drawH - ART_H) / 2;
      }
      ctx.drawImage(avatarImg, drawX, drawY, drawW, drawH);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      roundRect(ctx, PADDING, artY, artW, ART_H, 10, true, false);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '48px "Font Awesome 6 Free"';
      ctx.textAlign = 'center';
      ctx.fillText('\uf007', CARD_W / 2, artY + ART_H / 2 + 16);
    }

    // Title badge (top-right of art)
    if (titleText) {
      ctx.font = '600 10px "Cinzel", serif';
      var tw = ctx.measureText(titleText.toUpperCase()).width + 12;
      var tx = CARD_W - PADDING - tw - 4;
      var ty = artY + 6;
      ctx.fillStyle = 'rgba(16, 12, 8, 0.85)';
      roundRect(ctx, tx, ty, tw, 18, 3, true, false);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 0.5;
      roundRect(ctx, tx, ty, tw, 18, 3, false, true);
      ctx.fillStyle = accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(titleText.toUpperCase(), tx + tw / 2, ty + 9);
    }

    // Tier badge (top-left of art)
    if (tierLabel && tierColor) {
      ctx.font = '600 9px "Cinzel", serif';
      var tLabelW = ctx.measureText(tierLabel.toUpperCase()).width + 10;
      ctx.fillStyle = 'rgba(16, 12, 8, 0.85)';
      roundRect(ctx, PADDING + 4, artY + 6, tLabelW, 16, 3, true, false);
      ctx.strokeStyle = tierColor;
      ctx.lineWidth = 0.5;
      roundRect(ctx, PADDING + 4, artY + 6, tLabelW, 16, 3, false, true);
      ctx.fillStyle = tierColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tierLabel.toUpperCase(), PADDING + 4 + tLabelW / 2, artY + 14);
    }

    // Name + Class
    var nameY = artY + ART_H + 20;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#F5F0E8';
    ctx.font = '700 20px "Cinzel", serif';
    ctx.fillText(name, CARD_W / 2, nameY);

    ctx.fillStyle = 'rgba(160, 152, 136, 0.8)';
    ctx.font = '600 11px "Share Tech Mono", monospace';
    ctx.fillText(cls.toUpperCase() + (rarity !== 'Common' ? '  ·  ' + rarity : ''), CARD_W / 2, nameY + 26);

    // Element badge
    var _Const = window.BsConst || {};
    var element = card.element || (_Const.CLASS_DEFAULT_ELEMENT && _Const.CLASS_DEFAULT_ELEMENT[cls] ? _Const.CLASS_DEFAULT_ELEMENT[cls] : '');
    if (element && _Const.ELEMENT_DEFS && _Const.ELEMENT_DEFS[element]) {
      var elDef = _Const.ELEMENT_DEFS[element];
      var ELEMENT_EMOJI = { fire: '\uD83D\uDD25', earth: '\uD83C\uDFD4\uFE0F', arcane: '\uD83D\uDD2E', shadow: '\uD83D\uDC7B', chaos: '\uD83D\uDCAB' };
      var elEmoji = ELEMENT_EMOJI[element] || '';
      ctx.font = '500 10px "Share Tech Mono", monospace';
      ctx.fillStyle = elDef.color;
      ctx.textAlign = 'center';
      ctx.fillText(elEmoji + ' ' + elDef.label, CARD_W / 2, nameY + 42);
    }

    // Stats
    var statY = nameY + (element ? 60 : 52);
    var statKeys = ['str', 'agi', 'int', 'end', 'lck'];
    var barX = PADDING + 40;
    var barW = CARD_W - PADDING * 2 - 70;

    for (var i = 0; i < statKeys.length; i++) {
      var key = statKeys[i];
      var val = cs[key] || 0;
      var y = statY + i * 22;

      // Label
      ctx.fillStyle = STAT_COLORS[key];
      ctx.font = '700 10px "Share Tech Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(STAT_LABELS[key], PADDING, y + 6);

      // Bar bg
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      roundRect(ctx, barX, y, barW, 12, 3, true, false);

      // Bar fill
      ctx.fillStyle = STAT_COLORS[key];
      var fillW = Math.max(2, barW * val / 100);
      roundRect(ctx, barX, y, fillW, 12, 3, true, false);

      // Value
      ctx.fillStyle = '#F5F0E8';
      ctx.font = '600 10px "Share Tech Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(String(val), CARD_W - PADDING, y + 6);
    }

    // Power
    var totalPower = statKeys.reduce(function (s, k) { return s + (cs[k] || 0); }, 0);
    var powerY = statY + statKeys.length * 22 + 8;
    ctx.fillStyle = accent;
    ctx.font = '700 13px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('\u26A1 ' + totalPower + ' POWER', CARD_W / 2, powerY + 6);

    // Card history line
    if (ch && (ch.wins > 0 || ch.losses > 0)) {
      var histY = powerY + 22;
      var histParts = [];
      histParts.push(ch.wins + 'W / ' + ch.losses + 'L');
      if (ch.bestStreak > 1) histParts.push(ch.bestStreak + ' best streak');
      if (ch.bossesBeaten && ch.bossesBeaten.length > 0) histParts.push(ch.bossesBeaten.length + ' bosses');
      ctx.fillStyle = 'rgba(160, 152, 136, 0.6)';
      ctx.font = '500 9px "Share Tech Mono", monospace';
      ctx.fillText(histParts.join('  ·  '), CARD_W / 2, histY + 4);
    }

    // Watermark
    ctx.fillStyle = 'rgba(160, 152, 136, 0.25)';
    ctx.font = '500 8px "Share Tech Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('ambientpixels.ai/blindspot', CARD_W - PADDING, CARD_H - 10);

    return canvas;
  }

  function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  async function download(card) {
    var canvas = await renderToCanvas(card);
    if (!canvas) return;
    var link = document.createElement('a');
    link.download = (card.name || 'card').replace(/[^a-z0-9]/gi, '_') + '_blindspot.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  async function copyToClipboard(card) {
    var canvas = await renderToCanvas(card);
    if (!canvas) return false;
    try {
      var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch (e) {
      console.warn('[BsCardShare] clipboard copy failed:', e.message);
      return false;
    }
  }

  function showShareModal(card) {
    // Remove existing modal
    var existing = document.getElementById('bs-share-modal');
    if (existing) existing.remove();

    var backdrop = document.createElement('div');
    backdrop.id = 'bs-share-modal';
    backdrop.className = 'bs-share-modal-backdrop';
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) backdrop.remove(); });

    var modal = document.createElement('div');
    modal.className = 'bs-share-modal';

    var preview = document.createElement('div');
    preview.className = 'bs-share-modal__preview';
    preview.innerHTML = '<div class="bs-spinner"></div>';
    modal.appendChild(preview);

    var actions = document.createElement('div');
    actions.className = 'bs-share-modal__actions';

    var dlBtn = document.createElement('button');
    dlBtn.className = 'bs-btn bs-btn--primary';
    dlBtn.innerHTML = '<i class="fas fa-download"></i> Download PNG';
    dlBtn.addEventListener('click', function () { download(card); });

    var copyBtn = document.createElement('button');
    copyBtn.className = 'bs-btn bs-btn--secondary';
    copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy to Clipboard';
    copyBtn.addEventListener('click', async function () {
      var ok = await copyToClipboard(card);
      copyBtn.innerHTML = ok
        ? '<i class="fas fa-check"></i> Copied!'
        : '<i class="fas fa-times"></i> Failed';
      setTimeout(function () {
        copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy to Clipboard';
      }, 2000);
    });

    var closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn bs-btn--ghost';
    closeBtn.innerHTML = '<i class="fas fa-times"></i> Close';
    closeBtn.addEventListener('click', function () { backdrop.remove(); });

    actions.appendChild(dlBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(closeBtn);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Render canvas into preview
    renderToCanvas(card).then(function (canvas) {
      if (canvas) {
        preview.innerHTML = '';
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.style.borderRadius = '8px';
        preview.appendChild(canvas);
      } else {
        preview.innerHTML = '<span style="color:var(--bs-text-muted);">Failed to render card</span>';
      }
    });
  }

  return {
    render: renderToCanvas,
    download: download,
    copyToClipboard: copyToClipboard,
    showShareModal: showShareModal
  };
})();
