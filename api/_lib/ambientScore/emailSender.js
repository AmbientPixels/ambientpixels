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

// ── Teardown emails ($199 done-for-you product) ──────────────────
// Editorial register: cream paper, ink text, single red accent. No em dashes.

// Derive a plaintext part from the HTML — multipart mail out-delivers
// HTML-only from young sender domains by a wide margin.
function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2: $1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&rsaquo;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function sendAcsEmail(toEmail, subject, innerHtml) {
  if (!ACS_CONNECTION_STRING) {
    console.warn('[AS Email] ACS_CONNECTION_STRING not configured, skipping email');
    return false;
  }
  try {
    const { EmailClient } = require('@azure/communication-email');
    const client = new EmailClient(ACS_CONNECTION_STRING);
    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F3EEE3;color:#1A1613;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <div style="border-bottom:2px solid #1A1613;padding-bottom:12px;margin-bottom:28px;">
      <p style="margin:0;font-family:Courier,monospace;font-size:11px;letter-spacing:0.18em;color:#8C2F1E;">AMBIENTSCORE &rsaquo; CONVERSION TEARDOWN</p>
    </div>
    ${innerHtml}
    <div style="margin-top:40px;padding-top:16px;border-top:1px solid #D4CBB5;font-size:12px;color:#6B6052;">
      <p style="margin:0;">Issued by AmbientScore. <a href="https://ambientpixels.ai/ambientscore/" style="color:#8C2F1E;">ambientpixels.ai/ambientscore</a></p>
    </div>
  </div>
</body>
</html>`;
    const message = {
      senderAddress: process.env.ACS_SENDER_EMAIL || 'DoNotReply@ambientpixels.ai',
      content: { subject, html: htmlBody, plainText: htmlToPlainText(innerHtml) },
      recipients: { to: [{ address: toEmail }] }
    };
    const poller = await client.beginSend(message);
    await poller.pollUntilDone();
    return true;
  } catch (err) {
    console.error('[AS Email] Send failed:', err.message);
    return false;
  }
}

async function sendTeardownAckEmail(toEmail, orderId) {
  return sendAcsEmail(toEmail,
    'Order received: your Conversion Teardown is underway',
    `
    <h1 style="font-size:26px;margin:0 0 16px;">Your teardown is underway.</h1>
    <p style="font-size:15px;line-height:1.6;color:#3D342C;">Thank you for your order. Our audit engine is analyzing your site now, and a strategist reviews every teardown before it ships. You will receive the full document at this address within 48 hours.</p>
    <p style="font-size:13px;color:#6B6052;">Order reference: <span style="font-family:Courier,monospace;">${escapeHtml(orderId)}</span></p>`);
}

async function sendTeardownCeoNotify(doc, previewLink) {
  const ceoEmails = String(process.env.CEO_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (ceoEmails.length === 0) return false;
  return sendAcsEmail(ceoEmails[0],
    'Teardown draft ready: ' + (doc.url || 'unknown') + ' (' + (doc.score || '?') + '/100)',
    `
    <h1 style="font-size:24px;margin:0 0 16px;">Draft ready for review.</h1>
    <p style="font-size:15px;line-height:1.6;color:#3D342C;">${escapeHtml(doc.url || '')} scored ${escapeHtml(String(doc.score || '?'))}/100. Review the draft, edit if needed, then press Deliver on the page.</p>
    <p style="margin:24px 0;"><a href="${previewLink}" style="display:inline-block;padding:12px 28px;background:#1A1613;color:#F3EEE3;font-family:Courier,monospace;font-size:13px;letter-spacing:0.08em;text-decoration:none;">REVIEW AND DELIVER</a></p>
    <p style="font-size:13px;color:#6B6052;">Buyer: ${escapeHtml(doc.email || 'no email on order')}</p>`);
}

async function sendTeardownDeliveryEmail(toEmail, doc, viewLink) {
  const topKiller = doc.teardown && doc.teardown.killers && doc.teardown.killers[0];
  return sendAcsEmail(toEmail,
    'Your Conversion Teardown is ready: ' + (doc.url || 'your site'),
    `
    <h1 style="font-size:26px;margin:0 0 16px;">Your teardown is ready.</h1>
    <p style="font-size:15px;line-height:1.6;color:#3D342C;">We audited ${escapeHtml(doc.url || 'your site')} and it scored <strong>${escapeHtml(String(doc.score || '?'))}/100</strong>. Inside: the five conversion killers costing you signups, rewritten copy you can paste in today, and a four week fix order.</p>
    ${topKiller ? `<div style="border-left:3px solid #8C2F1E;padding:12px 16px;margin:20px 0;background:#FBF7EB;">
      <p style="margin:0;font-family:Courier,monospace;font-size:11px;letter-spacing:0.14em;color:#8C2F1E;">K-01 &rsaquo; ${escapeHtml(topKiller.title || '')}</p>
    </div>` : ''}
    <p style="margin:24px 0;"><a href="${viewLink}" style="display:inline-block;padding:12px 28px;background:#1A1613;color:#F3EEE3;font-family:Courier,monospace;font-size:13px;letter-spacing:0.08em;text-decoration:none;">OPEN YOUR TEARDOWN</a></p>
    <p style="font-size:13px;color:#6B6052;">Keep this email: the link above is your permanent access to the document.</p>`);
}

module.exports = { sendReportEmail, sendTeardownAckEmail, sendTeardownCeoNotify, sendTeardownDeliveryEmail };
