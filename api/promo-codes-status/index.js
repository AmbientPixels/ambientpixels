// promo-codes-status — CEO read-only view of the promo-code system.
// GET /api/promo-codes-status   (header: x-company-secret: pixelpusher)

const promo = require('../_lib/promo-codes');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  if (req.headers['x-company-secret'] !== 'pixelpusher') {
    context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'CEO access required' } };
    return;
  }

  try {
    const record = await promo.loadCodes();
    const { summary, campaigns } = promo.summarize(record);
    const recent = promo.recentRedemptions(record, 10);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        summary,
        campaigns,
        recent_redemptions: recent
      }
    };
  } catch (err) {
    context.log.error('[promo-codes-status] ' + err.message);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'internal error' } };
  }
};
