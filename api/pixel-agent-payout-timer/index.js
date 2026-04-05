// pixel-agent-payout-timer — Monthly automatic payout (1st of month, 6 AM UTC)
// Timer trigger: 0 0 6 1 * *

const { executePayoutRun } = require('../_lib/stripe/payoutExecutor');

module.exports = async function (context, timer) {
  if (timer.isPastDue) {
    context.log('[PayoutTimer] Timer is past due, running anyway');
  }

  context.log('[PayoutTimer] Monthly payout run started');

  try {
    var result = await executePayoutRun({
      month: null, // auto-determines previous month
      triggeredBy: 'timer',
      dryRun: false,
      context: context
    });

    if (result.skipped) {
      context.log('[PayoutTimer] Skipped:', result.reason);
    } else {
      context.log('[PayoutTimer] Complete:', JSON.stringify(result.summary));
    }

  } catch (err) {
    context.log.error('[PayoutTimer] Fatal error:', err.message, err.stack);
  }
};
