// facebook-comments.js — harvest Facebook Page comments into `engagementReplies`.
//
// WHY THIS EXISTS
//
// The adapter has been able to READ comments since 2026-08-08
// (executors/social/facebook.js:fetchPostComments) and the Engagement Inbox has
// been able to RENDER a non-Bluesky conversation since 2026-08-09 (it reads a
// per-entry `platform`, `permalink` and `ourPostPermalink`). Nothing connected
// the two, so a Facebook comment was readable and displayable and still invisible:
// the store was simply never written with one.
//
// WHERE IT RUNS, AND WHY NOT THE HEARTBEAT
//
// The Bluesky equivalent (companyHeartbeat/engagement-reply.js) is driven from
// the outcomeRefresh cron, and wiring a new module into companyHeartbeat/index.js
// is off-limits. socialEngagementPull already walks recent successful posts on a
// 6-hour timer and already loads `actions` — the two things this needs — so it
// hosts the poller without the pump changing at all.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It never replies. facebook.js:replyToComment stays unwired to any automation:
// the reply lane has no fabrication guard, and a model-invented first-person
// anecdote has already cleared the quality gate at 95% once. Harvested Facebook
// rows are blocked from the drafter by REPLYABLE_PLATFORMS in engagement-reply.js
// and are answered by a human, on Facebook.
//
// READ FAILURES ARE NOT EMPTINESS
//
// fetchPostComments returns null for "we could not look" and [] for "nobody
// commented". Those stay different the whole way through: null increments
// readErrors and writes nothing, [] is a post that genuinely has no comments.
// Collapsing them is how a lapsed token starts reading as silence — which is
// exactly the failure mode waiting on 2026-11-07 when data_access_expires_at
// lands and Graph starts returning empty instead of erroring.

var engagement = require('../companyHeartbeat/engagement-reply');

// Comment reads per cycle, across all posts. Anything deferred is LOGGED, never
// silently dropped — a cap that does not announce itself reads as "we checked
// everything and found nothing".
var MAX_COMMENT_FETCHES = 25;
var MAX_COMMENTS_PER_POST = 50;

/**
 * Pure. Graph comment rows → engagementReplies candidates.
 *
 * `ourPost` is { postId, actionId, permalink, text }.
 * `pageId` excludes the Page talking to itself — our own replies are comments on
 * our own post and would otherwise arrive as strangers needing an answer.
 *
 * Shape notes:
 *  - replyUri is namespaced 'fb:<comment id>' because it is the dedup key for the
 *    whole store, which now holds two id spaces. An unprefixed Graph id is all
 *    digits and underscores and could not be told apart from a malformed at:// URI.
 *  - rootUri is the POST, so filterCandidates' per-thread accounting
 *    (author|rootUri) means "this person, under this post".
 *  - permalink / ourPostPermalink are what the inbox renders as links for any
 *    non-Bluesky row; a bsky.app URL built from a Graph id would 404.
 */
function buildCommentEntries(comments, ourPost, pageId, nowMs) {
  var out = { candidates: [], selfExcluded: 0, malformed: 0 };
  if (!Array.isArray(comments) || !ourPost || !ourPost.postId) return out;

  comments.forEach(function (c) {
    // The id is the dedup key. Without one this comment would be re-added as a
    // brand new conversation on every single run, forever.
    if (!c || !c.id) { out.malformed++; return; }
    if (pageId && c.author_id && String(c.author_id) === String(pageId)) { out.selfExcluded++; return; }

    out.candidates.push({
      platform: 'facebook',
      replyUri: 'fb:' + c.id,
      replyCid: null,
      rootUri: 'fb:' + ourPost.postId,
      rootCid: null,
      // The adapter already anonymises a commenter Graph will not name
      // ('Facebook user'), and the inbox drops any row without an author.
      author: c.author || 'Facebook user',
      authorDid: c.author_id ? 'fb:' + c.author_id : null,
      text: String(c.text || '').substring(0, 500),
      indexedAt: c.created_time || new Date(nowMs).toISOString(),
      permalink: c.permalink || '',
      ourPostActionId: ourPost.actionId || null,
      ourPostAtUri: null,
      ourPostPermalink: ourPost.permalink || '',
      ourPostText: String(ourPost.text || '').substring(0, 300)
    });
  });

  return out;
}

/**
 * Pure. Recent successful Facebook posts worth polling for comments.
 *
 * The post id comes from the action RECEIPT, never from parsing post_url. Pages on
 * the New Pages Experience publish under an actor id that is not the Page id, so a
 * composite id reconstructed from a URL is a guess — and a guessed id silently
 * returns someone else's comments or none at all. A post whose receipt we no longer
 * hold (the actions store is trimmed) is reported as skippedNoPostId, not invented.
 */
