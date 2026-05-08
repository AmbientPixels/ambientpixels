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
   * @param {boolean} [wantsPublished=true] - Publish to public gallery on save
   * @returns {Promise<string>} The saved card's ID
   */
  async function save(cardState, stats, wantsPublished) {
    if (typeof wantsPublished === 'undefined') wantsPublished = true;
    var url = window.buildApiPath('saveCard');
    if (!url) throw new Error('saveCard endpoint not configured');

    var authHeaders = await window.ArenaAPI.getPrincipalHeader();

    var cardId = 'bs-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);

    // Anonymous (guest) saves never hit the server — every anon write would
    // land in the shared user/anonymous/cards.json blob. The card lives in
    // localStorage (bs-deck) until the player signs in; the post-login
    // pending-save path in initPlay then persists it under their real userId.
    // wantsPublished is preserved on the deck entry so persistPending can
    // honour the choice once the player authenticates.
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
      publishedToGallery: !!wantsPublished,
      // Top-level imageContainer is what the renderer actually reads via
      // card.imageContainer in its lookup chain. cardData.imageContainer
      // (below) is unreachable — the renderer only checks cardData.design.*,
      // not flat fields under cardData. Without this top-level mirror,
      // every Quick Build card defaults to masked/Portrait regardless of
      // the chosen image style.
      imageContainer: cardState.imageContainer || 'masked',
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

    if (wantsPublished) {
      await _publishToGallery(cardId, payload, headers);
    }

    return cardId;
  }

  /**
   * Mirror the Forge gallery-sync pattern: POST to cardforgepublish with the
   * card payload so it lands in published-cards.json. Best-effort — failures
   * are logged but do NOT bubble up; the user blob save already succeeded.
   * X-CF-Auth-Principal doesn't survive cross-origin so we read userId from
   * /.auth/me, mirroring bs-forge.js:879-901.
   */
  async function _publishToGallery(cardId, cardPayload, headers) {
    try {
      var pubUrl = window.buildApiPath('publish');
      if (!pubUrl) return;
      var meResp = await fetch('/.auth/me').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
      var bodyUserId = (meResp && meResp.clientPrincipal && meResp.clientPrincipal.userId) || 'anonymous';
      if (bodyUserId === 'anonymous') return;
      var pubBody = { cardId: cardId, userId: bodyUserId, cardData: cardPayload };
      var pubResp = await fetch(pubUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(pubBody),
        credentials: 'include'
      });
      if (!pubResp.ok) {
        var errText = await pubResp.text().catch(function () { return ''; });
        console.warn('[BlindspotSaveCard] Gallery sync failed: ' + pubResp.status + ' ' + errText);
      }
    } catch (pubErr) {
      console.warn('[BlindspotSaveCard] Gallery sync failed (non-fatal):', pubErr);
    }
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
    // Guest pre-auth saves can't publish (no userId). Their original publish
    // intent rides along on the deck entry; respect it now that they're authed.
    // Default true so anyone whose deck pre-dates this field still gets shared.
    var wantsPublished = (typeof card.publishedToGallery === 'boolean')
      ? card.publishedToGallery
      : (typeof nested.publishedToGallery === 'boolean' ? nested.publishedToGallery : true);

    var payload = {
      id: card.id,
      name: name,
      class: cls,
      characterClass: cls,
      avatar: avatar,
      quote: quote,
      rarity: rarity,
      element: element,
      publishedToGallery: !!wantsPublished,
      // Top-level mirror — see save() for the why.
      imageContainer: imageContainer,
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

    if (wantsPublished) {
      await _publishToGallery(card.id, payload, headers);
    }

    return card.id;
  }

  return { save: save, persistPending: persistPending };
})();
