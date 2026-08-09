// engagement-summary.js — the Engagement Inbox at a glance, on the Analytics Hub.
//
// This zone WAS the whole inbox for one evening (2026-08-09). It is now a
// summary that links to modules/company/engagement.html, because the inbox
// stopped being a metric and became a workspace: it creates tasks, it has five
// statuses worth filtering, and approving a drafted reply in context does not
// fit in a tab that also has to leave room for a traffic chart.
//
// The rule that shapes this file: A SUMMARY, NOT A SECOND COPY. It shows the
// counts, the two newest conversations clipped to one line each, and a way in.
// Anything that invites you to read or act belongs on the page — two full
// copies of an inbox is how they drift.
(function () {
  'use strict';

  if (!window.AHShared) {
    console.warn('[engagement-summary] AHShared not loaded — aborting');
    return;
  }

  var S = window.AHShared;
  var esc = S.esc;
  var relTime = S.relTime;

  var CONTAINER_ID = 'engagement-inbox-summary';
  var PAGE = '/modules/company/engagement.html';
  var DAYS = 30;
  var PREVIEW = 2;

  function openLink(label) {
    return '<a class="ei-sum-more" href="' + PAGE + '">' + esc(label) +
      ' <i class="fas fa-arrow-right"></i></a>';
  }

  /**
   * Which conversations are worth the two preview slots.
   *
   * Unanswered first — a person waiting outranks a person already answered —
   * and only then the newest. `needsAttention` counts the same set: never
   * drafted, PLUS the ones whose draft task died and produced nothing. That
   * second group used to read as healthy and in-queue.
   */
  function previewRows(replies) {
    var unanswered = replies.filter(function (r) {
      return r.status === 'new' || r.draft_state === 'task_canceled' || r.draft_state === 'task_missing';
    });
    var pool = unanswered.length ? unanswered : replies;
    return pool.slice(0, PREVIEW);
  }

  function renderRow(r) {
    // Deep link, so the glance and the workspace agree on which conversation.
    return '<a class="ei-sum-row" href="' + PAGE + '#' + esc(r.id) + '">' +
      '<span class="ei-sum-author">@' + esc(r.author) + '</span>' +
      '<span class="ei-sum-text">' + esc(r.text) + '</span>' +
      '<span class="ei-sum-when">' + esc(relTime(r.at)) + '</span>' +
      '</a>';
  }

  function renderCounts(c) {
    var chips = [];
    if (c.needsAttention > 0) {
      chips.push('<span class="ei-sum-count ei-sum-count--wait">' + c.needsAttention + ' need' +
        (c.needsAttention === 1 ? 's' : '') + ' a reply</span>');
    }
    chips.push('<span class="ei-sum-count">' + c.replies + ' repl' + (c.replies === 1 ? 'y' : 'ies') + '</span>');
    chips.push('<span class="ei-sum-count">' + c.likes + ' like' + (c.likes === 1 ? '' : 's') + '</span>');
    chips.push('<span class="ei-sum-count">' + c.reposts + ' repost' + (c.reposts === 1 ? '' : 's') + '</span>');
    return '<div class="ei-sum-counts">' + chips.join('') + '</div>';
  }

  function render(data) {
    var el = document.getElementById(CONTAINER_ID);
    if (!el) return;

    var replies = data.replies || [];
    var counts = data.counts || {};

    // Three different nothings, and conflating them is how a broken harvester
    // hides behind a quiet audience.
    if (!data.meta.replyStoreExists) {
      el.innerHTML = S.emptyState({
        icon: 'inbox',
        title: 'The reply store has never been written',
        hint: 'companyHeartbeat/engagement-reply.js populates it from the daily outcomeRefresh cron. An empty store means the harvester has not run, not that nobody replied.'
      }) + openLink('Open the inbox');
      return;
    }
    if (!replies.length && !(data.reactions || []).length) {
      el.innerHTML = S.emptyState({
        icon: 'inbox',
        title: 'No interactions in the last ' + data.meta.days + ' days',
        hint: 'Replies are harvested from Bluesky only. Likes and reposts cover X and LinkedIn too, so this being empty means nothing landed anywhere we can see.'
      }) + openLink('Open the inbox');
      return;
    }

    var html = renderCounts(counts);
    var rows = previewRows(replies);
    html += rows.map(renderRow).join('');

    // counts.replies, not replies.length: the payload is capped at five rows and
    // "read all 5" would understate the pile every time the cap bites.
    var total = counts.replies || replies.length;
    html += openLink(total > rows.length
      ? 'Read all ' + total + ' conversations'
      : 'Open the inbox');

    // The chips mix coverage on purpose — replies are Bluesky only, likes and
    // reposts are all three platforms — so the asymmetry has to be said out
    // loud rather than left for someone to assume.
    if (data.coverage && data.coverage.note) {
      html += '<p class="ei-sum-note">' + esc(data.coverage.note) + '</p>';
    }

    el.innerHTML = html;
  }

  function renderError(err) {
    var el = document.getElementById(CONTAINER_ID);
    if (!el) return;
    el.innerHTML = S.emptyState({
      icon: 'triangle-exclamation',
      title: 'Could not load the engagement summary',
      hint: String((err && err.message) || err)
    }) + openLink('Open the inbox');
  }

  // This endpoint is secret-gated, unlike the other hub zones. If the page loads
  // before CompanyStore has picked up the write key there is nothing to send
  // yet, so a 403 on the first attempt is a timing problem, not an auth one —
  // retry once when the store announces itself rather than leaving a permanent
  // error where the inbox should be.
  var _retried = false;
  var _inFlight = false;

  function load() {
    var el = document.getElementById(CONTAINER_ID);
    if (!el || _inFlight) return;
    _inFlight = true;
    // limit=5 is a payload budget, not a statistic: counts are computed over the
    // whole window server-side, so the chips stay right while the card stays small.
    S.fetchJSON('/api/engagement-inbox?days=' + DAYS + '&limit=5')
      .then(function (data) {
        _inFlight = false;
        render(data);
        S.publish('engagementInbox.loaded', {
          needsAttention: (data.counts && data.counts.needsAttention) || 0,
          replies: (data.counts && data.counts.replies) || 0
        });
      })
      .catch(function (err) {
        _inFlight = false;
        if (!_retried && /\b(401|403)\b/.test(String((err && err.message) || ''))) {
          _retried = true;
          el.innerHTML = '<div class="ah-loading">Waiting for credentials&hellip;</div>';
          // Belt and braces: the event may already have fired before this script
          // ran. _inFlight makes the double trigger harmless.
          window.addEventListener('companystoreready', load, { once: true });
          setTimeout(load, 1500);
          return;
        }
        renderError(err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }

  window.EngagementInbox = { reload: load };
})();
