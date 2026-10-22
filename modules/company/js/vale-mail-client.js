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
  // Set by Sign out / Switch account: the next sign-in shows Microsoft's account picker
  // instead of quietly reusing the account the browser is already signed in with.
  var PICK_ACCOUNT_KEY = 'vmail.pickAccount';
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
  function isMine(m) {
    if (!S.me.mail || addrOf(m && m.from).toLowerCase() !== S.me.mail.toLowerCase()) return false;
    // Inbox mail that only puts your address in From is not yours (see ValeMailCore.isInternal).
    return m.parentFolderId !== 'inbox' || C.isInternal(m);
  }
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
  // A saved reason never carries a relative time ("5 days ago"): it was written at sorting time
  // and would contradict the live facts. Reasons built here ("You replied …") are live.
  function reasonOf(l) { return !l || !l.why ? '' : (l.by === 'you' ? l.why : C.stripRelativeTime(l.why)); }
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
    renderStampInto($('vmail-checked'));
    // Phones hide the header stamp; the list header carries the same line there.
    var ph = $('vmail-checked-phone');
    if (ph) renderStampInto(ph);
  }
  function renderStampInto(el) {
    el.classList.remove('vmail-checked--stale');
    if (S.sortState === 'loading') { el.textContent = ''; return; }
    if (S.sortState === 'failed') {
      el.textContent = 'Couldn\'t load ' + S.agent + '\'s sorting';
      el.classList.add('vmail-checked--stale');
      return;
    }
    if (!S.triagedAt) { el.textContent = S.agent + ' hasn\'t sorted your inbox yet'; return; }
    var st = stampTime(S.triagedAt);
    // "Vale sorted at 6:41 AM" today; "Vale sorted yesterday at 11:02 PM" / "… Thu at 9:15 AM" before.
    // It is the time of Vale's sorting, not of the mail (which is live).
    el.textContent = (/^\d/.test(st) ? copy('checkedAt', '{agent} sorted at {time}').replace('{time}', st)
      : copy('checkedOn', '{agent} sorted {when}').replace('{when}', st)).replace('{agent}', S.agent);
    el.title = copy('checkedTitle', 'Mail is live; {agent} last sorted it at {time}. Newer mail says Not sorted yet.')
      .replace('{agent}', S.agent).replace('{time}', st);
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
    dropPlainToast();
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
    var inInbox = S.folder === 'inbox';
    chips.hidden = !inInbox;
    // While a search shows, the chips keep their space (so nothing jumps) but are hidden and inert.
    chips.classList.toggle('is-covered', !!S.search);
    chips.inert = !!S.search;
    if (S.search) chips.setAttribute('aria-hidden', 'true'); else chips.removeAttribute('aria-hidden');
    if (!inInbox) return;
    var c = inboxCounts();
    // Nothing loaded yet (or the load failed): no counts at all, never a "0" that claims an
    // empty inbox. The empty count span keeps each chip's width close to its loaded size.
    var L = list('inbox');
    var unknown = !L.items.length && (L.loading || !!L.error || !L.loaded);
    chips.innerHTML = FILTERS.map(function (f) {
      var on = S.filter === f;
      var long = copy('filterNames.' + f, copy('filters.' + f, f));
      return '<button type="button" class="vmail-chip' + (f === 'needs_you' ? ' vmail-chip--agent' : '') + '" data-filter="' + f + '" aria-pressed="' + on + '"' +
        ' title="' + h(long) + '" aria-label="' + h(unknown ? long : long + ', ' + (c[f] || 0)) + '">' +
        h(copy('filters.' + f, f)) + ' <span class="vmail-chip__count" aria-hidden="true">' + (unknown ? '' : (c[f] || 0)) + '</span></button>';
    }).join('');
    // One row at every width; a narrow pane scrolls it. Never leave the selected chip half shown.
    var sel = chips.querySelector('[aria-pressed="true"]');
    if (sel && chips.scrollWidth > chips.clientWidth + 1) {
      var left = sel.getBoundingClientRect().left - chips.getBoundingClientRect().left + chips.scrollLeft, right = left + sel.offsetWidth;
      if (left - 32 < chips.scrollLeft) chips.scrollLeft = Math.max(0, left - 32);
      else if (right + 32 > chips.scrollLeft + chips.clientWidth) chips.scrollLeft = right + 32 - chips.clientWidth;
    }
    chipEdges();
  }
  // Fade only the side that has hidden chips.
  function chipEdges() {
    var chips = $('vmail-chips');
    if (!chips) return;
    var over = chips.scrollWidth > chips.clientWidth + 1;
    chips.classList.toggle('is-more-left', over && chips.scrollLeft > 1);
    chips.classList.toggle('is-more-right', over && chips.scrollLeft + chips.clientWidth < chips.scrollWidth - 1);
  }

  function renderCount() {
    var el = $('vmail-count');
    var L = list(S.folder);
    var folder = S.folders.filter(function (f) { return f.id === S.folder; })[0];
    var fname = folder ? folder.displayName : 'this folder';
    if (S.search) { el.textContent = 'Searching all your mail'; return; }
    if ((L.loading && !L.items.length) || L.error) { el.textContent = ''; return; }
    var n = L.items.length;
    if (S.folder === 'inbox' && S.filter !== 'all') el.textContent = visibleItems().length + ' of the latest ' + n;
    else el.textContent = 'The latest ' + n + ' in ' + fname;
  }

  // One line under the chips naming what a mixed filter holds.
  function renderListNote() {
    var el = $('vmail-listnote');
    if (!el) return;
    var on = !S.search && S.folder === 'inbox' && S.filter === 'newsletter';
    el.hidden = !on;
    el.textContent = on ? copy('newsletterNote', 'Newsletters and low-priority mail {agent} set aside from your inbox').replace('{agent}', S.agent) : '';
  }

  function renderSearchHead() {
    var head = $('vmail-searchhead');
    head.hidden = !S.search;
    $('vmail-listpane').classList.toggle('is-searching', !!S.search);
    if (!S.search) return;
    var n = S.search.items.length;
    $('vmail-searchhead-text').textContent = S.search.loading ? 'Searching for “' + S.search.q + '”…'
      : (n + (n === 1 ? ' result' : ' results') + ' for “' + S.search.q + '”' + (n >= 50 ? ' (the first 50)' : ''));
  }

  // ── List ───────────────────────────────────────────────────────────────────

  // In a filtered inbox view the label that defines the filter isn't repeated on every row.
  function filterImpliesLabel(l) {
    return !!l && S.folder === 'inbox' && !S.search && S.filter !== 'all' && l.label === S.filter;
  }
  function checkTagHtml(m) {
    var g = guardFor(m);
    if (!g) return '';
    var why = g.kind === 'replyto' ? 'Replies would go to a different address than the sender\'s.'
      : g.kind === 'lookalike' ? 'This looks like ' + g.known + ', but it\'s from ' + g.from + '.'
        : 'This claims to be from ' + g.from + ' but came from outside your organization.';
    return '<span class="vmail-tag vmail-tag--check" title="' + h(why) + '"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>' +
      h(copy('checkSender', 'Check sender')) + '<span class="vmail-visually-hidden">: ' + h(why) + '</span></span>';
  }
  function tagHtml(m) {
    var l = labelFor(m);
    if (filterImpliesLabel(l)) return '';
    var name = l && C.labelName(l.label);
    // "Low priority" and "Newsletter" share the Newsletters filter, so they share one tag style.
    if (name) return '<span class="vmail-tag vmail-tag--' + h(l.label === 'noise' ? 'newsletter' : l.label) + '">' + h(name) + '</span>';
    if (C.bucketOf(m, null) === 'newsletter') return filterImpliesLabel({ label: 'newsletter' }) ? '' : '<span class="vmail-tag vmail-tag--newsletter">Newsletter</span>';
    return '<span class="vmail-tag vmail-tag--unsorted">' + h(copy('notSorted', 'Not sorted yet')) + '</span>';
  }
  function whyFor(m) {
    var l = labelFor(m);
    if (l && l.why && sameAsLabel(l)) return '';
    if (l && l.why) return reasonOf(l);
    if (l) return '';
    if (C.bucketOf(m, null) === 'newsletter') return '';
    var t = Date.parse(m.receivedDateTime || '');
    if (S.triagedAt && isFinite(t) && t > Date.parse(S.triagedAt)) return 'Arrived after ' + S.agent + '\'s last check';
    if (S.sortState === 'failed') return '';
    // Older than the last sort but unlabeled: it wasn't part of that sort (never "Vale missed it").
    return S.triagedAt ? copy('notInSort', 'Not in {agent}\'s last sort').replace('{agent}', S.agent) : S.agent + ' hasn\'t looked at this one';
  }

  function rowHtml(m) {
    var sentView = S.folder === 'sentitems' && !S.search;
    var who = sentView || isMine(m) ? 'To: ' + names(m.toRecipients) : nameOf(m.from);
    var marks = '';
    if (isClient(m)) marks += '<span class="vmail-client">' + h(copy('clientMarker', 'client')) + '</span>';
    if (m.hasAttachments) marks += '<i class="fas fa-paperclip" role="img" aria-label="Has attachments"></i>';
    if (isFlagged(m)) marks += '<i class="fas fa-flag" role="img" aria-label="Flagged"></i>';
    if (S.replied[m.conversationId]) marks += '<i class="fas fa-reply" role="img" aria-label="You replied"></i>';
    var draftMark = hasDraft(m.id) ? draftMarkHtml() : '';
    var vale = '';
    if (!sentView && !isMine(m)) {
      var why = whyFor(m);
      var tags = checkTagHtml(m) + tagHtml(m);
      if (tags || why) vale = '<div class="vmail-row__vale">' + tags + (why ? '<span class="vmail-row__why">' + h(why) + '</span>' : '') + '</div>';
    }
    var selected = m.id === S.selectedId;
    // Waiting on them: you wrote last, so the row shows what you sent and when.
    var yours = !sentView && !isMine(m) && C.bucketOf(m, labelFor(m)) === 'waiting' ? lastSentAfter(m) : null;
    var whenIso = yours ? (yours.sentDateTime || yours.receivedDateTime) : (m.receivedDateTime || m.sentDateTime || '');
    var preview = yours ? 'You: ' + String(yours.bodyPreview || '').slice(0, 80) : String(m.bodyPreview || '');
    return '<div class="vmail-row' + (m.isRead ? '' : ' is-unread') + '" role="option" id="' + rowDomId(m.id) + '" data-id="' + h(m.id) + '" aria-selected="' + selected + '">' +
      '<span class="vmail-row__dot" aria-hidden="true"></span>' +
      '<div class="vmail-row__main">' +
      '<div class="vmail-row__top"><span class="vmail-row__from">' + h(who) + '</span>' +
      (marks ? '<span class="vmail-row__marks">' + marks + '</span>' : '') + draftMark +
      '<time class="vmail-row__when" datetime="' + h(whenIso || '') + '">' + h(C.formatWhen(whenIso, now())) + '</time></div>' +
      '<div class="vmail-row__subject"><strong>' + h(m.subject || '(no subject)') + '</strong>' +
      (preview ? ' — <span class="vmail-row__preview">' + h(preview) + '</span>' : '') + '</div>' + vale +
      '</div></div>';
  }
  // An unsent reply waiting on this email: the live one, or text Chad typed and left.
  function hasDraft(id) {
    // The editor's input handler keeps session.text current.
    if (S.session && S.session.key === id && S.session.mode === 'reply') {
      // In its send window (or gone) it is no longer a draft: the row must not say "Draft"
      // under "Sending to … in 10s".
      if (/^(countdown|sending|sent)$/.test(S.session.m.state)) return false;
      return !!String(S.session.text || '').trim();
    }
    var saved = loadTyped(id);
    return !!(saved && String(saved.text || '').trim());
  }
  function draftMarkHtml() { return '<span class="vmail-row__draft">Draft</span>'; }
  // Re-mark one row without re-rendering the list (typing saves every 300 ms).
  function refreshDraftMark(id) {
    if (!id || id === 'compose') return;
    var row = document.getElementById(rowDomId(id));
    if (!row) return;
    var cur = row.querySelector('.vmail-row__draft');
    var want = hasDraft(id);
    if (want && !cur) {
      var when = row.querySelector('.vmail-row__when');
      if (when) when.insertAdjacentHTML('beforebegin', draftMarkHtml());
    } else if (!want && cur) cur.parentNode.removeChild(cur);
  }
  // Your newest message in the thread, when it is newer than m (you wrote last).
  function lastSentAfter(m) {
    var t = msgTime(m);
    var mine = sentInThread(m).filter(function (x) { return x.id !== m.id && msgTime(x) > t; })
      .sort(function (a, b) { return msgTime(b) - msgTime(a); });
    return mine[0] || null;
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

  function setMore(html) {
    var slot = $('vmail-more-slot');
    if (!slot) return;
    slot.innerHTML = html || '';
    slot.hidden = !html;
  }

  function renderList() {
    var box = $('vmail-list');
    var L = list(S.folder);
    setMore('');
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
    box.innerHTML = items.map(rowHtml).join('');
    // A listbox owns only options, so "Load older mail" sits in its own slot after the list.
    if (!S.search && L.next) {
      setMore('<button type="button" class="ap-btn vmail-btn-sm vmail-more" data-act="more"' + (L.loading ? ' disabled' : '') + '>' +
        (L.loading ? 'Loading…' : 'Load older mail') + '</button>');
    }
    syncSelection();
  }

  function renderListPane() {
    renderChips();
    renderCount();
    renderListNote();
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
    moveTo(j);
  }

  // Select row j of the visible list; on wider screens the reader follows once it settles.
  function moveTo(j) {
    var items = visibleItems();
    if (!items.length) return;
    j = Math.max(0, Math.min(items.length - 1, j));
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
    more = !!(more && L.next);
    // Loads of one folder can overlap (a reload while one is in flight, the post-send refresh of
    // Sent): only the newest one's result is applied (ValeMailCore.listBegin / listSettle).
    var token = C.listBegin(L, more);
    if (!token) return;
    if (folder === S.folder) renderListPane();
    var res = null, err = null;
    try {
      res = more ? await S.g.listMessages({ skipToken: L.next })
        : await S.g.listMessages({ folder: folder, top: S.cfg.inboxPageSize || 50 });
    } catch (e) { err = e; }
    if (!C.listSettle(L, token, res, err)) return;
    // Callers fire and forget: nothing after the settle may reject, or the list would sit on
    // skeletons forever. A throw here becomes the error card (with Try again) instead.
    try {
      if (err && more) toast(C.errorText(err).text, null, 'error');
      if (!err && folder === 'inbox' && !S.demo && S.sortState === 'ok') {
        try { S.labels = C.triageLabels(S.sortRaw, L.items); } catch (x) { S.labels = {}; }
      }
      if (folder === S.folder) renderListPane();
      if (folder === 'inbox') { renderFolders(); renderGreetingIfIdle(); }
      if (folder === 'sentitems' && S.open && S.open.msg) renderValeSlot();
    } catch (e) {
      L.error = L.error || e;
      try { if (folder === S.folder) renderListPane(); } catch (x) { /* the error card is the fallback */ }
    }
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
    // The demo on a weekend shows the next two weekdays (see alignDemoCalendar).
    var start = S.calBase ? new Date(S.calBase) : new Date(); start.setHours(0, 0, 0, 0);
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
    // Not yet answered (an invite Chad hasn't accepted) reads as proposed, not confirmed.
    var proposed = !tentative && ev.responseStatus && /^(notResponded|none)$/i.test(ev.responseStatus.response || '');
    return {
      ev: ev, startMs: s, endMs: e, allDay: !!ev.isAllDay, cancelled: !!ev.isCancelled, tentative: tentative,
      unsure: tentative || /^tentative$/i.test(ev.showAs || ''), proposed: proposed,
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
    return '<li class="vmail-event' + (v.clash ? ' vmail-event--clash' : '') + (v.cancelled ? ' vmail-event--cancelled' : '') +
      (v.proposed ? ' vmail-event--proposed' : v.unsure ? ' vmail-event--tentative' : '') + '">' +
      '<span class="vmail-event__time">' + h(timeRange(v)) + '</span>' +
      '<span class="vmail-event__title">' + h(v.ev.subject || '(no title)') + '</span>' + notes.join(' ') + '</li>';
  }
  function dayName(ms) { try { return new Date(ms).toLocaleDateString('en-US', { weekday: 'long' }); } catch (e) { return ''; } }
  function dayBuckets() {
    var start = S.calBase ? new Date(S.calBase) : new Date(); start.setHours(0, 0, 0, 0);
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
  function todayHtml() {
    if (S.calendar.loading) return '<p class="vmail-quiet">Loading your calendar…</p>';
    if (S.calendar.error) return '<p class="vmail-quiet">Couldn\'t load your calendar.</p><button type="button" class="ap-btn vmail-btn-sm" data-act="calendar">Try again</button>';
    var d = dayBuckets();
    function day(name, views, empty) {
      return '<div class="vmail-day"><div class="vmail-day__name">' + name + '</div>' +
        (views.length ? '<ul class="vmail-events">' + views.map(eventHtml).join('') + '</ul>' : '<p class="vmail-quiet">' + empty + '</p>') + '</div>';
    }
    if (S.calBase) {
      var d1 = dayName(S.calBase), d2 = dayName(S.calBase + 86400000 + 3600000);
      return day(h(d1), d.today, 'No meetings ' + h(d1) + '.') + day(h(d2), d.tomorrow, 'Nothing booked ' + h(d2) + '.') +
        (S.workHours ? '' : '<p class="vmail-quiet">Set your day-job hours on the Office page so ' + h(S.agent) + ' can flag clashes.</p>');
    }
    return day('Today', d.today, 'No meetings today.') + day('Tomorrow', d.tomorrow, 'Nothing booked tomorrow.') +
      (S.workHours ? '' : '<p class="vmail-quiet">Set your day-job hours on the Office page so ' + h(S.agent) + ' can flag clashes.</p>');
  }
  // The rail (wide screens) and the schedule sheet (below 1100px) show the same thing.
  function renderToday() {
    var html = todayHtml();
    $('vmail-today-body').innerHTML = html;
    var sheet = $('vmail-schedule-body');
    if (sheet) sheet.innerHTML = html;
  }
  function openSchedule() {
    var d = $('vmail-schedule');
    if (!d || d.open) return;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    var close = $('vmail-schedule-close');
    if (close) close.focus();
  }
  function closeSchedule() {
    var d = $('vmail-schedule');
    if (!d || !d.open) return;
    if (typeof d.close === 'function') d.close(); else { d.removeAttribute('open'); $('vmail-nextup').focus(); }
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
    var lead = S.calBase ? dayName(S.calBase) + ': ' : (v.startMs <= t ? 'Now: ' : 'Next: ');
    el.classList.toggle('vmail-nextup--clash', v.clash);
    el.innerHTML = '<i class="fas fa-calendar-day" aria-hidden="true"></i>' +
      '<span class="vmail-nextup__title">' + h(lead) +
      '<strong>' + h(v.allDay ? 'All day' : C.formatTime(v.startMs)) + ' ' + h(v.ev.subject || '(no title)') + '</strong>' +
      (v.clash ? ' · in your day-job hours' : '') + '</span>' +
      '<span class="vmail-nextup__more">' + (rest ? '+' + rest + ' more' : 'Schedule') + '<i class="fas fa-chevron-right" aria-hidden="true"></i></span>';
    el.setAttribute('aria-label', 'Open your schedule. ' + lead + (v.allDay ? 'All day' : C.formatTime(v.startMs)) + ' ' + (v.ev.subject || '(no title)') + (rest ? ', and ' + rest + ' more ' + (S.calBase ? 'that day' : 'today') : ''));
    el.hidden = false;
  }

  // ── Reader ─────────────────────────────────────────────────────────────────

  function greeting() { return C.greetingFor(new Date().getHours()); }
  function renderGreetingIfIdle() { if (!S.open) renderReader(); }

  function renderReader() {
    var r = $('vmail-reader');
    var o = S.open;
    // Compose has no message tools: on wide screens its empty toolbar strip is hidden (CSS).
    r.classList.toggle('vmail-reader--compose', !!(o && o.compose));
    if (!o && S.search) {
      // A search is showing: the reader stays quiet instead of greeting or showing an old email.
      // Same empty-state look (and height) as the list beside it.
      r.innerHTML = '<div class="vmail-empty vmail-empty--reader"><i class="fa-regular fa-envelope-open" aria-hidden="true"></i><span class="vmail-empty__title">Nothing selected</span></div>';
      return;
    }
    if (!o) {
      var L = list('inbox');
      var c = inboxCounts();
      var first = (S.me.displayName || '').split(' ')[0];
      var line;
      if (!L.loaded && !L.error) line = S.agent + ' is opening your inbox…';
      else if (L.error) line = 'Your inbox didn\'t load. Use Try again on the left.';
      else if (c.needs_you) line = c.needs_you + (c.needs_you === 1 ? ' email needs you' : ' emails need you') + (c.waiting ? ', and ' + c.waiting + (c.waiting === 1 ? ' thread is' : ' threads are') + ' waiting on others.' : '.');
      else line = 'Nothing needs you right now.' + (c.waiting ? ' ' + c.waiting + ' waiting on others.' : '');
      // No list yet (loading or failed): no move/open/archive hints with nothing to act on, and
      // a plain hello instead of a cheerful time-of-day greeting over an error.
      var noList = !L.items.length && (!L.loaded || !!L.error);
      r.innerHTML = '<div class="vmail-hello">' +
        '<span class="vmail-avatar vmail-avatar--agent vmail-avatar--lg" aria-hidden="true">' + h(S.agent.charAt(0)) + '</span>' +
        '<h2 class="vmail-hello__title">' + h((L.error && !L.items.length ? 'Hi' : greeting()) + (first ? ', ' + first : '')) + '.</h2>' +
        '<p class="vmail-hello__text">' + h(line) + '</p>' +
        (c.needs_you ? '<button type="button" class="ap-btn vmail-btn-agent" data-act="start">Start with what needs you</button>' : '') +
        (noList ? '' : '<div class="vmail-hello__keys"><span><kbd>j</kbd><kbd>k</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>e</kbd> archive</span><span><kbd>?</kbd> all shortcuts</span></div>') +
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
    watchSubject();
  }

  function toolbarHtml(m) {
    var back = '<button type="button" class="vmail-tool vmail-back" id="vmail-back" aria-label="Back to the list"><i class="fas fa-arrow-left" aria-hidden="true"></i><span class="vmail-tool__label">Back</span></button>';
    if (!m) return '<div class="vmail-reader__bar">' + back + '</div>';
    var archived = m.parentFolderId === 'archive';
    var flagged = isFlagged(m);
    function tool(act, icon, label, key, extra) {
      return '<button type="button" class="vmail-tool' + (extra || '') + '" data-act="' + act + '" aria-label="' + h(label) + '" title="' + h(label) + (key ? ' (' + key + ')' : '') + '">' +
        '<i class="fas ' + icon + '" aria-hidden="true"></i><span class="vmail-tool__label">' + h(label) + '</span>' + (key ? '<kbd>' + key + '</kbd>' : '') + '</button>';
    }
    // A plain group of buttons (each its own Tab stop), so no toolbar arrow-key pattern is promised.
    return '<div class="vmail-reader__bar' + (S.subjectHidden ? ' vmail-toolbar--with-subject' : '') + '" role="group" aria-label="Email actions">' + back +
      (isMine(m) ? '' : tool('reply', 'fa-reply', 'Reply', 'r')) +
      (archived || isMine(m) ? '' : tool('archive', 'fa-box-archive', 'Archive', 'e')) +
      tool('flag', 'fa-flag', flagged ? 'Unflag' : 'Flag', 'f', flagged ? ' is-on' : '') +
      // Read/unread means nothing on your own sent mail.
      (isMine(m) ? '' : tool('unread', m.isRead ? 'fa-envelope' : 'fa-envelope-open', m.isRead ? 'Mark unread' : 'Mark read', 'u')) +
      '<span class="vmail-spacer"></span><span class="vmail-toolbar__subject" aria-hidden="true">' + h(m.subject || '(no subject)') + '</span></div>';
  }

  // Once the subject heading scrolls under the bar, the bar carries a compact copy of it.
  function watchSubject() {
    if (S.subjectObs) { S.subjectObs.disconnect(); S.subjectObs = null; }
    S.subjectHidden = false;
    var h1 = $('vmail-subject'), reader = $('vmail-reader');
    if (!h1 || typeof IntersectionObserver !== 'function') return;
    var bar = reader.querySelector('.vmail-reader__bar');
    if (bar) bar.classList.remove('vmail-toolbar--with-subject');
    var top = bar ? bar.offsetHeight : 46;
    S.subjectObs = new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      S.subjectHidden = !e.isIntersecting && e.boundingClientRect.top < (e.rootBounds ? e.rootBounds.top + top : top);
      var b = reader.querySelector('.vmail-reader__bar');
      if (b) b.classList.toggle('vmail-toolbar--with-subject', S.subjectHidden);
    }, { root: reader, rootMargin: '-' + top + 'px 0px 0px 0px', threshold: 0 });
    S.subjectObs.observe(h1);
  }

  // Re-rendering replaces the focused control; put focus back on its replacement (same data-act),
  // or on the fallback, never on <body>.
  function keepFocus(fn, fallback) {
    var a = document.activeElement;
    var inReader = a && a !== document.body && $('vmail-reader').contains(a);
    var act = inReader && a.getAttribute ? a.getAttribute('data-act') : null;
    fn();
    if (!inReader || $('vmail-reader').contains(document.activeElement)) return;
    var again = act && $('vmail-reader').querySelector('[data-act="' + act + '"]');
    focusQuiet(again || fallback || $('vmail-reader'));
  }
  function focusQuiet(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  // Vale panel: why it matters, who you are really replying to, thread facts, and what to do.
  // Only mail that asks something of Chad (Needs you, Unsure, or not sorted yet) gets answer
  // buttons; receipts, FYIs, newsletters and machines get "Nothing to answer here".
  var ASKABLE = { needs_you: 1, unsure: 1 };
  var QUIET_COPY = {
    receipt: 'A receipt. Nothing to answer here.',
    noise: 'Low priority. Nothing to answer here.',
    newsletter: 'A mailing list. Nothing to answer here.',
    fyi: 'Just so you know. Nothing to answer here.'
  };

  function automatedOpts() { return { me: S.me.mail || S.cfg.mailbox, agent: S.cfg.agent && S.cfg.agent.address }; }
  // Only provably internal mail is the agent's own (a From header alone is easy to fake).
  function isFromAgent(m) {
    var a = String((S.cfg.agent && S.cfg.agent.address) || '').toLowerCase();
    return !!a && addrOf(m.from).toLowerCase() === a && C.isInternal(m);
  }

  // Who-sent-it guards. Any of them means the only draft is one that verifies first.
  //   replyto: Reply-To differs from From · lookalike: looks like someone you've written to, but
  //   isn't · outside: claims your own domain but came from outside your organization.
  function guardFor(m) {
    if (!m || isMine(m)) return null;
    var rt = C.replyToMismatch(m);
    if (rt) return { kind: 'replyto', replyTo: rt };
    var look = C.senderMismatch(m, C.knownContacts(list('sentitems').items));
    if (look) return { kind: 'lookalike', from: look.from, known: look.known };
    var out = C.claimsOwnDomain(m, S.cfg.ownDomain);
    if (out) return { kind: 'outside', from: out.from };
    return null;
  }
  function msgTime(m) { return Date.parse((m && (m.receivedDateTime || m.sentDateTime)) || ''); }

  // Newer messages in the same conversation: { mine, theirs (newest not from Chad), latest }.
  function newerInThread(m) {
    var t = msgTime(m);
    if (!isFinite(t)) return null;
    var newer = thread(m).filter(function (x) { return x.id !== m.id && msgTime(x) > t; })
      .sort(function (a, b) { return msgTime(b) - msgTime(a); });
    if (!newer.length) return null;
    return { mine: newer.some(isMine), theirs: newer.filter(function (x) { return !isMine(x); })[0] || null, latest: newer[0] };
  }

  // After a send: the next email in the current list (where the answered one was), so working
  // through Needs you is one click per email.
  function nextAfterSend(m) {
    var items = visibleItems();
    var i = -1;
    for (var k = 0; k < items.length; k++) if (items[k].id === m.id) i = k;
    var start = i !== -1 ? i + 1 : Math.max(0, (S.sentFrom && S.sentFrom.id === m.id ? S.sentFrom.index : 0));
    var order = items.slice(start).concat(items.slice(0, start));
    for (var j = 0; j < order.length; j++) {
      var x = order[j];
      // A guarded email (lookalike, Reply-To, outside sender) is never offered as "Next": it
      // would borrow the trust of the email just answered.
      if (x.id !== m.id && !isMine(x) && !answeredAt(x) && x.conversationId !== m.conversationId && !guardFor(x)) return x;
    }
    return null;
  }

  function stanceBtn(st, s, dis, label, extraAttr) {
    var picked = s && s.stance === st && (!extraAttr || s.option === extraAttr);
    return '<button type="button" class="ap-btn vmail-btn-agent vmail-stance' + (picked ? ' is-picked' : '') + '" data-stance="' + st + '"' +
      (extraAttr ? ' data-option="' + h(extraAttr) + '"' : '') + ' aria-pressed="' + !!picked + '"' + dis + '>' +
      (picked ? '<i class="fas fa-check" aria-hidden="true"></i>' : '') + h(label) + '</button>';
  }

  function renderValeSlot() {
    var slot = $('vmail-vale-slot');
    if (!slot || !S.open || !S.open.msg) return;
    var m = S.open.msg;
    if (isMine(m)) { slot.innerHTML = sentPanelHtml(m); return; }
    var l = labelFor(m);
    var name = l && C.labelName(l.label);
    // "Sent. It's X's turn now." shows only right after the send; reopened later, the thread
    // reads like any other one waiting on them.
    var repliedAt = answeredAt(m);
    var answered = repliedAt && S.justSent === m.id ? repliedAt : null;
    var automated = C.isAutomated(m, automatedOpts());
    var guard = guardFor(m);
    var mismatch = guard && guard.kind === 'replyto' ? guard.replyTo : null;
    var newer = answered || guard ? null : newerInThread(m);
    // Only Chad has written since: it's their turn, so this reads as waiting on them.
    var theirTurn = (!!newer && !newer.theirs) || (!answered && !guard && !!repliedAt);
    if (theirTurn) newer = null;
    var askLabel = isFlagged(m) || !l || !!ASKABLE[l.label];
    var quiet = !answered && !guard && !newer && !theirTurn && (automated || (!askLabel && !!QUIET_COPY[l.label]));
    var first = C.firstName(m.from);

    var why;
    if (answered) why = '';
    else if (l && l.why && !sameAsLabel(l)) why = '<p class="vmail-vale__why">' + h(reasonOf(l)) + '</p>';
    else if (l && C.bucketOf(m, l) === 'newsletter') why = '<p class="vmail-vale__why">A mailing list you subscribe to.</p>';
    else if (l) why = '';
    else {
      var t = Date.parse(m.receivedDateTime || '');
      var after = S.triagedAt && isFinite(t) && t > Date.parse(S.triagedAt);
      why = '<p class="vmail-vale__why vmail-vale__why--quiet">' + h(copy('notSorted', 'Not sorted yet')) + '. ' +
        h(after ? 'This came in after ' + S.agent + '\'s last check' + (S.triagedAt ? (/^\d/.test(stampTime(S.triagedAt)) ? ' at ' : ' ') + stampTime(S.triagedAt) : '') + ', so there\'s no read on it yet.'
          : S.triagedAt ? 'It wasn\'t in ' + S.agent + '\'s last sort, so there\'s no guess here.'
          : S.agent + ' hasn\'t judged this one, so there\'s no guess here.') + '</p>';
    }

    var warn = '';
    if (mismatch) {
      var rt = mismatch.replyTo.map(function (r) { return r.address; }).join(', ');
      // The safe address (From) is the default; only an explicit choice replies to Reply-To.
      var useRt = useReplyTo(m);
      var safeSess = S.session && S.session.key === m.id && S.session.stance === 'verify';
      warn = '<div class="vmail-warn vmail-warn--replyto" role="note" id="vmail-replyto-warn"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><div>' +
        '<strong>Check who you\'re replying to.</strong> ' +
        h(copy('replyToWarning', 'Replies go to {replyTo}, not {from}.').replace('{replyTo}', rt).replace('{from}', mismatch.from.address)) +
        '<div class="vmail-warn__actions">' + (safeSess
          ? '<span>Your safe reply goes to ' + h(mismatch.from.address) + ', the sender\'s own address.</span>'
          : useRt
          ? '<span>Your reply will go to ' + h(rt) + ', not the sender\'s address.</span> <button type="button" class="ap-btn vmail-btn-sm" data-act="use-from">Reply to ' + h(mismatch.from.address) + ' instead</button>'
          : '<span>Your reply will go to ' + h(mismatch.from.address) + '.</span> <button type="button" class="ap-btn vmail-btn-sm" data-act="use-replyto">Use the Reply-To address</button>') +
        '</div></div></div>';
    } else if (guard && guard.kind === 'lookalike') {
      warn = '<div class="vmail-warn vmail-warn--sender" role="note" id="vmail-sender-warn"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><div>' +
        '<strong>Check who this is from.</strong> ' +
        h(copy('lookalikeWarning', 'This looks like {known}, but it\'s from {from}.').replace('{known}', guard.known).replace('{from}', guard.from)) + '</div></div>';
    } else if (guard && guard.kind === 'outside') {
      warn = '<div class="vmail-warn vmail-warn--sender" role="note" id="vmail-sender-warn"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><div>' +
        '<strong>Check who this is from.</strong> ' +
        h(copy('outsideWarning', 'This claims to be from {address} but came from outside your organization.').replace('{address}', guard.from)) + '</div></div>';
    }

    var facts = [];
    var th = C.threadText(C.threadStrip(thread(m), S.me), now());
    // A guarded email gets none of the familiarity lines ("2 from you", "You last wrote to …"):
    // the From header can be faked, and borrowed history makes a lure look routine.
    if (th && !guard) facts.push('<li><i class="fas fa-layer-group" aria-hidden="true"></i>' + h(th) + '</li>');
    // "Last time you spoke" and "waiting on you" mean nothing for newsletters and robots, and
    // repeat the send itself right after Chad answered.
    // A faked, lookalike or Reply-To sender: say where real mail comes from (or nothing), never
    // the real sender's history.
    var spoke = automated || answered ? '' : guard && guard.kind === 'lookalike'
      ? 'Real mail from ' + first + ' comes from ' + guard.known
      : guard && guard.kind === 'outside' ? 'Real ' + guard.from + ' mail comes from inside your organization'
      : guard ? '' : lastSpoke(m);
    if (spoke) facts.push('<li><i class="fas fa-clock-rotate-left" aria-hidden="true"></i>' + h(spoke) + '</li>');
    // No "Waiting on your reply" urgency on a guarded email either: it would press Chad to answer a lure.
    var waiting = guard || automated || answered || newer || theirTurn || !askLabel ? null : C.waitingOnYou(m, sentInThread(m), now(), { ownDomain: S.cfg.ownDomain });
    if (waiting) facts.push('<li class="is-urgent"><i class="fas fa-hourglass-half" aria-hidden="true"></i>' + h(waitingText(waiting.since)) + '</li>');

    var client = '';
    // Shown only next to a way to draft (see below): it is reassurance about drafting.
    if (isClientThread(m)) client = '<p class="vmail-notice vmail-notice--client"><i class="fas fa-shield-halved" aria-hidden="true"></i><span>' + h(copy('clientDraftNote', 'Client mail stays private: drafts use Claude only.')) + '</span></p>';
    else if (S.rulesFailed && !quiet) client = '<p class="vmail-notice"><i class="fas fa-shield-halved" aria-hidden="true"></i><span>' + h(copy('rulesFailedNotice', 'Couldn\'t load your client list, so drafts use Claude only for now.')) + '</span></p>';

    var s = S.session && S.session.key === m.id ? S.session : null;
    var busy = s && /^(drafting|countdown|sending)$/.test(s.m.state);
    var dis = busy ? ' disabled' : '';
    var group = '<div class="vmail-stances" role="group" aria-label="Answer with ' + h(S.agent) + '">';
    var ask;
    if (answered) {
      // The reply went out: the loop is closed. One line, and the way on to the next email.
      var nx = nextAfterSend(m);
      ask = '<div class="vmail-ask"><p class="vmail-question">Sent. It\'s ' + h(first) + '\'s turn now.</p><div class="vmail-stances">' +
        (nx ? nextBtn(nx, dis) : '') +
        '<button type="button" class="ap-btn vmail-btn-agent" data-act="reply"' + dis + '><i class="fas fa-reply" aria-hidden="true"></i>Write another reply</button></div></div>';
    } else if (guard) {
      // A different Reply-To, a lookalike sender or an outside email claiming your domain (often a
      // payment-change or sign-in lure): the only draft is one that verifies.
      var check = guard.kind === 'outside' ? 'Don\'t open links or sign in from this email. Check with the sender another way before you answer.'
        : 'Check with ' + first + ' another way (phone, known address) before you answer anything about money.';
      ask = '<div class="vmail-ask"><p class="vmail-question">' + h(check) + '</p>' +
        group + '<button type="button" class="ap-btn vmail-btn-agent" data-act="draft-safe"' + dis + '><i class="fas fa-shield-halved" aria-hidden="true"></i>Draft a safe reply</button></div>' +
        tellForm(dis) + '</div>';
    } else if (newer) {
      var target = newer.theirs || newer.latest;
      ask = '<div class="vmail-ask"><p class="vmail-question">' + (newer.mine ? 'You\'ve answered this thread since.' : 'There\'s a newer message in this thread.') + '</p>' +
        '<div class="vmail-stances"><button type="button" class="ap-btn vmail-btn-agent" data-act="open-latest" data-next="' + h(target.id) + '"><i class="fas fa-arrow-up" aria-hidden="true"></i>Open the latest</button></div></div>';
    } else if (quiet) {
      var line = isFromAgent(m) ? 'Your brief from ' + S.agent + '. Nothing to answer here.'
        : (l && QUIET_COPY[l.label]) || (C.bucketOf(m, null) === 'newsletter' ? QUIET_COPY.newsletter : 'An automated message. Nothing to answer here.');
      ask = '<div class="vmail-ask"><p class="vmail-question">' + h(line) + '</p><div class="vmail-stances">' +
        (m.parentFolderId === 'archive' ? '' : '<button type="button" class="ap-btn vmail-btn-agent" data-act="archive"><i class="fas fa-box-archive" aria-hidden="true"></i>Archive it</button>') +
        (automated ? '' : '<button type="button" class="ap-btn vmail-btn-agent" data-act="draft"' + dis + '><i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i>Draft a reply</button>') +
        '</div></div>';
    } else if (theirTurn || (l && l.label === 'waiting')) {
      var mine = sentInThread(m).sort(function (a, b) { return msgTime(b) - msgTime(a); })[0];
      ask = '<div class="vmail-ask"><p class="vmail-question">' + h(first) + ' hasn\'t answered' +
        (mine ? ' since you wrote ' + h(C.agoText(mine.sentDateTime || mine.receivedDateTime, now())) : ' yet') + '.</p>' +
        group + stanceBtn('nudge', s, dis, copy('stances.nudge', 'Draft a nudge')) + '</div>' + tellForm(dis) + '</div>';
    } else {
      var q = C.findQuestion(bodyText(m), m.subject);
      var kind = q ? C.questionKind(q) : null;
      var later = stanceBtn('later', s, dis, copy('stances.later', 'Later')) + stanceBtn('more', s, dis, copy('stances.more', 'Need more'));
      var btns;
      if (kind === 'yesno') btns = STANCES.map(function (st) { return stanceBtn(st, s, dis, copy('stances.' + st, st)); }).join('');
      else if (kind === 'choice') btns = C.choiceOptions(q).map(function (o) { return stanceBtn('choice', s, dis, o, o); }).join('') + later;
      else if (kind === 'open') btns = '<button type="button" class="ap-btn vmail-btn-agent vmail-stance" data-act="draft"' + dis + '><i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i>Draft an answer</button>' + later;
      else btns = stanceBtn('ack', s, dis, copy('stances.ack', 'Acknowledge')) +
        '<button type="button" class="ap-btn vmail-btn-agent vmail-stance" data-act="draft"' + dis + '><i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i>Draft a reply</button>';
      // A time the email proposes that falls in Chad's day-job hours: say so before he answers.
      var pt = q && S.workHours ? C.proposedTime(q, Date.parse(m.receivedDateTime || m.sentDateTime || ''), S.workHours.tz) : null;
      var dayJob = pt && C.workHoursClash(pt.startMs, pt.startMs + 30 * 60000, S.workHours)
        ? '<p class="vmail-notice vmail-notice--dayjob"><i class="fas fa-briefcase" aria-hidden="true"></i><span>' + h(pt.label) + ' is in your day-job hours.</span></p>' : '';
      ask = '<div class="vmail-ask">' +
        (q ? '<p class="vmail-question"><span class="vmail-question__who">' + h(first) + ' asks</span><q>' + h(q) + '</q></p>'
          : '<p class="vmail-question"><span class="vmail-question__who">No direct question found</span>Want to let ' + h(first) + ' know you saw it?</p>') +
        dayJob + group + btns + '</div>' + tellForm(dis) + '</div>';
    }

    // The client-mail note belongs next to a draft action only (stances, Tell Vale, Draft).
    if (!/data-stance=|data-act="draft|data-form="tell"/.test(ask || '')) client = '';
    slot.innerHTML = '<section class="vmail-vale" aria-label="' + h(S.agent) + '">' +
      '<div class="vmail-vale__head"><span class="vmail-avatar vmail-avatar--agent vmail-avatar--sm" aria-hidden="true">' + h(S.agent.charAt(0)) + '</span>' +
      '<div><span class="vmail-vale__name">' + h(S.agent) + '</span> <span class="vmail-vale__role">' + h((S.cfg.agent && S.cfg.agent.role) || '') + '</span></div>' +
      (name ? '<span class="vmail-tag vmail-tag--' + h(l.label === 'noise' ? 'newsletter' : l.label) + '">' + h(name) + '</span>' : '') + '</div>' +
      why + warn + (facts.length ? '<ul class="vmail-facts">' + facts.join('') + '</ul>' : '') + client + ask + '</section>';
    // The warning is a note (not an alert), announced once per opened email, not on every re-render.
    if (guard && S.warnAnnouncedFor !== m.id) {
      S.warnAnnouncedFor = m.id;
      announce(mismatch ? 'Check who you\'re replying to. Replies to this email are set to go to a different address than the sender\'s.'
        : 'Check who this is from. The sender may not be who they appear to be.');
    }
  }

  // Chad's own sent email: is it still waiting on them? Their reply (with a way to open it), or
  // how long it has gone unanswered with a nudge. Drafts get nothing.
  function sentPanelHtml(m) {
    var to = (m.toRecipients || [])[0];
    if (!to || !addrOf(to) || m.isDraft || m.parentFolderId === 'drafts') return '';
    var first = C.firstName(to);
    var t = msgTime(m);
    var later = thread(m).filter(function (x) { return x.id !== m.id && msgTime(x) > t; })
      .sort(function (a, b) { return msgTime(b) - msgTime(a); });
    var reply = later.filter(function (x) { return !isMine(x); })[0] || null;
    var followUp = later.filter(isMine)[0] || null;
    var facts = [];
    var th = C.threadText(C.threadStrip(thread(m), S.me), now());
    if (th) facts.push('<li><i class="fas fa-layer-group" aria-hidden="true"></i>' + h(th) + '</li>');
    var s = S.session && S.session.key === m.id ? S.session : null;
    var dis = s && /^(drafting|countdown|sending)$/.test(s.m.state) ? ' disabled' : '';
    var ask;
    if (reply) {
      ask = '<div class="vmail-ask"><p class="vmail-question">' + h(C.firstName(reply.from)) + ' replied ' +
        h(C.agoText(reply.receivedDateTime || reply.sentDateTime, now())) + '.</p>' +
        '<div class="vmail-stances"><button type="button" class="ap-btn vmail-btn-agent" data-act="open-latest" data-next="' + h(reply.id) + '"><i class="fas fa-arrow-up" aria-hidden="true"></i>Open the reply</button></div></div>';
    } else {
      var since = C.formatWhen(m.sentDateTime || m.receivedDateTime, now());
      if (since === 'Yesterday') since = 'yesterday';
      var line = followUp ? 'You followed up ' + C.agoText(followUp.sentDateTime || followUp.receivedDateTime, now()) + '. ' + first + ' hasn\'t replied yet.'
        : first + ' hasn\'t replied since ' + since + '.';
      ask = '<div class="vmail-ask"><p class="vmail-question">' + h(line) + '</p>' +
        '<div class="vmail-stances" role="group" aria-label="Answer with ' + h(S.agent) + '">' +
        stanceBtn('nudge', s, dis, copy('stances.nudge', 'Draft a nudge')) + '</div>' + tellForm(dis) + '</div>';
    }
    return '<section class="vmail-vale" aria-label="' + h(S.agent) + '">' +
      '<div class="vmail-vale__head"><span class="vmail-avatar vmail-avatar--agent vmail-avatar--sm" aria-hidden="true">' + h(S.agent.charAt(0)) + '</span>' +
      '<div><span class="vmail-vale__name">' + h(S.agent) + '</span> <span class="vmail-vale__role">' + h((S.cfg.agent && S.cfg.agent.role) || '') + '</span></div>' +
      (reply ? '' : '<span class="vmail-tag vmail-tag--waiting">' + h(C.labelName('waiting') || 'Waiting') + '</span>') + '</div>' +
      (facts.length ? '<ul class="vmail-facts">' + facts.join('') + '</ul>' : '') + ask + '</section>';
  }

  // The post-send way on: the label truncates (full text in the tooltip and accessible name).
  function nextBtn(nx, dis) {
    var label = 'Next: ' + C.firstName(nx.from) + ' · ' + (nx.subject || '(no subject)');
    return '<button type="button" class="ap-btn vmail-btn-agent vmail-next" data-act="next" data-next="' + h(nx.id) + '" title="' + h(label) + '" aria-label="' + h(label) + '"' + dis + '>' +
      '<span class="vmail-next__label">' + h(label) + '</span><i class="fas fa-arrow-right" aria-hidden="true"></i></button>';
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
      // Shimmer chips where the attachment chips will land, on the strip's own edge.
      html += '<div class="vmail-attachments vmail-attachments--loading" role="status"><span class="vmail-visually-hidden">Loading attachments</span>' +
        '<span class="vmail-attskel" aria-hidden="true"></span><span class="vmail-attskel" aria-hidden="true"></span></div>';
    } else if (o.attsError) {
      html += '<p class="vmail-quiet">Couldn\'t load the attachments. <button type="button" class="ap-btn vmail-btn-sm" data-act="atts">Try again</button></p>';
    }
    slot.innerHTML = html;
    // Plain mail (text, or HTML that is only paragraphs) reads on the app's own surface; the
    // white sandboxed frame is kept for real HTML mail.
    if (!isHtml || C.isSimpleHtml(m.body && m.body.content)) {
      var plain = document.createElement('div');
      plain.className = 'vmail-plainbody' + (isHtml ? ' vmail-plainbody--html' : '');
      var quote = '', quoteNodes = null;
      if (!isHtml) {
        // Plain-text history ("On … wrote:" / "> …") folds away behind a small toggle.
        var parts = C.splitQuoted(String((m.body && m.body.content) || ''));
        plain.textContent = parts.body;
        quote = parts.quote;
      } else if (!simpleHtmlInto(plain, m.body.content)) { plain.className = 'vmail-plainbody'; plain.textContent = C.htmlToText(m.body.content); }
      else quoteNodes = splitSimpleQuote(plain);
      if (quote || quoteNodes) {
        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'vmail-quotetoggle';
        toggle.setAttribute('data-act', 'quote');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', 'vmail-quote');
        toggle.setAttribute('aria-label', 'Show earlier messages');
        toggle.title = 'Show earlier messages';
        toggle.textContent = '···';
        var q = document.createElement('div');
        q.className = 'vmail-plainbody__quote';
        q.id = 'vmail-quote';
        q.hidden = true;
        if (quoteNodes) {
          q.className += ' vmail-plainbody__quote--html';
          quoteNodes.forEach(function (n) { q.appendChild(n); });
        } else q.textContent = quote;
        plain.appendChild(toggle);
        plain.appendChild(q);
      }
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
    // Inline images still loading: placeholders (with their alt text) until the bytes arrive.
    var cidPending = !!o.attsLoading && /cid:/i.test(String(m.body.content || ''));
    frame.srcdoc = C.safeBodyDoc(body, !!o.showImages, o.inline || null, { cidPending: cidPending });
    slot.appendChild(frame);
  }

  // Text-structure HTML (isSimpleHtml: no attributes, links, images or styles) is rebuilt node by
  // node from an inert DOMParser document: only whitelisted elements and text nodes are copied,
  // never an attribute, so nothing in it can load or run. Returns false if parsing isn't available.
  var SIMPLE_KEEP = { DIV: 'div', P: 'p', BR: 'br', SPAN: 'span', B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', U: 'u',
    BLOCKQUOTE: 'blockquote', UL: 'ul', OL: 'ol', LI: 'li', HR: 'hr', H1: 'h3', H2: 'h3', H3: 'h4', H4: 'h4', H5: 'h4', H6: 'h4',
    PRE: 'pre', CODE: 'code', SMALL: 'small', SUB: 'sub', SUP: 'sup', FONT: 'span' };
  function simpleHtmlInto(target, html) {
    if (typeof DOMParser !== 'function') return false;
    var doc;
    try { doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html || ''), 'text/html'); } catch (e) { return false; }
    (function walk(from, to) {
      Array.prototype.forEach.call(from.childNodes, function (n) {
        if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.nodeValue)); return; }
        if (n.nodeType !== 1) return;
        var tag = SIMPLE_KEEP[n.tagName];
        if (!tag) { walk(n, to); return; }
        var el = document.createElement(tag);
        to.appendChild(el);
        walk(n, el);
      });
    })(doc.body, target);
    return true;
  }

  // HTML replies rebuilt on the app's surface: the quoted history (a <blockquote>, or an <hr> /
  // block whose text starts "From: … Sent:") is taken out so it can fold behind "···" like plain
  // text. Returns the removed top-level nodes, or null when there is no quote or nothing before it.
  function splitSimpleQuote(root) {
    var kids = Array.prototype.slice.call(root.childNodes);
    var headerAt = function (i) {
      var t = '';
      for (var j = i; j < kids.length && t.length < 400; j++) t += kids[j].textContent || '';
      t = t.replace(/^\s+/, '');
      return /^from:\s/i.test(t) && /\b(?:sent|date):/i.test(t.slice(0, 400));
    };
    var at = -1;
    for (var i = 0; i < kids.length && at === -1; i++) {
      var k = kids[i];
      if (k.nodeType !== 1) continue;
      if (k.tagName === 'BLOCKQUOTE') at = i;
      else if (k.tagName === 'HR' ? headerAt(i + 1) : headerAt(i)) at = i;
    }
    if (at <= 0) return null;
    var before = kids.slice(0, at).map(function (n) { return n.textContent || ''; }).join('');
    if (!before.trim()) return null;
    var out = kids.slice(at);
    out.forEach(function (n) { root.removeChild(n); });
    return out;
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
    if (S.justSent !== id) S.justSent = null;
    S.openId = id;
    S.selectedId = id;
    syncSelection();
    if (opts.show || isPhone()) setReading(true);
    var cached = findMsg(id);
    S.open = { id: id, loading: true };
    renderReader();
    if (opts.focusReader) focusQuiet($('vmail-reader'));
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
      if (opts.focusReader) focusQuiet($('vmail-reader'));
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

  // On a phone, opening an email is a page of its own: it gets a history entry, so the system
  // Back gesture returns to the list instead of leaving Vale Mail. Desktop is unchanged.
  function readerInHistory() { try { return !!(history.state && history.state.vmail === 'reader'); } catch (e) { return false; } }
  function setReading(on) {
    var main = $('vmail-main');
    var was = main.classList.contains('is-reading');
    main.classList.toggle('is-reading', !!on);
    try {
      // history.back() is async: while one is pending, the popstate handler re-adds the entry.
      if (on && !was && isPhone() && !readerInHistory() && !S.backPending) history.pushState({ vmail: 'reader' }, '');
      else if (!on && was && !S.popping && !S.backPending && readerInHistory()) { S.backPending = true; history.back(); }
    } catch (e) { /* history unavailable: the in-app back arrow still works */ }
  }
  function onPopState() {
    if (S.backPending) {
      // Our own in-app back landed. Reopened in the meantime: the reader gets its entry again.
      S.backPending = false;
      if ($('vmail-main').classList.contains('is-reading') && isPhone() && !readerInHistory()) {
        try { history.pushState({ vmail: 'reader' }, ''); } catch (e) { /* ignore */ }
      }
      return;
    }
    if (readerInHistory() || !$('vmail-main').classList.contains('is-reading')) return;
    S.popping = true;
    try { closeReader(); } finally { S.popping = false; }
  }

  function closeReader() {
    S.open = null;
    S.openId = null;
    S.justSent = null;
    S.openSeq++;
    setReading(false);
    renderReader();
    focusList();
  }

  // Focus the list without the browser's own jump-scroll (it hid the first row's sender line);
  // the active row is then brought into view only as far as needed.
  function focusList() {
    var l = $('vmail-list');
    try { l.focus({ preventScroll: true }); } catch (e) { l.focus(); }
    var cur = l.getAttribute('aria-activedescendant') && document.getElementById(l.getAttribute('aria-activedescendant'));
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  // ── Editor sessions (reply / compose) + send with Undo ────────────────────

  function newSession(key, mode, msg) {
    return {
      key: key, mode: mode, msgId: msg ? msg.id : null, conversationId: msg ? msg.conversationId : null,
      m: C.sendMachine(), text: '', lastVale: '', stance: null, byVale: false,
      // A nudge on Chad's own sent email goes to the people he wrote to, never back to himself.
      to: mode !== 'reply' ? [] : msg && isMine(msg)
        ? (msg.toRecipients || []).map(function (r) { return { name: (r.emailAddress && r.emailAddress.name) || '', address: addrOf(r).trim().toLowerCase() }; }).filter(function (r) { return r.address; })
        : C.replyTargets(msg), toText: '', subject: '', brief: '',
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
    // A fresh reply makes an earlier "Draft discarded" Undo stale: it would replace the new text.
    if (S.undoFn && S.undoFn.restoresSession) { clearTimeout(S.toastTimer); hideToast(); }
    var oldKey = S.session && S.session.key;
    S.session = newSession(key, mode, msg);
    refreshDraftMark(oldKey);
    return S.session;
  }

  function persist(s) {
    if (!s) return;
    // Only what Chad typed or edited is kept. An untouched Vale draft paraphrases the email, so
    // it is never written to storage (it can be drafted again in a click).
    var typed = s.text.trim() && !(s.byVale && s.text === s.lastVale) ? s.text : '';
    if (typed || s.toText || s.subject) saveTyped(s.key, { text: typed, toText: s.toText, subject: s.subject, byVale: s.byVale && !!typed });
    else clearTyped(s.key);
    refreshDraftMark(s.key);
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
    if (msg && s.stance === 'verify') {
      // The safe reply never goes where the guard pointed: From, or for a lookalike the real contact.
      var g = guardFor(msg);
      if (g && g.kind === 'lookalike') return [{ name: '', address: g.known }];
      if (g && g.kind === 'replyto') return [{ name: nameOf(msg.from), address: addrOf(msg.from) }];
    }
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
    return !!(msg && s.stance !== 'verify' && C.replyToMismatch(msg) && useReplyTo(msg));
  }
  // 'Amy Lee <amy@x.example>' keeps its address (the name never decides where mail goes);
  // anything else splits on commas, semicolons and spaces.
  function parseAddresses(text) {
    var out = [];
    String(text || '').split(/[,;]+/).forEach(function (part) {
      var angle = /^(.*)<([^>]*)>\s*$/.exec(part);
      if (angle) {
        var addr = angle[2].trim();
        if (addr) out.push({ name: angle[1].replace(/["']/g, '').trim(), address: addr });
        return;
      }
      part.split(/\s+/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (a) { out.push({ name: '', address: a }); });
    });
    return out;
  }
  var EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z0-9-]{2,}$/i;

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
      head = '<div class="vmail-editor__head"><span class="vmail-editor__to">Reply to <strong>' + h(to.map(function (r) { return r.name || r.address; }).join(', ') || 'no one') + '</strong> ' +
        h(to.map(function (r) { return '<' + r.address + '>'; }).join(', ')) + '</span>' +
        (toReplyToTarget(s) ? '<span class="vmail-warnchip"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>Not the sender\'s address</span>' : '') +
        (s.byVale ? '<span class="vmail-editor__by"><span class="vmail-avatar vmail-avatar--agent vmail-avatar--sm" aria-hidden="true">' + h(S.agent.charAt(0)) + '</span>Drafted by ' + h(S.agent) + ' · edit freely' + (S.demo ? '<span class="vmail-demochip">Demo draft</span>' : '') + '</span>' : '') + '</div>';
    } else {
      head = '<div class="vmail-editor__head"><span class="vmail-editor__to">From <strong>' + h(S.me.displayName || S.cfg.mailbox) + '</strong> ' + h('<' + (S.me.mail || S.cfg.mailbox) + '>') + '</span>' +
        (s.byVale ? '<span class="vmail-editor__by"><span class="vmail-avatar vmail-avatar--agent vmail-avatar--sm" aria-hidden="true">' + h(S.agent.charAt(0)) + '</span>Drafted by ' + h(S.agent) + ' · edit freely' + (S.demo ? '<span class="vmail-demochip">Demo draft</span>' : '') + '</span>' : '') + '</div>' +
        '<div class="vmail-editor__fields">' +
        '<label for="vmail-compose-to">To</label><input id="vmail-compose-to" class="ap-input" type="text" inputmode="email" autocomplete="off" placeholder="name@company.com" value="' + h(s.toText) + '"' + (locked ? ' disabled' : '') + '>' +
        (s.suggestTo && !s.toText.trim() && !locked ? '<p class="vmail-suggest" id="vmail-suggest-to"><button type="button" class="ap-btn vmail-btn-agent" data-act="use-suggest">Send to ' + h(s.suggestTo.name || s.suggestTo.address) + ' &lt;' + h(s.suggestTo.address) + '&gt;?</button></p>' : '') +
        '<label for="vmail-compose-subject">Subject</label><input id="vmail-compose-subject" class="ap-input" type="text" maxlength="300" autocomplete="off" value="' + h(s.subject) + '"' + (locked ? ' disabled' : '') + '>' +
        '<div class="vmail-compose__vale"><label for="vmail-compose-brief">' + h(copy('composeBriefLabel', 'Ask {agent} to draft it').replace('{agent}', S.agent)) + '</label><form class="vmail-tell" data-form="brief"><input id="vmail-compose-brief" class="ap-input" type="text" maxlength="500" autocomplete="off" placeholder="In a line, what should this email say?" value="' + h(s.brief) + '"' + (locked || drafting ? ' disabled' : '') + '>' +
        '<button type="submit" class="ap-btn vmail-btn-agent"' + (locked || drafting ? ' disabled' : '') + '>Draft with ' + h(S.agent) + '</button></form></div>' +
        '</div>';
    }
    var client = s.mode === 'reply' && S.open && S.open.msg && (isClientThread(S.open.msg) || !!S.rulesFailed);
    var enter = !s.shown;
    s.shown = true;
    slot.innerHTML = '<section class="vmail-editor' + (enter ? ' vmail-editor--enter' : '') + '" aria-label="' + (s.mode === 'reply' ? 'Your reply' : 'New email') + '">' + head +
      '<div class="vmail-editor__body">' +
      '<label class="vmail-visually-hidden" for="vmail-editor-text">Message</label>' +
      '<textarea id="vmail-editor-text" class="ap-input vmail-editor__text' + (drafting ? ' is-drafting' : '') + '" rows="8"' + (locked || drafting ? ' disabled' : '') +
      ' placeholder="' + (s.mode === 'reply' ? 'Write your reply, or pick an answer above and ' + h(S.agent) + ' drafts it.' : 'Write your email.') + '"></textarea>' +
      (drafting ? '<div class="vmail-drafting" role="status"><span class="vmail-drafting__dots" aria-hidden="true"><span></span><span></span><span></span></span>' + h(S.agent) + ' is drafting' + (client ? ' with Claude' : '') + '…</div>' : '') +
      '</div>' +
      '<div id="vmail-fill-slot">' + fillNoteHtml(s, drafting) + '</div>' +
      (s.mode === 'reply' ? '<p class="vmail-editor__note">The original email is quoted below your reply when it sends.</p>' : '') +
      (s.note ? '<p class="vmail-editor__note vmail-editor__note--ok">' + h(s.note) + '</p>' : '') +
      (s.error ? '<div class="vmail-editor__error" role="alert">' + h(s.error) + '</div>' : '') +
      '<div class="vmail-editor__actions">' +
      '<button type="button" class="ap-btn ap-btn--primary vmail-btn-send" id="vmail-send"' + (locked || drafting ? ' disabled' : '') + '><i class="fas fa-paper-plane" aria-hidden="true"></i>' + (st === 'failed' ? 'Try again' : 'Send') + '</button>' +
      '<button type="button" class="ap-btn" data-act="discard"' + (locked ? ' disabled' : '') + '>Discard</button>' +
      '<span class="vmail-spacer"></span><span class="vmail-editor__hint">' + h(S.cfg.undoSeconds || 10) + ' seconds to undo after Send</span>' +
      '</div></section>';
    $('vmail-editor-text').value = s.text;
    placeToast();
  }

  // Bracketed gaps a draft leaves for Chad ("[day]"): named under the editor as soon as they
  // are there, and Send stops on them until they are filled (or Chad picks Send anyway).
  function fillNoteHtml(s, drafting) {
    if (s.subjectBlocked && !drafting) {
      return '<p class="vmail-fill" id="vmail-fill-note"><i class="fas fa-pen-to-square" aria-hidden="true"></i><span>No subject yet. Add one, or Send anyway.</span>' +
        '<button type="button" class="ap-btn vmail-btn-sm" data-act="send-anyway">Send anyway</button></p>';
    }
    var gaps = drafting ? [] : C.findPlaceholders(s.text);
    if (!gaps.length) return '';
    return '<p class="vmail-fill" id="vmail-fill-note"><i class="fas fa-pen-to-square" aria-hidden="true"></i><span>Fill in ' +
      gaps.map(function (g) { return '<strong>' + h(g) + '</strong>'; }).join(', ') + ' before sending.</span>' +
      (s.fillBlocked ? '<button type="button" class="ap-btn vmail-btn-sm" data-act="send-anyway">Send anyway</button>' : '') + '</p>';
  }
  function renderFillNote(s) {
    var slot = $('vmail-fill-slot');
    if (!slot) return;
    if (!C.findPlaceholders(s.text).length) s.fillBlocked = false;
    var html = fillNoteHtml(s, s.m.state === 'drafting');
    if (slot.innerHTML !== html) slot.innerHTML = html;
  }
  function selectGap(gap) {
    var t = $('vmail-editor-text');
    if (!t || t.disabled) return;
    var i = t.value.indexOf(gap);
    try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); }
    if (i !== -1 && t.setSelectionRange) t.setSelectionRange(i, i + gap.length);
    revealEditor();
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
    // A plain notice (no Undo) would sit over the editor's buttons on a phone: clear it.
    dropPlainToast();
    S.openSeq++;
    S.openId = null;
    S.justSent = null;
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

  async function draftWithVale(stance, instruction, option) {
    var compose = S.open && S.open.compose;
    if (!compose && (!S.open || !S.open.msg)) return;
    // Chad's own sent email: only a follow-up (the nudge, or his own words) makes sense.
    if (!compose && isMine(S.open.msg) && stance !== 'nudge' && !instruction) return;
    var s = ensureSession(compose ? 'compose' : 'reply');
    if (!s) return;
    if (s.m.state === 'undone' || s.m.state === 'failed' || s.m.state === 'idle') s.m.next('edit');
    if (!s.m.can('draft')) return;
    var msg = compose ? null : S.open.msg;
    // A who-sent-it guard (Reply-To, lookalike, outside) only ever drafts the "I'll verify first"
    // answer, whatever was pressed.
    if (msg && guardFor(msg) && !instruction) stance = 'verify';
    // Choosing the safe reply also takes back an earlier "Use the Reply-To address".
    if (msg && stance === 'verify') delete S.replyTo[msg.id];
    var mine = s.text.trim() && s.text !== s.lastVale ? s.text : null;
    s.m.next('draft');
    s.stance = stance;
    s.option = option || null;
    s.error = null;
    s.note = '';
    renderEditorSlot();
    renderValeSlot();
    revealEditor();
    try {
      var text = await valeDraft(s, msg, stance, instruction, option);
      if (S.session !== s) return;
      s.m.next('drafted');
      s.text = text;
      s.lastVale = text;
      s.byVale = true;
      // Compose: a subject from the brief, only while Chad hasn't written one himself.
      if (compose) {
        var subNow = $('vmail-compose-subject');
        if (subNow) s.subject = subNow.value;
        if (!String(s.subject || '').trim()) s.subject = C.subjectFromBrief(instruction);
      }
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
  async function valeDraft(s, msg, stance, instruction, option) {
    var target = s.mode === 'reply' ? recipientsFor(s)[0] : parseAddresses(s.toText)[0];
    var first = C.firstName(target ? { name: target.name, address: target.address } : null);
    // Compose with an empty To: if the brief names exactly one person Chad has written to, greet
    // them and offer them as the recipient (one tap; To is never filled silently).
    if (s.mode === 'compose') {
      s.suggestTo = null;
      if (!target) {
        var named = C.contactFromBrief(instruction, C.knownContacts(list('sentitems').items).filter(function (p) { return p.address !== String(S.me.mail || '').toLowerCase(); }));
        if (named) { s.suggestTo = named; first = named.first; }
      }
    }
    var mismatch = !!(msg && guardFor(msg));
    if (S.demo) {
      await sleep(450 + Math.round(Math.random() * 400));
      return window.ValeMailDemo.demoDraft(S.drafts, {
        id: msg && msg.id, stance: stance, instruction: instruction, option: option, firstName: first, mismatch: mismatch
      });
    }
    // A choice ("A or B?") goes to the API as Chad's own words.
    if (stance === 'choice') {
      instruction = 'Let\'s go with ' + String(option || '').trim() + '.' + (instruction ? ' ' + instruction : '');
      stance = null;
    }
    // Client lists that didn't load fail closed: Claude only.
    var rulesDomains = (S.rules && S.rules.rulesOnlyDomains) || [];
    var body;
    if (s.mode === 'reply') {
      // Client anywhere in the WHOLE conversation, not just the loaded pages: fetch it once. A
      // fetch that fails counts as client (fail closed).
      var conversation = null;
      if (msg.conversationId && typeof S.g.listConversation === 'function') {
        try { conversation = await S.g.listConversation(msg.conversationId); } catch (e) { conversation = null; }
      }
      var prior = thread(msg).filter(function (x) { return x.id !== msg.id; })
        .sort(function (a, b) { return String(b.receivedDateTime || b.sentDateTime).localeCompare(String(a.receivedDateTime || a.sentDateTime)); })
        .slice(0, 2).map(function (x) { return String(x.bodyPreview || ''); });
      body = {
        mode: 'reply', from: addrOf(msg.from), fromName: nameOf(msg.from), subject: String(msg.subject || ''),
        latest: bodyText(msg).slice(0, 6000), prior: prior, stance: stance || null, instruction: String(instruction || ''),
        to: (msg.toRecipients || []).concat(msg.ccRecipients || [], msg.replyTo || []).map(addrOf).filter(Boolean).slice(0, 50),
        // Client anywhere in the thread (earlier senders, Reply-To): Claude only. The server can
        // only escalate on this, never downgrade.
        client: C.draftClientFlag({ rulesFailed: !!S.rulesFailed, conversation: conversation, loaded: thread(msg), domains: rulesDomains }),
        mismatch: mismatch
      };
    } else {
      var toList = parseAddresses(s.toText);
      body = { mode: 'compose', from: '', fromName: '', subject: s.subject, latest: '', prior: [], stance: null, instruction: String(instruction || ''), to: toList.map(function (r) { return r.address; }).slice(0, 50),
        // Nobody on To yet: the brief may name a client, so fail closed (Claude only).
        // A half-typed address can't be checked either: same rule.
        client: !!S.rulesFailed || !toList.length || !toList.every(function (r) { return EMAIL_RE.test(r.address); }) || C.threadIsClient([{ toRecipients: toList.map(function (r) { return { emailAddress: r }; }) }], rulesDomains) };
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
    // No subject: stop before the countdown, put Chad in Subject, and offer Send anyway.
    if (s.mode === 'compose' && !String(s.subject || '').trim() && !s.sendAnyway) {
      s.subjectBlocked = true;
      s.error = null;
      renderEditorSlot();
      var subj = $('vmail-compose-subject');
      if (subj) { try { subj.focus({ preventScroll: true }); } catch (e) { subj.focus(); } }
      announce('No subject yet. Add one, or Send anyway.');
      return;
    }
    s.subjectBlocked = false;
    // A gap left for Chad ("[day]") never goes out by accident: stop, select it, and offer
    // Send anyway. No countdown starts.
    var gaps = C.findPlaceholders(s.text);
    var anyway = s.sendAnyway;
    s.sendAnyway = false;
    if (gaps.length && !anyway && !s.firstSendAt) {
      s.fillBlocked = true;
      s.error = null;
      renderEditorSlot();
      selectGap(gaps[0]);
      announce('Fill in ' + gaps.join(', ') + ' before sending, or choose Send anyway.');
      return;
    }
    s.fillBlocked = false;
    s.error = null;
    s.note = '';
    persist(s);
    if (s.mode === 'reply') {
      var vis = visibleItems();
      for (var vi = 0; vi < vis.length; vi++) if (vis[vi].id === s.msgId) S.sentFrom = { id: s.msgId, index: vi };
    }
    s.m.next('send');
    refreshDraftMark(s.key);
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
    refreshDraftMark(s.key);
    $('vmail-sendbar').hidden = true;
    setSending(false);
    $('vmail-sendbar-sr').textContent = 'Not sent.';
    s.note = 'Not sent. It\'s still here for you to edit.';
    if (S.open && (S.open.compose ? s.key === 'compose' : S.openId === s.key)) { renderEditorSlot(); renderValeSlot(); focusEditor(); }
    else toast('Not sent. Your reply is saved; open the email to finish it.');
  }

  // Only the Microsoft Graph calls decide "sent" or "not sent". Bookkeeping and re-rendering
  // happen after, so a UI error can never report a sent email as unsent (and invite a resend).
  async function finishSend(s) {
    // Undo is about to disappear: move focus off it first, never onto <body>.
    if (document.activeElement === $('vmail-undo-send')) focusQuiet($('vmail-reader'));
    s.m.next('elapse');
    showSendbar(s);
    $('vmail-sendbar-sr').textContent = 'Sending…';
    var to = s.sendTo || recipientsFor(s);
    if (!s.firstSendAt) s.firstSendAt = Date.now();
    var sendTried = false;
    try {
      var bodyHtml = '<div>' + C.textToHtml(s.text) + '</div>';
      if (s.mode === 'reply') {
        if (!s.draftId) {
          var d = await S.g.createReply(s.msgId);
          s.draftId = d.id;
          s.draftConv = d.conversationId || s.conversationId;
          s.quoted = (d.body && d.body.content) || '';
        }
        // Always set the recipients to exactly what the editor showed at Send, so what Chad saw is
        // who gets it (never whatever createReply or an earlier draft picked).
        await S.g.patchDraft(s.draftId, { bodyHtml: bodyHtml + s.quoted, toRecipients: to.map(function (r) { return r.address; }) });
      } else if (!s.draftId) {
        var nd = await S.g.createDraft({ to: to.map(function (r) { return r.address; }), subject: s.subject, bodyHtml: bodyHtml });
        s.draftId = nd.id;
        s.draftConv = nd.conversationId || null;
      } else {
        await S.g.patchDraft(s.draftId, { bodyHtml: bodyHtml, subject: s.subject, toRecipients: to.map(function (r) { return r.address; }) });
      }
      sendTried = true;
      await S.g.sendDraft(s.draftId);
    } catch (e) {
      // The send POST may have landed even though it timed out or answered 5xx: read the draft
      // back (isDraft false = it went). A 404 means the draft is gone: look in Sent.
      var outcome = 'retry';
      var probe = C.sendProbe(e);
      var probed = null;
      if (probe === 'message' && sendTried && s.draftId) {
        try { probed = await S.g.getMessage(s.draftId); } catch (x) { probed = null; }
        outcome = C.sendRecovery(e, null, s.firstSendAt, s.draftConv || s.conversationId, probed);
      } else if (probe === 'sent') {
        var sentItems = null;
        try { sentItems = (await S.g.listMessages({ folder: 'sentitems', top: 10 })).items || []; } catch (x) { sentItems = null; }
        outcome = C.sendRecovery(e, sentItems, s.firstSendAt, s.draftConv || s.conversationId);
      }
      if (outcome !== 'sent') {
        if (outcome === 'recreate') { s.draftId = null; s.quoted = ''; }
        sendFailed(s, e);
        return;
      }
    }
    afterSent(s, to);
  }

  // Focus may follow a finished send only when it was still on the send (reader, send bar, page).
  function focusWithSend() {
    var a = document.activeElement;
    return !a || a === document.body || $('vmail-reader').contains(a) || $('vmail-sendbar').contains(a);
  }
  function sameEmailOpen(s) {
    return !!(S.open && (s.mode === 'compose' ? S.open.compose : S.open.msg && S.open.msg.id === s.msgId));
  }

  function sendFailed(s, e) {
    s.m.next('fail');
    refreshDraftMark(s.key);
    $('vmail-sendbar').hidden = true;
    setSending(false);
    $('vmail-sendbar-sr').textContent = 'Not sent. Something went wrong.';
    s.error = copy('sendFailed', 'Not sent. Try again.') + ' ' + C.errorText(e).text;
    persist(s);
    if (S.session === s && S.open && (S.open.compose || S.openId === s.key)) {
      renderEditorSlot();
      renderValeSlot();
      if (focusWithSend()) focusQuiet($('vmail-send'));
    } else toast('Your reply didn\'t send. Open the email to try again.', null, 'error');
  }

  async function afterSent(s, to) {
    s.m.next('sent');
    s.firstSendAt = null;
    clearTyped(s.key);
    if (s.conversationId) S.replied[s.conversationId] = new Date().toISOString();
    // The "Sent. It's their turn" panel belongs to this moment only (see renderValeSlot).
    S.justSent = s.mode === 'reply' ? s.msgId : null;
    if (S.session === s) S.session = null;
    refreshDraftMark(s.key);
    s.m.next('reset');
    $('vmail-sendbar').hidden = true;
    $('vmail-sendbar-sr').textContent = 'Sent.';
    setSending(false);
    // The sent editor goes away first, whatever happens to the refresh below.
    var mayFocus = focusWithSend();
    var still = sameEmailOpen(s);
    try { if (still && !(S.open && S.open.compose)) renderEditorSlot(); } catch (x) { /* the refresh below re-renders */ }
    try {
      await loadFolder('sentitems');
      toast('Sent to ' + whoText(s, to) + '.');
      if (s.mode === 'compose' && S.open && S.open.compose) {
        S.open = null;
        setReading(false);
        renderReader();
        if (mayFocus) focusQuiet($('vmail-list'));
      } else if (still && S.open && S.open.msg) {
        renderEditorSlot();
        renderValeSlot();
        var r = $('vmail-reader');
        if (mayFocus) focusQuiet(r.querySelector('[data-act="next"]') || r.querySelector('[data-act="draft"],[data-act="reply"]') || r);
      }
      renderListPane();
      renderGreetingIfIdle();
    } catch (x) {
      // The email went; only the page didn't catch up.
      toast('Sent. The list didn\'t refresh.');
      if (mayFocus && still && !$('vmail-reader').contains(document.activeElement)) focusQuiet($('vmail-reader'));
    }
  }

  function discard() {
    var s = S.session;
    if (!s || sessionBusy()) return;
    var t = $('vmail-editor-text');
    if (t) s.text = t.value;
    clearTyped(s.key);
    S.session = null;
    clearTimeout(s.saveTimer);
    refreshDraftMark(s.key);
    if (S.open && S.open.compose) { S.open = null; setReading(false); renderReader(); focusQuiet($('vmail-list')); }
    else {
      renderEditorSlot();
      renderValeSlot();
      var r = $('vmail-reader');
      focusQuiet(r.querySelector('.vmail-vale [data-act="draft"],.vmail-vale [data-act="draft-safe"],.vmail-vale [data-stance]') || r.querySelector('[data-act="reply"]') || r);
    }
    if (s.text.trim()) {
      // Undo restores the session from memory: an unedited draft is never written to storage.
      var undoDiscard = function () {
        if (sessionBusy()) return;
        // Never overwrite a reply Chad has started since.
        var cur = S.session;
        var curT = $('vmail-editor-text');
        if (cur && curT) cur.text = curT.value;
        if (cur && cur.key === s.key && cur.text.trim()) { toast('You\'ve started a new reply, so the old draft wasn\'t restored.'); return; }
        if (s.mode === 'compose') {
          S.openSeq++;
          S.openId = null;
          S.selectedId = null;
          syncSelection();
          S.open = { compose: true };
          S.session = s;
          setReading(true);
          renderReader();
          persist(s);
          focusEditor();
          return;
        }
        if (S.openId === s.key && S.open && S.open.msg) {
          S.session = s;
          persist(s);
          renderEditorSlot();
          renderValeSlot();
          focusEditor();
        } else {
          persist(s);
        }
      };
      undoDiscard.restoresSession = true;
      toast('Draft discarded.', undoDiscard);
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
    var fromReader = $('vmail-reader').contains(document.activeElement);
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
      if (nextMsg && !isPhone()) openMessage(nextMsg.id, { focusReader: fromReader });
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
      // Anything Chad opens while the moves are in flight (a click, j/k) wins over the reopen.
      var seqAtUndo = S.openSeq;
      if (!(await moved)) return;
      try {
        await S.g.move(id, from);
        m.parentFolderId = from;
        A.items = A.items.filter(function (x) { return x.id !== id; });
        L.items.splice(Math.min(Math.max(idxAll, 0), L.items.length), 0, m);
        // The reader still on the email that replaced it (or closed): reopen the restored one, so
        // the selected row and the open email are the same message. Otherwise keep them matched.
        var untouched = S.openSeq === seqAtUndo;
        var reopen = wasOpen && !isPhone() && untouched && (!S.openId || (nextMsg && S.openId === nextMsg.id));
        var inReader = $('vmail-reader').contains(document.activeElement);
        S.selectedId = S.openId && !untouched ? S.openId : (reopen || !S.openId || isPhone() ? id : S.openId);
        renderListPane();
        renderFolders();
        if (reopen) openMessage(id, { focusReader: inReader });
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
      keepFocus(function () {
        var bar = $('vmail-reader').querySelector('.vmail-reader__bar');
        if (bar) bar.outerHTML = toolbarHtml(S.open.msg);
        renderValeSlot();
      });
    }
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  async function runSearch(raw) {
    var q = C.searchQuery(raw);
    if (!q) { clearSearch(); return; }
    dropPlainToast();
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
    // The reader never shows an email the results don't contain (unless Chad is mid-reply).
    var shown = S.open && S.open.msg && S.search.items.some(function (m) { return m.id === S.open.msg.id; });
    if (S.open && !S.open.compose && !shown && !(S.session && S.session.key === S.openId)) {
      S.open = null;
      S.openId = null;
      S.openSeq++;
      setReading(false);
    }
    renderListPane();
    renderReader();
  }

  function clearSearch() {
    S.search = null;
    S.searchSeq = (S.searchSeq || 0) + 1;
    $('vmail-search').value = '';
    renderFolders();
    renderListPane();
    if (!S.open) renderReader();
  }

  // ── Toast + help ───────────────────────────────────────────────────────────

  function toast(text, undo, kind) {
    if (!$('vmail-toast')) return; // a gate screen replaced the shell
    clearTimeout(S.toastTimer);
    S.undoFn = typeof undo === 'function' ? undo : null;
    $('vmail-toast-text').textContent = text + (S.undoFn && !isPhone() ? ' Press z to undo.' : '');
    $('vmail-toast-undo').hidden = !S.undoFn;
    $('vmail-toast').classList.toggle('vmail-toast--error', kind === 'error');
    $('vmail-toast').hidden = false;
    // Announced through the always-present live region: a region that appears with its text
    // already in it is often not read, and a repeated "Archived." would not be read again.
    announce($('vmail-toast-text').textContent);
    placeToast(true);
    S.toastTimer = setTimeout(hideToast, S.undoFn ? 8000 : 4500);
  }
  // Never over the editor's Send/Discard row: when it would be, the toast moves to the top of
  // the reading column (re-checked as the reader scrolls).
  // When a toast appears over the Send/Discard row, the reader scrolls that row clear (the article
  // keeps room under it). Only when the pane can't scroll that far does the toast move up to the
  // toolbar band, top right, clear of the subject. On scroll it only re-checks: it never scrolls
  // against Chad.
  // While a toast or the send bar shows, the reader gets room below its last line, so the
  // bottom of an email can always be scrolled clear of them.
  function syncToastPad() {
    var bar = $('vmail-sendbar'), t = $('vmail-toast'), r = $('vmail-reader');
    if (!r) return;
    var n = (bar && !bar.hidden ? 1 : 0) + (t && !t.hidden ? 1 : 0);
    r.classList.toggle('vmail-reader--toast-pad', n === 1);
    r.classList.toggle('vmail-reader--toast-pad2', n === 2);
  }
  function placeToast(onShow) {
    var t = $('vmail-toast');
    if (!t || t.hidden) return;
    t.classList.remove('vmail-toast--high');
    var row = document.querySelector('#vmail-reader .vmail-editor__actions');
    if (!row) return;
    var a = t.getBoundingClientRect(), b = row.getBoundingClientRect();
    var hit = b.height > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    if (hit && onShow) {
      var pane = $('vmail-reader');
      var need = Math.ceil(b.bottom - a.top) + 16;
      var room = pane.scrollHeight - pane.clientHeight - pane.scrollTop;
      if (room >= need) {
        pane.scrollTop += need;
        b = row.getBoundingClientRect();
        hit = a.top < b.bottom && b.top < a.bottom;
      }
    }
    t.classList.toggle('vmail-toast--high', hit);
  }
  function hideToast() { if (!$('vmail-toast')) return; $('vmail-toast').hidden = true; S.undoFn = null; }
  // A toast without Undo is about something already done: drop it when Chad moves on (search,
  // another folder, compose, the shortcut sheet) so it never reads as caused by the new screen.
  function dropPlainToast() { if ($('vmail-toast') && !$('vmail-toast').hidden && !S.undoFn) { clearTimeout(S.toastTimer); hideToast(); } }

  function openHelp() {
    var d = $('vmail-help');
    if (d.open) return;
    dropPlainToast();
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  function closeHelp() {
    var d = $('vmail-help');
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
  }

  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }

  // ── Events ─────────────────────────────────────────────────────────────────

  function wire() {
    // Every place that shows or hides the toast or send bar flips [hidden]: watch that one thing.
    if (typeof MutationObserver === 'function') {
      var padObs = new MutationObserver(syncToastPad);
      ['vmail-sendbar', 'vmail-toast'].forEach(function (id) { if ($(id)) padObs.observe($(id), { attributes: true, attributeFilter: ['hidden'] }); });
    }
    // The skip link is the page's first Tab stop: ahead of the site rail and sub-nav that
    // sidebar.js wraps around the page (it has already run by DOMContentLoaded).
    var skip = $('vmail-skip');
    if (skip && document.body.firstChild !== skip) document.body.insertBefore(skip, document.body.firstChild);
    skip.addEventListener('click', function (e) { e.preventDefault(); focusList(); });
    // A listbox always has an active option when it has focus: the first row, if nothing (or a
    // row no longer shown) is selected. Selecting is not opening, so nothing is marked read.
    // A click or tap picks its own row: only keyboard / programmatic focus selects the first one
    // (selecting on pointer focus would scroll the list under the pointer mid-click).
    // On touch the gesture's mousedown + focus come in a later task than pointerdown, so a 0 ms
    // flag was already cleared by then: remember WHEN a pointer last went down instead.
    S.listPointerAt = 0;
    ['pointerdown', 'mousedown', 'touchstart'].forEach(function (type) {
      $('vmail-list').addEventListener(type, function () { S.listPointerAt = Date.now(); }, { passive: true });
    });
    $('vmail-list').addEventListener('focus', function () {
      if (Date.now() - S.listPointerAt < 1000) return;
      var items = visibleItems();
      if (!items.length) return;
      var shown = S.selectedId && items.some(function (x) { return x.id === S.selectedId; });
      if (!shown) select(items[0].id);
    });
    // The ARIA listbox keys, only while the list itself has focus.
    $('vmail-list').addEventListener('keydown', function (e) {
      if (e.target !== $('vmail-list') || $('vmail-help').open || $('vmail-schedule').open) return;
      var k = C.listKeyFor(e);
      if (!k) return;
      e.preventDefault();
      if (k === 'next') move(1);
      else if (k === 'prev') move(-1);
      else if (k === 'first') moveTo(0);
      else moveTo(visibleItems().length - 1);
    });
    // The fades follow the row's real size: scrolling, the pane showing again after reading
    // (phones), and late-loading fonts all change what overflows.
    $('vmail-chips').addEventListener('scroll', chipEdges, { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(chipEdges).observe($('vmail-chips'));
    else window.addEventListener('resize', chipEdges);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(chipEdges, function () { /* ignore */ });
    $('vmail-list').addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (act) { handleAct(act.getAttribute('data-act'), act); return; }
      var jump = e.target.closest('[data-filter-jump]');
      if (jump) { setFilter(jump.getAttribute('data-filter-jump')); return; }
      var row = e.target.closest('[role="option"]');
      if (row) select(row.getAttribute('data-id'), { open: true, show: true });
    });
    $('vmail-more-slot').addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (act && !act.disabled) handleAct(act.getAttribute('data-act'), act);
    });
    $('vmail-chips').addEventListener('click', function (e) {
      var c = e.target.closest('[data-filter]');
      if (!c) return;
      var f = c.getAttribute('data-filter');
      setFilter(f);
      // A chip half under the fade comes fully into view once pressed.
      var on = $('vmail-chips').querySelector('[data-filter="' + cssEsc(f) + '"]');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    $('vmail-folders').addEventListener('click', function (e) {
      var f = e.target.closest('[data-folder]');
      if (f) setFolder(f.getAttribute('data-folder'));
    });
    $('vmail-folder-select').addEventListener('change', function (e) { setFolder(e.target.value); });
    $('vmail-search-form').addEventListener('submit', function (e) { e.preventDefault(); runSearch($('vmail-search').value); });
    $('vmail-search').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); clearSearch(); $('vmail-search').blur(); focusList(); }
    });
    $('vmail-search-clear').addEventListener('click', function () { clearSearch(); focusList(); });
    $('vmail-compose').addEventListener('click', startCompose);
    $('vmail-help-btn').addEventListener('click', openHelp);
    $('vmail-help-close').addEventListener('click', closeHelp);
    $('vmail-help').addEventListener('click', function (e) { if (e.target === $('vmail-help')) closeHelp(); });
    $('vmail-undo-send').addEventListener('click', undoSend);
    $('vmail-toast-undo').addEventListener('click', function () { var fn = S.undoFn; hideToast(); if (fn) fn(); });
    $('vmail-today-body').addEventListener('click', function (e) { if (e.target.closest('[data-act="calendar"]')) loadCalendar(); });
    $('vmail-nextup').addEventListener('click', openSchedule);
    $('vmail-schedule-close').addEventListener('click', closeSchedule);
    $('vmail-schedule').addEventListener('click', function (e) {
      if (e.target === $('vmail-schedule')) closeSchedule();
      else if (e.target.closest('[data-act="calendar"]')) loadCalendar();
    });
    // Esc or Close: focus goes back to the strip that opened the sheet.
    $('vmail-schedule').addEventListener('close', function () { var n = $('vmail-nextup'); if (n && !n.hidden) focusQuiet(n); });

    var reader = $('vmail-reader');
    reader.addEventListener('scroll', placeToast, { passive: true });
    reader.addEventListener('click', function (e) {
      if (e.target.closest('#vmail-back')) { closeReader(); return; }
      if (e.target.closest('#vmail-show-images')) { S.open.showImages = true; renderBodySlot(); return; }
      var att = e.target.closest('[data-att]');
      if (att) { download(att.getAttribute('data-att')); return; }
      var st = e.target.closest('[data-stance]');
      if (st && !st.disabled) { draftWithVale(st.getAttribute('data-stance'), '', st.getAttribute('data-option') || null); return; }
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
        renderFillNote(s);
      } else if (e.target.id === 'vmail-compose-to') {
        s.toText = e.target.value; persist(s);
        var sg = $('vmail-suggest-to');
        if (sg) sg.hidden = !!s.toText.trim();
      }
      else if (e.target.id === 'vmail-compose-subject') {
        s.subject = e.target.value; persist(s);
        if (s.subjectBlocked && s.subject.trim()) { s.subjectBlocked = false; renderFillNote(s); }
      }
      else if (e.target.id === 'vmail-compose-brief') { s.brief = e.target.value; }
    });
    reader.addEventListener('keydown', function (e) {
      if (e.target.id === 'vmail-editor-text' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); startSend(); }
      // Esc leaves the editor (the draft is kept, never discarded); a second Esc closes as usual.
      if (e.target.id === 'vmail-editor-text' && (e.key === 'Escape' || e.key === 'Esc') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        var es = S.session;
        if (es) { es.text = e.target.value; clearTimeout(es.saveTimer); persist(es); }
        var rd = $('vmail-reader');
        var spot = rd.querySelector('.vmail-vale .vmail-stance.is-picked:not([disabled])') || rd.querySelector('.vmail-vale .vmail-stance:not([disabled])') ||
          rd.querySelector('.vmail-reader__bar [data-act="reply"]:not([disabled])');
        focusQuiet(spot || rd);
      }
    });

    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPopState);
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
      case 'draft-safe': draftWithVale('verify', ''); break;
      case 'next':
      case 'open-latest': {
        var nid = el && el.getAttribute('data-next');
        if (nid) select(nid, { open: true, show: true, focusReader: true });
        break;
      }
      case 'archive': if (id) archive(id); break;
      case 'flag': if (id) setFlag(id, !isFlagged(S.open.msg)); break;
      case 'unread': if (id) setRead(id, !S.open.msg.isRead); break;
      case 'discard': discard(); break;
      case 'send-anyway': if (S.session) { S.session.sendAnyway = true; startSend(); } break;
      case 'quote': {
        var qd = $('vmail-quote');
        if (!qd) break;
        qd.hidden = !qd.hidden;
        el.setAttribute('aria-expanded', String(!qd.hidden));
        var ql = qd.hidden ? 'Show earlier messages' : 'Hide earlier messages';
        el.setAttribute('aria-label', ql);
        el.title = ql;
        break;
      }
      case 'use-from': if (id && !sessionBusy()) { delete S.replyTo[id]; renderValeSlot(); renderEditorSlot(); } break;
      case 'use-suggest': {
        var ss = S.session;
        if (!ss || ss.mode !== 'compose' || !ss.suggestTo || sessionBusy()) break;
        var toIn = $('vmail-compose-to');
        if (toIn) ss.toText = toIn.value;
        if (!ss.toText.trim()) ss.toText = ss.suggestTo.address;
        ss.suggestTo = null;
        persist(ss);
        renderEditorSlot();
        var nt = $('vmail-compose-subject');
        if (nt) focusQuiet(nt);
        break;
      }
      case 'use-replyto': if (id && !sessionBusy()) { S.replyTo[id] = 'replyto'; renderValeSlot(); renderEditorSlot(); } break;
      default: break;
    }
    return el;
  }

  // d: when Vale found a yes/no or either/or question, the answer buttons ARE the draft: a
  // stance-less draft would only be a placeholder. Focus the first one instead.
  function draftOrPick() {
    var r = $('vmail-reader');
    var group = r && r.querySelector('.vmail-vale .vmail-stances');
    var firstBtn = group && group.querySelector('.vmail-stance[data-stance="yes"]:not([disabled]),.vmail-stance[data-stance="choice"]:not([disabled])');
    if (firstBtn && S.open && S.open.msg && !guardFor(S.open.msg) && !(S.session && S.session.key === S.open.msg.id && S.session.text.trim())) {
      firstBtn.focus();
      var labels = Array.prototype.map.call(group.querySelectorAll('.vmail-stance[data-stance]'), function (b) { return b.textContent.trim(); }).filter(Boolean);
      announce('Pick an answer: ' + labels.join(', ') + '.');
      return;
    }
    draftWithVale(null, '');
  }

  function onKey(e) {
    if ($('vmail-help').open || $('vmail-schedule').open) return;
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
        if (S.selectedId && S.selectedId !== S.openId) openMessage(S.selectedId, { show: true }).then(function () { draftOrPick(); });
        else draftOrPick();
        break;
      case 'flag': { e.preventDefault(); var fm = findMsg(targetId()); if (fm) setFlag(fm.id, !isFlagged(fm)); break; }
      case 'unread': { e.preventDefault(); var um = findMsg(targetId()); if (um && !isMine(um)) setRead(um.id, !um.isRead); break; }
      case 'search': e.preventDefault(); dropPlainToast(); $('vmail-search').focus(); $('vmail-search').select(); break;
      case 'help': e.preventDefault(); openHelp(); break;
      case 'undo': {
        if (!S.undoFn || $('vmail-toast').hidden) return;
        e.preventDefault();
        var fn = S.undoFn;
        hideToast();
        fn();
        break;
      }
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
    var pick = false;
    try { pick = sessionStorage.getItem(PICK_ACCOUNT_KEY) === '1'; sessionStorage.removeItem(PICK_ACCOUNT_KEY); } catch (e) { /* ignore */ }
    var req = { scopes: S.cfg.graphScopes, extraScopesToConsent: [S.cfg.valeScope], loginHint: S.cfg.mailbox, state: 'vmail' };
    if (pick) req.prompt = 'select_account';
    S.msal.loginRedirect(req);
  }

  // Signs this tab out of Vale Mail only (clears MSAL's cache, no Microsoft sign-out), so Outlook
  // and the Office page stay signed in. Switch account goes straight to the account picker.
  async function signOut(thenSignIn) {
    try { sessionStorage.setItem(PICK_ACCOUNT_KEY, '1'); } catch (e) { /* ignore */ }
    try { if (S.msal) await S.msal.clearCache({ account: S.account }); } catch (e) { /* ignore */ }
    S.account = null;
    if (thenSignIn) { signIn(); return; }
    location.replace(location.pathname + '?signedout=1');
  }

  function renderAccount() {
    var box = $('vmail-account');
    if (!box) return;
    var who = S.account && S.account.username;
    box.hidden = S.demo || !who;
    if (!who) return;
    $('vmail-account-name').textContent = who;
    $('vmail-account-mail').textContent = who;
    $('vmail-account-btn').setAttribute('aria-label', 'Signed in as ' + who + '. Account menu');
  }
  function accountMenu(open) {
    var menu = $('vmail-account-menu'), btn = $('vmail-account-btn');
    if (!menu || menu.hidden === !open) return;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) $('vmail-account-switch').focus();
  }
  function wireAccount() {
    var box = $('vmail-account');
    if (!box) return;
    $('vmail-account-btn').addEventListener('click', function () { accountMenu($('vmail-account-menu').hidden); });
    $('vmail-account-switch').addEventListener('click', function () { signOut(true); });
    $('vmail-account-signout').addEventListener('click', function () { signOut(false); });
    box.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || $('vmail-account-menu').hidden) return;
      e.preventDefault(); e.stopPropagation();
      accountMenu(false);
      $('vmail-account-btn').focus();
    });
    document.addEventListener('click', function (e) { if (!box.contains(e.target)) accountMenu(false); });
    box.addEventListener('focusout', function (e) { if (e.relatedTarget && !box.contains(e.relatedTarget)) accountMenu(false); });
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
      var signedOut = q.get('signedout') === '1';
      gate(signedOut ? 'Signed out of ' + S.cfg.productName : 'Sign in to ' + S.cfg.productName, (q.get('signin') === 'error' ? 'Sign-in didn\'t finish. ' : '') +
        'Use your ' + S.cfg.mailbox + ' Microsoft account. ' + S.agent + ' reads and drafts here; nothing sends without you pressing Send.',
        '<button type="button" class="ap-btn ap-btn--primary" id="vmail-signin">Sign in with Microsoft</button>');
      $('vmail-signin').addEventListener('click', signIn);
      return false;
    }
    renderAccount();
    // Only the mailbox in the product config works here (Vale's API answers the CEO alone):
    // any other account gets one clear screen instead of a page of load errors.
    var who = String(S.account.username || '').toLowerCase();
    if (S.cfg.mailbox && who !== String(S.cfg.mailbox).toLowerCase()) {
      gate('Wrong account', 'You\'re signed in as ' + (S.account.username || 'another account') + '. ' +
        S.cfg.productName + ' only works with ' + S.cfg.mailbox + '.',
        '<button type="button" class="ap-btn ap-btn--primary" id="vmail-switch-gate">Switch account</button>');
      $('vmail-switch-gate').addEventListener('click', function () { signOut(true); });
      return false;
    }
    S.g = window.ValeGraphBrowser.createGraphClient({ fetch: window.fetch.bind(window), getToken: graphToken, timeZone: 'UTC' });
    // The signed-in account names Chad at once (the greeting's first paint); me() refreshes it.
    S.me = { displayName: S.account.name || '', mail: S.account.username || S.cfg.mailbox || '' };
    // Until the rules load, client-thread checks fail closed.
    S.rulesFailed = true;
    // Vale's judgments: latest triage (labels + reasons), rules, day-job hours. Read-only here.
    Promise.all([
      valeApi('/vale-state?key=valeMailState'),
      valeApi('/vale-state', { method: 'POST', body: JSON.stringify({ op: 'rules.get' }) }),
      valeApi('/vale-state?key=ceoProfile')
    ]).then(function (r) {
      var v = C.valeStateFrom(r);
      S.sortState = v.sortState;
      S.triagedAt = v.triagedAt;
      S.sortRaw = v.state;
      // Rules that didn't load fail closed: every draft goes Claude-only until they do.
      S.rules = v.rules;
      S.rulesFailed = v.rulesFailed;
      S.workHours = v.workHours;
      try { S.labels = C.triageLabels(v.state, list('inbox').items); } catch (e) { S.labels = {}; S.sortState = 'failed'; }
      renderStamp();
      renderListPane();
      renderToday();
      renderNextUp();
      if (S.open && S.open.msg) renderValeSlot(); else renderGreetingIfIdle();
    }).catch(function () {
      S.sortState = 'failed';
      S.rulesFailed = true;
      renderStamp();
      renderListPane();
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
    // A weekend has no day-job hours, so the demo would never show a clash: on Saturday and
    // Sunday its meetings move to the next weekday, and the rail names the days.
    var wd = n.getDay();
    S.calBase = null;
    if (wd === 6 || wd === 0) { n.setDate(n.getDate() + (wd === 6 ? 2 : 1)); S.calBase = n.getTime(); }
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
    if (fixture.me && typeof fixture.me.displayName === 'string') S.me = { displayName: fixture.me.displayName, mail: String(fixture.me.mail || '') };
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
    wireAccount();
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
    renderGreetingIfIdle();
    S.g.me().then(function (me) { S.me = me || S.me; renderGreetingIfIdle(); renderListPane(); }).catch(function () { /* greeting stays generic */ });
    loadFolder('inbox');
    loadFolder('sentitems');
    loadCalendar();
    if (location.hash === '#vmail-list') focusList();
    setInterval(function () { renderStamp(); renderNextUp(); }, 60000);
  }

  // Exposed for the E2E script and debugging only — holds no mail data.
  window.ValeMailClient = { version: 1 };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
