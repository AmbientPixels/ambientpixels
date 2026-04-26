/**
 * CardForge — /cardforge/forge.html page boot.
 *
 * Awaits the cached principal (cardforge-nav.js exposes window._cfPrincipalReady),
 * toggles the anonymous CTA vs the panel grid, then wires the four panels:
 *
 *   1. My Cards (drafts)        -> CardForgeMyCards.mount(#my-cards-list)
 *   2. My Published Cards       -> auto-binds to #cf-mpc-list (existing module)
 *   3. My Favorites             -> auto-binds to #cf-fav-list (existing module)
 *   4. My Decks (saved + pub)   -> CardForgeMySavedDecks.mount(#cf-msd-grid)
 *                                  CardForgeMyPublishedDecks.mount(#cf-mpd-grid)
 *
 * The two card modules (my-published-cards, my-favorites) hard-bind to editor
 * sidebar selectors and lazy-load on tab click. We mirror that markup here
 * with hidden tab buttons, then click them once on init to trigger the load.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function showAnon() {
    var anon = $('cf-forge-anon-cta');
    var grid = $('cf-forge-grid');
    if (anon) anon.hidden = false;
    if (grid) grid.hidden = true;

    var signin = $('cf-forge-signin');
    if (signin) {
      signin.addEventListener('click', function () {
        var here = window.location.pathname + window.location.search;
        window.location.href = '/cardforge/login.html?redirect=' + encodeURIComponent(here);
      });
    }
  }

  function showGrid() {
    var anon = $('cf-forge-anon-cta');
    var grid = $('cf-forge-grid');
    if (anon) anon.hidden = true;
    if (grid) grid.hidden = false;
  }

  function bootPanels() {
    if (window.CardForgeMyCards) {
      window.CardForgeMyCards.mount($('my-cards-list'));
    }

    if (window.CardForgeMySavedDecks) {
      window.CardForgeMySavedDecks.mount($('cf-msd-grid'));
    }
    if (window.CardForgeMyPublishedDecks) {
      window.CardForgeMyPublishedDecks.mount($('cf-mpd-grid'));
    }

    // The published-cards + favorites modules self-bind to their hidden tab
    // buttons on DOMContentLoaded and lazy-load on click. Clicking once
    // triggers the initial fetch+render. They drop into our #cf-mpc-list and
    // #cf-fav-list containers because we mirror the editor's IDs.
    var tabs = document.querySelectorAll('header[data-cf-nav] ~ main .forge-sidebar-tab');
    setTimeout(function () {
      var pubTab = document.querySelector('.forge-sidebar-tab[data-forge-tab="published"]');
      var favTab = document.querySelector('.forge-sidebar-tab[data-forge-tab="favorites"]');
      if (pubTab) pubTab.click();
      if (favTab) favTab.click();
    }, 50);
  }

  async function init() {
    var principal = null;
    try {
      principal = window._cfPrincipalReady ? await window._cfPrincipalReady : null;
    } catch (_) { principal = null; }

    if (!principal || !principal.userId) {
      showAnon();
      return;
    }
    showGrid();
    bootPanels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
