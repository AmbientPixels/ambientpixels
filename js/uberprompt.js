/* /js/uberprompt.js — Uber Prompt Codex tab controller */
(function () {
  var tabs = document.querySelectorAll('.up-tab');
  var panels = document.querySelectorAll('.up-panel');
  if (!tabs.length || !panels.length) return;

  function activate(id) {
    tabs.forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === id);
      t.setAttribute('aria-selected', t.getAttribute('data-tab') === id ? 'true' : 'false');
    });
    panels.forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + id);
    });
    history.replaceState(null, '', '#' + id);
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      activate(this.getAttribute('data-tab'));
    });
  });

  // Activate from hash or default to first tab
  var hash = location.hash.replace('#', '');
  var valid = Array.prototype.some.call(tabs, function (t) {
    return t.getAttribute('data-tab') === hash;
  });
  activate(valid ? hash : tabs[0].getAttribute('data-tab'));
})();
