/**
 * Blindspot Utilities — minimal subset of UIUtils and ValidationUtils
 * Only the functions Blindspot actually calls.
 */

window.UIUtils = window.UIUtils || {};

window.UIUtils.escapeHtml = function (str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
};

window.UIUtils.showConfirmDialog = function (title, message, onConfirm, onCancel) {
  if (window.confirm(title + '\n\n' + message)) {
    if (onConfirm) onConfirm();
  } else {
    if (onCancel) onCancel();
  }
};

window.ValidationUtils = window.ValidationUtils || {};

window.ValidationUtils.isValidUrl = function (url) {
  if (!url || typeof url !== 'string') return false;
  try {
    var u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
};

window.ValidationUtils.isValidImageUrl = function (url) {
  if (!window.ValidationUtils.isValidUrl(url)) return false;
  return /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?.*)?$/i.test(url);
};

window.ValidationUtils.sanitizeString = function (input) {
  if (!input || typeof input !== 'string') return '';
  return input.replace(/[<>"'&]/g, function (c) {
    return { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '&': '&amp;' }[c];
  });
};
