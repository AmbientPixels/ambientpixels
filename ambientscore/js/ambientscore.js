// ambientscore.js — Landing page logic
// Handles: URL scan, results display, Stripe checkout redirect

(function () {
  'use strict';

  if (window.ProductAnalytics) ProductAnalytics.init('ambientscore');

  // Keep the "Filed Qn YYYY" hero stamp current so it never dates itself.
  (function setFiledStamp() {
    var el = document.getElementById('as-filed-stamp');
    if (!el) return;
    var d = new Date();
    var quarter = Math.floor(d.getMonth() / 3) + 1;
    el.textContent = 'Filed Q' + quarter + ' ' + d.getFullYear() + ' . Confidential';
  })();

  var API = window.location.hostname === 'localhost'
    ? '/api'
    : 'https://ambientpixels-nova-api.azurewebsites.net/api';
  var currentReportId = null;
  var currentUrl = null;

  // DOM refs
  var form = document.getElementById('as-scan-form');
  var urlInput = document.getElementById('as-url-input');
  var scanBtn = document.getElementById('as-scan-btn');
  var loadingSection = document.getElementById('as-loading');
  var loadingText = document.getElementById('as-loading-text');
  var errorSection = document.getElementById('as-error');
  var errorText = document.getElementById('as-error-text');
  var resultsSection = document.getElementById('as-results');
  var scoreGauge = document.getElementById('as-score-gauge');
  var gradeEl = document.getElementById('as-grade');
  var reportUrlLabel = document.getElementById('as-report-url-label');
  var refIdEl = document.getElementById('as-ref-id');
  var refDateEl = document.getElementById('as-ref-date');
  var jsWarning = document.getElementById('as-js-warning');
  var partialWarning = document.getElementById('as-partial-warning');
  var contentWarning = document.getElementById('as-content-warning');
  var dimsEvaluated = document.getElementById('as-dims-evaluated');
  var findingsVisible = document.getElementById('as-findings-visible');
  var findingsBlurred = document.getElementById('as-findings-blurred');
  var blurredCount = document.getElementById('as-blurred-count');
  var upgradeSection = document.getElementById('as-upgrade');
  var buySingle = document.getElementById('as-buy-single');
  var buyPack = document.getElementById('as-buy-pack');

  // Loading step elements
  var steps = {
    fetch: document.getElementById('as-step-fetch'),
    extract: document.getElementById('as-step-extract'),
    evaluate: document.getElementById('as-step-evaluate'),
    score: document.getElementById('as-step-score')
  };

  var STEP_LABELS = {
    fetch: '01 Fetch',
    extract: '02 Extract',
    evaluate: '03 Evaluate',
    score: '04 Score'
  };

  // ── Loading Animation ──────────────────────────

  var loadingInterval = null;

  function setLoadingText(msg) {
    loadingText.innerHTML = '<span class="as-spinner"></span>' + escapeHtml(msg);
  }

  function startLoadingSteps() {
    var order = ['fetch', 'extract', 'evaluate', 'score'];
    var current = 0;
    var messages = [
      'Fetching your page.',
      'Extracting conversion elements.',
      'Evaluating eight dimensions.',
      'Computing score.'
    ];

    loadingInterval = setInterval(function () {
      if (current > 0) {
        var prev = order[current - 1];
        steps[prev].classList.remove('active');
        steps[prev].classList.add('done');
        steps[prev].textContent = STEP_LABELS[prev];
      }
      if (current < order.length) {
        steps[order[current]].classList.add('active');
        setLoadingText(messages[current]);
        current++;
      } else {
        clearInterval(loadingInterval);
      }
    }, 4000);
  }

  function stopLoadingSteps() {
    if (loadingInterval) clearInterval(loadingInterval);
    Object.keys(steps).forEach(function (k) {
      steps[k].classList.remove('active', 'done');
      steps[k].textContent = STEP_LABELS[k];
    });
  }

  // ── UI State Helpers ───────────────────────────

  function showLoading() {
    loadingSection.style.display = 'block';
    resultsSection.style.display = 'none';
    errorSection.style.display = 'none';
    scanBtn.disabled = true;
    scanBtn.textContent = 'Running.';
    setLoadingText('Fetching your page.');
    startLoadingSteps();
  }

  function hideLoading() {
    loadingSection.style.display = 'none';
    scanBtn.disabled = false;
    scanBtn.textContent = 'Run Audit';
    stopLoadingSteps();
  }

  var ERROR_MESSAGES = {
    SITE_BLOCKED: [
      "This site requires browser verification (bot protection), so we couldn't fetch the page content. Try a different URL.",
      "We couldn't scan this site because it blocks automated requests. Try the homepage URL or a different page (like /pricing).",
      "This site's security settings prevented our scan. If you control the site, allowlist our scanner. Or try another URL for now.",
      "Blocked by bot protection. We're working on improved coverage, but this URL can't be scanned right now."
    ],
    SITE_TIMEOUT: [
      "The site didn't respond before our timeout. Try again, or try the homepage URL.",
      "We couldn't get a response in time. The site may be slow or temporarily unavailable.",
      "Timed out waiting for the site to respond. Try again in a minute."
    ],
    SITE_UNREADABLE: [
      "We could not read enough of this page to score it. Its content is rendered by JavaScript after load, which our scanner does not execute yet. Scoring what we could see would tell you about our scanner, not your site.",
      "This page delivered almost no readable content to us, so there was nothing to audit. That usually means the content is drawn by JavaScript after the page loads. Try a page that renders its text server-side.",
      "Not enough readable content reached us to produce an honest score. Pages built as single-page apps often look empty to scanners. Try the homepage, or a page with server-rendered text."
    ],
    SITE_ERROR_STATUS: [
      "That URL returned an error page, not a real page, so there was nothing to audit. Check the address and try again.",
      "The site answered with an error for that address. Try the homepage URL, or check the link for a typo.",
      "We reached the site but that page does not exist. Scoring an error page would tell you nothing useful, so we stopped."
    ],
    ANALYSIS_FAILED: [
      "Something tripped up our analysis engine. Please try again.",
      "We hit an error while scoring this page. Try again. If it repeats, try a different URL.",
      "We couldn't complete the analysis this time. Please retry."
    ]
  };

  function _pick(pool) { return pool[Math.floor(Math.random() * pool.length)]; }

  function _baseUrl(url) {
    try { var u = new URL(url); return u.origin + '/'; } catch (e) { return ''; }
  }

  function friendlyError(raw, scannedUrl) {
    var code = '';
    try {
      var parsed = JSON.parse(raw);
      code = parsed.error || '';
    } catch (e) { code = raw; }

    var msg = '';
    if (code.indexOf('SITE_UNREADABLE') !== -1) {
      msg = _pick(ERROR_MESSAGES.SITE_UNREADABLE);
    } else if (code.indexOf('SITE_ERROR_STATUS') !== -1) {
      msg = _pick(ERROR_MESSAGES.SITE_ERROR_STATUS);
    } else if (code.indexOf('SITE_BLOCKED') !== -1 || code.indexOf('403') !== -1) {
      msg = _pick(ERROR_MESSAGES.SITE_BLOCKED);
    } else if (code.indexOf('SITE_TIMEOUT') !== -1 || code.indexOf('timeout') !== -1) {
      msg = _pick(ERROR_MESSAGES.SITE_TIMEOUT);
    } else if (code.indexOf('ANALYSIS_FAILED') !== -1 || code.indexOf('Analysis failed') !== -1) {
      msg = _pick(ERROR_MESSAGES.ANALYSIS_FAILED);
    } else {
      msg = raw || "Something went wrong. Please try again.";
    }

    if (scannedUrl && (code.indexOf('SITE_BLOCKED') !== -1 || code.indexOf('403') !== -1 || code.indexOf('SITE_ERROR_STATUS') !== -1)) {
      var base = _baseUrl(scannedUrl);
      if (base && base !== scannedUrl && base !== scannedUrl + '/') {
        msg += '\n\nTry scanning: ' + base;
      }
    }
    return msg;
  }

  function showError(msg) {
    hideLoading();
    errorSection.style.display = 'block';
    var parts = msg.split('\n\n');
    if (parts.length > 1) {
      errorText.innerHTML = escapeHtml(parts[0]) + '<br><small>' + escapeHtml(parts[1]) + '</small>';
    } else {
      errorText.textContent = msg;
    }
  }

  function hideError() {
    errorSection.style.display = 'none';
  }

  // ── Dimension code map (label → D-0X . CODE) ──

  var DIM_CODES = {
    'messaging clarity':  { code: 'D-01', short: 'MSG.CLR' },
    'cta strength':       { code: 'D-02', short: 'CTA.STR' },
    'trust signals':      { code: 'D-03', short: 'TRS.SIG' },
    'funnel friction':    { code: 'D-04', short: 'FNL.FRC' },
    'social proof':       { code: 'D-05', short: 'SOC.PRF' },
    'offer clarity':      { code: 'D-06', short: 'OFR.CLR' },
    'offer and pricing':  { code: 'D-06', short: 'OFR.CLR' },
    'content flow':       { code: 'D-07', short: 'CNT.FLW' },
    'continuity':         { code: 'D-07', short: 'CNT.FLW' },
    'conversion hierarchy': { code: 'D-07', short: 'CNT.FLW' },
    'risk reversal':      { code: 'D-08', short: 'RSK.REV' },
    'differentiation':    { code: 'D-08', short: 'RSK.REV' },
    'audience alignment': { code: 'D-01', short: 'MSG.CLR' },
    'quick-win fixes':    { code: 'D-08', short: 'RSK.REV' }
  };

  function dimCode(label) {
    if (!label) return { code: 'D--', short: '' };
    var key = String(label).toLowerCase().trim();
    return DIM_CODES[key] || { code: 'D--', short: '' };
  }

  // ── Render Results ─────────────────────────────

  function renderResults(data) {
    hideLoading();
    hideError();
    resultsSection.style.display = 'block';

    currentReportId = data.reportId;
    if (window.ProductAnalytics) ProductAnalytics.trackFunnel('scan_completed', { score: data.score, grade: data.grade, reportId: data.reportId });

    // Score + grade
    var score = data.score != null ? data.score : 0;
    scoreGauge.textContent = score;
    gradeEl.textContent = (data.grade || '-');

    // URL + ref
    var urlDisplay = data.url || currentUrl || 'Your site';
    try {
      var u = new URL(urlDisplay);
      urlDisplay = u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '');
    } catch (e) {}
    if (reportUrlLabel) reportUrlLabel.textContent = urlDisplay;

    var shortRef = (data.reportId || '').toString().slice(-6).toUpperCase() || '------';
    if (refIdEl) refIdEl.textContent = shortRef;
    if (refDateEl) refDateEl.textContent = formatDate(new Date());

    // Interpretation
    var interpEl = document.getElementById('as-score-interpretation');
    if (interpEl) interpEl.textContent = scoreInterpretation(score);

    // JS warning
    if (data.jsRenderedWarning) {
      jsWarning.style.display = 'block';
      jsWarning.textContent = data.jsRenderedWarning;
    } else {
      jsWarning.style.display = 'none';
    }

    // We audited a different page than the URL says.
    if (contentWarning) contentWarning.textContent = data.contentWarning || '';

    // Estimated-score disclaimer. The score above is partly a constant when this
    // is set, so it belongs next to the number, not only in the paid report.
    if (partialWarning) partialWarning.textContent = data.disclaimer || '';

    // Same correction as the report scorecard: count what was evaluated rather
    // than asserting all eight.
    if (dimsEvaluated && data.totalDimensions) {
      dimsEvaluated.textContent = data.partialDimensions
        ? (data.totalDimensions - data.partialDimensions) + ' of ' + data.totalDimensions + ' conversion dimensions evaluated'
        : data.totalDimensions + ' conversion dimensions evaluated';
    }

    // Visible findings (first 3)
    var teaser = data.teaserFindings || [];
    findingsVisible.innerHTML = '';
    if (teaser.length) {
      findingsVisible.style.display = 'block';
      teaser.forEach(function (f) {
        findingsVisible.innerHTML += buildFindingCard(f, false);
      });
    } else {
      findingsVisible.style.display = 'none';
    }

    // Blurred findings
    var blurred = (data.blurredCount || 0);
    findingsBlurred.innerHTML = '';
    if (blurred > 0) {
      findingsBlurred.style.display = 'block';
      var placeholders = Math.min(blurred, 2);
      for (var i = 0; i < placeholders; i++) {
        findingsBlurred.innerHTML += buildFindingCard({
          severity: i === 0 ? 'important' : 'minor',
          dimensionLabel: 'Locked',
          finding: 'This finding is available in the full report with detailed analysis and specific recommendations.',
          recommendation: 'Unlock the full report to see this recommendation.'
        }, true);
      }
      blurredCount.textContent = blurred;
      upgradeSection.style.display = 'block';
      var creditsRedeem = document.getElementById('as-credits-redeem');
      if (creditsRedeem) creditsRedeem.style.display = 'block';
    } else {
      findingsBlurred.style.display = 'none';
      upgradeSection.style.display = 'none';
    }

    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function formatDate(d) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function scoreInterpretation(score) {
    if (score >= 80) return 'Strong conversion health. Your site demonstrates deliberate optimization across key dimensions. Remaining opportunities are refinements, not structural gaps.';
    if (score >= 70) return 'Good foundation with clear upside. Core conversion elements are in place. Targeted improvements to messaging, CTAs, or trust signals can move the needle meaningfully.';
    if (score >= 60) return 'Workable but underoptimized. The conversion path functions, but several dimensions show room for deliberate CRO attention that could improve visitor-to-customer flow.';
    return 'Needs attention. Multiple conversion dimensions show structural gaps. Addressing messaging clarity, trust signals, or funnel friction would likely improve conversion rates.';
  }

  function buildFindingCard(f, isBlurred) {
    var dim = dimCode(f.dimensionLabel);
    var dimLine = isBlurred
      ? 'D-XX &middot; Locked'
      : (dim.code + ' &middot; ' + escapeHtml(dim.short || (f.dimensionLabel || '').toUpperCase()));
    var sev = (f.severity || 'minor').toLowerCase();
    var sevLabel = sev.charAt(0).toUpperCase() + sev.slice(1);
    var html = '<div class="as-finding-card' + (isBlurred ? ' blurred' : '') + '">';
    html += '<div class="as-finding-badges">';
    html += '<span class="as-finding-dim">' + dimLine + '</span>';
    html += '<span class="as-finding-severity ' + sev + '">Severity ' + escapeHtml(sevLabel) + '</span>';
    if (!isBlurred && f.estimatedImpact) {
      html += '<span class="as-finding-impact">Impact ' + escapeHtml(f.estimatedImpact) + '</span>';
    }
    html += '</div>';
    if (f.evidence && !isBlurred) {
      html += '<div class="as-finding-evidence">' + escapeHtml(f.evidence) + '</div>';
    }
    html += '<div class="as-finding-text">' + escapeHtml(f.finding || '') + '</div>';
    if (f.recommendation) {
      html += '<div class="as-finding-rec">' + escapeHtml(f.recommendation) + '</div>';
    }
    html += '</div>';
    return html;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ── Scan Handler ───────────────────────────────

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = urlInput.value.trim();
    if (!url) return;

    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
      urlInput.value = url;
    }

    currentUrl = url;
    if (window.ProductAnalytics) ProductAnalytics.trackFunnel('scan_started', { url: url });
    showLoading();

    fetch(API + '/as-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Analysis failed');
          return data;
        });
      })
      .then(renderResults)
      .catch(function (err) {
        if (window.ProductAnalytics) ProductAnalytics.trackError('scan_failed', { error: err.message || '' });
        showError(friendlyError(err.message || '', url));
      });
  });

  // ── Buy Handlers ───────────────────────────────

  function handleBuy(priceType) {
    if (!currentUrl || !currentReportId) return;
    if (window.ProductAnalytics) ProductAnalytics.trackConversion('checkout_started', { priceType: priceType, reportId: currentReportId });

    buySingle.disabled = true;
    buyPack.disabled = true;
    buySingle.textContent = 'Redirecting.';

    var _attr = (window.ProductAnalytics && ProductAnalytics.getAttribution) ? ProductAnalytics.getAttribution() : { utm_content: '', utm_source: '' };
    fetch(API + '/as-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentUrl,
        reportId: currentReportId,
        createCheckout: true,
        priceType: priceType,
        utm_content: _attr.utm_content,
        utm_source: _attr.utm_source
      })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        } else {
          throw new Error(data.error || 'Failed to create checkout session');
        }
      })
      .catch(function (err) {
        showError(err.message);
        buySingle.disabled = false;
        buyPack.disabled = false;
        buySingle.textContent = 'Unlock full report . $29';
      });
  }

  buySingle.addEventListener('click', function () { handleBuy('single'); });
  buyPack.addEventListener('click', function () { handleBuy('pack'); });

  // ── Credit Redemption ──────────────────────────

  var creditsCheckBtn = document.getElementById('as-credits-check-btn');
  var creditsEmailInput = document.getElementById('as-credits-email');
  var creditsStatus = document.getElementById('as-credits-status');

  if (creditsCheckBtn) {
    creditsCheckBtn.addEventListener('click', function () {
      var email = creditsEmailInput.value.trim();
      if (!email) return;

      creditsCheckBtn.disabled = true;
      creditsCheckBtn.textContent = 'Checking.';
      creditsStatus.innerHTML = '';

      fetch(API + '/as-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check', email: email })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          creditsCheckBtn.disabled = false;
          creditsCheckBtn.textContent = 'Use Credits';

          if (data.credits > 0) {
            creditsStatus.innerHTML =
              '<p class="as-credits-balance">You have <strong>' + data.credits + '</strong> credit' + (data.credits > 1 ? 's' : '') + ' remaining.</p>' +
              '<button class="as-buy-btn" id="as-credits-confirm" style="margin-top:12px;border-right:1px solid var(--ink);">Use 1 credit to unlock</button>';

            document.getElementById('as-credits-confirm').addEventListener('click', function () {
              this.disabled = true;
              this.textContent = 'Unlocking.';
              redeemCredit(email);
            });
          } else {
            creditsStatus.innerHTML = '<p class="as-credits-none">No credits found for this email.</p>';
          }
        })
        .catch(function () {
          creditsCheckBtn.disabled = false;
          creditsCheckBtn.textContent = 'Use Credits';
          creditsStatus.innerHTML = '<p class="as-credits-error">Could not check credits. Please try again.</p>';
        });
    });
  }

  function redeemCredit(email) {
    fetch(API + '/as-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'redeem', email: email, reportId: currentReportId })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok && data.reportUrl) {
          window.location.href = data.reportUrl;
        } else {
          creditsStatus.innerHTML = '<p class="as-credits-error">' + escapeHtml(data.error || 'Redemption failed.') + '</p>';
        }
      })
      .catch(function () {
        creditsStatus.innerHTML = '<p class="as-credits-error">Something went wrong. Please try again.</p>';
      });
  }

  // ── Email capture (free scorecard by email) ────

  var emailSendBtn = document.getElementById('as-email-send-btn');
  var emailInput = document.getElementById('as-email-input');
  var emailStatus = document.getElementById('as-email-status');

  if (emailSendBtn) {
    emailSendBtn.addEventListener('click', function () {
      var email = emailInput.value.trim();
      if (!email || !currentReportId) return;
      emailSendBtn.disabled = true;
      emailSendBtn.textContent = 'Sending.';
      emailStatus.innerHTML = '';

      var _attr = (window.ProductAnalytics && ProductAnalytics.getAttribution) ? ProductAnalytics.getAttribution() : { utm_content: '', utm_source: '' };
      if (window.ProductAnalytics) ProductAnalytics.trackConversion('email_captured', { reportId: currentReportId });
      fetch(API + '/as-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailReport: true,
          reportId: currentReportId,
          email: email,
          utm_content: _attr.utm_content,
          utm_source: _attr.utm_source
        })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          emailSendBtn.disabled = false;
          emailSendBtn.textContent = 'Email my scorecard';
          if (data.ok) {
            emailStatus.innerHTML = '<p class="as-credits-balance">Sent. Check your inbox for the scorecard and report link.</p>';
          } else {
            emailStatus.innerHTML = '<p class="as-credits-error">' + escapeHtml(data.error || 'Could not send. Please try again.') + '</p>';
          }
        })
        .catch(function () {
          emailSendBtn.disabled = false;
          emailSendBtn.textContent = 'Email my scorecard';
          emailStatus.innerHTML = '<p class="as-credits-error">Could not send. Please try again.</p>';
        });
    });
  }

  // ── Quiet CTA form (bottom of page) ──────────

  var qctaForm = document.getElementById('as-qcta-form');
  var qctaInput = document.getElementById('as-qcta-url-input');
  if (qctaForm && qctaInput) {
    qctaForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = qctaInput.value.trim();
      if (!v) return;
      urlInput.value = v;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
  }

  // ── Teardown commission form ($199 done-for-you) ──────────

  var tdForm = document.getElementById('as-td-form');
  if (tdForm) {
    tdForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var tdUrl = document.getElementById('as-td-url').value.trim();
      var tdEmail = document.getElementById('as-td-email').value.trim();
      var tdGoal = document.getElementById('as-td-goal').value.trim();
      var tdBtn = document.getElementById('as-td-submit');
      var tdStatus = document.getElementById('as-td-status');
      if (!tdUrl || !tdEmail) return;

      if (window.ProductAnalytics) ProductAnalytics.trackConversion('checkout_started', { priceType: 'teardown', from: 'landing' });
      tdBtn.disabled = true;
      tdBtn.textContent = 'Preparing your order.';
      tdStatus.textContent = '';

      var _attr = (window.ProductAnalytics && ProductAnalytics.getAttribution) ? ProductAnalytics.getAttribution() : { utm_content: '', utm_source: '' };
      fetch(API + '/as-teardown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'checkout',
          url: tdUrl,
          email: tdEmail,
          goal: tdGoal,
          utmContent: _attr.utm_content || '',
          utmSource: _attr.utm_source || ''
        })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (res.ok && res.data.checkoutUrl) {
            window.location.href = res.data.checkoutUrl;
          } else {
            tdStatus.textContent = res.data.error || 'Could not start checkout. Please try again.';
            tdBtn.disabled = false;
            tdBtn.textContent = 'Commission My Teardown . $199';
          }
        })
        .catch(function () {
          tdStatus.textContent = 'Network error. Please try again.';
          tdBtn.disabled = false;
          tdBtn.textContent = 'Commission My Teardown . $199';
        });
    });
  }

  // ── Handle cancelled return from Stripe ────────

  if (window.location.search.includes('cancelled=1')) {
    if (window.ProductAnalytics) ProductAnalytics.trackConversion('checkout_cancelled');
    showError('Checkout was cancelled. Your free scan results are still available below.');
    window.history.replaceState({}, '', window.location.pathname);
  }

  // ── Auto-scan from ?url= (shared-report unlock path, outreach links) ──

  var _qsUrl = new URLSearchParams(window.location.search).get('url');
  if (_qsUrl) {
    urlInput.value = _qsUrl;
    if (window.ProductAnalytics) ProductAnalytics.trackFunnel('autoscan_from_link', { url: _qsUrl });
    window.history.replaceState({}, '', window.location.pathname);
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }
})();
