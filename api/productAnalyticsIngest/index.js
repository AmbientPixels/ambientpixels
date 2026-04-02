// productAnalyticsIngest — Receives batched product analytics events from the client SDK.
// POST /api/productAnalyticsIngest
// Body: { events: [ { product, event, category, ts, sessionId, userId, isAuth, page, props } ] }

const pa = require('../_utils/productAnalytics');

const VALID_PRODUCTS = [
  'ambientscore', 'blindspot', 'cardforge', 'storyforge',
  'tileforge', 'blog', 'nova', 'dashboard'
];
const VALID_CATEGORIES = ['funnel', 'engagement', 'conversion', 'error'];
const MAX_BATCH = 200;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function stripPII(page) {
  if (!page || typeof page !== 'string') return '';
  // Keep only the pathname, strip query params (may contain PII)
  var idx = page.indexOf('?');
  return idx !== -1 ? page.substring(0, idx) : page;
}

function validateEvent(evt) {
  if (!evt || typeof evt !== 'object') return null;
  if (!evt.product || VALID_PRODUCTS.indexOf(evt.product) === -1) return null;
  if (!evt.event || typeof evt.event !== 'string') return null;
  if (evt.event.length > 100) return null;

  return {
    id: evt.id || undefined,
    product: evt.product,
    event: evt.event.substring(0, 100),
    category: VALID_CATEGORIES.indexOf(evt.category) !== -1 ? evt.category : 'engagement',
    ts: evt.ts || new Date().toISOString(),
    sessionId: typeof evt.sessionId === 'string' ? evt.sessionId.substring(0, 60) : '',
    userId: typeof evt.userId === 'string' ? evt.userId.substring(0, 100) : '',
    isAuth: !!evt.isAuth,
    page: stripPII(typeof evt.page === 'string' ? evt.page.substring(0, 200) : ''),
    source: 'client',
    props: typeof evt.props === 'object' && evt.props !== null ? evt.props : {}
  };
}

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    var body = req.body;
    if (!body || !Array.isArray(body.events) || body.events.length === 0) {
      context.res = { status: 400, headers: corsHeaders, body: { error: 'Missing events array' } };
      return;
    }

    // Validate and sanitize events
    var events = body.events.slice(0, MAX_BATCH);
    var valid = [];
    for (var i = 0; i < events.length; i++) {
      var cleaned = validateEvent(events[i]);
      if (cleaned) valid.push(cleaned);
    }

    if (valid.length === 0) {
      context.res = { status: 400, headers: corsHeaders, body: { error: 'No valid events', received: events.length } };
      return;
    }

    var result = await pa.emitBatch(valid);
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { ok: true, accepted: result.appended, dropped: events.length - valid.length }
    };
  } catch (err) {
    context.log.error('[ProductAnalyticsIngest] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Ingest failed', message: err.message }
    };
  }
};
