/* ═══════════════════════════════════════════════════════════
   AP API Configuration
   Base URL detection, authentication header helpers.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function base() {
    var h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') {
      return window.AP_API_BASE || 'http://localhost:7071/api';
    }
    if (h.indexOf('ambientpixels.ai') !== -1) {
      return 'https://ambientpixels-nova-api.azurewebsites.net/api';
    }
    return '/api';
  }

  function secretHeaders() {
    var headers = {};
    try {
      if (typeof CompanyStore !== 'undefined' && CompanyStore.getWriteHeaders) {
        headers = CompanyStore.getWriteHeaders() || {};
      }
    } catch (e) { /* ignore */ }
    try {
      if (!headers['x-company-secret']) {
        var key = sessionStorage.getItem('ap_server_key') || '';
        if (key) headers['x-company-secret'] = key;
      }
    } catch (e2) { /* ignore */ }
    return headers;
  }

  function keyHeaders() {
    var headers = {};
    var key = '';
    if (window._config && window._config.ambientosInternalKey) {
      key = window._config.ambientosInternalKey;
    } else if (typeof CompanyStore !== 'undefined' && CompanyStore.getWriteKey) {
      key = CompanyStore.getWriteKey() || '';
    }
    if (key) headers['X-AmbientOS-Key'] = key;
    return headers;
  }

  window.APApi = { base: base, secretHeaders: secretHeaders, keyHeaders: keyHeaders };
})();
