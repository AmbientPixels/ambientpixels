/**
 * Boss card renderer
 *
 * Renders a boss as a card mirroring the player card structure, with a
 * "redacted mirror" layer: stats and traits with `revealed: false`
 * display as silhouettes / "???" placeholders until reveal triggers
 * fire (wired in a later phase).
 *
 * Public API:
 *   window.BsBossCard.load(url?)        — fetches data/boss-cards.json,
 *                                          caches it on first call
 *   window.BsBossCard.get(bossId)       — returns the boss-card data
 *                                          for an id (or null)
 *   window.BsBossCard.render(bossCard)  — returns full card HTML matching
 *                                          .bs-rendered-card structure
 *   window.BsBossCard.renderInto(el, bossId) — async helper: looks up,
 *                                          renders into element, returns
 *                                          the resolved data or null
 */
window.BsBossCard = (function () {
  'use strict';

  var _data = null;     // { bosses: { [id]: bossCard } }
  var _loadPromise = null;
  var DEFAULT_URL = '/blindspot/data/boss-cards.json';

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function load(url) {
    if (_data) return Promise.resolve(_data);
    if (_loadPromise) return _loadPromise;
    _loadPromise = fetch(url || DEFAULT_URL, { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { _data = j; return j; })
      .catch(function () { return null; });
    return _loadPromise;
  }

  function get(bossId) {
    if (!_data || !_data.bosses) return null;
    return _data.bosses[bossId] || null;
  }

  // Stat row: revealed → coloured fill, value visible. Unrevealed →
  // dim silhouette bar, "???" instead of the number. The label always
  // shows so the player can still tell which stat slot is which.
  var STAT_DEFS = [
    { key: 'str', label: 'STR', color: '#ef4444' },
    { key: 'agi', label: 'AGI', color: '#22c55e' },
    { key: 'int', label: 'INT', color: '#a855f7' }
  ];

  function renderStatRow(stat, def) {
    var s = stat || { value: 0, revealed: false };
    var pct = Math.max(0, Math.min(100, ((s.value || 0) / 20) * 100));
    if (s.revealed) {
      return '<div class="bs-rc-stat bs-rc-stat--revealed">'
        + '<span class="bs-rc-stat__label" style="color:' + def.color + '">' + def.label + '</span>'
        + '<div class="bs-rc-stat__bar"><div class="bs-rc-stat__fill" style="width:' + pct + '%;background:' + def.color + '"></div></div>'
        + '<span class="bs-rc-stat__val">' + (s.value || 0) + '</span>'
        + '</div>';
    }
    // Redacted: silhouette bar (low opacity, no colour), "???" value.
    return '<div class="bs-rc-stat bs-rc-stat--redacted">'
      + '<span class="bs-rc-stat__label" style="color:' + def.color + ';opacity:0.55">' + def.label + '</span>'
      + '<div class="bs-rc-stat__bar bs-rc-stat__bar--redacted"></div>'
      + '<span class="bs-rc-stat__val bs-rc-stat__val--redacted">???</span>'
      + '</div>';
  }

  function renderTraitChip(trait) {
    if (trait.revealed) {
      return '<span class="bs-rc-trait bs-rc-trait--revealed" title="' + escHtml(trait.desc || '') + '">'
        + '<i class="fas fa-bolt" aria-hidden="true"></i> '
        + escHtml(trait.name)
        + '</span>';
    }
    return '<span class="bs-rc-trait bs-rc-trait--locked" aria-label="Locked trait">'
      + '<i class="fas fa-lock" aria-hidden="true"></i> ???'
      + '</span>';
  }

  function render(bc) {
    if (!bc) return '';
    var portrait = bc.portrait || '';
    var avatarHTML = portrait
      ? '<img src="' + escHtml(portrait) + '" alt="' + escHtml(bc.name || '') + '" class="bs-rc__avatar" loading="lazy">'
      : '<div class="bs-rc__avatar-placeholder"><i class="fas fa-skull"></i></div>';

    // Tier badge sits inside the art slot, top-right corner — like
    // the player's title badge but indicates threat level instead.
    var tier = Math.max(1, Math.min(5, bc.tier || 1));
    var tierHTML = '<span class="bs-rc__tier-badge" data-tier="' + tier + '" title="Threat tier ' + tier + '">'
      + 'T' + tier + '</span>';

    // Element badge — icon only (no text label) so it matches the
    // legacy nameplate's `.arena-element-badge` which only ever
    // rendered the icon. Pulls icon + colour from BsConst.
    var elementHTML = '';
    var element = (bc.element || '').toLowerCase();
    var _Const = window.BsConst || {};
    var _ED = _Const.ELEMENT_DEFS || {};
    if (element && _ED[element]) {
      var ed = _ED[element];
      elementHTML = '<span class="bs-rc__element" style="color:' + ed.color + '" title="' + escHtml(ed.label) + ' element" aria-label="' + escHtml(ed.label) + ' element">'
        + '<i class="fas ' + ed.icon + '"></i>'
        + '</span>';
    }

    var statsHTML = '<div class="bs-rc-stats bs-rc-stats--boss">'
      + STAT_DEFS.map(function (d) { return renderStatRow(bc.stats && bc.stats[d.key], d); }).join('')
      + '</div>';

    var traits = Array.isArray(bc.traits) ? bc.traits : [];
    var traitsHTML = '';
    if (traits.length) {
      traitsHTML = '<div class="bs-rc-traits">'
        + traits.map(renderTraitChip).join('')
        + '</div>';
    }

    return '<div class="bs-rendered-card bs-rc--full bs-rc--boss"'
      + ' data-boss-id="' + escHtml(bc.id || '') + '"'
      + ' data-tier="' + tier + '"'
      + ' data-element="' + escHtml(element) + '"'
      + ' data-archetype="' + escHtml((bc.archetype || '').toLowerCase()) + '"'
      + '>'
      + '<div class="bs-rc__art">' + avatarHTML + tierHTML + '</div>'
      + '<div class="bs-rc__info">'
      +   '<span class="bs-rc__name">' + escHtml(bc.name || '???') + '</span>'
      +   '<span class="bs-rc__class">' + escHtml(bc.archetype || '') + '</span>'
      +   elementHTML
      + '</div>'
      + statsHTML
      + traitsHTML
      + '</div>';
  }

  // Convenience: pull data, render into a target element. Returns the
  // resolved boss-card object (or null if unknown id / fetch failed).
  function renderInto(el, bossId) {
    if (!el) return Promise.resolve(null);
    return load().then(function () {
      var bc = get(bossId);
      if (!bc) return null;
      el.innerHTML = render(bc);
      return bc;
    });
  }

  return { load: load, get: get, render: render, renderInto: renderInto };
})();
