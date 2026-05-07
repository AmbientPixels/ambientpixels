/**
 * Arena Battle UI — battle screen rendering, animations, move handling
 * Phase A combat overhaul: sequential turns, kill shot, crit banner, sound escalation, streak counter
 */
window.ArenaBattleUI = (function () {
  'use strict';

  let _battleData = null;
  let _currentRound = 1;
  let _isAnimating = false;
  let _playerCharges = 0;
  let _abilityCost = 2;
  let _maxCharges = 4;
  let _chargeRate = 1;
  let _abilityInfo = null;
  // A5: combo streak — consecutive rounds the player dealt damage
  let _playerStreak = 0;
  // B4: hype meter
  let _hype = 0;
  let _crowdBoostPending = false;
  // Phase 1: move history for combo preview + matchup feedback
  let _moveHistory = [];
  // Stance system
  let _playerStance = 'balanced';
  let _stanceChangedThisTurn = false;

  function initBattle(battleData) {
    _battleData = battleData;
    _currentRound = 1;
    _isAnimating = false;
    _playerStreak = 0;
    _moveHistory = [];
    updateComboPipState();

    // Close results overlay if still open
    var overlay = document.getElementById('arena-results-overlay');
    if (overlay) overlay.style.display = 'none';

    // Reset battle header buttons
    var forfeitBtn = document.getElementById('arena-forfeit-btn');
    var postActions = document.getElementById('arena-battle-post');
    if (forfeitBtn) forfeitBtn.style.display = '';
    if (postActions) postActions.style.display = 'none';

    // Reset hype and boost state
    _hype = 0;
    _crowdBoostPending = false;
    var hypeBar = document.getElementById('arena-hype-bar');
    var hypeFill = document.getElementById('arena-hype-fill');
    if (hypeBar) hypeBar.classList.remove('arena-hype-bar--near-full');
    if (hypeFill) hypeFill.style.width = '0%';
    var hypeHint = document.getElementById('arena-hype-hint');
    if (hypeHint) hypeHint.textContent = 'CRIT BOOST AT 100% · 100% TO GO';

    // Reset status chips
    ['arena-player-status', 'arena-opponent-status'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });

    // Reset combatant visual states from previous battle
    ['arena-player-side', 'arena-opponent-side'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.classList.remove('arena-combatant--defeated', 'arena-combatant--last-stand');
      }
    });
    var field = document.querySelector('.arena-battle__field');
    if (field) field.classList.remove('arena--killshot');

    renderCombatants(battleData);
    updateHpBars(battleData.player.hp, battleData.player.maxHp, battleData.opponent.hp, battleData.opponent.maxHp);
    updateRoundLabel(_currentRound);
    clearLog();
    addLogEntry('Battle started! Choose your move.');
    addLogEntry('💥 Fill the Hype Meter with crits, streaks & big moments for a crowd damage boost!', 'hint');
    enableMoves(true);

    // Charge system state
    _playerCharges = (battleData.charges && battleData.charges.player) || 0;
    _abilityCost = battleData.abilityCost || 2;
    _maxCharges = battleData.maxCharges || 4;
    _chargeRate = battleData.chargeRate || 1;
    _abilityInfo = battleData.player.abilityDef || null;

    // Update move stat labels
    const strEl = document.getElementById('arena-move-str');
    const intEl = document.getElementById('arena-move-int');
    const endEl = document.getElementById('arena-move-end');
    if (strEl) strEl.textContent = `STR ${battleData.player.combatStats.str}`;
    if (endEl) endEl.textContent = `END ${battleData.player.combatStats.end}`;

    // Dynamic ability button
    updateAbilityButton(battleData.player.combatStats);
    updateChargeDisplay();

    // Render active buff passives under player card
    renderActiveBuffs(battleData.player.passives);

    // Stamina system init
    _battleData.stamina = battleData.stamina || null;
    _battleData.maxStamina = battleData.maxStamina || null;
    if (_battleData.stamina && _battleData.maxStamina) {
      updateStaminaBars(_battleData.stamina.player, _battleData.maxStamina.player, _battleData.stamina.opponent, _battleData.maxStamina.opponent);
      updateMoveCosts(_battleData.stamina.player);
    }

    // Cooldown system init
    _battleData.cooldowns = battleData.cooldowns || { player: {}, opponent: {} };
    updateCooldownOverlays(_battleData.cooldowns.player);

    // Stance system init
    _playerStance = (battleData.stances && battleData.stances.player) || 'balanced';
    _battleData.stances = battleData.stances || { player: 'balanced', opponent: 'balanced' };
    initStanceButtons();
    updateBossStance(_battleData.stances.opponent);
  }

  function renderActiveBuffs(passives) {
    var container = document.getElementById('arena-player-buffs');
    if (!container) return;
    if (!passives || passives.length === 0) {
      container.innerHTML = '';
      return;
    }
    var iconMap = {
      crit_chance: 'fa-bullseye', damage_reduction: 'fa-shield-alt', ability_power: 'fa-bolt',
      str_bonus: 'fa-hand-fist', int_bonus: 'fa-brain', end_bonus: 'fa-heart',
      hp_regen: 'fa-heart-pulse', xp_bonus: 'fa-star', all_stats: 'fa-chart-line'
    };
    var labelMap = {
      crit_chance: 'CRIT', damage_reduction: 'DR', ability_power: 'AP',
      str_bonus: 'STR', int_bonus: 'INT', end_bonus: 'END',
      hp_regen: 'REGEN', xp_bonus: 'XP', all_stats: 'ALL',
      // Stat-threshold passives + signatures emitted by the server engine
      guard_pierce: 'PIERCE', crit_damage: 'CRIT DMG', dodge: 'DODGE',
      heal_dr: 'HEAL DR', ability_cost_red: 'AP COST', ability_dmg_boost: 'AP DMG',
      speed_priority: 'SPEED', wild_card: 'WILD', auto_heal: 'REGEN'
    };
    container.innerHTML = passives.map(function (p) {
      var icon = iconMap[p.effect] || 'fa-circle';
      // Fallback for unmapped effects: snake_case → SNAKE CASE
      var label = labelMap[p.effect] || (p.effect ? String(p.effect).replace(/_/g, ' ').toUpperCase() : '');
      return '<span class="arena-buff-chip" title="' + label + ' +' + p.value + '">' +
        '<i class="fas ' + icon + '"></i> +' + p.value + ' ' + label +
        '</span>';
    }).join('');
  }

  // Resolve the campaign-boss id for a battle opponent. The PvE server
  // response shape is { name, class, avatar, combatStats, maxHp, hp,
  // bossLevel, ... } — no explicit id. Mock/test paths sometimes use
  // `bossId` or `id`. Try id-first, then derive from bossLevel
  // (101..110 → bs-boss-1..10), then fall back to name match. Returns
  // a `bs-boss-N` string or null (PvP / weekly / unknown).
  var BOSS_NAME_MAP = {
    'the gatekeeper':    'bs-boss-1', 'gutter rat':         'bs-boss-2',
    'shadow stalker':    'bs-boss-3', 'arcane scholar':     'bs-boss-4',
    'warlord grax':      'bs-boss-5', 'ironclad sentinel':  'bs-boss-6',
    'titanium aegis':    'bs-boss-7', 'the forge king':     'bs-boss-8',
    'void harbinger':    'bs-boss-9', 'crystal weaver':     'bs-boss-10'
  };
  function deriveBossId(opp) {
    if (!opp) return null;
    var direct = opp.bossId || opp.id;
    if (direct && /^bs-boss-\d+$/.test(direct)) return direct;
    if (typeof opp.bossLevel === 'number' && opp.bossLevel >= 101 && opp.bossLevel <= 110) {
      return 'bs-boss-' + (opp.bossLevel - 100);
    }
    if (opp.name) {
      var key = String(opp.name).toLowerCase().trim();
      if (BOSS_NAME_MAP[key]) return BOSS_NAME_MAP[key];
    }
    return null;
  }

  function renderCombatants(data) {
    const playerCard = document.getElementById('arena-player-card');
    const opponentCard = document.getElementById('arena-opponent-card');
    const playerName = document.getElementById('arena-player-name');
    const opponentName = document.getElementById('arena-opponent-name');

    if (playerCard) {
      playerCard.innerHTML = data.player.avatar
        ? `<img src="${data.player.avatar}" alt="${data.player.name}" class="arena-combatant__img">`
        : `<div class="arena-combatant__placeholder"><i class="fas fa-user-shield"></i></div>`;
    }
    if (opponentCard) {
      // Boss-card pass: when the opponent is a recognised campaign
      // boss, hand off to BsBossCard for a full mirrored card render
      // (matches the player card structure with redacted stats /
      // locked traits). The real PvE battle response from the server
      // returns NEITHER `id` NOR `bossId` on opponent — it has
      // `bossLevel: 101..110`. Derive the boss id from that, with
      // direct id and name as additional fallbacks. PvP / unknown
      // opponents fall through to the legacy avatar fill.
      var _bossId = deriveBossId(data.opponent);
      if (_bossId && window.BsBossCard) {
        window.BsBossCard.renderInto(opponentCard, _bossId).then(function (bc) {
          if (!bc) {
            opponentCard.innerHTML = data.opponent.avatar
              ? '<img src="' + data.opponent.avatar + '" alt="' + data.opponent.name + '" class="arena-combatant__img">'
              : '<div class="arena-combatant__placeholder"><i class="fas fa-skull"></i></div>';
          }
        });
      } else {
        opponentCard.innerHTML = data.opponent.avatar
          ? `<img src="${data.opponent.avatar}" alt="${data.opponent.name}" class="arena-combatant__img">`
          : `<div class="arena-combatant__placeholder"><i class="fas fa-skull"></i></div>`;
      }
    }

    // Atmospheric backdrop — same pattern as the player column. Boss
    // avatar gets blurred + tinted behind the foreground portrait so
    // both columns share the cinematic treatment.
    const opponentBackdrop = document.getElementById('arena-opponent-backdrop');
    if (opponentBackdrop) {
      opponentBackdrop.style.backgroundImage = data.opponent.avatar
        ? `url("${String(data.opponent.avatar).replace(/"/g, '\\"')}")`
        : '';
    }
    if (playerName) playerName.textContent = data.player.name || 'You';
    if (opponentName) opponentName.textContent = data.opponent.name || 'Enemy';

    // Subtitle: GUARDIAN · LV 386 / BOSS 9 · DIFF 9 — eyebrow row under name
    const playerSub = document.getElementById('arena-player-sub');
    const opponentSub = document.getElementById('arena-opponent-sub');
    if (playerSub) {
      const cls = String(data.player.class || 'fighter').toUpperCase();
      const lv = data.player.power || data.player.level || data.player.totalPower;
      playerSub.textContent = lv ? cls + ' · LV ' + lv : cls;
    }
    if (opponentSub) {
      const oId = data.opponent.bossId || data.opponent.id;
      const oNum = oId ? String(oId).match(/\d+/) : null;
      const diff = data.opponent.difficulty;
      if (oNum && diff) {
        opponentSub.textContent = 'BOSS ' + oNum[0] + ' · DIFF ' + diff;
      } else {
        opponentSub.textContent = String(data.opponent.class || 'enemy').toUpperCase();
      }
    }

    // Element badges on nameplates
    var _Const = window.BsConst || {};
    var _ED = _Const.ELEMENT_DEFS || {};
    var _CDE = _Const.CLASS_DEFAULT_ELEMENT || {};
    var elements = data.elements || {};
    var pEl = elements.player || (data.player.element) || (_CDE[data.player.class] || '');
    var oEl = elements.opponent || (data.opponent.element) || (_CDE[data.opponent.class] || '');
    var pElBadge = document.getElementById('arena-player-element');
    var oElBadge = document.getElementById('arena-opponent-element');
    if (pElBadge && pEl && _ED[pEl]) {
      pElBadge.innerHTML = '<i class="fas ' + _ED[pEl].icon + '" style="color:' + _ED[pEl].color + ';"></i>';
      pElBadge.title = _ED[pEl].label + ' element';
    }
    if (oElBadge && oEl && _ED[oEl]) {
      oElBadge.innerHTML = '<i class="fas ' + _ED[oEl].icon + '" style="color:' + _ED[oEl].color + ';"></i>';
      oElBadge.title = _ED[oEl].label + ' element';
    }

    // VS-column matchup chip — always render when both elements are
    // known so the slot fills usefully even on a neutral matchup. The
    // chip switches color/copy based on the relationship: strong (good
    // green), weak (bad red glow), mirror (neutral), or even (subtle).
    // Only stays hidden if either element is missing/unknown.
    var matchupEl = document.getElementById('bs-vs-matchup');
    if (matchupEl) {
      var _EC = _Const.ELEMENT_CHART || {};
      var html = '';
      var modClass = '';
      if (pEl && oEl && _ED[pEl] && _ED[oEl]) {
        var _bc = window.BsCharms;
        var pIcon = (_bc && _bc.assetArtHtml)
          ? _bc.assetArtHtml('elements', pEl, _ED[pEl].icon, _ED[pEl].label)
          : '<i class="fas ' + _ED[pEl].icon + '" style="color:' + _ED[pEl].color + ';"></i>';
        var oIcon = (_bc && _bc.assetArtHtml)
          ? _bc.assetArtHtml('elements', oEl, _ED[oEl].icon, _ED[oEl].label)
          : '<i class="fas ' + _ED[oEl].icon + '" style="color:' + _ED[oEl].color + ';"></i>';
        var chart = _EC[pEl] || {};
        if (chart.strong === oEl) {
          html = pIcon + ' Strong vs ' + oIcon + ' <span>+25% dmg</span>';
          modClass = 'bs-vs-matchup--good';
        } else if (chart.weak === oEl) {
          html = pIcon + ' Weak vs ' + oIcon + ' <span>-25% dmg</span>';
          modClass = 'bs-vs-matchup--bad';
        } else if (pEl === oEl) {
          html = pIcon + ' Mirror match <span>no bonus</span>';
          modClass = 'bs-vs-matchup--neutral';
        } else {
          html = pIcon + ' vs ' + oIcon + ' <span>even matchup</span>';
          modClass = 'bs-vs-matchup--neutral';
        }
      }
      matchupEl.className = 'bs-vs-matchup' + (modClass ? ' ' + modClass : '');
      matchupEl.innerHTML = html;
      matchupEl.hidden = !html;
    }
  }

  function updateHpBars(playerHp, playerMax, opponentHp, opponentMax) {
    const playerFill = document.getElementById('arena-player-hp-fill');
    const opponentFill = document.getElementById('arena-opponent-hp-fill');
    const playerText = document.getElementById('arena-player-hp-text');
    const opponentText = document.getElementById('arena-opponent-hp-text');

    const playerPct = Math.max(0, Math.min(100, (playerHp / playerMax) * 100));
    const opponentPct = Math.max(0, Math.min(100, (opponentHp / opponentMax) * 100));

    // Set both width and height so the same element can render as either
    // a horizontal bar (CSS uses width, height stays 100%) or a vertical
    // bar (CSS pins width:100% + uses inline height for the fill amount).
    if (playerFill) {
      playerFill.style.width = playerPct + '%';
      playerFill.style.height = playerPct + '%';
    }
    if (opponentFill) {
      opponentFill.style.width = opponentPct + '%';
      opponentFill.style.height = opponentPct + '%';
    }
    if (playerText) playerText.textContent = `${Math.max(0, playerHp)} / ${playerMax}`;
    if (opponentText) opponentText.textContent = `${Math.max(0, opponentHp)} / ${opponentMax}`;

    // Mirror onto data attrs on the combatant FRAME (not column).
    // Mobile CSS hides the in-bar readouts and renders fresh chips via
    // ::before/::after on the frame itself — anchoring to the column
    // would put chips below the frame on top of buffs/status rows.
    var playerSide = document.getElementById('arena-player-side');
    var opponentSide = document.getElementById('arena-opponent-side');
    var playerFrame = playerSide && playerSide.querySelector('.arena-combatant__frame');
    var opponentFrame = opponentSide && opponentSide.querySelector('.arena-combatant__frame');
    if (playerFrame) playerFrame.dataset.hp = `HP ${Math.max(0, playerHp)} / ${playerMax}`;
    if (opponentFrame) opponentFrame.dataset.hp = `HP ${Math.max(0, opponentHp)} / ${opponentMax}`;

    // Color shifts at low HP
    if (playerFill) playerFill.classList.toggle('arena-hp-bar__fill--low', playerPct < 30);
    if (opponentFill) opponentFill.classList.toggle('arena-hp-bar__fill--low', opponentPct < 30);

    // Dynamic panel border color tracks HP — high/mid/low. CSS handles
    // the actual border colors + smooth transition; JS just toggles the
    // class so the right rule wins. Symmetric for player + opponent.
    function setPanelHpClass(panel, pct) {
      if (!panel) return;
      panel.classList.toggle('arena-combatant--hp-high', pct >= 66);
      panel.classList.toggle('arena-combatant--hp-mid', pct >= 33 && pct < 66);
      panel.classList.toggle('arena-combatant--hp-low', pct < 33);
    }
    setPanelHpClass(document.getElementById('arena-player-side'), playerPct);
    setPanelHpClass(document.getElementById('arena-opponent-side'), opponentPct);
  }

  // Generate / refresh the stamina pip elements inside a bar. Each
  // pip represents 1 stamina point; bottom-up the first `current`
  // are marked filled, the rest empty. Max pip count is capped at 12
  // so very high stamina ceilings (rare) don't shrink pips below
  // legibility. The legacy fill + ::after overlay are display:none in
  // CSS so they don't compete with these.
  function renderStaminaPips(barEl, current, max) {
    if (!barEl) return;
    var capped = Math.min(12, Math.max(1, max | 0));
    var existing = barEl.querySelectorAll('.arena-stamina-pip');
    // Rebuild only when pip count changes; otherwise just toggle classes
    // for fast updates on every round.
    if (existing.length !== capped) {
      for (var k = 0; k < existing.length; k++) existing[k].remove();
      var frag = document.createDocumentFragment();
      for (var i = 0; i < capped; i++) {
        var pip = document.createElement('div');
        pip.className = 'arena-stamina-pip';
        frag.appendChild(pip);
      }
      barEl.appendChild(frag);
      existing = barEl.querySelectorAll('.arena-stamina-pip');
    }
    // When max ≤ pip cap, each pip = 1 stamina unit (direct mapping).
    // When max > pip cap (e.g. 38), pips represent fractions of the
    // pool and we render proportionally — otherwise current stays
    // clamped to the cap and pips never visually deplete.
    var filled;
    if ((max | 0) <= capped) {
      filled = Math.max(0, Math.min(capped, current | 0));
    } else {
      var frac = (max > 0) ? Math.max(0, Math.min(1, current / max)) : 0;
      filled = Math.round(frac * capped);
      // Clamp so 1 stamina still shows at least 1 pip and < max never shows full.
      if (current > 0 && filled === 0) filled = 1;
      if (current < max && filled >= capped) filled = capped - 1;
    }
    for (var j = 0; j < existing.length; j++) {
      existing[j].classList.toggle('arena-stamina-pip--filled', j < filled);
      existing[j].classList.toggle('arena-stamina-pip--empty', j >= filled);
    }
  }

  function updateStaminaBars(pStam, pMax, oStam, oMax) {
    var pFill = document.getElementById('arena-player-stamina-fill');
    var oFill = document.getElementById('arena-opponent-stamina-fill');
    var pText = document.getElementById('arena-player-stamina-text');
    var oText = document.getElementById('arena-opponent-stamina-text');
    var pBar = document.getElementById('arena-player-stamina-bar');
    var oBar = document.getElementById('arena-opponent-stamina-bar');
    var threshold = (window.BsConst && BsConst.STAMINA_EXHAUSTION_THRESHOLD) || 3;

    var pPct = pMax > 0 ? Math.max(0, Math.min(100, (pStam / pMax) * 100)) : 0;
    var oPct = oMax > 0 ? Math.max(0, Math.min(100, (oStam / oMax) * 100)) : 0;

    if (pFill) { pFill.style.width = pPct + '%'; pFill.style.height = pPct + '%'; }
    if (oFill) { oFill.style.width = oPct + '%'; oFill.style.height = oPct + '%'; }
    // True pips: render N discrete pip divs into each bar (one per
    // max-stamina, bottom N marked filled). Replaces the continuous
    // gold fill + line-overlay illusion. Capped at 12 to keep pips
    // tall enough to read on extreme max values.
    if (pBar) renderStaminaPips(pBar, pStam, pMax);
    if (oBar) renderStaminaPips(oBar, oStam, oMax);
    if (pText) pText.textContent = pStam + ' / ' + pMax;
    if (oText) oText.textContent = oStam + ' / ' + oMax;
    // Mirror onto data attrs on the combatant FRAME. See updateHpBars
    // comment — mobile CSS reads these via ::after on the frame.
    var playerSide = document.getElementById('arena-player-side');
    var opponentSide = document.getElementById('arena-opponent-side');
    var playerFrame = playerSide && playerSide.querySelector('.arena-combatant__frame');
    var opponentFrame = opponentSide && opponentSide.querySelector('.arena-combatant__frame');
    if (playerFrame) playerFrame.dataset.stam = 'ST ' + pStam + ' / ' + pMax;
    if (opponentFrame) opponentFrame.dataset.stam = 'ST ' + oStam + ' / ' + oMax;
    if (pBar) pBar.classList.toggle('arena-stamina-bar--exhausted', pStam < threshold);
    if (oBar) oBar.classList.toggle('arena-stamina-bar--exhausted', oStam < threshold);
  }

  function updateMoveCosts(playerStamina) {
    var costs = (window.BsConst && BsConst.STAMINA_COSTS) || { strike: 3, guard: 1, heal: 2, counter: 3, ability: 4 };
    var threshold = (window.BsConst && BsConst.STAMINA_EXHAUSTION_THRESHOLD) || 3;
    document.querySelectorAll('.arena-move-btn[data-move]').forEach(function(btn) {
      var move = btn.getAttribute('data-move');
      var cost = costs[move] || 2;
      var costEl = btn.querySelector('.arena-move-btn__cost');
      if (costEl) costEl.textContent = cost;
      // Hard-block Ability if can't afford
      if (move === 'ability') {
        btn.classList.toggle('arena-move-btn--no-stamina', playerStamina < cost);
      }
      // Exhaustion visual warning on all buttons
      btn.classList.toggle('arena-move-btn--exhausted', playerStamina < threshold);
    });
  }

  function updateCooldownOverlays(cds) {
    var maxRounds = (window.BsConst && BsConst.COOLDOWN_ROUNDS) || {};
    document.querySelectorAll('.arena-move-btn[data-move]').forEach(function(btn) {
      var move = btn.getAttribute('data-move');
      var remaining = (cds && cds[move]) || 0;
      var max = maxRounds[move] || 0;
      var wasOnCooldown = btn.classList.contains('arena-move-btn--on-cooldown');
      btn.classList.toggle('arena-move-btn--on-cooldown', remaining > 0);
      if (remaining > 0 && max > 0) {
        var deg = (remaining / max) * 360;
        btn.style.setProperty('--cd-deg', deg + 'deg');
        btn.setAttribute('data-cd', remaining);
      } else {
        btn.style.removeProperty('--cd-deg');
        btn.removeAttribute('data-cd');
        // Ready pulse: cooldown just cleared this round
        if (wasOnCooldown) {
          btn.classList.add('arena-move-btn--cd-ready');
          setTimeout(function() { btn.classList.remove('arena-move-btn--cd-ready'); }, 600);
        }
      }
    });
  }

  // Tag a panel with its current stance so CSS can color the border
  // accordingly. Strips any prior stance class first, then adds the
  // new one. Symmetric for player + opponent panels.
  function setPanelStanceClass(panel, stance) {
    if (!panel) return;
    panel.classList.remove(
      'arena-combatant--stance-balanced',
      'arena-combatant--stance-aggressive',
      'arena-combatant--stance-defensive'
    );
    if (stance) panel.classList.add('arena-combatant--stance-' + stance);
  }

  function initStanceButtons() {
    var row = document.getElementById('arena-stance-row');
    if (!row) return;
    var playerPanel = document.getElementById('arena-player-side');
    setPanelStanceClass(playerPanel, _playerStance);
    row.querySelectorAll('.arena-stance-btn').forEach(function(btn) {
      var stance = btn.getAttribute('data-stance');
      btn.classList.toggle('arena-stance-btn--active', stance === _playerStance);
      btn.onclick = function() {
        if (_isAnimating) return;
        _stanceChangedThisTurn = (stance !== _playerStance);
        _playerStance = stance;
        row.querySelectorAll('.arena-stance-btn').forEach(function(b) {
          b.classList.toggle('arena-stance-btn--active', b.getAttribute('data-stance') === stance);
        });
        setPanelStanceClass(playerPanel, stance);
        // Update stamina cost badges to reflect stance adjustment
        if (_battleData.stamina) updateMoveCosts(_battleData.stamina.player);
      };
    });
  }

  var _lastBossStance = 'balanced';
  function updateBossStance(stance) {
    var el = document.getElementById('arena-boss-stance');
    if (!el) return;
    var defs = (window.BsConst && BsConst.STANCE_DEFS) || {};
    var def = defs[stance] || defs.balanced || { icon: 'fa-circle-nodes' };
    el.innerHTML = '<i class="fas ' + def.icon + '"></i>';
    el.className = 'arena-boss-stance';
    if (stance === 'aggressive') el.classList.add('arena-boss-stance--aggressive');
    if (stance === 'defensive') el.classList.add('arena-boss-stance--defensive');
    // Mirror the boss's stance onto the opponent panel so its border
    // color reflects the boss's current posture (same dynamic the
    // player panel gets from setPanelStanceClass on stance click).
    setPanelStanceClass(document.getElementById('arena-opponent-side'), stance);
    // Update the boss-stance indicator in the bottom zone above the
    // player's own stance buttons — gives the player a clear, always
    // visible read on what posture the boss is in this round.
    var indicator = document.getElementById('bs-boss-stance-indicator');
    var indicatorIcon = document.getElementById('bs-boss-stance-indicator-icon');
    var indicatorName = document.getElementById('bs-boss-stance-indicator-name');
    if (indicator) {
      indicator.classList.remove('bs-boss-stance-indicator--balanced',
                                 'bs-boss-stance-indicator--aggressive',
                                 'bs-boss-stance-indicator--defensive');
      indicator.classList.add('bs-boss-stance-indicator--' + stance);
    }
    if (indicatorIcon) indicatorIcon.innerHTML = '<i class="fas ' + def.icon + '"></i>';
    if (indicatorName) {
      var lbl = (def.label || stance);
      indicatorName.textContent = lbl.charAt(0).toUpperCase() + lbl.slice(1);
    }
    if (stance !== _lastBossStance && _lastBossStance) {
      var label = (def.label || stance).charAt(0).toUpperCase() + (def.label || stance).slice(1);
      addLogEntry('\u2694\uFE0F Boss shifts to ' + label + ' stance!', 'event');
    }
    _lastBossStance = stance;
  }

  // Telegraph: show boss's pre-committed move intent above opponent card
  var INTENT_ICONS = {
    strike: 'fa-hand-fist',
    guard: 'fa-shield-halved',
    ability: 'fa-bolt',
    heal: 'fa-heart-pulse',
    counter: 'fa-shield'
  };
  var INTENT_COLORS = {
    strike: '#ef4444',
    guard: '#3b82f6',
    ability: '#a855f7',
    heal: '#22c55e',
    counter: '#f97316'
  };

  function showBossIntent(intent) {
    var container = document.getElementById('arena-boss-intent');
    var iconEl = document.getElementById('arena-boss-intent-icon');
    var textEl = document.getElementById('arena-boss-intent-text');
    if (!container || !iconEl || !textEl) return;

    // Support both single intent object and array of 2 intents (dual-action)
    var intents = Array.isArray(intent) ? intent : (intent && intent.move ? [intent] : []);
    if (intents.length === 0) {
      hideBossIntent();
      return;
    }

    // Build icons for all intents
    var iconsHtml = intents.map(function(it) {
      var icon = INTENT_ICONS[it.move] || 'fa-question';
      var color = INTENT_COLORS[it.move] || 'var(--bs-text-muted)';
      return '<i class="fas ' + icon + '" style="color:' + color + '"></i>';
    }).join(' <span style="opacity:0.4;margin:0 0.15rem">then</span> ');
    iconEl.innerHTML = iconsHtml;

    // Show first intent's flavor text (most descriptive)
    var flavor = intents[0].flavor || ('Enemy will ' + intents[0].move);
    if (intents.length > 1) {
      // Short version for 2 intents
      var m1 = intents[0].move.charAt(0).toUpperCase() + intents[0].move.slice(1);
      var m2 = intents[1].move.charAt(0).toUpperCase() + intents[1].move.slice(1);
      flavor = intents[0].flavor || (m1 + ' then ' + m2);
    }
    textEl.textContent = flavor;
    container.style.setProperty('--intent-color', INTENT_COLORS[intents[0].move] || 'var(--bs-text-muted)');

    // Animate entrance
    container.classList.remove('arena-boss-intent--enter');
    void container.offsetWidth; // force reflow
    container.classList.add('arena-boss-intent--enter');
  }

  function hideBossIntent() {
    var container = document.getElementById('arena-boss-intent');
    if (container) {
      container.classList.remove('arena-boss-intent--enter');
      // Reset to invisible (opacity: 0 in base CSS)
    }
  }

  function updateRoundLabel(round) {
    const numEl = document.getElementById('arena-round-num');
    if (numEl) numEl.textContent = String(round).padStart(2, '0');
    // Backward compat for any legacy reader of the old element id
    const legacyEl = document.getElementById('arena-round-label');
    if (legacyEl) legacyEl.textContent = `Round ${round}`;
    // VS-column round pill — Vein center-column treatment
    const vsRoundEl = document.getElementById('bs-vs-round');
    if (vsRoundEl) vsRoundEl.textContent = `Round ${String(round).padStart(2, '0')}`;
  }

  function clearLog() {
    const log = document.getElementById('arena-battle-log');
    if (!log) return;
    // Preserve the static `.arena-battle__log-head` header — only drop entries.
    log.querySelectorAll('.arena-log-entry').forEach(function (e) { e.remove(); });
  }

  function addLogEntry(text, type = '') {
    const log = document.getElementById('arena-battle-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = 'arena-log-entry' + (type ? ` arena-log-entry--${type}` : '');

    // Structured row: R# | text | (optional) damage column.
    // CSS only switches to grid layout when `.arena-log-entry__round` is
    // present (`:has()`), so flat-string entries from older callers stay
    // readable if anything still uses the legacy signature.
    const dmgMatch = text.match(/for (\d+) (?:damage|HP)/i)
      || text.match(/healed (\d+)/i)
      || text.match(/(\d+)\s*damage/i);
    const dmg = dmgMatch ? parseInt(dmgMatch[1], 10) : null;
    const isCrit = /\bcrit/i.test(text) || type === 'crit';
    const isReflect = /\breflect/i.test(text) || /counter/i.test(text) || type === 'reflect';
    const isHeal = /heal/i.test(text) && !/healed (\d+) damage/i.test(text);

    const round = document.createElement('span');
    round.className = 'arena-log-entry__round';
    round.textContent = 'R' + _currentRound;

    const txt = document.createElement('span');
    txt.className = 'arena-log-entry__text';
    txt.textContent = text;

    entry.appendChild(round);
    entry.appendChild(txt);

    if (dmg !== null) {
      const dmgEl = document.createElement('span');
      let dmgClass = 'arena-log-entry__dmg';
      if (isCrit) dmgClass += ' arena-log-entry__dmg--crit';
      else if (isReflect) dmgClass += ' arena-log-entry__dmg--reflect';
      dmgEl.className = dmgClass;
      dmgEl.textContent = (isCrit ? 'CRIT ' : '') + (isHeal ? '+' : '-') + dmg;
      entry.appendChild(dmgEl);
    }

    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  function updateAbilityButton(combatStats) {
    if (!_abilityInfo) return;
    const iconEl = document.getElementById('arena-ability-icon');
    const labelEl = document.getElementById('arena-ability-label');
    const statEl = document.getElementById('arena-move-int');
    const descEl = document.getElementById('arena-ability-desc');
    const abilityBtn = document.querySelector('.arena-move-btn--ability');

    if (iconEl) iconEl.className = 'fas ' + _abilityInfo.icon;
    if (labelEl) labelEl.textContent = _abilityInfo.label;
    if (descEl) descEl.textContent = _abilityInfo.bonusDesc || 'Class ability';
    if (abilityBtn) abilityBtn.title = `${_abilityInfo.label} (${_abilityInfo.stat.toUpperCase()}). Costs ${_abilityCost} charges. +30% vs Strike. Reduced 30% by Guard. ${_abilityInfo.bonusDesc}`;

    // Update stat display to match ability stat
    const statKey = _abilityInfo.stat;
    const statVal = combatStats[statKey] || 0;
    if (statEl) statEl.textContent = `${statKey.toUpperCase()} ${statVal}`;
  }

  function updateChargeDisplay() {
    const chargeEl = document.getElementById('arena-ability-charge');
    if (!chargeEl) return;
    chargeEl.textContent = `${Math.floor(_playerCharges)}/${_abilityCost}`;
    // Two-pip CSS indicator (battle scope): 0 charges → empty,
    // halfway → 1 filled, ≥cost → both filled & ability ready.
    let filled = 0;
    if (_abilityCost > 0) {
      if (_playerCharges >= _abilityCost) filled = 2;
      else if (_playerCharges >= _abilityCost / 2) filled = 1;
    }
    chargeEl.setAttribute('data-filled', String(filled));
  }

  function enableMoves(enabled) {
    // If tutorial is controlling buttons, don't override its state
    if (enabled && window.BsTutorial && window.BsTutorial.isControllingMoves && window.BsTutorial.isControllingMoves()) return;
    document.querySelectorAll('.arena-move-btn').forEach(btn => {
      btn.disabled = !enabled;
      btn.classList.toggle('arena-move-btn--disabled', !enabled);
    });

    // Lock ability button if insufficient charges
    const abilityBtn = document.querySelector('.arena-move-btn--ability');
    if (abilityBtn && enabled) {
      const locked = _playerCharges < _abilityCost;
      abilityBtn.disabled = locked;
      abilityBtn.classList.toggle('arena-move-btn--locked', locked);
      abilityBtn.classList.toggle('arena-move-btn--disabled', locked);
    }
  }

  function triggerHitShake(side) {
    const el = document.getElementById(side === 'player' ? 'arena-player-side' : 'arena-opponent-side');
    if (!el) return;
    el.classList.remove('arena-combatant--hit');
    void el.offsetWidth; // reflow to restart animation
    el.classList.add('arena-combatant--hit');
    setTimeout(() => el.classList.remove('arena-combatant--hit'), 400);
  }

  function showDamageFloat(side, amount, isHeal) {
    const container = document.getElementById(side === 'player' ? 'arena-player-side' : 'arena-opponent-side');
    if (!container) return;

    const floater = document.createElement('div');
    floater.className = 'arena-dmg-float' + (isHeal ? ' arena-dmg-float--heal' : '');
    floater.textContent = isHeal ? `+${amount}` : `-${amount}`;
    container.appendChild(floater);

    setTimeout(() => floater.remove(), 1200);
  }

  // ─── A1: single-attacker animation helper ────────────────────────────────
  // attackerSide: 'player' | 'opponent'
  // dmg: damage this attacker deals to target
  // heal: HP this attacker recovers
  async function animateAttack(attackerSide, move, dmg, heal) {
    const targetSide = attackerSide === 'player' ? 'opponent' : 'player';
    const audio = window.ArenaAudio;

    if (move === 'counter') {
      // Counter is a stance — show badge at defender, no outgoing damage
      if (audio) audio.play('guard');
      showCounterStanceBadge(attackerSide);
      await sleep(300);
      return;
    }

    if (audio) audio.play(move);
    await sleep(200);

    if (dmg > 0) {
      showDamageFloat(targetSide, dmg, false);
      triggerHitShake(targetSide);
      if (audio) audio.play('hit');
    }
    if (heal > 0) {
      showDamageFloat(attackerSide, heal, true);
      if (audio) audio.play('heal');
    }
  }

  // ─── A3: CRITICAL! banner ────────────────────────────────────────────────
  function showCritBanner(targetSide) {
    const container = document.getElementById(
      targetSide === 'player' ? 'arena-player-side' : 'arena-opponent-side'
    );
    if (!container) return;
    const banner = document.createElement('div');
    banner.className = 'arena-crit-banner';
    banner.textContent = 'CRITICAL!';
    container.appendChild(banner);
    setTimeout(() => banner.remove(), 1100);
  }

  // ─── A1: speed badge ─────────────────────────────────────────────────────
  function showSpeedBadge(winningSide) {
    const container = document.getElementById(
      winningSide === 'player' ? 'arena-player-side' : 'arena-opponent-side'
    );
    if (!container) return;
    const badge = document.createElement('div');
    badge.className = 'arena-speed-badge' +
      (winningSide === 'opponent' ? ' arena-speed-badge--enemy' : '');
    badge.textContent = '⚡ First Strike!';
    container.appendChild(badge);
    setTimeout(() => badge.remove(), 1200);
  }

  // ─── A5: streak badge ────────────────────────────────────────────────────
  function showStreakBadge(count) {
    const container = document.getElementById('arena-player-side');
    if (!container) return;
    // Remove any existing streak badge before adding new one
    const existing = container.querySelector('.arena-streak-badge');
    if (existing) existing.remove();

    const badge = document.createElement('div');
    var heatClass = count >= 5 ? ' arena-streak-badge--fire' : count >= 3 ? ' arena-streak-badge--hot' : '';
    badge.className = 'arena-streak-badge' + heatClass;
    badge.textContent = count >= 4 ? `\uD83D\uDD25\uD83D\uDD25 ${count}x Streak!` : `\uD83D\uDD25 ${count}x Streak!`;
    container.appendChild(badge);
    setTimeout(() => badge.remove(), 1500);
  }

  // ─── B1: Last Stand activation banner ───────────────────────────────────
  function showLastStandActivation(side) {
    if (window.ArenaAudio) window.ArenaAudio.play('last_stand');
    const container = document.getElementById(
      side === 'player' ? 'arena-player-side' : 'arena-opponent-side'
    );
    if (!container) return;
    const banner = document.createElement('div');
    banner.className = 'arena-last-stand-banner';
    banner.textContent = side === 'player' ? '\u26A0 LAST STAND!' : '\u26A0 LAST STAND!';
    container.appendChild(banner);
    setTimeout(() => banner.remove(), 2200);
  }

  // ─── B3: counter stance badge ────────────────────────────────────────────
  function showCounterStanceBadge(side) {
    const container = document.getElementById(
      side === 'player' ? 'arena-player-side' : 'arena-opponent-side'
    );
    if (!container) return;
    const badge = document.createElement('div');
    badge.className = 'arena-counter-badge';
    badge.textContent = '\uD83D\uDEE1 Counter Stance';
    container.appendChild(badge);
    setTimeout(() => badge.remove(), 1400);
  }

  // ─── B3: reflect burst banner ─────────────────────────────────────────────
  function showReflectBanner(side) {
    const container = document.getElementById(
      side === 'player' ? 'arena-player-side' : 'arena-opponent-side'
    );
    if (!container) return;
    const banner = document.createElement('div');
    banner.className = 'arena-reflect-banner';
    banner.textContent = 'Reflected!';
    container.appendChild(banner);
    setTimeout(() => banner.remove(), 1100);
  }

  // ─── B2: render burn / stun / blind status chips ─────────────────────────
  function renderStatusEffects(tempEffects) {
    if (!tempEffects) return;
    var sides = { player: 'arena-player-status', opponent: 'arena-opponent-status' };
    var chipDefs = {
      burn:  { icon: 'fa-fire',      label: 'Burn',  cls: 'burn'  },
      stun:  { icon: 'fa-bolt',      label: 'Stun',  cls: 'stun'  },
      blind: { icon: 'fa-eye-slash', label: 'Blind', cls: 'blind' }
    };
    ['player', 'opponent'].forEach(function (side) {
      var el = document.getElementById(sides[side]);
      if (!el) return;
      var effects = (tempEffects[side] || []).filter(function (e) {
        return chipDefs[e.effect];
      });
      el.innerHTML = effects.map(function (e) {
        var def = chipDefs[e.effect];
        var rounds = (e.roundsLeft > 1)
          ? ' <span style="opacity:0.7;font-size:0.6rem">' + e.roundsLeft + '</span>'
          : '';
        return '<span class="arena-status-chip arena-status-chip--' + def.cls + ' arena-status-chip--new">' +
          '<i class="fas ' + def.icon + '"></i> ' + def.label + rounds +
          '</span>';
      }).join('');
      el.querySelectorAll('.arena-status-chip--new').forEach(function (chip) {
        setTimeout(function () { chip.classList.remove('arena-status-chip--new'); }, 600);
      });
    });
  }

  // ─── B4: hype meter ───────────────────────────────────────────────────────
  function updateHype(points) {
    _hype = Math.min(100, _hype + points);
    var fill = document.getElementById('arena-hype-fill');
    var bar  = document.getElementById('arena-hype-bar');
    var hint = document.getElementById('arena-hype-hint');
    if (fill) fill.style.width = _hype + '%';
    if (bar)  bar.classList.toggle('arena-hype-bar--near-full', _hype >= 75);
    if (hint) hint.textContent = _hype >= 100
      ? 'CRIT BOOST READY'
      : 'CRIT BOOST AT 100% · ' + (100 - _hype) + '% TO GO';
    if (_hype >= 100) {
      showCrowdErupts();
      _crowdBoostPending = true;
      _hype = 0;
      if (fill) fill.style.width = '0%';
      if (bar)  bar.classList.remove('arena-hype-bar--near-full');
      if (hint) hint.textContent = 'CRIT BOOST AT 100% · 100% TO GO';
    }
  }

  function showCrowdBoostFlash() {
    var field = document.querySelector('.arena-battle__field');
    if (!field) return;
    var badge = document.createElement('div');
    badge.className = 'arena-crowd-boost-flash';
    badge.textContent = '⚡ CROWD BOOST!';
    field.appendChild(badge);
    setTimeout(function () { badge.remove(); }, 1000);
  }

  function showCrowdErupts() {
    var field = document.querySelector('.arena-battle__field');
    if (!field) return;
    var banner = document.createElement('div');
    banner.className = 'arena-crowd-banner';
    banner.textContent = 'CROWD ERUPTS!';
    field.appendChild(banner);
    if (window.ArenaAudio) window.ArenaAudio.play('crowd');
    setTimeout(function () { banner.remove(); }, 1800);
  }

  // ─── A2: kill shot slow-mo ───────────────────────────────────────────────
  async function triggerKillShot(defeatedSide) {
    const field = document.querySelector('.arena-battle__field');
    const defeatedEl = document.getElementById(
      defeatedSide === 'player' ? 'arena-player-side' : 'arena-opponent-side'
    );
    if (window.ArenaAudio) window.ArenaAudio.play('killshot');
    if (field) field.classList.add('arena--killshot');
    if (defeatedEl) defeatedEl.classList.add('arena-combatant--defeated');
    shakeScreen('heavy', 600);
    flashScreen('rgba(255, 255, 255, 0.15)', 300);
    burstParticles(defeatedSide, 20, defeatedSide === 'opponent' ? '#FFD700' : '#ff5252');
    await sleep(1400);
    if (field) field.classList.remove('arena--killshot');
    // Leave arena-combatant--defeated on — it stays until battle end resets the view
  }

  // ─── Screen shake + particles (Phase 5A juice) ──────────────────────────

  function shakeScreen(intensity, duration) {
    var field = document.querySelector('.arena-battle__field');
    if (!field) return;
    var cls = intensity === 'heavy' ? 'arena-screen-shake--heavy'
            : intensity === 'crit' ? 'arena-screen-shake--crit'
            : 'arena-screen-shake';
    field.classList.remove('arena-screen-shake', 'arena-screen-shake--crit', 'arena-screen-shake--heavy');
    void field.offsetWidth;
    field.classList.add(cls);
    setTimeout(function () { field.classList.remove(cls); }, duration || 500);
  }

  function flashScreen(color, duration) {
    var existing = document.querySelector('.arena-screen-flash');
    if (existing) existing.remove();
    var flash = document.createElement('div');
    flash.className = 'arena-screen-flash';
    flash.style.background = color || 'rgba(255, 50, 50, 0.15)';
    document.querySelector('.arena-battle__field').appendChild(flash);
    setTimeout(function () { flash.remove(); }, duration || 400);
  }

  function spawnParticles(container, count, color, direction) {
    if (!container) return;
    direction = direction || 'up';
    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = 'arena-particle arena-particle--' + direction;
      p.style.setProperty('--p-color', color || 'var(--bs-accent)');
      p.style.setProperty('--p-x', (Math.random() * 100) + '%');
      p.style.setProperty('--p-delay', (Math.random() * 300) + 'ms');
      p.style.setProperty('--p-size', (3 + Math.random() * 4) + 'px');
      container.appendChild(p);
      setTimeout(function () { p.remove(); }, 1500);
    }
  }

  function burstParticles(side, count, color) {
    var container = document.getElementById(side === 'player' ? 'arena-player-side' : 'arena-opponent-side');
    spawnParticles(container, count || 12, color || '#FFD700', 'burst');
  }

  // ─── Phase 1A: Matchup feedback banner ───────────────────────────────────
  var MATCHUP_MESSAGES = {
    strike_heal:    { text: 'Strike disrupts Heal!', cls: 'win' },
    strike_ability: { text: 'Strike catches Ability off-guard!', cls: 'win' },
    guard_strike:   { text: 'Guard blocks Strike!', cls: 'win' },
    ability_guard:  { text: 'Ability breaks through Guard!', cls: 'win' },
    ability_counter:{ text: 'Ability bypasses Counter!', cls: 'win' },
    counter_strike: { text: 'Counter reflects Strike!', cls: 'win' },
    heal_strike:    { text: 'Heal disrupted by Strike!', cls: 'lose' },
    ability_strike: { text: 'Ability caught by Strike!', cls: 'lose' },
    strike_guard:   { text: 'Strike blocked by Guard!', cls: 'lose' },
    guard_ability:  { text: 'Guard stunned by Ability!', cls: 'lose' },
    counter_ability:{ text: 'Counter fails vs Ability!', cls: 'lose' },
    strike_counter: { text: 'Strike reflected by Counter!', cls: 'lose' }
  };

  function showMatchupBanner(playerMove, opponentMove) {
    if (playerMove === opponentMove) return;
    var key = playerMove + '_' + opponentMove;
    var msg = MATCHUP_MESSAGES[key];
    if (!msg) return;
    var field = document.querySelector('.arena-battle__field');
    if (!field) return;
    var banner = document.createElement('div');
    banner.className = 'arena-matchup-banner arena-matchup-banner--' + msg.cls;
    banner.textContent = msg.text;
    field.appendChild(banner);
    setTimeout(function () { banner.remove(); }, 1800);
  }

  // ─── Phase 1A: Passive activation flash ─────────────────────────────────
  var PASSIVE_PATTERNS = [
    { pattern: /guard.+pierce/i, name: 'Heavy Hitter', icon: 'fa-hand-fist', color: '#ff5252' },
    { pattern: /Quick Draw|speed priority|always act first/i, name: 'Quick Draw', icon: 'fa-forward', color: '#00e676' },
    { pattern: /Elusive|dodged your strike/i, name: 'Elusive', icon: 'fa-ghost', color: '#00e676' },
    { pattern: /Brutal|crit.*damage/i, name: 'Brutal', icon: 'fa-skull-crossbones', color: '#ff5252' },
    { pattern: /Focused|ability costs 1/i, name: 'Focused', icon: 'fa-bullseye', color: '#7b2fff' },
    { pattern: /Arcane Mastery/i, name: 'Arcane Mastery', icon: 'fa-hat-wizard', color: '#7b2fff' },
    { pattern: /Fortified Heal/i, name: 'Fortified Heal', icon: 'fa-shield-heart', color: '#ff9100' },
    { pattern: /Iron Guard|blocks 75%/i, name: 'Iron Guard', icon: 'fa-shield-halved', color: '#ff9100' },
    { pattern: /Fortune|crit chance/i, name: 'Fortune', icon: 'fa-clover', color: '#ffd740' },
    { pattern: /Wild Card|crits deal 2x/i, name: 'Wild Card', icon: 'fa-dice', color: '#ffd740' },
    { pattern: /Regen restored/i, name: 'Unbreakable', icon: 'fa-heart-circle-plus', color: '#ff9100' },
    { pattern: /Weakness exploit/i, name: 'Weakness Exploit', icon: 'fa-crosshairs', color: '#4ade80' },
    { pattern: /Class advantage/i, name: 'Class Advantage', icon: 'fa-chess', color: '#ffd740' }
  ];

  function showPassiveFlashes(events) {
    if (!events || !events.length) return;
    var container = document.getElementById('arena-player-side');
    if (!container) return;
    var shown = {};
    var evText = events.join(' ');
    for (var i = 0; i < PASSIVE_PATTERNS.length; i++) {
      var p = PASSIVE_PATTERNS[i];
      // Only flash for player-relevant events (skip "Enemy" prefixed ones)
      if (p.pattern.test(evText) && !shown[p.name]) {
        // Skip if the matching text is about the enemy
        var enemyMatch = evText.match(new RegExp('Enemy.{0,40}' + p.pattern.source, 'i'));
        if (enemyMatch) continue;
        shown[p.name] = true;
        showSinglePassiveFlash(container, p, Object.keys(shown).length - 1);
      }
    }
  }

  function showSinglePassiveFlash(container, passive, index) {
    var flash = document.createElement('div');
    flash.className = 'arena-passive-flash';
    flash.style.color = passive.color;
    flash.style.animationDelay = (index * 200) + 'ms';
    flash.innerHTML = '<i class="fas ' + passive.icon + '"></i> ' + passive.name + '!';
    container.appendChild(flash);
    setTimeout(function () { flash.remove(); }, 2000 + index * 200);
  }

  // ─── Phase 1B: Combo banner ─────────────────────────────────────────────
  var COMBO_DEFS = {
    flurry:    { name: 'FLURRY',    icon: '\uD83C\uDF2A\uFE0F', color: '#ff9100', desc: 'Strike + Strike!' },
    riposte:   { name: 'RIPOSTE',   icon: '\u2694\uFE0F',       color: '#3a9fff', desc: 'Guard + Counter!' },
    empowered: { name: 'EMPOWERED', icon: '\u2728',             color: '#a855f7', desc: 'Heal + Ability!' }
  };

  function showComboBanner(comboId) {
    if (!comboId || !COMBO_DEFS[comboId]) return;
    var combo = COMBO_DEFS[comboId];
    var field = document.querySelector('.arena-battle__field');
    if (!field) return;
    var banner = document.createElement('div');
    banner.className = 'arena-combo-banner';
    banner.style.setProperty('--combo-color', combo.color);
    banner.innerHTML = '<span class="arena-combo-banner__icon">' + combo.icon + '</span>' +
      '<span class="arena-combo-banner__name">' + combo.name + '</span>' +
      '<span class="arena-combo-banner__desc">' + combo.desc + '</span>';
    field.appendChild(banner);
    if (window.ArenaAudio) window.ArenaAudio.play('crit');
    setTimeout(function () { banner.remove(); }, 2200);
  }

  // B6: STREAK banner — fires on the first hit at chain 5 (peak threshold)
  // and re-fires every 3 hits past that (8, 11, 14...) so a long streak
  // keeps feeling rewarding without spamming a banner every single round.
  function showStreakBanner(chain) {
    var field = document.querySelector('.arena-battle__field');
    if (!field) return;
    var banner = document.createElement('div');
    banner.className = 'arena-combo-banner arena-combo-banner--streak';
    banner.style.setProperty('--combo-color', '#ef9f27');
    banner.innerHTML = '<span class="arena-combo-banner__icon">🔥</span>' +
      '<span class="arena-combo-banner__name">STREAK ' + chain + '</span>' +
      '<span class="arena-combo-banner__desc">+30% dmg, +2 stamina</span>';
    field.appendChild(banner);
    if (window.ArenaAudio) window.ArenaAudio.play('crit');
    spawnParticles(field, 24, '#ef9f27', 'up');
    shakeScreen('crit', 500);
    setTimeout(function () { banner.remove(); }, 2400);
  }

  // ─── Phase 1B: First-combo discovery toast (one-time per combo type) ────
  function showComboDiscoveryToast(comboId) {
    var combo = COMBO_DEFS[comboId];
    if (!combo) return;
    var key = 'bs-combo-discovered-' + comboId;
    try { if (localStorage.getItem(key)) return; } catch (e) { return; }
    try { localStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
    var toast = window.BsToast;
    if (toast && toast.show) {
      toast.show('Combo Discovered: ' + combo.name + '! Tap the \u24D8 icon for all combos.', 'success', 5000);
    } else {
      addLogEntry('\u2728 Combo Discovered: ' + combo.name + '! Check the combat guide (\u24D8) for all combos.', 'hint');
    }
  }

  // ─── Combo pip state (V2) — light up footer pips as the combo builds.
  // Reads _moveHistory, sets data-combo-step on the just-played card and
  // adds --combo-ready to the card that completes the combo. Called from
  // initBattle (reset) and animateRoundResult (after each move). The
  // separate flashComboTriggered() handles the big burst on combo fire. ───
  function updateComboPipState() {
    document.querySelectorAll('.bs-move-card__dots').forEach(function (d) {
      d.removeAttribute('data-combo-step');
      d.classList.remove('bs-move-card__dots--combo-ready');
    });

    if (!_moveHistory || _moveHistory.length === 0) return;
    var last = _moveHistory[_moveHistory.length - 1];

    // Flurry — count trailing consecutive Strikes; 1 = step1, 2+ = ready
    var strikeStreak = 0;
    for (var i = _moveHistory.length - 1; i >= 0; i--) {
      if (_moveHistory[i] === 'strike') strikeStreak++;
      else break;
    }
    var strikeDots = document.querySelector('.arena-move-btn--strike .bs-move-card__dots--flurry');
    if (strikeDots) {
      if (strikeStreak === 1) strikeDots.setAttribute('data-combo-step', '1');
      else if (strikeStreak >= 2) strikeDots.classList.add('bs-move-card__dots--combo-ready');
    }

    // Riposte — last move = guard → Counter is ready, Guard shows step 1
    if (last === 'guard') {
      var guardDots = document.querySelector('.arena-move-btn--guard .bs-move-card__dots--riposte');
      var counterDots = document.querySelector('.arena-move-btn--counter .bs-move-card__dots--riposte');
      if (guardDots) guardDots.setAttribute('data-combo-step', '1');
      if (counterDots) counterDots.classList.add('bs-move-card__dots--combo-ready');
    }

    // Empowered — last move = heal → Ability is ready, Heal shows step 1
    if (last === 'heal') {
      var healDots = document.querySelector('.arena-move-btn--heal .bs-move-card__dots--empowered');
      var abilityDots = document.querySelector('.arena-move-btn--ability .bs-move-card__dots--empowered');
      if (healDots) healDots.setAttribute('data-combo-step', '1');
      if (abilityDots) abilityDots.classList.add('bs-move-card__dots--combo-ready');
    }
  }

  // Brief burst flash across all pips of the firing combo family. Triggered
  // when the server reports result.comboTriggered = 'flurry'/'riposte'/etc.
  function flashComboTriggered(comboId) {
    if (!comboId) return;
    var family = String(comboId).toLowerCase();
    if (family !== 'flurry' && family !== 'riposte' && family !== 'empowered') return;
    var dots = document.querySelectorAll('.bs-move-card__dots--' + family);
    dots.forEach(function (d) {
      d.classList.add('bs-move-card__dots--combo-triggered');
      setTimeout(function () {
        d.classList.remove('bs-move-card__dots--combo-triggered');
      }, 800);
    });
  }

  // ─── Phase 1A: Combo hint (preview next combo in move buttons) ──────────
  function updateComboHints() {
    // Combo hints: only active during Battle Surge 2-phase selection
    var btns = document.querySelectorAll('.arena-move-btn');
    btns.forEach(function (btn) { btn.classList.remove('arena-move-btn--combo-hint'); });

    if (!_firstMove || !_battleSurgeActive) return;

    // Flurry: Strike + Strike
    if (_firstMove === 'strike') {
      var strikeBtn = document.querySelector('[data-move="strike"]');
      if (strikeBtn) strikeBtn.classList.add('arena-move-btn--combo-hint');
    }
    // Riposte: Guard + Counter
    if (_firstMove === 'guard') {
      var counterBtn = document.querySelector('[data-move="counter"]');
      if (counterBtn) counterBtn.classList.add('arena-move-btn--combo-hint');
    }
    // Empowered: Heal + Ability
    if (_firstMove === 'heal') {
      var abilityBtn = document.querySelector('.arena-move-btn--ability');
      if (abilityBtn) abilityBtn.classList.add('arena-move-btn--combo-hint');
    }
  }

  // ─── A1: main round animation — two sequential phases ────────────────────
  async function animateRoundResult(result) {
    _isAnimating = true;
    enableMoves(false);

    const abilityName = _abilityInfo ? _abilityInfo.label : 'Ability';
    const moveNames = { strike: 'Strike', guard: 'Guard', ability: abilityName, heal: 'Heal', counter: 'Counter' };
    const audio = window.ArenaAudio;
    const speedWinner = result.speedWinner || 'player';

    // Determine ordered attacker/defender sides and their stats
    const firstSide  = speedWinner;
    const secondSide = speedWinner === 'player' ? 'opponent' : 'player';
    const firstMove  = speedWinner === 'player' ? result.playerMove    : result.opponentMove;
    const secondMove = speedWinner === 'player' ? result.opponentMove   : result.playerMove;
    const firstDmg   = speedWinner === 'player' ? result.playerDamage  : result.opponentDamage;
    const secondDmg  = speedWinner === 'player' ? result.opponentDamage : result.playerDamage;
    const firstHeal  = speedWinner === 'player' ? result.playerHeal    : result.opponentHeal;
    const secondHeal = speedWinner === 'player' ? result.opponentHeal   : result.playerHeal;

    // Crit detection — events use "Your strike" vs "Opponent"
    const playerCrit   = result.events && result.events.some(e => e.includes('Your strike landed a critical'));
    const opponentCrit = result.events && result.events.some(e => e.includes('Opponent landed a critical'));
    const firstCrit    = speedWinner === 'player' ? playerCrit   : opponentCrit;
    const secondCrit   = speedWinner === 'player' ? opponentCrit : playerCrit;

    // Crowd boost detection
    const crowdBoosted = result.events && result.events.some(e => e.includes('Crowd energy fuels your attack'));

    // A1: Show speed badge near the faster combatant
    showSpeedBadge(speedWinner);

    // Phase 1A: Show matchup result banner
    showMatchupBanner(result.playerMove, result.opponentMove);

    // ── Phase 1: First attacker ──────────────────────────────────────────
    const firstLabel = firstSide === 'player' ? 'You' : 'Opponent';
    addLogEntry(`${firstLabel} used ${moveNames[firstMove] || firstMove}.`, 'info');

    await animateAttack(firstSide, firstMove, firstDmg, firstHeal);

    // A3: crit banner on target of first hit
    if (firstCrit) {
      const firstTarget = firstSide === 'player' ? 'opponent' : 'player';
      showCritBanner(firstTarget);
      shakeScreen('crit', 400);
      flashScreen('rgba(255, 50, 50, 0.12)', 350);
      if (audio) audio.play('crit');
      await sleep(150);
    }

    // Crowd boost flash — player was first and boost fired
    if (crowdBoosted && firstSide === 'player') {
      showCrowdBoostFlash();
      await sleep(200);
    }

    // A2: kill-shot check — if first attacker drops target to 0, skip Phase 2
    const firstKillsOpponent = firstSide === 'player'   && result.opponentHp <= 0;
    const firstKillsPlayer   = firstSide === 'opponent' && result.playerHp   <= 0;
    const phase1KillShot     = firstKillsOpponent || firstKillsPlayer;

    if (phase1KillShot) {
      const defeatedSide = firstSide === 'player' ? 'opponent' : 'player';
      await sleep(200);
      await triggerKillShot(defeatedSide);

    } else {
      // Pause so player absorbs what just happened before the counter
      await sleep(700);

      // ── Phase 2: Second attacker ───────────────────────────────────────
      const secondLabel = secondSide === 'player' ? 'You' : 'Opponent';
      addLogEntry(`${secondLabel} used ${moveNames[secondMove] || secondMove}.`, 'info');

      await animateAttack(secondSide, secondMove, secondDmg, secondHeal);

      // A3: crit banner on target of second hit
      if (secondCrit) {
        const secondTarget = secondSide === 'player' ? 'opponent' : 'player';
        showCritBanner(secondTarget);
        shakeScreen('crit', 400);
        flashScreen('rgba(255, 50, 50, 0.12)', 350);
        if (audio) audio.play('crit');
        await sleep(150);
      }

      // Crowd boost flash — player was second and boost fired
      if (crowdBoosted && secondSide === 'player') {
        showCrowdBoostFlash();
        await sleep(200);
      }

      // A2: kill-shot check after Phase 2
      const phase2KillShot = result.playerHp <= 0 || result.opponentHp <= 0;
      if (phase2KillShot) {
        const defeatedSide = result.playerHp <= 0 ? 'player' : 'opponent';
        await sleep(200);
        await triggerKillShot(defeatedSide);
      } else {
        await sleep(500);
      }
    }

    // ── B3: Counter reflect animation (fires before HP update for drama) ───
    if (result.playerCounterReflect) {
      showReflectBanner('player');
      if (audio) audio.play('crit');
      await sleep(300);
      showDamageFloat('opponent', result.playerDamage, false);
      triggerHitShake('opponent');
      if (audio) audio.play('hit');
      await sleep(500);
    } else if (result.opponentCounterReflect) {
      showReflectBanner('opponent');
      if (audio) audio.play('crit');
      await sleep(300);
      showDamageFloat('player', result.opponentDamage, false);
      triggerHitShake('player');
      if (audio) audio.play('hit');
      await sleep(500);
    }

    // ── Phase 3: Resolution ───────────────────────────────────────────────
    // HP bars update after both attacks for clean readability
    updateHpBars(result.playerHp, _battleData.player.maxHp, result.opponentHp, _battleData.opponent.maxHp);

    // Update stamina bars + move costs from round result
    if (result.stamina) {
      _battleData.stamina = { player: result.stamina.player, opponent: result.stamina.opponent };
      _battleData.maxStamina = { player: result.stamina.playerMax, opponent: result.stamina.opponentMax };
      updateStaminaBars(result.stamina.player, result.stamina.playerMax, result.stamina.opponent, result.stamina.opponentMax);
      updateMoveCosts(result.stamina.player);
    }

    // Update cooldown overlays from round result
    if (result.cooldowns) {
      _battleData.cooldowns = result.cooldowns;
      updateCooldownOverlays(result.cooldowns.player);
    }

    // Update stances from round result
    if (result.stances) {
      _battleData.stances = result.stances;
      updateBossStance(result.stances.opponent);
    }

    // Log events (matchup results, crits, heals, buffs)
    if (result.events && result.events.length > 0) {
      result.events.forEach(e => addLogEntry(e, 'event'));
    }

    // Phase 1A: Flash passive activations detected from events
    showPassiveFlashes(result.events);

    // Phase 1B: Combo banner + first-discovery toast + juice
    if (result.comboTriggered) {
      showComboBanner(result.comboTriggered);
      showComboDiscoveryToast(result.comboTriggered);
      var comboColor = COMBO_DEFS[result.comboTriggered] ? COMBO_DEFS[result.comboTriggered].color : '#FFD700';
      shakeScreen('crit', 400);
      var field = document.querySelector('.arena-battle__field');
      spawnParticles(field, 15, comboColor, 'up');
      flashComboTriggered(result.comboTriggered);
    }

    // B6: Combo Chain — STREAK banner at peak (chain reaches 5),
    // re-fires every 3 hits past peak (8, 11, 14...) so an extended
    // streak keeps feeling rewarding without spamming the banner.
    var chain = (typeof result.comboChain === 'number') ? result.comboChain : 0;
    if (chain === 5 || (chain > 5 && (chain - 5) % 3 === 0)) {
      showStreakBanner(chain);
    } else if (chain >= 3 && chain < 5) {
      // Mid-chain: subtle particles in the chain color, no banner.
      var chainField = document.querySelector('.arena-battle__field');
      if (chainField) spawnParticles(chainField, 8, '#ef9f27', 'up');
    }

    // Phase 1B: Track move history for combo hints
    _moveHistory.push(result.playerMove);
    updateComboPipState();

    // B1: Last Stand — check transition before updating stored HP
    const prevPlayerHpPct  = _battleData.player.hp   / _battleData.player.maxHp;
    const prevOpponentHpPct = _battleData.opponent.hp / _battleData.opponent.maxHp;
    const newPlayerHpPct   = result.playerHp   / _battleData.player.maxHp;
    const newOpponentHpPct  = result.opponentHp / _battleData.opponent.maxHp;

    const isPlayerLastStand   = result.playerHp   > 0 && newPlayerHpPct   < 0.20;
    const isOpponentLastStand = result.opponentHp > 0 && newOpponentHpPct  < 0.20;

    const playerSideEl   = document.getElementById('arena-player-side');
    const opponentSideEl = document.getElementById('arena-opponent-side');
    if (playerSideEl)   playerSideEl.classList.toggle('arena-combatant--last-stand', isPlayerLastStand);
    if (opponentSideEl) opponentSideEl.classList.toggle('arena-combatant--last-stand', isOpponentLastStand);

    // Show activation banner on first entry into Last Stand
    if (isPlayerLastStand   && prevPlayerHpPct   >= 0.20) showLastStandActivation('player');
    if (isOpponentLastStand && prevOpponentHpPct >= 0.20) showLastStandActivation('opponent');

    // A5: update streak counter
    if (result.playerDamage > 0) {
      _playerStreak++;
      if (_playerStreak >= 2) showStreakBadge(_playerStreak);
    } else if (result.playerMove === 'guard' || result.playerMove === 'heal' || result.playerMove === 'counter') {
      _playerStreak = 0;
    }

    // B2: render status effect chips
    renderStatusEffects(result.tempEffects);

    // B4: hype updates
    if (playerCrit || opponentCrit)                             updateHype(25);
    if (result.playerCounterReflect || result.opponentCounterReflect) updateHype(20);
    if (isPlayerLastStand   && prevPlayerHpPct   >= 0.20)      updateHype(20);
    if (isOpponentLastStand && prevOpponentHpPct >= 0.20)      updateHype(20);
    if (_playerStreak >= 3)                                    updateHype(15);
    if (result.tempEffects && (
      (result.tempEffects.opponent || []).some(function (e) { return e.effect === 'stun'; }) ||
      (result.tempEffects.player   || []).some(function (e) { return e.effect === 'stun'; })
    )) updateHype(15);

    // Update local HP state
    _battleData.player.hp   = result.playerHp;
    _battleData.opponent.hp = result.opponentHp;

    // Update charges from round result
    if (result.charges) {
      _playerCharges = result.charges.player;
      updateChargeDisplay();
    }


    await sleep(300);
    _isAnimating = false;
  }

  // Battle Surge: rare consumable that enables 2-move turns (dormant until activated)
  var _battleSurgeActive = false;
  var _firstMove = null;

  async function handleMoveClick(move) {
    if (_isAnimating || !_battleData) return;

    // Client-side cooldown check
    if (_battleData.cooldowns && _battleData.cooldowns.player && _battleData.cooldowns.player[move] > 0) {
      addLogEntry(move.charAt(0).toUpperCase() + move.slice(1) + ' is on cooldown!', 'error');
      return;
    }

    // Click feedback — brief one-shot CSS burst on the pressed card so
    // every move feels responsive, not just the ones that trigger combos.
    var pressedBtn = document.querySelector('.arena-move-btn[data-move="' + move + '"]');
    if (pressedBtn) {
      pressedBtn.classList.add('arena-move-btn--pressed');
      setTimeout(function () { pressedBtn.classList.remove('arena-move-btn--pressed'); }, 320);
    }

    // Per-move release tone. For ability, detect class variant from the
    // art panel class (bs-move-card__art--ability-{variant}) so each
    // class-specific signature move plays its own pitch + texture.
    if (window.BsSfx && pressedBtn) {
      var soundKey = 'moveBtnRelease_' + move;
      if (move === 'ability') {
        var artEl = pressedBtn.querySelector('.bs-move-card__art');
        if (artEl) {
          var match = artEl.className.match(/bs-move-card__art--ability-(\w+)/);
          if (match) soundKey = 'moveBtnRelease_' + match[1];
        }
      }
      window.BsSfx.play(soundKey);
    }

    // Battle Surge: 2-phase selection when active (PvE consumable only)
    if (_battleSurgeActive && _firstMove === null) {
      _firstMove = move;
      var btn1 = document.querySelector('.arena-move-btn[data-move="' + move + '"]');
      if (btn1) btn1.classList.add('arena-move-btn--selected-first');
      var prompt = document.getElementById('bs-move-select-prompt');
      if (prompt) { prompt.textContent = 'SURGE \u2014 Pick second move'; prompt.style.display = ''; }
      addLogEntry('\u26A1 SURGE! ' + move.charAt(0).toUpperCase() + move.slice(1) + ' locked \u2014 pick 2nd move.');
      updateComboHints();
      return;
    }

    // Resolve the move(s) to submit
    var submitMove = move;
    if (_battleSurgeActive && _firstMove) {
      submitMove = [_firstMove, move];
      _firstMove = null;
      _battleSurgeActive = false;
      document.querySelectorAll('.arena-move-btn').forEach(function(b) { b.classList.remove('arena-move-btn--selected-first'); });
      var prompt2 = document.getElementById('bs-move-select-prompt');
      if (prompt2) prompt2.style.display = 'none';
    }

    enableMoves(false);

    try {
      const boost = _crowdBoostPending;
      _crowdBoostPending = false;
      var moveExtra = {};
      if (boost) {
        moveExtra.crowdBoost = true;
        moveExtra.hypeClimax = true; // Same trigger -- climax also refunds +8 stamina to both
      }
      if (window._pendingItemUse) { moveExtra.useItem = window._pendingItemUse; window._pendingItemUse = null; }
      if (_stanceChangedThisTurn) moveExtra.stance = _playerStance;
      _stanceChangedThisTurn = false;
      // Live PvP: use submitLiveMove, handle waiting state
      if (_battleData.type === 'live_pvp') {
        var liveMoves = Array.isArray(submitMove) ? submitMove : [submitMove, 'guard'];
        var liveResponse = await window.ArenaAPI.submitLiveMove(
          _battleData.battleId, _currentRound, liveMoves, moveExtra.stance || _playerStance, moveExtra
        );

        if (liveResponse.status === 'waiting') {
          // Move locked in, waiting for opponent
          addLogEntry('Move locked in. Waiting for opponent...', 'hint');
          // Show waiting indicator
          var waitEl = document.getElementById('arena-waiting-indicator');
          if (!waitEl) {
            waitEl = document.createElement('div');
            waitEl.id = 'arena-waiting-indicator';
            waitEl.className = 'arena-waiting-indicator';
            var field = document.querySelector('.arena-battle__field');
            if (field) field.appendChild(waitEl);
          }
          waitEl.innerHTML = '<i class="fas fa-hourglass-half fa-spin"></i> Waiting for opponent...';
          waitEl.style.display = '';
          // Don't re-enable moves — polling will handle round resolution
          return;
        }

        if (liveResponse.status === 'resolved') {
          // Both players submitted — animate the round result
          hideBossIntent();

          if (liveResponse.roundResult) {
            await animateLiveRound(liveResponse.roundResult);
          }

          if (liveResponse.battleStatus === 'complete') {
            var endAudio2 = window.ArenaAudio;
            if (endAudio2) endAudio2.play(liveResponse.winner === 'you' ? 'victory' : 'defeat');
            if (endAudio2 && typeof endAudio2.stopMusic === 'function') endAudio2.stopMusic();
            addLogEntry(liveResponse.winner === 'you' ? 'Victory!' : liveResponse.winner === 'opponent' ? 'Defeated!' : 'Draw!', 'event');
          } else {
            _currentRound = liveResponse.roundResult ? liveResponse.roundResult.round + 1 : _currentRound + 1;
            updateRoundLabel(_currentRound);
            addLogEntry('Round ' + _currentRound + ' — Choose your moves.');
            enableMoves(true);
          }
          return;
        }

        // Expired or error
        addLogEntry('Battle ended: ' + (liveResponse.message || 'unknown'), 'error');
        return;
      }

      // PvE / Async PvP: original flow
      const response = await window.ArenaAPI.submitMove(
        _battleData.battleId, _currentRound, submitMove, moveExtra
      );

      // Hide boss intent during animation
      hideBossIntent();

      await animateRoundResult(response.roundResult);

      if (response.battleStatus === 'complete') {
        if (window._arenaTutorial && window._arenaTutorial.isActive()) {
          window._arenaTutorial.end();
        }
        var endAudio = window.ArenaAudio;
        if (endAudio) endAudio.play(response.battleResult.winner === 'player' ? 'victory' : 'defeat');
        if (endAudio && typeof endAudio.stopMusic === 'function') endAudio.stopMusic();
        var forfeitBtn = document.getElementById('arena-forfeit-btn');
        var postActions = document.getElementById('arena-battle-post');
        if (forfeitBtn) forfeitBtn.style.display = 'none';
        if (postActions) postActions.style.display = '';
        await sleep(600);
        window.ArenaResults.showResults(response.battleResult, _battleData);
      } else {
        _currentRound = response.currentRound;
        updateRoundLabel(_currentRound);
        addLogEntry(`Round ${_currentRound} — Choose your move.`);
        // Telegraph: Show boss's next committed move
        if (response.roundResult && response.roundResult.nextBossIntent) {
          showBossIntent(response.roundResult.nextBossIntent);
        }
        if (window.BsTutorial && window.BsTutorial.isActive()) {
          requestAnimationFrame(function () {
            var m = Array.isArray(submitMove) ? submitMove[0] : submitMove;
            window.BsTutorial.onMoveComplete(m);
            window.BsTutorial.checkContextual({
              playerHp: response.roundResult.playerHp,
              playerMaxHp: _battleData.player.maxHp,
              charges: _playerCharges,
              abilityCost: _abilityCost,
              hype: _hype,
              round: _currentRound
            });
          });
        }
        enableMoves(true);
      }
    } catch (err) {
      addLogEntry(`Error: ${err.message}`, 'error');
      enableMoves(true);
    }
  }

  function activateBattleSurge() {
    _battleSurgeActive = true;
    addLogEntry('\u26A1 BATTLE SURGE activated! Pick 2 moves this turn.');
  }

  function showForfeitModal() {
    if (_isAnimating || !_battleData) return;
    const modal = document.getElementById('arena-forfeit-modal');
    if (modal) modal.style.display = 'flex';
  }

  function hideForfeitModal() {
    const modal = document.getElementById('arena-forfeit-modal');
    if (modal) modal.style.display = 'none';
  }

  async function executeForfeit() {
    hideForfeitModal();
    enableMoves(false);
    try {
      const response = await window.ArenaAPI.forfeitBattle(_battleData.battleId);
      addLogEntry('You forfeited the battle.', 'error');
      if (window.ArenaAudio && typeof window.ArenaAudio.stopMusic === 'function') {
        window.ArenaAudio.stopMusic();
      }
      await sleep(400);
      window.ArenaResults.showResults(response.battleResult, _battleData);
    } catch (err) {
      addLogEntry(`Error: ${err.message}`, 'error');
    }
  }

  // Bind move buttons
  function bindEvents() {
    document.querySelectorAll('.arena-move-btn').forEach(btn => {
      btn.addEventListener('click', () => handleMoveClick(btn.dataset.move));
      // Universal press-down click sound on pointerdown — matches the
      // visual :active depression. Skip on disabled / out-of-stamina /
      // exhausted moves so we don't reward presses that don't fire.
      btn.addEventListener('pointerdown', () => {
        if (btn.disabled) return;
        if (btn.classList.contains('arena-move-btn--no-stamina')) return;
        if (btn.classList.contains('arena-move-btn--exhausted')) return;
        if (window.BsSfx) window.BsSfx.play('moveBtnPress');
      });
    });

    const forfeitBtn = document.getElementById('arena-forfeit-btn');
    if (forfeitBtn) forfeitBtn.addEventListener('click', showForfeitModal);

    const forfeitConfirm = document.getElementById('arena-forfeit-confirm');
    if (forfeitConfirm) forfeitConfirm.addEventListener('click', executeForfeit);

    const forfeitCancel = document.getElementById('arena-forfeit-cancel');
    if (forfeitCancel) forfeitCancel.addEventListener('click', hideForfeitModal);

    // Close modal on overlay click
    const modal = document.getElementById('arena-forfeit-modal');
    if (modal) modal.addEventListener('click', function (e) {
      if (e.target === modal) hideForfeitModal();
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ═══════════════════════════════════════════════════════════════
  // LIVE PVP ROUND ANIMATION
  // Adapts the live PvP perspective-shifted round result into
  // sequential attack animations using existing primitives.
  // ═══════════════════════════════════════════════════════════════

  async function animateLiveRound(lr) {
    if (!lr || !_battleData) return;
    _isAnimating = true;
    enableMoves(false);

    // Hide waiting indicator
    var waitEl = document.getElementById('arena-waiting-indicator');
    if (waitEl) waitEl.style.display = 'none';

    var audio = window.ArenaAudio;
    var moveNames = { strike: 'Strike', guard: 'Guard', ability: 'Ability', heal: 'Heal', counter: 'Counter' };

    // ── Slot 1 animation ──
    var myMove1 = lr.myMoves ? lr.myMoves[0] : 'guard';
    var oppMove1 = lr.opponentMoves ? lr.opponentMoves[0] : 'guard';
    addLogEntry('\u2694\uFE0F Slot 1: You chose ' + (moveNames[myMove1] || myMove1) + ' \u2014 Opponent chose ' + (moveNames[oppMove1] || oppMove1));

    // Speed badge
    if (lr.slot1SpeedWinner) showSpeedBadge(lr.slot1SpeedWinner === 'player' ? 'player' : 'opponent');

    // Animate damage
    var myDmg1 = lr.slot1MyDmgTaken || 0;
    var oppDmg1 = lr.slot1OpponentDmgTaken || 0;

    if (oppDmg1 > 0) {
      showDamageFloat('opponent', oppDmg1, false);
      triggerHitShake('opponent');
      if (audio) audio.play('hit');
    }
    if (lr.slot1MyHeal > 0) {
      showDamageFloat('player', lr.slot1MyHeal, true);
    }
    if (myDmg1 > 0) {
      await sleep(300);
      showDamageFloat('player', myDmg1, false);
      triggerHitShake('player');
      if (audio) audio.play('hit');
    }
    if (lr.slot1OpponentHeal > 0) {
      showDamageFloat('opponent', lr.slot1OpponentHeal, true);
    }

    // Log slot 1 events
    if (lr.slot1Events) lr.slot1Events.forEach(function(e) { addLogEntry(e, 'event'); });

    await sleep(600);

    // ── Slot 2 animation (if both still alive) ──
    if (lr.slot2Events && lr.slot2Events.length > 0) {
      var myMove2 = lr.myMoves ? lr.myMoves[1] : 'guard';
      var oppMove2 = lr.opponentMoves ? lr.opponentMoves[1] : 'guard';
      addLogEntry('\u2694\uFE0F Slot 2: You chose ' + (moveNames[myMove2] || myMove2) + ' \u2014 Opponent chose ' + (moveNames[oppMove2] || oppMove2));

      var oppDmg2 = lr.slot2OpponentDmgTaken || 0;
      var myDmg2 = lr.slot2MyDmgTaken || 0;

      if (oppDmg2 > 0) {
        showDamageFloat('opponent', oppDmg2, false);
        triggerHitShake('opponent');
        if (audio) audio.play('hit');
      }
      if (lr.slot2MyHeal > 0) {
        showDamageFloat('player', lr.slot2MyHeal, true);
      }
      if (myDmg2 > 0) {
        await sleep(300);
        showDamageFloat('player', myDmg2, false);
        triggerHitShake('player');
        if (audio) audio.play('hit');
      }
      if (lr.slot2OpponentHeal > 0) {
        showDamageFloat('opponent', lr.slot2OpponentHeal, true);
      }

      lr.slot2Events.forEach(function(e) { addLogEntry(e, 'event'); });
      await sleep(400);
    }

    // Counter reflect animation
    if (lr.slot1MyCounterReflect || lr.slot2MyCounterReflect) {
      showReflectBanner('player');
      if (audio) audio.play('crit');
      await sleep(400);
    } else if (lr.slot1OpponentCounterReflect || lr.slot2OpponentCounterReflect) {
      showReflectBanner('opponent');
      if (audio) audio.play('crit');
      await sleep(400);
    }

    // Combo chain banner — fires on the player's own peak (chain 5),
    // re-fires every 3 hits past peak (8, 11, 14...). Mirrors campaign B6.
    var myChain = (lr.comboChain && typeof lr.comboChain.my === 'number') ? lr.comboChain.my : 0;
    if (myChain === 5 || (myChain > 5 && (myChain - 5) % 3 === 0)) {
      showStreakBanner(myChain);
      await sleep(300);
    } else if (myChain >= 3 && myChain < 5) {
      var chainField = document.querySelector('.arena-battle__field');
      if (chainField) spawnParticles(chainField, 8, '#ef9f27', 'up');
    }

    // ── Update HP bars (final values after both slots) ──
    updateHpBars(lr.myHp, lr.myMaxHp, lr.opponentHp, lr.opponentMaxHp);

    // Kill shot check
    if (lr.myHp <= 0 || lr.opponentHp <= 0) {
      var defeatedSide = lr.myHp <= 0 ? 'player' : 'opponent';
      await sleep(200);
      await triggerKillShot(defeatedSide);
    }

    // Update stamina
    if (lr.stamina && typeof updateStaminaBars === 'function') {
      _battleData.stamina = { player: lr.stamina.my, opponent: lr.stamina.opponent };
      updateStaminaBars(lr.stamina.my, _battleData.maxStamina ? _battleData.maxStamina.player : 20, lr.stamina.opponent, _battleData.maxStamina ? _battleData.maxStamina.opponent : 20);
      if (typeof updateMoveCosts === 'function') updateMoveCosts(lr.stamina.my);
    }

    // Update cooldowns
    if (lr.cooldowns) {
      _battleData.cooldowns = { player: lr.cooldowns.my || {}, opponent: lr.cooldowns.opponent || {} };
      if (typeof updateCooldownOverlays === 'function') updateCooldownOverlays(lr.cooldowns.my);
    }

    // Update charges
    if (lr.charges) {
      _playerCharges = lr.charges.my || 0;
      if (typeof updateChargeDisplay === 'function') updateChargeDisplay();
    }

    // Update temp effects
    if (lr.tempEffects && typeof renderStatusEffects === 'function') {
      renderStatusEffects({ player: lr.tempEffects.my || [], opponent: lr.tempEffects.opponent || [] });
    }

    // Update local HP state
    _battleData.player.hp = lr.myHp;
    _battleData.opponent.hp = lr.opponentHp;

    await sleep(300);
    _isAnimating = false;
  }

  return {
    initBattle, bindEvents, enableMoves, showBossIntent, hideBossIntent, activateBattleSurge,
    updateHpBars, animateLiveRound,
    updateStaminaBars: typeof updateStaminaBars === 'function' ? updateStaminaBars : function(){},
    updateChargeDisplay: typeof updateChargeDisplay === 'function' ? updateChargeDisplay : function(){},
    updateCooldownOverlays: typeof updateCooldownOverlays === 'function' ? updateCooldownOverlays : function(){}
  };
})();
