/* forge-share.js — mint-stage hash + publish + export (PNG / SVG / JSON).
 * Per redesign-handoff.md §13.3 + Phase 7 Tasks 7.1 + 7.2.
 *
 * Key decisions from audit 0.4:
 *   • /api/cardforgepublish does NOT accept a client hash or mint a shareId —
 *     it uses the client-supplied `cardId` as the share identifier.
 *   • So: `cardId = forge-<timestamp>-<8hex>` is our share identifier, and
 *     the 12-char sha256 prefix is a display-only content fingerprint.
 *   • Share URL: `<origin>/cardforge/c/<cardId>` (existing cardshare route).
 *
 * On file:// the real publish can't run; mint still generates hash + shareId
 * locally so the user sees a functional UI for dev.
 */

(function () {
  'use strict';

  /**
   * Compute a 12-char sha256 prefix of the card's meaningful state.
   * Same content → same hash. Collision-safe at CardForge scale per audit.
   */
  async function forgeHash(state) {
    var fingerprint = JSON.stringify({
      n: state.name,
      c: state.classId,
      cl: state.classLabel,
      r: state.rarity,
      p: state.portraitId,
      s: state.styleId,
      stats: state.stats,
      o: state.overlays,
      b: state.backstory,
      a: state.abilityLine
    });
    var buf = new TextEncoder().encode(fingerprint);
    var digest = await crypto.subtle.digest('SHA-256', buf);
    var hex = Array.prototype.map.call(new Uint8Array(digest), function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
    return hex.slice(0, 12);
  }

  /** Generate a unique client-scoped cardId. Used both locally + as share ID. */
  function generateCardId(hash) {
    var suffix = (hash || '').slice(0, 8) || Math.random().toString(36).slice(2, 10);
    return 'forge-' + Date.now().toString(36) + '-' + suffix;
  }

  /** Build the legacy-schema card payload for /api/cardforgepublish.
   *  Mirrors the shape Blindspot reads (audit 0.1 dual-path pattern). */
  function buildCardDataPayload(state, cardId) {
    var stats = state.stats || {};
    var combat = {
      str: Number(stats.STR) || 50,
      agi: Number(stats.AGI) || 50,
      int: Number(stats.INT) || 50,
      end: Number(stats.END) || 50,
      lck: Number(stats.LCK) || 50
    };
    return {
      id: cardId,
      name: state.name || 'Unnamed',
      class: state.classLabel || '',
      characterClass: state.classLabel || '',
      rarity: state.rarity || 'Rare',
      avatar: '', // portrait is SVG-rendered client-side; no URL asset yet
      styleId: state.styleId,
      portraitId: state.portraitId,
      combatStats: combat,
      overlays: state.overlays || {},
      // cardData mirror — per Blindspot renderer dual-path fallback (audit 0.1)
      cardData: {
        styleId: state.styleId,
        portraitId: state.portraitId,
        name: state.name || 'Unnamed',
        characterClass: state.classLabel || '',
        rarity: state.rarity || 'Rare',
        combatStats: combat,
        biography: state.backstory || '',
        quote: state.abilityLine || '',
        overlays: state.overlays || {}
      }
    };
  }

  /**
   * Publish the current ForgeState snapshot. Returns { hash, shareId, shareUrl }.
   * On network failure or file:// protocol, still returns a valid share tuple
   * (local-only — the share URL won't resolve publicly until publish succeeds).
   */
  async function publishAndShare(state) {
    var hash = await forgeHash(state);
    var cardId = generateCardId(hash);
    var startedAt = Date.now();

    if (window.ForgeTelemetry && typeof window.ForgeTelemetry.track === 'function') {
      window.ForgeTelemetry.track('mint.start', { styleId: state.styleId });
    }

    var localOnly = (window.location.protocol === 'file:') || !window.buildApiPath;
    var published = false;

    if (!localOnly) {
      try {
        var cardData = buildCardDataPayload(state, cardId);
        var url = window.buildApiPath('publish');
        var headers = { 'Content-Type': 'application/json' };
        if (typeof window._cfGetAuthHeaders === 'function') {
          try {
            var authHeaders = await window._cfGetAuthHeaders();
            if (authHeaders) Object.assign(headers, authHeaders);
          } catch (_) { /* no auth headers — fall through */ }
        }
        var resp = await fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ cardId: cardId, userId: 'anonymous', cardData: cardData })
        });
        if (!resp.ok) throw new Error('Publish HTTP ' + resp.status);
        published = true;
      } catch (e) {
        if (window.ForgeTelemetry && typeof window.ForgeTelemetry.track === 'function') {
          window.ForgeTelemetry.track('mint.fail', {
            styleId: state.styleId,
            durationMs: Date.now() - startedAt,
            error: String(e && e.message || e)
          });
        }
        // Re-throw so the UI can show an error state
        throw e;
      }
    }

    var shareUrl = window.location.origin + '/cardforge/c/' + cardId;

    if (window.ForgeTelemetry && typeof window.ForgeTelemetry.track === 'function') {
      window.ForgeTelemetry.track('mint.success', {
        styleId: state.styleId,
        durationMs: Date.now() - startedAt,
        hash: hash,
        localOnly: localOnly,
        published: published
      });
    }

    return {
      hash: hash,
      shareId: cardId,
      shareUrl: shareUrl,
      localOnly: localOnly
    };
  }

  // ---------------------------------------------------------------
  // Export helpers
  // ---------------------------------------------------------------

  function safeName(s) {
    return String(s || 'card').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mimeMatch = parts[0].match(/:(.*?);/);
    var mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    var bin = atob(parts[1] || '');
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function requireHtmlToImage() {
    if (!window.htmlToImage) {
      throw new Error('html-to-image library not loaded — check the CDN script tag');
    }
    return window.htmlToImage;
  }

  async function exportPNG(cardEl, name) {
    var h2i = requireHtmlToImage();
    var blob = await h2i.toBlob(cardEl, { pixelRatio: 2, backgroundColor: null });
    triggerDownload(blob, safeName(name) + '.png');
  }

  async function exportSVG(cardEl, name) {
    var h2i = requireHtmlToImage();
    var dataUrl = await h2i.toSvg(cardEl);
    var blob = dataUrlToBlob(dataUrl);
    triggerDownload(blob, safeName(name) + '.svg');
  }

  function exportJSON(state, name) {
    var payload = {
      version: 'forge.v1',
      exportedAt: new Date().toISOString(),
      state: state
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    triggerDownload(blob, safeName(name) + '.json');
  }

  window.ForgeShare = {
    forgeHash: forgeHash,
    generateCardId: generateCardId,
    buildCardDataPayload: buildCardDataPayload,
    publishAndShare: publishAndShare,
    exportPNG: exportPNG,
    exportSVG: exportSVG,
    exportJSON: exportJSON
  };
})();
