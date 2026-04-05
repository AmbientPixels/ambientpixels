// pixel-agent-payout-run — CEO manual payout trigger with dry-run support
// POST /api/pixel-agent-payout-run { action: 'dry-run' | 'execute', month?: 'YYYY-MM' }

const { executePayoutRun } = require('../_lib/stripe/payoutExecutor');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  // CEO only
  if (req.headers['x-company-secret'] !== 'pixelpusher') {
    context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'CEO access required' } };
    return;
  }

  var body = req.body || {};
  var action = body.action || 'dry-run';
  var month = body.month || null;

  context.log('[PayoutRun] Action:', action, '| Month:', month || 'auto');

  try {
    var result = await executePayoutRun({
      month: month,
      triggeredBy: 'ceo',
      dryRun: action === 'dry-run',
      context: context
    });

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: result
    };

  } catch (err) {
    context.log.error('[PayoutRun] Error:', err.message, err.stack);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Payout run failed: ' + err.message }
    };
  }
};
