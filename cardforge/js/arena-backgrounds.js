/**
 * Arena Backgrounds — battle arena picker + rank-locked backgrounds
 */
window.ArenaBackgrounds = (function () {
  'use strict';

  var STORAGE_KEY = 'cardforge-arena-bg';

  var ARENAS = [
    { id: 'colosseum',      name: 'Stone Colosseum',  rank: null,       icon: 'fa-chess-rook',  image: '/cardforge/img/arena/arena-colosseum.webp' },
    { id: 'shadow-pit',     name: 'Shadow Pit',       rank: 'bronze',   icon: 'fa-ghost',       image: '/cardforge/img/arena/arena-shadow-pit.webp' },
    { id: 'forge-grounds',  name: 'Forge Grounds',    rank: 'silver',   icon: 'fa-fire',        image: '/cardforge/img/arena/arena-forge-grounds.webp' },
    { id: 'crystal-sanctum',name: 'Crystal Sanctum',  rank: 'gold',     icon: 'fa-gem',         image: '/cardforge/img/arena/arena-crystal-sanctum.webp' },
    { id: 'void-rift',      name: 'Void Rift',        rank: 'platinum', icon: 'fa-burst',       image: '/cardforge/img/arena/arena-void-rift.webp' },
    { id: 'throne',         name: 'Throne of the King',rank: 'diamond', icon: 'fa-crown',       image: '/cardforge/img/arena/arena-throne.webp' }
  ];

  var RANK_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

  function isUnlocked(arena, playerRank) {
    if (!arena.rank) return true; // default arena always unlocked
    var playerIdx = RANK_ORDER.indexOf(playerRank || 'bronze');
    var requiredIdx = RANK_ORDER.indexOf(arena.rank);
    return playerIdx >= requiredIdx;
  }

  function getSelected() {
    try { return localStorage.getItem(STORAGE_KEY) || 'colosseum'; }
    catch (e) { return 'colosseum'; }
  }

  function setSelected(id) {
    try { localStorage.setItem(STORAGE_KEY, id); }
    catch (e) {}
  }

  function getArenaById(id) {
    return ARENAS.find(function (a) { return a.id === id; }) || ARENAS[0];
  }

  /**
   * Render the arena picker strip into a container
   */
  function renderPicker(containerId, playerRank, onSelect) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var selected = getSelected();

    container.innerHTML = ARENAS.map(function (arena) {
      var unlocked = isUnlocked(arena, playerRank);
      var isActive = arena.id === selected;
      var cls = 'arena-bg-thumb' +
        (isActive ? ' arena-bg-thumb--selected' : '') +
        (!unlocked ? ' arena-bg-thumb--locked' : '');

      var rankLabel = arena.rank ? arena.rank.charAt(0).toUpperCase() + arena.rank.slice(1) : '';

      return '<button class="' + cls + '" data-arena-id="' + arena.id + '" ' +
        (!unlocked ? 'disabled' : '') + ' title="' + arena.name +
        (!unlocked ? ' (Requires ' + rankLabel + ' rank)' : '') + '">' +
        '<div class="arena-bg-thumb__preview" style="background-image: url(' + arena.image + ')"></div>' +
        '<div class="arena-bg-thumb__info">' +
          '<i class="fas ' + arena.icon + '"></i>' +
          '<span class="arena-bg-thumb__name">' + arena.name + '</span>' +
          (!unlocked ? '<span class="arena-bg-thumb__lock"><i class="fas fa-lock"></i> ' + rankLabel + '</span>' : '') +
        '</div>' +
        (isActive ? '<div class="arena-bg-thumb__check"><i class="fas fa-check"></i></div>' : '') +
      '</button>';
    }).join('');

    // Bind clicks
    container.querySelectorAll('.arena-bg-thumb:not([disabled])').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setSelected(btn.dataset.arenaId);
        renderPicker(containerId, playerRank, onSelect); // re-render to update selection
        if (onSelect) onSelect(btn.dataset.arenaId);
      });
    });
  }

  /**
   * Apply the selected arena background to the battle stage
   */
  function applyToBattleStage() {
    var stage = document.querySelector('.arena-battle__stage');
    if (!stage) return;

    // Remove all existing arena-stage-- classes
    var classes = stage.className.split(' ').filter(function (c) {
      return c.indexOf('arena-stage--') !== 0;
    });

    var selected = getSelected();
    classes.push('arena-stage--' + selected);
    stage.className = classes.join(' ');
  }

  return {
    ARENAS: ARENAS,
    renderPicker: renderPicker,
    applyToBattleStage: applyToBattleStage,
    getSelected: getSelected,
    getArenaById: getArenaById
  };
})();
