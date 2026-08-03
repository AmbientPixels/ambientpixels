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
  // ── Phase 1: retention, docs-first (fixes an unretryable PII-orphan
  // window) ──
  // Doing the queue write BEFORE the doc purge/scrub IO would mean: if the
  // process dies (or a doc write fails) between the two, retentionPass never
  // re-emits that orderId — the flag/removal is already persisted — and a
  // resume-bearing doc is orphaned forever with the failure unlogged. So
  // instead: read-only snapshot -> dry-run retentionPass for candidates ->
  // doc IO now (logged on failure) -> only the ids whose doc IO actually
  // succeeded get passed back in as retentionPass's `allowedIds`, in the one
  // real mutateState call that also runs advanceQueue. A doc IO failure
  // leaves that order's queue entry untouched, so the next tick's dry run
  // finds it as a candidate again and retries — nothing is lost or silent.
  let snapshot;
  try {
    snapshot = (await storage.getState(QUEUE_KEY)) || [];
  } catch (err) {
    context.log.error('[roastRewriteRunner] queue read failed:', err.message);
    return;
  }
  if (!Array.isArray(snapshot) || snapshot.length === 0) return;

  const now = Date.now();
  const dryRun = composer.retentionPass(snapshot, now);
  const removeSet = new Set(dryRun.removeDocIds);
  // An id due for full purge doesn't also need a separate scrub write first —
  // it's about to be deleted outright. Kills the same-tick purge-then-rescrub
  // overlap (a delivered order can cross both the 30d scrub and 60d purge
  // thresholds in one tick, e.g. after downtime).
  const scrubCandidates = dryRun.scrubDocIds.filter(id => !removeSet.has(id));

  const succeededIds = [];
  for (const orderId of dryRun.removeDocIds) {
    try {
      const ok = await storage.setState('roast_rewrite_' + orderId, { purged: true });
      if (ok) succeededIds.push(orderId);
      else context.log.warn('[roastRewriteRunner] doc purge write returned false for ' + orderId + ' — queue entry left untouched, retried next tick');
    } catch (e) {
      context.log.warn('[roastRewriteRunner] doc purge failed for ' + orderId + ' — queue entry left untouched, retried next tick:', e.message);
    }
  }
  for (const orderId of scrubCandidates) {
    try {
      const doc = await storage.getState('roast_rewrite_' + orderId);
      if (!doc) {
        // Nothing to scrub — no doc means no PII left to protect.
        succeededIds.push(orderId);
        continue;
      }
      delete doc.resumeText;
      doc.roastResult = null;
      const ok = await storage.setState('roast_rewrite_' + orderId, doc);
      if (ok) succeededIds.push(orderId);
      else context.log.warn('[roastRewriteRunner] resume scrub write returned false for ' + orderId + ' — queue entry left unflagged, retried next tick');
    } catch (e) {
      context.log.warn('[roastRewriteRunner] resume scrub failed for ' + orderId + ' — queue entry left unflagged, retried next tick:', e.message);
    }
  }

  // ── Phase 1b: self-heal + the real (restricted) retention write ──
  let healed = { resets: 0, failed: 0, resetIds: [], failedIds: [] };
  let healRes;
  try {
    healRes = await storage.mutateState(QUEUE_KEY, function (fresh) {
      const arr = Array.isArray(fresh) ? fresh : [];
      if (arr.length === 0) return undefined;
      const h = composer.advanceQueue(arr, now);
      const r = composer.retentionPass(h.queue, now, succeededIds);
      healed = { resets: h.resets, failed: h.failed, resetIds: h.resetIds, failedIds: h.failedIds };
      const changed = h.resets > 0 || h.failed > 0 || r.removeDocIds.length > 0 || r.scrubDocIds.length > 0;
      return changed ? r.queue : undefined;
    });
  } catch (err) {
    context.log.error('[roastRewriteRunner] self-heal/retention mutate failed:', err.message);
    return;
  }

  if (!healRes.ok) {
    // The doc IO above already happened and is idempotent (purge/scrub are
    // safe to retry or to have run against a doc whose queue flag didn't
    // stick) — the next tick's dry run will simply recompute the same
    // candidates and this write will be attempted again.
    context.log.error('[roastRewriteRunner] self-heal/retention queue write failed (mutateState reported not ok); doc IO already applied, next tick converges');
  } else if (healRes.written && (healed.resets || healed.failed)) {
    context.log('[roastRewriteRunner] self-heal: resets=' + healed.resets + ' (' + healed.resetIds.join(',') + ') failed=' + healed.failed + ' (' + healed.failedIds.join(',') + ')');
  }

  if (healRes.written && healed.failed > 0) {
    await dispatchDiscord({
      title: 'Rewrite order FAILED after retries',
      description: 'Orders failed after retries: ' + healed.failedIds.join(', ') + '.\nCheck roast_rewrite_queue. $9 refund may be owed.',
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
  // Fresh timestamp — Phase 1's doc IO can take a while, and the claim's
  // grace-window check should reflect "now", not "when this tick started".
  const claimNow = Date.now();
  let claimed = null;
  let claimRes;
  try {
    claimRes = await storage.mutateState(QUEUE_KEY, function (fresh) {
      const arr = Array.isArray(fresh) ? fresh : [];
      const candidate = arr.find(function (o) {
        if (!o || o.status !== 'paid') return false;
        // A missing paidAt/createdAt coerces to Date.parse(0) (year 2000
        // UTC) — a huge but finite age, already well past the grace window,
        // so it's claimed rather than waited on forever. A present-but-
        // malformed string parses to NaN instead, which the isFinite guard
        // below falls back to epoch 0 for — an even larger (effectively
        // infinite) age — also claimable.
        const paidMs = Date.parse(o.paidAt || o.createdAt || 0);
        const age = claimNow - (Number.isFinite(paidMs) ? paidMs : 0);
        return age > BACKSTOP_GRACE_MS;
      });
      if (!candidate) return undefined;
      candidate.status = 'processing';
      candidate.processingAt = new Date(claimNow).toISOString();
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
      // The Claude call succeeded but we couldn't save its output — throw so
      // this lands in the catch below, which runs the same retry accounting
      // as a compose failure (retryCount++, back to 'paid' or to 'failed'
      // once exhausted). That burns a compose retry even though composing
      // itself worked; acceptable given MAX_RETRIES headroom, and safer than
      // reporting delivery over a doc write that never landed.
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
    if (!deliverRes.ok) {
      // The doc is saved (rewrite + deliveredAt) but the queue flip didn't
      // persist, so the stored entry is still 'processing'. advanceQueue's
      // stale-processing self-heal will eventually reset it to 'paid' and
      // this runner will re-claim and recompose it — which can send a
      // second "ready" email for the same order. Acceptable (better than
      // losing the order), but worth knowing about if a buyer reports two
      // emails.
      context.log.error('[roastRewriteRunner] delivered-flip write failed for ' + orderId + '; queue still shows processing, will self-heal and re-claim next cycle (possible duplicate ready email)');
    }
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
