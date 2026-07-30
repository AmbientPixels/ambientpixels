// as-teardown — GET/POST /api/as-teardown
// The $199 Conversion Teardown surface:
//   POST { action: 'checkout', url, email, goal }  -> Stripe checkout URL
//   GET  ?id=<orderId>&key=<hmac>                  -> teardown doc (CEO preview + buyer view)
//   POST { action: 'deliver', id, key }            -> email the buyer, mark delivered
//
// The HMAC key gates both read and deliver: before delivery only the CEO holds
// the link (Discord/email notify), after delivery the buyer gets the same link.

const storage = require('../_utils/companyStorage');
const stripeClient = require('../_lib/ambientScore/stripeClient');
const composer = require('../_lib/ambientScore/teardownComposer');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const MAX_CHECKOUTS_PER_HOUR = 5;

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || 'unknown';
}

function isValidUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}

// Same blob + shape as as-analyze's limiter, separate namespace key.
async function checkRateLimit(ip) {
  const key = 'cc_teardown_ratelimit';
  const now = Date.now();
  const hourAgo = now - 3600000;
  let limits = (await storage.getState(key)) || {};
  for (const k of Object.keys(limits)) {
    limits[k] = (limits[k] || []).filter(ts => ts > hourAgo);
    if (limits[k].length === 0) delete limits[k];
  }
  const hits = limits[ip] || [];
  if (hits.length >= MAX_CHECKOUTS_PER_HOUR) return true;
  hits.push(now);
  limits[ip] = hits;
  await storage.setState(key, limits);
  return false;
}

function tokenValid(orderId, key) {
  return !!orderId && !!key && composer.buildTeardownToken(orderId) === String(key);
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    // ── GET: view a teardown (CEO preview pre-delivery, buyer view after) ──
    if (req.method === 'GET') {
      const orderId = req.query.id;
      const key = req.query.key;
      if (!tokenValid(orderId, key)) {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Invalid or missing key.' } };
        return;
      }
      const doc = await storage.getState('as_teardown_' + orderId);
      if (!doc) {
        context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Teardown not found. It may still be generating.' } };
        return;
      }
      const queue = (await storage.getState('as_teardown_queue')) || [];
      const order = queue.find(o => o && o.orderId === orderId);
      const { reportRaw, ...clientDoc } = doc;
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: { ...clientDoc, status: (order && order.status) || (doc.deliveredAt ? 'delivered' : 'draft_ready') }
      };
      return;
    }

    // ── POST actions ──
    const body = req.body || {};

    // CEO-only ops view: the queue is storage-direct (not a company-state
    // key), so this is the one way to inspect order states remotely.
    if (body.action === 'status') {
      if (req.headers['x-company-secret'] !== 'pixelpusher') {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Forbidden.' } };
        return;
      }
      const queue = (await storage.getState('as_teardown_queue')) || [];
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: {
          orders: queue.map(o => ({
            orderId: o.orderId, url: o.url, email: o.email, status: o.status,
            paidAt: o.paidAt, retryCount: o.retryCount || 0, error: o.error || null,
            key: composer.buildTeardownToken(o.orderId)
          }))
        }
      };
      return;
    }

    if (body.action === 'checkout') {
      const url = String(body.url || '').trim();
      const email = String(body.email || '').trim();
      const goal = String(body.goal || '').trim();

      if (!isValidUrl(url)) {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Enter a valid website URL.' } };
        return;
      }
      if (email && !isValidEmail(email)) {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Enter a valid email address.' } };
        return;
      }
      if (await checkRateLimit(getClientIP(req))) {
        context.res = { status: 429, headers: CORS_HEADERS, body: { error: 'Too many requests. Try again in an hour.' } };
        return;
      }

      const utmContent = String(body.utmContent || '').trim() || null;
      const utmSource = String(body.utmSource || '').trim() || null;
      const session = await stripeClient.createTeardownCheckout({ url, email, goal, utmContent, utmSource });
      context.res = { status: 200, headers: CORS_HEADERS, body: { checkoutUrl: session.checkoutUrl } };
      return;
    }

    if (body.action === 'deliver') {
      const orderId = String(body.id || '');
      if (!tokenValid(orderId, body.key)) {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Invalid or missing key.' } };
        return;
      }
      const queue = (await storage.getState('as_teardown_queue')) || [];
      const order = queue.find(o => o && o.orderId === orderId);
      if (!order || order.status !== 'draft_ready') {
        context.res = { status: 409, headers: CORS_HEADERS, body: { error: 'Order is not ready to deliver (status: ' + ((order && order.status) || 'unknown') + ').' } };
        return;
      }
      const doc = await storage.getState('as_teardown_' + orderId);
      if (!doc) {
        context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Teardown document missing.' } };
        return;
      }
      if (!order.email) {
        context.res = { status: 409, headers: CORS_HEADERS, body: { error: 'No buyer email on the order. Deliver manually.' } };
        return;
      }

      const SITE_URL = process.env.AS_SITE_URL || process.env.CC_SITE_URL || 'https://ambientpixels.ai';
      const viewLink = SITE_URL + '/ambientscore/teardown.html?id=' + orderId + '&key=' + composer.buildTeardownToken(orderId);
      const emailSender = require('../_lib/ambientScore/emailSender');
      await emailSender.sendTeardownDeliveryEmail(order.email, doc, viewLink);

      const nowIso = new Date().toISOString();
      order.status = 'delivered';
      order.deliveredAt = nowIso;
      doc.deliveredAt = nowIso;
      await storage.setState('as_teardown_queue', queue);
      await storage.setState('as_teardown_' + orderId, doc);

      try {
        const { dispatchDiscord } = require('../_utils/fleetAlerts');
        await dispatchDiscord({
          title: 'Teardown delivered',
          description: doc.url + ' -> ' + order.email,
          color: 0x2E7D32
        });
      } catch (e) { /* non-fatal */ }

      context.res = { status: 200, headers: CORS_HEADERS, body: { delivered: true, deliveredAt: nowIso } };
      return;
    }

    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Unknown action.' } };
  } catch (err) {
    context.log.error('[as-teardown] Error:', err.message || err);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Something went wrong. Please try again.' } };
  }
};
