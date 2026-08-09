// engagement-inbox.js — Engagement Inbox zone of the Analytics Hub.
//
// Reads GET /api/engagement-inbox and renders every real interaction with our
// posts as a row you can read: who replied, what they said, which post they were
// replying to, and whether anyone has answered them.
//
// WHY ROWS AND NOT A CHART. Four months of posting produced 65 interactions. At
// that volume an average, a trend line and a trophy all round to noise, and the
// only useful action is to read every one of them and reply. The panel this
// replaces showed a trophy over a post with 2 likes and "7 comments across 4
// posts" — with the post text blank and the comments unreachable. It reported
// that a conversation existed while hiding the conversation.
//
// The reply text has existed in the `engagementReplies` store since 2026-07-28
// and nothing read it until this.
(function () {
  'use strict';

  if (!window.AHShared) {
    console.warn('[engagement-inbox] AHShared not loaded — aborting');
    return;
  }

  var S = window.AHShared;
  var esc = S.esc;
  var relTime = S.relTime;

  var CONTAINER_ID = 'engagement-inbox-body';
  var DAYS = 30;

  var PLATFORM_ICON = {
    bluesky: 'fas fa-cloud',
    x: 'fab fa-x-twitter',
    linkedin: 'fab fa-linkedin',
    facebook: 'fab fa-facebook',
    reddit: 'fab fa-reddit'
  };
  var PLATFORM_COLOR = {
    bluesky: '#60a5fa',
    x: '#e5e7eb',
    linkedin: '#0a66c2',
    facebook: '#1877f2',
    reddit: '#ff4500'
  };

  // What each status means for the human reading this. 'new' is the only one
  // that represents a person still waiting.
  var STATUS = {
    new: { label: 'needs a reply', tone: 'wait' },
    task_created: { label: 'draft queued — waiting on your approval', tone: 'pending' },
    answered: { label: 'answered', tone: 'done' },
    skipped: { label: 'skipped', tone: 'muted' }
  };

  function platformChip(platform) {
    var icon = PLATFORM_ICON[platform] || 'fas fa-share-alt';
    var color = PLATFORM_COLOR[platform] || '#94a3b8';
    return '<i class="' + icon + ' ei-plat" style="color:' + color + '"></i>';
  }

  function extLink(href, title) {
    if (!href) return '';
    return '<a class="ei-link" href="' + esc(href) + '" target="_blank" rel="noopener" title="' +
      esc(title || 'Open') + '"><i class="fas fa-arrow-up-right-from-square"></i></a>';
  }

  function renderReply(r) {
    var meta = STATUS[r.status] || { label: r.status || 'unknown', tone: 'muted' };
    var label = meta.label;
    if (r.status === 'skipped' && r.skip_reason) label += ' — ' + r.skip_reason;

    var html = '<article class="ei-row ei-row--reply ei-row--' + esc(meta.tone) + '">';

    html += '<div class="ei-row-head">';
    html += platformChip(r.platform);
    html += '<span class="ei-author">@' + esc(r.author) + '</span>';
    html += '<span class="ei-verb">replied</span>';
    html += '<span class="ei-when">' + esc(relTime(r.at)) + '</span>';
    html += '<span class="ei-status ei-status--' + esc(meta.tone) + '">' + esc(label) + '</span>';
    html += extLink(r.link, 'Open this reply on ' + r.platform);
    html += '</div>';

    // Their words, in full and unclipped. Truncating the one human sentence in
    // the whole dashboard would defeat the point of the panel.
    html += '<blockquote class="ei-said">' + esc(r.text) + '</blockquote>';

    if (r.our_post_text) {
      html += '<div class="ei-context">' +
        '<i class="fas fa-turn-up ei-context-arrow"></i>' +
        '<span class="ei-context-label">on our post:</span> ' +
        '<span class="ei-context-text">' + esc(r.our_post_text) + '</span>' +
        (r.our_post_link ? extLink(r.our_post_link, 'Open our post') : '') +
        '</div>';
    }

    html += '</article>';
    return html;
  }

  function metricBits(r) {
    var bits = [];
    if (r.likes) bits.push('<span class="ei-metric ei-metric--like"><i class="fas fa-heart"></i> ' + r.likes + '</span>');
    if (r.reposts) bits.push('<span class="ei-metric ei-metric--repost"><i class="fas fa-retweet"></i> ' + r.reposts + '</span>');
    if (r.comments) bits.push('<span class="ei-metric ei-metric--comment"><i class="fas fa-comment"></i> ' + r.comments + '</span>');
    return bits.join('');
  }

  function renderReaction(r) {
    return '<article class="ei-row ei-row--reaction">' +
      '<div class="ei-row-head">' +
      platformChip(r.platform) +
      '<span class="ei-reaction-metrics">' + metricBits(r) + '</span>' +
      '<span class="ei-reaction-text">' + esc(r.our_post_text) + '</span>' +
      extLink(r.link, 'Open post') +
      '</div>' +
      '</article>';
  }

  /**
   * Posts whose text predates the capture stamp (2026-08-09) cannot recover it.
   * Rendering them as rows produced seventeen identical lines reading "post text
   * not captured" — which is the blank-row problem this panel was built to fix,
   * wearing a label. They collapse into one honest line instead: the engagement
   * is still counted, the posts are still reachable, and the panel does not
   * spend most of its height saying nothing.
   */
  function renderTextlessRollup(rows) {
    var likes = 0, reposts = 0;
    rows.forEach(function (r) { likes += r.likes; reposts += r.reposts; });

    var links = rows
      .filter(function (r) { return r.link; })
      .map(function (r, i) {
        return '<a class="ei-rollup-link" href="' + esc(r.link) + '" target="_blank" rel="noopener">' +
          platformChip(r.platform) + (i + 1) + '</a>';
      })
      .join('');

    return '<article class="ei-row ei-row--rollup">' +
      '<div class="ei-rollup-head">' +
      '<span class="ei-reaction-metrics">' + metricBits({ likes: likes, reposts: reposts, comments: 0 }) + '</span>' +
      '<span class="ei-rollup-text">across ' + rows.length + ' older post' + (rows.length === 1 ? '' : 's') +
      ' whose text was never captured &mdash; stamping started 2026-08-09</span>' +
      '</div>' +
      (links ? '<div class="ei-rollup-links">' + links + '</div>' : '') +
      '</article>';
  }

  function renderCounts(c) {
    var chips = [];
    if (c.needsAttention > 0) {
      chips.push('<span class="ei-count ei-count--wait">' + c.needsAttention + ' need' +
        (c.needsAttention === 1 ? 's' : '') + ' a reply</span>');
    }
    chips.push('<span class="ei-count">' + c.replies + ' repl' + (c.replies === 1 ? 'y' : 'ies') + '</span>');
    chips.push('<span class="ei-count">' + c.likes + ' like' + (c.likes === 1 ? '' : 's') + '</span>');
    chips.push('<span class="ei-count">' + c.reposts + ' repost' + (c.reposts === 1 ? '' : 's') + '</span>');
    return '<div class="ei-counts">' + chips.join('') + '</div>';
  }

  function renderEmpty(data) {
    // Three different nothings, and conflating them is how a broken harvester
    // hides behind a quiet audience.
    if (!data.meta.replyStoreExists) {
      return S.emptyState({
        icon: 'inbox',
        title: 'The reply store has never been written',
        hint: 'companyHeartbeat/engagement-reply.js populates it from the daily outcomeRefresh cron. An empty store means the harvester has not run, not that nobody replied.'
      });
    }
    return S.emptyState({
      icon: 'inbox',
      title: 'No interactions in the last ' + data.meta.days + ' days',
      hint: 'Replies are harvested from Bluesky only. Likes and reposts cover X and LinkedIn too, so this being empty means nothing landed anywhere we can see.'
    });
  }

  function render(data) {
    var el = document.getElementById(CONTAINER_ID);
    if (!el) return;

    var replies = data.replies || [];
    var reactions = data.reactions || [];

    if (!replies.length && !reactions.length) {
      el.innerHTML = renderEmpty(data);
      return;
    }

    var html = renderCounts(data.counts);

    if (replies.length) {
      html += '<div class="ei-section-label">Conversations</div>';
      html += replies.map(renderReply).join('');
    }

    if (reactions.length) {
      var readable = reactions.filter(function (r) { return r.our_post_text; });
      var textless = reactions.filter(function (r) { return !r.our_post_text; });

      html += '<div class="ei-section-label">Reactions <span class="ei-section-note">' +
        'no conversation attached — a like is all the platform gives us</span></div>';
      html += readable.map(renderReaction).join('');
      if (textless.length) html += renderTextlessRollup(textless);
    }

    // Never let an absent platform read as a silent one.
    if (data.coverage && data.coverage.note) {
      html += '<p class="ei-coverage"><i class="fas fa-circle-info"></i> ' + esc(data.coverage.note) + '</p>';
    }

    el.innerHTML = html;
  }

  function renderError(err) {
    var el = document.getElementById(CONTAINER_ID);
    if (!el) return;
    el.innerHTML = S.emptyState({
      icon: 'triangle-exclamation',
      title: 'Could not load the engagement inbox',
      hint: String((err && err.message) || err)
    });
  }

  function load() {
    var el = document.getElementById(CONTAINER_ID);
    if (!el) return;
    S.fetchJSON('/api/engagement-inbox?days=' + DAYS + '&limit=50')
      .then(function (data) {
        render(data);
        S.publish('engagementInbox.loaded', {
          needsAttention: (data.counts && data.counts.needsAttention) || 0,
          replies: (data.counts && data.counts.replies) || 0
        });
      })
      .catch(renderError);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }

  window.EngagementInbox = { reload: load };
})();
