/**
 * Blindspot Lobby Gallery — "Hall of Fighters" horizontal carousel
 *
 * Renders a strip of recently-published community cards in the lobby.
 * Auto-scrolls, pauses on hover/focus/touch, opens a preview modal on click.
 *
 * API: window.BsLobbyGallery
 *   .init()         — fetch + render + start auto-scroll (idempotent)
 *   .refresh()      — re-fetch and re-render
 *   .openModal(s)   — open preview modal for a slide
 */
window.BsLobbyGallery = (function () {
  'use strict';

  var ENDPOINT_KEY = 'heroSlim';
  var FETCH_COUNT = 10;
  var MIN_CARDS_TO_SHOW = 3;
  var POINTER_RESUME_MS = 4000;

  var _section = null;
  var _strip = null;
  var _modal = null;
  var _modalCard = null;
  var _modalCreator = null;
  var _modalClose = null;
  var _lastFocus = null;
  var _resumeTimer = null;
  var _initialized = false;
  var _slides = [];
  var _rtf = null; // Lazy Intl.RelativeTimeFormat

  function init() {
    if (_initialized) return;
    _initialized = true;
    _section = document.getElementById('bs-lobby-gallery');
    _strip = document.getElementById('bs-lobby-gallery-strip');
    _modal = document.getElementById('bs-gallery-modal');
    _modalCard = document.getElementById('bs-gallery-modal-card');
    _modalCreator = document.getElementById('bs-gallery-modal-creator');
    _modalClose = _modal && _modal.querySelector('.bs-gallery-modal__close');
    if (!_section || !_strip) return;
    _wireModal();
    _wirePointer();
    fetchAndRender();
  }

  function refresh() { fetchAndRender(); }

  function fetchAndRender() { /* Task 4 */ }
  function _renderStrip(slides) { /* Task 4 */ }
  function _renderTile(slide) { /* Task 4 */ }
  function openModal(slide) { /* Task 7 */ }
  function _closeModal() { /* Task 7 */ }
  function _wireModal() { /* Task 7 */ }
  function _wirePointer() { /* Task 8 */ }

  return { init: init, refresh: refresh, openModal: openModal };
})();
