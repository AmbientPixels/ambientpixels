// roast-rewrite — GET/POST /api/roast-rewrite
// The $9 Deep Roast Rewrite surface:
//   GET  ?config=1                       -> { enabled, priceCents } (public, gates the upsell card)
//   POST { action:'create', resumeText, roastResult } -> order + Stripe checkout URL
//   GET  ?id=<orderId>&key=<hmac>        -> order status; composes inline on first poll after payment
//   POST { action:'status' }             -> queue dump (secret-gated, CEO ops)
//   POST { action:'requeue', id }        -> failed -> paid (secret-gated, CEO recovery)
//
// Compose-on-poll: the Stripe success page polls this GET; the first poll that
// finds the order 'paid' runs the single Claude call inline (~30-60s) so
// delivery beats any cron cadence. roastRewriteRunner is the backstop for
// buyers who close the tab before the success page loads.

const storage = require('../_utils/companyStorage');
const stripeClient = require('../_lib/ambientScore/stripeClient');
const composer = require('../_lib/roastRewrite/composer');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const MAX_CREATES_PER_HOUR = 5;
const QUEUE_KEY = 'roast_rewrite_queue';

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || 'unknown';
}

// Same blob + shape as as-teardown's limiter, separate namespace key.
async function checkRateLimit(ip) {
  const key = 'cc_rewrite_ratelimit';
  const now = Date.now();
  const hourAgo = now - 3600000;
  let limits = (await storage.getState(key)) || {};
  for (const k of Object.keys(limits)) {
    limits[k] = (limits[k] || []).filter(ts => ts > hourAgo);
    if (limits[k].length === 0) delete limits[k];
  }
  const hits = limits[ip] || [];
  if (hits.length >= MAX_CREATES_PER_HOUR) return true;
  hits.push(now);
  limits[ip] = hits;
  await storage.setState(key, limits);
  return false;
}

async function getConfig() {
  const cfg = (await storage.getState('systemConfig')) || {};
  const rr = cfg.roastRewrite || {};
  return {
    enabled: rr.enabled === true,
    priceCents: Number.isFinite(Number(rr.priceCents)) && Number(rr.priceCents) > 0
      ? Number(rr.priceCents)
      : composer.PRICE_CENTS_DEFAULT
  };
}

function tokenValid(orderId, key) {
  return !!orderId && !!key && composer.buildRewriteToken(orderId) === String(key);
}

