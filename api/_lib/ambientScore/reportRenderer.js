// reportRenderer.js — AmbientScore HTML report template
// Generates self-contained HTML report for email embedding or standalone viewing

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function severityColor(severity) {
  if (severity === 'critical') return '#ef4444';
  if (severity === 'important') return '#f59e0b';
  return '#94a3b8';
}

function scoreColor(score) {
  if (score >= 80) return '#10b981';
  if (score >= 65) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function effortBadge(effort) {
  if (effort === 'quick') return '<span style="background:rgba(16,185,129,0.15);color:#10b981;padding:2px 8px;border-radius:4px;font-size:11px;">Quick Fix</span>';
  if (effort === 'rebuild') return '<span style="background:rgba(239,68,68,0.15);color:#ef4444;padding:2px 8px;border-radius:4px;font-size:11px;">Rebuild</span>';
  return '<span style="background:rgba(245,158,11,0.15);color:#f59e0b;padding:2px 8px;border-radius:4px;font-size:11px;">Medium</span>';
}

/**
 * Render a full HTML report from report data.
 * Self-contained — all CSS inline for email compatibility.
 */
function renderReportHtml(report) {
  const dims = report.dimensions || {};
  const synthesis = report.synthesis || {};
  const findings = report.findings || [];

  // Dimension score bars
  const dimBars = Object.entries(dims).map(([id, d]) => {
    const pct = Math.max(0, Math.min(100, d.score));
    return `
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:13px;color:#e2e8f0;">${escapeHtml(d.label)}</span>
          <span style="font-size:13px;font-weight:600;color:${scoreColor(d.score)};">${d.score} (${d.grade})${d.partial ? ' *' : ''}</span>
        </div>
        <div style="height:8px;background:#1e293b;border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${scoreColor(d.score)};border-radius:4px;"></div>
        </div>
      </div>`;
  }).join('');

  // Findings table
  const findingsRows = findings.map(f => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:${severityColor(f.severity)};font-weight:600;font-size:12px;text-transform:uppercase;">${escapeHtml(f.severity)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1e293b;font-size:13px;color:#94a3b8;">${escapeHtml(f.dimensionLabel)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1e293b;font-size:13px;color:#e2e8f0;">${escapeHtml(f.finding)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1e293b;font-size:13px;color:#cbd5e1;">${escapeHtml(f.recommendation)}</td>
    </tr>`).join('');

  // Top priorities
  const priorities = (synthesis.topPriorities || []).map(p => `
    <div style="background:#0f172a;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:16px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h4 style="margin:0;color:#e2e8f0;font-size:15px;">#${p.rank} ${escapeHtml(p.title)}</h4>
        ${effortBadge(p.effort)}
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#cbd5e1;">${escapeHtml(p.description)}</p>
      <p style="margin:0;font-size:12px;color:#94a3b8;">Expected impact: <strong style="color:#10b981;">${escapeHtml(p.estimatedImpact)}</strong></p>
    </div>`).join('');

  // Headline rewrites
  const headlineRewrites = (synthesis.headlineRewrites || []).map(r => `
    <div style="background:#0f172a;border-left:3px solid #10b981;padding:12px 16px;margin-bottom:8px;border-radius:0 8px 8px 0;">
      <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">Current:</p>
      <p style="margin:0 0 8px;font-size:14px;color:#f87171;text-decoration:line-through;">${escapeHtml(r.current)}</p>
      <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">Suggested:</p>
      <p style="margin:0 0 8px;font-size:14px;color:#10b981;font-weight:600;">${escapeHtml(r.suggested)}</p>
      <p style="margin:0;font-size:12px;color:#64748b;">${escapeHtml(r.rationale)}</p>
    </div>`).join('');

  // CTA rewrites
  const ctaRewrites = (synthesis.ctaRewrites || []).map(r => `
    <div style="background:#0f172a;border-left:3px solid #f59e0b;padding:12px 16px;margin-bottom:8px;border-radius:0 8px 8px 0;">
      <span style="display:inline-block;padding:6px 16px;background:#374151;color:#f87171;border-radius:6px;font-size:13px;margin-right:8px;text-decoration:line-through;">${escapeHtml(r.current)}</span>
      <span style="font-size:13px;color:#64748b;margin-right:8px;">→</span>
      <span style="display:inline-block;padding:6px 16px;background:#10b981;color:#fff;border-radius:6px;font-size:13px;font-weight:600;">${escapeHtml(r.suggested)}</span>
      <p style="margin:8px 0 0;font-size:12px;color:#64748b;">${escapeHtml(r.rationale)}</p>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AmbientScore Audit: ${escapeHtml(report.url)}</title>
</head>
<body style="margin:0;padding:0;background:#071019;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;">
  <div style="max-width:800px;margin:0 auto;padding:40px 24px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:40px;">
      <h1 style="color:#10b981;font-size:24px;margin:0 0 4px;">AmbientScore</h1>
      <p style="color:#94a3b8;font-size:14px;margin:0;">AmbientScore Audit Report</p>
      <p style="color:#64748b;font-size:12px;margin:8px 0 0;">${escapeHtml(report.url)} &middot; ${new Date(report.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>

    <!-- Score -->
    <div style="text-align:center;background:#0d1a2a;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;margin-bottom:32px;">
      <div style="display:inline-block;width:120px;height:120px;line-height:120px;border-radius:50%;background:${report.score >= 65 ? 'rgba(16,185,129,0.12)' : report.score >= 50 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)'};font-size:42px;font-weight:700;color:${scoreColor(report.score)};">
        ${report.score}
      </div>
      <p style="margin:16px 0 4px;font-size:14px;color:#94a3b8;">AmbientScore</p>
      <p style="margin:0;font-size:22px;font-weight:600;color:#e2e8f0;">Grade: ${report.grade}</p>
    </div>

    <!-- Executive Summary -->
    ${synthesis.executiveSummary ? `
    <div style="background:#0d1a2a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;margin-bottom:24px;">
      <h2 style="margin:0 0 12px;font-size:18px;color:#e2e8f0;">Executive Summary</h2>
      <p style="margin:0 0 12px;font-size:14px;color:#cbd5e1;">${escapeHtml(synthesis.executiveSummary)}</p>
      ${synthesis.conversionHealthAssessment ? `<p style="margin:0;font-size:13px;color:#94a3b8;">${escapeHtml(synthesis.conversionHealthAssessment)}</p>` : ''}
    </div>` : ''}

    <!-- Dimension Scores -->
    <div style="background:#0d1a2a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;margin-bottom:24px;">
      <h2 style="margin:0 0 16px;font-size:18px;color:#e2e8f0;">Dimension Scores</h2>
      ${dimBars}
      ${report.disclaimer ? `<p style="font-size:11px;color:#64748b;margin:12px 0 0;">* ${escapeHtml(report.disclaimer)}</p>` : ''}
    </div>

    <!-- Top Priorities -->
    ${priorities ? `
    <div style="margin-bottom:24px;">
      <h2 style="margin:0 0 16px;font-size:18px;color:#e2e8f0;">Top Priorities</h2>
      ${priorities}
    </div>` : ''}

    <!-- Headline Rewrites -->
    ${headlineRewrites ? `
    <div style="margin-bottom:24px;">
      <h2 style="margin:0 0 16px;font-size:18px;color:#e2e8f0;">Headline Rewrites</h2>
      ${headlineRewrites}
    </div>` : ''}

    <!-- CTA Rewrites -->
    ${ctaRewrites ? `
    <div style="margin-bottom:24px;">
      <h2 style="margin:0 0 16px;font-size:18px;color:#e2e8f0;">CTA Improvements</h2>
      ${ctaRewrites}
    </div>` : ''}

    <!-- All Findings -->
    ${findingsRows ? `
    <div style="margin-bottom:24px;">
      <h2 style="margin:0 0 16px;font-size:18px;color:#e2e8f0;">All Findings (${findings.length})</h2>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;background:#0d1a2a;border-radius:12px;">
          <thead>
            <tr style="border-bottom:2px solid #1e293b;">
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Severity</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Dimension</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Finding</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Recommendation</th>
            </tr>
          </thead>
          <tbody>${findingsRows}</tbody>
        </table>
      </div>
    </div>` : ''}

    <!-- Strategic Opportunities -->
    ${(synthesis.strategicOpportunities || []).length > 0 ? `
    <div style="background:#0d1a2a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;margin-bottom:24px;">
      <h2 style="margin:0 0 12px;font-size:18px;color:#e2e8f0;">Strategic Opportunities</h2>
      ${synthesis.strategicOpportunities.map(s => `<p style="margin:0 0 8px;font-size:14px;color:#cbd5e1;padding-left:16px;border-left:2px solid #10b981;">${escapeHtml(s)}</p>`).join('')}
    </div>` : ''}

    <!-- Upsell -->
    <div style="background:linear-gradient(135deg,#0d1a2a,#1a2332);border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:32px;margin-bottom:24px;text-align:center;">
      <h3 style="margin:0 0 8px;font-size:18px;color:#e2e8f0;">Want these fixes implemented?</h3>
      <p style="margin:0 0 20px;font-size:14px;color:#94a3b8;">AmbientPixels offers messaging rewrites, funnel restructuring, CTA optimization, and AI-driven content integration.</p>
      <a href="https://ambientpixels.ai/contact" style="display:inline-block;padding:12px 28px;background:#10b981;color:#fff;font-weight:600;font-size:14px;text-decoration:none;border-radius:8px;">Book a Strategy Call</a>
    </div>

    <!-- Methodology -->
    <div style="background:#0d1a2a;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:16px;margin-bottom:24px;">
      <p style="margin:0;font-size:11px;color:#64748b;">
        <strong>Methodology:</strong> This report evaluates 8 conversion dimensions using structured analysis of visible page content.
        Scores reflect observable elements and are computed deterministically from rubric-based criteria.
        This analysis does not include traffic data, A/B test results, or analytics.
      </p>
    </div>

    ${report.jsRenderedWarning ? `
    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:12px;margin-bottom:24px;">
      <p style="margin:0;font-size:12px;color:#f59e0b;">${escapeHtml(report.jsRenderedWarning)}</p>
    </div>` : ''}

    <!-- Footer -->
    <div style="text-align:center;color:#475569;font-size:11px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.04);">
      <p style="margin:0;">Powered by <a href="https://ambientpixels.ai/ambientscore" style="color:#10b981;text-decoration:none;">AmbientScore</a> by AmbientPixels</p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { renderReportHtml };
