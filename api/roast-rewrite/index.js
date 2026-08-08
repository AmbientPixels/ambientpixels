// roast-rewrite — GET/POST /api/roast-rewrite
// The $9 Deep Roast Rewrite surface:
//   GET  ?config=1                       -> { enabled, priceCents } (public, gates the upsell card)
//   POST { action:'create', resumeText, roastResult, jobDescription? } -> order + Stripe checkout URL
//   GET  ?id=<orderId>&key=<hmac>        -> order status; composes inline on first poll after payment
//   POST { action:'status' }             -> queue dump (secret-gated, CEO ops)
//   POST { action:'requeue', id }        -> failed -> paid (secret-gated, CEO recovery)
//
// Compose-on-poll: the Stripe success page polls this GET; the first poll that
// finds the order 'paid' runs the single Claude call inline (~30-60s) so
// delivery beats any cron cadence. roastRewriteRunner is the backstop for
// buyers who close the tab before the success page loads.

const crypto = require('crypto');
const storage = require('../_utils/companyStorage');
const stripeClient = require('../_lib/ambientScore/stripeClient');
const composer = require('../_lib/roastRewrite/composer');
const { isValidCeoSecret } = require('../_utils/ceoSecret');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// Per IP, per hour. Raised from 5 on 2026-08-07.
//
// What this control actually prevents is someone spamming order CREATION, and
// an unpaid create costs one blob write — no model call, since composing only
// happens once Stripe reports the order paid. So 5 was priced for a harm that
// is not expensive, while the cost of a false positive is a lost sale.
//
// Two things made 5 actively wrong. The bucket is a raw IP, so on carrier
// CGNAT, office NAT or cafe wifi it is shared by everyone behind it — five
// people hesitating at a card form locks out the sixth person's PURCHASE, not
// just their free run. And cancelled checkouts now restore the roast and invite
// a retry, which is the correct experience but mints a new order each time, so
// one indecisive buyer can burn the whole bucket alone.
//
// 20 still bounds abuse to 20 blob writes an hour from one address.
const MAX_CREATES_PER_HOUR = 20;
const QUEUE_KEY = 'roast_rewrite_queue';

// Shared with pixel-agent-run. The old inline version read the first
// x-forwarded-for entry, which on Azure carries the caller's ephemeral port, so
// this limiter's bucket changed on every request too — it just never showed,
// because 20 order creations an hour is a ceiling nobody was near.
const { getClientIp: getClientIP } = require('../_utils/clientIp');

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
  if (!orderId || !key) return false;
  const expected = Buffer.from(composer.buildRewriteToken(orderId));
  const provided = Buffer.from(String(key));
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