// Client payload for the delivery page. Never includes resumeText.
function orderView(order, doc) {
  const view = { orderId: order.orderId, status: order.status, createdAt: order.createdAt };
  if (order.status === 'delivered' && doc && doc.rewrite) {
    view.rewrite = doc.rewrite;
    view.deliveredAt = order.deliveredAt || doc.deliveredAt;
  }
  return view;
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    // ── GET ──
    if (req.method === 'GET') {
      if (req.query.config === '1') {
        const cfg = await getConfig();
        context.res = { status: 200, headers: CORS_HEADERS, body: cfg };
        return;
      }

      const orderId = req.query.id;
      const key = req.query.key;
      if (!tokenValid(orderId, key)) {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Invalid or missing key.' } };
        return;
      }

      let queue = (await storage.getState(QUEUE_KEY)) || [];
      const order = queue.find(o => o && o.orderId === orderId);
      if (!order) {
        context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Order not found.' } };
        return;
      }

      // Compose-on-poll: first poll after payment does the work inline.
      if (order.status === 'paid') {
        order.status = 'processing';
        order.processingAt = new Date().toISOString();
        await storage.setState(QUEUE_KEY, queue);

        const doc = await storage.getState('roast_rewrite_' + orderId);
        if (!doc || !doc.resumeText) {
          order.status = 'failed';
          order.error = 'order doc missing';
          await storage.setState(QUEUE_KEY, queue);
          context.res = { status: 200, headers: CORS_HEADERS, body: orderView(order, null) };
          return;
        }

        try {
          const { callClaude } = require('../_lib/ambientScore/analyzer');
          const rewrite = await composer.composeRewrite(doc.resumeText, doc.roastResult, callClaude);
          const nowIso = new Date().toISOString();
          doc.rewrite = rewrite;
          doc.deliveredAt = nowIso;
          await storage.setState('roast_rewrite_' + orderId, doc);

          // Re-read the queue: the compose took ~a minute and another writer
          // (webhook for a different order, runner tick) may have saved since.
          queue = (await storage.getState(QUEUE_KEY)) || [];
          const fresh = queue.find(o => o && o.orderId === orderId) || order;
          fresh.status = 'delivered';
          fresh.deliveredAt = nowIso;
          await storage.setState(QUEUE_KEY, queue);

          if (fresh.email) {
            try {
              const emailSender = require('../_lib/ambientScore/emailSender');
              const SITE_URL = process.env.AS_SITE_URL || process.env.CC_SITE_URL || 'https://ambientpixels.ai';
              const viewLink = SITE_URL + '/resume-roast/rewrite.html?id=' + orderId + '&key=' + composer.buildRewriteToken(orderId);
              await emailSender.sendRewriteReadyEmail(fresh.email, viewLink);
            } catch (mailErr) {
              context.log.warn('[roast-rewrite] ready email failed (non-fatal):', mailErr.message);
            }
          }

          context.res = { status: 200, headers: CORS_HEADERS, body: orderView(fresh, doc) };
          return;
        } catch (err) {
          context.log.error('[roast-rewrite] compose failed for ' + orderId + ':', err.message);
          order.retryCount = (order.retryCount || 0) + 1;
          order.error = String(err.message || err).slice(0, 300);
          order.status = order.retryCount > composer.MAX_RETRIES ? 'failed' : 'paid';
          await storage.setState(QUEUE_KEY, queue);
          // Report 'processing' while retries remain so the page keeps polling.
          const reported = order.status === 'failed' ? order : Object.assign({}, order, { status: 'processing' });
          context.res = { status: 200, headers: CORS_HEADERS, body: orderView(reported, null) };
          return;
        }
      }

      const doc = order.status === 'delivered' ? await storage.getState('roast_rewrite_' + orderId) : null;
      context.res = { status: 200, headers: CORS_HEADERS, body: orderView(order, doc) };
      return;
    }

    // ── POST actions ──
    const body = req.body || {};

    if (body.action === 'status') {
      if (req.headers['x-company-secret'] !== 'pixelpusher') {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Forbidden.' } };
        return;
      }
      const queue = (await storage.getState(QUEUE_KEY)) || [];
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: {
          orders: queue.map(o => ({
            orderId: o.orderId, status: o.status, email: o.email || null,
            createdAt: o.createdAt, paidAt: o.paidAt || null, deliveredAt: o.deliveredAt || null,
            retryCount: o.retryCount || 0, error: o.error || null,
            key: composer.buildRewriteToken(o.orderId)
          }))
        }
      };
      return;
    }

    if (body.action === 'requeue') {
      if (req.headers['x-company-secret'] !== 'pixelpusher') {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Forbidden.' } };
        return;
      }
      const requeueId = String(body.id || body.orderId || '');
      const rqQueue = (await storage.getState(QUEUE_KEY)) || [];
      const rqOrder = rqQueue.find(o => o && o.orderId === requeueId);
      if (!rqOrder) {
        context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Order not found.', orderId: requeueId } };
        return;
      }
      if (rqOrder.status !== 'failed') {
        context.res = { status: 409, headers: CORS_HEADERS, body: { error: 'Only failed orders can be requeued.', orderId: requeueId, status: rqOrder.status } };
        return;
      }
      rqOrder.status = 'paid';
      rqOrder.retryCount = 0;
      rqOrder.error = null;
      rqOrder.requeuedAt = new Date().toISOString();
      await storage.setState(QUEUE_KEY, rqQueue);
      context.log('[roast-rewrite] Order requeued by CEO:', requeueId);
      context.res = { status: 200, headers: CORS_HEADERS, body: { ok: true, orderId: requeueId, status: 'paid' } };
      return;
    }

    if (body.action === 'create') {
      const cfg = await getConfig();
      if (!cfg.enabled) {
        context.res = { status: 503, headers: CORS_HEADERS, body: { error: 'Rewrites are not available right now.' } };
        return;
      }
      const resumeText = String(body.resumeText || '').trim();
      if (resumeText.length < 200 || resumeText.length > composer.RESUME_MAX_CHARS) {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Resume text must be between 200 and ' + composer.RESUME_MAX_CHARS + ' characters.' } };
        return;
      }
      if (await checkRateLimit(getClientIP(req))) {
        context.res = { status: 429, headers: CORS_HEADERS, body: { error: 'Too many requests. Try again in an hour.' } };
        return;
      }

      const nowIso = new Date().toISOString();
      const roastResult = (body.roastResult && typeof body.roastResult === 'object') ? body.roastResult : null;
      const { entry, doc } = composer.createOrder(resumeText, roastResult, nowIso);

      const queue = (await storage.getState(QUEUE_KEY)) || [];
      queue.push(entry);
      const capped = composer.capQueue(queue);
      for (const dropId of capped.removeDocIds) {
        try { await storage.setState('roast_rewrite_' + dropId, { purged: true }); } catch (e) { /* non-fatal */ }
      }
      await storage.setState('roast_rewrite_' + entry.orderId, doc);
      await storage.setState(QUEUE_KEY, capped.queue);

      const session = await stripeClient.createRewriteCheckout({
        orderId: entry.orderId,
        token: composer.buildRewriteToken(entry.orderId),
        priceCents: cfg.priceCents,
        utmContent: String(body.utmContent || '').trim() || null,
        utmSource: String(body.utmSource || '').trim() || null
      });
      context.res = { status: 200, headers: CORS_HEADERS, body: { checkoutUrl: session.checkoutUrl, orderId: entry.orderId } };
      return;
    }

    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Unknown action.' } };
  } catch (err) {
    context.log.error('[roast-rewrite] Error:', err.message || err);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Something went wrong. Please try again.' } };
  }
};
