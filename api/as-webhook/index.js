// as-webhook — POST /api/as-webhook
// Stripe webhook handler. On checkout.session.completed, unlocks the stored report.

const storage = require('../_utils/companyStorage');
const stripeClient = require('../_lib/ambientScore/stripeClient');
const revenueRecorder = require('../_lib/stripe/recordWebhookRevenue');

// Withdraw report access when the money goes back. The revenue ledger already
// recorded these events; nothing ever re-locked the report, so a refunded or
// charged-back customer kept the thing they paid for indefinitely.
// Non-fatal throughout: the webhook must always return 200.
async function revokeReportAccess(context, obj, kind) {
  try {
    let paymentIntent = obj.payment_intent || null;
    if (!paymentIntent && obj.charge) {
      const charge = await stripeClient.retrieveCharge(obj.charge);
      paymentIntent = charge && charge.payment_intent;
    }
    if (!paymentIntent) {
      context.log.warn('[as-webhook] ' + kind + ' with no payment_intent, cannot match a report');
      return;
    }

    const session = await stripeClient.findCheckoutSessionByPaymentIntent(paymentIntent);
    const reportId = session && session.metadata && session.metadata.reportId;
    if (!reportId) {
      // Teardown and rewrite orders have no reportId — nothing to revoke here.
      context.log('[as-webhook] ' + kind + ' had no reportId in session metadata, nothing to revoke');
      return;
    }

    const report = await storage.getState('cc_report_' + reportId);
    if (!report) {
      context.log.warn('[as-webhook] ' + kind + ' for missing report ' + reportId);
      return;
    }
    if (!report.unlocked) {
      context.log('[as-webhook] ' + kind + ' for already-locked report ' + reportId);
      return;
    }

    report.unlocked = false;
    report.revokedAt = new Date().toISOString();
    report.revokedReason = kind;
    await storage.setState('cc_report_' + reportId, report);
    context.log('[as-webhook] Report access revoked after ' + kind + ': ' + reportId);
  } catch (err) {
    context.log.error('[as-webhook] Access revoke failed after ' + kind + ' (manual recovery may be needed):', err.message);
  }
}

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

      // Rewrite orders ($9 Deep Roast Rewrite) — flip the pre-created order to
      // paid; composition happens on the delivery page's first poll (or the
      // runner backstop). Every side effect is non-fatal: always return 200.
      if (session.metadata?.rewrite === '1') {
        const rrComposer = require('../_lib/roastRewrite/composer');
        let rrOrder = null;
        const rrOrderIdMeta = (session.metadata && session.metadata.orderId) || '?';
        try {
          const nowIso = new Date().toISOString();
          let rrReason = null;
          const res = await storage.mutateState('roast_rewrite_queue', function (fresh) {
            const result = rrComposer.markPaid(fresh || [], session, nowIso);
            rrReason = result.reason;
            if (!result.order) return undefined;
            rrOrder = result.order;
            return result.queue;
          });
          if (!res.ok) {
            rrOrder = null;
            context.log.error('[as-webhook] Rewrite order update FAILED (manual recovery needed) for session ' + session.id + ' orderId=' + rrOrderIdMeta + ' key=roast_rewrite_queue: mutateState reported not ok');
          } else if (rrOrder && res.written) {
            context.log('[as-webhook] Rewrite order paid: ' + rrOrder.orderId);
          } else if (rrReason === 'missing' || rrReason === 'bad-status') {
            rrOrder = null;
            context.log.error('[as-webhook] Rewrite payment with NO matching order (manual recovery needed): session ' + session.id + ' orderId=' + rrOrderIdMeta + ' reason=' + rrReason);
          } else {
            rrOrder = null;
            context.log('[as-webhook] Rewrite session already processed, order missing, or write skipped: ' + session.id + ' reason=' + rrReason);
          }
        } catch (rrErr) {
          rrOrder = null;
          context.log.error('[as-webhook] Rewrite order update FAILED (manual recovery needed) for session ' + session.id + ' orderId=' + rrOrderIdMeta + ' key=roast_rewrite_queue:', rrErr.message);
        }

        if (rrOrder) {
          try {
            const pa = require('../_utils/productAnalytics');
            await pa.emitEvent('pixelagents', 'rewrite_purchase',
              { orderId: rrOrder.orderId, agentId: 'resume-roast' },
              { category: 'conversion', source: 'server' });
          } catch (paErr) {
            context.log.warn('[as-webhook] rewrite_purchase event failed (non-fatal):', paErr.message);
          }
          try {
            const { dispatchDiscord } = require('../_utils/fleetAlerts');
            await dispatchDiscord({
              title: 'Rewrite order paid: $9',
              description: 'Deep Roast Rewrite ' + rrOrder.orderId + (rrOrder.email ? (' for ' + rrOrder.email) : ''),
              color: 0x2E7D32
            });
          } catch (alertErr) {
            context.log.warn('[as-webhook] Rewrite Discord alert failed (non-fatal):', alertErr.message);
          }
        }

        await revenueRecorder.recordCheckoutRevenue({
          event: event,
          session: session,
          product: 'pixelagents',
          type: 'one_time',
          plan: 'roast_rewrite',
          fallbackCents: 900,
          log: context.log
        });

        context.res = { status: 200, body: JSON.stringify({ received: true }) };
        return;
      }

      // Teardown orders ($199 done-for-you) — queue for asTeardownRunner and
      // stop here; they carry no reportId so nothing below applies. Every
      // side effect is non-fatal: the webhook must always return 200.
      if (session.metadata?.teardown === '1') {
        const composer = require('../_lib/ambientScore/teardownComposer');
        let order = null;
        try {
          const queue = (await storage.getState('as_teardown_queue')) || [];
          const result = composer.queueTeardownOrder(session, queue, new Date().toISOString());
          order = result.order;
          if (order) {
            await storage.setState('as_teardown_queue', result.queue);
            context.log('[as-webhook] Teardown order queued: ' + order.orderId + ' for ' + order.url);
          } else {
            context.log('[as-webhook] Teardown session already queued or invalid: ' + session.id);
          }
        } catch (queueErr) {
          context.log.error('[as-webhook] Teardown queueing failed:', queueErr.message);
        }

        if (order && order.email) {
          try {
            const emailSender = require('../_lib/ambientScore/emailSender');
            await emailSender.sendTeardownAckEmail(order.email, order.orderId);
          } catch (ackErr) {
            context.log.warn('[as-webhook] Teardown ack email failed (non-fatal):', ackErr.message);
          }
        }

        if (order) {
          try {
            const { dispatchDiscord } = require('../_utils/fleetAlerts');
            await dispatchDiscord({
              title: 'Teardown order paid: $199',
              description: order.url + (order.goal ? ('\nGoal: ' + order.goal) : '') + '\nDraft lands within 15 minutes.',
              color: 0x2E7D32
            });
          } catch (alertErr) {
            context.log.warn('[as-webhook] Teardown Discord alert failed (non-fatal):', alertErr.message);
          }
        }

        await revenueRecorder.recordCheckoutRevenue({
          event: event,
          session: session,
          product: 'ambientscore',
          type: 'one_time',
          plan: 'teardown',
          fallbackCents: 19900,
          log: context.log
        });

        context.res = { status: 200, body: JSON.stringify({ received: true }) };
        return;
      }

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

      // Record company revenue (idempotent on event.id, non-fatal — never breaks the unlock).
      await revenueRecorder.recordCheckoutRevenue({
        event: event,
        session: session,
        product: 'ambientscore',
        type: 'one_time',
        plan: (session.metadata && session.metadata.priceType) || 'single',
        fallbackCents: ((session.metadata && session.metadata.priceType) === 'pack') ? 8900 : 2900,
        log: context.log
      });
    } else if (event.type === 'charge.refunded') {
      await revenueRecorder.recordRefundFromEvent({ event: event, product: 'ambientscore', kind: 'refund', log: context.log });
      await revokeReportAccess(context, event.data.object || {}, 'refund');
    } else if (event.type === 'charge.dispute.created') {
      await revenueRecorder.recordRefundFromEvent({ event: event, product: 'ambientscore', kind: 'dispute', log: context.log });
      await revokeReportAccess(context, event.data.object || {}, 'dispute');
    }

    // Always return 200 to Stripe
    context.res = { status: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    context.log.error('[as-webhook] Error:', err.message || err);
    // Still return 200 to prevent Stripe retries on our errors
    context.res = { status: 200, body: JSON.stringify({ received: true, error: err.message }) };
  }
};
