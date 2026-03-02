// conversioncore.js — Landing page logic
// Handles: URL scan, results display, Stripe checkout redirect

(function () {
  'use strict';

  var API = '/api';
  var currentReportId = null;
  var currentUrl = null;

  // DOM refs
  var form = document.getElementById('cc-scan-form');
  var urlInput = document.getElementById('cc-url-input');
  var scanBtn = document.getElementById('cc-scan-btn');
  var loadingSection = document.getElementById('cc-loading');
  var loadingText = document.getElementById('cc-loading-text');
  var errorSection = document.getElementById('cc-error');
  var errorText = document.getElementById('cc-error-text');
  var resultsSection = document.getElementById('cc-results');
  var scoreGauge = document.getElementById('cc-score-gauge');
  var gradeEl = document.getElementById('cc-grade');
  var jsWarning = document.getElementById('cc-js-warning');
  var findingsVisible = document.getElementById('cc-findings-visible');
  var findingsBlurred = document.getElementById('cc-findings-blurred');
  var blurredCount = document.getElementById('cc-blurred-count');
  var upgradeSection = document.getElementById('cc-upgrade');
  var buySingle = document.getElementById('cc-buy-single');
  var buyPack = document.getElementById('cc-buy-pack');

  // Loading step elements
  var steps = {
    fetch: document.getElementById('cc-step-fetch'),
    extract: document.getElementById('cc-step-extract'),
    evaluate: document.getElementById('cc-step-evaluate'),
    score: document.getElementById('cc-step-score')
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
      'Computing Conversion Health Score...'
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
    scanBtn.textContent = 'Scan My Site';
    stopLoadingSteps();
  }

  function showError(msg) {
    hideLoading();
    errorSection.style.display = 'block';
    errorText.textContent = msg;
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
    scoreGauge.className = 'cc-score-gauge ' + (score >= 65 ? 'score-high' : score >= 50 ? 'score-mid' : 'score-low');
    gradeEl.textContent = 'Grade: ' + (data.grade || '--');

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
    } else {
      upgradeSection.style.display = 'none';
    }

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function buildFindingCard(f, isBlurred) {
    return '<div class="cc-finding-card' + (isBlurred ? ' blurred' : '') + '">' +
      '<span class="cc-finding-severity ' + (f.severity || 'minor') + '">' + escapeHtml(f.severity || 'minor') + '</span>' +
      '<div class="cc-finding-dim">' + escapeHtml(f.dimensionLabel || '') + '</div>' +
      '<div class="cc-finding-text">' + escapeHtml(f.finding || '') + '</div>' +
      (f.recommendation ? '<div class="cc-finding-rec">' + escapeHtml(f.recommendation) + '</div>' : '') +
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

    fetch(API + '/cc-analyze', {
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
        showError(err.message || 'Something went wrong. Please try again.');
      });
  });

  // ── Buy Handlers ───────────────────────────────

  function handleBuy(priceType) {
    if (!currentUrl || !currentReportId) return;

    buySingle.disabled = true;
    buyPack.disabled = true;
    buySingle.textContent = 'Redirecting to checkout...';

    fetch(API + '/cc-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentUrl,
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
        buySingle.textContent = 'Get Full Report \u2014 $49';
      });
  }

  buySingle.addEventListener('click', function () { handleBuy('single'); });
  buyPack.addEventListener('click', function () { handleBuy('pack'); });

  // ── Handle cancelled return from Stripe ────────

  if (window.location.search.includes('cancelled=1')) {
    showError('Checkout was cancelled. Your free scan results are still available below.');
    // Clear the param
    window.history.replaceState({}, '', window.location.pathname);
  }
})();
