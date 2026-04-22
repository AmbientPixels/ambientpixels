// strategy.js — AmbientScore strategy intake form
// Collects lead info + CC audit context, POSTs to /api/formIntake

(function () {
  'use strict';

  if (window.ProductAnalytics) ProductAnalytics.init('ambientscore');

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

    if (window.ProductAnalytics) ProductAnalytics.trackFunnel('strategy_submitted', { reportId: qReportId, score: qScore, primaryGoal: primaryGoal });
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting.';

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
            var hEl = header.querySelector('h1');
            var pEl = header.querySelector('p');
            if (hEl) hEl.innerHTML = 'Request <em>received.</em>';
            if (pEl) pEl.textContent = '';
          }

          var localScoreNum = parseFloat(qScore);
          var hasScore = !isNaN(localScoreNum);
          var msg = '';
          msg += '<p style="font-family:var(--serif);font-size:18px;line-height:1.5;color:var(--ink);margin-bottom:16px;">';
          msg += 'Thanks. We are reviewing your audit';
          if (hasScore) msg += ' (score ' + Math.round(localScoreNum) + ')';
          msg += ' and will propose two to three strategy times within 24 hours.';
          msg += '</p>';

          if (hasScore) {
            if (localScoreNum < 60) {
              msg += '<p style="font-family:var(--serif);font-style:italic;font-size:15px;color:var(--ink-soft);margin-bottom:16px;">Based on your audit, there are high-impact improvements available.</p>';
            } else if (localScoreNum >= 70) {
              msg += '<p style="font-family:var(--serif);font-style:italic;font-size:15px;color:var(--ink-soft);margin-bottom:16px;">Strong foundation. We will focus on optimization and lift.</p>';
            }
          }

          msg += '<div style="margin-top:18px;padding-top:18px;border-top:1px dotted var(--rule);">';
          msg += '<div style="font-family:var(--mono);font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--stamp);font-weight:600;margin-bottom:12px;">What happens next</div>';
          msg += '<ul style="list-style:none;padding:0;margin:0;font-family:var(--serif);font-size:15px;color:var(--ink-soft);line-height:1.7;">';
          msg += '<li style="padding-left:20px;position:relative;"><span style="position:absolute;left:0;top:0;color:var(--stamp);font-weight:600;">›</span>We review your report in detail</li>';
          msg += '<li style="padding-left:20px;position:relative;"><span style="position:absolute;left:0;top:0;color:var(--stamp);font-weight:600;">›</span>We outline a focused improvement roadmap</li>';
          msg += '<li style="padding-left:20px;position:relative;"><span style="position:absolute;left:0;top:0;color:var(--stamp);font-weight:600;">›</span>We propose two to three time options</li>';
          msg += '<li style="padding-left:20px;position:relative;"><span style="position:absolute;left:0;top:0;color:var(--stamp);font-weight:600;">›</span>You confirm and we finalize</li>';
          msg += '</ul>';
          msg += '</div>';

          if (qReportId) {
            msg += '<div style="margin-top:22px;"><a href="/ambientscore/report.html?id=' + encodeURIComponent(qReportId) + '" class="as-buy-btn" style="display:inline-block;text-decoration:none;border-right:1px solid var(--ink);">View your audit report</a></div>';
          }
          statusEl.innerHTML = msg;
          statusEl.className = 'as-form-status as-success';
        } else {
          throw new Error(data.error || 'unknown');
        }
      })
      .catch(function (err) {
        if (window.ProductAnalytics) ProductAnalytics.trackError('strategy_failed', { error: err.message });
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
