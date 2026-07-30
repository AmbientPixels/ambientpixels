// asTeardownRunner — Timer Trigger (every 15 min at :05, clears the cron grid:
// heartbeat :00 even hours, asScanRunner :10s, asProspectCron :25, outcomeRefresh 14:35).
//
// Fulfills paid $199 Conversion Teardown orders from `as_teardown_queue`:
//   paid -> processing -> draft_ready -> (CEO deliver via as-teardown) -> delivered
//
// One order per tick (each analysis is ~5 Claude calls); at current volume the
// 48h SLA has two orders of magnitude of headroom. Crash self-heal: an order
// stuck in 'processing' >2h goes back to 'paid' (retryCount++) until retries
// are exhausted (composer.advanceQueue owns that state machine).

const storage = require('../_utils/companyStorage');
const { analyze, callClaude } = require('../_lib/ambientScore/analyzer');
const composer = require('../_lib/ambientScore/teardownComposer');
const { dispatchDiscord } = require('../_utils/fleetAlerts');

const SITE_URL = process.env.AS_SITE_URL || process.env.CC_SITE_URL || 'https://ambientpixels.ai';

module.exports = async function (context) {
  let queue;
  try {
    queue = (await storage.getState('as_teardown_queue')) || [];
  } catch (err) {
    context.log.error('[asTeardownRunner] queue load failed:', err.message);
    return;
  }
  if (!Array.isArray(queue) || queue.length === 0) return;

  // Self-heal stale processing entries before picking up new work.
  const healed = composer.advanceQueue(queue, Date.now());
  queue = healed.queue;
  if (healed.resets || healed.failed) {
    context.log('[asTeardownRunner] self-heal: resets=' + healed.resets + ' failed=' + healed.failed);
    try { await storage.setState('as_teardown_queue', queue); } catch (e) { /* retried next tick */ }
    if (healed.failed) {
      await dispatchDiscord({
        title: 'Teardown order FAILED after retries',
        description: 'Check as_teardown_queue for status failed. Refund may be owed.',
        color: 0xC62828
      });
    }
  }

  const order = queue.find(o => o && o.status === 'paid');
  if (!order) return;

  order.status = 'processing';
  order.processingAt = new Date().toISOString();
  try {
    await storage.setState('as_teardown_queue', queue);
  } catch (err) {
    context.log.error('[asTeardownRunner] crash-marker save failed, skipping tick:', err.message);
    return;
  }

  try {
    context.log('[asTeardownRunner] analyzing ' + order.url + ' for ' + order.orderId);
    const report = await analyze(order.url);
    const teardown = await composer.composeTeardown(report, order.goal, callClaude);

    const doc = {
      orderId: order.orderId,
      url: order.url,
      goal: order.goal || null,
      email: order.email || null,
      score: report.score,
      grade: report.grade,
      siteType: report.fullReport && report.fullReport.siteTypeLabel,
      teardown: teardown,
      reportRaw: report.fullReport,
      createdAt: new Date().toISOString(),
      deliveredAt: null
    };
    await storage.setState('as_teardown_' + order.orderId, doc);

    order.status = 'draft_ready';
    order.draftReadyAt = new Date().toISOString();
    await storage.setState('as_teardown_queue', queue);

    const previewLink = SITE_URL + '/ambientscore/teardown.html?id=' + order.orderId + '&key=' + composer.buildTeardownToken(order.orderId);
    context.log('[asTeardownRunner] draft ready: ' + order.orderId + ' score ' + report.score);

    await dispatchDiscord({
      title: 'Teardown draft ready for review',
      description: order.url + ' scored ' + report.score + '/100.\nReview and deliver: ' + previewLink,
      color: 0x1565C0
    });
    try {
      const emailSender = require('../_lib/ambientScore/emailSender');
      await emailSender.sendTeardownCeoNotify(doc, previewLink);
    } catch (mailErr) {
      context.log.warn('[asTeardownRunner] CEO notify email failed (non-fatal):', mailErr.message);
    }
  } catch (err) {
    context.log.error('[asTeardownRunner] fulfillment failed for ' + order.orderId + ':', err.message);
    order.retryCount = (order.retryCount || 0) + 1;
    order.error = String(err.message || err).slice(0, 300);
    order.status = order.retryCount > composer.MAX_RETRIES ? 'failed' : 'paid';
    try { await storage.setState('as_teardown_queue', queue); } catch (e) { /* self-heal covers */ }
    if (order.status === 'failed') {
      await dispatchDiscord({
        title: 'Teardown order FAILED after retries',
        description: order.url + ' (' + order.orderId + '): ' + order.error + '\nRefund may be owed.',
        color: 0xC62828
      });
    }
  }
};
