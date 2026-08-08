// stuck-execution.js — what to do with an action stuck in 'running'.
//
// Extracted from actionsScheduler's inline escape hatch after it double-posted
// three Bluesky replies on 2026-08-08. Reconstructed from
// act_1786164429244_bsreply_kxj3u:
//
//   04:50:00  the reply is dispatched and POSTS SUCCESSFULLY. The write-back
//             recording success never lands, so it sits at status 'running'.
//   15:42:01  the escape hatch fires after 652 minutes. To decide whether it
//             really posted it reads execution.receipt -- written by the same
//             write-back that just failed, so absent by construction. It
//             concludes 'failed'.
//   15:50:00  'failed' is eligible, so it dispatches again. Duplicate reply to
//             a stranger, on the brand account.
//
// The recovery test read exactly the state its own failure mode destroys. It
// could never recover a real success; it would always re-post.
//
// THE RULE: for an operation that is publicly visible and not idempotent,
// "we do not know whether it worked" must never resolve to "do it again". A
// missed reply costs nothing -- another thread arrives in two hours. A duplicate
// is permanent, public, and reads as spam.
//
// Pure. No I/O. The caller applies the verdict.

'use strict';

const STUCK_THRESHOLD_MS = 15 * 60 * 1000;

// Types whose side effect is visible to strangers and cannot be undone.
const PUBLIC_POST_TYPES = ['social_post.reply', 'social_post.publish', 'social_post.schedule'];

function _hasUsableReceipt(execution) {
  const r = execution && execution.receipt;
  return !!(r && (r.post_id || r.post_url || r.public_url));
}

/**
 * @returns {{verdict:string, requiresManualReview:boolean, error:?object}}
 *   'not_applicable' — not a running action, nothing to resolve
 *   'still_running'  — inside the threshold, leave it
 *   'success'        — a receipt proves it shipped; promote
 *   'needs_review'   — public post, outcome unknown. STOP. A human decides.
 *   'failed'         — non-public action; retrying is safe
 */
function resolveStuckExecution(action, nowMs, thresholdMs) {
  const a = (action && typeof action === 'object') ? action : {};
  const ex = a.execution;
  if (!ex || typeof ex !== 'object' || ex.status !== 'running') {
    return { verdict: 'not_applicable', requiresManualReview: false, error: null };
  }

  // Already parked for a human — never re-resolve it into something retryable.
  if (ex.requires_manual_review) {
    return { verdict: 'needs_review', requiresManualReview: true, error: ex.last_error || null };
  }

  const started = Date.parse(ex.started_at || '');
  const isPublic = PUBLIC_POST_TYPES.indexOf(a.type || a.action_type) !== -1;

  if (!Number.isFinite(started)) {
    // No readable start time. For a public post, "cannot tell how long" is the
    // same unknown as "cannot tell whether it posted" — park it rather than let
    // it fall through to a fresh dispatch. Anything else can wait for a real
    // timestamp on the next pass.
    return isPublic
      ? {
          verdict: 'needs_review', requiresManualReview: true,
          error: { code: 'RUN_STUCK_UNVERIFIED', message: 'Dispatched with no readable start time; outcome unknown. Not retried automatically — verify on the platform before re-sending.' }
        }
      : { verdict: 'still_running', requiresManualReview: false, error: null };
  }

  const runningFor = nowMs - started;
  if (runningFor <= (Number.isFinite(thresholdMs) ? thresholdMs : STUCK_THRESHOLD_MS)) {
    return { verdict: 'still_running', requiresManualReview: false, error: null };
  }

  if (_hasUsableReceipt(ex)) {
    return { verdict: 'success', requiresManualReview: false, error: null };
  }

  const mins = Math.round(runningFor / 60000);
  if (isPublic) {
    return {
      verdict: 'needs_review',
      requiresManualReview: true,
      error: {
        code: 'RUN_STUCK_UNVERIFIED',
        message: 'Dispatched ' + mins + ' minutes ago and never confirmed. It may already be live, so it will NOT be retried automatically — verify on the platform, then mark success or re-approve.'
      }
    };
  }

  return {
    verdict: 'failed',
    requiresManualReview: false,
    error: { code: 'RUN_STUCK', message: 'Execution stuck running for ' + mins + ' minutes' }
  };
}

module.exports = { resolveStuckExecution, STUCK_THRESHOLD_MS, PUBLIC_POST_TYPES };
