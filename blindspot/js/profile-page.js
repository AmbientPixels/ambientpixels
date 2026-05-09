/* ============================================================
   profile-page.js — Public profile renderer for /blindspot/profile.html
   Reads ?u={userId} from URL, fetches /api/blindspotprofileview, renders.
   No auth required to view; fetches the visitor's principal opportunistically
   so we can decorate their own profile with a "(this is you)" badge + edit link.
   ============================================================ */
(function () {
  'use strict';

  var TIMEOUT_MS = 12000;

  function $(id) { return document.getElementById(id); }
  function escHtml(s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : s); return d.innerHTML; }
  function show(el) { if (el) el.removeAttribute('hidden'); }
  function hide(el) { if (el) el.setAttribute('hidden', ''); }

  function getQueryParam(key) {
    var s = new URLSearchParams(window.location.search);
    return s.get(key);
  }

  // Visitor principal — only used to decide whether to show "(this is you)"
  // and the Edit CTA. Failure is non-fatal; profile page renders identically
  // for unauthed and other-player visitors.
  function fetchVisitorPrincipal() {
    return fetch('/.auth/me', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var arr = (data && data.clientPrincipal) ? [data.clientPrincipal] : (Array.isArray(data) ? data : []);
        var p = arr && arr[0];
        return (p && p.userId) ? p.userId : null;
      })
      .catch(function () { return null; });
  }

  function fetchProfile(userId) {
    var url = (window.buildApiPath ? window.buildApiPath('profileView', { userId: userId }) : ('/api/blindspotprofileview?userId=' + encodeURIComponent(userId)));
    return Promise.race([
      fetch(url).then(function (r) {
        if (r.status === 404) return r.json().then(function (j) { return { notFound: true, body: j }; });
        if (!r.ok) throw new Error('http_' + r.status);
        return r.json();
      }),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('timeout')); }, TIMEOUT_MS);
      })
    ]);
  }

  // Format helpers
  function relativeTime(iso) {
    if (!iso) return 'Never';
    var t = Date.parse(iso);
    if (isNaN(t)) return 'Never';
    var delta = Date.now() - t;
    if (delta < 0) return 'Just now';
    var sec = Math.floor(delta / 1000);
    if (sec < 60) return 'Just now';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    var day = Math.floor(hr / 24);
    if (day < 7) return day + 'd ago';
    if (day < 30) return Math.floor(day / 7) + 'w ago';
    if (day < 365) return Math.floor(day / 30) + 'mo ago';
    return '30d+ ago'; // privacy: dormant accounts capped, not surfaced precisely
  }

  function memberSince(iso) {
    if (!iso) return 'Member since —';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'Member since —';
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return 'Member since ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function winRate(wins, losses) {
    var total = (wins || 0) + (losses || 0);
    if (total === 0) return '—';
    return Math.round((wins / total) * 100) + '%';
  }

  function recordTilesHtml(p) {
    // Losses derived from totalWins + pvpRecord — campaign losses aren't
    // tracked separately on the public profile, so "Win Rate" uses the
    // PvP record as a stable proxy. PvE losses are intentionally hidden
    // (they'd surface every retry attempt and feel surveillance-y).
    var pvpW = (p.pvpRecord && p.pvpRecord.w) || 0;
    var pvpL = (p.pvpRecord && p.pvpRecord.l) || 0;
    var tiles = [
      { label: 'Wins',        value: p.totalWins, icon: 'fa-trophy' },
      { label: 'Best Streak', value: p.bestStreak, icon: 'fa-fire' },
      { label: 'Bosses',      value: p.highestBoss + '/10', icon: 'fa-skull' },
      { label: 'Ascension',   value: p.ascension > 0 ? ('Asc ' + p.ascension) : '—', icon: 'fa-arrow-up-from-bracket' },
      { label: 'PvP Record',  value: pvpW + 'W · ' + pvpL + 'L', icon: 'fa-chess-knight' },
      { label: 'PvP Win %',   value: winRate(pvpW, pvpL), icon: 'fa-percent' }
    ];
    return tiles.map(function (t) {
      return '<div class="bs-profile__record-tile">'
        + '<div class="bs-profile__record-icon"><i class="fas ' + t.icon + '" aria-hidden="true"></i></div>'
        + '<div class="bs-profile__record-value">' + escHtml(t.value) + '</div>'
        + '<div class="bs-profile__record-label">' + escHtml(t.label) + '</div>'
        + '</div>';
    }).join('');
  }

  function milestonesHtml(milestones) {
    if (!milestones || !milestones.length) return '';
    return milestones.map(function (m) {
      return '<div class="bs-profile__milestone' + (m.earned ? ' is-earned' : ' is-locked') + '">'
        + '<i class="fas ' + (m.earned ? 'fa-medal' : 'fa-lock') + '" aria-hidden="true"></i>'
        + '<span class="bs-profile__milestone-title">' + escHtml(m.title) + '</span>'
        + '<span class="bs-profile__milestone-threshold">' + escHtml(m.threshold) + '</span>'
        + '</div>';
    }).join('');
  }

  // Featured card chip — slim render (avatar + name + class + power +
  // rarity strip). Not the full BsCardRenderer; that requires bs-constants
  // + bs-cosmetics + ~5 other modules. Keep this page light.
  function featuredHtml(card, displayName) {
    if (!card) {
      return '<div class="bs-profile__featured-empty"><i class="fas fa-id-card" aria-hidden="true"></i> No card on display.</div>';
    }
    var stats = card.combatStats || {};
    var power = (Number(stats.str) || 0) + (Number(stats.agi) || 0) + (Number(stats.int) || 0) + (Number(stats.end) || 0) + (Number(stats.lck) || 0);
    var statBars = ['str', 'agi', 'int', 'end', 'lck'].map(function (k) {
      var v = Number(stats[k]) || 0;
      // CardForge editor produces 0-100 stats; legacy 0-20 stats also exist.
      // Auto-detect divisor by checking max — same heuristic as bs-card-renderer.
      var maxStat = Math.max.apply(null, ['str','agi','int','end','lck'].map(function (kk) { return Number(stats[kk]) || 0; }));
      var divisor = maxStat > 20 ? 100 : 20;
      var pct = Math.min(100, Math.round((v / divisor) * 100));
      return '<div class="bs-profile__stat-row">'
        + '<span class="bs-profile__stat-label">' + k.toUpperCase() + '</span>'
        + '<span class="bs-profile__stat-bar"><span class="bs-profile__stat-fill" style="width:' + pct + '%; background:var(--bs-stat-' + k + ', var(--blindspot-accent-gold));"></span></span>'
        + '<span class="bs-profile__stat-value">' + v + '</span>'
        + '</div>';
    }).join('');
    var avatar = card.avatar
      ? '<img src="' + escHtml(card.avatar) + '" alt="' + escHtml(card.name) + '" class="bs-profile__featured-avatar-img" loading="lazy">'
      : '<i class="fas fa-id-card bs-profile__featured-avatar-fallback" aria-hidden="true"></i>';
    var quote = card.quote ? '<p class="bs-profile__featured-quote">"' + escHtml(card.quote) + '"</p>' : '';
    return '<div class="bs-profile__featured-card bs-profile__featured-card--' + escHtml((card.rarity || 'common').toLowerCase()) + '">'
      + '<div class="bs-profile__featured-art">' + avatar + '</div>'
      + '<div class="bs-profile__featured-body">'
      +   '<div class="bs-profile__featured-name">' + escHtml(card.name) + '</div>'
      +   '<div class="bs-profile__featured-class">' + escHtml(card.class || '') + '</div>'
      +   '<div class="bs-profile__featured-stats">' + statBars + '</div>'
      +   '<div class="bs-profile__featured-power"><i class="fas fa-bolt" aria-hidden="true"></i> ' + power + ' POWER</div>'
      +   quote
      + '</div>'
      + '</div>';
  }

  function ctaRowHtml(p, isOwner, isAuthed) {
    if (isOwner) {
      // Owner: deep-link straight into the Fighter Profile screen via #stats
      // so they don't bounce through the lobby first. Honored by initPlay()
      // in blindspot-flow.js after the loading gate dismisses.
      return '<a class="bs-profile__cta" href="/blindspot/play.html#stats"><i class="fas fa-pen" aria-hidden="true"></i> Edit your profile</a>'
        + '<button class="bs-profile__cta bs-profile__cta--ghost" type="button" id="bs-profile-share-btn"><i class="fas fa-share-nodes" aria-hidden="true"></i> Copy share link</button>';
    }
    if (isAuthed) {
      return '<a class="bs-profile__cta" href="/blindspot/play.html"><i class="fas fa-trophy" aria-hidden="true"></i> View Leaderboard</a>'
        + '<button class="bs-profile__cta bs-profile__cta--ghost" type="button" id="bs-profile-share-btn"><i class="fas fa-share-nodes" aria-hidden="true"></i> Copy share link</button>';
    }
    // Unauthed visitor — sell the game.
    return '<a class="bs-profile__cta" href="/blindspot/"><i class="fas fa-fire" aria-hidden="true"></i> Forge your own card</a>'
      + '<a class="bs-profile__cta bs-profile__cta--ghost" href="/blindspot/play.html"><i class="fas fa-trophy" aria-hidden="true"></i> View Leaderboard</a>';
  }

  function applyAvatar(p) {
    var img = $('bs-profile-avatar-img');
    var fb = $('bs-profile-avatar-fallback');
    var url = p.profileImage || (p.featuredCard && p.featuredCard.avatar) || '';
    var fromProfile = !!p.profileImage;
    if (!url) {
      hide(img);
      show(fb);
      return;
    }
    img.src = url;
    img.alt = p.displayName + ' profile portrait';
    show(img);
    hide(fb);
    var t = fromProfile ? (p.profileImageTransform || { scale: 1, posX: 50, posY: 50 }) : { scale: 1, posX: 50, posY: 50 };
    img.style.objectPosition = (t.posX || 50) + '% ' + (t.posY || 50) + '%';
    img.style.transform = 'scale(' + (t.scale || 1) + ')';
  }

  function highestEarnedMilestone(milestones) {
    if (!milestones || !milestones.length) return null;
    var earned = milestones.filter(function (m) { return m.earned; });
    return earned.length ? earned[earned.length - 1] : null; // last in the canonical order = highest
  }

  function applyMetaTags(p) {
    var url = window.location.origin + '/blindspot/profile.html?u=' + encodeURIComponent(p.userId);
    var title = p.displayName + ' — Blindspot';
    var bossLine = p.highestBoss + '/10 bosses';
    var ascLine = p.ascension > 0 ? (' · Asc ' + p.ascension) : '';
    var desc = 'Lv ' + p.level + ' ' + (p.tierLabel || '') + ' · ' + p.totalWins + ' wins · ' + bossLine + ' · Peak ' + p.peakRank + ascLine;
    var image = p.profileImage || (p.featuredCard && p.featuredCard.avatar) || 'https://www.ambientpixels.ai/blindspot/img/og-blindspot.png';

    document.title = title;
    function set(id, attr, val) { var el = $(id); if (el) el.setAttribute(attr, val); }
    set('bs-profile-canonical', 'href', url);
    set('bs-og-url', 'content', url);
    set('bs-og-title', 'content', title);
    set('bs-og-desc', 'content', desc);
    set('bs-og-image', 'content', image);
    set('bs-tw-title', 'content', title);
    set('bs-tw-desc', 'content', desc);
    set('bs-tw-image', 'content', image);
  }

  function bindShareButton(url) {
    var btn = $('bs-profile-share-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(url).then(function () {
        var prev = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> Copied';
        setTimeout(function () { btn.innerHTML = prev; }, 1800);
      }).catch(function () {
        // Fallback for browsers without clipboard API
        prompt('Copy this link:', url);
      });
    });
  }

  function renderProfile(p, visitorUserId) {
    applyMetaTags(p);

    // Hero
    $('bs-profile-name').textContent = p.displayName;
    var subBits = ['Lv ' + p.level];
    if (p.tierLabel) subBits.push(p.tierLabel);
    if (p.ascension > 0) subBits.push('Prestige ' + p.ascension);
    $('bs-profile-sub').textContent = subBits.join(' · ');

    applyAvatar(p);

    // Badges
    if (p.peakRank && p.peakRank !== 'Iron') {
      var rb = $('bs-profile-rank-badge');
      rb.innerHTML = '<i class="fas fa-chess-knight" aria-hidden="true"></i> Peak ' + escHtml(p.peakRank);
      show(rb);
    }
    var topMilestone = highestEarnedMilestone(p.milestones);
    if (topMilestone) {
      var mb = $('bs-profile-milestone-badge');
      mb.innerHTML = '<i class="fas fa-medal" aria-hidden="true"></i> ' + escHtml(topMilestone.title);
      show(mb);
    }

    var isOwner = visitorUserId && visitorUserId === p.userId;
    var isAuthed = !!visitorUserId;
    if (isOwner) show($('bs-profile-you-badge'));

    // Record tiles
    $('bs-profile-record-grid').innerHTML = recordTilesHtml(p);

    // Featured card
    $('bs-profile-featured').innerHTML = featuredHtml(p.featuredCard, p.displayName);

    // Milestones
    $('bs-profile-milestones').innerHTML = milestonesHtml(p.milestones);

    // Meta strip
    $('bs-profile-member-since').textContent = memberSince(p.createdAt);
    $('bs-profile-last-active').textContent = 'Active ' + relativeTime(p.lastPlayedAt);
    $('bs-profile-cards-counts').textContent = (p.cardsForged || 0) + ' forged · ' + (p.cardsPublished || 0) + ' published';

    // CTA row
    $('bs-profile-cta-row').innerHTML = ctaRowHtml(p, isOwner, isAuthed);
    var shareUrl = window.location.origin + '/blindspot/profile.html?u=' + encodeURIComponent(p.userId);
    bindShareButton(shareUrl);

    hide($('bs-profile-loading'));
    show($('bs-profile-content'));
  }

  function showNotFound() {
    hide($('bs-profile-loading'));
    show($('bs-profile-not-found'));
  }
  function showError() {
    hide($('bs-profile-loading'));
    show($('bs-profile-error'));
  }

  function boot() {
    var userId = getQueryParam('u') || getQueryParam('userId');
    if (!userId || userId.length < 4) {
      showNotFound();
      return;
    }

    Promise.all([
      fetchProfile(userId),
      fetchVisitorPrincipal()
    ]).then(function (results) {
      var profileResult = results[0];
      var visitorUserId = results[1];
      if (profileResult && profileResult.notFound) {
        showNotFound();
        return;
      }
      if (!profileResult || !profileResult.ok || !profileResult.profile) {
        showError();
        return;
      }
      renderProfile(profileResult.profile, visitorUserId);
    }).catch(function (err) {
      console.error('[profile-page] load failed:', err);
      showError();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
