/**
 * Blindspot Save Card — direct card save to API
 * Replaces the CardForge editor pipeline (form fields → handleSaveCard).
 * Builds payload from Quick Build state and POSTs directly to cardforgesavecards.
 */
window.BlindspotSaveCard = (function () {
  'use strict';

  /**
   * Save a card to the server.
   * @param {object} cardState - Quick Build _state object
   * @param {object} stats - Combat stats { str, agi, int, end, lck }
   * @returns {Promise<string>} The saved card's ID
   */
  async function save(cardState, stats) {
    var url = window.buildApiPath('saveCard');
    if (!url) throw new Error('saveCard endpoint not configured');

    var authHeaders = await window.ArenaAPI.getPrincipalHeader();

    var cardId = 'bs-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);

    var payload = {
      id: cardId,
      name: cardState.cardName || 'Unknown',
      class: cardState.cardClass || 'Fighter',
      characterClass: cardState.cardClass || 'Fighter',
      avatar: cardState.artworkUrl || '',
      quote: (cardState.aiData && cardState.aiData.quote) || '',
      rarity: cardState.cardRarity || 'Common',
      element: cardState.element || ((window.BsConst || {}).CLASS_DEFAULT_ELEMENT || {})[cardState.cardClass] || 'chaos',
      combatStats: stats || { str: 60, agi: 60, int: 60, end: 60, lck: 60 },
      cardData: {
        name: cardState.cardName || 'Unknown',
        characterClass: cardState.cardClass || 'Fighter',
        rarity: cardState.cardRarity || 'Common',
        avatar: cardState.artworkUrl || '',
        palette: 'earth',
        imageContainer: cardState.imageContainer || 'masked',
        element: cardState.element || ((window.BsConst || {}).CLASS_DEFAULT_ELEMENT || {})[cardState.cardClass] || 'chaos',
        combatStats: stats || { str: 60, agi: 60, int: 60, end: 60, lck: 60 },
        quote: (cardState.aiData && cardState.aiData.quote) || '',
        biography: (cardState.aiData && cardState.aiData.biography) || ''
      }
    };

    var headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders);

    // Add CSRF token
    var csrfMeta = document.querySelector('meta[name="csrf-token"]');
    if (csrfMeta && csrfMeta.content) {
      headers['X-CSRF-Token'] = csrfMeta.content;
    }

    var resp = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      var errData;
      try { errData = await resp.json(); } catch (e) { errData = {}; }
      throw new Error(errData.error || 'Save failed: ' + resp.status);
    }

    return cardId;
  }

  return { save: save };
})();
