// ── APMode — UI Mode Manager ──
// Provides mode-based access control: executive, operator, admin.
// Automatically available via sidebar.js on all company pages.
// This standalone file is for pages that don't load sidebar.js.
(function () {
  'use strict';
  if (window.APMode) return; // already loaded via sidebar.js
  var MODES = ['executive', 'operator', 'admin'];
  var KEY = 'ap_ui_mode';
  window.APMode = {
    MODES: MODES,
    get: function () { return localStorage.getItem(KEY) || 'executive'; },
    set: function (mode) {
      if (MODES.indexOf(mode) === -1) return;
      localStorage.setItem(KEY, mode);
      window.dispatchEvent(new CustomEvent('ap-mode-change', { detail: { mode: mode } }));
    },
    atLeast: function (required) {
      var current = this.get();
      return MODES.indexOf(current) >= MODES.indexOf(required);
    },
    cycle: function () {
      var idx = MODES.indexOf(this.get());
      var next = MODES[(idx + 1) % MODES.length];
      this.set(next);
      return next;
    }
  };
})();
