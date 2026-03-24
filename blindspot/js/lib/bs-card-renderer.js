/**
 * Blindspot Card Renderer
 *
 * Builds rich card HTML from saved card data. No editor dependency.
 * Handles legacy stat migration (ensureCombatStats) and power calculation.
 *
 * API: window.BsCardRenderer
 */
window.BsCardRenderer = (function () {
  'use strict';

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  var _C = window.BsConst || {};
  var RC_STAT_DEFS = _C.RC_STAT_DEFS;

  var STAT_MAP = {
    strength: 'str', power: 'str', combat: 'str', attack: 'str',
    agility: 'agi', speed: 'agi', dexterity: 'agi',
    intelligence: 'int', magic: 'int', wisdom: 'int', tech: 'int',
    endurance: 'end', defense: 'end', vitality: 'end', constitution: 'end',
    luck: 'lck', charisma: 'lck', fortune: 'lck'
  };

  function ensureCombatStats(card) {
    if (!card) return;
    var cd = card.cardData;
    if (cd) {
      if (!card.combatStats && cd.combatStats) card.combatStats = cd.combatStats;
      if (!card.stats && cd.stats) card.stats = cd.stats;
      if (!card.palette && cd.design && cd.design.palette) card.palette = cd.design.palette;
      if (!card.rarity && cd.rarity) card.rarity = cd.rarity;
      if (!card.characterClass && cd.characterClass) card.characterClass = cd.characterClass;
      if (!card.quote && cd.quote) card.quote = cd.quote;
      if (!card.biography && cd.biography) card.biography = cd.biography;
      if (!card.design && cd.design) card.design = cd.design;
      if (!card.renderedFront && cd.renderedFront) card.renderedFront = cd.renderedFront;
      if (!card.frontClasses && cd.frontClasses) card.frontClasses = cd.frontClasses;
      if (!card.badges && cd.badges) card.badges = cd.badges;
      if (!card.attributes && cd.attributes) card.attributes = cd.attributes;
    }
    if (card.combatStats) return;
    if (!card.stats || !Array.isArray(card.stats) || card.stats.length === 0) {
      card.combatStats = { str: 60, agi: 60, int: 60, end: 60, lck: 60 };
      return;
    }
    card.combatStats = { str: 50, agi: 50, int: 50, end: 50, lck: 50 };
    card.stats.forEach(function(s) {
      var key = STAT_MAP[(s.name || '').toLowerCase().trim()];
      if (key) card.combatStats[key] = Math.min(100, Math.max(0, s.value || 0));
    });
  }

  function getCardPower(card) {
    if (!card) return 0;
    if (card.combatStats) {
      var s = card.combatStats;
      return (s.str || 0) + (s.agi || 0) + (s.int || 0) + (s.end || 0) + (s.lck || 0);
    }
    if (card.stats && Array.isArray(card.stats)) {
      return card.stats.reduce(function(sum, s) { return sum + (s.value || 0); }, 0);
    }
    return 0;
  }

  function renderCardHTML(card, size, opts) {
    if (!card) return '';
    opts = opts || {};
    ensureCombatStats(card);
    var cs = card.combatStats || {};
    var palette = card.palette || 'earth';
    var container = (card.design && card.design.imageContainer)
      || card.imageContainer
      || (card.cardData && card.cardData.design && card.cardData.design.imageContainer)
      || 'masked';
    var rarity = (card.rarity || 'Common').toLowerCase();
    var name = card.name || 'Unknown';
    var cls = card.class || card.characterClass || '';
    var avatar = card.avatar || '';

    var avatarHTML = avatar
      ? '<img src="' + escHtml(avatar) + '" alt="' + escHtml(name) + '" class="bs-rc__avatar" loading="lazy">'
      : '<div class="bs-rc__avatar-placeholder"><i class="fas fa-user"></i></div>';

    var statsHTML = '';
    if (size === 'full') {
      statsHTML = '<div class="bs-rc-stats">' + RC_STAT_DEFS.map(function(d) {
        var val = cs[d.key] || 0;
        return '<div class="bs-rc-stat">'
          + '<span class="bs-rc-stat__label" style="color:' + d.color + '">' + d.label + '</span>'
          + '<div class="bs-rc-stat__bar"><div class="bs-rc-stat__fill" style="width:' + val + '%;background:' + d.color + '"></div></div>'
          + '<span class="bs-rc-stat__val">' + val + '</span>'
          + '</div>';
      }).join('') + '</div>';
    }

    var totalPower = (cs.str || 0) + (cs.agi || 0) + (cs.int || 0) + (cs.end || 0) + (cs.lck || 0);
    var powerHTML = size !== 'micro'
      ? '<span class="bs-rc__power"><i class="fas fa-bolt"></i> ' + totalPower + '</span>'
      : '';

    // Title from equipped cosmetic or progression
    var titleText = '';
    if (size === 'full') {
      var _Cos = window.BsCosmetics;
      if (_Cos) {
        var equipped = _Cos.getEquipped();
        if (equipped.title) {
          var titleDef = _Cos.find(equipped.title);
          if (titleDef && titleDef.title) titleText = titleDef.title;
        }
      }
      if (!titleText) {
        var progress = window.BsState ? window.BsState.progress : {};
        titleText = progress.cardTitle || '';
      }
    }
    var titleHTML = titleText
      ? '<span class="bs-rc__title-badge">' + escHtml(titleText) + '</span>'
      : '';

    return '<div class="bs-rendered-card bs-rc--' + size + '" data-palette="' + escHtml(palette) + '" data-container="' + escHtml(container) + '" data-rarity="' + escHtml(rarity) + '">'
      + '<div class="bs-rc__art">' + avatarHTML + titleHTML + '</div>'
      + '<div class="bs-rc__info">'
      + '<span class="bs-rc__name">' + escHtml(name) + '</span>'
      + (size !== 'micro' ? '<span class="bs-rc__class">' + escHtml(cls) + '</span>' : '')
      + '</div>'
      + statsHTML
      + powerHTML
      + '</div>';
  }

  return {
    render: renderCardHTML,
    ensureCombatStats: ensureCombatStats,
    getCardPower: getCardPower
  };
})();
