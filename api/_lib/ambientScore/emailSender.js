// emailSender.js — AmbientScore email delivery via Azure Communication Services

const ACS_CONNECTION_STRING = process.env.ACS_CONNECTION_STRING;

async function sendReportEmail(toEmail, report) {
  if (!ACS_CONNECTION_STRING) {
    console.warn('[AS Email] ACS_CONNECTION_STRING not configured, skipping email');
    return false;
  }

  try {
    const { EmailClient } = require('@azure/communication-email');
    const client = new EmailClient(ACS_CONNECTION_STRING);

    const reportUrl = (process.env.AS_SITE_URL || process.env.CC_SITE_URL || 'https://ambientpixels.ai') +
      '/ambientscore/report.html?id=' + (report.id || '');

    const topFindings = (report.findings || []).slice(0, 3)
      .map((f, i) => `<tr><td style="padding:8px;border-bottom:1px solid #333;">${i + 1}</td><td style="padding:8px;border-bottom:1px solid #333;"><span style="color:${f.severity === 'critical' ? '#ef4444' : f.severity === 'important' ? '#f59e0b' : '#94a3b8'};font-weight:600;">${f.severity.toUpperCase()}</span></td><td style="padding:8px;border-bottom:1px solid #333;">${escapeHtml(f.finding)}</td></tr>`)
      .join('');

    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#071019;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="color:#10b981;font-size:28px;margin:0;">AmbientScore</h1>
      <p style="color:#94a3b8;margin:8px 0 0;">Your AmbientScore Audit Report is Ready</p>
    </div>

    <div style="background:#0d1a2a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:32px;margin-bottom:24px;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;width:100px;height:100px;line-height:100px;border-radius:50%;background:${report.score >= 65 ? 'rgba(16,185,129,0.15)' : report.score >= 50 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)'};font-size:36px;font-weight:700;color:${report.score >= 65 ? '#10b981' : report.score >= 50 ? '#f59e0b' : '#ef4444'};">
          ${report.score}
        </div>
        <p style="margin:12px 0 0;font-size:14px;color:#94a3b8;">AmbientScore</p>
        <p style="margin:4px 0 0;font-size:20px;font-weight:600;color:#e2e8f0;">Grade: ${report.grade}</p>
      </div>

      <p style="font-size:14px;color:#94a3b8;text-align:center;">
        URL analyzed: <strong style="color:#e2e8f0;">${escapeHtml(report.url)}</strong>
      </p>
    </div>

    ${topFindings ? `
    <div style="background:#0d1a2a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;margin-bottom:24px;">
      <h3 style="color:#e2e8f0;margin:0 0 16px;">Top Findings</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#cbd5e1;">
        ${topFindings}
      </table>
    </div>
    ` : ''}

    <div style="text-align:center;margin:32px 0;">
      <a href="${reportUrl}" style="display:inline-block;padding:14px 32px;background:#10b981;color:#fff;font-weight:600;font-size:16px;text-decoration:none;border-radius:8px;">
        View Full Report
      </a>
    </div>

    <div style="text-align:center;color:#64748b;font-size:12px;margin-top:40px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.06);">
      <p>Powered by <a href="https://ambientpixels.ai" style="color:#10b981;text-decoration:none;">AmbientScore</a> by AmbientPixels</p>
    </div>
  </div>
</body>
</html>`;

    const message = {
      senderAddress: process.env.ACS_SENDER_EMAIL || 'DoNotReply@ambientpixels.ai',
      content: {
        subject: 'Your AmbientScore Audit: ' + (report.url || 'Website') + ' (Score: ' + report.score + '/100)',
        html: htmlBody
      },
      recipients: {
        to: [{ address: toEmail }]
      }
    };

    const poller = await client.beginSend(message);
    await poller.pollUntilDone();
    return true;

  } catch (err) {
    console.error('[AS Email] Send failed:', err.message);
    return false;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendReportEmail };
