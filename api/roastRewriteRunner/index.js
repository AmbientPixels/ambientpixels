// roastRewriteRunner — Timer Trigger (every 15 min at :12; grid: heartbeat :00
// even hours, asTeardownRunner :05, asProspectCron :25).
//
// Backstop for the $9 Deep Roast Rewrite: compose-on-poll (roast-rewrite GET)
// handles buyers who reach the delivery page; this catches orders whose buyer
// closed the tab after paying (composes + emails the link) plus:
//   - advanceQueue self-heal (stale 'processing' -> 'paid' -> 'failed')
//   - retention: unpaid orders dropped after 48h, resume text scrubbed 30d
//     after delivery (docs hold resumes = PII), entries + docs fully purged
//     after 60d (bounds queue growth; buyer link lifetime = 60 days)
// One order per tick — a rewrite is a single Claude call.
//
// Every queue write goes through storage.mutateState (see companyStorage.js);
// this blob has multiple writer classes (this runner, the roast-rewrite
// endpoint's compose-on-poll, the as-webhook paid flip), so plain
// get/modify/set could silently lose a concurrent writer's update. Doc IO
// (getState/setState on roast_rewrite_<id>) and the Claude call always
// happen OUTSIDE mutators — mutators must stay fast and re-runnable.

const storage = require('../_utils/companyStorage');
const composer = require('../_lib/roastRewrite/composer');
const { dispatchDiscord } = require('../_utils/fleetAlerts');

const SITE_URL = process.env.AS_SITE_URL || process.env.CC_SITE_URL || 'https://ambientpixels.ai';
const QUEUE_KEY = 'roast_rewrite_queue';
// Give compose-on-poll first shot: only orders paid >3 min ago are picked up.
const BACKSTOP_GRACE_MS = 3 * 60 * 1000;

