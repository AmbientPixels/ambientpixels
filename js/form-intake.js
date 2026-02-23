/**
 * CHANGE SUMMARY
 * - New file: GridOS Form Intake client-side submit helper v1
 * - Binds to forms with data-gridos-intake="true"
 * - Tracks form_started_at_ms on first focus/input
 * - Builds structured payload and POSTs JSON to /api/formIntake
 * - Inline status feedback (success / error / rate limited)
 * - UTM extraction from query string
 * - Works on public pages (uses AP_API_BASE if available, else direct URL)
 */

(function () {
  'use strict';

  // ── API URL resolution ──
  var API_URL = (window.AP_API_BASE || 'https://ambientpixels-nova-api.azurewebsites.net/api') + '/formIntake';

  // Localhost dev override
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    API_URL = (window.AP_API_BASE || 'http://localhost:7071/api') + '/formIntake';
  }

  // ── UTM extraction ──
  function getUtmParams() {
    var params = new URLSearchParams(window.location.search);
    var utm = {};
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    var hasAny = false;
    keys.forEach(function (k) {
      var val = params.get(k) || '';
      if (val) { utm[k.replace('utm_', '')] = val; hasAny = true; }
    });
    return hasAny ? utm : null;
  }

  // ── Init forms ──
  function initIntakeForms() {
    var forms = document.querySelectorAll('[data-gridos-intake="true"]');
    forms.forEach(function (form) {
      if (form._gridosIntakeInit) return;
      form._gridosIntakeInit = true;

      // Track form_started_at_ms on first interaction
      var startedInput = form.querySelector('input[name="form_started_at_ms"]');
      if (!startedInput) {
        startedInput = document.createElement('input');
        startedInput.type = 'hidden';
        startedInput.name = 'form_started_at_ms';
        form.appendChild(startedInput);
      }

      var tracked = false;
      function trackStart() {
        if (tracked) return;
        tracked = true;
        startedInput.value = Date.now().toString();
      }
      form.addEventListener('focusin', trackStart);
      form.addEventListener('input', trackStart);

      // Ensure honeypot field exists
      var hpInput = form.querySelector('input[name="hp"]');
      if (!hpInput) {
        hpInput = document.createElement('input');
        hpInput.type = 'text';
        hpInput.name = 'hp';
        hpInput.tabIndex = -1;
        hpInput.autocomplete = 'off';
        hpInput.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
        form.appendChild(hpInput);
      }

      // Ensure status element exists
      var statusEl = form.querySelector('.form-status');
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.className = 'form-status';
        form.appendChild(statusEl);
      }

      // Submit handler
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        handleIntakeSubmit(form, statusEl);
      });
    });
  }

  // ── Build payload from form ──
  function buildPayload(form) {
    var get = function (name) {
      var el = form.querySelector('[name="' + name + '"]');
      return el ? (el.value || '').trim() : '';
    };
    var getChecked = function (name) {
      var el = form.querySelector('[name="' + name + '"]');
      return el ? el.checked : false;
    };

    var payload = {
      type: get('type') || 'contact',
      pageUrl: window.location.href,
      referrer: document.referrer || '',
      utm: getUtmParams(),
      contact: {
        name: get('name'),
        email: get('email'),
        company: get('company'),
        role: get('role')
      },
      message: {
        subject: get('subject') || get('project-type') || get('project_type') || '',
        body: get('message') || get('body') || get('description') || ''
      },
      consent: {
        privacyAccepted: getChecked('privacyAccepted') || get('privacyAccepted') === 'true',
        newsletterOptIn: getChecked('newsletterOptIn') || get('newsletterOptIn') === 'true'
      },
      hp: get('hp'),
      form_started_at_ms: parseInt(get('form_started_at_ms')) || null
    };

    // Collect extra structured fields (timeline, budget, etc.) and append to body
    var extraFields = ['timeline', 'budget_range', 'budget-range', '_source'];
    var extras = [];
    extraFields.forEach(function (n) {
      var v = get(n);
      if (v) extras.push(n.replace(/_/g, ' ') + ': ' + v);
    });
    if (extras.length && payload.message) {
      payload.message.body += (payload.message.body ? '\n\n' : '') + '--- Additional ---\n' + extras.join('\n');
    }

    return payload;
  }

  // ── Submit handler ──
  async function handleIntakeSubmit(form, statusEl) {
    var submitBtn = form.querySelector('button[type="submit"]');
    var originalBtnHTML = submitBtn ? submitBtn.innerHTML : '';

    // Disable + loading state
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    }
    statusEl.textContent = '';
    statusEl.className = 'form-status';

    try {
      var payload = buildPayload(form);

      var response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
      });

      var data = null;
      try { data = await response.json(); } catch (e) { /* non-json response */ }

      if (response.ok && data && data.ok) {
        statusEl.textContent = 'Thanks \u2014 we received your message.';
        statusEl.className = 'form-status success';
        form.reset();

        // Close modal if inside one
        var modal = form.closest('.modal');
        if (modal) {
          setTimeout(function () {
            if (typeof window.closeModal === 'function') window.closeModal(modal.id);
            setTimeout(function () {
              statusEl.textContent = '';
              statusEl.className = 'form-status';
            }, 300);
          }, 2000);
        }
      } else if (response.status === 429) {
        statusEl.textContent = 'Please wait a moment and try again.';
        statusEl.className = 'form-status error';
      } else if (response.status === 400 && data && data.details) {
        statusEl.textContent = 'Please check your form: ' + data.details.join(', ');
        statusEl.className = 'form-status error';
      } else {
        statusEl.textContent = 'Something went wrong. Please try again or email directly.';
        statusEl.className = 'form-status error';
      }
    } catch (err) {
      console.error('[form-intake] Submit error:', err);
      statusEl.textContent = 'Connection error. Please try again.';
      statusEl.className = 'form-status error';
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHTML;
      }
      if (statusEl) {
        statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  // ── Auto-init on DOM ready + expose for dynamic content ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initIntakeForms);
  } else {
    initIntakeForms();
  }
  window.initIntakeForms = initIntakeForms;

})();
