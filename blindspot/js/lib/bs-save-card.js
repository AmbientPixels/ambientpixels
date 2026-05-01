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

    // Anonymous (guest) saves never hit the server — every anon write would
    // land in the shared user/anonymous/cards.json blob. The card lives in
    // localStorage (bs-deck) until the player signs in; the post-login
    // pending-save path in initPlay then persists it under their real userId.
    if (!authHeaders || !authHeaders['X-CF-Auth-Principal']) {
      return cardId;
    }

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

  /**
   * Persist a previously-cached card (built locally as a guest) to the
   * server now that the player is authenticated. Accepts the same shape
   * stored in localStorage `bs-deck`. Reuses the existing card id so the
   * deck entry already in localStorage remains the source of truth.
   * @param {object} card - Card data from bs-deck cache
   * @returns {Promise<string>} The persisted card's ID
   */
  async function persistPending(card) {
    if (!card || !card.id) throw new Error('persistPending: missing card or id');
    var url = window.buildApiPath('saveCard');
    if (!url) throw new Error('saveCard endpoint not configured');

    var authHeaders = await window.ArenaAPI.getPrincipalHeader();
    if (!authHeaders || !authHeaders['X-CF-Auth-Principal']) {
      throw new Error('persistPending: not authenticated');
    }

    function clip(s, max) {
      if (!s) return '';
      var t = String(s).trim();
      return t.length > max ? t.slice(0, max) : t;
    }

    var nested = card.cardData || {};
    var name = clip(card.name || nested.name, 30) || 'Unknown';
    var cls = clip(card.class || card.characterClass || nested.characterClass, 20) || 'Fighter';
    var quote = clip(card.quote || nested.quote || '', 100);
    var rarity = card.rarity || nested.rarity || 'Common';
    var avatar = card.avatar || nested.avatar || '';
    var element = card.element || nested.element
      || ((window.BsConst || {}).CLASS_DEFAULT_ELEMENT || {})[cls]
      || 'chaos';
    var stats = card.combatStats || nested.combatStats || { str: 60, agi: 60, int: 60, end: 60, lck: 60 };
    var imageContainer = nested.imageContainer || card.imageContainer || 'masked';

    var payload = {
      id: card.id,
      name: name,
      class: cls,
      characterClass: cls,
      avatar: avatar,
      quote: quote,
      rarity: rarity,
      element: element,
      combatStats: stats,
      cardData: {
        name: name,
        characterClass: cls,
        rarity: rarity,
        avatar: avatar,
        palette: nested.palette || 'earth',
        imageContainer: imageContainer,
        element: element,
        combatStats: stats,
        quote: quote,
        biography: nested.biography || ''
      }
    };

    var headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders);
    var csrfMeta = document.querySelector('meta[name="csrf-token"]');
    if (csrfMeta && csrfMeta.content) headers['X-CSRF-Token'] = csrfMeta.content;

    var resp = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(payload) });
    if (!resp.ok) {
      var errData;
      try { errData = await resp.json(); } catch (e) { errData = {}; }
      var msg = errData.error || ('Save failed: ' + resp.status);
      if (Array.isArray(errData.validationErrors) && errData.validationErrors.length) {
        msg += ' — ' + errData.validationErrors.join('; ');
      }
      throw new Error(msg);
    }
    return card.id;
  }

  return { save: save, persistPending: persistPending };
})();
