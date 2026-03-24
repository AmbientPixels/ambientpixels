/**
 * Blindspot Storage Cleanup
 *
 * Strips bloat from localStorage (rendered HTML, base64 avatars, excess cards)
 * to keep under 5MB quota.
 *
 * API: window.BsStorageCleanup
 *   .run(safeLSSet) — execute cleanup, pass safeLSSet for quota-safe writes
 */
window.BsStorageCleanup = (function () {
  'use strict';

  function run(safeLSSet) {
    try {
      // CardForge's cardforge_saved_cards can bloat localStorage with
      // renderedFront/renderedBack HTML (50-100KB per card). Strip these
      // to keep localStorage under the 5MB quota.
      var raw = localStorage.getItem('cardforge_saved_cards');
      if (!raw) return;
      var cards = JSON.parse(raw);
      var cleaned = false;
      cards.forEach(function (card) {
        if (card.cardData) {
          if (card.cardData.renderedFront) { delete card.cardData.renderedFront; cleaned = true; }
          if (card.cardData.renderedBack) { delete card.cardData.renderedBack; cleaned = true; }
          if (card.cardData.frontClasses) { delete card.cardData.frontClasses; cleaned = true; }
          if (card.cardData.backClasses) { delete card.cardData.backClasses; cleaned = true; }
          // Strip base64 avatars (AI-generated images can be 200-500KB each)
          if (card.cardData.avatar && card.cardData.avatar.startsWith('data:image/')) {
            card.cardData.avatar = '';
            cleaned = true;
          }
        }
        // Also strip top-level rendered HTML
        if (card.renderedFront) { delete card.renderedFront; cleaned = true; }
        if (card.renderedBack) { delete card.renderedBack; cleaned = true; }
      });
      // Cap to 10 most recent cards
      if (cards.length > 10) {
        cards.splice(10);
        cleaned = true;
      }
      if (cleaned) {
        safeLSSet('cardforge_saved_cards', JSON.stringify(cards));
        console.log('[Blindspot] Cleaned localStorage: removed rendered HTML from saved cards');
      }
    } catch (e) {
      console.warn('[Blindspot] Storage cleanup error:', e);
    }
  }

  return { run: run };
})();
