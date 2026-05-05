/* ============================================================
   bs-notifications.js
   Topbar notification bell + popover panel.
   IIFE on window.BsNotifications.

   Sources (all already exist in the codebase, no fabricated data):
     - Daily bounties incomplete: BsRewards.getDailyBounties()
     - Crates pending:            BsCrates.getCrates()
     - Async PvP unread:          BsState.progress.asyncInboxCount

   Public API:
     refresh()                    recompute counts, render badge + panel
     setCallbacks({...})          accept showScreen / renderLobby

   Refresh is called on bind, on bell open, and from renderLobby in
   blindspot-flow.js so the badge stays in sync as the player earns
   crates, completes bounties, or receives PvP results.
   ============================================================ */
(function () {
  'use strict';

  var _cb = {};
  var _bound = false;

  function setCallbacks(obj) { _cb = obj || {}; }

  function getCounts() {
    var bounties = 0, crates = 0, inbox = 0;
    try {
      var b = (window.BsRewards && window.BsRewards.getDailyBounties)
        ? window.BsRewards.getDailyBounties() : null;
      if (b && Array.isArray(b.bounties)) {
        bounties = b.bounties.filter(function (x) { return x && !x.done; }).length;
      }
    } catch (e) { /* ignore */ }
    try {
      var c = (window.BsCrates && window.BsCrates.getCrates)
        ? window.BsCrates.getCrates() : null;
      if (Array.isArray(c)) crates = c.length;
    } catch (e) { /* ignore */ }
    try {
      var ic = (window.BsState && window.BsState.progress && window.BsState.progress.asyncInboxCount) || 0;
      inbox = Number(ic) || 0;
    } catch (e) { /* ignore */ }
    return { bounties: bounties, crates: crates, inbox: inbox, total: bounties + crates + inbox };
  }

  function renderBadge(total) {
    var badge = document.getElementById('bs-topbar-bell-badge');
    if (!badge) return;
    if (total > 0) {
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.removeAttribute('hidden');
    } else {
      badge.setAttribute('hidden', '');
    }
  }

  function renderPanel(counts) {
    var list = document.getElementById('bs-topbar-notif-list');
    if (!list) return;
    var items = [];
    if (counts.bounties > 0) {
      items.push({
        icon: 'fa-list-check',
        text: counts.bounties + ' daily bount' + (counts.bounties === 1 ? 'y' : 'ies') + ' available',
        action: 'bounties'
      });
    }
    if (counts.crates > 0) {
      items.push({
        icon: 'fa-box',
        text: counts.crates + ' crate' + (counts.crates === 1 ? '' : 's') + ' waiting to open',
        action: 'crates'
      });
    }
    if (counts.inbox > 0) {
      items.push({
        icon: 'fa-envelope',
        text: counts.inbox + ' new PvP result' + (counts.inbox === 1 ? '' : 's'),
        action: 'inbox'
      });
    }
    if (items.length === 0) {
      list.innerHTML =
        '<div class="bs-topbar__notif-empty">' +
          '<i class="fas fa-circle-check" aria-hidden="true"></i>' +
          '<span>All caught up</span>' +
        '</div>';
      return;
    }
    list.innerHTML = items.map(function (it) {
      return '<button class="bs-topbar__notif-item" type="button" data-action="' + it.action + '">' +
             '<i class="fas ' + it.icon + ' bs-topbar__notif-icon" aria-hidden="true"></i>' +
             '<span class="bs-topbar__notif-text">' + it.text + '</span>' +
             '<i class="fas fa-chevron-right bs-topbar__notif-chev" aria-hidden="true"></i>' +
             '</button>';
    }).join('');

    // Wire item clicks. Each row navigates to the relevant screen and
    // closes the panel. Bounties + crates both live on the lobby so
    // they share the same destination (just make sure we are there).
    list.querySelectorAll('.bs-topbar__notif-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.getAttribute('data-action');
        setOpen(false);
        if (action === 'inbox' && _cb.showScreen) {
          _cb.showScreen('pvp');
        } else if (_cb.showScreen) {
          _cb.showScreen('lobby');
          if (_cb.renderLobby) _cb.renderLobby();
        }
      });
    });
  }

  function setOpen(open) {
    var btn = document.getElementById('bs-topbar-bell');
    var panel = document.getElementById('bs-topbar-notif-panel');
    if (!btn || !panel) return;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');
  }

  function bind() {
    if (_bound) return;
    var btn = document.getElementById('bs-topbar-bell');
    var panel = document.getElementById('bs-topbar-notif-panel');
    if (!btn || !panel) return;
    _bound = true;

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = btn.getAttribute('aria-expanded') === 'true';
      // On open, recompute fresh counts so the panel reflects current
      // state even if the lobby has not rendered since last change.
      if (!open) refresh();
      setOpen(!open);
    });

    document.addEventListener('mousedown', function (e) {
      if (btn.getAttribute('aria-expanded') !== 'true') return;
      if (btn.contains(e.target) || panel.contains(e.target)) return;
      setOpen(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (btn.getAttribute('aria-expanded') !== 'true') return;
      setOpen(false);
      btn.focus();
    });
  }

  function refresh() {
    bind();
    var counts = getCounts();
    renderBadge(counts.total);
    renderPanel(counts);
  }

  window.BsNotifications = {
    setCallbacks: setCallbacks,
    refresh: refresh
  };
})();
