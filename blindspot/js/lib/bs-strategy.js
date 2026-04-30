/**
 * Blindspot Strategy — Passives, Archetypes, Move Matchups, Prefight Info
 *
 * Pure game logic for combat strategy display. No mutable state.
 *
 * API: window.BsStrategy
 */
window.BsStrategy = (function () {
  'use strict';

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  var _C = window.BsConst || {};
  var STAT_PASSIVES = _C.STAT_PASSIVES;
  var MOVE_UPGRADES = _C.MOVE_UPGRADES;
  var ARCHETYPES = _C.ARCHETYPES;
  var WEAKNESS_LABELS = _C.WEAKNESS_LABELS;
  var WEAKNESS_COLORS = _C.WEAKNESS_COLORS;
  var BOSS_ICONS = _C.BOSS_ICONS;
  var CLASS_PATTERNS = _C.CLASS_PATTERNS;
  var MOVE_BEATS = _C.MOVE_BEATS;
  var BATTLE_HINTS = _C.BATTLE_HINTS;

  // ── Pure functions ──

  function detectArchetype(stats) {
    if (!stats) return ARCHETYPES.find(function(a) { return a.id === 'balanced'; });
    var sorted = Object.entries(stats).sort(function(a, b) { return b[1] - a[1]; });
    var top = sorted[0][0];
    var second = sorted[1][0];
    for (var i = 0; i < ARCHETYPES.length; i++) {
      var arch = ARCHETYPES[i];
      if (arch.primary === top && arch.secondary === second) return arch;
      if (arch.primary === top) return arch;
    }
    return ARCHETYPES.find(function(a) { return a.id === 'balanced'; });
  }

  function getActivePassives(stats) {
    if (!stats) return [];
    var active = [];
    var statKeys = Object.keys(STAT_PASSIVES);
    for (var s = 0; s < statKeys.length; s++) {
      var stat = statKeys[s];
      var tiers = STAT_PASSIVES[stat];
      for (var t = 0; t < tiers.length; t++) {
        if ((stats[stat] || 0) >= tiers[t].threshold) {
          active.push(Object.assign({}, tiers[t], { stat: stat }));
        }
      }
    }
    return active;
  }

  function getNextPassive(stats) {
    if (!stats) return null;
    var closest = null;
    var closestGap = Infinity;
    var statKeys = Object.keys(STAT_PASSIVES);
    for (var s = 0; s < statKeys.length; s++) {
      var stat = statKeys[s];
      var tiers = STAT_PASSIVES[stat];
      for (var t = 0; t < tiers.length; t++) {
        var gap = tiers[t].threshold - (stats[stat] || 0);
        if (gap > 0 && gap < closestGap) {
          closestGap = gap;
          closest = Object.assign({}, tiers[t], { stat: stat, gap: gap });
        }
      }
    }
    return closest;
  }

  function getMoveMatchup(playerMove, opponentMove) {
    if (!playerMove || !opponentMove || playerMove === opponentMove) return 'draw';
    if (MOVE_BEATS[playerMove] && MOVE_BEATS[playerMove].indexOf(opponentMove) !== -1) return 'win';
    if (MOVE_BEATS[opponentMove] && MOVE_BEATS[opponentMove].indexOf(playerMove) !== -1) return 'lose';
    return 'draw';
  }

  // ── Prefight info HTML builder ──

  function buildPrefightInfo(boss) {
    return '"' + escHtml(boss.flavor || '') + '"';
  }

  // Resolves move-weakness vs resistance overlap defensively. If the same
  // move appears in BOTH dictionaries (e.g. "ability" tagged as +20% weak
  // AND -25% resist), the larger absolute value wins. We console.warn so a
  // real data bug surfaces in logs.
  function _reconcileBossMoveSignals(boss) {
    var mwIn = boss && boss.moveWeaknesses ? boss.moveWeaknesses : {};
    var resIn = boss && boss.resistances ? boss.resistances : {};
    var mw = {}, res = {}, keys = {};
    Object.keys(mwIn).forEach(function (k) { keys[k] = true; });
    Object.keys(resIn).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).forEach(function (k) {
      var w = +mwIn[k] || 0;
      var r = +resIn[k] || 0;
      if (w > 0 && r > 0) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[BS prefight] Boss "' + (boss.name || boss.id) + '" has overlapping move signal for "' + k + '": +' + w + '% weak vs -' + r + '% resist. Using larger.');
        }
        if (w >= r) mw[k] = w; else res[k] = r;
      } else {
        if (w > 0) mw[k] = w;
        if (r > 0) res[k] = r;
      }
    });
    return { moveWeaknesses: mw, resistances: res };
  }

  // Renders structured boss intel grouped into Advantages / Threats /
  // Properties — replaces the old flat <br>-separated string.
  function buildBossIntelRows(boss) {
    var _ED = _C.ELEMENT_DEFS || {};
    var _CDE = _C.CLASS_DEFAULT_ELEMENT || {};
    var bossEl = boss.element || _CDE[boss.class] || '';
    var moves = _reconcileBossMoveSignals(boss);
    var adv = [], thr = [], props = [];

    if (boss.weakness) {
      adv.push({ k: 'Stat weakness', v: (WEAKNESS_LABELS[boss.weakness] || boss.weakness), cls: 'blindspot-intel-row__v--good' });
    }
    var mwKeys = Object.keys(moves.moveWeaknesses);
    if (mwKeys.length) {
      adv.push({
        k: 'Weak to',
        v: mwKeys.map(function (k) { return k + ' +' + moves.moveWeaknesses[k] + '%'; }).join(', '),
        cls: 'blindspot-intel-row__v--good'
      });
    }
    var resKeys = Object.keys(moves.resistances);
    if (resKeys.length) {
      thr.push({
        k: 'Resists',
        v: resKeys.map(function (k) { return k.toUpperCase() + ' -' + moves.resistances[k] + '%'; }).join(', '),
        cls: 'blindspot-intel-row__v--bad'
      });
    }
    if (boss.signaturePassive) {
      thr.push({
        k: 'Signature',
        v: '★ ' + escHtml(boss.signaturePassive.name) + ' — ' + escHtml(boss.signaturePassive.desc),
        cls: 'blindspot-intel-row__v--epic',
        raw: true
      });
    }
    if (bossEl && _ED[bossEl]) {
      props.push({
        k: 'Element',
        v: '<i class="fas ' + _ED[bossEl].icon + '" style="color:' + _ED[bossEl].color + ';"></i> ' + _ED[bossEl].label,
        raw: true
      });
    }
    if (CLASS_PATTERNS[boss.class]) {
      props.push({ k: 'Tendency', v: CLASS_PATTERNS[boss.class] });
    }

    function renderGroup(label, rows) {
      if (!rows.length) return '';
      var inner = rows.map(function (r) {
        var v = r.raw ? r.v : escHtml(r.v);
        return '<div class="blindspot-intel-row">'
             + '<span class="blindspot-intel-row__k">' + escHtml(r.k) + '</span>'
             + '<span class="blindspot-intel-row__v ' + (r.cls || '') + '">' + v + '</span>'
             + '</div>';
      }).join('');
      return '<div class="blindspot-intel-group">'
           + '<div class="blindspot-intel-group__label">' + label + '</div>'
           + inner + '</div>';
    }

    return renderGroup('Advantages', adv) + renderGroup('Threats', thr) + renderGroup('Properties', props);
  }

  // Single elemental matchup callout. Returns '' when neutral so the slot
  // collapses cleanly.
  function buildMatchupCallout(playerEl, bossEl) {
    var _ED = _C.ELEMENT_DEFS || {};
    var _EC = _C.ELEMENT_CHART || {};
    if (!playerEl || !bossEl) return '';
    if (!_EC[playerEl] || !_ED[playerEl] || !_ED[bossEl]) return '';
    var icon = '<i class="fas ' + _ED[playerEl].icon + '" style="color:' + _ED[playerEl].color + ';"></i>';
    if (playerEl === bossEl) {
      return '<span class="blindspot-prefight__matchup blindspot-prefight__matchup--neutral">'
           + icon + ' Same element — no elemental bonus either way</span>';
    }
    if (_EC[playerEl].strong === bossEl) {
      return '<span class="blindspot-prefight__matchup blindspot-prefight__matchup--good">'
           + icon + ' Your ' + _ED[playerEl].label + ' is strong vs ' + _ED[bossEl].label + ' (+25% dmg)</span>';
    }
    if (_EC[playerEl].weak === bossEl) {
      return '<span class="blindspot-prefight__matchup blindspot-prefight__matchup--bad">'
           + icon + ' Your ' + _ED[playerEl].label + ' is weak vs ' + _ED[bossEl].label + ' (-25% dmg)</span>';
    }
    return '';
  }

  function buildDeckThumbs(deck) {
    if (!Array.isArray(deck) || !deck.length) return '';
    var thumbs = deck.map(function (c) {
      if (!c) return '';
      var avatar = c.avatar || (c.cardData && c.cardData.avatar) || '';
      var name = c.name || 'Card';
      if (avatar) {
        return '<span class="blindspot-prefight__deck-thumb" title="' + escHtml(name) + '" style="background-image:url(\'' + String(avatar).replace(/'/g, '%27') + '\');"></span>';
      }
      return '<span class="blindspot-prefight__deck-thumb blindspot-prefight__deck-thumb--empty" title="' + escHtml(name) + '"></span>';
    }).join('');
    return '<div class="blindspot-prefight__deck-label">Active deck (' + deck.length + ')</div>'
         + '<div class="blindspot-prefight__deck-thumbs">' + thumbs + '</div>';
  }

  // (Old buildPrefightInfo body removed — boss intel now rendered as
  // structured rows by buildBossIntelRows above.)
  /*
    var html = '"' + escHtml(boss.flavor) + '"';
    if (boss.weakness) {
      html += '<br><span style="color:' + (WEAKNESS_COLORS[boss.weakness] || 'var(--bs-accent)') + ';font-size:0.8rem;margin-top:0.5rem;display:inline-block;"><i class="fas fa-crosshairs"></i> Stat weakness: ' + (WEAKNESS_LABELS[boss.weakness] || boss.weakness) + '</span>';
    }
    var res = boss.resistances || {};
    var resKeys = Object.keys(res).filter(function(k) { return res[k] > 0; });
    if (resKeys.length) {
      html += '<br><span style="font-size:0.75rem;color:#ff6b6b;display:inline-block;"><i class="fas fa-shield-halved"></i> Resists: ' + resKeys.map(function(k) { return k + ' -' + res[k] + '%'; }).join(', ') + '</span>';
    }
    var mw = boss.moveWeaknesses || {};
    var mwKeys = Object.keys(mw).filter(function(k) { return mw[k] > 0; });
    if (mwKeys.length) {
      html += '<br><span style="font-size:0.75rem;color:#4ade80;display:inline-block;"><i class="fas fa-bullseye"></i> Weak to: ' + mwKeys.map(function(k) { return k + ' +' + mw[k] + '%'; }).join(', ') + '</span>';
    }
    if (boss.signaturePassive) {
      html += '<br><span style="font-size:0.75rem;color:var(--bs-accent);display:inline-block;"><i class="fas fa-star"></i> ' + escHtml(boss.signaturePassive.name) + ' \u2014 ' + escHtml(boss.signaturePassive.desc) + '</span>';
    }
    if (CLASS_PATTERNS[boss.class]) {
      html += '<br><span style="font-size:0.75rem;color:var(--bs-text-muted);display:inline-block;"><i class="fas fa-chess"></i> Tends to: ' + CLASS_PATTERNS[boss.class] + '</span>';
    }
    if (boss.bossTip) {
      html += '<br><span style="font-size:0.75rem;color:var(--bs-text-muted);font-style:italic;margin-top:0.25rem;display:inline-block;">' + escHtml(boss.bossTip) + '</span>';
    }
    // Element badge for boss
    var _ED = _C.ELEMENT_DEFS || {};
    var _EC = _C.ELEMENT_CHART || {};
    var _CDE = _C.CLASS_DEFAULT_ELEMENT || {};
    var bossEl = boss.element || _CDE[boss.class] || '';
    if (bossEl && _ED[bossEl]) {
      html += '<br><span style="font-size:0.8rem;color:' + _ED[bossEl].color + ';display:inline-block;margin-top:0.3rem;"><i class="fas ' + _ED[bossEl].icon + '"></i> ' + _ED[bossEl].label + ' Element</span>';
    }
    return html;
  */

  // ── Prefight overlay population (needs card + DOM) ──

  // Set the boss portrait — static .webp goes on as a CSS background
  // (also serves as the poster while a video buffers), and if the
  // boss-card data has a .mp4/.webm portrait we layer a <video> on top.
  // The veil + element badge come after the video in DOM order so they
  // paint above it without needing z-index.
  function applyBossPortrait(bossPortraitEl, boss) {
    if (boss.avatar) {
      bossPortraitEl.style.backgroundImage = 'url("' + String(boss.avatar).replace(/"/g, '\\"') + '")';
    }
    var priorVid = bossPortraitEl.querySelector('video.blindspot-prefight__portrait-video');
    if (priorVid) priorVid.remove();
    if (!window.BsBossCard) return;
    bossPortraitEl._activeBossId = boss.id;
    var inject = function () {
      var bcData = window.BsBossCard.get && window.BsBossCard.get(boss.id);
      var portrait = bcData && bcData.portrait;
      if (!portrait || !/\.(mp4|webm)(\?|$)/i.test(portrait)) return;
      // Boss could have changed during the async load (rapid pager nav).
      if (bossPortraitEl._activeBossId !== boss.id) return;
      if (bossPortraitEl.querySelector('video.blindspot-prefight__portrait-video')) return;
      var vid = document.createElement('video');
      vid.className = 'blindspot-prefight__portrait-video';
      vid.src = portrait;
      vid.autoplay = true;
      vid.loop = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.setAttribute('preload', 'metadata');
      bossPortraitEl.insertBefore(vid, bossPortraitEl.firstChild);
    };
    if (window.BsBossCard.load) {
      window.BsBossCard.load().then(inject);
    } else {
      inject();
    }
  }

  function populatePrefightOverlay(boss, selectedCard, opts) {
    if (!boss) return;
    opts = opts || {};
    var deck = Array.isArray(opts.deck) ? opts.deck : [];
    var winStreak = +opts.winStreak || 0;
    var bestStreak = +opts.bestStreak || 0;

    var _ED = _C.ELEMENT_DEFS || {};
    var _EC = _C.ELEMENT_CHART || {};
    var _CDE = _C.CLASS_DEFAULT_ELEMENT || {};
    var bossEl = boss.element || _CDE[boss.class] || '';
    var playerEl = selectedCard ? (selectedCard.element || _CDE[selectedCard.class || selectedCard.characterClass] || '') : '';

    // ─── Boss column ──────────────────────────────────────────────
    var titleEl = document.getElementById('bs-prefight-title');
    var flavorEl = document.getElementById('bs-prefight-flavor');
    var avatarEl = document.getElementById('bs-prefight-avatar');
    var bossPortraitEl = document.getElementById('bs-prefight-boss-portrait')
      || document.querySelector('#bs-prefight-overlay .blindspot-prefight__boss .blindspot-prefight__portrait');
    var bossIntelEl = document.getElementById('bs-prefight-boss-intel');

    if (titleEl) titleEl.textContent = boss.name || '';
    if (flavorEl) flavorEl.innerHTML = buildPrefightInfo(boss);
    if (bossPortraitEl) applyBossPortrait(bossPortraitEl, boss);
    if (avatarEl) {
      avatarEl.style.width = '';
      avatarEl.style.height = '';
      if (bossEl && _ED[bossEl]) {
        avatarEl.innerHTML = '<i class="fas ' + _ED[bossEl].icon + '" style="color:' + _ED[bossEl].color + ';"></i> ' + _ED[bossEl].label;
      } else {
        var bIcon = BOSS_ICONS[boss.class] || 'fa-skull';
        avatarEl.innerHTML = '<i class="fas ' + bIcon + '"></i>';
      }
    }
    if (bossIntelEl) bossIntelEl.innerHTML = buildBossIntelRows(boss);

    // ─── Single elemental matchup callout (placed once, between
    //     flavor and intel groups) ─────────────────────────────────
    var matchupEl = document.getElementById('bs-prefight-matchup');
    if (!matchupEl) {
      matchupEl = document.createElement('div');
      matchupEl.id = 'bs-prefight-matchup';
      matchupEl.className = 'blindspot-prefight__matchup-row';
      if (flavorEl && flavorEl.parentNode) flavorEl.parentNode.insertBefore(matchupEl, flavorEl.nextSibling);
    }
    if (matchupEl) matchupEl.innerHTML = buildMatchupCallout(playerEl, bossEl);

    // ─── Topline: chapter, difficulty, pager — all from bossNum so
    //     they cannot disagree ───────────────────────────────────
    var bossIdMatch = boss.id ? String(boss.id).match(/(\d+)$/) : null;
    var bossNum = bossIdMatch ? parseInt(bossIdMatch[1], 10) : 0;
    var overlay = document.getElementById('bs-prefight-overlay');
    if (overlay && bossNum) overlay.setAttribute('data-boss-num', String(bossNum));

    var chapterEl = document.getElementById('bs-prefight-chapter');
    if (chapterEl && bossNum) chapterEl.textContent = 'Chapter ' + bossNum + ' of 10';

    var diffEl = document.getElementById('bs-prefight-difficulty');
    var diffNumEl = document.getElementById('bs-prefight-difficulty-num');
    if (bossNum && (diffEl || diffNumEl)) {
      // Difficulty derives from boss number — 5 buckets across 10 bosses.
      var tier = Math.max(1, Math.min(5, Math.ceil(bossNum / 2)));
      if (diffEl) {
        var dots = '';
        for (var d = 1; d <= 5; d++) {
          dots += d <= tier ? '●' : '○';
        }
        diffEl.textContent = dots;
        diffEl.setAttribute('aria-label', 'Difficulty ' + tier + ' of 5');
      }
      if (diffNumEl) diffNumEl.textContent = tier + '/5';
    }

    var pagerCount = document.getElementById('bs-prefight-pager-count');
    if (pagerCount && bossNum) pagerCount.textContent = String(bossNum).padStart(2, '0') + ' / 10';
    var prevBtn = document.getElementById('bs-prefight-pager-prev');
    var nextBtn = document.getElementById('bs-prefight-pager-next');
    if (prevBtn) prevBtn.disabled = bossNum <= 1;
    if (nextBtn) nextBtn.disabled = bossNum >= 10;

    // ─── VS column eyebrow names ──────────────────────────────────
    var youVsEl = document.getElementById('bs-prefight-you-vs-name');
    var bossVsEl = document.getElementById('bs-prefight-boss-vs-name');
    if (bossVsEl) bossVsEl.textContent = boss.name || 'Boss';
    if (youVsEl) youVsEl.textContent = selectedCard ? (selectedCard.name || 'Your Card') : 'You';

    // ─── YOU column ───────────────────────────────────────────────
    var youPortraitEl = document.getElementById('bs-prefight-you-portrait');
    var youElBadgeEl = document.getElementById('bs-prefight-you-el-badge');
    var youNameEl = document.getElementById('bs-prefight-you-name');
    var youFlavorEl = document.getElementById('bs-prefight-you-flavor');
    var youIntelEl = document.getElementById('bs-prefight-you-intel');
    var youDeckEl = document.getElementById('bs-prefight-you-deck');

    if (selectedCard) {
      var pAvatar = selectedCard.avatar || (selectedCard.cardData && selectedCard.cardData.avatar) || '';
      if (youPortraitEl) {
        if (pAvatar) {
          youPortraitEl.style.backgroundImage = 'url("' + String(pAvatar).replace(/"/g, '\\"') + '")';
        } else {
          youPortraitEl.style.backgroundImage = '';
        }
      }
      if (youNameEl) youNameEl.textContent = selectedCard.name || 'Your Card';

      // Player flavor: real card.quote → archetype tagline → class fallback.
      var pClass = selectedCard.class || selectedCard.characterClass || '';
      var quote = selectedCard.quote || (selectedCard.cardData && selectedCard.cardData.quote) || '';
      var arch = detectArchetype(selectedCard.combatStats);
      var archLabel = (arch && arch.label) ? arch.label : '';
      if (youFlavorEl) {
        if (quote) {
          youFlavorEl.innerHTML = '<em>"' + escHtml(quote) + '"</em>';
        } else if (pClass || archLabel) {
          var bits = [];
          if (pClass) bits.push(escHtml(pClass));
          if (archLabel && archLabel.toLowerCase() !== String(pClass).toLowerCase()) bits.push(escHtml(archLabel));
          youFlavorEl.innerHTML = '<em>' + bits.join(' · ') + '</em>';
        } else {
          youFlavorEl.innerHTML = '&nbsp;';
        }
      }

      if (youElBadgeEl) {
        if (playerEl && _ED[playerEl]) {
          youElBadgeEl.innerHTML = '<i class="fas ' + _ED[playerEl].icon + '" style="color:' + _ED[playerEl].color + ';"></i> ' + _ED[playerEl].label;
        } else {
          youElBadgeEl.innerHTML = '';
        }
      }

      // Player intel rows — mirror density of the boss column.
      if (youIntelEl) {
        var ps = selectedCard.combatStats || {};
        var totalPower = (ps.str || 0) + (ps.agi || 0) + (ps.int || 0) + (ps.end || 0) + (ps.lck || 0);
        var streakCopy = winStreak >= 5
          ? winStreak + ' wins · +10% spark bonus active'
          : (winStreak + ' wins' + (winStreak > 0 ? ' · +10% bonus at 5' : ''));
        var sigCopy = arch ? ('★ ' + (arch.label || arch.id) + (arch.tagline ? ' — ' + arch.tagline : '')) : '';
        var rows = [];
        rows.push('<div class="blindspot-intel-row"><span class="blindspot-intel-row__k">Power</span><span class="blindspot-intel-row__v">' + totalPower + '</span></div>');
        rows.push('<div class="blindspot-intel-row"><span class="blindspot-intel-row__k">Streak</span><span class="blindspot-intel-row__v blindspot-intel-row__v--accent">' + escHtml(streakCopy) + '</span></div>');
        if (bestStreak > 0) {
          rows.push('<div class="blindspot-intel-row"><span class="blindspot-intel-row__k">Best</span><span class="blindspot-intel-row__v">' + bestStreak + '</span></div>');
        }
        rows.push('<div class="blindspot-intel-row"><span class="blindspot-intel-row__k">Deck</span><span class="blindspot-intel-row__v">' + deck.length + ' / 8 cards</span></div>');
        if (sigCopy) {
          rows.push('<div class="blindspot-intel-row"><span class="blindspot-intel-row__k">Signature</span><span class="blindspot-intel-row__v blindspot-intel-row__v--gold">' + escHtml(sigCopy) + '</span></div>');
        }
        youIntelEl.innerHTML = rows.join('');
      }

      if (youDeckEl) youDeckEl.innerHTML = buildDeckThumbs(deck);
    } else {
      // No selected card — clear placeholders rather than leaving stale mock data.
      if (youPortraitEl) youPortraitEl.style.backgroundImage = '';
      if (youElBadgeEl) youElBadgeEl.innerHTML = '';
      if (youNameEl) youNameEl.textContent = '—';
      if (youFlavorEl) youFlavorEl.innerHTML = '&nbsp;';
      if (youIntelEl) youIntelEl.innerHTML = '';
      if (youDeckEl) youDeckEl.innerHTML = '';
    }

    // ─── Stat comparison (existing, kept) ─────────────────────────
    var compEl = document.getElementById('bs-prefight-comparison');
    if (compEl && selectedCard) {
      var psc = selectedCard.combatStats || {};
      var bsc = boss.combatStats || {};
      // Diagnostic: surface zero-stat player cards so the root cause is
      // visible in console rather than silently rendering an empty bar.
      var psSum = (psc.str || 0) + (psc.agi || 0) + (psc.int || 0) + (psc.end || 0) + (psc.lck || 0);
      if (psSum === 0 && typeof console !== 'undefined' && console.warn) {
        console.warn('[BS prefight] selectedCard.combatStats sums to 0', selectedCard);
      }
      var labels = [
        { key: 'str', label: 'STR', icon: 'fa-fist-raised' },
        { key: 'agi', label: 'AGI', icon: 'fa-wind' },
        { key: 'int', label: 'INT', icon: 'fa-brain' },
        { key: 'end', label: 'END', icon: 'fa-shield-alt' },
        { key: 'lck', label: 'LCK', icon: 'fa-dice' }
      ];
      compEl.innerHTML = '<div class="bs-prefight-comparison__header">'
        + '<span class="bs-prefight-comparison__you">You</span>'
        + '<span class="bs-prefight-comparison__vs">VS</span>'
        + '<span class="bs-prefight-comparison__boss">' + escHtml(boss.name || '') + '</span>'
        + '</div>'
        + labels.map(function (s) {
            var pv = psc[s.key] || 0;
            var bv = bsc[s.key] || 0;
            var diff = pv - bv;
            var diffClass = diff > 0 ? 'bs-stat-advantage' : diff < 0 ? 'bs-stat-disadvantage' : 'bs-stat-even';
            // Bars derive width from the SAME value as the displayed number
            // — single source per row.
            var pPct = Math.min(100, Math.max(0, (pv / 20) * 100));
            var bPct = Math.min(100, Math.max(0, (bv / 20) * 100));
            return '<div class="bs-prefight-stat-row">'
              + '<span class="bs-prefight-stat-row__pval">' + pv + '</span>'
              + '<div class="bs-prefight-stat-row__bar">'
              + '<div class="bs-prefight-stat-row__fill bs-prefight-stat-row__fill--player" style="width:' + pPct + '%"></div>'
              + '</div>'
              + '<span class="bs-prefight-stat-row__label"><i class="fas ' + s.icon + '"></i> ' + s.label + '</span>'
              + '<div class="bs-prefight-stat-row__bar">'
              + '<div class="bs-prefight-stat-row__fill bs-prefight-stat-row__fill--boss" style="width:' + bPct + '%"></div>'
              + '</div>'
              + '<span class="bs-prefight-stat-row__bval ' + diffClass + '">' + bv + '</span>'
              + '</div>';
          }).join('');
    } else if (compEl) {
      compEl.innerHTML = '';
    }
  }

  // ── Move flash (DOM) ──

  function flashMoveResult(playerMove, opponentMove) {
    var matchup = getMoveMatchup(playerMove, opponentMove);
    if (matchup === 'draw') return;
    var playerBtn = document.querySelector('[data-move="' + playerMove + '"]');
    var opponentBtn = document.querySelector('[data-move="' + opponentMove + '"]');
    if (!playerBtn) return;
    var winClass = 'bs-move-flash--win';
    var loseClass = 'bs-move-flash--lose';
    if (matchup === 'win') {
      playerBtn.classList.add(winClass);
      if (opponentBtn) opponentBtn.classList.add(loseClass);
    } else {
      playerBtn.classList.add(loseClass);
      if (opponentBtn) opponentBtn.classList.add(winClass);
    }
    setTimeout(function () {
      playerBtn.classList.remove(winClass, loseClass);
      if (opponentBtn) opponentBtn.classList.remove(winClass, loseClass);
    }, 600);
  }

  // ── Public API ──

  return {
    detectArchetype: detectArchetype,
    getActivePassives: getActivePassives,
    getNextPassive: getNextPassive,
    getMoveMatchup: getMoveMatchup,
    buildPrefightInfo: buildPrefightInfo,
    populatePrefightOverlay: populatePrefightOverlay,
    flashMoveResult: flashMoveResult,
    STAT_PASSIVES: STAT_PASSIVES,
    MOVE_UPGRADES: MOVE_UPGRADES,
    ARCHETYPES: ARCHETYPES,
    WEAKNESS_LABELS: WEAKNESS_LABELS,
    WEAKNESS_COLORS: WEAKNESS_COLORS,
    BOSS_ICONS: BOSS_ICONS,
    BATTLE_HINTS: BATTLE_HINTS,
    MOVE_BEATS: MOVE_BEATS
  };
})();
