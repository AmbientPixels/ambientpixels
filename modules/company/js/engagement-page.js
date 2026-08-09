// engagement-page.js — the Engagement Inbox as a page, not a dashboard zone.
//
// WHAT THIS IS. The only place in the platform where a stranger's words reach a
// human. `engagementReplies` has been filling since 2026-07-28 with the author,
// full text and thread context of every reply to our Bluesky posts, and had zero
// readers until 2026-08-09. This is the workspace for answering them.
//
// WHY A PAGE. It was zone 2 of the Analytics Hub for one evening. Every other
// zone there is read-only; this one creates tasks, has five statuses worth
// filtering, and had to roll its reactions into a single line purely for
// vertical space — a section constraint deciding a product question.
//
// ROWS, NOT CHARTS. 195 posts produced 65 interactions in four months. At that
// volume an average rounds to noise and the useful act is reading every one.
// There is deliberately no sparkline on this page.
//
// SAY WHICH NOTHING YOU MEAN. "The store was never written", "nobody has replied
// in 60 days", "this segment is empty" and "your search matched nothing" are
// four different problems and every one of them has its own sentence below. The
// section version shipped four bugs of exactly that shape in one evening.
(function () {
  'use strict';

  if (!window.AHShared) {
    console.warn('[engagement-page] AHShared not loaded — aborting');
    return;
  }

  var S = window.AHShared;
  var esc = S.esc;
  var relTime = S.relTime;

  // 60 days, not the hub's 30: snapshots live 60 days, the reply store holds 500
  // entries, and this is the place you come to read the whole conversation
  // history rather than glance at the week.
  var DAYS = 60;
  var LIMIT = 100;

  var PLATFORM_ICON = {
    bluesky: 'fas fa-cloud',
    x: 'fab fa-x-twitter',
    linkedin: 'fab fa-linkedin',
    facebook: 'fab fa-facebook',
    reddit: 'fab fa-reddit'
  };

  // What each status means for the human reading this. 'new' is the only one
  // that represents a person still waiting.
  var STATUS = {
    new: { label: 'needs a reply', tone: 'wait' },
    task_created: { label: 'drafting', tone: 'pending' },
    answered: { label: 'answered', tone: 'done' },
    skipped: { label: 'skipped', tone: 'muted' }
  };

  // What actually became of the draft task. `task_created` only ever meant "a
  // task exists for Scribe", but the chip read "waiting on your approval" — and
  // three of them pointed at tasks CANCELLED on 2026-08-08, so the panel sent
  // the reader to an approval queue that did not contain them.
  var DRAFT_STATE = {
    awaiting_approval: { label: 'waiting on your approval', tone: 'pending' },
    drafting: { label: 'Scribe is drafting it', tone: 'pending' },
    task_canceled: { label: 'the draft task was cancelled', tone: 'wait' },
    task_missing: { label: 'the draft task is gone', tone: 'wait' }
  };

  // Why the automated drafter passed on a 'new' item. 'new' is NOT a queue:
  // engagement-reply.js drops anything past maxAgeHours permanently, so most of
  // these will never be drafted by anything.
  var BLOCKED = {
    too_old: 'aged out — the drafter only picks up comments under 72h',
    author_thread_done: 'the drafter only follows up once per thread',
    author_cooldown: 'we replied to them within the last 14 days',
    too_short: 'too short to answer',
    daily_budget: 'today\'s draft budget is spent',
    unknown: 'the drafter passed on this'
  };

  // Same rule names, different sentence, because they answer different
  // questions. BLOCKED says why the automation passed; this says why a click
  // cannot help either.
  var BLOCKED_OVERRIDE = {
    author_thread_done: 'we have already replied twice in this thread',
    author_cooldown: 'we replied to them within the last 14 days',
    too_short: 'too short to answer',
    daily_budget: 'today\'s draft budget is spent',
    unknown: 'a guard blocks this'
  };

  var SEGMENTS = [
    { id: 'needs', label: 'Needs a reply', icon: 'fa-hand' },
    { id: 'progress', label: 'In progress', icon: 'fa-hourglass-half' },
    { id: 'answered', label: 'Answered', icon: 'fa-check' },
    { id: 'skipped', label: 'Skipped', icon: 'fa-ban' },
    { id: 'all', label: 'All', icon: 'fa-list-ul' }
  ];

  // ── State ──────────────────────────────────────────────────────
  var _data = null;
  var _segment = 'needs';
  var _query = '';
  var _rxPlatform = 'all';
  var _focusId = '';

  // ── Classification ─────────────────────────────────────────────
  /**
   * Exactly one segment per row, so nothing can be filed twice or nowhere.
   *
   * 'needs' must match the API's counts.needsAttention definition or the tab
   * count and the sidebar badge disagree about the same word: unanswered means
   * never drafted, PLUS the ones whose draft task died and produced nothing.
   * That second group used to read as healthy and in-queue.
   */
  function segmentOf(r) {
    if (!r) return 'other';
    if (r.status === 'new') return 'needs';
    if (r.status === 'task_created') {
      return (r.draft_state === 'task_canceled' || r.draft_state === 'task_missing')
        ? 'needs' : 'progress';
    }
    if (r.status === 'answered') return 'answered';
    if (r.status === 'skipped') return 'skipped';
    return 'other'; // a status this page does not know — surfaced in All, never dropped
  }

  function matchesQuery(r, q) {
    if (!q) return true;
    return ((r.author || '') + ' ' + (r.text || '') + ' ' + (r.our_post_text || ''))
      .toLowerCase().indexOf(q) !== -1;
  }

  function visibleReplies() {
    var q = _query.trim().toLowerCase();
    return (_data && _data.replies ? _data.replies : []).filter(function (r) {
      if (_segment !== 'all' && segmentOf(r) !== _segment) return false;
      return matchesQuery(r, q);
    });
  }

  // ── Small builders ─────────────────────────────────────────────
  function platformChip(platform) {
    var key = String(platform || '').toLowerCase();
    var icon = PLATFORM_ICON[key] || 'fas fa-share-alt';
    var tone = PLATFORM_ICON[key] ? key : 'other';
    return '<i class="' + icon + ' ei-plat ei-plat--' + esc(tone) + '"></i>';
  }

  function extLink(href, title) {
    if (!href) return '';
    return '<a class="ei-link" href="' + esc(href) + '" target="_blank" rel="noopener" title="' +
      esc(title || 'Open') + '"><i class="fas fa-arrow-up-right-from-square"></i></a>';
  }

  // .ap-empty lives in company.css and is on every dashboard page, so an empty
  // state here looks like an empty state everywhere else.
  function emptyState(icon, title, hint) {
    return '<div class="ap-empty"><i class="fas fa-' + esc(icon) + '"></i>' +
      '<div class="ei-empty-title">' + esc(title) + '</div>' +
      (hint ? '<div class="ei-empty-hint">' + esc(hint) + '</div>' : '') +
      '</div>';
  }

  function plural(n, one, many) { return n === 1 ? one : many; }

  // ── Counts strip ───────────────────────────────────────────────
  function statTile(opts) {
    var cls = 'ei-stat' + (opts.wait ? ' ei-stat--wait' : '');
    var valueCls = 'ei-stat-value' + (opts.none ? ' ei-stat-value--none' : '');
    return '<div class="' + cls + '">' +
      '<div class="' + valueCls + '">' + esc(opts.value) + '</div>' +
      '<div class="ei-stat-label">' + esc(opts.label) + '</div>' +
      (opts.sub ? '<div class="ei-stat-sub">' + esc(opts.sub) + '</div>' : '') +
      '</div>';
  }

  function fmtHours(h) {
    if (h < 1) return Math.round(h * 60) + 'm';
    if (h < 48) return (Math.round(h * 10) / 10) + 'h';
    return (Math.round(h / 24 * 10) / 10) + 'd';
  }

  /**
   * The median tile, which is the one that most wants to lie.
   *
   * Under three samples there is no number, and the sub-line says WHICH kind of
   * absence it is: nobody answered, not enough answered yet, or answered back
   * when reconcileEngagement was not yet stamping answeredAt. A confident 0h
   * here would read as "we reply instantly" — see roast-funnel-reconcile.js for
   * the same rule and the same reason.
   */
  function medianTile(c) {
    var samples = c.responseSamples || 0;
    var untimed = c.answeredNoTimestamp || 0;
    if (c.medianResponseHours != null) {
      return statTile({
        value: fmtHours(c.medianResponseHours),
        label: 'Median response time',
        sub: 'across ' + samples + ' answered ' + plural(samples, 'conversation', 'conversations') +
          (untimed ? ' · ' + untimed + ' more answered before we recorded when' : '')
      });
    }
    var sub;
    if (samples === 0 && untimed === 0) {
      sub = 'nothing has been answered in this window';
    } else if (untimed && samples === 0) {
      sub = untimed + ' answered, but before we recorded when — no interval to measure';
    } else {
      sub = 'needs 3 answered conversations, we have ' + samples +
        (untimed ? ' (' + untimed + ' more have no timestamp)' : '');
    }
    return statTile({ value: 'not yet', none: true, label: 'Median response time', sub: sub });
  }

  function renderStrip() {
    var el = document.getElementById('ei-strip');
    if (!el) return;
    var c = (_data && _data.counts) || {};
    var replies = (_data && _data.replies) || [];
    var drafting = replies.filter(function (r) { return r.draft_state === 'drafting'; }).length;
    var awaiting = replies.filter(function (r) { return r.draft_state === 'awaiting_approval'; }).length;
    var answered = (c.byStatus && c.byStatus.answered) || 0;
    var needs = c.needsAttention || 0;

    var html = statTile({
      value: String(needs),
      label: 'Need a reply',
      wait: needs > 0,
      sub: needs ? (c.draftable || 0) + ' can be drafted from here' : 'everyone has been answered or declined'
    });
    html += statTile({ value: String(drafting), label: 'Scribe is drafting' });
    html += statTile({
      value: String(awaiting),
      label: 'Waiting on you',
      sub: awaiting ? 'approve or reject below' : ''
    });
    html += statTile({
      value: String(answered),
      label: 'Answered',
      sub: 'in the last ' + ((_data && _data.meta && _data.meta.days) || DAYS) + ' days'
    });
    html += medianTile(c);
    el.innerHTML = html;
  }

  // ── Segments ───────────────────────────────────────────────────
  function renderSegments() {
    var el = document.getElementById('ei-segments');
    if (!el) return;
    var replies = (_data && _data.replies) || [];
    var counts = {};
    replies.forEach(function (r) {
      var s = segmentOf(r);
      counts[s] = (counts[s] || 0) + 1;
    });
    counts.all = replies.length;

    el.innerHTML = SEGMENTS.map(function (seg) {
      var n = counts[seg.id] || 0;
      return '<button type="button" class="ap-tab' + (seg.id === _segment ? ' ap-tab--active' : '') +
        '" data-segment="' + seg.id + '">' +
        '<i class="fas ' + seg.icon + '"></i>' + seg.label +
        '<span class="ap-tab-count">' + n + '</span></button>';
    }).join('');

    var btns = el.querySelectorAll('.ap-tab');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        _segment = ev.currentTarget.getAttribute('data-segment');
        renderSegments();
        renderConversations();
      });
    }
  }

  // ── Conversation rows ──────────────────────────────────────────
  function renderReply(r) {
    var meta = STATUS[r.status] || { label: r.status || 'unknown', tone: 'muted' };
    var label = meta.label;
    if (r.status === 'skipped' && r.skip_reason) label += ' — ' + r.skip_reason;
    // The entry status says a task was made; draft_state says what became of it.
    // Prefer the second — it is the one that can be checked.
    if (r.status === 'task_created' && DRAFT_STATE[r.draft_state]) {
      meta = DRAFT_STATE[r.draft_state];
      label = meta.label;
    }
    if (r.status === 'answered' && r.answered_at) {
      var waited = Date.parse(r.answered_at) - Date.parse(r.at);
      if (isFinite(waited) && waited >= 0) label += ' in ' + fmtHours(waited / 3600e3);
    }

    var html = '<article class="ei-row ei-row--reply ei-row--' + esc(meta.tone) + '"'
      + ' id="' + esc(r.id) + '" data-id="' + esc(r.id) + '">';

    html += '<div class="ei-row-head">';
    html += platformChip(r.platform);
    html += '<span class="ei-author">@' + esc(r.author) + '</span>';
    html += '<span class="ei-verb">replied</span>';
    html += '<span class="ei-when">' + esc(relTime(r.at)) + '</span>';
    html += '<span class="ei-status ei-status--' + esc(meta.tone) + '">' + esc(label) + '</span>';
    html += extLink(r.link, 'Open this reply on ' + r.platform);
    html += '</div>';

    // Their words, in full and unclipped. Truncating the one human sentence on
    // the page would defeat the point of it.
    html += '<blockquote class="ei-said">' + esc(r.text) + '</blockquote>';

    if (r.our_post_text) {
      html += '<div class="ei-context">' +
        '<i class="fas fa-turn-up ei-context-arrow"></i>' +
        '<span class="ei-context-label">on our post:</span> ' +
        '<span class="ei-context-text">' + esc(r.our_post_text) + '</span>' +
        (r.our_post_link ? extLink(r.our_post_link, 'Open our post') : '') +
        '</div>';
    }

    var deadDraft = r.status === 'task_created'
      && (r.draft_state === 'task_canceled' || r.draft_state === 'task_missing');
    if (r.status === 'new' || deadDraft) html += renderAction(r, deadDraft);

    html += '</article>';
    return html;
  }

  /**
   * The footer of an unanswered row: why nothing drafted it, and what can be
   * done about it. Three genuinely different situations, and collapsing them
   * was the original sin of this panel.
   */
  function renderAction(r, deadDraft) {
    // A draft task that was cancelled or vanished produced nothing, so this
    // conversation is unanswered whatever the entry status says.
    if (deadDraft) {
      return '<div class="ei-action">' +
        '<span class="ei-action-why"><i class="fas fa-circle-info"></i> ' +
        'the earlier draft task never produced a reply</span>' +
        '<button type="button" class="ei-draft-btn" data-draft-id="' + esc(r.id) + '">' +
        '<i class="fas fa-pen-nib"></i> Draft again</button>' +
        '</div>';
    }

    // blocked_reason null with can_draft true = it passed every rule and the
    // next cron run will draft it. Nothing to do but wait.
    if (!r.blocked_reason && r.can_draft) {
      return '<div class="ei-action ei-action--queued">' +
        '<i class="fas fa-hourglass-half"></i> queued — the drafter will pick this up on its next run' +
        '</div>';
    }

    if (!r.can_draft) {
      // Show the guard that blocks the OVERRIDE, not the cron's first drop.
      // filterCandidates reports drops in a fixed order and too_old runs first,
      // so "aged out" would be a confident wrong answer to "why is there no
      // button" when the real reason is that we replied to that person 11 days
      // ago and the button does not lift the cooldown.
      var realWhy = BLOCKED_OVERRIDE[r.override_blocked_reason]
        || BLOCKED[r.blocked_reason] || BLOCKED_OVERRIDE.unknown;
      return '<div class="ei-action ei-action--blocked">' +
        '<i class="fas fa-hand"></i> ' + esc(realWhy) +
        '<span class="ei-action-note">reply as yourself if it still deserves one</span>' +
        '</div>';
    }

    return '<div class="ei-action">' +
      '<span class="ei-action-why"><i class="fas fa-circle-info"></i> ' +
      esc(BLOCKED[r.blocked_reason] || BLOCKED.unknown) + '</span>' +
      '<button type="button" class="ei-draft-btn" data-draft-id="' + esc(r.id) + '">' +
      '<i class="fas fa-pen-nib"></i> Draft a reply</button>' +
      '</div>';
  }

  /**
   * Four different nothings, and conflating them is how a broken harvester
   * hides behind a quiet audience.
   */
  function emptyConversations() {
    var meta = (_data && _data.meta) || {};
    if (!meta.replyStoreExists) {
      return emptyState('inbox', 'The reply store has never been written',
        'companyHeartbeat/engagement-reply.js populates it from the daily outcomeRefresh cron. An empty store means the harvester has not run, not that nobody replied.');
    }
    var total = (_data && _data.replies ? _data.replies.length : 0);
    if (!total) {
      return emptyState('inbox', 'Nobody has replied in the last ' + (meta.days || DAYS) + ' days',
        'Reply text is harvested from Bluesky only, so this means nobody replied there. It says nothing about X or LinkedIn, where we do not read replies at all.');
    }
    var segLabel = (SEGMENTS.filter(function (s) { return s.id === _segment; })[0] || {}).label || _segment;
    if (_query.trim()) {
      return emptyState('magnifying-glass', 'No conversation in ' + segLabel + ' matches "' + _query.trim() + '"',
        'Search covers the handle, their words and our post text, across the ' + total + ' loaded ' + plural(total, 'conversation', 'conversations') + '. Try All.');
    }
    return emptyState('check', 'Nothing in ' + segLabel,
      'There are ' + total + ' ' + plural(total, 'conversation', 'conversations') + ' in the other segments.');
  }

  function renderConversations() {
    var el = document.getElementById('ei-conversations');
    if (!el) return;
    var rows = visibleReplies();

    if (!rows.length) {
      el.innerHTML = emptyConversations();
      return;
    }

    var html = '';
    // No silent caps. If the API trimmed the window to `limit` rows, the page
    // is showing part of the story and has to say which part.
    var meta = (_data && _data.meta) || {};
    if (meta.repliesTotal > meta.repliesShown) {
      html += '<p class="ei-search-note">Showing the ' + meta.repliesShown + ' newest of ' +
        meta.repliesTotal + ' conversations in the last ' + meta.days + ' days. ' +
        'The counts above cover all of them.</p>';
    }
    // A status this page cannot classify must be visible, not silently absent.
    if (_segment === 'all') {
      var unknown = rows.filter(function (r) { return segmentOf(r) === 'other'; }).length;
      if (unknown) {
        html += '<p class="ei-search-note">' + unknown + ' ' + plural(unknown, 'conversation is', 'conversations are') +
          ' in a status this page does not classify — they appear here and in no other segment.</p>';
      }
    }
    html += rows.map(renderReply).join('');
    el.innerHTML = html;
    bindDraftButtons(el);
    applyFocus();
  }

  // ── Reactions ──────────────────────────────────────────────────
  function metricBits(r) {
    var bits = [];
    if (r.likes) bits.push('<span class="ei-metric ei-metric--like"><i class="fas fa-heart"></i> ' + r.likes + '</span>');
    if (r.reposts) bits.push('<span class="ei-metric ei-metric--repost"><i class="fas fa-retweet"></i> ' + r.reposts + '</span>');
    if (r.comments) bits.push('<span class="ei-metric ei-metric--comment"><i class="fas fa-comment"></i> ' + r.comments + '</span>');
    return bits.join('');
  }

  function renderReaction(r) {
    // `at` is captured_at — when the outcomeRefresh cron last POLLED the
    // platform, not when anyone liked anything. Rendering it as a bare "2h ago"
    // next to a heart says a stranger just reacted; it means we just checked.
    // No platform in the snapshot store tells us when a like happened, so the
    // word "counted" is doing real work here.
    return '<article class="ei-row ei-row--reaction">' +
      '<div class="ei-row-head">' +
      platformChip(r.platform) +
      '<span class="ei-reaction-metrics">' + metricBits(r) + '</span>' +
      '<span class="ei-reaction-text">' + esc(r.our_post_text || '') + '</span>' +
      '<span class="ei-when" title="When we last polled the platform. Nobody tells us when a like happened.">counted ' +
      esc(relTime(r.at)) + '</span>' +
      extLink(r.link, 'Open post') +
      '</div>' +
      '</article>';
  }

  function renderReactions() {
    var el = document.getElementById('ei-reactions');
    if (!el) return;
    var all = (_data && _data.reactions) || [];
    if (!all.length) {
      el.innerHTML = emptyState('heart', 'No likes or reposts in this window',
        'Reactions cover Bluesky, X and LinkedIn, so this one really does mean nothing landed anywhere we can see.');
      return;
    }

    var byPlatform = {};
    all.forEach(function (r) { byPlatform[r.platform] = (byPlatform[r.platform] || 0) + 1; });

    var rows = all.filter(function (r) { return _rxPlatform === 'all' || r.platform === _rxPlatform; });
    // Engagement only. There is deliberately no "newest" sort: the only date on
    // a snapshot is captured_at, the poll time, and every row is polled by the
    // same cron in the same minute — so sorting by it would look meaningful and
    // order the list by nothing at all.
    rows = rows.slice().sort(function (a, b) {
      var be = b.likes + b.reposts, ae = a.likes + a.reposts;
      return be !== ae ? be - ae : Date.parse(b.at) - Date.parse(a.at);
    });

    var filters = [{ id: 'all', label: 'All' }].concat(
      Object.keys(byPlatform).sort().map(function (p) { return { id: p, label: p }; })
    );

    var html = '<div class="ei-rx-controls">';
    filters.forEach(function (f) {
      var n = f.id === 'all' ? all.length : byPlatform[f.id];
      html += '<button type="button" class="ei-rx-filter' + (f.id === _rxPlatform ? ' ei-rx-filter--active' : '') +
        '" data-rx-platform="' + esc(f.id) + '">' + esc(f.label) +
        '<span class="ei-rx-count">' + n + '</span></button>';
    });
    html += '</div>';

    // Said ONCE, above the list. Rendering it per row produced seventeen
    // identical lines saying nothing — the blank-row bug wearing a label.
    var textless = rows.filter(function (r) { return !r.our_post_text; }).length;
    if (textless) {
      html += '<p class="ei-rx-honesty">' + textless + ' of these ' + plural(textless, 'has', 'have') +
        ' no post text: we only started stamping it onto snapshots on 2026-08-09 and it cannot be recovered for older posts. ' +
        'The counts and the links are real; the wording is gone. No platform tells us WHEN a like happened, ' +
        'so the times below are when we last counted, not when anyone reacted.</p>';
    }

    if (!rows.length) {
      html += emptyState('filter', 'No reactions on ' + _rxPlatform,
        'The other platforms still have ' + all.length + '. This filter is the only thing hiding them.');
    } else {
      html += rows.map(renderReaction).join('');
    }
    el.innerHTML = html;

    var btns = el.querySelectorAll('.ei-rx-filter');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        _rxPlatform = ev.currentTarget.getAttribute('data-rx-platform');
        renderReactions();
      });
    }
  }

  // ── Deep links ─────────────────────────────────────────────────
  /**
   * engagement.html#er_abc123 opens on one conversation.
   *
   * This is what lets a Discord approval ping point at a specific person
   * instead of at a dashboard. The row may well be in a segment other than the
   * default, so arriving switches to All rather than showing an empty page and
   * an unhelpful "nothing here".
   */
  function applyFocus() {
    if (!_focusId) return;
    var el = document.getElementById(_focusId);
    if (!el) return;
    el.classList.add('ei-row--focus');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function readHash() {
    var id = String(window.location.hash || '').replace(/^#/, '');
    if (!id || !/^er_[A-Za-z0-9_]+$/.test(id)) return;
    var known = ((_data && _data.replies) || []).some(function (r) { return r.id === id; });
    if (!known) return;
    _focusId = id;
    _segment = 'all';
    _query = '';
    var input = document.getElementById('ei-search');
    if (input) input.value = '';
  }

  // ── Draft on demand ────────────────────────────────────────────
  /**
   * Send one conversation into the existing Scribe pipeline.
   *
   * Nothing here posts anything. The endpoint creates the same bluesky_reply
   * task the daily cron creates, so it rides the same chain — Scribe drafts,
   * the quality gate checks it, and it comes back for approval. The only rule
   * it lifts is the 72h age gate.
   */
  function bindDraftButtons(root) {
    var btns = root.querySelectorAll('.ei-draft-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        var btn = ev.currentTarget;
        var id = btn.getAttribute('data-draft-id');
        if (!id || btn.disabled) return;

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Drafting&hellip;';

        // Direct fetch rather than S.fetchJSON: that helper throws on a non-2xx
        // and discards the body, and the body is the whole point here — a
        // refusal names the guard that fired. Auth still comes from the shared
        // helper so this cannot drift from the rest of the dashboard.
        var hdrs = { 'Content-Type': 'application/json' };
        var auth = S.authHeaders();
        Object.keys(auth).forEach(function (k) { hdrs[k] = auth[k]; });

        fetch(S.apiBase() + '/api/engagement-reply-draft', {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({ id: id })
        }).then(function (r) {
          return r.json().catch(function () { return { error: 'HTTP ' + r.status }; });
        }).then(function (res) {
          var row = btn.closest('.ei-row');
          if (res && (res.ok || res.already)) {
            // Update the model as well as the DOM: a later segment switch
            // re-renders from _data, and a row that reverted to "needs a reply"
            // after being drafted would invite a second task.
            markDrafted(id);
            if (row) {
              row.classList.remove('ei-row--wait');
              row.classList.add('ei-row--pending');
              var chip = row.querySelector('.ei-status');
              if (chip) {
                chip.className = 'ei-status ei-status--pending';
                chip.textContent = 'Scribe is drafting it';
              }
            }
            btn.parentNode.innerHTML = '<div class="ei-action ei-action--queued">' +
              '<i class="fas fa-check"></i> ' + esc(res.message || 'Scribe will draft it on the next heartbeat.') +
              ' It moves to In progress on the next refresh.</div>';
            renderStrip();
            renderSegments();
          } else {
            // A refusal is information, not a failure. Show the guard's own
            // sentence and stop offering a button that will refuse again.
            btn.parentNode.innerHTML = '<div class="ei-action ei-action--blocked">' +
              '<i class="fas fa-hand"></i> ' + esc(res.message || res.error || 'Blocked') +
              '<span class="ei-action-note">reply as yourself if it still deserves one</span>' +
              '</div>';
          }
        }).catch(function (err) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-pen-nib"></i> Draft a reply';
          var note = document.createElement('span');
          note.className = 'ei-action-error';
          note.textContent = 'Could not reach the API: ' + String((err && err.message) || err);
          btn.parentNode.appendChild(note);
        });
      });
    }
  }

  function markDrafted(id) {
    ((_data && _data.replies) || []).forEach(function (r) {
      if (r.id !== id) return;
      r.status = 'task_created';
      r.draft_state = 'drafting';
      r.manual_draft = true;
      r.can_draft = false;
    });
    if (_data && _data.counts) {
      _data.counts.needsAttention = Math.max(0, (_data.counts.needsAttention || 0) - 1);
      _data.counts.draftable = Math.max(0, (_data.counts.draftable || 0) - 1);
    }
  }

  // ── Load ───────────────────────────────────────────────────────
  function renderAll() {
    renderStrip();
    renderSegments();
    renderConversations();
    renderReactions();

    var cov = document.getElementById('ei-coverage');
    if (cov && _data && _data.coverage && _data.coverage.note) {
      // Never let an absent platform read as a silent one.
      cov.innerHTML = '<i class="fas fa-circle-info"></i> ' + esc(_data.coverage.note);
    }
  }

  function renderError(err) {
    var el = document.getElementById('ei-conversations');
    if (el) {
      el.innerHTML = emptyState('triangle-exclamation', 'Could not load the engagement inbox',
        String((err && err.message) || err));
    }
    var strip = document.getElementById('ei-strip');
    if (strip) strip.innerHTML = '';
  }

  // This endpoint is secret-gated. If the page loads before CompanyStore has
  // picked up the write key there is nothing to send yet, so a 403 on the first
  // attempt is a timing problem, not an auth one — retry once when the store
  // announces itself rather than leaving a permanent error where the inbox
  // should be.
  var _retried = false;
  var _inFlight = false;

  function load() {
    if (_inFlight) return;
    _inFlight = true;
    S.fetchJSON('/api/engagement-inbox?days=' + DAYS + '&limit=' + LIMIT)
      .then(function (data) {
        _inFlight = false;
        _data = data;
        readHash();
        renderAll();
      })
      .catch(function (err) {
        _inFlight = false;
        if (!_retried && /\b(401|403)\b/.test(String((err && err.message) || ''))) {
          _retried = true;
          var el = document.getElementById('ei-conversations');
          if (el) el.innerHTML = '<div class="ap-empty">Waiting for credentials&hellip;</div>';
          // Belt and braces: the event may already have fired before this
          // script ran. _inFlight makes the double trigger harmless.
          window.addEventListener('companystoreready', load, { once: true });
          setTimeout(load, 1500);
          return;
        }
        renderError(err);
      });
  }

  function init() {
    var search = document.getElementById('ei-search');
    if (search) {
      search.addEventListener('input', function (ev) {
        _query = ev.currentTarget.value || '';
        renderConversations();
      });
    }
    window.addEventListener('hashchange', function () {
      _focusId = '';
      var prev = document.querySelector('.ei-row--focus');
      if (prev) prev.classList.remove('ei-row--focus');
      readHash();
      renderSegments();
      renderConversations();
    });
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.EngagementPage = { reload: load };
})();
