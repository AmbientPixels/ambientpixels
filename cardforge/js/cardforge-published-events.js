/**
 * CardForge — shared utilities for the "My Published" tabs.
 *
 * Exports two globals:
 *   window.CardForgePublished.EVENT  — custom event name
 *   window.CardForgePublished.getMyUserId() — async, returns userId or null
 *
 * Loaded by editor.html and deck.html. Safe to load twice (idempotent).
 */
(function () {
  'use strict';
  if (window.CardForgePublished) return;

  var EVENT_NAME = 'cardforge:my-published-changed';

  async function getMyUserId() {
    try {
      if (typeof window._cfGetAuthHeaders !== 'function') return null;
      var headers = await window._cfGetAuthHeaders();
      var json = headers && headers['X-CF-Auth-Principal'];
      if (!json) return null;
      var p = JSON.parse(json);
      return (p && p.userId) || null;
    } catch (_) { return null; }
  }

  function notifyChanged(detail) {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: detail || {} }));
    } catch (_) {}
  }

  window.CardForgePublished = {
    EVENT: EVENT_NAME,
    getMyUserId: getMyUserId,
    notifyChanged: notifyChanged
  };
})();
