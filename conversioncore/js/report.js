// report.js — ConversionCore report viewer
// Loads report data from API, renders full report or paywall

(function () {
  'use strict';

  var API = '/api';
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
        if (err.message === 'not_found') {
          showMessage('Report not found. It may still be generating — please refresh in a few seconds.', false);
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
      '</div>';
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
        html += '<span class="cc-effort-badge ' + effortClass + '">' + esc(p.effort || 'medium') + '</span>';
        html += '</div>';
        html += '<p class="cc-priority-desc">' + esc(p.description) + '</p>';
        html += '<span class="cc-priority-impact">Expected impact: ' + esc(p.estimatedImpact) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    // Headline Rewrites
    if (synth.headlineRewrites && synth.headlineRewrites.length > 0) {
      html += '<div class="cc-section">';
      html += '<h2>Headline Rewrites</h2>';
      synth.headlineRewrites.forEach(function (r) {
        html += '<div class="cc-rewrite">';
        html += '<div class="cc-rewrite-label">Current:</div>';
        html += '<div class="cc-rewrite-current">' + esc(r.current) + '</div>';
        html += '<div class="cc-rewrite-label">Suggested:</div>';
        html += '<div class="cc-rewrite-suggested">' + esc(r.suggested) + '</div>';
        html += '<div class="cc-rewrite-rationale">' + esc(r.rationale) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    // CTA Rewrites
    if (synth.ctaRewrites && synth.ctaRewrites.length > 0) {
      html += '<div class="cc-section">';
      html += '<h2>CTA Improvements</h2>';
      synth.ctaRewrites.forEach(function (r) {
        html += '<div class="cc-rewrite" style="border-left-color:var(--cc-warning);">';
        html += '<span style="display:inline-block;padding:6px 14px;background:#374151;color:#f87171;border-radius:6px;font-size:13px;text-decoration:line-through;">' + esc(r.current) + '</span>';
        html += ' <span style="color:var(--cc-text-muted);margin:0 8px;">→</span> ';
        html += '<span style="display:inline-block;padding:6px 14px;background:var(--cc-accent);color:#fff;border-radius:6px;font-size:13px;font-weight:600;">' + esc(r.suggested) + '</span>';
        html += '<div class="cc-rewrite-rationale" style="margin-top:8px;">' + esc(r.rationale) + '</div>';
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
        html += '<td style="color:var(--cc-text);">' + esc(f.finding) + '</td>';
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
    html += '<div class="cc-report-upsell">';
    html += '<h3>Want these fixes implemented?</h3>';
    html += '<p>AmbientPixels offers messaging rewrites, funnel restructuring, CTA optimization, and AI-driven content integration.</p>';
    html += '<a href="https://ambientpixels.ai/contact">Book a Strategy Call</a>';
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

  function scoreClass(score) {
    if (score >= 65) return 'score-high';
    if (score >= 50) return 'score-mid';
    return 'score-low';
  }

  function scoreColor(score) {
    if (score >= 80) return '#10b981';
    if (score >= 65) return '#22c55e';
    if (score >= 50) return '#f59e0b';
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
