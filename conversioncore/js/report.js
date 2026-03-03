// report.js — ConversionCore report viewer
// Loads report data from API, renders full report or paywall

(function () {
  'use strict';

  var API = window.location.hostname === 'localhost'
    ? '/api'
    : 'https://ambientpixels-nova-api.azurewebsites.net/api';
  var params = new URLSearchParams(window.location.search);
  var reportId = params.get('id');
  var sessionId = params.get('session_id');

  var loadingEl = document.getElementById('cc-report-loading');
  var contentEl = document.getElementById('cc-report-content');

  if (!reportId) {
    showMessage('No report ID provided.', true);
    return;
  }

  // If coming from Stripe checkout, verify payment first
  if (sessionId) {
    unlockAndLoad();
  } else {
    loadReport();
  }

  // ── Unlock via Stripe session ──────────────────

  function unlockAndLoad() {
    fetch(API + '/cc-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId })
    })
      .then(function (res) { return res.json(); })
      .then(function () {
        // Clean URL params
        window.history.replaceState({}, '', window.location.pathname + '?id=' + reportId);
        loadReport();
      })
      .catch(function () {
        // Try loading anyway — webhook may have already unlocked it
        loadReport();
      });
  }

  // ── Load Report ────────────────────────────────

  var loadRetries = 0;
  var MAX_RETRIES = 5;

  function loadReport() {
    fetch(API + '/cc-report?id=' + reportId)
      .then(function (res) {
        if (res.status === 404) throw new Error('not_found');
        return res.json();
      })
      .then(function (report) {
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
          loadingEl.innerHTML = '<div class="cc-container" style="text-align:center;padding:60px 0;"><div class="cc-spinner"></div><p style="margin-top:16px;color:var(--cc-text-secondary);">Loading your report... (' + loadRetries + '/' + MAX_RETRIES + ')</p></div>';
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
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
    contentEl.innerHTML = '<div class="cc-paywall">' +
      '<div class="cc-score-gauge ' + scoreClass(report.score) + '" style="margin:0 auto 16px;">' + report.score + '</div>' +
      '<div class="cc-grade">Grade: ' + esc(report.grade) + '</div>' +
      '<div class="cc-score-label" style="margin-bottom:24px;">Conversion Health Score</div>' +
      '<p style="color:var(--cc-text-secondary);margin-bottom:32px;">Your report has been generated. Unlock the full 8-dimension analysis with detailed findings, headline rewrites, and CTA improvements.</p>' +
      '<a href="/conversioncore/?url=' + encodeURIComponent(report.url || '') + '" class="cc-buy-btn" style="text-decoration:none;">Unlock Full Report — $49</a>' +
      '<div class="cc-credits-redeem" style="margin-top:24px;">' +
      '<p class="cc-credits-divider">Have a pack?</p>' +
      '<div class="cc-credits-form">' +
      '<input type="email" id="cc-credits-email" class="cc-credits-email-input" placeholder="Enter your pack email" />' +
      '<button type="button" class="cc-credits-btn" id="cc-credits-check-btn">Use Credits</button>' +
      '</div>' +
      '<div id="cc-credits-status" class="cc-credits-status"></div>' +
      '</div>' +
      '</div>';

    // Wire up credit check/redeem
    var creditsCheckBtn = document.getElementById('cc-credits-check-btn');
    var creditsEmailInput = document.getElementById('cc-credits-email');
    var creditsStatus = document.getElementById('cc-credits-status');

    if (creditsCheckBtn) {
      creditsCheckBtn.addEventListener('click', function () {
        var email = creditsEmailInput.value.trim();
        if (!email) return;

        creditsCheckBtn.disabled = true;
        creditsCheckBtn.textContent = 'Checking...';
        creditsStatus.innerHTML = '';

        fetch(API + '/cc-credits', {
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
                '<p class="cc-credits-balance">You have <strong>' + data.credits + '</strong> credit' + (data.credits > 1 ? 's' : '') + ' remaining.</p>' +
                '<button class="cc-buy-btn" id="cc-credits-confirm" style="margin-top:8px;">Use 1 Credit to Unlock</button>';

              document.getElementById('cc-credits-confirm').addEventListener('click', function () {
                this.disabled = true;
                this.textContent = 'Unlocking...';
                redeemCredit(email);
              });
            } else {
              creditsStatus.innerHTML = '<p class="cc-credits-none">No credits found for this email.</p>';
            }
          })
          .catch(function () {
            creditsCheckBtn.disabled = false;
            creditsCheckBtn.textContent = 'Use Credits';
            creditsStatus.innerHTML = '<p class="cc-credits-error">Could not check credits. Please try again.</p>';
          });
      });
    }
  }

  function redeemCredit(email) {
    var creditsStatus = document.getElementById('cc-credits-status');
    fetch(API + '/cc-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'redeem', email: email, reportId: reportId })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok && data.reportUrl) {
          window.location.href = data.reportUrl;
        } else {
          creditsStatus.innerHTML = '<p class="cc-credits-error">' + esc(data.error || 'Redemption failed.') + '</p>';
        }
      })
      .catch(function () {
        creditsStatus.innerHTML = '<p class="cc-credits-error">Something went wrong. Please try again.</p>';
      });
  }

  // ── Full Report ────────────────────────────────

  function renderFullReport(report) {
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';

    var synth = report.synthesis || {};
    var dims = report.dimensions || {};
    var findings = report.findings || [];
    var html = '';

    // Header
    html += '<div class="cc-report-header">';
    html += '<h1 style="font-size:24px;color:var(--cc-accent);margin-bottom:4px;">Conversion Audit Report</h1>';
    html += '<div class="cc-report-url">' + esc(report.url) + '</div>';
    html += '<div class="cc-report-date">' + new Date(report.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '</div>';
    if (report.siteTypeLabel) {
      html += '<div class="cc-site-type">Site Type: <span class="cc-site-type-value">' + esc(report.siteTypeLabel) + '</span></div>';
    }
    html += '</div>';

    // Actions bar
    html += '<div class="cc-actions">';
    html += '<button class="cc-action-btn" onclick="window.print()">Print / Save PDF</button>';
    html += '<button class="cc-action-btn" id="cc-share-btn">Copy Link</button>';
    html += '</div>';

    // Score
    html += '<div class="cc-score-section" style="margin-bottom:40px;">';
    html += '<div class="cc-score-gauge ' + scoreClass(report.score) + '">' + report.score + '</div>';
    html += '<div class="cc-grade">Grade: ' + esc(report.grade) + '</div>';
    html += '<div class="cc-score-label">Conversion Health Score</div>';
    html += '<div class="cc-score-context">' + scoreContext(report.score) + '</div>';
    html += '</div>';

    // JS warning
    if (report.jsRenderedWarning) {
      html += '<div class="cc-warning">' + esc(report.jsRenderedWarning) + '</div>';
    }

    // Executive Summary
    if (synth.executiveSummary) {
      html += '<div class="cc-section">';
      html += '<h2>Executive Summary</h2>';
      html += '<p class="cc-exec-summary">' + esc(synth.executiveSummary) + '</p>';
      if (synth.conversionHealthAssessment) {
        html += '<div class="cc-health-assessment">' + esc(synth.conversionHealthAssessment) + '</div>';
      }
      if (synth.analysisConfidence) {
        var confLevel = (synth.analysisConfidence.level || 'moderate').toLowerCase();
        var confColor = confLevel === 'high' ? 'var(--cc-accent)' : confLevel === 'low' ? 'var(--cc-danger)' : 'var(--cc-warning)';
        html += '<div class="cc-confidence">';
        html += '<span class="cc-confidence-label">Analysis Confidence:</span> ';
        html += '<span class="cc-confidence-level" style="color:' + confColor + ';">' + esc(confLevel.charAt(0).toUpperCase() + confLevel.slice(1)) + '</span>';
        if (synth.analysisConfidence.reason) {
          html += '<span class="cc-confidence-reason"> — ' + esc(synth.analysisConfidence.reason) + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';
    }

    // Dimension Scores
    html += '<div class="cc-section">';
    html += '<h2>Dimension Scores</h2>';
    Object.keys(dims).forEach(function (id) {
      var d = dims[id];
      html += '<div class="cc-dim-bar">';
      html += '<div class="cc-dim-bar-header">';
      html += '<span class="cc-dim-bar-label">' + esc(d.label) + (d.partial ? ' *' : '') + '</span>';
      html += '<span class="cc-dim-bar-score" style="color:' + scoreColor(d.score) + ';">' + d.score + '/100 (' + d.grade + ')</span>';
      html += '</div>';
      html += '<div class="cc-dim-bar-track"><div class="cc-dim-bar-fill" style="width:' + Math.max(2, d.score) + '%;background:' + scoreColor(d.score) + ';"></div></div>';
      html += '</div>';
    });
    if (report.disclaimer) {
      html += '<p style="font-size:11px;color:var(--cc-text-muted);">* ' + esc(report.disclaimer) + '</p>';
    }
    html += '</div>';

    // Top Priorities
    if (synth.topPriorities && synth.topPriorities.length > 0) {
      html += '<div class="cc-section">';
      html += '<h2>Top Priorities</h2>';
      synth.topPriorities.forEach(function (p) {
        var effortClass = p.effort === 'quick' ? 'cc-effort-quick' : p.effort === 'rebuild' ? 'cc-effort-rebuild' : 'cc-effort-medium';
        html += '<div class="cc-priority">';
        html += '<div class="cc-priority-header">';
        html += '<h4>#' + p.rank + ' ' + esc(p.title) + '</h4>';
        html += '<div class="cc-priority-badges">';
        html += '<span class="cc-effort-badge ' + effortClass + '">' + esc(p.effort || 'medium') + '</span>';
        html += '</div>';
        html += '</div>';
        html += '<p class="cc-priority-desc">' + esc(p.description) + '</p>';
        html += '<div class="cc-priority-impact">' + esc(p.estimatedImpact) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    // Priority Roadmap
    if (synth.priorityRoadmap) {
      html += '<div class="cc-section">';
      html += '<h2>Implementation Roadmap</h2>';
      html += '<div class="cc-roadmap">';
      var phases = [
        { key: 'phase1', icon: '1', accent: 'var(--cc-accent)' },
        { key: 'phase2', icon: '2', accent: 'var(--cc-warning)' },
        { key: 'phase3', icon: '3', accent: '#8b5cf6' }
      ];
      phases.forEach(function (ph) {
        var phase = synth.priorityRoadmap[ph.key];
        if (phase && phase.items && phase.items.length > 0) {
          html += '<div class="cc-roadmap-phase">';
          html += '<div class="cc-roadmap-phase-header">';
          html += '<span class="cc-roadmap-num" style="background:' + ph.accent + '20;color:' + ph.accent + ';">' + ph.icon + '</span>';
          html += '<span class="cc-roadmap-label">' + esc(phase.label) + '</span>';
          html += '</div>';
          html += '<ul class="cc-roadmap-items">';
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

    // Headline Rewrites
    if (synth.headlineRewrites && synth.headlineRewrites.length > 0) {
      html += '<div class="cc-section">';
      html += '<h2>Headline Rewrites</h2>';
      synth.headlineRewrites.forEach(function (r) {
        html += '<div class="cc-rewrite-card">';
        html += '<div class="cc-rewrite-block cc-rewrite-before">';
        html += '<div class="cc-rewrite-block-label">Current</div>';
        html += '<div class="cc-rewrite-block-text">' + esc(r.current) + '</div>';
        if (r.problems && r.problems.length > 0) {
          html += '<div class="cc-rewrite-block-label" style="margin-top:8px;">Why It Underperforms</div>';
          html += '<ul class="cc-rewrite-issues">';
          r.problems.forEach(function (p) { html += '<li>' + esc(p) + '</li>'; });
          html += '</ul>';
        }
        html += '</div>';
        html += '<div class="cc-rewrite-block cc-rewrite-after">';
        html += '<div class="cc-rewrite-block-label">Suggested Rewrite</div>';
        html += '<div class="cc-rewrite-block-text">' + esc(r.suggested) + '</div>';
        if (r.improvements && r.improvements.length > 0) {
          html += '<div class="cc-rewrite-block-label" style="margin-top:8px;">Expected Impact</div>';
          html += '<ul class="cc-rewrite-wins">';
          r.improvements.forEach(function (p) { html += '<li>' + esc(p) + '</li>'; });
          html += '</ul>';
        }
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    // CTA Rewrites
    if (synth.ctaRewrites && synth.ctaRewrites.length > 0) {
      html += '<div class="cc-section">';
      html += '<h2>CTA Improvements</h2>';
      synth.ctaRewrites.forEach(function (r) {
        html += '<div class="cc-rewrite-card">';
        html += '<div class="cc-rewrite-block cc-rewrite-before">';
        html += '<div class="cc-rewrite-block-label">Current</div>';
        html += '<span class="cc-cta-pill cc-cta-old">' + esc(r.current) + '</span>';
        if (r.problems && r.problems.length > 0) {
          html += '<ul class="cc-rewrite-issues" style="margin-top:8px;">';
          r.problems.forEach(function (p) { html += '<li>' + esc(p) + '</li>'; });
          html += '</ul>';
        }
        html += '</div>';
        html += '<div class="cc-rewrite-block cc-rewrite-after">';
        html += '<div class="cc-rewrite-block-label">Suggested</div>';
        html += '<span class="cc-cta-pill cc-cta-new">' + esc(r.suggested) + '</span>';
        if (r.improvements && r.improvements.length > 0) {
          html += '<ul class="cc-rewrite-wins" style="margin-top:8px;">';
          r.improvements.forEach(function (p) { html += '<li>' + esc(p) + '</li>'; });
          html += '</ul>';
        }
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    // All Findings
    if (findings.length > 0) {
      html += '<div class="cc-section">';
      html += '<h2>All Findings (' + findings.length + ')</h2>';
      html += '<div style="overflow-x:auto;">';
      html += '<table class="cc-findings-table"><thead><tr>';
      html += '<th>Severity</th><th>Dimension</th><th>Finding</th><th>Recommendation</th>';
      html += '</tr></thead><tbody>';
      findings.forEach(function (f) {
        html += '<tr>';
        html += '<td style="color:' + severityColor(f.severity) + ';font-weight:600;text-transform:uppercase;font-size:11px;">' + esc(f.severity) + '</td>';
        html += '<td style="color:var(--cc-text-muted);">' + esc(f.dimensionLabel) + '</td>';
        html += '<td style="color:var(--cc-text);">' + (f.evidence ? '<div style="font-size:11px;color:var(--cc-text-muted);font-style:italic;margin-bottom:4px;padding:4px 8px;background:rgba(255,255,255,0.03);border-left:2px solid var(--cc-border);border-radius:0 4px 4px 0;">' + esc(f.evidence) + '</div>' : '') + esc(f.finding) + '</td>';
        html += '<td style="color:var(--cc-text-secondary);">' + esc(f.recommendation) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div></div>';
    }

    // Strategic Opportunities
    if (synth.strategicOpportunities && synth.strategicOpportunities.length > 0) {
      html += '<div class="cc-section">';
      html += '<h2>Strategic Opportunities</h2>';
      synth.strategicOpportunities.forEach(function (s) {
        html += '<p style="padding-left:16px;border-left:2px solid var(--cc-accent);margin-bottom:12px;color:var(--cc-text-secondary);">' + esc(s) + '</p>';
      });
      html += '</div>';
    }

    // Upsell
    var strategyUrl = '/conversioncore/strategy.html?reportId=' + encodeURIComponent(reportId)
      + '&url=' + encodeURIComponent(report.url || '')
      + '&score=' + (report.score || '')
      + '&siteType=' + encodeURIComponent(report.siteType || report.siteTypeLabel || '');
    html += '<div class="cc-report-upsell">';
    html += '<h3>Turn This Audit Into Growth</h3>';
    html += '<p>AmbientPixels implements messaging rewrites, funnel restructuring, CTA optimization, and AI-driven content integration — so you capture the revenue this report identified.</p>';
    html += '<a href="' + strategyUrl + '">Turn This Audit Into Growth</a>';
    html += '</div>';

    // Methodology
    html += '<div class="cc-methodology" style="margin-top:32px;">';
    html += '<strong>Methodology:</strong> This report evaluates 8 conversion dimensions using structured analysis of visible page content. ';
    html += 'Scores are computed deterministically from rubric-based criteria. This analysis does not include traffic data, A/B test results, or analytics.';
    html += '</div>';

    contentEl.innerHTML = html;

    // Wire up share button
    var shareBtn = document.getElementById('cc-share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', function () {
        var url = window.location.origin + '/conversioncore/report.html?id=' + reportId;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () {
            shareBtn.textContent = 'Copied!';
            setTimeout(function () { shareBtn.textContent = 'Copy Link'; }, 2000);
          });
        }
      });
    }
  }

  // ── Helpers ────────────────────────────────────

  function scoreContext(score) {
    if (score >= 80) return 'Strong conversion health. Your site demonstrates deliberate optimization across key dimensions.';
    if (score >= 70) return 'Good foundation with clear upside. Core conversion elements are in place — targeted improvements can move the needle.';
    if (score >= 60) return 'Workable but underoptimized. The conversion path functions, but several dimensions show room for deliberate CRO attention.';
    return 'Needs attention. Multiple conversion dimensions show structural gaps that are likely reducing conversion rates.';
  }

  function scoreClass(score) {
    if (score >= 70) return 'score-high';
    if (score >= 60) return 'score-mid';
    return 'score-low';
  }

  function scoreColor(score) {
    if (score >= 80) return '#10b981';
    if (score >= 70) return '#22c55e';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
  }

  function severityColor(sev) {
    if (sev === 'critical') return '#ef4444';
    if (sev === 'important') return '#f59e0b';
    return '#94a3b8';
  }

  function showMessage(msg, isError) {
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
    contentEl.innerHTML = '<div style="text-align:center;padding:80px 0;">' +
      '<p style="font-size:16px;color:' + (isError ? 'var(--cc-danger)' : 'var(--cc-text-secondary)') + ';">' + esc(msg) + '</p>' +
      '<a href="/conversioncore/" style="display:inline-block;margin-top:16px;padding:10px 24px;background:var(--cc-accent);color:#fff;border-radius:8px;">Back to ConversionCore</a>' +
      '</div>';
  }

  function esc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
