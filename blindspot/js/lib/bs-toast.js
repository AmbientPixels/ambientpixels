/**
 * Blindspot Toast Notifications
 *
 * Minimal toast system — shows a message, auto-dismisses after 3s.
 * API: window.BsToast.show(msg, type), .error(msg), .success(msg)
 */
window.BsToast = (function () {
  'use strict';

  function show(message, type) {
    var existing = document.querySelector('.bs-toast');
    if (existing) {
      existing.classList.remove('bs-toast--visible');
      setTimeout(function () { if (existing.parentNode) existing.remove(); }, 500);
    }

    var toast = document.createElement('div');
    toast.className = 'bs-toast bs-toast--' + type;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () { toast.classList.add('bs-toast--visible'); }, 20);
    setTimeout(function () {
      toast.classList.remove('bs-toast--visible');
      setTimeout(function () { if (toast.parentNode) toast.remove(); }, 500);
    }, 3000);
  }

  return {
    show: show,
    error: function (msg) { show(msg, 'error'); },
    success: function (msg) { show(msg, 'success'); }
  };
})();
