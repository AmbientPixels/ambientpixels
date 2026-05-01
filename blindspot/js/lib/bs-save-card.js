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

    // Trim AI-generated text to the server's validateCard limits
    // (cardforgesavecards: name 2-30, class 2-20, quote <100). Gemini
    // routinely exceeds these — clip rather than fail the save.
    function clip(s, max) {
      if (!s) return '';
      var t = String(s).trim();
      return t.length > max ? t.slice(0, max) : t;
    }

    var name = clip(cardState.cardName, 30) || 'Unknown';
    var cls = clip(cardState.cardClass, 20) || 'Fighter';
    var quote = clip((cardState.aiData && cardState.aiData.quote) || '', 100);
    var element = cardState.element
      || ((window.BsConst || {}).CLASS_DEFAULT_ELEMENT || {})[cardState.cardClass]
      || 'chaos';

    var payload = {
      id: cardId,
      name: name,
      class: cls,
      characterClass: cls,
      avatar: cardState.artworkUrl || '',
      quote: quote,
      rarity: cardState.cardRarity || 'Common',
      element: element,
      combatStats: stats || { str: 60, agi: 60, int: 60, end: 60, lck: 60 },
      cardData: {
        name: name,
        characterClass: cls,
        rarity: cardState.cardRarity || 'Common',
        avatar: cardState.artworkUrl || '',
        palette: 'earth',
        imageContainer: cardState.imageContainer || 'masked',
        element: element,
        combatStats: stats || { str: 60, agi: 60, int: 60, end: 60, lck: 60 },
        quote: quote,
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
      var msg = errData.error || ('Save failed: ' + resp.status);
      if (Array.isArray(errData.validationErrors) && errData.validationErrors.length) {
        msg += ' — ' + errData.validationErrors.join('; ');
      }
      throw new Error(msg);
    }

    return cardId;
  }

  return { save: save };
})();