function selectFacebookTargets(events, actionsById, sinceMs, limit) {
  var seen = {};
  var targets = [];
  var skippedNoPostId = 0;

  (Array.isArray(events) ? events : [])
    .filter(function (e) {
      return e && e.event_type === 'execution' && e.result === 'success' && e.platform === 'facebook';
    })
    .filter(function (e) {
      var ts = Date.parse(e.executed_at || e.created_at || '');
      return !Number.isNaN(ts) && ts >= sinceMs;
    })
    .sort(function (a, b) {
      return Date.parse(b.executed_at || b.created_at || '') - Date.parse(a.executed_at || a.created_at || '');
    })
    .forEach(function (e) {
      var action = actionsById[e.action_id];
      var receipt = (action && action.execution && action.execution.receipt) || null;
      var postId = (receipt && receipt.post_id) || '';
      if (!postId) { skippedNoPostId++; return; }
      if (seen[postId]) return;
      seen[postId] = true;
      if (targets.length >= limit) return;
      targets.push({
        postId: postId,
        actionId: e.action_id || null,
        permalink: (receipt && receipt.post_url) || e.post_url || '',
        text: (action && action.payload && action.payload.text) || ''
      });
    });

  return { targets: targets, skippedNoPostId: skippedNoPostId };
}

/**
 * IO shell. Polls comments for recent Facebook posts and merges them into
 * `engagementReplies`.
 *
 * Injectable fetchComments / getPageId keep the pure path testable without Graph.
 *
 * The write is a storage.mutateState against FRESH state, never a whole-array
 * setState: the Bluesky loop in outcomeRefresh writes this same blob on its own
 * schedule, and a read-modify-write held across ~25 network calls is precisely the
 * clobber that stranded action receipts on 2026-08-08.
 */
async function pullFacebookComments(opts) {
  var storage = opts.storage;
  var log = opts.log || function () {};
  var nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  var events = opts.events || [];
  var actionsById = opts.actionsById || {};
  var sinceMs = opts.sinceMs;
  var fetchComments = opts.fetchComments;
  var getPageId = opts.getPageId;
  var maxFetches = Number.isFinite(opts.maxFetches) ? opts.maxFetches : MAX_COMMENT_FETCHES;

  var sel = selectFacebookTargets(events, actionsById, sinceMs, maxFetches);
  if (sel.skippedNoPostId > 0) {
    log('[facebook-comments] ' + sel.skippedNoPostId + ' recent Facebook post(s) skipped — no receipt.post_id held (action trimmed); their comments cannot be polled');
  }
  if (!sel.targets.length) {
    return { polled: 0, added: 0, readErrors: 0, selfExcluded: 0, malformed: 0, skippedNoPostId: sel.skippedNoPostId };
  }

  var pageId = null;
  try {
    pageId = await getPageId();
  } catch (e) {
    // Not fatal, but it does mean our own Page replies arrive as strangers. Say so.
    log('[facebook-comments] page id unavailable — self-authored comments cannot be excluded this run: ' + String((e && e.message) || e).substring(0, 150));
  }

  var candidates = [];
  var readErrors = 0, selfExcluded = 0, malformed = 0, polled = 0, emptyPosts = 0;

  for (var i = 0; i < sel.targets.length; i++) {
    var t = sel.targets[i];
    var rows;
    try {
      polled++;
      rows = await fetchComments(t.postId, { limit: MAX_COMMENTS_PER_POST });
    } catch (err) {
      readErrors++;
      log('[facebook-comments] comment read threw for ' + t.postId + ' (non-fatal): ' + String((err && err.message) || err).substring(0, 150));
      continue;
    }
    // null is the adapter saying "could not look". Not the same as [].
    if (rows === null || rows === undefined) {
      readErrors++;
      log('[facebook-comments] comment read FAILED for post ' + t.postId + ' — this is a hole in what we know, not an absence of comments');
      continue;
    }
    if (!rows.length) { emptyPosts++; continue; }

    var built = buildCommentEntries(rows, t, pageId, nowMs);
    candidates = candidates.concat(built.candidates);
    selfExcluded += built.selfExcluded;
    malformed += built.malformed;
  }

  var added = 0;
  if (candidates.length) {
    var res = await storage.mutateState('engagementReplies', function (fresh) {
      var store = Array.isArray(fresh) ? fresh.slice() : [];
      // Reused, not reimplemented: mergeCandidates owns dedup-by-replyUri, the id
      // stamp, the 'new' status defaults and the store cap. A second copy here
      // would drift from the loop that reads the same blob.
      var m = engagement.mergeCandidates(store, candidates, nowMs);
      added = m.added;
      return added > 0 ? store : undefined;
    });
    if (!res.written && added > 0) {
      log('[facebook-comments] WRITE FAILED — ' + added + ' harvested comment(s) were NOT persisted and will be re-harvested next run');
      added = 0;
    }
  }

  var summary = {
    polled: polled,
    emptyPosts: emptyPosts,
    harvested: candidates.length,
    added: added,
    readErrors: readErrors,
    selfExcluded: selfExcluded,
    malformed: malformed,
    skippedNoPostId: sel.skippedNoPostId
  };
  log('[facebook-comments] ' + JSON.stringify(summary));
  return summary;
}

module.exports = {
  buildCommentEntries: buildCommentEntries,
  selectFacebookTargets: selectFacebookTargets,
  pullFacebookComments: pullFacebookComments,
  MAX_COMMENT_FETCHES: MAX_COMMENT_FETCHES,
  MAX_COMMENTS_PER_POST: MAX_COMMENTS_PER_POST
};
