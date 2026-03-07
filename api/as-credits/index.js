// as-credits — POST /api/as-credits
// Credit check + redeem for AmbientScore 3-pack purchases
// Actions: "check" (lookup balance), "redeem" (use 1 credit to unlock a report)

const storage = require('../_utils/companyStorage');
const { emailToCreditsKey } = require('../_lib/ambientScore/creditUtils');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function maskEmail(email) {
  var parts = (email || '').split('@');
  if (parts.length !== 2) return '***';
  var local = parts[0];
  var masked = local.length <= 3
    ? local[0] + '***'
    : local.slice(0, 3) + '***';
  return masked + '@' + parts[1];
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS };
    return;
  }

  try {
    var body = req.body || {};
    var action = body.action;
    var email = (body.email || '').trim().toLowerCase();

    if (!email || email.indexOf('@') === -1) {
      context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'Valid email required.' }) };
      return;
    }

    var creditsKey = emailToCreditsKey(email);
    var record = await storage.getState(creditsKey);

    // ── Check balance ──────────────────────────────
    if (action === 'check') {
      if (!record || record.email !== email) {
        context.res = { status: 200, headers: CORS, body: JSON.stringify({ ok: true, credits: 0, email: maskEmail(email) }) };
        return;
      }
      context.res = {
        status: 200,
        headers: CORS,
        body: JSON.stringify({ ok: true, credits: record.credits, email: maskEmail(email) })
      };
      return;
    }

    // ── Redeem credit ──────────────────────────────
    if (action === 'redeem') {
      var reportId = (body.reportId || '').trim();

      if (!reportId || !reportId.startsWith('ccr_')) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'Valid report ID required.' }) };
        return;
      }

      if (!record || record.email !== email || record.credits < 1) {
        context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'No credits available for this email.' }) };
        return;
      }

      var report = await storage.getState('cc_report_' + reportId);
      if (!report) {
        context.res = { status: 404, headers: CORS, body: JSON.stringify({ error: 'Report not found. It may still be generating — try again in a few seconds.' }) };
        return;
      }

      // Already unlocked — return success without deducting
      if (report.unlocked) {
        context.res = {
          status: 200,
          headers: CORS,
          body: JSON.stringify({
            ok: true,
            credits: record.credits,
            reportId: reportId,
            reportUrl: '/ambientscore/report.html?id=' + reportId,
            alreadyUnlocked: true
          })
        };
        return;
      }

      // Unlock report
      report.unlocked = true;
      report.paidAt = new Date().toISOString();
      report.customerEmail = email;
      report.redeemedViaCredit = true;
      report.priceType = 'pack';
      await storage.setState('cc_report_' + reportId, report);

      // Deduct credit
      record.credits -= 1;
      record.totalRedeemed += 1;
      record.history.push({
        type: 'redeem',
        credits: -1,
        reportId: reportId,
        timestamp: new Date().toISOString()
      });
      if (record.history.length > 100) record.history = record.history.slice(-100);
      record.updatedAt = new Date().toISOString();
      await storage.setState(creditsKey, record);

      context.log('[as-credits] Credit redeemed by ' + maskEmail(email) + ' for ' + reportId + '. Remaining: ' + record.credits);

      // Send email (non-blocking, non-fatal)
      try {
        var emailSender = require('../_lib/ambientScore/emailSender');
        await emailSender.sendReportEmail(email, report);
      } catch (emailErr) {
        context.log.warn('[as-credits] Email failed:', emailErr.message);
      }

      context.res = {
        status: 200,
        headers: CORS,
        body: JSON.stringify({
          ok: true,
          credits: record.credits,
          reportId: reportId,
          reportUrl: '/ambientscore/report.html?id=' + reportId
        })
      };
      return;
    }

    context.res = { status: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action. Use "check" or "redeem".' }) };

  } catch (err) {
    context.log.error('[as-credits] Error:', err.message || err);
    context.res = { status: 500, headers: CORS, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