// Every write to roast_rewrite_queue goes through mutateState (2026-08-01
// companyStorage primitive): read -> mutator -> conditional write, retried on
// conflict, refuses to write over a failed read. This blob has four writer
// classes (this endpoint, the Stripe webhook, the runner, and concurrent
// polls of this same endpoint), so plain get/push/set can silently lose a
// writer's update. mutator must derive everything from the `fresh` value it's
// given, never from an outer snapshot, since it can be re-run on conflict.
// Throws (ConcurrencyError, or companyStorage's read-failure Error) when
// mutateState can't proceed; also throws here when mutateState reports a
// non-throwing write failure (res.ok === false), so every call site can just
// let it bubble to the module's top-level catch -> 500, never proceeding to
// hand out a checkout URL or report success on unrecorded state.
async function mutateQueue(mutator) {
  const res = await storage.mutateState(QUEUE_KEY, mutator);
  if (!res.ok) {
    throw new Error('[roast-rewrite] queue write failed (mutateState reported not ok)');
  }
  return res;
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

      // Compose-on-poll claim: atomically flip paid -> processing against the
      // FRESH queue. If the order isn't 'paid' anymore by the time our
      // mutator runs (another concurrent poll already claimed it, or it's in
      // any other state), the mutator aborts (returns undefined, no write) —
      // `claimRes.written` tells us whether WE won the claim this call.
      //
      // The retryCount gate hands the LAST attempt to roastRewriteRunner. This
      // request is behind Azure's 230s gateway limit; the runner is a timer
      // trigger with a 420s budget. Without the gate, an order whose compose
      // genuinely needs longer than the HTTP path allows would burn all three
      // retries here and be marked 'failed' — refund territory for a rewrite
      // that a slower path could have produced. Two fast tries, then the
      // patient one.
      const claimRes = await mutateQueue(function (fresh) {
        const arr = Array.isArray(fresh) ? fresh : [];
        const live = arr.find(o => o && o.orderId === orderId);
        if (!live || live.status !== 'paid') return undefined;
        if ((live.retryCount || 0) >= composer.INLINE_MAX_RETRIES) return undefined;
        live.status = 'processing';
        live.processingAt = new Date().toISOString();
        return arr;
      });

      const order = (claimRes.value || []).find(o => o && o.orderId === orderId);
      if (!order) {
        context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Order not found.' } };
        return;
      }

      if (!claimRes.written) {
        // Not ours to compose (never paid, already claimed by another poller,
        // or already delivered/failed) — just report current status.
        const viewDoc = order.status === 'delivered' ? await storage.getState('roast_rewrite_' + orderId) : null;
        context.res = { status: 200, headers: CORS_HEADERS, body: orderView(order, viewDoc) };
        return;
      }

      // We won the claim — order.status is now 'processing'. Compose inline.
      const doc = await storage.getState('roast_rewrite_' + orderId);
      if (!doc || !doc.resumeText) {
        const failRes = await mutateQueue(function (fresh) {
          const arr = Array.isArray(fresh) ? fresh : [];
          let live = arr.find(o => o && o.orderId === orderId);
          if (!live) { live = order; arr.push(live); } // entry vanished — push it back, not a detached copy
          live.status = 'failed';
          live.error = 'order doc missing';
          return arr;
        });
        const failedOrder = (failRes.value || []).find(o => o && o.orderId === orderId) || order;
        context.res = { status: 200, headers: CORS_HEADERS, body: orderView(failedOrder, null) };
        return;
      }

      // The Claude call itself stays OUTSIDE any mutator — it's the one part
      // of this cycle that can run 30-60s and must never be re-run by
      // mutateState's conflict-retry.
      //
      // BOUNDED (2026-08-07). This ran the full two-attempt ladder with no
      // ceiling, inside a request Azure kills at 230s. The only real order to
      // date took 354s: the buyer's fetch died at the gateway, the page fell
      // back to 5s polling, and had the function been killed at its own 600s
      // timeout the order would have sat 'processing' for the 10-minute stale
      // window before the runner could touch it. Now: ONE attempt, budgeted to
      // return before the gateway does, with the ladder spread across
      // successive polls — each of which gets a fresh 230s of its own.
      // attemptOffset keeps that ladder cooling across those polls instead of
      // re-rolling 0.4 every time.
      let rewrite;
      try {
        const { callClaude } = require('../_lib/ambientScore/analyzer');
        // doc.jobDescription is absent on orders created before targeting
        // shipped (and null when the buyer pasted no posting) — composeRewrite
        // treats both as "no posting" and builds the original prompt.
        rewrite = await composer.composeRewrite(doc.resumeText, doc.roastResult, callClaude, doc.jobDescription, {
          deadlineMs: composer.INLINE_COMPOSE_BUDGET_MS,
          maxAttempts: composer.INLINE_MAX_ATTEMPTS,
          attemptOffset: order.retryCount || 0
        });
      } catch (err) {
        context.log.error('[roast-rewrite] compose failed for ' + orderId + ':', err.message);
        const errMsg = String(err.message || err).slice(0, 300);
        const retryRes = await mutateQueue(function (fresh) {
          const arr = Array.isArray(fresh) ? fresh : [];
          let live = arr.find(o => o && o.orderId === orderId);
          if (!live) { live = order; arr.push(live); }
          live.retryCount = (live.retryCount || 0) + 1;
          live.error = errMsg;
          live.status = live.retryCount > composer.MAX_RETRIES ? 'failed' : 'paid';
          return arr;
        });
        const reportedOrder = (retryRes.value || []).find(o => o && o.orderId === orderId) || order;
        // Report 'processing' while retries remain so the page keeps polling.
        const reported = reportedOrder.status === 'failed' ? reportedOrder : Object.assign({}, reportedOrder, { status: 'processing' });
        context.res = { status: 200, headers: CORS_HEADERS, body: orderView(reported, null) };
        return;
      }

      // Compose succeeded — persist the doc, then flip the queue to
      // delivered. If either write fails from here we let it throw to the
      // top-level 500: the queue is left 'processing', and the runner's
      // stale-processing self-heal (advanceQueue) will retry it rather than
      // us reporting success over an unrecorded delivery.
      const nowIso = new Date().toISOString();
      doc.rewrite = rewrite;
      doc.deliveredAt = nowIso;
      const docWriteOk = await storage.setState('roast_rewrite_' + orderId, doc);
      if (!docWriteOk) {
        throw new Error('[roast-rewrite] failed to persist rewrite doc for ' + orderId);
      }

      const deliverRes = await mutateQueue(function (fresh) {
        const arr = Array.isArray(fresh) ? fresh : [];
        let live = arr.find(o => o && o.orderId === orderId);
        if (!live) { live = order; arr.push(live); } // entry vanished mid-compose — push the updated order back
        live.status = 'delivered';
        live.deliveredAt = nowIso;
        return arr;
      });
      const fresh = (deliverRes.value || []).find(o => o && o.orderId === orderId) || order;

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
    }

    // ── POST actions ──
    const body = req.body || {};

    if (body.action === 'status') {
      if (!isValidCeoSecret(req.headers['x-company-secret'])) {
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
            // The double-charge alert names two order ids and says they cover
            // the same resume. Without this the operator has no way to check
            // that claim before issuing a refund — and no way to see that
            // pre-2026-08-07 orders carry no fingerprint at all, so they can
            // never dedup against anything.
            fingerprint: o.fingerprint || null,
            key: composer.buildRewriteToken(o.orderId)
          }))
        }
      };
      return;
    }

    if (body.action === 'requeue') {
      if (!isValidCeoSecret(req.headers['x-company-secret'])) {
        context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'Forbidden.' } };
        return;
      }
      const requeueId = String(body.id || body.orderId || '');
      // Escape hatch: 'failed' (retries exhausted), OR a 'processing' order
      // stuck past STALE_PROCESSING_MS (a crashed compose with the runner
      // also down — advanceQueue would eventually self-heal this, but a CEO
      // may want it back in flight sooner). Same staleness math as
      // composer.advanceQueue: a missing/corrupt processingAt parses to 0,
      // i.e. infinitely stale, so it fails closed toward "recoverable"
      // rather than hanging forever unrecoverable.
      let requeueProblem = null; // 'not_found' | current status string
      await mutateQueue(function (fresh) {
        const arr = Array.isArray(fresh) ? fresh : [];
        const live = arr.find(o => o && o.orderId === requeueId);
        if (!live) { requeueProblem = 'not_found'; return undefined; }
        const startedMs = Date.parse(live.processingAt || 0);
        const ageMs = Date.now() - (Number.isFinite(startedMs) ? startedMs : 0);
        const stale = live.status === 'processing' && ageMs > composer.STALE_PROCESSING_MS;
        if (live.status !== 'failed' && !stale) { requeueProblem = live.status; return undefined; }
        live.status = 'paid';
        live.retryCount = 0;
        live.error = null;
        live.requeuedAt = new Date().toISOString();
        return arr;
      });

      if (requeueProblem === 'not_found') {
        context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Order not found.', orderId: requeueId } };
        return;
      }
      if (requeueProblem) {
        context.res = { status: 409, headers: CORS_HEADERS, body: { error: 'Only failed or stale-processing orders can be requeued.', orderId: requeueId, status: requeueProblem } };
        return;
      }
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
      // Optional target posting. The free roast's client sends the same text as
      // `secondaryInput` (its generic second-input field name), so accept that
      // spelling too rather than silently dropping the posting the buyer pasted
      // — dropping it is exactly the bug this threading fixes. Over-long input
      // is trimmed, not rejected, matching the free path (pixel-agent-run
      // slices the same field to 6000): a buyer who pastes a whole job PAGE
      // still gets a targeted rewrite instead of a 400.
      //
      // Read before the rate-limit check because the fingerprint below needs
      // it, and a buyer being handed back something they ALREADY bought should
      // not be spending create-budget to get it.
      const jobDescription = composer.normalizeJobDescription(
        typeof body.jobDescription === 'string' ? body.jobDescription : body.secondaryInput
      );

      // ── Double-charge guard (2026-08-07) ──
      // Nothing anywhere stopped the same person paying twice for one resume.
      // markPaid dedups on Stripe's session id, which only ever defended
      // against webhook RETRIES of a single checkout — two checkouts are two
      // sessions, two orders and two charges. The upsell button stays live on
      // the roast page after purchase, the roast page survives the round trip
      // (that is what the cancelled-checkout recovery is for), and until this
      // session the buyer had every reason to press it again: delivery was
      // taking 354s behind a page promising "about a minute".
      //
      // So: if this exact resume + posting has already been paid for, hand back
      // the delivery link instead of a second checkout.
      const fingerprint = composer.fingerprintOrder(resumeText, jobDescription);
      // getStateWithMeta, not getState: a plain read collapses "no orders yet"
      // and "the read failed" into the same null, and those two must not lead
      // to the same decision here. Treating a failed read as an empty queue
      // would mint a checkout for someone who may have already paid — the
      // exact charge this guard exists to prevent. Being wrong in that
      // direction costs $9 and trust; being wrong the other way costs a retry.
      const queueMeta = await storage.getStateWithMeta(QUEUE_KEY);
      if (queueMeta.failed) {
        context.log.error('[roast-rewrite] queue read failed during duplicate check — refusing to start checkout rather than risk a second charge');
        context.res = { status: 503, headers: CORS_HEADERS, body: { error: 'We could not verify your order just now, so nothing was charged. Please try again in a moment.' } };
        return;
      }
      const dupe = composer.findPaidDuplicate(queueMeta.value || [], fingerprint);
      if (dupe) {
        context.log('[roast-rewrite] duplicate purchase blocked; returning existing order ' + dupe.orderId + ' (status ' + dupe.status + ')');
        context.res = {
          status: 200,
          headers: CORS_HEADERS,
          body: {
            alreadyPurchased: true,
            orderId: dupe.orderId,
            key: composer.buildRewriteToken(dupe.orderId),
            status: dupe.status
          }
        };
        return;
      }

      if (await checkRateLimit(getClientIP(req))) {
        // Says "this network", because the bucket is a raw IP and the person
        // reading this may not have started a single order themselves. Also
        // says nothing was charged: this fires at the buy button, and silence
        // there reads as "did my card just get taken?".
        context.res = { status: 429, headers: CORS_HEADERS, body: { error: 'Too many rewrite orders started from this network in the last hour. Nothing was charged. Try again shortly, or reply to us and we will sort it out.' } };
        return;
      }

      const nowIso = new Date().toISOString();
      const roastResult = (body.roastResult && typeof body.roastResult === 'object') ? body.roastResult : null;
      const { entry, doc } = composer.createOrder(resumeText, roastResult, nowIso, jobDescription);

      // Durability first: never hand out a Stripe checkout URL for an order
      // that isn't recorded. Doc first (setState returns false on failure
      // rather than throwing), then the queue entry via mutateState (throws
      // -> 500 on failure) — only after both land do we call Stripe.
      const docWriteOk = await storage.setState('roast_rewrite_' + entry.orderId, doc);
      if (!docWriteOk) {
        context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Could not save your order. Please try again.' } };
        return;
      }

      let removeDocIds = [];
      await mutateQueue(function (fresh) {
        const arr = Array.isArray(fresh) ? fresh : [];
        arr.push(entry);
        const capped = composer.capQueue(arr);
        removeDocIds = capped.removeDocIds;
        return capped.queue;
      });
      for (const dropId of removeDocIds) {
        try { await storage.setState('roast_rewrite_' + dropId, { purged: true }); } catch (e) { /* non-fatal */ }
      }

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
