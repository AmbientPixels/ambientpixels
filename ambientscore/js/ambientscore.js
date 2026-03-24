// ambientscore.js — Landing page logic
// Handles: URL scan, results display, Stripe checkout redirect

(function () {
  'use strict';

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
  var jsWarning = document.getElementById('as-js-warning');
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

  // ── Loading Animation ──────────────────────────

  var loadingInterval = null;

  function startLoadingSteps() {
    var order = ['fetch', 'extract', 'evaluate', 'score'];
    var current = 0;
    var messages = [
      'Fetching your page...',
      'Extracting conversion elements...',
      'Evaluating 8 dimensions...',
      'Computing AmbientScore...'
    ];

    loadingInterval = setInterval(function () {
      if (current > 0) {
        steps[order[current - 1]].classList.remove('active');
        steps[order[current - 1]].classList.add('done');
        steps[order[current - 1]].textContent = '\u2713 ' + steps[order[current - 1]].textContent.replace(/^[\u2713] /, '');
      }
      if (current < order.length) {
        steps[order[current]].classList.add('active');
        loadingText.textContent = messages[current];
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
      steps[k].textContent = steps[k].textContent.replace(/^[\u2713] /, '');
    });
  }

  // ── UI State Helpers ───────────────────────────

  function showLoading() {
    loadingSection.style.display = 'block';
    resultsSection.style.display = 'none';
    errorSection.style.display = 'none';
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
    startLoadingSteps();
  }

  function hideLoading() {
    loadingSection.style.display = 'none';
    scanBtn.disabled = false;
    scanBtn.textContent = 'Get My Score';
    stopLoadingSteps();
  }

  var ERROR_MESSAGES = {
    SITE_BLOCKED: [
      "This site requires browser verification (bot protection), so we couldn't fetch the page content. Try a different URL.",
      "We couldn't scan this site because it blocks automated requests. Try the homepage URL or a different page (like /pricing).",
      "This site's security settings prevented our scan. If you control the site, allowlist our scanner — or try another URL for now.",
      "Blocked by bot protection. We're working on improved coverage, but this URL can't be scanned right now."
    ],
    SITE_TIMEOUT: [
      "The site didn't respond before our timeout. Try again, or try the homepage URL.",
      "We couldn't get a response in time. The site may be slow or temporarily unavailable.",
      "Timed out waiting for the site to respond. Try again in a minute."
    ],
    ANALYSIS_FAILED: [
      "Something tripped up our analysis engine. Please try again.",
      "We hit an error while scoring this page. Try again — if it repeats, try a different URL.",
      "We couldn't complete the analysis this time. Please retry."
    ]
  };

  function _pick(pool) { return pool[Math.floor(Math.random() * pool.length)]; }

  function _baseUrl(url) {
    try { var u = new URL(url); return u.origin + '/'; } catch (e) { return ''; }
  }

  function friendlyError(raw, scannedUrl) {
    var code = '';
    // Try to parse structured error from API
    try {
      var parsed = JSON.parse(raw);
      code = parsed.error || '';
    } catch (e) { code = raw; }

    var msg = '';
    if (code.indexOf('SITE_BLOCKED') !== -1 || code.indexOf('403') !== -1) {
      msg = _pick(ERROR_MESSAGES.SITE_BLOCKED);
    } else if (code.indexOf('SITE_TIMEOUT') !== -1 || code.indexOf('timeout') !== -1) {
      msg = _pick(ERROR_MESSAGES.SITE_TIMEOUT);
    } else if (code.indexOf('ANALYSIS_FAILED') !== -1 || code.indexOf('Analysis failed') !== -1) {
      msg = _pick(ERROR_MESSAGES.ANALYSIS_FAILED);
    } else {
      msg = raw || "Something went wrong. Please try again.";
    }

    // Append homepage suggestion for blocked/timeout errors
    if (scannedUrl && (code.indexOf('SITE_BLOCKED') !== -1 || code.indexOf('403') !== -1)) {
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
    // Support newline-separated suggestion line
    var parts = msg.split('\n\n');
    if (parts.length > 1) {
      errorText.innerHTML = escapeHtml(parts[0]) + '<br><small style="opacity:0.7;font-size:0.85em;">' + escapeHtml(parts[1]) + '</small>';
    } else {
      errorText.textContent = msg;
    }
  }

  function hideError() {
    errorSection.style.display = 'none';
  }

  // ── Render Results ─────────────────────────────

  function renderResults(data) {
    hideLoading();
    hideError();
    resultsSection.style.display = 'block';

    currentReportId = data.reportId;

    // Score gauge
    var score = data.score || 0;
    scoreGauge.textContent = score;
    scoreGauge.className = 'as-score-gauge ' + (score >= 70 ? 'score-high' : score >= 60 ? 'score-mid' : 'score-low');
    gradeEl.textContent = 'Grade: ' + (data.grade || '--');

    // Score interpretation
    var interpEl = document.getElementById('as-score-interpretation');
    if (interpEl) {
      interpEl.textContent = scoreInterpretation(score);
    }

    // JS warning
    if (data.jsRenderedWarning) {
      jsWarning.style.display = 'block';
      jsWarning.textContent = data.jsRenderedWarning;
    } else {
      jsWarning.style.display = 'none';
    }

    // Visible findings (first 3)
    var teaser = data.teaserFindings || [];
    findingsVisible.innerHTML = '';
    teaser.forEach(function (f) {
      findingsVisible.innerHTML += buildFindingCard(f, false);
    });

    // Blurred findings
    var blurred = (data.blurredCount || 0);
    findingsBlurred.innerHTML = '';
    if (blurred > 0) {
      // Show 2 blurred placeholder cards
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
      upgradeSection.style.display = 'none';
    }

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Gentle auto-scroll toward unlock section after 4s
    if (blurred > 0) {
      setTimeout(function () {
        upgradeSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 4000);
    }
  }

  function scoreInterpretation(score) {
    if (score >= 80) return 'Strong conversion health. Your site demonstrates deliberate optimization across key dimensions. Remaining opportunities are refinements, not structural gaps.';
    if (score >= 70) return 'Good foundation with clear upside. Core conversion elements are in place — targeted improvements to messaging, CTAs, or trust signals can move the needle meaningfully.';
    if (score >= 60) return 'Workable but underoptimized. The conversion path functions, but several dimensions show room for deliberate CRO attention that could improve visitor-to-customer flow.';
    return 'Needs attention. Multiple conversion dimensions show structural gaps — addressing messaging clarity, trust signals, or funnel friction would likely improve conversion rates.';
  }

  function buildFindingCard(f, isBlurred) {
    var impactClass = f.estimatedImpact === 'high' ? 'as-impact-high' : f.estimatedImpact === 'low' ? 'as-impact-low' : 'as-impact-med';
    return '<div class="as-finding-card' + (isBlurred ? ' blurred' : '') + '">' +
      '<div class="as-finding-badges">' +
      '<span class="as-finding-severity ' + (f.severity || 'minor') + '">' + escapeHtml(f.severity || 'minor') + '</span>' +
      (!isBlurred && f.estimatedImpact ? '<span class="as-finding-impact ' + impactClass + '">Impact: ' + escapeHtml(f.estimatedImpact) + '</span>' : '') +
      '</div>' +
      '<div class="as-finding-dim">' + escapeHtml(f.dimensionLabel || '') + '</div>' +
      (f.evidence && !isBlurred ? '<div class="as-finding-evidence">' + escapeHtml(f.evidence) + '</div>' : '') +
      '<div class="as-finding-text">' + escapeHtml(f.finding || '') + '</div>' +
      (f.recommendation ? '<div class="as-finding-rec">' + escapeHtml(f.recommendation) + '</div>' : '') +
      '</div>';
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Scan Handler ───────────────────────────────

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = urlInput.value.trim();
    if (!url) return;

    // Ensure protocol
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
      urlInput.value = url;
    }

    currentUrl = url;
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
        showError(friendlyError(err.message || '', url));
      });
  });

  // ── Buy Handlers ───────────────────────────────

  function handleBuy(priceType) {
    if (!currentUrl || !currentReportId) return;

    buySingle.disabled = true;
    buyPack.disabled = true;
    buySingle.textContent = 'Redirecting to checkout...';

    fetch(API + '/as-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentUrl,
        reportId: currentReportId,
        createCheckout: true,
        priceType: priceType
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
        buySingle.textContent = 'Unlock Full Breakdown \u2014 $29';
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
      creditsCheckBtn.textContent = 'Checking...';
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
              '<button class="as-buy-btn" id="as-credits-confirm" style="margin-top:8px;">Use 1 Credit to Unlock</button>';

            document.getElementById('as-credits-confirm').addEventListener('click', function () {
              this.disabled = true;
              this.textContent = 'Unlocking...';
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

  // ── Handle cancelled return from Stripe ────────

  if (window.location.search.includes('cancelled=1')) {
    showError('Checkout was cancelled. Your free scan results are still available below.');
    // Clear the param
    window.history.replaceState({}, '', window.location.pathname);
  }
})();
