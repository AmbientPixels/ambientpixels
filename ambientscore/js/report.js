// report.js — AmbientScore report viewer
// Loads report data from API, renders full report or paywall

(function () {
  'use strict';

  if (window.ProductAnalytics) ProductAnalytics.init('ambientscore');

  var API = window.location.hostname === 'localhost'
    ? '/api'
    : 'https://ambientpixels-nova-api.azurewebsites.net/api';
  var params = new URLSearchParams(window.location.search);
  var reportId = params.get('id');
  var sessionId = params.get('session_id');

  var loadingEl = document.getElementById('as-report-loading');
  var contentEl = document.getElementById('as-report-content');

  if (!reportId) {
    showMessage('No report ID provided.', true);
    return;
  }

  if (sessionId) {
    unlockAndLoad();
  } else {
    loadReport();
  }

  // ── Dimension code map ────────────────────────

  var DIM_CODES = {
    'messaging clarity':     { code: 'D-01', short: 'MSG.CLR' },
    'cta strength':          { code: 'D-02', short: 'CTA.STR' },
    'trust signals':         { code: 'D-03', short: 'TRS.SIG' },
    'funnel friction':       { code: 'D-04', short: 'FNL.FRC' },
    'social proof':          { code: 'D-05', short: 'SOC.PRF' },
    'offer clarity':         { code: 'D-06', short: 'OFR.CLR' },
    'offer and pricing':     { code: 'D-06', short: 'OFR.CLR' },
    'content flow':          { code: 'D-07', short: 'CNT.FLW' },
    'continuity':            { code: 'D-07', short: 'CNT.FLW' },
    'conversion hierarchy':  { code: 'D-07', short: 'CNT.FLW' },
    'risk reversal':         { code: 'D-08', short: 'RSK.REV' },
    'differentiation':       { code: 'D-08', short: 'RSK.REV' },
    'audience alignment':    { code: 'D-01', short: 'MSG.CLR' },
    'quick-win fixes':       { code: 'D-08', short: 'RSK.REV' }
  };

  function dimCode(label) {
    if (!label) return { code: 'D--', short: '' };
    var key = String(label).toLowerCase().trim();
    return DIM_CODES[key] || { code: 'D--', short: '' };
  }

  // ── Unlock via Stripe session ──────────────────

  function unlockAndLoad() {
    fetch(API + '/as-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.priceType === 'pack') {
          sessionStorage.setItem('cc_pack_credits', '2');
        }
        window.history.replaceState({}, '', window.location.pathname + '?id=' + reportId);
        loadReport();
      })
      .catch(function () {
        loadReport();
      });
  }

  // ── Load Report ────────────────────────────────

  var loadRetries = 0;
  var MAX_RETRIES = 5;

  var GENERATING_MSGS = {
    fetch: 'Fetching the page.',
    extract: 'Extracting conversion elements.',
    evaluate: 'Evaluating eight dimensions.',
    score: 'Computing the score.'
  };

  function showGenerating(stage) {
    loadingEl.style.display = 'block';
    loadingEl.innerHTML = '<div class="as-container">' +
      '<div class="as-loading-eyebrow">Audit in progress</div>' +
      '<p class="as-loading-text"><span class="as-spinner"></span>' +
      (GENERATING_MSGS[stage] || GENERATING_MSGS.fetch) +
      ' This page will refresh itself when the report is ready.</p>' +
      '</div>';
  }

  function loadReport() {
    fetch(API + '/as-report?id=' + reportId)
      .then(function (res) {
        if (res.status === 404) throw new Error('not_found');
        return res.json();
      })
      .then(function (report) {
        // Analysis may still be running behind the scenes (async scan). Keep
        // polling; the server flips a stalled run to failed on its own.
        if (report && report.status === 'analyzing') {
          showGenerating(report.stage);
          setTimeout(loadReport, 5000);
          return;
        }
        if (report && report.status === 'failed') {
          showMessage('This audit could not be completed. The scan failed before a report was produced. Please run a new scan from the AmbientScore page.', true);
          return;
        }
        if (!report.unlocked) {
          renderPaywall(report);
        } else {
          renderFullReport(report);
        }
      })
      .catch(function (err) {
        if (err.message === 'not_found' && loadRetries < MAX_RETRIES) {
          loadRetries++;
          loadingEl.style.display = 'block';
          loadingEl.innerHTML = '<div class="as-container">' +
            '<div class="as-loading-eyebrow">Loading report</div>' +
            '<p class="as-loading-text"><span class="as-spinner"></span>Retrieving your audit (' + loadRetries + ' of ' + MAX_RETRIES + ').</p>' +
            '</div>';
          setTimeout(loadReport, 3000);
        } else if (err.message === 'not_found') {
          showMessage('Report not found. Please try scanning again.', true);
        } else {
          showMessage('Failed to load report. Please try again.', true);
        }
      });
  }

  // ── Paywall ────────────────────────────────────

  function renderPaywall(report) {
    if (window.ProductAnalytics) ProductAnalytics.trackFunnel('paywall_shown', { reportId: reportId, score: report.score });
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';

    var urlDisplay = displayUrl(report.url);
    var html = '';

    html += '<section class="as-paywall">';
    html += '<div class="as-sc-stamp">Locked . Preview</div>';
    html += '<div class="as-score-top">';
    html += '<div class="as-score-top-left">';
    html += '<div class="as-score-type">Conversion Audit . Form SC-1</div>';
    html += '<div class="as-score-title">' + esc(urlDisplay) + '</div>';
    html += '</div>';
    html += '<div class="as-score-ref">';
    html += 'Ref ' + esc((report.id || reportId || '').toString().slice(-6).toUpperCase()) + '<br>';
    html += esc(formatDate(new Date(report.createdAt || Date.now())));
    html += '</div>';
    html += '</div>';

    html += '<div class="as-score-body">';
    html += '<div class="as-grade">' + esc(report.grade || '-') + '</div>';
    html += '<div class="as-score-right">';
    html += '<div>';
    html += '<div class="as-paywall-score">' + (report.score != null ? report.score : 0) + '<sub>/100</sub></div>';
    html += '<div class="as-score-label">Conversion score</div>';
    html += '</div>';
    // Do not sell "8 dimensions" on a report where some of them were estimated.
    html += '<p>Your report has been generated. Unlock the full ' + (report.disclaimer ? '' : '8-dimension ')
      + 'analysis with detailed findings, headline rewrites, and CTA improvements.</p>';
    html += '</div>';
    html += '</div>';

    // Both of these are already in the locked API response and were being
    // dropped here, so a caveated score read as a clean one right up until the
    // moment someone paid for it.
    if (report.contentWarning) {
      html += '<div class="as-warning">' + esc(report.contentWarning) + '</div>';
    }
    if (report.jsRenderedWarning) {
      html += '<div class="as-warning">' + esc(report.jsRenderedWarning) + '</div>';
    }
    if (report.disclaimer) {
      html += '<div class="as-warning">' + esc(report.disclaimer) + '</div>';
    }

    // Teaser findings — the locked API response already includes them; showing
    // real, specific findings is what earns the unlock click on shared links.
    var teaser = report.teaserFindings || [];
    if (teaser.length) {
      html += '<div class="as-findings">';
      teaser.forEach(function (f) {
        html += buildTeaserCard(f);
      });
      html += '</div>';
    }
    var lockedCount = Math.max(0, (report.totalFindings || 0) - teaser.length);

    html += '<div class="as-upgrade-buttons">';
    html += '<button type="button" class="as-buy-btn" id="as-paywall-buy">Unlock full report . $29' + (lockedCount ? ' (' + lockedCount + ' more findings)' : '') + '</button>';
    html += '</div>';
    html += '<p class="as-td-upsell">Want it done for you? <a href="/ambientscore/#teardown">$199 teardown, delivered in 48 hours.</a></p>';

    html += '<div class="as-credits-redeem">';
    html += '<p class="as-credits-divider">Or redeem a pack credit</p>';
    html += '<div class="as-credits-form">';
    html += '<input type="email" id="as-credits-email" class="as-credits-email-input" placeholder="Enter your pack email" />';
    html += '<button type="button" class="as-credits-btn" id="as-credits-check-btn">Use Credits</button>';
    html += '</div>';
    html += '<div id="as-credits-status" class="as-credits-status"></div>';
    html += '</div>';
    html += '</section>';

    contentEl.innerHTML = html;

    var buyBtn = document.getElementById('as-paywall-buy');
    if (buyBtn) {
      buyBtn.addEventListener('click', function () {
        if (window.ProductAnalytics) ProductAnalytics.trackConversion('checkout_started', { priceType: 'single', reportId: reportId, from: 'paywall' });
        buyBtn.disabled = true;
        buyBtn.textContent = 'Redirecting.';
        var _attr = (window.ProductAnalytics && ProductAnalytics.getAttribution) ? ProductAnalytics.getAttribution() : { utm_content: '', utm_source: '' };
        fetch(API + '/as-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: report.url,
            reportId: reportId,
            createCheckout: true,
            priceType: 'single',
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
          .catch(function () {
            buyBtn.disabled = false;
            buyBtn.textContent = 'Unlock full report . $29';
          });
      });
    }

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
  }

  function buildTeaserCard(f) {
    var dim = dimCode(f.dimensionLabel);
    var sev = String(f.severity || 'minor').toLowerCase();
    if (!/^(critical|important|minor)$/.test(sev)) sev = 'minor';
    var sevLabel = sev.charAt(0).toUpperCase() + sev.slice(1);
    var html = '<div class="as-finding-card">';
    html += '<div class="as-finding-badges">';
    html += '<span class="as-finding-dim">' + esc(dim.code) + ' &middot; ' + esc(dim.short || (f.dimensionLabel || '').toUpperCase()) + '</span>';
    html += '<span class="as-finding-severity ' + sev + '">Severity ' + esc(sevLabel) + '</span>';
    if (f.estimatedImpact) {
      html += '<span class="as-finding-impact">Impact ' + esc(f.estimatedImpact) + '</span>';
    }
    html += '</div>';
    if (f.evidence) {
      html += '<div class="as-finding-evidence">' + esc(f.evidence) + '</div>';
    }
    html += '<div class="as-finding-text">' + esc(f.finding || '') + '</div>';
    if (f.recommendation) {
      html += '<div class="as-finding-rec">' + esc(f.recommendation) + '</div>';
    }
    html += '</div>';
    return html;
  }

  function redeemCredit(email) {
    var creditsStatus = document.getElementById('as-credits-status');
    fetch(API + '/as-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'redeem', email: email, reportId: reportId })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok && data.reportUrl) {
          if (data.credits != null) {
            sessionStorage.setItem('cc_pack_credits', String(data.credits));
          }
          window.location.href = data.reportUrl;
        } else {
          creditsStatus.innerHTML = '<p class="as-credits-error">' + esc(data.error || 'Redemption failed.') + '</p>';
        }
      })
      .catch(function () {
        creditsStatus.innerHTML = '<p class="as-credits-error">Something went wrong. Please try again.</p>';
      });
  }

  // ── Full Report ────────────────────────────────

  function renderFullReport(report) {
    if (window.ProductAnalytics) ProductAnalytics.trackFunnel('report_unlocked', { reportId: reportId, score: report.score, priceType: report.priceType });
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';

    var synth = report.synthesis || {};
    var dims = report.dimensions || {};
    var findings = report.findings || [];
    // Fallback synthesis carries degraded:true; reports stored before that
    // flag existed are detected by their stored synthesis error instead.
    var synthDegraded = !!synth.degraded || (report.errors || []).some(function (e) {
      return String(e).indexOf('Synthesis') === 0;
    });
    var html = '';

    // Sample banner
    if (report.isSample) {
      html += '<div class="as-pack-banner">';
      html += '<span>Sample audit. A real report generated by AmbientScore.</span>';
      html += '<a href="/ambientscore/">Scan your own site &rsaquo;</a>';
      html += '</div>';
    }

    // Pack banner
    if (report.priceType === 'pack') {
      var creditsLeft = sessionStorage.getItem('cc_pack_credits');
      html += '<div class="as-pack-banner">';
      html += '<span>Unlocked with your 3-pack.</span>';
      if (creditsLeft != null) {
        html += '<span>Credits remaining <strong>' + esc(creditsLeft) + '</strong></span>';
      }
      html += '</div>';
    }

    // Header
    html += '<div class="as-report-header">';
    html += '<div>';
    html += '<div class="as-eyebrow">Filed ' + esc(formatDate(new Date(report.createdAt || Date.now()))) + ' . Confidential</div>';
    html += '<h1>Conversion <em>audit.</em></h1>';
    html += '<div class="as-report-url">' + esc(report.url || '') + '</div>';
    html += '</div>';
    html += '<div class="as-report-date">';
    html += 'Ref ' + esc((report.id || reportId || '').toString().slice(-6).toUpperCase());
    if (report.siteTypeLabel) {
      html += '<br><span class="as-site-type">Site type <span class="as-site-type-value">' + esc(report.siteTypeLabel) + '</span></span>';
    }
    html += '</div>';
    html += '</div>';

    // Actions
    html += '<div class="as-actions">';
    html += '<button class="as-action-btn" onclick="window.print()">Print / Save PDF</button>';
    html += '<button class="as-action-btn" id="as-share-btn">Copy Link</button>';
    html += '</div>';

    // Score card
    html += '<div class="as-score-section">';
    html += '<div class="as-score-top">';
    html += '<div class="as-score-top-left">';
    html += '<div class="as-score-type">Conversion Audit . Form SC-1</div>';
    html += '<div class="as-score-title">' + esc(displayUrl(report.url)) + '</div>';
    html += '</div>';
    html += '<div class="as-score-ref">';
    html += 'Ref ' + esc((report.id || reportId || '').toString().slice(-6).toUpperCase()) + '<br>';
    html += esc(formatDate(new Date(report.createdAt || Date.now())));
    html += '</div>';
    html += '</div>';

    html += '<div class="as-score-body">';
    html += '<div class="as-grade">' + esc(report.grade || '-') + '</div>';
    html += '<div class="as-score-right">';
    html += '<div>';
    html += '<div class="as-score-gauge">' + (report.score != null ? report.score : 0) + '</div>';
    html += '<div class="as-score-label">Conversion score</div>';
    html += '</div>';
    html += '<div class="as-score-interpretation">' + esc(scoreContext(report.score)) + '</div>';
    html += '</div>';
    html += '</div>';

    // Counted, not asserted. A dimension whose evaluation failed carries a
    // constant score, and claiming it was evaluated contradicts the disclaimer
    // printed further down the same page.
    var totalDims = Object.keys(dims).length || 8;
    var partialDims = Object.keys(dims).filter(function (id) { return dims[id].partial; }).length;

    html += '<div class="as-score-meta">';
    html += '<span class="as-meta-check">' + (partialDims
      ? (totalDims - partialDims) + ' of ' + totalDims + ' dimensions evaluated'
      : totalDims + ' dimensions evaluated') + '</span>';
    html += '<span class="as-meta-check">Evidence-backed findings</span>';
    if (!synthDegraded) {
      html += '<span class="as-meta-check">Rewrites included</span>';
    }
    html += '</div>';
    html += '</div>';

    // We-read-the-wrong-page warning, then how-much-we-could-read warning
    if (report.contentWarning) {
      html += '<div class="as-warning">' + esc(report.contentWarning) + '</div>';
    }
    if (report.jsRenderedWarning) {
      html += '<div class="as-warning">' + esc(report.jsRenderedWarning) + '</div>';
    }

    // Degraded synthesis notice
    if (synthDegraded) {
      var regenHref = 'mailto:ambientpixels2022@gmail.com?subject=' + encodeURIComponent('AmbientScore rewrite regeneration . Ref ' + (report.id || reportId || ''))
        + '&body=' + encodeURIComponent('My report is missing its headline and CTA rewrites.\n\nReport ID: ' + (report.id || reportId || 'N/A') + '\nWebsite: ' + (report.url || 'N/A'));
      html += '<div class="as-warning">Rewrites could not be generated for this report. Scores and findings are complete. <a href="' + regenHref + '" style="text-decoration:underline;">Email us</a> and we will regenerate it at no charge.</div>';
    }

    // Executive summary
    if (synth.executiveSummary) {
      html += '<div class="as-section">';
      html += '<div class="as-section-head">';
      html += '<div><div class="as-section-eyebrow">§ 01</div><h2>Executive <em>summary.</em></h2></div>';
      html += '<div><p class="as-exec-summary">' + esc(synth.executiveSummary) + '</p></div>';
      html += '</div>';
      if (synth.conversionHealthAssessment) {
        html += '<div class="as-health-assessment">' + esc(synth.conversionHealthAssessment) + '</div>';
      }
      if (synth.analysisConfidence) {
        var confLevel = (synth.analysisConfidence.level || 'moderate').toLowerCase();
        var confLabel = confLevel.charAt(0).toUpperCase() + confLevel.slice(1);
        html += '<div class="as-confidence">';
        html += '<span class="as-confidence-label">Analysis confidence</span>';
        html += '<span class="as-confidence-level">' + esc(confLabel) + '</span>';
        if (synth.analysisConfidence.reason) {
          html += '<span class="as-confidence-reason">' + esc(synth.analysisConfidence.reason) + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';
    }

    // Dimensions
    html += '<div class="as-section">';
    html += '<div class="as-section-head">';
    html += '<div><div class="as-section-eyebrow">§ 02</div><h2>Dimension <em>scores.</em></h2></div>';
    html += '<div><p class="as-exec-summary">Each axis scored from 0 to 100 using the weighted conversion model.</p></div>';
    html += '</div>';
    Object.keys(dims).forEach(function (id) {
      var d = dims[id];
      var dim = dimCode(d.label);
      html += '<div class="as-dim-bar">';
      html += '<div class="as-dim-bar-header">';
      html += '<span class="as-dim-bar-code">' + esc(dim.code + ' · ' + (dim.short || '')) + '</span>';
      html += '<span class="as-dim-bar-label">' + esc(d.label) + (d.partial ? ' *' : '') + '</span>';
      html += '<div class="as-dim-bar-track"><div class="as-dim-bar-fill" style="width:' + Math.max(2, d.score) + '%;"></div></div>';
      html += '</div>';
      html += '<span class="as-dim-bar-score">' + d.score + '<small>' + esc(d.grade || '') + '</small></span>';
      html += '</div>';
    });
    if (report.disclaimer) {
      html += '<p class="as-methodology" style="margin-top:18px;border-top:0;padding-top:0;">* ' + esc(report.disclaimer) + '</p>';
    }
    html += '</div>';

    // Top priorities
    if (synth.topPriorities && synth.topPriorities.length > 0) {
      html += '<div class="as-section">';
      html += '<div class="as-section-head">';
      html += '<div><div class="as-section-eyebrow">§ 03</div><h2>Top <em>priorities.</em></h2></div>';
      html += '<div><p class="as-exec-summary">Fixes ranked by impact. Work these first.</p></div>';
      html += '</div>';
      synth.topPriorities.forEach(function (p) {
        var effortClass = p.effort === 'quick' ? 'as-effort-quick' : p.effort === 'rebuild' ? 'as-effort-rebuild' : 'as-effort-medium';
        var effortLabel = (p.effort || 'medium').charAt(0).toUpperCase() + (p.effort || 'medium').slice(1);
        html += '<div class="as-priority">';
        html += '<div class="as-priority-rank">Priority 0' + p.rank + '</div>';
        html += '<div class="as-priority-header">';
        html += '<h4>' + esc(p.title) + '</h4>';
        html += '<div class="as-priority-badges"><span class="as-effort-badge ' + effortClass + '">' + esc(effortLabel) + '</span></div>';
        html += '</div>';
        html += '<p class="as-priority-desc">' + esc(p.description) + '</p>';
        if (p.estimatedImpact) {
          html += '<div class="as-priority-impact">Impact . ' + esc(p.estimatedImpact) + '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    // Implementation roadmap
    if (synth.priorityRoadmap) {
      html += '<div class="as-section">';
      html += '<div class="as-section-head">';
      html += '<div><div class="as-section-eyebrow">§ 04</div><h2>Implementation <em>roadmap.</em></h2></div>';
      html += '<div><p class="as-exec-summary">Three phases, each scoped so you can ship the next one without waiting on the last.</p></div>';
      html += '</div>';
      html += '<div class="as-roadmap">';
      var phases = [
        { key: 'phase1', num: '01' },
        { key: 'phase2', num: '02' },
        { key: 'phase3', num: '03' }
      ];
      phases.forEach(function (ph) {
        var phase = synth.priorityRoadmap[ph.key];
        if (phase && phase.items && phase.items.length > 0) {
          html += '<div class="as-roadmap-phase">';
          html += '<div class="as-roadmap-phase-header">';
          html += '<span class="as-roadmap-num">' + ph.num + '</span>';
          html += '<span class="as-roadmap-label">' + esc(phase.label || 'Phase ' + ph.num) + '</span>';
          html += '</div>';
          html += '<ul class="as-roadmap-items">';
          phase.items.forEach(function (item) {
            html += '<li>' + esc(item) + '</li>';
          });
          html += '</ul>';
          html += '</div>';
        }
      });
      html += '</div>';
      html += '</div>';
    }

    // Headline rewrites
    if (synth.headlineRewrites && synth.headlineRewrites.length > 0) {
      html += '<div class="as-section">';
      html += '<div class="as-section-head">';
      html += '<div><div class="as-section-eyebrow">§ 05</div><h2>Headline <em>rewrites.</em></h2></div>';
      html += '<div><p class="as-exec-summary">Current copy on the left. Suggested replacement on the right.</p></div>';
      html += '</div>';
      synth.headlineRewrites.forEach(function (r) {
        html += '<div class="as-rewrite-card">';
        html += '<div class="as-rewrite-block as-rewrite-before">';
        html += '<div class="as-rewrite-block-label">Current</div>';
        html += '<div class="as-rewrite-block-text">' + esc(r.current) + '</div>';
        if (r.problems && r.problems.length > 0) {
          html += '<div class="as-rewrite-block-label" style="margin-top:14px;">Why it underperforms</div>';
          html += '<ul class="as-rewrite-issues">';
          r.problems.forEach(function (p) { html += '<li>' + esc(p) + '</li>'; });
          html += '</ul>';
        }
        html += '</div>';
        html += '<div class="as-rewrite-block as-rewrite-after">';
        html += '<div class="as-rewrite-block-label">Suggested rewrite</div>';
        html += '<div class="as-rewrite-block-text">' + esc(r.suggested) + '</div>';
        if (r.improvements && r.improvements.length > 0) {
          html += '<div class="as-rewrite-block-label" style="margin-top:14px;">Expected impact</div>';
          html += '<ul class="as-rewrite-wins">';
          r.improvements.forEach(function (p) { html += '<li>' + esc(p) + '</li>'; });
          html += '</ul>';
        }
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    // CTA rewrites
    if (synth.ctaRewrites && synth.ctaRewrites.length > 0) {
      html += '<div class="as-section">';
      html += '<div class="as-section-head">';
      html += '<div><div class="as-section-eyebrow">§ 06</div><h2>CTA <em>rewrites.</em></h2></div>';
      html += '<div><p class="as-exec-summary">Button labels reworked for specificity and action.</p></div>';
      html += '</div>';
      synth.ctaRewrites.forEach(function (r) {
        html += '<div class="as-rewrite-card">';
        html += '<div class="as-rewrite-block as-rewrite-before">';
        html += '<div class="as-rewrite-block-label">Current</div>';
        html += '<div><span class="as-cta-pill as-cta-old">' + esc(r.current) + '</span></div>';
        if (r.problems && r.problems.length > 0) {
          html += '<ul class="as-rewrite-issues" style="margin-top:14px;">';
          r.problems.forEach(function (p) { html += '<li>' + esc(p) + '</li>'; });
          html += '</ul>';
        }
        html += '</div>';
        html += '<div class="as-rewrite-block as-rewrite-after">';
        html += '<div class="as-rewrite-block-label">Suggested</div>';
        html += '<div><span class="as-cta-pill as-cta-new">' + esc(r.suggested) + '</span></div>';
        if (r.improvements && r.improvements.length > 0) {
          html += '<ul class="as-rewrite-wins" style="margin-top:14px;">';
          r.improvements.forEach(function (p) { html += '<li>' + esc(p) + '</li>'; });
          html += '</ul>';
        }
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    // All findings
    if (findings.length > 0) {
      html += '<div class="as-section">';
      html += '<div class="as-section-head">';
      html += '<div><div class="as-section-eyebrow">§ 07</div><h2>All <em>findings.</em></h2></div>';
      html += '<div><p class="as-exec-summary">' + findings.length + ' observations, each cited to the page element that triggered it.</p></div>';
      html += '</div>';
      html += '<div style="overflow-x:auto;">';
      html += '<table class="as-findings-table"><thead><tr>';
      html += '<th>Severity</th><th>Dimension</th><th>Finding</th><th>Recommendation</th>';
      html += '</tr></thead><tbody>';
      findings.forEach(function (f) {
        var sev = (f.severity || 'minor').toLowerCase();
        var sevLabel = sev.charAt(0).toUpperCase() + sev.slice(1);
        var dim = dimCode(f.dimensionLabel);
        html += '<tr>';
        html += '<td><span class="as-ft-sev ' + sev + '">' + esc(sevLabel) + '</span></td>';
        html += '<td><span class="as-ft-dim">' + esc(dim.code) + '</span><br><small style="font-family:var(--mono);font-size:9px;letter-spacing:0.14em;color:var(--ink-muted);text-transform:uppercase;">' + esc(dim.short || f.dimensionLabel || '') + '</small></td>';
        html += '<td>';
        if (f.evidence) {
          html += '<span class="as-ft-evidence">' + esc(f.evidence) + '</span>';
        }
        html += esc(f.finding);
        html += '</td>';
        html += '<td>' + esc(f.recommendation) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div></div>';
    }

    // Strategic opportunities
    if (synth.strategicOpportunities && synth.strategicOpportunities.length > 0) {
      html += '<div class="as-section">';
      html += '<div class="as-section-head">';
      html += '<div><div class="as-section-eyebrow">§ 08</div><h2>Strategic <em>opportunities.</em></h2></div>';
      html += '<div><p class="as-exec-summary">Bigger bets that live outside the immediate fix list.</p></div>';
      html += '</div>';
      synth.strategicOpportunities.forEach(function (s) {
        html += '<div class="as-opportunity">' + esc(s) + '</div>';
      });
      html += '</div>';
    }

    // Signature block
    html += '<div class="as-section" style="border-top:1px solid var(--ink);padding-top:48px;">';
    html += '<div class="as-sig-grid">';
    html += '<h2>Findings, <em>not opinions.</em></h2>';
    html += '<div class="as-sig-meta">';
    html += '<p>Every line in this report cites the exact element on the page that triggered it. No unsupported claims. No padding.</p>';
    html += '<div class="as-sig-name">The AmbientScore Desk</div>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    // Upsell
    var strategyUrl = '/ambientscore/strategy.html?reportId=' + encodeURIComponent(reportId)
      + '&url=' + encodeURIComponent(report.url || '')
      + '&score=' + (report.score || '')
      + '&siteType=' + encodeURIComponent(report.siteType || report.siteTypeLabel || '');
    var mailSubject = 'AmbientScore Strategy Inquiry . ' + (report.url || 'My Website');
    var mailBody = 'I just ran an AmbientScore audit.\n\n' +
      'Report ID: ' + (report.id || 'N/A') + '\n' +
      'Score: ' + (report.score != null ? report.score + '/100' : 'N/A') + '\n' +
      'Website: ' + (report.url || 'N/A') + '\n\n' +
      'I would like to discuss implementation.';
    var mailHref = 'mailto:ambientpixels2022@gmail.com?subject=' + encodeURIComponent(mailSubject) + '&body=' + encodeURIComponent(mailBody);

    html += '<div class="as-report-upsell">';
    html += '<div class="as-report-upsell-eyebrow">Implementation</div>';
    html += '<h3>Want these fixes <em>shipped?</em></h3>';
    html += '<p>AmbientPixels implements the messaging rewrites, funnel restructuring, CTA work, and content repairs this report identified. So you capture the revenue instead of filing the audit.</p>';
    html += '<div class="as-upsell-ctas">';
    html += '<a href="' + strategyUrl + '">Book a strategy call</a>';
    html += '<a href="' + mailHref + '">Email us directly</a>';
    html += '</div>';
    html += '</div>';

    // Methodology
    html += '<div class="as-methodology">';
    html += '<strong>Methodology</strong><br>';
    html += 'This report evaluates eight conversion dimensions using structured analysis of visible page content. Scores are computed deterministically from rubric-based criteria. This analysis does not include traffic data, A/B test results, or analytics.';
    html += '</div>';

    contentEl.innerHTML = html;

    var shareBtn = document.getElementById('as-share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', function () {
        var url = window.location.origin + '/ambientscore/report.html?id=' + reportId;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () {
            shareBtn.textContent = 'Copied';
            setTimeout(function () { shareBtn.textContent = 'Copy Link'; }, 2000);
          });
        }
      });
    }
  }

  // ── Helpers ────────────────────────────────────

  function scoreContext(score) {
    if (score >= 80) return 'Strong conversion health. Your site demonstrates deliberate optimization across key dimensions.';
    if (score >= 70) return 'Good foundation with clear upside. Core conversion elements are in place. Targeted improvements can move the needle.';
    if (score >= 60) return 'Workable but underoptimized. The conversion path functions, but several dimensions show room for deliberate CRO attention.';
    return 'Needs attention. Multiple conversion dimensions show structural gaps that are likely reducing conversion rates.';
  }

  function displayUrl(url) {
    if (!url) return 'Your site';
    try {
      var u = new URL(url);
      return u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '');
    } catch (e) {
      return url;
    }
  }

  function formatDate(d) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function showMessage(msg, isError) {
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
    var html = '<div class="as-error" style="margin-top:80px;">';
    html += '<p>' + esc(msg) + '</p>';
    html += '</div>';
    html += '<div style="text-align:center;margin-top:24px;">';
    html += '<a href="/ambientscore/" class="as-buy-btn" style="border-right:1px solid var(--ink);display:inline-block;text-decoration:none;">Back to AmbientScore</a>';
    html += '</div>';
    contentEl.innerHTML = html;
  }

  function esc(str) {
    if (str == null) return '';
    // Normalize dashes before escaping: the editorial style bans em dashes in
    // visible copy, but LLM-generated report text often contains them. Em dash
    // becomes a comma, en dash a hyphen. Chrome/UI strings have no such dashes,
    // so this only affects generated prose.
    var normalized = String(str)
      .replace(/\s*—\s*/g, ', ')
      .replace(/\s*–\s*/g, '-');
    var div = document.createElement('div');
    div.textContent = normalized;
    return div.innerHTML;
  }
})();
