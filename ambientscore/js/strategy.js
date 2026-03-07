// strategy.js — AmbientScore strategy intake form
// Collects lead info + CC audit context, POSTs to /api/formIntake

(function () {
  'use strict';

  var API = window.location.hostname === 'localhost'
    ? '/api/formIntake'
    : 'https://ambientpixels-nova-api.azurewebsites.net/api/formIntake';

  var form = document.getElementById('as-strategy-form');
  var statusEl = document.getElementById('as-form-status');
  var submitBtn = document.getElementById('as-submit-btn');

  if (!form) return;

  // ── Parse query params and prefill ──────────────
  var params = new URLSearchParams(window.location.search);
  var qReportId = params.get('reportId') || '';
  var qUrl = params.get('url') || '';
  var qScore = params.get('score') || '';
  var qSiteType = params.get('siteType') || '';

  document.getElementById('as-reportId').value = qReportId;
  document.getElementById('as-score').value = qScore;
  document.getElementById('as-siteType').value = qSiteType;
  if (qUrl) document.getElementById('as-website').value = qUrl;

  // ── Track form interaction time ─────────────────
  var formStartedAt = null;
  form.addEventListener('focusin', function () {
    if (!formStartedAt) formStartedAt = Date.now();
  }, { once: true });

  // ── UTM extraction ──────────────────────────────
  function extractUtm() {
    var u = {};
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    var hasAny = false;
    keys.forEach(function (k) {
      var v = params.get(k) || '';
      var short = k.replace('utm_', '');
      u[short] = v;
      if (v) hasAny = true;
    });
    return hasAny ? u : null;
  }

  // ── Submit handler ──────────────────────────────
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    statusEl.textContent = '';
    statusEl.className = 'as-form-status';

    var name = form.elements.name.value.trim();
    var email = form.elements.email.value.trim();
    var company = form.elements.company.value.trim();
    var website = form.elements.website.value.trim();
    var primaryGoal = form.elements.primaryGoal.value;
    var monthlyTraffic = form.elements.monthlyTraffic.value;
    var budgetRange = form.elements.budgetRange.value;
    var timeline = form.elements.timeline.value;
    var notes = form.elements.notes.value.trim();
    var privacyAccepted = form.elements.privacyAccepted.checked;
    var hp = form.elements.hp.value;

    // Client-side validation
    if (!name || !email || !company || !website || !primaryGoal || !monthlyTraffic) {
      statusEl.textContent = 'Please fill in all required fields.';
      statusEl.className = 'as-form-status as-error';
      return;
    }
    if (!privacyAccepted) {
      statusEl.textContent = 'Please accept the privacy policy.';
      statusEl.className = 'as-form-status as-error';
      return;
    }

    var scoreNum = parseFloat(qScore);
    var payload = {
      type: 'ambientscore_strategy',
      pageUrl: window.location.href,
      referrer: document.referrer || '',
      utm: extractUtm(),
      contact: {
        name: name,
        email: email,
        company: company,
        role: ''
      },
      message: {
        subject: 'AmbientScore Strategy Intake',
        body: notes || ''
      },
      consent: {
        privacyAccepted: true,
        newsletterOptIn: false
      },
      ambientscore: {
        reportId: qReportId,
        score: isNaN(scoreNum) ? null : scoreNum,
        siteType: qSiteType,
        url: website,
        primaryGoal: primaryGoal,
        monthlyTraffic: monthlyTraffic,
        budgetRange: budgetRange,
        timeline: timeline
      },
      hp: hp,
      form_started_at_ms: formStartedAt || Date.now()
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('status_' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data.ok) {
          form.style.display = 'none';
          var header = document.querySelector('.as-strategy-header');
          if (header) {
            header.querySelector('h1').textContent = 'Request Received';
            header.querySelector('p').textContent = '';
          }

          // Score-aware confirmation
          var scoreNum = parseFloat(qScore);
          var hasScore = !isNaN(scoreNum);
          var msg = 'Thanks \u2014 we\'re reviewing your audit';
          if (hasScore) msg += ' (Score: ' + Math.round(scoreNum) + ')';
          msg += ' and will propose strategy times within 24 hours.';

          // Dynamic messaging based on score
          if (hasScore) {
            if (scoreNum < 60) {
              msg += '<p style="margin-top:16px;font-size:13px;color:var(--as-text-secondary);">Based on your audit, there are high-impact improvements available.</p>';
            } else if (scoreNum >= 70) {
              msg += '<p style="margin-top:16px;font-size:13px;color:var(--as-text-secondary);">Strong foundation \u2014 we\'ll focus on optimization and lift.</p>';
            }
          }

          // What happens next
          msg += '<div style="margin-top:24px;text-align:left;max-width:400px;margin-left:auto;margin-right:auto;font-size:13px;color:var(--as-text-secondary);line-height:1.8;">';
          msg += '<strong style="color:var(--as-text);">What happens next:</strong><br>';
          msg += '\u2022 We review your report in detail<br>';
          msg += '\u2022 We outline a focused improvement roadmap<br>';
          msg += '\u2022 We propose 2\u20133 time options<br>';
          msg += '\u2022 You confirm and we finalize';
          msg += '</div>';

          // CTA back to report
          if (qReportId) {
            msg += '<br><a href="/ambientscore/report.html?id=' + encodeURIComponent(qReportId) + '" class="as-buy-btn" style="display:inline-block;margin-top:8px;text-decoration:none;">View Your Audit Report</a>';
          }
          statusEl.innerHTML = msg;
          statusEl.className = 'as-form-status as-success';
        } else {
          throw new Error(data.error || 'unknown');
        }
      })
      .catch(function (err) {
        var msg = 'Something went wrong. Please try again.';
        if (err.message === 'status_429') msg = 'Too many submissions. Please try again later.';
        if (err.message === 'status_400') msg = 'Please check your form fields and try again.';
        statusEl.textContent = msg;
        statusEl.className = 'as-form-status as-error';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Request Strategy Session';
      });
  });
})();
