// Vale Mail — the client UI (DOM) for /modules/company/mail.html.
//
// Boots the product config, picks a backend (demo fixture mailbox, or Microsoft Graph via
// MSAL once the Vale Mail app exists), and renders a calm three-column mail client with the
// agent built in: a Vale-sorted inbox, a sandboxed reader, the Vale panel (why it matters,
// Reply-To guard, thread facts, one-tap stances), an editor with a 10-second Undo on send,
// archive/flag/unread with Undo, search, keyboard shortcuts and the Today rail.
//
// No business logic lives here that ValeMailCore can hold (see vale-mail-core.js). No inline
// styles: state is classes and the hidden attribute (css/vale-mail.css). Mail content is never
// logged and never leaves the page except to Microsoft Graph or the bearer-only vale-draft API;
// only text Chad types is kept, in sessionStorage, until it is sent or discarded.
// Plan: docs/superpowers/plans/2026-10-17-vale-mail-overnight.md (Task 5).
(function () {
  'use strict';

  var C = window.ValeMailCore;
  var h = C.escapeHtml;
  function $(id) { return document.getElementById(id); }

  var DEFAULT_FOLDERS = [
    { id: 'inbox', displayName: 'Inbox' },
    { id: 'sentitems', displayName: 'Sent' },
    { id: 'archive', displayName: 'Archive' }
  ];
  var FOLDER_ICONS = { inbox: 'fa-inbox', sentitems: 'fa-paper-plane', archive: 'fa-box-archive' };
  var FILTERS = ['needs_you', 'waiting', 'all', 'newsletter', 'set_aside'];
  var STANCES = ['yes', 'no', 'later', 'more'];
  var DRAFT_KEY = 'vmail:draft:';
  var AUTH_RETURN_KEY = 'vmail.authReturn';
  var DEFAULT_AGENT_COLOR = '#9b8cff';

  var S = {
    cfg: null, copy: {}, agent: 'Vale', demo: false, g: null, msal: null, account: null,
    me: { displayName: '', mail: '' },
    folders: DEFAULT_FOLDERS, folder: 'inbox', filter: 'needs_you',
    lists: {},
    labels: {}, rules: {}, workHours: null, triagedAt: null, drafts: {}, sortState: 'loading',
    calendar: { loading: true, events: [], error: null },
    search: null,
    selectedId: null, openId: null, open: null, openSeq: 0,
    session: null, replyTo: {}, replied: {},
    toastTimer: null, undoFn: null, rowIds: {}, rowSeq: 0
  };

  var phoneMq = window.matchMedia ? window.matchMedia('(max-width: 719px)') : { matches: false };
  function isPhone() { return !!phoneMq.matches; }
  function now() { return Date.now(); }
  function copy(path, fallback) {
    var v = path.split('.').reduce(function (o, k) { return o && o[k]; }, S.copy);
    return typeof v === 'string' ? v : fallback;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ── Storage (typed text only; never mail content) ──────────────────────────

  function saveTyped(key, data) { try { sessionStorage.setItem(DRAFT_KEY + key, JSON.stringify(data)); } catch (e) { /* private mode */ } }
  function loadTyped(key) { try { var v = sessionStorage.getItem(DRAFT_KEY + key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function clearTyped(key) { try { sessionStorage.removeItem(DRAFT_KEY + key); } catch (e) { /* ignore */ } }

  // ── Small model helpers ────────────────────────────────────────────────────

  function addrOf(r) { return (r && r.emailAddress && r.emailAddress.address) || ''; }
  function nameOf(r) { var e = (r && r.emailAddress) || {}; return e.name || e.address || 'Unknown sender'; }
  function names(list) { return (list || []).map(nameOf).join(', ') || 'no one yet'; }
  function isMine(m) { return !!S.me.mail && addrOf(m && m.from).toLowerCase() === S.me.mail.toLowerCase(); }
  function list(folder) {
    if (!S.lists[folder]) S.lists[folder] = { items: [], next: null, loading: false, loaded: false, error: null };
    return S.lists[folder];
  }
  function allLoaded() {
    var seen = {}, out = [];
    Object.keys(S.lists).forEach(function (f) {
      S.lists[f].items.forEach(function (m) { if (!seen[m.id]) { seen[m.id] = 1; out.push(m); } });
    });
    return out;
  }
  function findMsg(id) {
    var all = allLoaded().concat((S.search && S.search.items) || []);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function patchLocal(id, patch) {
    Object.keys(S.lists).forEach(function (f) { S.lists[f].items.forEach(function (m) { if (m.id === id) Object.assign(m, patch); }); });
    if (S.search) S.search.items.forEach(function (m) { if (m.id === id) Object.assign(m, patch); });
    if (S.open && S.open.msg && S.open.msg.id === id) Object.assign(S.open.msg, patch);
  }
  function isFlagged(m) { return !!(m && m.flag && m.flag.flagStatus === 'flagged'); }
  function bodyText(m) {
    var b = (m && m.body) || {};
    return String(b.contentType).toLowerCase() === 'html' ? C.htmlToText(b.content) : String(b.content || '');
  }
  function labelFor(m) {
    var l = S.labels[m.id];
    // Answered in this session: it is the other person's turn now (Waiting on others).
    if ((!l || l.label === 'needs_you' || l.label === 'unsure') && answeredAt(m) && !isFlagged(m)) {
      return { label: 'waiting', why: 'You replied ' + C.agoText(answeredAt(m), now()), by: 'you' };
    }
    if (l && l.label) return l;
    if (isFlagged(m)) return { label: 'needs_you', why: 'You flagged it', by: 'you' };
    return null;
  }
  function isClient(m) { return C.isClientMsg(m, (S.rules && S.rules.rulesOnlyDomains) || []); }
  function isClientThread(m) { return C.threadIsClient(thread(m), (S.rules && S.rules.rulesOnlyDomains) || []); }
  function thread(m) {
    if (!m || !m.conversationId) return m ? [m] : [];
    var out = allLoaded().filter(function (x) { return x.conversationId === m.conversationId; });
    if (!out.some(function (x) { return x.id === m.id; })) out.push(m);
    return out;
  }
  function sentInThread(m) { return thread(m).filter(isMine); }
  function stampTime(iso) {
    var t = Date.parse(iso || '');
    if (!isFinite(t)) return '';
    var w = C.formatWhen(iso, now());
    var clock = C.formatTime(t);
    if (/AM|PM/.test(w)) return clock;
    return (w === 'Yesterday' ? 'yesterday' : w) + ' at ' + clock;
  }

  // ── Visible list ───────────────────────────────────────────────────────────

  function visibleItems() {
    if (S.search) return S.search.items || [];
    var items = list(S.folder).items;
    if (S.folder !== 'inbox' || S.filter === 'all') return items;
    return items.filter(function (m) { return C.bucketOf(m, labelFor(m)) === S.filter; });
  }
  function inboxCounts() {
    var items = list('inbox').items;
    var map = {};
    items.forEach(function (m) { var l = labelFor(m); if (l) map[m.id] = l; });
    return C.counts(items, map);
  }
  function rowDomId(id) {
    if (!S.rowIds[id]) S.rowIds[id] = 'vmail-row-' + (++S.rowSeq);
    return S.rowIds[id];
  }

  // ── Identity, banner, stamp ────────────────────────────────────────────────

  function renderIdentity() {
    var cfg = S.cfg;
    document.title = cfg.productName + ' — ' + (cfg.companyName || 'AmbientOS');
    $('vmail-product-name').textContent = cfg.productName;
    $('vmail-agent-initial').textContent = S.agent.charAt(0).toUpperCase();
    Array.prototype.forEach.call(document.querySelectorAll('.js-agent-name'), function (el) { el.textContent = S.agent; });
    $('vmail-chips').setAttribute('aria-label', 'Filter by what ' + S.agent + ' found');
    var color = cfg.agent && cfg.agent.color;
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) && color.toLowerCase() !== DEFAULT_AGENT_COLOR) {
      var st = document.createElement('style');
      st.textContent = '.vmail{--vm-agent:' + color + ';--vm-agent-text:' + color + ';}';
      document.head.appendChild(st);
    }
    if (S.demo) {
      $('vmail-banner-text').textContent = copy('demoBanner', 'Demo mailbox. Nothing here is real; sending is simulated.');
      $('vmail-banner').hidden = false;
    }
  }

  function renderStamp() {
    var el = $('vmail-checked');
    el.classList.remove('vmail-checked--stale');
    if (S.sortState === 'loading') { el.textContent = ''; return; }
    if (S.sortState === 'failed') {
      el.textContent = 'Couldn\'t load ' + S.agent + '\'s sorting';
      el.classList.add('vmail-checked--stale');
      return;
    }
    if (!S.triagedAt) { el.textContent = S.agent + ' hasn\'t sorted your inbox yet'; return; }
    var st = stampTime(S.triagedAt);
    // "Checked at 6:41 AM" today; "Checked yesterday at 11:02 PM" / "Checked Thu at 9:15 AM" before.
    el.textContent = /^\d/.test(st) ? copy('checkedAt', 'Checked at {time}').replace('{time}', st) : 'Checked ' + st;
    el.title = 'When ' + S.agent + ' last sorted your inbox. Anything newer says "' + copy('notSorted', 'Not sorted yet') + '".';
    if (now() - Date.parse(S.triagedAt) > 26 * 3600000) el.classList.add('vmail-checked--stale');
  }

  // ── Folders ────────────────────────────────────────────────────────────────

  function renderFolders() {
    var unread = list('inbox').items.filter(function (m) { return !m.isRead; }).length;
    $('vmail-folders').innerHTML = S.folders.map(function (f) {
      var active = !S.search && f.id === S.folder;
      var count = f.id === 'inbox' && unread ? '<span class="vmail-folder__count" aria-label="' + unread + ' unread">' + unread + '</span>' : '';
      return '<li><button type="button" class="vmail-folder' + (active ? ' is-active' : '') + '" data-folder="' + h(f.id) + '"' +
        (active ? ' aria-current="true"' : '') + '><i class="fas ' + (FOLDER_ICONS[f.id] || 'fa-folder') + '" aria-hidden="true"></i>' +
        h(f.displayName) + count + '</button></li>';
    }).join('');
    $('vmail-folder-select').innerHTML = S.folders.map(function (f) {
      return '<option value="' + h(f.id) + '"' + (f.id === S.folder ? ' selected' : '') + '>' + h(f.displayName) + '</option>';
    }).join('');
  }

  function setFolder(folder) {
    if (S.folder === folder && !S.search) return;
    S.folder = folder;
    S.search = null;
    $('vmail-search').value = '';
    S.selectedId = null;
    renderFolders();
    renderListPane();
    var L = list(folder);
    if (!L.loaded && !L.loading) loadFolder(folder);
  }

  // ── Chips + counts ─────────────────────────────────────────────────────────

  function renderChips() {
    var chips = $('vmail-chips');
    var showChips = S.folder === 'inbox' && !S.search;
    chips.hidden = !showChips;
    if (!showChips) return;
    var c = inboxCounts();
    chips.innerHTML = FILTERS.map(function (f) {
      var on = S.filter === f;
      return '<button type="button" class="vmail-chip' + (f === 'needs_you' ? ' vmail-chip--agent' : '') + '" data-filter="' + f + '" aria-pressed="' + on + '">' +
        h(copy('filters.' + f, f)) + ' <span class="vmail-chip__count">' + (c[f] || 0) + '</span></button>';
    }).join('');
  }

  function renderCount() {
    var el = $('vmail-count');
    var L = list(S.folder);
    var folder = S.folders.filter(function (f) { return f.id === S.folder; })[0];
    var fname = folder ? folder.displayName : 'this folder';
    if (S.search || (L.loading && !L.items.length) || L.error) { el.textContent = ''; return; }
    var n = L.items.length;
    if (S.folder === 'inbox' && S.filter !== 'all') el.textContent = visibleItems().length + ' of the latest ' + n;
    else el.textContent = 'The latest ' + n + ' in ' + fname;
  }

  function renderSearchHead() {
    var head = $('vmail-searchhead');
    head.hidden = !S.search;
    if (!S.search) return;
    var n = S.search.items.length;
    $('vmail-searchhead-text').textContent = S.search.loading ? 'Searching for “' + S.search.q + '”…'
      : (n + (n === 1 ? ' result' : ' results') + ' for “' + S.search.q + '”' + (n >= 50 ? ' (the first 50)' : ''));
  }

  // ── List ───────────────────────────────────────────────────────────────────

  function tagHtml(m) {
    var l = labelFor(m);
    var name = l && C.labelName(l.label);
    if (name) return '<span class="vmail-tag vmail-tag--' + h(l.label) + '">' + h(name) + '</span>';
    if (C.bucketOf(m, null) === 'newsletter') return '<span class="vmail-tag vmail-tag--newsletter">Newsletter</span>';
    return '<span class="vmail-tag vmail-tag--unsorted">' + h(copy('notSorted', 'Not sorted yet')) + '</span>';
  }
  function whyFor(m) {
    var l = labelFor(m);
    if (l && l.why && sameAsLabel(l)) return '';
    if (l && l.why) return l.why;
    if (l) return '';
    if (C.bucketOf(m, null) === 'newsletter') return '';
    var t = Date.parse(m.receivedDateTime || '');
    if (S.triagedAt && isFinite(t) && t > Date.parse(S.triagedAt)) return 'Arrived after ' + S.agent + '\'s last check';
    return S.sortState === 'failed' ? '' : S.agent + ' hasn\'t looked at this one';
  }

  function rowHtml(m) {
    var sentView = S.folder === 'sentitems' && !S.search;
    var who = sentView || isMine(m) ? 'To: ' + names(m.toRecipients) : nameOf(m.from);
    var marks = '';
    if (isClient(m)) marks += '<span class="vmail-client">' + h(copy('clientMarker', 'client')) + '</span>';
    if (m.hasAttachments) marks += '<i class="fas fa-paperclip" role="img" aria-label="Has attachments"></i>';
    if (isFlagged(m)) marks += '<i class="fas fa-flag" role="img" aria-label="Flagged"></i>';
    if (S.replied[m.conversationId]) marks += '<i class="fas fa-reply" role="img" aria-label="You replied"></i>';
    var vale = '';
    if (!sentView && !isMine(m)) {
      var why = whyFor(m);
      vale = '<div class="vmail-row__vale">' + tagHtml(m) + (why ? '<span class="vmail-row__why">' + h(why) + '</span>' : '') + '</div>';
    }
    var selected = m.id === S.selectedId;
    return '<div class="vmail-row' + (m.isRead ? '' : ' is-unread') + '" role="option" id="' + rowDomId(m.id) + '" data-id="' + h(m.id) + '" aria-selected="' + selected + '">' +
      '<span class="vmail-row__dot" aria-hidden="true"></span>' +
      '<div class="vmail-row__main">' +
      '<div class="vmail-row__top"><span class="vmail-row__from">' + h(who) + '</span>' +
      (marks ? '<span class="vmail-row__marks">' + marks + '</span>' : '') +
      '<time class="vmail-row__when" datetime="' + h(m.receivedDateTime || m.sentDateTime || '') + '">' + h(C.formatWhen(m.receivedDateTime || m.sentDateTime, now())) + '</time></div>' +
      '<div class="vmail-row__subject"><strong>' + h(m.subject || '(no subject)') + '</strong>' +
      (m.bodyPreview ? ' — ' + h(m.bodyPreview) : '') + '</div>' + vale +
      '</div></div>';
  }

  function skeletonHtml(n) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<div class="vmail-skel" aria-hidden="true"><span></span><span></span><span></span></div>';
    return out;
  }

  function errorHtml(err, retryAttr) {
    var e = C.errorText(err);
    return '<div class="vmail-error" role="alert"><p>' + h(e.text) + '</p>' +
      (e.signIn && !S.demo ? '<button type="button" class="ap-btn ap-btn--primary" data-act="signin">Sign in again</button>'
        : (e.retry ? '<button type="button" class="ap-btn" ' + retryAttr + '>Try again</button>' : '')) + '</div>';
  }

  function emptyText() {
    if (S.search) return copy('empty.search', 'No mail matches that search.');
    if (S.folder === 'inbox') return copy('empty.' + S.filter, 'Nothing here.');
    return copy('empty.all', 'This folder is empty.');
  }

  function renderList() {
    var box = $('vmail-list');
    var L = list(S.folder);
    if (S.search && S.search.loading) { box.innerHTML = skeletonHtml(4); box.setAttribute('aria-busy', 'true'); return; }
    if (S.search && S.search.error) { box.innerHTML = errorHtml(S.search.error, 'data-act="research"'); return; }
    if (!S.search && L.loading && !L.items.length) { box.innerHTML = skeletonHtml(9); box.setAttribute('aria-busy', 'true'); return; }
    box.removeAttribute('aria-busy');
    if (!S.search && L.error && !L.items.length) { box.innerHTML = errorHtml(L.error, 'data-act="reload"'); return; }
    var items = visibleItems();
    if (!items.length) {
      box.innerHTML = '<div class="vmail-empty"><i class="fas ' + (S.search ? 'fa-magnifying-glass' : 'fa-mug-hot') + '" aria-hidden="true"></i>' +
        '<span class="vmail-empty__title">' + h(emptyText()) + '</span>' +
        (!S.search && S.folder === 'inbox' && S.filter !== 'all' ? '<button type="button" class="ap-btn vmail-btn-sm" data-filter-jump="all">See everything</button>' : '') + '</div>';
      box.removeAttribute('aria-activedescendant');
      return;
    }
    var html = items.map(rowHtml).join('');
    if (!S.search && L.next) {
      html += '<button type="button" class="ap-btn vmail-btn-sm vmail-more" data-act="more"' + (L.loading ? ' disabled' : '') + '>' +
        (L.loading ? 'Loading…' : 'Load older mail') + '</button>';
    }
    box.innerHTML = html;
    syncSelection();
  }

  function renderListPane() {
    renderChips();
    renderCount();
    renderSearchHead();
    renderList();
    renderNextUp();
  }

  function syncSelection() {
    var box = $('vmail-list');
    var cur = null;
    Array.prototype.forEach.call(box.querySelectorAll('[role="option"]'), function (r) {
      var on = r.getAttribute('data-id') === S.selectedId;
      r.setAttribute('aria-selected', String(on));
      if (on) cur = r;
    });
    if (cur) {
      box.setAttribute('aria-activedescendant', cur.id);
      if (cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    } else {
      box.removeAttribute('aria-activedescendant');
    }
  }

  function select(id, opts) {
    S.selectedId = id;
    syncSelection();
    if (opts && opts.open) openMessage(id, opts);
  }

  function move(delta) {
    var items = visibleItems();
    if (!items.length) return;
    var i = -1;
    for (var k = 0; k < items.length; k++) if (items[k].id === S.selectedId) i = k;
    var j = i === -1 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, i + delta));
    var id = items[j].id;
    select(id);
    if (isPhone()) return;
    // Holding j must not fire a Graph read per row: open once the selection settles.
    clearTimeout(S.moveTimer);
    S.moveTimer = setTimeout(function () { if (S.selectedId === id && S.openId !== id) openMessage(id); }, 150);
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  async function loadFolder(folder, more) {
    var L = list(folder);
    L.loading = true;
    L.error = null;
    if (folder === S.folder) renderListPane();
    try {
      var res = more && L.next ? await S.g.listMessages({ skipToken: L.next })
        : await S.g.listMessages({ folder: folder, top: S.cfg.inboxPageSize || 50 });
      var items = res.items || [];
      L.items = more ? L.items.concat(items.filter(function (m) { return !L.items.some(function (x) { return x.id === m.id; }); })) : items;
      L.next = res.next || null;
      L.loaded = true;
      if (folder === 'inbox' && !S.demo && S.sortState === 'ok') S.labels = C.triageLabels(S.sortRaw, L.items);
    } catch (e) {
      L.error = e;
      if (more) toast(C.errorText(e).text, null, 'error');
    }
    L.loading = false;
    if (folder === S.folder) renderListPane();
    if (folder === 'inbox') { renderFolders(); renderGreetingIfIdle(); }
    if (folder === 'sentitems' && S.open && S.open.msg) renderValeSlot();
    if (folder === 'inbox' && !more) markBooted();
  }

  function markBooted() {
    var main = $('vmail-main');
    main.classList.remove('is-booting');
    main.removeAttribute('aria-busy');
  }

  async function loadCalendar() {
    S.calendar = { loading: true, events: [], error: null };
    renderToday();
    var start = new Date(); start.setHours(0, 0, 0, 0);
    var end = new Date(start.getTime()); end.setDate(end.getDate() + 2);
    try {
      var evs = await S.g.calendarView(start.toISOString(), end.toISOString());
      S.calendar = { loading: false, events: evs || [], error: null };
    } catch (e) {
      S.calendar = { loading: false, events: [], error: e };
    }
    renderToday();
    renderNextUp();
  }

  // ── Today rail ─────────────────────────────────────────────────────────────

  function eventView(ev) {
    var s = C.eventMs(ev.start && ev.start.dateTime), e = C.eventMs(ev.end && ev.end.dateTime);
    var tentative = ev.responseStatus && /tentative/i.test(ev.responseStatus.response || '');
    return {
      ev: ev, startMs: s, endMs: e, allDay: !!ev.isAllDay, cancelled: !!ev.isCancelled, tentative: tentative,
      clash: !ev.isAllDay && !ev.isCancelled && C.workHoursClash(s, e, S.workHours),
      online: !!(ev.isOnlineMeeting || (ev.onlineMeeting && ev.onlineMeeting.joinUrl))
    };
  }
  function timeRange(v) {
    if (v.allDay) return 'All day';
    var a = C.formatTime(v.startMs), b = C.formatTime(v.endMs);
    if (a.slice(-2) === b.slice(-2)) a = a.slice(0, -3);
    return a + ' – ' + b;
  }
  function eventHtml(v) {
    var notes = [];
    if (v.clash) notes.push('<span class="vmail-event__note vmail-event__note--clash"><i class="fas fa-briefcase" aria-hidden="true"></i>In your day-job hours</span>');
    if (v.cancelled) notes.push('<span class="vmail-event__note">Cancelled</span>');
    else if (v.tentative) notes.push('<span class="vmail-event__note">Tentative</span>');
    if (v.online && !v.cancelled) notes.push('<span class="vmail-event__note"><i class="fas fa-video" aria-hidden="true"></i>Online</span>');
    return '<li class="vmail-event' + (v.clash ? ' vmail-event--clash' : '') + (v.cancelled ? ' vmail-event--cancelled' : '') + '">' +
      '<span class="vmail-event__time">' + h(timeRange(v)) + '</span>' +
      '<span class="vmail-event__title">' + h(v.ev.subject || '(no title)') + '</span>' + notes.join(' ') + '</li>';
  }
  function dayBuckets() {
    var start = new Date(); start.setHours(0, 0, 0, 0);
    var t0 = start.getTime(), t1 = t0 + 86400000;
    var tomorrow = new Date(t0); tomorrow.setDate(tomorrow.getDate() + 1); t1 = tomorrow.getTime();
    var after = new Date(t1); after.setDate(after.getDate() + 1);
    var views = S.calendar.events.map(eventView).filter(function (v) { return isFinite(v.startMs); })
      .sort(function (a, b) { return a.startMs - b.startMs; });
    return {
      today: views.filter(function (v) { return v.startMs < t1 && v.endMs > t0; }),
      tomorrow: views.filter(function (v) { return v.startMs >= t1 && v.startMs < after.getTime(); })
    };
  }
  function renderToday() {
    var body = $('vmail-today-body');
    if (S.calendar.loading) { body.innerHTML = '<p class="vmail-quiet">Loading your calendar…</p>'; return; }
    if (S.calendar.error) {
      body.innerHTML = '<p class="vmail-quiet">Couldn\'t load your calendar.</p><button type="button" class="ap-btn vmail-btn-sm" data-act="calendar">Try again</button>';
      return;
    }
    var d = dayBuckets();
    function day(name, views, empty) {
      return '<div class="vmail-day"><div class="vmail-day__name">' + name + '</div>' +
        (views.length ? '<ul class="vmail-events">' + views.map(eventHtml).join('') + '</ul>' : '<p class="vmail-quiet">' + empty + '</p>') + '</div>';
    }
    body.innerHTML = day('Today', d.today, 'No meetings today.') + day('Tomorrow', d.tomorrow, 'Nothing booked tomorrow.') +
      (S.workHours ? '' : '<p class="vmail-quiet">Set your day-job hours on the Office page so ' + h(S.agent) + ' can flag clashes.</p>');
  }
  function renderNextUp() {
    var el = $('vmail-nextup');
    if (S.calendar.loading || S.calendar.error || S.search) { el.hidden = true; return; }
    var d = dayBuckets();
    var t = now();
    var upcoming = d.today.filter(function (v) { return v.endMs > t && !v.cancelled; });
    if (!upcoming.length) { el.hidden = true; return; }
    var v = upcoming[0];
    var rest = upcoming.length - 1;
    el.classList.toggle('vmail-nextup--clash', v.clash);
    el.innerHTML = '<i class="fas fa-calendar-day" aria-hidden="true"></i>' +
      '<span class="vmail-nextup__title">' + (v.startMs <= t ? 'Now: ' : 'Next: ') +
      '<strong>' + h(v.allDay ? 'All day' : C.formatTime(v.startMs)) + ' ' + h(v.ev.subject || '(no title)') + '</strong>' +
      (v.clash ? ' · in your day-job hours' : '') + '</span>' + (rest ? '<span class="vmail-nextup__more">+' + rest + ' more</span>' : '');
    el.hidden = false;
  }

  // ── Reader ─────────────────────────────────────────────────────────────────

  function greeting() {
    var hr = new Date().getHours();
    return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  }
  function renderGreetingIfIdle() { if (!S.open) renderReader(); }

  function renderReader() {
    var r = $('vmail-reader');
    var o = S.open;
    if (!o) {
      var L = list('inbox');
      var c = inboxCounts();
      var first = (S.me.displayName || '').split(' ')[0];
      var line;
      if (!L.loaded && !L.error) line = S.agent + ' is opening your inbox…';
      else if (L.error) line = 'Your inbox didn\'t load. Use Try again on the left.';
      else if (c.needs_you) line = c.needs_you + (c.needs_you === 1 ? ' email needs you' : ' emails need you') + (c.waiting ? ', and ' + c.waiting + (c.waiting === 1 ? ' thread is' : ' threads are') + ' waiting on others.' : '.');
      else line = 'Nothing needs you right now.' + (c.waiting ? ' ' + c.waiting + ' waiting on others.' : '');
      r.innerHTML = '<div class="vmail-hello">' +
        '<span class="vmail-avatar vmail-avatar--agent vmail-avatar--lg" aria-hidden="true">' + h(S.agent.charAt(0)) + '</span>' +
        '<h2 class="vmail-hello__title">' + h(greeting() + (first ? ', ' + first : '')) + '.</h2>' +
        '<p class="vmail-hello__text">' + h(line) + '</p>' +
        (c.needs_you ? '<button type="button" class="ap-btn vmail-btn-agent" data-act="start">Start with what needs you</button>' : '') +
        '<div class="vmail-hello__keys"><span><kbd>j</kbd><kbd>k</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>e</kbd> archive</span><span><kbd>?</kbd> all shortcuts</span></div>' +
        '</div>';
      return;
    }
    if (o.compose) { r.innerHTML = toolbarHtml(null) + '<article class="vmail-article"><h2 class="vmail-subject">New email</h2><div id="vmail-editor-slot"></div></article>'; renderEditorSlot(); return; }
    if (o.loading) { r.innerHTML = toolbarHtml(null) + '<div class="vmail-readskel" aria-hidden="true"><span></span><span></span><span></span><span></span></div>'; return; }
    if (o.error) { r.innerHTML = toolbarHtml(null) + '<article class="vmail-article">' + errorHtml(o.error, 'data-act="reopen"') + '</article>'; return; }
    var m = o.msg;
    var when = m.receivedDateTime || m.sentDateTime;
    var whenTxt = when ? new Date(when).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    var to = (m.toRecipients || []).map(nameOf);
    var cc = (m.ccRecipients || []).map(nameOf);
    r.innerHTML = toolbarHtml(m) +
      '<article class="vmail-article" aria-labelledby="vmail-subject">' +
      '<h2 class="vmail-subject" id="vmail-subject">' + h(m.subject || '(no subject)') + '</h2>' +
      '<div class="vmail-meta"><span class="vmail-avatar" aria-hidden="true">' + h(nameOf(m.from).charAt(0).toUpperCase()) + '</span>' +
      '<div class="vmail-meta__who"><div><span class="vmail-meta__name">' + h(nameOf(m.from)) + '</span> <span class="vmail-meta__addr">&lt;' + h(addrOf(m.from)) + '&gt;</span></div>' +
      '<div class="vmail-meta__to">To ' + h(to.join(', ') || 'no one') + (cc.length ? ' · Cc ' + h(cc.join(', ')) : '') + '</div></div>' +
      '<time class="vmail-meta__when" datetime="' + h(when || '') + '">' + h(whenTxt) + '</time></div>' +
      '<div id="vmail-vale-slot"></div><div id="vmail-editor-slot"></div><div id="vmail-body-slot"></div>' +
      '</article>';
    renderValeSlot();
    renderEditorSlot();
    renderBodySlot();
  }

  function toolbarHtml(m) {
    var back = '<button type="button" class="vmail-tool vmail-back" id="vmail-back" aria-label="Back to the list"><i class="fas fa-arrow-left" aria-hidden="true"></i><span class="vmail-tool__label">Back</span></button>';
    if (!m) return '<div class="vmail-reader__bar">' + back + '</div>';
    var archived = m.parentFolderId === 'archive';
    var flagged = isFlagged(m);
    function tool(act, icon, label, key, extra) {
      return '<button type="button" class="vmail-tool' + (extra || '') + '" data-act="' + act + '" title="' + h(label) + (key ? ' (' + key + ')' : '') + '">' +
        '<i class="fas ' + icon + '" aria-hidden="true"></i><span class="vmail-tool__label">' + h(label) + '</span>' + (key ? '<kbd>' + key + '</kbd>' : '') + '</button>';
    }
    return '<div class="vmail-reader__bar" role="toolbar" aria-label="Email actions">' + back +
      (isMine(m) ? '' : tool('reply', 'fa-reply', 'Reply', 'r')) +
      (archived || isMine(m) ? '' : tool('archive', 'fa-box-archive', 'Archive', 'e')) +
      tool('flag', 'fa-flag', flagged ? 'Unflag' : 'Flag', 'f', flagged ? ' is-on' : '') +
      tool('unread', m.isRead ? 'fa-envelope' : 'fa-envelope-open', m.isRead ? 'Mark unread' : 'Mark read', 'u') +
      '<span class="vmail-spacer"></span></div>';
  }

  // Vale panel: why it matters, who you are really replying to, thread facts, stances.
  function renderValeSlot() {
    var slot = $('vmail-vale-slot');
    if (!slot || !S.open || !S.open.msg) return;
    var m = S.open.msg;
    if (isMine(m)) { slot.innerHTML = ''; return; }
    var l = labelFor(m);
    var name = l && C.labelName(l.label);
    var why;
    if (l && l.why && !sameAsLabel(l)) why = '<p class="vmail-vale__why">' + h(l.why) + '</p>';
    else if (l && C.bucketOf(m, l) === 'newsletter') why = '<p class="vmail-vale__why">A mailing list you subscribe to.</p>';
    else if (l) why = '';
    else {
      var t = Date.parse(m.receivedDateTime || '');
      var after = S.triagedAt && isFinite(t) && t > Date.parse(S.triagedAt);
      why = '<p class="vmail-vale__why vmail-vale__why--quiet">' + h(copy('notSorted', 'Not sorted yet')) + '. ' +
        h(after ? 'This came in after ' + S.agent + '\'s last check' + (S.triagedAt ? (/^\d/.test(stampTime(S.triagedAt)) ? ' at ' : ' ') + stampTime(S.triagedAt) : '') + ', so there\'s no read on it yet.'
          : S.agent + ' hasn\'t judged this one, so there\'s no guess here.') + '</p>';
    }

    var mismatch = C.replyToMismatch(m);
    var warn = '';
    if (mismatch) {
      var rt = mismatch.replyTo.map(function (r) { return r.address; }).join(', ');
      // The safe address (From) is the default; only an explicit choice replies to Reply-To.
      var useRt = useReplyTo(m);
      warn = '<div class="vmail-warn vmail-warn--replyto" role="note" id="vmail-replyto-warn"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><div>' +
        '<strong>Check who you\'re replying to.</strong> ' +
        h(copy('replyToWarning', 'Replies go to {replyTo}, not {from}.').replace('{replyTo}', rt).replace('{from}', mismatch.from.address)) +
        '<div class="vmail-warn__actions">' + (useRt
          ? '<span>Your reply will go to ' + h(rt) + ', not the sender\'s address.</span> <button type="button" class="ap-btn vmail-btn-sm" data-act="use-from">Reply to ' + h(mismatch.from.address) + ' instead</button>'
          : '<span>Your reply will go to ' + h(mismatch.from.address) + '.</span> <button type="button" class="ap-btn vmail-btn-sm" data-act="use-replyto">Use the Reply-To address</button>') +
        '</div></div></div>';
    }

    var facts = [];
    var automated = C.isAutomated(m);
    var th = C.threadText(C.threadStrip(thread(m), S.me), now());
    if (th) facts.push('<li><i class="fas fa-layer-group" aria-hidden="true"></i>' + h(th) + '</li>');
    // "Last time you spoke" and "waiting on you" mean nothing for newsletters and robots.
    var spoke = automated ? '' : lastSpoke(m);
    if (spoke) facts.push('<li><i class="fas fa-clock-rotate-left" aria-hidden="true"></i>' + h(spoke) + '</li>');
    var waiting = automated ? null : C.waitingOnYou(m, sentInThread(m), now(), { ownDomain: S.cfg.ownDomain });
    if (waiting && !answeredAt(m)) {
      facts.push('<li class="is-urgent"><i class="fas fa-hourglass-half" aria-hidden="true"></i>' + h(waitingText(waiting.since)) + '</li>');
    }

    var client = isClientThread(m) ? '<p class="vmail-notice"><i class="fas fa-shield-halved" aria-hidden="true"></i><span>' + h(copy('clientDraftNotice', 'Client mail.')) + '</span></p>' : '';

    var s = S.session && S.session.key === m.id ? S.session : null;
    var busy = s && /^(drafting|countdown|sending)$/.test(s.m.state);
    var dis = busy ? ' disabled' : '';
    var ask;
    if (C.isAutomated(m)) {
      ask = '<div class="vmail-ask"><p class="vmail-question">Nothing to answer here. It\'s ' + (C.bucketOf(m, null) === 'newsletter' ? 'a mailing list' : 'an automated message') + '.</p>' +
        '<div class="vmail-stances">' + (m.parentFolderId === 'archive' ? '' : '<button type="button" class="ap-btn" data-act="archive"><i class="fas fa-box-archive" aria-hidden="true"></i>Archive it</button>') + '</div></div>';
    } else if (answeredAt(m)) {
      // The reply went out: the loop is closed, so no stance buttons asking the same question again.
      ask = '<div class="vmail-ask"><p class="vmail-question">You answered ' + h(C.agoText(answeredAt(m), now())) + '. It\'s ' + h(C.firstName(m.from)) + '\'s turn now.</p>' +
        '<div class="vmail-stances"><button type="button" class="ap-btn" data-act="reply"' + dis + '><i class="fas fa-reply" aria-hidden="true"></i>Write another reply</button></div></div>';
    } else if (mismatch) {
      // A different Reply-To (often a payment-change lure): no one-tap answers here.
      ask = '<div class="vmail-ask"><p class="vmail-question">Check with ' + h(C.firstName(m.from)) + ' another way (phone, known address) before you answer anything about money.</p>' +
        '<div class="vmail-stances" role="group" aria-label="Answer with ' + h(S.agent) + '"><button type="button" class="ap-btn vmail-btn-agent" data-act="draft"' + dis + '><i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i>Draft a reply</button></div>' +
        tellForm(dis) + '</div>';
    } else {
      var q = C.findQuestion(bodyText(m), m.subject);
      var first = C.firstName(m.from);
      var stanceBtns;
      if (q) {
        stanceBtns = STANCES.map(function (st) {
          return '<button type="button" class="ap-btn vmail-btn-agent vmail-stance' + (s && s.stance === st ? ' is-picked' : '') + '" data-stance="' + st + '"' + dis + '>' + h(copy('stances.' + st, st)) + '</button>';
        }).join('');
      } else {
        stanceBtns = '<button type="button" class="ap-btn vmail-btn-agent vmail-stance' + (s && s.stance === 'ack' ? ' is-picked' : '') + '" data-stance="ack"' + dis + '>' + h(copy('stances.ack', 'Acknowledge')) + '</button>' +
          '<button type="button" class="ap-btn vmail-btn-agent vmail-stance" data-act="draft"' + dis + '><i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i>Draft a reply</button>';
      }
      ask = '<div class="vmail-ask">' +
        (q ? '<p class="vmail-question"><span class="vmail-question__who">' + h(first) + ' asks</span><q>' + h(q) + '</q></p>'
          : '<p class="vmail-question"><span class="vmail-question__who">No direct question found</span>Want to let ' + h(first) + ' know you saw it?</p>') +
        '<div class="vmail-stances" role="group" aria-label="Answer with ' + h(S.agent) + '">' + stanceBtns + '</div>' +
        tellForm(dis) + '</div>';
    }

    slot.innerHTML = '<section class="vmail-vale" aria-label="' + h(S.agent) + '">' +
      '<div class="vmail-vale__head"><span class="vmail-avatar vmail-avatar--agent vmail-avatar--sm" aria-hidden="true">' + h(S.agent.charAt(0)) + '</span>' +
      '<div><span class="vmail-vale__name">' + h(S.agent) + '</span> <span class="vmail-vale__role">' + h((S.cfg.agent && S.cfg.agent.role) || '') + '</span></div>' +
      (name ? '<span class="vmail-tag vmail-tag--' + h(l.label) + '">' + h(name) + '</span>' : '') + '</div>' +
      why + warn + (facts.length ? '<ul class="vmail-facts">' + facts.join('') + '</ul>' : '') + client + ask + '</section>';
    // The warning is a note (not an alert), announced once per opened email, not on every re-render.
    if (mismatch && S.warnAnnouncedFor !== m.id) {
      S.warnAnnouncedFor = m.id;
      announce('Check who you\'re replying to. Replies to this email are set to go to a different address than the sender\'s.');
    }
  }

  function announce(text) {
    var el = $('vmail-announce');
    if (!el) return;
    el.textContent = '';
    setTimeout(function () { el.textContent = text; }, 30);
  }

  function tellForm(dis) {
    return '<form class="vmail-tell" data-form="tell"><label class="vmail-visually-hidden" for="vmail-tell-input">Tell ' + h(S.agent) + ' what to say</label>' +
      '<input id="vmail-tell-input" class="ap-input" type="text" maxlength="500" placeholder="Tell ' + h(S.agent) + ' what to say…" autocomplete="off"' + dis + '>' +
      '<button type="submit" class="ap-btn vmail-btn-agent"' + dis + '>Draft</button></form>';
  }

  // Reply-To differs from From: reply to From unless Chad explicitly picked the Reply-To address.
  function useReplyTo(m) { return !!m && S.replyTo[m.id] === 'replyto'; }

  // When Chad's reply in this thread went out after this message arrived (this session).
  function answeredAt(m) {
    var at = m && S.replied[m.conversationId];
    if (!at) return null;
    var got = Date.parse(m.receivedDateTime || '');
    return !isFinite(got) || Date.parse(at) > got ? at : null;
  }

  function sameAsLabel(l) {
    var name = l && C.labelName(l.label);
    var why = String((l && l.why) || '').trim().toLowerCase();
    return !!why && ((name && why === name.toLowerCase()) || why === String(l.label).toLowerCase());
  }

  function waitingText(since) {
    var w = C.formatWhen(since, now());
    if (/AM|PM/.test(w)) return 'Waiting on your reply since ' + w;
    if (w === 'Yesterday') return 'Waiting on your reply since yesterday';
    return 'Waiting on your reply since ' + w + ' (' + C.agoText(since, now()) + ')';
  }

  function lastSpoke(m) {
    var from = addrOf(m.from).toLowerCase();
    if (!from) return '';
    var first = C.firstName(m.from);
    var mine = list('sentitems').items.filter(function (s) {
      return (s.toRecipients || []).concat(s.ccRecipients || []).some(function (r) { return addrOf(r).toLowerCase() === from; });
    }).sort(function (a, b) { return String(b.sentDateTime).localeCompare(String(a.sentDateTime)); })[0];
    if (mine) return 'You last wrote to ' + first + ' ' + C.agoText(mine.sentDateTime, now());
    var theirs = allLoaded().filter(function (x) { return x.id !== m.id && addrOf(x.from).toLowerCase() === from && x.receivedDateTime < m.receivedDateTime; })
      .sort(function (a, b) { return String(b.receivedDateTime).localeCompare(String(a.receivedDateTime)); })[0];
    if (theirs) return first + ' last wrote ' + C.agoText(theirs.receivedDateTime, now()) + '; you haven\'t written back in your recent mail';
    if (!list('sentitems').loaded) return '';
    return 'First email from ' + first + ' in your recent mail';
  }

  function renderBodySlot() {
    var slot = $('vmail-body-slot');
    if (!slot || !S.open || !S.open.msg) return;
    var o = S.open, m = o.msg;
    var html = '';
    var isHtml = String(m.body && m.body.contentType).toLowerCase() === 'html';
    var remote = isHtml && C.hasRemoteImages(m.body.content);
    // Outside the demo, remote images also need the site CSP to allow them (setup step 4).
    var canShow = S.demo || S.cfg.remoteImagesAllowed === true;
    if (remote) {
      html += '<div class="vmail-imagesbar"><i class="fas fa-image" aria-hidden="true"></i><span>' +
        (o.showImages ? 'Images are shown for this email.' : 'Images are hidden so the sender can\'t tell you opened this.' +
          (canShow ? '' : ' Images can\'t be shown yet: setup step 4 (the site\'s security policy) is pending.')) + '</span>' +
        (o.showImages || !canShow ? '' : '<button type="button" class="ap-btn vmail-btn-sm" id="vmail-show-images">Show images</button>') + '</div>';
    }
    var files = (o.atts || []).filter(function (a) { return !a.isInline; });
    if (files.length) {
      html += '<ul class="vmail-attachments" aria-label="Attachments">' + files.map(function (a) {
        return '<li><button type="button" class="vmail-attachment" data-att="' + h(a.id) + '" title="Download ' + h(a.name) + '">' +
          '<i class="fas fa-paperclip" aria-hidden="true"></i><span class="vmail-attachment__name">' + h(a.name) + '</span>' +
          '<span class="vmail-attachment__size">' + h(C.formatSize(a.size)) + '</span><i class="fas fa-download" aria-hidden="true"></i></button></li>';
      }).join('') + '</ul>';
    } else if (o.attsLoading) {
      html += '<p class="vmail-quiet">Loading attachments…</p>';
    } else if (o.attsError) {
      html += '<p class="vmail-quiet">Couldn\'t load the attachments. <button type="button" class="ap-btn vmail-btn-sm" data-act="atts">Try again</button></p>';
    }
    slot.innerHTML = html;
    // Plain mail (text, or HTML that is only paragraphs) reads on the app's own surface; the
    // white sandboxed frame is kept for real HTML mail.
    if (!isHtml || C.isSimpleHtml(m.body && m.body.content)) {
      var plain = document.createElement('div');
      plain.className = 'vmail-plainbody';
      plain.textContent = isHtml ? C.htmlToText(m.body.content) : String((m.body && m.body.content) || '');
      slot.appendChild(plain);
      return;
    }
    // The sandbox attribute is set before srcdoc so the document never loads unsandboxed.
    var frame = document.createElement('iframe');
    frame.className = 'vmail-frame' + (String(m.body.content || '').length < 1500 ? ' vmail-frame--short' : '');
    frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', 'Email from ' + nameOf(m.from));
    var body = m.body;
    // Demo only: the fixture's invented image hosts can never load, so "Show images" swaps them for
    // locally drawn pictures. Detection above still ran on the original URLs.
    if (S.demo && o.showImages) body = { contentType: 'html', content: demoImages(body.content) };
    frame.srcdoc = C.safeBodyDoc(body, !!o.showImages, o.inline || null);
    slot.appendChild(frame);
  }

  // Demo mailbox: replace <img src="https://*.example/..."> with a small drawn PNG (data: URL).
  function demoImages(html) {
    return String(html || '').replace(/<img\b([^>]*?)\ssrc=(["'])(https?:)?\/\/[a-z0-9.-]+\.example\/[^"']*\2([^>]*)>/gi, function (all, pre, q, sch, post) {
      var attrs = pre + ' ' + post;
      var w = Number((/\bwidth=["']?(\d+)/i.exec(attrs) || [])[1]) || 600;
      var hgt = Number((/\bheight=["']?(\d+)/i.exec(attrs) || [])[1]) || Math.round(w * 0.42);
      return '<img' + pre + ' src="' + demoPicture(w, hgt) + '"' + post + '>';
    });
  }
  function demoPicture(w, hgt) {
    try {
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.min(w, 1200));
      c.height = Math.max(1, Math.min(hgt, 800));
      var x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, '#c9c0ff');
      g.addColorStop(1, '#6d5ce8');
      x.fillStyle = g;
      x.fillRect(0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    } catch (e) { return ''; }
  }

  async function openMessage(id, opts) {
    opts = opts || {};
    var seq = ++S.openSeq;
    S.openId = id;
    S.selectedId = id;
    syncSelection();
    if (opts.show || isPhone()) setReading(true);
    var cached = findMsg(id);
    S.open = { id: id, loading: true };
    renderReader();
    try {
      var msg = await S.g.getMessage(id);
      if (seq !== S.openSeq) return;
      S.open = { id: id, msg: msg, showImages: false, atts: [], inline: null };
      if (!msg.isRead && !opts.keepUnread) {
        msg.isRead = true;
        patchLocal(id, { isRead: true });
        S.g.patchMessage(id, { isRead: true }).catch(function () { patchLocal(id, { isRead: false }); renderList(); });
        renderList();
        renderFolders();
      }
      restoreSession(msg);
      renderReader();
      if (opts.focusReader) $('vmail-reader').focus();
      var needsAtts = msg.hasAttachments || /cid:/i.test(String(msg.body && msg.body.content));
      if (needsAtts) loadAttachments(seq, msg);
    } catch (e) {
      if (seq !== S.openSeq) return;
      S.open = { id: id, error: e, cached: cached };
      renderReader();
    }
  }

  async function loadAttachments(seq, msg) {
    var o = S.open;
    o.attsLoading = true;
    o.attsError = null;
    renderBodySlot();
    try {
      var atts = await S.g.listAttachments(msg.id);
      if (seq !== S.openSeq) return;
      var inline = null;
      var wantCid = /cid:/i.test(String(msg.body && msg.body.content));
      var cids = atts.filter(function (a) { return a.isInline && a.contentId && wantCid; });
      if (cids.length) {
        inline = {};
        await Promise.all(cids.map(function (a) {
          return S.g.getAttachmentBytes(msg.id, a.id).then(function (buf) {
            var url = C.bytesToDataUrl(buf, a.contentType);
            if (url) inline[a.contentId] = url;
          }).catch(function () { /* the image just stays blank */ });
        }));
      }
      if (seq !== S.openSeq) return;
      o.atts = atts;
      o.inline = inline;
    } catch (e) {
      if (seq !== S.openSeq) return;
      o.attsError = e;
    }
    o.attsLoading = false;
    renderBodySlot();
  }

  async function download(attId) {
    var o = S.open;
    if (!o || !o.msg) return;
    var a = (o.atts || []).filter(function (x) { return x.id === attId; })[0];
    if (!a) return;
    try {
      var buf = await S.g.getAttachmentBytes(o.msg.id, a.id);
      // Always octet-stream: an attachment must never render as a page on this origin.
      var url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
      var link = document.createElement('a');
      link.href = url;
      link.download = String(a.name || 'attachment').replace(/[\\/:*?"<>|]+/g, '_');
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    } catch (e) {
      toast('Couldn\'t download ' + a.name + '. ' + C.errorText(e).text, null, 'error');
    }
  }

  function setReading(on) { $('vmail-main').classList.toggle('is-reading', !!on); }

  function closeReader() {
    S.open = null;
    S.openId = null;
    S.openSeq++;
    setReading(false);
    renderReader();
    $('vmail-list').focus();
  }

  // ── Editor sessions (reply / compose) + send with Undo ────────────────────

  function newSession(key, mode, msg) {
    return {
      key: key, mode: mode, msgId: msg ? msg.id : null, conversationId: msg ? msg.conversationId : null,
      m: C.sendMachine(), text: '', lastVale: '', stance: null, byVale: false,
      to: mode === 'reply' ? C.replyTargets(msg) : [], toText: '', subject: '', brief: '',
      draftId: null, quoted: '', error: null, note: '', timer: null, left: 0
    };
  }

  function sessionBusy() { return S.session && /^(countdown|sending)$/.test(S.session.m.state); }

  // Start (or reuse) the editor for the open message / compose. Returns the session or null.
  function ensureSession(mode) {
    var key = mode === 'compose' ? 'compose' : S.openId;
    if (!key) return null;
    if (S.session && S.session.key === key) return S.session;
    if (sessionBusy()) { toast('Wait for the email that\'s sending, or undo it first.'); return null; }
    if (S.session) persist(S.session);
    var msg = mode === 'reply' ? S.open && S.open.msg : null;
    S.session = newSession(key, mode, msg);
    return S.session;
  }

  function persist(s) {
    if (!s) return;
    // Only what Chad typed or edited is kept. An untouched Vale draft paraphrases the email, so
    // it is never written to storage (it can be drafted again in a click).
    var typed = s.text.trim() && !(s.byVale && s.text === s.lastVale) ? s.text : '';
    if (typed || s.toText || s.subject) saveTyped(s.key, { text: typed, toText: s.toText, subject: s.subject, byVale: s.byVale && !!typed });
    else clearTyped(s.key);
  }

  function restoreSession(msg) {
    if (S.session && S.session.key === msg.id) return;
    if (sessionBusy()) return;
    var saved = loadTyped(msg.id);
    if (!saved || !saved.text) return;
    if (S.session) persist(S.session);
    var s = newSession(msg.id, 'reply', msg);
    s.text = saved.text;
    s.byVale = !!saved.byVale;
    s.note = 'Restored your unsent reply.';
    s.m.next('edit');
    S.session = s;
  }

  function recipientsFor(s) {
    if (s.mode === 'compose') return parseAddresses(s.toText);
    var msg = (S.open && S.open.msg && S.open.msg.id === s.msgId ? S.open.msg : null) || findMsg(s.msgId);
    // A mismatched Reply-To only gets the reply when Chad explicitly chose it.
    if (msg && C.replyToMismatch(msg) && !useReplyTo(msg)) return [{ name: nameOf(msg.from), address: addrOf(msg.from) }];
    return s.to;
  }
  // Addresses, not display names, whenever a display name could hide where the mail goes.
  function whoText(s, list) {
    var msg = s.mode === 'reply' ? ((S.open && S.open.msg && S.open.msg.id === s.msgId ? S.open.msg : null) || findMsg(s.msgId)) : null;
    var plain = !(msg && C.replyToMismatch(msg));
    return (list || []).map(function (r) { return plain ? (r.name || r.address) : r.address; }).join(', ');
  }
  function toReplyToTarget(s) {
    if (s.mode !== 'reply') return false;
    var msg = (S.open && S.open.msg && S.open.msg.id === s.msgId ? S.open.msg : null) || findMsg(s.msgId);
    return !!(msg && C.replyToMismatch(msg) && useReplyTo(msg));
  }
  function parseAddresses(text) {
    return String(text || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean).map(function (a) { return { name: '', address: a }; });
  }
  var EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

  function renderEditorSlot() {
    var slot = $('vmail-editor-slot');
    if (!slot) return;
    var key = S.open && S.open.compose ? 'compose' : S.openId;
    var s = S.session && S.session.key === key ? S.session : null;
    if (!s) { slot.innerHTML = ''; return; }
    var st = s.m.state;
    var locked = st === 'countdown' || st === 'sending';
    var drafting = st === 'drafting';
    var to = recipientsFor(s);
    var head;
    if (s.mode === 'reply') {
      head = '<div class="vmail-editor__head"><span>Reply to <strong>' + h(to.map(function (r) { return r.name || r.address; }).join(', ') || 'no one') + '</strong> ' +
        h(to.map(function (r) { return '<' + r.address + '>'; }).join(', ')) + '</span>' +
        (toReplyToTarget(s) ? '<span class="vmail-warnchip"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>Not the sender\'s address</span>' : '') +
        (s.byVale ? '<span class="vmail-editor__by"><span class="vmail-avatar vmail-avatar--agent vmail-avatar--sm" aria-hidden="true">' + h(S.agent.charAt(0)) + '</span>Drafted by ' + h(S.agent) + ' · edit freely</span>' : '') + '</div>';
    } else {
      head = '<div class="vmail-editor__head"><span>From <strong>' + h(S.me.displayName || S.cfg.mailbox) + '</strong> ' + h('<' + (S.me.mail || S.cfg.mailbox) + '>') + '</span>' +
        (s.byVale ? '<span class="vmail-editor__by"><span class="vmail-avatar vmail-avatar--agent vmail-avatar--sm" aria-hidden="true">' + h(S.agent.charAt(0)) + '</span>Drafted by ' + h(S.agent) + ' · edit freely</span>' : '') + '</div>' +
        '<div class="vmail-editor__fields">' +
        '<label for="vmail-compose-to">To</label><input id="vmail-compose-to" class="ap-input" type="text" inputmode="email" autocomplete="off" placeholder="name@company.com" value="' + h(s.toText) + '"' + (locked ? ' disabled' : '') + '>' +
        '<label for="vmail-compose-subject">Subject</label><input id="vmail-compose-subject" class="ap-input" type="text" maxlength="300" autocomplete="off" value="' + h(s.subject) + '"' + (locked ? ' disabled' : '') + '>' +
        '<label for="vmail-compose-brief">' + h(S.agent) + '</label><form class="vmail-tell" data-form="brief"><input id="vmail-compose-brief" class="ap-input" type="text" maxlength="500" autocomplete="off" placeholder="In a line, what should this email say?" value="' + h(s.brief) + '"' + (locked || drafting ? ' disabled' : '') + '>' +
        '<button type="submit" class="ap-btn vmail-btn-agent"' + (locked || drafting ? ' disabled' : '') + '>Draft with ' + h(S.agent) + '</button></form>' +
        '</div>';
    }
    var client = s.mode === 'reply' && S.open && S.open.msg && isClientThread(S.open.msg);
    var enter = !s.shown;
    s.shown = true;
    slot.innerHTML = '<section class="vmail-editor' + (enter ? ' vmail-editor--enter' : '') + '" aria-label="' + (s.mode === 'reply' ? 'Your reply' : 'New email') + '">' + head +
      '<div class="vmail-editor__body">' +
      '<label class="vmail-visually-hidden" for="vmail-editor-text">Message</label>' +
      '<textarea id="vmail-editor-text" class="ap-input vmail-editor__text' + (drafting ? ' is-drafting' : '') + '" rows="8"' + (locked || drafting ? ' disabled' : '') +
      ' placeholder="' + (s.mode === 'reply' ? 'Write your reply, or pick an answer above and ' + h(S.agent) + ' drafts it.' : 'Write your email.') + '"></textarea>' +
      (drafting ? '<div class="vmail-drafting" role="status"><span class="vmail-drafting__dots" aria-hidden="true"><span></span><span></span><span></span></span>' + h(S.agent) + ' is drafting' + (client ? ' with Claude' : '') + '…</div>' : '') +
      '</div>' +
      (s.mode === 'reply' ? '<p class="vmail-editor__note">The original email is quoted below your reply when it sends.</p>' : '') +
      (s.note ? '<p class="vmail-editor__note vmail-editor__note--ok">' + h(s.note) + '</p>' : '') +
      (s.error ? '<div class="vmail-editor__error" role="alert">' + h(s.error) + '</div>' : '') +
      '<div class="vmail-editor__actions">' +
      '<button type="button" class="ap-btn ap-btn--primary" id="vmail-send"' + (locked || drafting ? ' disabled' : '') + '><i class="fas fa-paper-plane" aria-hidden="true"></i>' + (st === 'failed' ? 'Try again' : 'Send') + '</button>' +
      '<button type="button" class="ap-btn" data-act="discard"' + (locked ? ' disabled' : '') + '>Discard</button>' +
      '<span class="vmail-spacer"></span><span class="vmail-editor__hint">' + h(S.cfg.undoSeconds || 10) + ' seconds to undo after Send</span>' +
      '</div></section>';
    $('vmail-editor-text').value = s.text;
  }

  function revealEditor() {
    var ed = document.querySelector('#vmail-reader .vmail-editor');
    if (ed && ed.scrollIntoView) ed.scrollIntoView({ block: 'nearest' });
  }
  function focusEditor(atStart) {
    var t = $('vmail-editor-text');
    if (!t || t.disabled) { revealEditor(); return; }
    try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); }
    if (atStart && t.setSelectionRange) t.setSelectionRange(0, 0);
    revealEditor();
  }

  function startReply(focus) {
    if (!S.open || !S.open.msg || isMine(S.open.msg)) return;
    var s = ensureSession('reply');
    if (!s) return;
    if (s.m.state === 'idle' || s.m.state === 'undone' || s.m.state === 'failed') s.m.next('edit');
    renderEditorSlot();
    renderValeSlot();
    if (focus !== false) focusEditor();
  }

  function startCompose() {
    if (sessionBusy()) { toast('Wait for the email that\'s sending, or undo it first.'); return; }
    S.openSeq++;
    S.openId = null;
    S.selectedId = null;
    syncSelection();
    S.open = { compose: true };
    var s = ensureSession('compose');
    if (!s) return;
    var saved = loadTyped('compose');
    if (saved && s.m.state === 'idle') { s.text = saved.text || ''; s.toText = saved.toText || ''; s.subject = saved.subject || ''; s.note = saved.text ? 'Restored your unsent email.' : ''; }
    if (s.m.state === 'idle') s.m.next('edit');
    setReading(true);
    renderReader();
    var to = $('vmail-compose-to');
    if (to) to.focus();
  }

  async function draftWithVale(stance, instruction) {
    var compose = S.open && S.open.compose;
    if (!compose && (!S.open || !S.open.msg)) return;
    var s = ensureSession(compose ? 'compose' : 'reply');
    if (!s) return;
    if (s.m.state === 'undone' || s.m.state === 'failed' || s.m.state === 'idle') s.m.next('edit');
    if (!s.m.can('draft')) return;
    var mine = s.text.trim() && s.text !== s.lastVale ? s.text : null;
    s.m.next('draft');
    s.stance = stance;
    s.error = null;
    s.note = '';
    var msg = compose ? null : S.open.msg;
    renderEditorSlot();
    renderValeSlot();
    revealEditor();
    try {
      var text = await valeDraft(s, msg, stance, instruction);
      if (S.session !== s) return;
      s.m.next('drafted');
      s.text = text;
      s.lastVale = text;
      s.byVale = true;
      persist(s);
      renderEditorSlot();
      renderValeSlot();
      focusEditor(true);
      if (mine) toast('Replaced your text with ' + S.agent + '\'s draft.', function () { s.text = mine; s.byVale = false; persist(s); renderEditorSlot(); });
    } catch (e) {
      if (S.session !== s) return;
      s.m.next('draftFailed');
      s.m.next('edit');
      s.error = (e && e.userText) || copy('draftFailed', 'Couldn\'t draft this one. You can still write it yourself.');
      renderEditorSlot();
      renderValeSlot();
      focusEditor();
    }
  }

  // Demo: canned drafts from the fixture (no network). Real: the bearer-only vale-draft API.
  async function valeDraft(s, msg, stance, instruction) {
    var target = s.mode === 'reply' ? recipientsFor(s)[0] : parseAddresses(s.toText)[0];
    var first = C.firstName(target ? { name: target.name, address: target.address } : null);
    if (S.demo) {
      await sleep(450 + Math.round(Math.random() * 400));
      var tpl = instruction ? S.drafts.compose : (S.drafts[stance] || S.drafts['default']);
      return C.fillDraft(tpl, { firstName: first, instruction: instruction });
    }
    var body;
    if (s.mode === 'reply') {
      var prior = thread(msg).filter(function (x) { return x.id !== msg.id; })
        .sort(function (a, b) { return String(b.receivedDateTime || b.sentDateTime).localeCompare(String(a.receivedDateTime || a.sentDateTime)); })
        .slice(0, 2).map(function (x) { return String(x.bodyPreview || ''); });
      body = {
        mode: 'reply', from: addrOf(msg.from), fromName: nameOf(msg.from), subject: String(msg.subject || ''),
        latest: bodyText(msg).slice(0, 6000), prior: prior, stance: stance || null, instruction: String(instruction || ''),
        to: (msg.toRecipients || []).concat(msg.ccRecipients || [], msg.replyTo || []).map(addrOf).filter(Boolean).slice(0, 50),
        // Client anywhere in the thread (earlier senders, Reply-To): Claude only. The server can
        // only escalate on this, never downgrade.
        client: C.threadIsClient(thread(msg), (S.rules && S.rules.rulesOnlyDomains) || [])
      };
    } else {
      var toList = parseAddresses(s.toText);
      body = { mode: 'compose', from: '', fromName: '', subject: s.subject, latest: '', prior: [], stance: null, instruction: String(instruction || ''), to: toList.map(function (r) { return r.address; }).slice(0, 50),
        client: C.threadIsClient([{ toRecipients: toList.map(function (r) { return { emailAddress: r }; }) }], (S.rules && S.rules.rulesOnlyDomains) || []) };
    }
    var r = await valeApi('/vale-draft', { method: 'POST', body: JSON.stringify(body) });
    if (r.status === 200 && r.body && typeof r.body.draft === 'string' && r.body.draft.trim()) return r.body.draft;
    var err = new Error('draft_' + r.status);
    err.userText = (r.body && typeof r.body.error === 'string' && r.status !== 500) ? r.body.error : copy('draftFailed', 'Couldn\'t draft this one.');
    throw err;
  }

  function startSend() {
    var s = S.session;
    if (!s) return;
    var t = $('vmail-editor-text');
    if (t) s.text = t.value;
    if (s.mode === 'compose') {
      var toEl = $('vmail-compose-to'), subEl = $('vmail-compose-subject');
      if (toEl) s.toText = toEl.value;
      if (subEl) s.subject = subEl.value;
    }
    if (s.m.state === 'undone' || s.m.state === 'failed' || s.m.state === 'idle') s.m.next('edit');
    if (!s.m.can('send')) return;
    var to = recipientsFor(s);
    var bad = !to.length ? 'Add who this goes to.' : (to.some(function (r) { return !EMAIL_RE.test(r.address); }) ? 'One of those addresses doesn\'t look right.' : '');
    if (!bad && !s.text.trim()) bad = 'Write something first, or pick an answer for ' + S.agent + ' to draft.';
    if (bad) { s.error = bad; renderEditorSlot(); focusEditor(); return; }
    s.error = null;
    s.note = '';
    persist(s);
    s.m.next('send');
    s.left = Number(S.cfg.undoSeconds) > 0 ? Number(S.cfg.undoSeconds) : 10;
    s.sendTo = to;
    $('vmail-sendbar-progress').max = s.left;
    showSendbar(s);
    setSending(true);
    $('vmail-sendbar-sr').textContent = 'Sending to ' + whoText(s, to) + ' in ' + s.left + ' seconds. Press Undo to stop.';
    renderEditorSlot();
    renderValeSlot();
    revealEditor();
    $('vmail-undo-send').focus();
    s.timer = setInterval(function () {
      s.left -= 1;
      if (s.left <= 0) { clearInterval(s.timer); s.timer = null; finishSend(s); }
      else showSendbar(s);
    }, 1000);
  }

  function showSendbar(s) {
    var who = whoText(s, s.sendTo);
    var sending = s.m.state === 'sending';
    $('vmail-sendbar-text').innerHTML = sending ? 'Sending to ' + h(who) + '…'
      : 'Sending to ' + h(who) + ' in <strong aria-hidden="true">' + s.left + '</strong><span aria-hidden="true">s</span>';
    $('vmail-sendbar-progress').value = sending ? 0 : s.left;
    $('vmail-undo-send').hidden = sending;
    $('vmail-sendbar').hidden = false;
  }

  function setSending(on) { $('vmail-main').classList.toggle('is-sending', !!on); }

  function undoSend() {
    var s = S.session;
    if (!s || s.m.state !== 'countdown') return;
    clearInterval(s.timer);
    s.timer = null;
    s.m.next('undo');
    s.m.next('edit');
    $('vmail-sendbar').hidden = true;
    setSending(false);
    $('vmail-sendbar-sr').textContent = 'Not sent.';
    s.note = 'Not sent. It\'s still here for you to edit.';
    if (S.open && (S.open.compose ? s.key === 'compose' : S.openId === s.key)) { renderEditorSlot(); renderValeSlot(); focusEditor(); }
    else toast('Not sent. Your reply is saved; open the email to finish it.');
  }

  async function finishSend(s) {
    s.m.next('elapse');
    showSendbar(s);
    $('vmail-sendbar-sr').textContent = 'Sending…';
    var to = s.sendTo || recipientsFor(s);
    try {
      var bodyHtml = '<div>' + C.textToHtml(s.text) + '</div>';
      if (s.mode === 'reply') {
        if (!s.draftId) {
          var d = await S.g.createReply(s.msgId);
          s.draftId = d.id;
          s.quoted = (d.body && d.body.content) || '';
        }
        // Always set the recipients to exactly what the editor showed at Send, so what Chad saw is
        // who gets it (never whatever createReply or an earlier draft picked).
        await S.g.patchDraft(s.draftId, { bodyHtml: bodyHtml + s.quoted, toRecipients: to.map(function (r) { return r.address; }) });
      } else if (!s.draftId) {
        var nd = await S.g.createDraft({ to: to.map(function (r) { return r.address; }), subject: s.subject, bodyHtml: bodyHtml });
        s.draftId = nd.id;
      } else {
        await S.g.patchDraft(s.draftId, { bodyHtml: bodyHtml, subject: s.subject, toRecipients: to.map(function (r) { return r.address; }) });
      }
      await S.g.sendDraft(s.draftId);
      s.m.next('sent');
      clearTyped(s.key);
      if (s.conversationId) S.replied[s.conversationId] = new Date().toISOString();
      if (S.session === s) S.session = null;
      s.m.next('reset');
      await loadFolder('sentitems');
      $('vmail-sendbar').hidden = true;
      $('vmail-sendbar-sr').textContent = 'Sent.';
      setSending(false);
      toast('Sent to ' + whoText(s, to) + '.');
      if (s.mode === 'compose' && S.open && S.open.compose) { S.open = null; setReading(false); renderReader(); }
      else if (S.open && S.open.msg) { renderEditorSlot(); renderValeSlot(); }
      renderListPane();
      renderGreetingIfIdle();
    } catch (e) {
      s.m.next('fail');
      $('vmail-sendbar').hidden = true;
      setSending(false);
      $('vmail-sendbar-sr').textContent = 'Not sent. Something went wrong.';
      s.error = copy('sendFailed', 'Not sent. Try again.') + ' ' + C.errorText(e).text;
      persist(s);
      if (S.session === s && S.open && (S.open.compose || S.openId === s.key)) { renderEditorSlot(); renderValeSlot(); }
      else toast('Your reply didn\'t send. Open the email to try again.', null, 'error');
    }
  }

  function discard() {
    var s = S.session;
    if (!s || sessionBusy()) return;
    var t = $('vmail-editor-text');
    var kept = { text: t ? t.value : s.text, toText: s.toText, subject: s.subject, byVale: s.byVale, mode: s.mode, key: s.key, msgId: s.msgId };
    clearTyped(s.key);
    S.session = null;
    if (S.open && S.open.compose) { S.open = null; setReading(false); renderReader(); }
    else { renderEditorSlot(); renderValeSlot(); }
    if (kept.text.trim()) {
      toast('Draft discarded.', function () {
        if (kept.mode === 'compose') { saveTyped('compose', kept); startCompose(); return; }
        saveTyped(kept.key, kept);
        if (S.openId === kept.msgId && S.open && S.open.msg) { restoreSession(S.open.msg); renderEditorSlot(); renderValeSlot(); focusEditor(); }
      });
    }
  }

  // ── Actions with Undo: archive, flag, read/unread ──────────────────────────

  function targetId() { return S.selectedId || S.openId; }

  async function archive(id) {
    var m = id && findMsg(id);
    if (!m) return;
    var where = m.parentFolderId || (S.search ? null : S.folder);
    if (where === 'archive') { toast('Already in Archive.'); return; }
    if (where === 'sentitems' || isMine(m)) { toast('Sent mail stays in Sent.'); return; }
    var from = where || 'inbox';
    var L = list(from);
    var idxAll = L.items.indexOf(m);
    var vis = visibleItems();
    var vi = vis.indexOf(m);
    var wasOpen = S.openId === id;
    var row = $('vmail-list').querySelector('[data-id="' + cssEsc(id) + '"]');
    if (row) row.classList.add('is-leaving');
    if (idxAll !== -1) L.items.splice(idxAll, 1);
    if (S.search) S.search.items = S.search.items.filter(function (x) { return x.id !== id; });
    var after = visibleItems();
    var nextMsg = after[Math.min(vi === -1 ? 0 : vi, after.length - 1)];
    S.selectedId = nextMsg ? nextMsg.id : null;
    renderListPane();
    renderFolders();
    if (wasOpen) {
      if (nextMsg && !isPhone()) openMessage(nextMsg.id);
      else closeReader();
    }
    var subj = m.subject || '(no subject)';
    var A = list('archive');
    // Optimistic: the strip shows at once; Undo waits for the move to land, then moves it back.
    var moved = S.g.move(id, 'archive').then(function () {
      m.parentFolderId = 'archive';
      if (A.loaded && !A.items.some(function (x) { return x.id === id; })) A.items.unshift(m);
      return true;
    }, function (e) {
      L.items.splice(Math.min(Math.max(idxAll, 0), L.items.length), 0, m);
      renderListPane();
      renderFolders();
      toast('Couldn\'t archive it. ' + C.errorText(e).text, null, 'error');
      return false;
    });
    toast('Archived “' + subj + '”.', async function () {
      if (!(await moved)) return;
      try {
        await S.g.move(id, from);
        m.parentFolderId = from;
        A.items = A.items.filter(function (x) { return x.id !== id; });
        L.items.splice(Math.min(Math.max(idxAll, 0), L.items.length), 0, m);
        S.selectedId = id;
        renderListPane();
        renderFolders();
        toast('Moved back to ' + folderName(from) + '.');
      } catch (e) { toast('Couldn\'t move it back. ' + C.errorText(e).text, null, 'error'); }
    });
  }

  function folderName(id) { var f = S.folders.filter(function (x) { return x.id === id; })[0]; return f ? f.displayName : id; }

  async function setFlag(id, on, quiet) {
    var m = findMsg(id) || (S.open && S.open.msg && S.open.msg.id === id ? S.open.msg : null);
    if (!m) return;
    var prev = m.flag ? { flagStatus: m.flag.flagStatus } : { flagStatus: 'notFlagged' };
    patchLocal(id, { flag: { flagStatus: on ? 'flagged' : 'notFlagged' } });
    refreshAfterPatch(id);
    try {
      await S.g.patchMessage(id, { flag: on });
      if (!quiet) toast(on ? 'Flagged. It now shows under ' + copy('filters.needs_you', 'Needs you') + '.' : 'Flag removed.', function () { setFlag(id, prev.flagStatus === 'flagged', true); });
    } catch (e) {
      patchLocal(id, { flag: prev });
      refreshAfterPatch(id);
      toast('Couldn\'t change the flag. ' + C.errorText(e).text, null, 'error');
    }
  }

  async function setRead(id, read, quiet) {
    var m = findMsg(id) || (S.open && S.open.msg && S.open.msg.id === id ? S.open.msg : null);
    if (!m) return;
    var prev = !!m.isRead;
    patchLocal(id, { isRead: read });
    refreshAfterPatch(id);
    try {
      await S.g.patchMessage(id, { isRead: read });
      if (!quiet) toast(read ? 'Marked read.' : 'Marked unread.', function () { setRead(id, prev, true); });
    } catch (e) {
      patchLocal(id, { isRead: prev });
      refreshAfterPatch(id);
      toast('Couldn\'t change that. ' + C.errorText(e).text, null, 'error');
    }
  }

  function refreshAfterPatch(id) {
    renderListPane();
    renderFolders();
    if (S.open && S.open.msg && S.open.msg.id === id) {
      var bar = $('vmail-reader').querySelector('.vmail-reader__bar');
      if (bar) bar.outerHTML = toolbarHtml(S.open.msg);
      renderValeSlot();
    }
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  async function runSearch(raw) {
    var q = C.searchQuery(raw);
    if (!q) { clearSearch(); return; }
    var seq = (S.searchSeq = (S.searchSeq || 0) + 1);
    S.search = { q: q, loading: true, items: [], error: null };
    S.selectedId = null;
    renderFolders();
    renderListPane();
    try {
      var items = await S.g.search(q);
      if (seq !== S.searchSeq || !S.search) return;
      S.search = { q: q, loading: false, items: items || [], error: null };
    } catch (e) {
      if (seq !== S.searchSeq || !S.search) return;
      S.search = { q: q, loading: false, items: [], error: e };
    }
    renderListPane();
  }

  function clearSearch() {
    S.search = null;
    S.searchSeq = (S.searchSeq || 0) + 1;
    $('vmail-search').value = '';
    renderFolders();
    renderListPane();
  }

  // ── Toast + help ───────────────────────────────────────────────────────────

  function toast(text, undo, kind) {
    if (!$('vmail-toast')) return; // a gate screen replaced the shell
    clearTimeout(S.toastTimer);
    S.undoFn = typeof undo === 'function' ? undo : null;
    $('vmail-toast-text').textContent = text;
    $('vmail-toast-undo').hidden = !S.undoFn;
    $('vmail-toast').classList.toggle('vmail-toast--error', kind === 'error');
    $('vmail-toast').hidden = false;
    S.toastTimer = setTimeout(hideToast, S.undoFn ? 8000 : 4500);
  }
  function hideToast() { $('vmail-toast').hidden = true; S.undoFn = null; }

  function openHelp() {
    var d = $('vmail-help');
    if (d.open) return;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  function closeHelp() {
    var d = $('vmail-help');
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
  }

  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }

  // ── Events ─────────────────────────────────────────────────────────────────

  function wire() {
    $('vmail-skip').addEventListener('click', function (e) { e.preventDefault(); $('vmail-list').focus(); });
    $('vmail-list').addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (act) { handleAct(act.getAttribute('data-act'), act); return; }
      var jump = e.target.closest('[data-filter-jump]');
      if (jump) { setFilter(jump.getAttribute('data-filter-jump')); return; }
      var row = e.target.closest('[role="option"]');
      if (row) select(row.getAttribute('data-id'), { open: true, show: true });
    });
    $('vmail-chips').addEventListener('click', function (e) {
      var c = e.target.closest('[data-filter]');
      if (c) setFilter(c.getAttribute('data-filter'));
    });
    $('vmail-folders').addEventListener('click', function (e) {
      var f = e.target.closest('[data-folder]');
      if (f) setFolder(f.getAttribute('data-folder'));
    });
    $('vmail-folder-select').addEventListener('change', function (e) { setFolder(e.target.value); });
    $('vmail-search-form').addEventListener('submit', function (e) { e.preventDefault(); runSearch($('vmail-search').value); });
    $('vmail-search').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); clearSearch(); $('vmail-search').blur(); $('vmail-list').focus(); }
    });
    $('vmail-search-clear').addEventListener('click', function () { clearSearch(); $('vmail-list').focus(); });
    $('vmail-compose').addEventListener('click', startCompose);
    $('vmail-help-btn').addEventListener('click', openHelp);
    $('vmail-help-close').addEventListener('click', closeHelp);
    $('vmail-help').addEventListener('click', function (e) { if (e.target === $('vmail-help')) closeHelp(); });
    $('vmail-undo-send').addEventListener('click', undoSend);
    $('vmail-toast-undo').addEventListener('click', function () { var fn = S.undoFn; hideToast(); if (fn) fn(); });
    $('vmail-today-body').addEventListener('click', function (e) { if (e.target.closest('[data-act="calendar"]')) loadCalendar(); });

    var reader = $('vmail-reader');
    reader.addEventListener('click', function (e) {
      if (e.target.closest('#vmail-back')) { closeReader(); return; }
      if (e.target.closest('#vmail-show-images')) { S.open.showImages = true; renderBodySlot(); return; }
      var att = e.target.closest('[data-att]');
      if (att) { download(att.getAttribute('data-att')); return; }
      var st = e.target.closest('[data-stance]');
      if (st && !st.disabled) { draftWithVale(st.getAttribute('data-stance'), ''); return; }
      if (e.target.closest('#vmail-send')) { startSend(); return; }
      var act = e.target.closest('[data-act]');
      if (act && !act.disabled) handleAct(act.getAttribute('data-act'), act);
    });
    reader.addEventListener('submit', function (e) {
      var form = e.target.closest('[data-form]');
      if (!form) return;
      e.preventDefault();
      var input = form.querySelector('input');
      var text = input ? input.value.trim() : '';
      if (form.getAttribute('data-form') === 'brief' && S.session) S.session.brief = text;
      if (!text) { if (input) input.focus(); return; }
      draftWithVale(null, text);
    });
    reader.addEventListener('input', function (e) {
      var s = S.session;
      if (!s) return;
      if (e.target.id === 'vmail-editor-text') {
        s.text = e.target.value;
        if (s.m.state === 'idle') s.m.next('edit');
        clearTimeout(s.saveTimer);
        s.saveTimer = setTimeout(function () { persist(s); }, 300);
      } else if (e.target.id === 'vmail-compose-to') { s.toText = e.target.value; persist(s); }
      else if (e.target.id === 'vmail-compose-subject') { s.subject = e.target.value; persist(s); }
      else if (e.target.id === 'vmail-compose-brief') { s.brief = e.target.value; }
    });
    reader.addEventListener('keydown', function (e) {
      if (e.target.id === 'vmail-editor-text' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); startSend(); }
    });

    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', function (e) {
      if (sessionBusy()) { e.preventDefault(); e.returnValue = ''; }
      if (S.session) persist(S.session);
    });
    if (phoneMq.addEventListener) phoneMq.addEventListener('change', function () { if (!isPhone() && !S.open) setReading(false); });
  }

  function setFilter(f) {
    if (FILTERS.indexOf(f) === -1) return;
    S.filter = f;
    if (S.search) clearSearch();
    if (S.folder !== 'inbox') { setFolder('inbox'); }
    renderListPane();
  }

  function handleAct(act, el) {
    var id = S.open && S.open.msg ? S.open.msg.id : null;
    switch (act) {
      case 'reload': loadFolder(S.folder); break;
      case 'more': loadFolder(S.folder, true); break;
      case 'research': if (S.search) runSearch(S.search.q); break;
      case 'reopen': if (S.openId) openMessage(S.openId); break;
      case 'atts': if (S.open && S.open.msg) loadAttachments(S.openSeq, S.open.msg); break;
      case 'calendar': loadCalendar(); break;
      case 'signin': signIn(); break;
      case 'start': {
        setFilter('needs_you');
        var first = visibleItems()[0];
        if (first) select(first.id, { open: true, show: true, focusReader: true });
        break;
      }
      case 'reply': startReply(); break;
      case 'draft': draftWithVale(null, ''); break;
      case 'archive': if (id) archive(id); break;
      case 'flag': if (id) setFlag(id, !isFlagged(S.open.msg)); break;
      case 'unread': if (id) setRead(id, !S.open.msg.isRead); break;
      case 'discard': discard(); break;
      case 'use-from': if (id && !sessionBusy()) { delete S.replyTo[id]; renderValeSlot(); renderEditorSlot(); } break;
      case 'use-replyto': if (id && !sessionBusy()) { S.replyTo[id] = 'replyto'; renderValeSlot(); renderEditorSlot(); } break;
      default: break;
    }
    return el;
  }

  function onKey(e) {
    if ($('vmail-help').open) return;
    if (!S.g) return;
    var action = C.shortcutFor(e);
    if (!action) return;
    var active = document.activeElement;
    var inList = active === $('vmail-list');
    var onControl = active && active !== document.body && !inList && /^(BUTTON|A|SUMMARY)$/.test(active.tagName);
    switch (action) {
      case 'next': e.preventDefault(); move(1); break;
      case 'prev': e.preventDefault(); move(-1); break;
      case 'open':
        if (onControl || !S.selectedId) return;
        e.preventDefault();
        openMessage(S.selectedId, { show: true, focusReader: true });
        break;
      case 'archive': e.preventDefault(); archive(targetId()); break;
      case 'reply':
        e.preventDefault();
        if (S.selectedId && S.selectedId !== S.openId) openMessage(S.selectedId, { show: true }).then(function () { startReply(); });
        else startReply();
        break;
      case 'draft':
        e.preventDefault();
        if (S.selectedId && S.selectedId !== S.openId) openMessage(S.selectedId, { show: true }).then(function () { draftWithVale(null, ''); });
        else draftWithVale(null, '');
        break;
      case 'flag': { e.preventDefault(); var fm = findMsg(targetId()); if (fm) setFlag(fm.id, !isFlagged(fm)); break; }
      case 'unread': { e.preventDefault(); var um = findMsg(targetId()); if (um) setRead(um.id, !um.isRead); break; }
      case 'search': e.preventDefault(); $('vmail-search').focus(); $('vmail-search').select(); break;
      case 'help': e.preventDefault(); openHelp(); break;
      case 'close':
        if (S.session && /^(countdown)$/.test(S.session.m.state)) return;
        if (S.open) { e.preventDefault(); closeReader(); }
        break;
      default: break;
    }
  }

  // ── Real mode (Microsoft Graph via MSAL) ───────────────────────────────────

  function apiBase() {
    return /(^|\.)ambientpixels\.ai$/.test(location.hostname) ? 'https://ambientpixels-nova-api.azurewebsites.net/api' : '/api';
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  async function silentToken(scopes, force) {
    if (!S.msal || !S.account) return null;
    try {
      var r = await S.msal.acquireTokenSilent({ scopes: scopes, account: S.account, forceRefresh: !!force });
      return r && r.accessToken ? r.accessToken : null;
    } catch (e) { return null; }
  }
  function graphToken(opts) { return silentToken(S.cfg.graphScopes, opts && opts.forceRefresh); }
  async function valeApi(path, opts) {
    var t = await silentToken([S.cfg.valeScope], false);
    if (!t) return { status: 401, body: { error: 'Sign in again so ' + S.agent + ' can help.' } };
    var headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t };
    try {
      var r = await fetch(apiBase() + path, Object.assign({}, opts || {}, { headers: headers, cache: 'no-store' }));
      var j = null;
      try { j = await r.json(); } catch (e) { j = null; }
      return { status: r.status, body: j || {} };
    } catch (e) { return { status: 0, body: { error: 'You seem to be offline.' } }; }
  }
  function signIn() {
    if (!S.msal) return;
    // vale-auth.html routes by the MSAL state ("…|vmail") in the response; the timestamped flag is
    // only a fallback and expires after 10 minutes, so an abandoned sign-in can't hijack the Office's.
    try { sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify({ at: Date.now() })); } catch (e) { /* ignore */ }
    S.msal.loginRedirect({ scopes: S.cfg.graphScopes, extraScopesToConsent: [S.cfg.valeScope], loginHint: S.cfg.mailbox, state: 'vmail' });
  }

  function gate(title, text, button) {
    markBooted();
    $('vmail-shell').innerHTML = '<div class="vmail-gate"><span class="vmail-avatar vmail-avatar--agent vmail-avatar--lg" aria-hidden="true">' + h(S.agent.charAt(0)) + '</span>' +
      '<h2>' + h(title) + '</h2><p>' + h(text) + '</p>' + (button || '') + '</div>';
  }

  async function bootReal() {
    try {
      await loadScript('/js/vendor/msal-browser.min.js');
      S.msal = new window.msal.PublicClientApplication({
        auth: {
          clientId: S.cfg.clientId,
          authority: 'https://login.microsoftonline.com/' + S.cfg.tenantId,
          redirectUri: location.origin + (S.cfg.authRedirectPath || '/pages/vale-auth.html'),
          navigateToLoginRequestUrl: false
        },
        cache: { cacheLocation: 'sessionStorage' }
      });
      await S.msal.initialize();
      var res = await S.msal.handleRedirectPromise().catch(function () { return null; });
      S.account = (res && res.account) || S.msal.getAllAccounts()[0] || null;
    } catch (e) {
      gate('Microsoft sign-in didn\'t load', 'Refresh the page to try again.', '');
      return false;
    }
    if (!S.account) {
      var q = new URLSearchParams(location.search);
      gate('Sign in to ' + S.cfg.productName, (q.get('signin') === 'error' ? 'Sign-in didn\'t finish. ' : '') +
        'Use your ' + S.cfg.mailbox + ' Microsoft account. ' + S.agent + ' reads and drafts here; nothing sends without you pressing Send.',
        '<button type="button" class="ap-btn ap-btn--primary" id="vmail-signin">Sign in with Microsoft</button>');
      $('vmail-signin').addEventListener('click', signIn);
      return false;
    }
    S.g = window.ValeGraphBrowser.createGraphClient({ fetch: window.fetch.bind(window), getToken: graphToken, timeZone: 'UTC' });
    // Vale's judgments: latest triage (labels + reasons), rules, day-job hours. Read-only here.
    Promise.all([
      valeApi('/vale-state?key=valeMailState'),
      valeApi('/vale-state', { method: 'POST', body: JSON.stringify({ op: 'rules.get' }) }),
      valeApi('/vale-state?key=ceoProfile')
    ]).then(function (r) {
      var st = r[0].status === 200 ? (r[0].body.value || null) : undefined;
      S.sortState = st === undefined ? 'failed' : 'ok';
      S.triagedAt = st && st.at ? st.at : null;
      S.labels = C.triageLabels(st, list('inbox').items);
      S.sortRaw = st;
      S.rules = (r[1].status === 200 && r[1].body.rules) || {};
      S.workHours = (r[2].status === 200 && r[2].body.value && r[2].body.value.workHours) || null;
      renderStamp();
      renderListPane();
      renderToday();
      renderNextUp();
      if (S.open && S.open.msg) renderValeSlot(); else renderGreetingIfIdle();
    });
    return true;
  }

  // The demo backend shifts every date by (now - anchor), which keeps mail fresh but would put
  // meetings at odd hours late at night. Pre-shift the calendar so that, after the backend's shift,
  // meetings land on today/tomorrow at their fixture wall-clock times.
  function alignDemoCalendar(fixture) {
    var anchorMs = Date.parse(fixture.anchor);
    if (!isFinite(anchorMs) || !Array.isArray(fixture.calendar) || !window.ValeMailDemo.shiftIso) return;
    var a = new Date(anchorMs); a.setHours(0, 0, 0, 0);
    var n = new Date(); n.setHours(0, 0, 0, 0);
    var adj = Math.round((n.getTime() - a.getTime()) / 86400000) * 86400000 - (Date.now() - anchorMs);
    // shiftIso keeps whole seconds only: land a second past the minute so times read :00, not :59.
    adj = Math.ceil(adj / 1000) * 1000 + 1000;
    fixture.calendar.forEach(function (ev) {
      ['start', 'end'].forEach(function (k) { if (ev[k] && ev[k].dateTime) ev[k].dateTime = window.ValeMailDemo.shiftIso(ev[k].dateTime, adj); });
    });
  }

  async function bootDemo() {
    var path = S.cfg.demoFixture || '/data/vale-mail-demo.json';
    if (!/^\/data\/[\w.-]+\.json$/.test(path)) throw new Error('bad fixture path');
    var fixture = await (await fetch(path, { cache: 'no-store' })).json();
    alignDemoCalendar(fixture);
    S.g = window.ValeMailDemo.createDemoGraph(fixture);
    var x = S.g.extras();
    S.labels = x.labels || {};
    S.rules = x.rules || {};
    S.workHours = x.workHours || null;
    S.drafts = x.drafts || {};
    S.triagedAt = x.triagedAt || null;
    S.sortState = 'ok';
    if (x.folderList && x.folderList.length) S.folders = x.folderList.map(function (f) { return { id: f.id, displayName: f.displayName }; });
    return true;
  }

  async function boot() {
    try { sessionStorage.removeItem(AUTH_RETURN_KEY); } catch (e) { /* ignore */ }
    wire();
    try {
      S.cfg = await (await fetch('/data/vale-mail-product.json', { cache: 'no-store' })).json();
    } catch (e) {
      gate('Mail didn\'t load', 'Couldn\'t load the mail settings. Refresh the page to try again.', '');
      return;
    }
    S.copy = S.cfg.copy || {};
    S.agent = (S.cfg.agent && S.cfg.agent.name) || 'Vale';
    var q = new URLSearchParams(location.search);
    S.demo = q.get('demo') === '1' || (!S.cfg.clientId && S.cfg.demoDefault !== false);
    renderIdentity();
    if (!S.demo && !S.cfg.clientId) { gate(S.cfg.productName + ' isn\'t set up yet', 'Finish the setup checklist, then come back.', ''); return; }
    renderFolders();
    renderListPane();
    renderToday();
    renderReader();
    var ok;
    try { ok = S.demo ? await bootDemo() : await bootReal(); }
    catch (e) { gate('Mail didn\'t load', 'Couldn\'t open the mailbox. Refresh the page to try again.', ''); return; }
    if (!ok) return;
    renderStamp();
    S.g.me().then(function (me) { S.me = me || S.me; renderGreetingIfIdle(); renderListPane(); }).catch(function () { /* greeting stays generic */ });
    loadFolder('inbox');
    loadFolder('sentitems');
    loadCalendar();
    if (location.hash === '#vmail-list') $('vmail-list').focus();
    setInterval(function () { renderStamp(); renderNextUp(); }, 60000);
  }

  // Exposed for the E2E script and debugging only — holds no mail data.
  window.ValeMailClient = { version: 1 };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