module.exports = async function (context) {
  // ── Phase 1: self-heal + retention, one mutateState call ──
  // The mutator re-derives everything from `fresh` (idempotent, re-runnable
  // on conflict) and returns undefined — skipping the write — when the queue
  // is empty or nothing actually changed this tick.
  let healed = { resets: 0, failed: 0 };
  let retention = { removeDocIds: [], scrubDocIds: [] };
  let healRes;
  try {
    healRes = await storage.mutateState(QUEUE_KEY, function (fresh) {
      const arr = Array.isArray(fresh) ? fresh : [];
      if (arr.length === 0) return undefined;
      const now = Date.now();
      const h = composer.advanceQueue(arr, now);
      const r = composer.retentionPass(h.queue, now);
      healed = { resets: h.resets, failed: h.failed };
      retention = { removeDocIds: r.removeDocIds, scrubDocIds: r.scrubDocIds };
      const changed = h.resets > 0 || h.failed > 0 || r.removeDocIds.length > 0 || r.scrubDocIds.length > 0;
      return changed ? r.queue : undefined;
    });
  } catch (err) {
    context.log.error('[roastRewriteRunner] self-heal/retention mutate failed:', err.message);
    return;
  }

  // Empty/missing queue -> nothing existed to heal, retain, or claim. Bail.
  const queueSnapshot = Array.isArray(healRes.value) ? healRes.value : [];
  if (queueSnapshot.length === 0) return;

  if (healed.resets || healed.failed) {
    context.log('[roastRewriteRunner] self-heal: resets=' + healed.resets + ' failed=' + healed.failed);
  }

  // Doc IO outside the mutator: full purge for entries retentionPass dropped,
  // resume-text scrub for entries it flagged this tick.
  for (const orderId of retention.removeDocIds) {
    try { await storage.setState('roast_rewrite_' + orderId, { purged: true }); } catch (e) { /* non-fatal, retried next tick */ }
  }
  for (const orderId of retention.scrubDocIds) {
    try {
      const doc = await storage.getState('roast_rewrite_' + orderId);
      if (doc) {
        delete doc.resumeText;
        doc.roastResult = null;
        await storage.setState('roast_rewrite_' + orderId, doc);
      }
    } catch (e) {
      context.log.warn('[roastRewriteRunner] resume scrub failed for ' + orderId + ' (non-fatal):', e.message);
    }
  }

  if (healed.failed > 0) {
    await dispatchDiscord({
      title: 'Rewrite order FAILED after retries',
      description: 'Check roast_rewrite_queue for status failed. $9 refund may be owed.',
      color: 0xC62828
    });
  }

  // ── Phase 2: claim-based backstop compose (AMENDMENT B) ──
  // Atomically claim one 'paid' order whose grace window has elapsed, against
  // the FRESH queue, so a concurrent compose-on-poll can never be raced: if
  // the poll already claimed it (or anything else changed its status) between
  // our read and write, the mutator sees a stale/mismatched candidate and
  // this attempt naturally finds nothing (or mutateState retries against the
  // new fresh state). `!res.written` means we didn't win any claim this tick.
  const now = Date.now();
  let claimed = null;
  let claimRes;
  try {
    claimRes = await storage.mutateState(QUEUE_KEY, function (fresh) {
      const arr = Array.isArray(fresh) ? fresh : [];
      const candidate = arr.find(function (o) {
        if (!o || o.status !== 'paid') return false;
        // Non-finite paidAt/createdAt (missing/corrupt) parses to 0, i.e.
        // infinitely old — claim it rather than waiting forever.
        const paidMs = Date.parse(o.paidAt || o.createdAt || 0);
        const age = now - (Number.isFinite(paidMs) ? paidMs : 0);
        return age > BACKSTOP_GRACE_MS;
      });
      if (!candidate) return undefined;
      candidate.status = 'processing';
      candidate.processingAt = new Date(now).toISOString();
      claimed = Object.assign({}, candidate);
      return arr;
    });
  } catch (err) {
    context.log.error('[roastRewriteRunner] claim mutate failed:', err.message);
    return;
  }

  if (!claimRes.written || !claimed) return; // nothing to compose this tick

  const orderId = claimed.orderId;
  context.log('[roastRewriteRunner] composing rewrite for ' + orderId + ' (backstop)');

  const doc = await storage.getState('roast_rewrite_' + orderId);
  if (!doc || !doc.resumeText) {
    await storage.mutateState(QUEUE_KEY, function (fresh) {
      const arr = Array.isArray(fresh) ? fresh : [];
      let live = arr.find(function (o) { return o && o.orderId === orderId; });
      if (!live) { live = claimed; arr.push(live); } // entry vanished — push it back, not a detached copy
      live.status = 'failed';
      live.error = 'order doc missing';
      return arr;
    });
    await dispatchDiscord({
      title: 'Rewrite order FAILED after retries',
      description: orderId + ': order doc missing.\nCheck roast_rewrite_queue. $9 refund may be owed.',
      color: 0xC62828
    });
    return;
  }

  // The Claude call and doc write stay OUTSIDE any mutator — composing is the
  // one part of this cycle that can take 30-60s and must never be re-run by
  // mutateState's conflict-retry.
  try {
    const { callClaude } = require('../_lib/ambientScore/analyzer');
    const rewrite = await composer.composeRewrite(doc.resumeText, doc.roastResult, callClaude);

    const nowIso = new Date().toISOString();
    doc.rewrite = rewrite;
    doc.deliveredAt = nowIso;
    const docWriteOk = await storage.setState('roast_rewrite_' + orderId, doc);
    if (!docWriteOk) {
      // Leave the queue at 'processing' — advanceQueue's stale self-heal will
      // retry it next tick rather than us reporting delivery over an
      // unrecorded doc write.
      throw new Error('failed to persist rewrite doc for ' + orderId);
    }

    const deliverRes = await storage.mutateState(QUEUE_KEY, function (fresh) {
      const arr = Array.isArray(fresh) ? fresh : [];
      let live = arr.find(function (o) { return o && o.orderId === orderId; });
      if (!live) { live = claimed; arr.push(live); } // entry vanished mid-compose — push the updated order back
      live.status = 'delivered';
      live.deliveredAt = nowIso;
      return arr;
    });
    const finalOrder = (deliverRes.value || []).find(function (o) { return o && o.orderId === orderId; }) || claimed;

    context.log('[roastRewriteRunner] delivered ' + orderId);

    if (finalOrder.email) {
      try {
        const emailSender = require('../_lib/ambientScore/emailSender');
        const viewLink = SITE_URL + '/resume-roast/rewrite.html?id=' + orderId + '&key=' + composer.buildRewriteToken(orderId);
        await emailSender.sendRewriteReadyEmail(finalOrder.email, viewLink);
      } catch (mailErr) {
        context.log.warn('[roastRewriteRunner] ready email failed (non-fatal):', mailErr.message);
      }
    }
  } catch (err) {
    context.log.error('[roastRewriteRunner] compose failed for ' + orderId + ':', err.message);
    const errMsg = String(err.message || err).slice(0, 300);
    let finalStatus = 'paid';
    await storage.mutateState(QUEUE_KEY, function (fresh) {
      const arr = Array.isArray(fresh) ? fresh : [];
      let live = arr.find(function (o) { return o && o.orderId === orderId; });
      if (!live) { live = claimed; arr.push(live); }
      live.retryCount = (live.retryCount || 0) + 1;
      live.error = errMsg;
      live.status = live.retryCount > composer.MAX_RETRIES ? 'failed' : 'paid';
      finalStatus = live.status;
      return arr;
    });
    if (finalStatus === 'failed') {
      await dispatchDiscord({
        title: 'Rewrite order FAILED after retries',
        description: orderId + ': ' + errMsg + '\nCheck roast_rewrite_queue. $9 refund may be owed.',
        color: 0xC62828
      });
    }
  }
};
