/* forge-portrait.js — inline SVG character portrait.
 * Port of shared.jsx Portrait component to vanilla JS.
 *
 * Deterministic from character `id` — same character always produces the same shape.
 * Hue drives the palette (skin, hair, bg gradient, rim light).
 *
 * API:
 *   window.ForgePortrait.CHARACTERS           → full 12-character fixture (loaded from JSON)
 *   window.ForgePortrait.get(id)              → character record by id
 *   window.ForgePortrait.build(id | charRec)  → returns HTMLElement (<svg>) portrait
 *   window.ForgePortrait.buildHtml(id|rec)    → returns HTML string (for innerHTML insertion)
 *
 * Characters are inlined here for file:// compat; data/forge-characters.json is the
 * canonical external copy and is re-exported so other modules can read it uniformly.
 */

(function () {
  'use strict';

  // Inlined copy of forge/data/forge-characters.json. Keep these in sync.
  var CHARACTERS = [
    { id: 'aria',   name: 'Aria Stormwind',     class: 'Fantasy Ranger',      rarity: 'Rare',      accent: '#4fd1c5', hue: 170 },
    { id: 'zara',   name: 'Zara-7',             class: 'Cyberpunk Runner',    rarity: 'Epic',      accent: '#ff2fb6', hue: 320 },
    { id: 'elena',  name: 'Dr. Elena Voss',     class: 'Arcane Scholar',      rarity: 'Rare',      accent: '#a78bfa', hue: 265 },
    { id: 'rex',    name: 'Commander Rex',      class: 'Space Marine',        rarity: 'Legendary', accent: '#fbbf24', hue: 40  },
    { id: 'kenji',  name: 'Kenji Nakamura',     class: 'Corporate Ronin',     rarity: 'Epic',      accent: '#ef4444', hue: 0   },
    { id: 'nova',   name: 'Captain Nova',       class: 'Legendary Hero',      rarity: 'Mythic',    accent: '#38bdf8', hue: 200 },
    { id: 'titan',  name: 'Divine Protector',   class: 'Titan Guardian',      rarity: 'Legendary', accent: '#e5c07a', hue: 35  },
    { id: 'shade',  name: 'Stealth Specialist', class: 'Shadow Operative',    rarity: 'Epic',      accent: '#64748b', hue: 215 },
    { id: 'sera',   name: 'Seraphina',          class: 'Celestial Warden',    rarity: 'Mythic',    accent: '#fde68a', hue: 50  },
    { id: 'ember',  name: 'Ember Gaze',         class: 'Flame Oracle',        rarity: 'Legendary', accent: '#fb923c', hue: 20  },
    { id: 'tide',   name: 'Marina Tide',        class: 'Deep Current Oracle', rarity: 'Rare',      accent: '#22d3ee', hue: 190 },
    { id: 'verse',  name: 'Lyra Verse',         class: 'Void Mystic',         rarity: 'Epic',      accent: '#c084fc', hue: 285 }
  ];

  // Counter for unique gradient IDs — SVGs live multiple times on page
  // (portrait picker grid renders 12 simultaneously).
  var _uid = 0;
  function nextId(charId) {
    return 'fp-' + (charId || 'x') + '-' + (++_uid);
  }

  function hsl(h, s, l) {
    return 'hsl(' + h + ',' + s + '%,' + l + '%)';
  }

  function get(idOrRec) {
    if (!idOrRec) return null;
    if (typeof idOrRec === 'object') return idOrRec;
    for (var i = 0; i < CHARACTERS.length; i++) {
      if (CHARACTERS[i].id === idOrRec) return CHARACTERS[i];
    }
    return null;
  }

  /**
   * Build portrait as an HTML string. Faster than DOM build for grids.
   * Port of shared.jsx lines 20-80 — every shape + gradient preserved.
   */
  function buildHtml(idOrRec) {
    var char = get(idOrRec);
    if (!char) char = CHARACTERS[0]; // graceful fallback
    var hue = char.hue;
    var id = nextId(char.id);

    return '' +
      '<svg viewBox="0 0 200 280" preserveAspectRatio="xMidYMid slice" ' +
        'xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; display: block;" ' +
        'aria-label="Portrait of ' + escAttr(char.name) + '">' +
        '<defs>' +
          '<linearGradient id="' + id + '-bg" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="' + hsl(hue, 55, 22) + '" />' +
            '<stop offset="0.5" stop-color="' + hsl(hue, 40, 14) + '" />' +
            '<stop offset="1" stop-color="' + hsl((hue + 20) % 360, 30, 6) + '" />' +
          '</linearGradient>' +
          '<radialGradient id="' + id + '-rim" cx="0.3" cy="0.3" r="0.7">' +
            '<stop offset="0" stop-color="' + hsl(hue, 80, 70) + '" stop-opacity="0.55" />' +
            '<stop offset="0.5" stop-color="' + hsl(hue, 80, 50) + '" stop-opacity="0.15" />' +
            '<stop offset="1" stop-color="#000" stop-opacity="0" />' +
          '</radialGradient>' +
          '<linearGradient id="' + id + '-skin" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="' + hsl(hue, 45, 52) + '" />' +
            '<stop offset="1" stop-color="' + hsl(hue, 35, 25) + '" />' +
          '</linearGradient>' +
          '<linearGradient id="' + id + '-hair" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="' + hsl((hue + 10) % 360, 60, 40) + '" />' +
            '<stop offset="1" stop-color="' + hsl(hue, 50, 15) + '" />' +
          '</linearGradient>' +
          '<filter id="' + id + '-blur"><feGaussianBlur stdDeviation="1.5"/></filter>' +
        '</defs>' +

        // BG fill + rim light
        '<rect width="200" height="280" fill="url(#' + id + '-bg)" />' +
        '<rect width="200" height="280" fill="url(#' + id + '-rim)" />' +

        // Atmospheric dust
        '<circle cx="30"  cy="60"  r="1.5" fill="' + hsl(hue, 80, 75) + '" opacity="0.5"/>' +
        '<circle cx="170" cy="90"  r="1"   fill="' + hsl(hue, 80, 75) + '" opacity="0.4"/>' +
        '<circle cx="50"  cy="180" r="1.2" fill="' + hsl(hue, 80, 75) + '" opacity="0.35"/>' +
        '<circle cx="155" cy="200" r="1"   fill="' + hsl(hue, 80, 75) + '" opacity="0.3"/>' +
        '<circle cx="20"  cy="220" r="0.8" fill="' + hsl(hue, 80, 75) + '" opacity="0.3"/>' +

        // Shoulders (two layers, back blurred for depth)
        '<path d="M 10 280 C 30 230, 60 215, 100 215 C 140 215, 170 230, 190 280 Z" ' +
              'fill="' + hsl(hue, 30, 12) + '" />' +
        '<path d="M 30 280 C 50 240, 70 225, 100 225 C 130 225, 150 240, 170 280 Z" ' +
              'fill="' + hsl(hue, 40, 18) + '" filter="url(#' + id + '-blur)" opacity="0.8"/>' +

        // Neck
        '<rect x="88" y="170" width="24" height="40" fill="url(#' + id + '-skin)" />' +

        // Head
        '<ellipse cx="100" cy="130" rx="40" ry="50" fill="url(#' + id + '-skin)" />' +

        // Hair mass
        '<path d="M 60 110 C 60 80, 80 65, 100 65 C 120 65, 140 80, 140 110 ' +
                'C 140 95, 135 85, 125 82 C 130 92, 128 102, 122 108 L 78 108 ' +
                'C 72 102, 70 92, 75 82 C 65 85, 60 95, 60 110 Z" ' +
              'fill="url(#' + id + '-hair)" />' +

        // Eye shadows
        '<ellipse cx="85"  cy="130" rx="7" ry="4" fill="#000" opacity="0.45"/>' +
        '<ellipse cx="115" cy="130" rx="7" ry="4" fill="#000" opacity="0.45"/>' +

        // Eye glows
        '<circle cx="85"  cy="130" r="1.5" fill="' + hsl(hue, 90, 80) + '" />' +
        '<circle cx="115" cy="130" r="1.5" fill="' + hsl(hue, 90, 80) + '" />' +

        // Nose/cheek shadow
        '<path d="M 100 135 L 96 150 L 104 150 Z" fill="#000" opacity="0.2"/>' +

        // Mouth
        '<path d="M 92 160 Q 100 164 108 160" stroke="#000" stroke-opacity="0.5" ' +
              'stroke-width="1.5" fill="none" stroke-linecap="round"/>' +

        // Rim light (curved highlight + vertical streak)
        '<path d="M 60 110 C 60 80, 80 65, 100 65 L 100 70 C 85 72, 68 88, 67 112 Z" ' +
              'fill="#fff" opacity="0.12"/>' +
        '<ellipse cx="78" cy="140" rx="3" ry="12" fill="#fff" opacity="0.08"/>' +

        // Foreground haze (darkens bottom so the card body blends into the portrait)
        '<rect y="220" width="200" height="60" fill="url(#' + id + '-bg)" opacity="0.6"/>' +
      '</svg>';
  }

  /**
   * Build portrait as a live DOM element. Useful for the Phase 5 dispatcher
   * (single long-lived node preserved across style swaps).
   */
  function build(idOrRec) {
    var wrap = document.createElement('div');
    wrap.innerHTML = buildHtml(idOrRec);
    return wrap.firstElementChild;
  }

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  window.ForgePortrait = {
    CHARACTERS: CHARACTERS,
    get: get,
    build: build,
    buildHtml: buildHtml
  };
})();
