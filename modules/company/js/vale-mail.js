// vale-mail.js — Microsoft sign-in + the Mail card on the Office page. Loaded only with
// ?vale=1 while Vale's mail access is being set up. Signs the CEO in with his
// ambientpixels.ai account (MSAL, redirect flow, sessionStorage) and exposes
// window.ValeAuth so office.html can send a verified bearer token to Vale's endpoints.
(function () {
  'use strict';

  var API = (window.CompanyStore && CompanyStore.getServerBase) ? CompanyStore.getServerBase() : '/api';
  var state = { cfg: null, msal: null, account: null, token: null };
  window.ValeAuth = { token: null, ready: null, getToken: getToken };

  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function when(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return iso; } }

  function card() {
    var el = document.getElementById('vale-mail-card');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'ap-panel';
    el.id = 'vale-mail-card';
    el.style.marginTop = '1.5rem';
    el.innerHTML = '<div class="ap-panel-header"><span class="ap-panel-title"><i class="fas fa-inbox"></i> Mail — Vale reads, never sends</span></div>' +
      '<div id="vale-mail-body" style="padding:var(--c-pad);">Loading…</div>';
    var grid = document.querySelector('.office-grid');
    if (grid && grid.parentNode) grid.parentNode.insertBefore(el, grid.nextSibling);
    else document.getElementById('office-main').appendChild(el);
    return el;
  }
  function body(html) { card(); document.getElementById('vale-mail-body').innerHTML = html; }

  function banner() {
    var q = new URLSearchParams(location.search);
    var c = q.get('connect');
    if (!c) {
      if (q.get('signin') === 'error') return '<div class="vale-banner" style="padding:.5rem .75rem;border-radius:6px;background:rgba(239,68,68,.12);color:#ef4444;margin-bottom:.75rem">Microsoft sign-in did not finish (' + h(q.get('reason') || 'unknown') + '). Try again.</div>';
      return '';
    }
    if (c === 'ok') return '<div class="vale-banner" style="padding:.5rem .75rem;border-radius:6px;background:rgba(52,211,153,.12);color:#34d399;margin-bottom:.75rem">Connected. Vale can now read your mail and calendar.</div>';
    return '<div class="vale-banner" style="padding:.5rem .75rem;border-radius:6px;background:rgba(239,68,68,.12);color:#ef4444;margin-bottom:.75rem">Connect didn\'t finish (' + h(q.get('reason') || 'unknown') + '). Try again.</div>';
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }

  async function getToken(interactive) {
    if (!state.msal || !state.account) {
      if (interactive && state.msal) await state.msal.loginRedirect({ scopes: [state.cfg.scope], loginHint: 'chad@ambientpixels.ai' });
      return null;
    }
    try {
      var r = await state.msal.acquireTokenSilent({ scopes: [state.cfg.scope], account: state.account });
      state.token = r.accessToken;
    } catch (e) {
      if (interactive) { await state.msal.acquireTokenRedirect({ scopes: [state.cfg.scope], account: state.account }); return null; }
      state.token = null;
    }
    window.ValeAuth.token = state.token;
    return state.token;
  }

  async function api(path, opts) {
    var t = await getToken(false);
    var headers = { 'Content-Type': 'application/json' };
    if (t) headers.Authorization = 'Bearer ' + t;
    var r = await fetch(API + path, Object.assign({ headers: headers }, opts || {}));
    var j = null; try { j = await r.json(); } catch (e) { j = null; }
    return { status: r.status, body: j || {} };
  }

  function rulesForm(rules) {
    rules = rules || {};
    function ta(id, label, list, hint) {
      return '<label style="display:block;margin-top:.5rem;font-size:.8rem;opacity:.8">' + h(label) + ' <span style="opacity:.6">' + h(hint) + '</span></label>' +
        '<textarea id="' + id + '" class="ap-input" rows="2" style="width:100%">' + h((list || []).join('\n')) + '</textarea>';
    }
    return '<details style="margin-top:1rem"><summary style="cursor:pointer">Sorting rules</summary>' +
      ta('vale-r-vips', 'Important people', rules.vips, 'one address or domain per line — always "needs you"') +
      ta('vale-r-muted', 'Muted', rules.muted, 'never shown as needing you') +
      ta('vale-r-rulesonly', 'Client domains (rules only)', rules.rulesOnlyDomains, 'sorted by rules alone, never sent to an AI model') +
      ta('vale-r-receipts', 'Receipt senders', rules.receipts, 'counted, not shown') +
      '<div style="margin-top:.5rem"><button class="ap-btn ap-btn--primary" id="vale-r-save">Save rules</button> <span id="vale-r-msg" style="font-size:.8rem;opacity:.7"></span></div></details>';
  }

  // Day-job hours (Pacific) — the brief flags client meetings inside them. days: 1=Mon … 7=Sun.
  var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function hoursForm(wh) {
    var days = (wh && wh.days) || [1, 2, 3, 4, 5];
    return '<div class="vale-hours">' +
      '<span class="vale-hours__label">Your day-job hours <span class="vale-hours__hint">(Pacific)</span></span>' +
      '<span class="vale-hours__days">' + DAY_NAMES.map(function (n, i) {
        return '<label class="vale-hours__day"><input type="checkbox" value="' + (i + 1) + '"' + (days.indexOf(i + 1) !== -1 ? ' checked' : '') + '> ' + n + '</label>';
      }).join('') + '</span>' +
      '<input type="time" class="ap-input" id="vale-h-start" value="' + h((wh && wh.start) || '') + '" aria-label="Start">' +
      '<span class="vale-hours__to">to</span>' +
      '<input type="time" class="ap-input" id="vale-h-end" value="' + h((wh && wh.end) || '') + '" aria-label="End">' +
      '<button class="ap-btn ap-btn--primary" id="vale-h-save">Save hours</button>' +
      '<span id="vale-h-msg" class="vale-hours__msg">' + (wh ? '' : 'Not set yet — the brief can\'t flag clashes.') + '</span></div>';
  }

  function lines(id) {
    return document.getElementById(id).value.split(/\n|,/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  async function render() {
    if (!state.account) {
      body(banner() + '<p>Sign in with your <strong>chad@ambientpixels.ai</strong> Microsoft account so Vale\'s pages only open for you.</p>' +
        '<button class="ap-btn ap-btn--primary" id="vale-signin">Sign in with Microsoft</button>');
      document.getElementById('vale-signin').onclick = function () { getToken(true); };
      return;
    }
    await getToken(false);
    var st = await api('/vale-connect/status');
    if (st.status === 503) { body(banner() + '<p>Signed in as ' + h(state.account.username) + '. Mail access isn\'t configured on the server yet — finish the setup checklist.</p>'); return; }
    if (st.status !== 200) { body(banner() + '<p>Couldn\'t load mail status (' + h(st.status) + ').</p>'); return; }

    var c = st.body.connection || {};
    var lb = st.body.lastBrief;
    var runs = st.body.recentRuns || [];
    var html = banner() +
      '<div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center">' +
      '<div><strong>' + (c.connected ? 'Connected' : (c.needsReconnect ? 'Needs reconnect' : 'Not connected')) + '</strong>' +
      (c.account ? ' · ' + h(c.account) : '') + '</div>' +
      '<div style="opacity:.75">Last brief sent: ' + (lb ? h(when(lb.at)) : 'never') + '</div>' +
      '<div style="margin-left:auto;display:flex;gap:.5rem;align-items:center">' + (c.connected
        ? '<button class="ap-btn" id="vale-disconnect">Disconnect</button>'
        : '<button class="ap-btn ap-btn--primary" id="vale-connect">' + (c.needsReconnect ? 'Reconnect' : 'Connect') + '</button>') + '</div></div>' +
      '<p style="font-size:.8rem;opacity:.7;margin-top:.5rem">Read-only: Vale can read mail and calendar; she can\'t send, delete or change anything. ' +
      'Chat answers use ' + h((state.cfg && state.cfg.chatProvider) || 'the fleet chat model') + '; client domains are never sent to a model.</p>';

    if (runs.length) {
      html += '<details style="margin-top:.75rem"><summary style="cursor:pointer">Recent runs</summary><table style="width:100%;font-size:.8rem;margin-top:.5rem">' +
        '<tr style="opacity:.6"><td>When</td><td>What</td><td>Messages</td><td>Events</td><td>OK</td></tr>' +
        runs.map(function (r) { return '<tr><td>' + h(when(r.at)) + '</td><td>' + h(r.run) + '</td><td>' + h(r.messages) + '</td><td>' + h(r.events) + '</td><td>' + (r.ok ? '✓' : '✗ ' + h(r.error || '')) + '</td></tr>'; }).join('') +
        '</table></details>';
    }
    var prof = await api('/vale-state?key=ceoProfile');
    html += prof.status === 200
      ? hoursForm(prof.body.value && prof.body.value.workHours)
      : '<p class="vale-hours__msg">Couldn\'t load your day-job hours (' + h(prof.status) + ').</p>';
    var rr = await api('/vale-state', { method: 'POST', body: JSON.stringify({ op: 'rules.get' }) });
    html += rulesForm(rr.body && rr.body.rules);
    body(html);

    var btn = document.getElementById('vale-connect');
    if (btn) btn.onclick = async function () {
      var s = await api('/vale-connect/start');
      if (s.body && s.body.url) location.href = s.body.url;
    };
    var dis = document.getElementById('vale-disconnect');
    if (dis) dis.onclick = async function () {
      if (!confirm('Disconnect Vale from your mailbox? Her stored access is deleted.')) return;
      await api('/vale-connect/disconnect', { method: 'POST' });
      render();
    };
    var hs = document.getElementById('vale-h-save');
    if (hs) hs.onclick = async function () {
      var msg = document.getElementById('vale-h-msg');
      var days = Array.prototype.map.call(document.querySelectorAll('.vale-hours__day input:checked'), function (c) { return Number(c.value); });
      var start = document.getElementById('vale-h-start').value, end = document.getElementById('vale-h-end').value;
      if (!days.length || !start || !end || start >= end) { msg.textContent = 'Pick at least one day and a start before the end.'; return; }
      var r = await api('/vale-state', { method: 'POST', body: JSON.stringify({ op: 'workHours.set', workHours: { days: days, start: start, end: end } }) });
      msg.textContent = r.status === 200 ? 'Saved.' : 'Not saved (' + r.status + ').';
    };
    document.getElementById('vale-r-save').onclick = async function () {
      var rules = Object.assign({}, rr.body && rr.body.rules, {
        vips: lines('vale-r-vips'), muted: lines('vale-r-muted'), rulesOnlyDomains: lines('vale-r-rulesonly'), receipts: lines('vale-r-receipts')
      });
      var r = await api('/vale-state', { method: 'POST', body: JSON.stringify({ op: 'rules.set', rules: rules }) });
      document.getElementById('vale-r-msg').textContent = r.status === 200 ? 'Saved.' : 'Not saved (' + r.status + ').';
    };
  }

  window.ValeAuth.ready = (async function () {
    card();
    try {
      var r = await fetch('/data/vale-config.json', { cache: 'no-store' });
      state.cfg = await r.json();
    } catch (e) { state.cfg = null; }
    if (!state.cfg || !state.cfg.clientId) {
      body(banner() + '<p>Mail isn\'t set up yet. Once the Vale app is registered in Microsoft 365, you\'ll sign in here with chad@ambientpixels.ai and click Connect.</p>');
      return;
    }
    await loadScript('/js/vendor/msal-browser.min.js');
    state.msal = new msal.PublicClientApplication({
      // Microsoft returns to a public page: coming back cross-site, the site's login cookie isn't sent and
      // the protected Office page would answer 401. /pages/vale-auth.html finishes and moves here.
      auth: { clientId: state.cfg.clientId, authority: 'https://login.microsoftonline.com/' + state.cfg.tenantId, redirectUri: location.origin + '/pages/vale-auth.html', navigateToLoginRequestUrl: false },
      cache: { cacheLocation: 'sessionStorage' }
    });
    await state.msal.initialize();
    var res = await state.msal.handleRedirectPromise().catch(function () { return null; });
    state.account = (res && res.account) || state.msal.getAllAccounts()[0] || null;
    if (state.account) await getToken(false);
    await render();
  })();
})();
