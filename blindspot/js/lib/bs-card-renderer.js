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
      card.combatStats = { str: 12, agi: 12, int: 12, end: 12, lck: 12 };
      return;
    }
    card.combatStats = { str: 10, agi: 10, int: 10, end: 10, lck: 10 };
    card.stats.forEach(function(s) {
      var key = STAT_MAP[(s.name || '').toLowerCase().trim()];
      if (key) card.combatStats[key] = Math.min(20, Math.max(0, s.value || 0));
    });
  }

  function getCardBorderTier(cardId) {
    var tiers = (_C.BORDER_TIERS || []);
    if (!tiers.length) return null;
    var prog = window.BsState ? window.BsState.progress : {};
    var ch = cardId && prog.cardHistory ? prog.cardHistory[cardId] : null;
    var wins = ch ? (ch.wins || 0) : 0;
    var tier = tiers[0];
    for (var i = 0; i < tiers.length; i++) {
      if (wins >= tiers[i].minWins) tier = tiers[i];
    }
    return tier;
  }

  function getCardLevel(cardId) {
    var prog = window.BsState ? window.BsState.progress : {};
    var ch = cardId && prog.cardHistory ? prog.cardHistory[cardId] : null;
    return ch ? (ch.wins || 0) : 0;
  }

  function getCardEarnedTitles(cardId) {
    var milestones = (_C.CARD_TITLE_MILESTONES || []);
    var prog = window.BsState ? window.BsState.progress : {};
    var ch = cardId && prog.cardHistory ? prog.cardHistory[cardId] : null;
    if (!ch) return [];
    var earned = [];
    for (var i = 0; i < milestones.length; i++) {
      var m = milestones[i];
      if (m.wins && (ch.wins || 0) >= m.wins) earned.push(m);
      else if (m.bestStreak && (ch.bestStreak || 0) >= m.bestStreak) earned.push(m);
      else if (m.bossesBeaten && ch.bossesBeaten && ch.bossesBeaten.length >= m.bossesBeaten) earned.push(m);
    }
    return earned;
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
    // Avatar field has drifted across schemas — `avatar` is canonical, but
    // some legacy / external sources use `image`, `imageUrl`, or `art`.
    // Try them in order so cards from different eras still render their
    // art instead of falling back to the silhouette placeholder.
    var avatar = card.avatar || card.image || card.imageUrl || card.art || '';
    var element = card.element || (card.cardData && card.cardData.element)
      || (_C.CLASS_DEFAULT_ELEMENT && _C.CLASS_DEFAULT_ELEMENT[cls]) || '';

    var avatarHTML = avatar
      ? '<img src="' + escHtml(avatar) + '" alt="' + escHtml(name) + '" class="bs-rc__avatar" loading="lazy">'
      : '<div class="bs-rc__avatar-placeholder"><i class="fas fa-user"></i></div>';

    var statsHTML = '';
    if (size === 'full') {
      // Stat range auto-detect — CardForge editor produces stats in
      // 0-100 (free-form numeric input), `ensureCombatStats` clamps to
      // 0-20 when migrating from a `card.stats` array. Pick the
      // divisor by inspecting the actual stat values so bars render
      // proportionally for either range.
      var statMax = 20;
      for (var _i = 0; _i < RC_STAT_DEFS.length; _i++) {
        if ((cs[RC_STAT_DEFS[_i].key] || 0) > 20) { statMax = 100; break; }
      }
      // Each stat row gets a small illustrated stat icon if available
      // (str/agi/int/end/lck art lives at /blindspot/img/stats/{key}.webp).
      // Falls back silently to the bare text label via assetArtHtml's
      // onerror handler if an icon is missing.
      var hasStatArt = !!(window.BsCharms && window.BsCharms.assetArtHtml);
      statsHTML = '<div class="bs-rc-stats">' + RC_STAT_DEFS.map(function(d) {
        var val = cs[d.key] || 0;
        var pct = Math.max(0, Math.min(100, (val / statMax) * 100));
        var iconHtml = hasStatArt
          ? window.BsCharms.assetArtHtml('stats', d.key, null, d.label).replace('class="bs-item-art"', 'class="bs-rc-stat__icon"')
          : '';
        return '<div class="bs-rc-stat">'
          + iconHtml
          + '<span class="bs-rc-stat__label" style="color:' + d.color + '">' + d.label + '</span>'
          + '<div class="bs-rc-stat__bar"><div class="bs-rc-stat__fill" style="width:' + pct + '%;background:' + d.color + '"></div></div>'
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
    // Border evolution tier based on per-card battle history
    var cardId = card.id || '';
    var borderTier = getCardBorderTier(cardId);
    var borderAttr = borderTier ? ' data-border-tier="' + borderTier.id + '"' : '';

    // Best earned title for this card (last = highest) — falls through if
    // an explicit cosmetic/progression title is already set.
    var earnedTitles = getCardEarnedTitles(cardId);
    var bestEarnedTitle = earnedTitles.length > 0 ? earnedTitles[earnedTitles.length - 1] : null;
    var resolvedTitle = titleText || (bestEarnedTitle ? bestEarnedTitle.title : '');

    // Card level — visible identity number. 1 win = 1 level. Always shown
    // on full-size cards; on compact/micro the badge stays title-only to
    // keep small renders uncluttered.
    var titleHTML = '';
    if (size === 'full') {
      var level = getCardLevel(cardId);
      var badgeText = resolvedTitle
        ? ('Lv ' + level + ' · ' + resolvedTitle)
        : ('Lv ' + level);
      titleHTML = '<span class="bs-rc__title-badge">' + escHtml(badgeText) + '</span>';
    } else if (resolvedTitle) {
      titleHTML = '<span class="bs-rc__title-badge">' + escHtml(resolvedTitle) + '</span>';
    }

    var elementBadge = '';
    if (size === 'full' && element && _C.ELEMENT_DEFS && _C.ELEMENT_DEFS[element]) {
      var ed = _C.ELEMENT_DEFS[element];
      // Illustrated rune sigil if available; FA fallback otherwise.
      var elIcon = (window.BsCharms && window.BsCharms.assetArtHtml)
        ? window.BsCharms.assetArtHtml('elements', String(element).toLowerCase(), ed.icon, ed.label).replace('class="bs-item-art"', 'class="bs-rc__element-icon"')
        : '<i class="fas ' + ed.icon + '"></i>';
      elementBadge = '<span class="bs-rc__element" style="color:' + ed.color + '">' + elIcon + ' ' + ed.label + '</span>';
    }

    // Class trait chips — surface the class signature ability + play
    // pattern as two trait pills mirroring the boss-card trait row.
    // Pulls from CLASS_PATTERNS and CLASS_SIGNATURE_MOVES (case-insensitive
    // class lookup since card.class can be lowercased "rogue assassin"
    // while the dictionaries key on "Rogue"). Full-size only — micro/small
    // / preview renders skip the row to stay compact.
    var traitsHTML = '';
    if (size === 'full' && cls) {
      var sig = _C.CLASS_SIGNATURE_MOVES;
      var pat = _C.CLASS_PATTERNS;
      // Find the matching dictionary key by case-insensitive prefix match
      // ("rogue assassin" → "Rogue", "Caster" → "Caster").
      var matchKey = null;
      var clsLower = String(cls).toLowerCase();
      var dict = sig || pat || {};
      for (var k in dict) {
        if (Object.prototype.hasOwnProperty.call(dict, k)
            && clsLower.indexOf(String(k).toLowerCase()) !== -1) {
          matchKey = k;
          break;
        }
      }
      if (matchKey) {
        var sigEntry = sig && sig[matchKey];
        var patEntry = pat && pat[matchKey];
        var chips = '';
        // Show one trait chip (the class signature ability) to mirror
        // boss-card identity without overflowing the player card chrome.
        // Play-pattern goes into the chip's title attribute as a hover
        // tooltip so the info isn't lost.
        if (sigEntry && sigEntry.name) {
          var tip = patEntry ? ('Plays as: ' + patEntry) : 'Signature ability';
          chips += '<span class="bs-rc-trait bs-rc-trait--revealed bs-rc-trait--player" title="' + escHtml(tip) + '">'
            + '<i class="fas ' + escHtml(sigEntry.icon || 'fa-bolt') + '" aria-hidden="true"></i> '
            + escHtml(sigEntry.name)
            + '</span>';
        }
        if (chips) {
          traitsHTML = '<div class="bs-rc-traits bs-rc-traits--player">' + chips + '</div>';
        }
      }
    }

    // Class chip with illustrated emblem if we have art for this class.
    var classChip = '';
    if (size !== 'micro') {
      var classSlug = String(cls || '').toLowerCase();
      var classIcon = (window.BsCharms && window.BsCharms.assetArtHtml)
        ? window.BsCharms.assetArtHtml('classes', classSlug, null, cls).replace('class="bs-item-art"', 'class="bs-rc__class-icon"')
        : '';
      classChip = '<span class="bs-rc__class">' + classIcon + escHtml(cls) + '</span>';
    }

    return '<div class="bs-rendered-card bs-rc--' + size + '" data-palette="' + escHtml(palette) + '" data-container="' + escHtml(container) + '" data-rarity="' + escHtml(rarity) + '" data-element="' + escHtml(element) + '"' + borderAttr + '>'
      + '<div class="bs-rc__art">' + avatarHTML + titleHTML + '</div>'
      + '<div class="bs-rc__info">'
      + '<span class="bs-rc__name">' + escHtml(name) + '</span>'
      + classChip
      + elementBadge
      + '</div>'
      + statsHTML
      + traitsHTML
      + powerHTML
      + '</div>';
  }

  return {
    render: renderCardHTML,
    ensureCombatStats: ensureCombatStats,
    getCardPower: getCardPower,
    getCardBorderTier: getCardBorderTier,
    getCardEarnedTitles: getCardEarnedTitles,
    getCardLevel: getCardLevel
  };
})();
