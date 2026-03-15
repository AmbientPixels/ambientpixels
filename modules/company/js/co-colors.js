// AmbientOS v1.1 — Shared status color constants
// Values mirror CSS tokens in company.css exactly.
// Include on any company page that renders dynamic status colors in JS.

(function () {
  'use strict';

  window.CO_COLORS = {
    green:  '#34d399',   // --c-green  on-track / done / success
    amber:  '#fbbf24',   // --c-amber  at-risk / pending / warning
    red:    '#ef4444',   // --c-red    blocked / error / danger
    blue:   '#60a5fa',   // --c-blue   in-progress / info / active
    purple: '#a78bfa',   // --c-purple complete / special
    gray:   '#9ca3af',   // neutral / canceled

    // Returns the semantic color for a task/objective status string
    forStatus: function (status) {
      var map = {
        on_track:    this.green,
        done:        this.green,
        complete:    this.purple,
        canceled:    this.gray,
        at_risk:     this.amber,
        stale:       this.amber,
        pending:     this.amber,
        behind:      this.red,
        blocked:     this.red,
        'in-progress': this.blue,
        in_progress: this.blue,
        review:      this.blue,
        active:      this.blue,
      };
      return map[status] || 'rgba(255,255,255,0.55)';
    },

    // Returns bar/progress color for a health signal string
    forHealth: function (health) {
      if (health === 'good') return this.green;
      if (health === 'warn') return this.amber;
      if (health === 'bad')  return this.red;
      return '#64748b';
    }
  };
})();
