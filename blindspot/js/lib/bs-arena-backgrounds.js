/**
 * Blindspot Arena Backgrounds — battle arena picker + boss-unlocked backgrounds
 * Arenas unlock by defeating campaign bosses. Music mapped 1:1 in bs-arena-audio.js.
 */
window.ArenaBackgrounds = (function () {
  'use strict';

  var STORAGE_KEY = 'blindspot-arena-bg';

  var ARENAS = [
    { id: 'colosseum',       name: 'Stone Colosseum',    bossRequired: null, bossName: null,             icon: 'fa-chess-rook', image: '/blindspot/img/arena/arena-colosseum.webp',       variants: [] },
    { id: 'shadow-pit',      name: 'Shadow Pit',         bossRequired: 2,    bossName: 'Gutter Rat',          icon: 'fa-ghost',      image: '/blindspot/img/arena/arena-shadow-pit.webp',      variants: [] },
    { id: 'forge-grounds',   name: 'Forge Grounds',      bossRequired: 4,    bossName: 'Arcane Scholar',      icon: 'fa-fire',       image: '/blindspot/img/arena/arena-forge-grounds.webp',   variants: [] },
    { id: 'crystal-sanctum', name: 'Crystal Sanctum',    bossRequired: 6,    bossName: 'Ironclad Sentinel',   icon: 'fa-gem',        image: '/blindspot/img/arena/arena-crystal-sanctum.webp', variants: [] },
    { id: 'void-rift',       name: 'Void Rift',          bossRequired: 8,    bossName: 'The Forge King',      icon: 'fa-burst',      image: '/blindspot/img/arena/arena-void-rift.webp',       variants: [] },
    { id: 'throne',          name: 'Throne of the King', bossRequired: 10,   bossName: 'Crystal Weaver',      icon: 'fa-crown',      image: '/blindspot/img/arena/arena-throne.webp',          variants: [] }
  ];

  function isUnlocked(arena, highestBoss) {
    if (!arena.bossRequired) return true;
    return (highestBoss || 0) >= arena.bossRequired;
  }

  function getUnlockedArenas(highestBoss) {
    return ARENAS.filter(function (a) { return isUnlocked(a, highestBoss); });
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

  function applyToBattleStage() {
    var selected = getSelected();
    var arena = getArenaById(selected);
    var imageUrl = arena ? arena.image : null;

    // Legacy stage element gets the per-arena class; CSS rules in
    // blindspot.css (.arena-stage--<id>) attach the background-image.
    var stage = document.querySelector('.arena-battle__stage');
    if (stage) {
      var classes = stage.className.split(' ').filter(function (c) {
        return c.indexOf('arena-stage--') !== 0;
      });
      classes.push('arena-stage--' + selected);
      stage.className = classes.join(' ');
    }

    // Vein-theme arena div is a separate absolute-positioned element
    // (sits behind the stage with a blur+darken filter). It needs its
    // own background-image set inline since there's no per-arena class
    // hook for it. Update both pages — play.html had a static inline
    // default, index.html had nothing.
    var veinArena = document.querySelector('.blindspot-battle .blindspot-battle__arena');
    if (veinArena && imageUrl) {
      veinArena.style.backgroundImage = "url('" + imageUrl + "')";
    }
  }

  return {
    ARENAS: ARENAS,
    isUnlocked: isUnlocked,
    getUnlockedArenas: getUnlockedArenas,
    applyToBattleStage: applyToBattleStage,
    getSelected: getSelected,
    setSelected: setSelected,
    getArenaById: getArenaById
  };
})();
