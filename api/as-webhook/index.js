// as-webhook — POST /api/as-webhook
// Stripe webhook handler. On checkout.session.completed, unlocks the stored report.

const storage = require('../_utils/companyStorage');
const stripeClient = require('../_lib/ambientScore/stripeClient');

module.exports = async function (context, req) {
  try {
    const signature = req.headers['stripe-signature'];
    const rawBody = req.rawBody || req.body;

    if (!signature || !rawBody) {
      context.res = { status: 400, body: 'Missing signature or body' };
      return;
    }

    // Verify webhook signature
    const payload = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
    if (!stripeClient.verifyWebhookSignature(payload, signature)) {
      context.log.warn('[as-webhook] Invalid signature');
      context.res = { status: 401, body: 'Invalid signature' };
      return;
    }

    let event;
    try {
      event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    } catch (parseErr) {
      context.log.warn('[as-webhook] Failed to parse webhook body:', parseErr.message);
      context.res = { status: 400, body: 'Invalid JSON payload' };
      return;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const reportId = session.metadata?.reportId;
      const email = session.customer_details?.email;

      if (reportId) {
        // Unlock the report
        const report = await storage.getState('cc_report_' + reportId);
        if (report) {
          report.unlocked = true;
          report.paidAt = new Date().toISOString();
          report.customerEmail = email || null;
          report.stripeSessionId = session.id;
          report.priceType = (session.metadata && session.metadata.priceType) || 'single';
          await storage.setState('cc_report_' + reportId, report);
          context.log('[as-webhook] Report unlocked: ' + reportId);

          // Grant pack credits if this was a 3-pack purchase
          var priceType = session.metadata && session.metadata.priceType;
          if (priceType === 'pack' && email) {
            try {
              var creditUtils = require('../_lib/ambientScore/creditUtils');
              var creditResult = await creditUtils.grantPackCredits({
                email: email,
                stripeSessionId: session.id,
                reportId: reportId
              });
              if (creditResult) {
                context.log('[as-webhook] Pack credits created for ' + email + ': ' + creditResult.credits + ' remaining');
              }
            } catch (creditErr) {
              context.log.warn('[as-webhook] Credit creation failed (non-fatal):', creditErr.message);
            }
          }

          // Send email if available (non-blocking)
          if (email) {
            try {
              const emailSender = require('../_lib/ambientScore/emailSender');
              await emailSender.sendReportEmail(email, report);
            } catch (emailErr) {
              context.log.warn('[as-webhook] Email failed:', emailErr.message);
            }
          }
        } else {
          context.log.warn('[as-webhook] Report not found for: ' + reportId + ' (may still be generating)');
        }
      }
    }

    // Always return 200 to Stripe
    context.res = { status: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    context.log.error('[as-webhook] Error:', err.message || err);
    // Still return 200 to prevent Stripe retries on our errors
    context.res = { status: 200, body: JSON.stringify({ received: true, error: err.message }) };
  }
};
