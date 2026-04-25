# My Published Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two new "My Published" tabs — one in the editor's Forge sidebar (cards), one in the deck builder (decks). Each lists what the signed-in user has published, supports unpublish + load-back-into-editor.

**Architecture:** Two new browser-side JS modules consume existing endpoints (`cardforgeloadcards`, `cardforgedeckload`, `cardforgedeletecard`, `cardforgedeckdelete`), filter by current user's `userId` parsed from the EasyAuth principal, render with the global `mini-card-scaler` pattern, and emit a custom event after publish/unpublish so cached views invalidate. **Zero backend work.**

**Tech Stack:** Vanilla JS (IIFE pattern, ES5-ish), Azure Static Web Apps EasyAuth, Azure Functions Node.js (consumed only), localStorage cache, FontAwesome icons. No tests — codebase has no automated test framework; verification is manual browser + curl per `CLAUDE.md`.

**Codebase notes (read first):**
- All site/API files live under `ambientpixels/`, not at repo root.
- Git repo is at `ambientpixels/.git`. Never `git init` at the parent.
- Cache-bust convention: `v=YYYYMMDD<letter>`. Plan uses fresh stamp `v=20260425a` (current letter sequence on 2026-04-24 burned through `t→u→y→z`).
- The `Skill` block for `cardforge` has a comprehensive recent-changes section worth a skim.
- Spec: [docs/superpowers/specs/2026-04-24-my-published-tabs-design.md](../specs/2026-04-24-my-published-tabs-design.md)

---

## File structure

### New files
- `cardforge/js/cardforge-published-events.js` — shared event constant + `getMyUserId()` helper. Loaded by both editor and deck builder. ~30 lines.
- `cardforge/js/cardforge-my-published-cards.js` — fetch + filter + cache + render + unpublish for the editor tab. ~180 lines.
- `cardforge/js/cardforge-my-published-decks.js` — same shape for the deck builder. ~190 lines.

### Modified files
- `cardforge/editor.html` — new `<button class="forge-sidebar-tab" data-forge-tab="published">` in the sidebar nav + new `<section class="forge-tab-content" data-forge-content="published">` panel. Also load the two new JS files. Cache-bust bump.
- `cardforge/deck.html` — load the new published-decks JS. Cache-bust bump.
- `cardforge/js/cardforge-deck-builder.js` — add `bootMyPublishedMode()`, route from `?view=published` and from a new tab toggle in the `db-bar`.
- `cardforge/js/cardforge-forge-actions.js` — dispatch `cardforge:my-published-changed` after `handlePublishCard()` and `publishDeck()` succeed; also after `removeGalleryDeck()`. Add a third branch in `bindForgeTabNavigation()` for `target === 'published'` so the publish nav button hides on that tab.
- `cardforge/css/cardforge-ui.css` — small additions for the new tab's action-button row and danger-styled unpublish button.
- `cardforge/css/cardforge-deck-builder.css` — small additions for the new view toggle in `db-bar`.

---

## Task 1 — Shared utility module

**Files:**
- Create: `c:/Dev/Ambientpixels/ambientpixels/cardforge/js/cardforge-published-events.js`

- [ ] **Step 1: Write the module**

Exact content:

```js
/**
 * CardForge — shared utilities for the "My Published" tabs.
 *
 * Exports two globals:
 *   window.CardForgePublished.EVENT  — custom event name
 *   window.CardForgePublished.getMyUserId() — async, returns userId or null
 *
 * Loaded by editor.html and deck.html. Safe to load twice (idempotent).
 */
(function () {
  'use strict';
  if (window.CardForgePublished) return;

  var EVENT_NAME = 'cardforge:my-published-changed';

  async function getMyUserId() {
    try {
      if (typeof window._cfGetAuthHeaders !== 'function') return null;
      var headers = await window._cfGetAuthHeaders();
      var json = headers && headers['X-CF-Auth-Principal'];
      if (!json) return null;
      var p = JSON.parse(json);
      return (p && p.userId) || null;
    } catch (_) { return null; }
  }

  function notifyChanged(detail) {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: detail || {} }));
    } catch (_) {}
  }

  window.CardForgePublished = {
    EVENT: EVENT_NAME,
    getMyUserId: getMyUserId,
    notifyChanged: notifyChanged
  };
})();
```

- [ ] **Step 2: Syntax check**

Run: `node --check c:/Dev/Ambientpixels/ambientpixels/cardforge/js/cardforge-published-events.js`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
cd c:/Dev/Ambientpixels/ambientpixels
git add cardforge/js/cardforge-published-events.js
git commit -m "feat(cardforge): shared utility module for My Published tabs

Adds window.CardForgePublished with EVENT name + getMyUserId() helper.
Idempotent — safe to load on both editor.html and deck.html.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — My Published Cards JS module

**Files:**
- Create: `c:/Dev/Ambientpixels/ambientpixels/cardforge/js/cardforge-my-published-cards.js`

- [ ] **Step 1: Write the module**

Exact content:

```js
/**
 * CardForge — "My Published" tab in the editor's Forge sidebar.
 *
 * Fetches /api/cardforgeloadcards, filters galleryCards by my userId,
 * renders into [data-forge-content="published"] section, supports
 * Load-into-editor (via cardForgeActions.loadCard) and Unpublish
 * (via cardforgedeletecard).
 *
 * Lazy-loads on first tab activation. Listens to
 * cardforge:my-published-changed and refreshes.
 */
(function () {
  'use strict';

  var API_LOAD_CARDS = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeloadcards';
  var API_DELETE_CARD = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgedeletecard';
  var CACHE_KEY = 'cf_my_published_cards_v1';

  var els = {};
  var state = { items: [], loaded: false, loading: false };

  function $(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return 'unknown';
    try { return new Date(iso).toLocaleDateString(); } catch (_) { return iso; }
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      return (p && Array.isArray(p.items)) ? p.items : null;
    } catch (_) { return null; }
  }

  function writeCache(items) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items: items })); }
    catch (_) {}
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  function matchesUser(c, userId) {
    if (!c || !userId) return false;
    var cd = c.cardData || c;
    return c.publishedBy === userId || cd.publishedBy === userId
        || c.userId === userId || cd.userId === userId;
  }

  async function fetchMyPublishedCards() {
    var myUserId = await window.CardForgePublished.getMyUserId();
    if (!myUserId) return { signedIn: false, items: [] };
    var headers = {};
    try { headers = await window._cfGetAuthHeaders(); } catch (_) {}
    var res;
    try {
      res = await fetch(API_LOAD_CARDS, {
        method: 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
      });
    } catch (_) { return { signedIn: true, items: [], error: 'network' }; }
    if (!res.ok) return { signedIn: true, items: [], error: 'http_' + res.status };
    var data = await res.json();
    var pool = Array.isArray(data && data.galleryCards) ? data.galleryCards : [];
    var mine = pool.filter(function (c) { return matchesUser(c, myUserId); });
    return { signedIn: true, items: mine, myUserId: myUserId };
  }

  function renderCardThumb(c) {
    var cd = c.cardData || c;
    if (cd.renderedFront && cd.frontClasses) {
      return '<div class="mini-card-scaler"><div class="' + escHtml(cd.frontClasses) + '">' + cd.renderedFront + '</div></div>';
    }
    var portrait = cd.avatar || c.avatar || '';
    return '<div class="cf-mini-fallback">' +
      '<div class="cf-mini-fallback__portrait" style="background-image: url(\'' + escHtml(portrait) + '\');"></div>' +
      '<div class="cf-mini-fallback__label"><span class="cf-mini-fallback__name">' + escHtml(cd.name || 'Card') + '</span></div>' +
    '</div>';
  }

  function render(result) {
    if (!els.list) return;
    if (els.count) els.count.textContent = result.signedIn ? String(result.items.length || '') : '';
    if (!result.signedIn) {
      els.list.innerHTML = '<div class="my-cards-empty"><i class="fas fa-right-to-bracket"></i><p>Sign in to see what you\'ve published.</p></div>';
      return;
    }
    if (result.error) {
      els.list.innerHTML = '<div class="my-cards-empty"><i class="fas fa-triangle-exclamation"></i><p>Couldn\'t load (' + escHtml(result.error) + ').</p><button type="button" class="forge-action-btn" id="cf-mpc-retry">Retry</button></div>';
      var retry = $('cf-mpc-retry');
      if (retry) retry.addEventListener('click', function () { refresh(true); });
      return;
    }
    if (!result.items.length) {
      els.list.innerHTML = '<div class="my-cards-empty"><i class="fas fa-share-from-square"></i><p>No published cards yet.</p><small>Publish from the editor\'s Ship tab.</small></div>';
      return;
    }
    els.list.innerHTML = result.items.map(function (c) {
      var cd = c.cardData || c;
      var name = cd.name || 'Untitled';
      var when = fmtDate(c.publishDate || cd.publishDate);
      var id = c.id || cd.id || '';
      return '' +
        '<div class="cf-mpc-row" data-card-id="' + escHtml(id) + '">' +
          '<div class="cf-mpc-thumb mini-card">' + renderCardThumb(c) + '</div>' +
          '<div class="cf-mpc-meta">' +
            '<div class="cf-mpc-name">' + escHtml(name) + '</div>' +
            '<div class="cf-mpc-sub">Published ' + escHtml(when) + '</div>' +
            '<div class="cf-mpc-actions">' +
              '<button type="button" class="forge-action-btn cf-mpc-load" data-action="load"><i class="fas fa-pen"></i> Edit</button>' +
              '<button type="button" class="forge-action-btn cf-mpc-unpub" data-action="unpub"><i class="fas fa-trash"></i> Unpublish</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  async function refresh(force) {
    if (state.loading) return;
    state.loading = true;
    try {
      // Render cache instantly if present.
      if (!force) {
        var cached = readCache();
        if (cached && cached.length) {
          state.items = cached;
          render({ signedIn: true, items: cached });
        }
      }
      var result = await fetchMyPublishedCards();
      state.loaded = true;
      state.items = result.items || [];
      if (result.signedIn && !result.error) writeCache(state.items);
      render(result);
    } finally { state.loading = false; }
  }

  function loadIntoEditor(cardId) {
    if (!cardId || !window.cardForgeActions) return;
    // Push the published card into _mergedCards so loadCard() can find it
    // even if it isn't in localStorage cardforge_saved_cards.
    var c = state.items.find(function (x) { return (x.id || (x.cardData && x.cardData.id)) === cardId; });
    if (c) {
      var actions = window.cardForgeActions;
      actions._mergedCards = actions._mergedCards || [];
      var existing = actions._mergedCards.find(function (x) { return x.id === cardId; });
      if (!existing) actions._mergedCards.push(c);
    }
    window.cardForgeActions.loadCard(cardId);
    // Switch back to My Cards tab so user sees they're now editing.
    var cardsTab = document.querySelector('.forge-sidebar-tab[data-forge-tab="cards"]');
    if (cardsTab) cardsTab.click();
  }

  async function unpublishCard(cardId) {
    if (!cardId) return;
    if (!confirm('Unpublish this card? It will be removed from the public gallery. Your saved card is not affected.')) return;
    var myUserId = await window.CardForgePublished.getMyUserId();
    if (!myUserId) { alert('Sign in required.'); return; }
    // Direct call to the Function App (cross-origin). SWA does NOT proxy POSTs
    // on rewrite routes (returns 405) and won't inject x-ms-client-principal —
    // so we pass userId in the body and use credentials:'omit'. Same pattern
    // as cardforgedeckdelete and the corrected hero-config admin flow.
    var res;
    try {
      res = await fetch(API_DELETE_CARD, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: cardId, userId: myUserId })
      });
    } catch (_) { alert('Network error — try again.'); return; }
    if (!res.ok) {
      var msg = 'Unpublish failed (' + res.status + ').';
      try { var b = await res.json(); if (b && b.error) msg = b.error; } catch (_) {}
      alert(msg);
      return;
    }
    state.items = state.items.filter(function (x) { return (x.id || (x.cardData && x.cardData.id)) !== cardId; });
    writeCache(state.items);
    render({ signedIn: true, items: state.items });
    window.CardForgePublished.notifyChanged({ kind: 'card', action: 'unpublish', id: cardId });
  }

  function bindActions() {
    if (!els.list) return;
    els.list.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var row = btn.closest('.cf-mpc-row');
      var id = row && row.getAttribute('data-card-id');
      if (!id) return;
      var action = btn.getAttribute('data-action');
      if (action === 'load') loadIntoEditor(id);
      else if (action === 'unpub') unpublishCard(id);
    });
  }

  function ensureBound() {
    els.tab = document.querySelector('.forge-sidebar-tab[data-forge-tab="published"]');
    els.section = document.querySelector('.forge-tab-content[data-forge-content="published"]');
    els.list = $('cf-mpc-list');
    els.count = $('cf-mpc-count');
    if (!els.tab || !els.section || !els.list) return false;
    if (els.tab._mpcBound) return true;
    els.tab._mpcBound = true;
    els.tab.addEventListener('click', function () {
      // Lazy-load on first activation, refresh on subsequent.
      refresh(false);
    });
    bindActions();
    window.addEventListener(window.CardForgePublished.EVENT, function () {
      clearCache();
      if (els.section.classList.contains('active')) refresh(true);
    });
    return true;
  }

  function init() {
    if (!ensureBound()) {
      // Editor markup may not be in the DOM yet — retry once after load.
      setTimeout(ensureBound, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

- [ ] **Step 2: Syntax check**

Run: `node --check c:/Dev/Ambientpixels/ambientpixels/cardforge/js/cardforge-my-published-cards.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd c:/Dev/Ambientpixels/ambientpixels
git add cardforge/js/cardforge-my-published-cards.js
git commit -m "feat(cardforge): My Published Cards module (editor sidebar)

Fetches galleryCards filtered by my userId, renders thumbnails with
Edit + Unpublish actions. Lazy-loads on tab click, caches in
localStorage, listens to cardforge:my-published-changed for invalidation.
Unpublish reuses POST /api/cardforgedeletecard (owner-gated). Edit
pushes the card into cardForgeActions._mergedCards then calls the
existing loadCard() flow.

Markup hookup + CSS in next tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — Editor markup + CSS for My Published Cards

**Files:**
- Modify: `c:/Dev/Ambientpixels/ambientpixels/cardforge/editor.html` (around line 1568, between My Cards and Deck Manager tabs; around line 1597, between My Cards and Deck Manager content panels; bottom of file for script load)
- Modify: `c:/Dev/Ambientpixels/ambientpixels/cardforge/css/cardforge-ui.css` (append at end)

- [ ] **Step 1: Add new sidebar tab button**

Open `editor.html`. Find the `My Cards` tab button block (around line 1563–1568), then the `Deck Manager` tab button right after it. Insert the new tab between them.

Old:
```html
              <button class="forge-sidebar-tab active" data-forge-tab="cards" aria-selected="true" tabindex="0" title="My Cards">
                <span class="tab-pip" id="my-cards-pip"></span>
                <i class="fas fa-layer-group"></i>
                <span class="tab-label">My Cards</span>
                <span class="tab-badge" id="my-cards-count"></span>
              </button>
              <button class="forge-sidebar-tab" data-forge-tab="deck" aria-selected="false" tabindex="-1" title="Deck Manager">
```

New (insert the My Published button between them):
```html
              <button class="forge-sidebar-tab active" data-forge-tab="cards" aria-selected="true" tabindex="0" title="My Cards">
                <span class="tab-pip" id="my-cards-pip"></span>
                <i class="fas fa-layer-group"></i>
                <span class="tab-label">My Cards</span>
                <span class="tab-badge" id="my-cards-count"></span>
              </button>
              <button class="forge-sidebar-tab" data-forge-tab="published" aria-selected="false" tabindex="-1" title="My Published Cards">
                <i class="fas fa-share-from-square"></i>
                <span class="tab-label">Published</span>
                <span class="tab-badge" id="cf-mpc-count"></span>
              </button>
              <button class="forge-sidebar-tab" data-forge-tab="deck" aria-selected="false" tabindex="-1" title="Deck Manager">
```

- [ ] **Step 2: Add new content panel**

Find the closing `</section>` of the `My Cards` content panel (around line 1597) and the opening of `Deck Manager` content panel right after. Insert the new section between them.

Old:
```html
              </section>
              <!-- Deck Manager Tab Content -->
              <section class="forge-tab-content" data-forge-content="deck" role="tabpanel" aria-labelledby="tab-deck">
```

New:
```html
              </section>
              <!-- My Published Cards Tab Content -->
              <section class="forge-tab-content" data-forge-content="published" role="tabpanel" aria-labelledby="tab-published">
                <h4 class="forge-section-title"><i class="fas fa-share-from-square"></i> My Published Cards</h4>
                <div class="my-cards-scroll">
                  <div class="my-cards-list" id="cf-mpc-list">
                    <div class="my-cards-empty">
                      <i class="fas fa-spinner fa-spin"></i>
                      <p>Loading…</p>
                    </div>
                  </div>
                </div>
              </section>
              <!-- Deck Manager Tab Content -->
              <section class="forge-tab-content" data-forge-content="deck" role="tabpanel" aria-labelledby="tab-deck">
```

- [ ] **Step 3: Load the two new JS files**

Find the existing CardForge script loads in `editor.html` (search for `cardforge-forge-actions.js`). Add the two new scripts immediately after `config.js` so the helper module is available before the modules that use it. The exact placement: find the `<script src="js/config.js"...>` line and insert these two lines right after it.

Find:
```html
  <script src="js/config.js?v=20260424x" defer></script>
```

Replace with (also bumps the cache-bust on this line — handled in Task 8):
```html
  <script src="js/config.js?v=20260424x" defer></script>
  <script src="js/cardforge-published-events.js?v=20260425a" defer></script>
  <script src="js/cardforge-my-published-cards.js?v=20260425a" defer></script>
```

Note: every other `?v=20260424x` cache-bust on editor.html gets bumped in Task 8. These two new lines start at `20260425a` directly.

- [ ] **Step 4: Append CSS**

Open `c:/Dev/Ambientpixels/ambientpixels/cardforge/css/cardforge-ui.css`. Append at the very end of the file:

```css
/* ── My Published Cards tab (editor Forge sidebar) ── */
.cf-mpc-row {
  display: flex;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--cf-ob-line-2, rgba(255,255,255,0.08));
  border-radius: 8px;
  background: var(--cf-ob-bg-1, #0d1015);
  margin-bottom: 10px;
}
.cf-mpc-thumb {
  flex: 0 0 auto;
  width: 110px;
  height: 154px;
  position: relative;
  overflow: hidden;
}
.cf-mpc-meta {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.cf-mpc-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--cf-ob-text-1, #e7ebf1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cf-mpc-sub {
  font-size: 11px;
  color: var(--cf-ob-text-mute, #6b7280);
  margin: 4px 0 12px;
}
.cf-mpc-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
  flex-wrap: wrap;
}
.cf-mpc-actions .forge-action-btn { font-size: 11px; padding: 6px 10px; }
.cf-mpc-unpub {
  color: #ff8888;
  border-color: rgba(220, 60, 60, 0.4);
}
.cf-mpc-unpub:hover {
  background: rgba(220, 60, 60, 0.12);
  color: #ffaaaa;
}
```

- [ ] **Step 5: Manual verification**

Open `c:/Dev/Ambientpixels/ambientpixels/cardforge/editor.html` in a browser via SWA CLI (`swa start . --app-location .` from `ambientpixels/`) at `http://localhost:4280/cardforge/editor.html`.

Sign in. Click the new **Published** tab in the Forge sidebar. Expected:
- Tab switches active style.
- If you have no published cards: empty state ("No published cards yet").
- If you have published cards: each appears as a row with thumbnail + name + "Published {date}" + Edit + Unpublish buttons.
- Console: no errors mentioning `CardForgePublished`, `cf-mpc-list`, or `cardforgeloadcards`.

If the editor's existing publish nav button shows for the Published tab, that's expected — Task 5 wires the hide.

- [ ] **Step 6: Commit**

```bash
cd c:/Dev/Ambientpixels/ambientpixels
git add cardforge/editor.html cardforge/css/cardforge-ui.css
git commit -m "feat(cardforge): editor sidebar — My Published tab markup + CSS

New Forge sidebar tab between My Cards and Deck Manager. Reuses
my-cards-scroll layout for consistency. Action-row + danger-styled
unpublish button styling added to cardforge-ui.css.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — Wire publish/unpublish events into existing flows

**Files:**
- Modify: `c:/Dev/Ambientpixels/ambientpixels/cardforge/js/cardforge-forge-actions.js` (around line 100 in `bindForgeTabNavigation` for the Published-tab branch; in `handlePublishCard()` and `publishDeck()` after success; in `removeGalleryDeck()` after success)

- [ ] **Step 1: Hide publish nav button on Published tab**

Find `bindForgeTabNavigation` around line 72. Inside the `if (pubNavBtn)` block (around line 104), there's an `if (target === 'deck') { ... } else { ... }` chain. Add a `published` branch.

Old (lines around 104–122):
```js
        if (pubNavBtn) {
          if (target === 'deck') {
            const decks = this.getSavedDecks();
            const hasDeck = decks && decks.length > 0 && this._selectedDeckId;
            pubNavBtn.innerHTML = '<span>Publish Deck</span> <i class="fas fa-share"></i>';
            pubNavBtn.setAttribute('aria-label', 'Publish deck to gallery');
            pubNavBtn.disabled = !hasDeck;
            pubNavBtn.setAttribute('aria-disabled', String(!hasDeck));
            if (!hasDeck) {
              pubNavBtn.style.opacity = '0.4';
              pubNavBtn.style.cursor = 'not-allowed';
            }
          } else {
            pubNavBtn.innerHTML = '<span>Publish</span> <i class="fas fa-share"></i>';
            pubNavBtn.setAttribute('aria-label', 'Publish card to gallery');
            pubNavBtn.disabled = false;
```

New (insert a `target === 'published'` branch before the `if (target === 'deck')`):
```js
        if (pubNavBtn) {
          if (target === 'published') {
            // No publish action makes sense from the read-only view.
            pubNavBtn.style.display = 'none';
          } else if (target === 'deck') {
            pubNavBtn.style.display = '';
            const decks = this.getSavedDecks();
            const hasDeck = decks && decks.length > 0 && this._selectedDeckId;
            pubNavBtn.innerHTML = '<span>Publish Deck</span> <i class="fas fa-share"></i>';
            pubNavBtn.setAttribute('aria-label', 'Publish deck to gallery');
            pubNavBtn.disabled = !hasDeck;
            pubNavBtn.setAttribute('aria-disabled', String(!hasDeck));
            if (!hasDeck) {
              pubNavBtn.style.opacity = '0.4';
              pubNavBtn.style.cursor = 'not-allowed';
            }
          } else {
            pubNavBtn.style.display = '';
            pubNavBtn.innerHTML = '<span>Publish</span> <i class="fas fa-share"></i>';
            pubNavBtn.setAttribute('aria-label', 'Publish card to gallery');
            pubNavBtn.disabled = false;
```

- [ ] **Step 2: Dispatch event after card publish succeeds**

The canonical "publish succeeded" signal in this codebase is `_doPublishCard` (line 579 of `cardforge-forge-actions.js`) — it watches for the `publish-success-ok-btn` modal via MutationObserver, then calls `CardForgeActions.setPublishNavState('published')`. Hook the dispatch right there.

Old (around line 591–597):
```js
    const observer = new MutationObserver(function(mutations) {
      const okBtn = document.getElementById('publish-success-ok-btn');
      if (okBtn) {
        observer.disconnect();
        CardForgeActions.setPublishNavState('published');
      }
    });
```

New:
```js
    const observer = new MutationObserver(function(mutations) {
      const okBtn = document.getElementById('publish-success-ok-btn');
      if (okBtn) {
        observer.disconnect();
        CardForgeActions.setPublishNavState('published');
        if (window.CardForgePublished) window.CardForgePublished.notifyChanged({ kind: 'card', action: 'publish' });
      }
    });
```

- [ ] **Step 3: Dispatch event after deck publish succeeds — both publish paths**

There are TWO deck publish entry points; both need the hook.

**3a)** In `cardforge-deck-builder.js`, function `publishDeck()` at line 717. Find the success path — after the local `decks` array is updated and saved with the new `shareId` (around line 781–782). Add the dispatch immediately after the `localStorage.setItem('cardforge_decks', ...)` line:

```js
        deck.shareId = result.shareId;
        localStorage.setItem('cardforge_decks', JSON.stringify(decks));
        if (window.CardForgePublished) window.CardForgePublished.notifyChanged({ kind: 'deck', action: 'publish' });
```

**3b)** In `cardforge-forge-actions.js`, `CardForgeActions.prototype.publishDeck = function(deckId) { ... }` at line 2321. Find the function's success path (after the POST resolves OK and the local entry is updated). Add the same dispatch immediately after the corresponding `localStorage.setItem('cardforge_decks', ...)` call inside that function. (If the function delegates to a helper, hook the helper instead — same idea.)

**3c)** Also in `cardforge-forge-actions.js`, `removeGalleryDeck(shareId)` at line 1835. After the successful POST + UI removal, add:

```js
      if (window.CardForgePublished) window.CardForgePublished.notifyChanged({ kind: 'deck', action: 'unpublish' });
```

- [ ] **Step 4: Manual verification**

Reload `editor.html`. Sign in.
- Switch to **Published** tab. Confirm the publish nav button (top-right of the editor) is hidden.
- Switch back to **My Cards** — publish nav button reappears.
- Switch to **Deck Manager** — publish nav button shows "Publish Deck".
- Open a card, publish it. Switch to **Published** tab — the new card should appear without a manual reload (cache invalidation event fired). If you see the empty state, the dispatch isn't reaching — check `handlePublishCard` location.

- [ ] **Step 5: Commit**

```bash
cd c:/Dev/Ambientpixels/ambientpixels
git add cardforge/js/cardforge-forge-actions.js
git commit -m "feat(cardforge): wire publish/unpublish events for My Published tab

bindForgeTabNavigation gets a 'published' branch that hides the publish
nav button (no publish action on a read-only view). handlePublishCard,
publishDeck, removeGalleryDeck dispatch cardforge:my-published-changed
on success so cached My Published views invalidate immediately.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — My Published Decks JS module

**Files:**
- Create: `c:/Dev/Ambientpixels/ambientpixels/cardforge/js/cardforge-my-published-decks.js`

- [ ] **Step 1: Write the module**

Exact content:

```js
/**
 * CardForge — "My Published Decks" view in the deck builder.
 *
 * Fetches /api/cardforgedeckload (no shareId), filters publishedDecks
 * by my userId, renders a tile grid. Supports Load-into-builder
 * (navigate to deck.html?edit={localDeckId} if a local deck has the
 * matching shareId; otherwise hydrate snapshot fresh) and Unpublish
 * (POST /api/cardforgedeckdelete).
 *
 * Activated by deck builder's bootMyPublishedMode() — see Task 6.
 */
(function () {
  'use strict';

  var API_DECK_LOAD = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgedeckload';
  var API_DECK_DELETE = 'https://ambientpixels-nova-api.azurewebsites.net/api/cardforgedeckdelete';
  var CACHE_KEY = 'cf_my_published_decks_v1';

  var state = { items: [], loading: false };

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return 'unknown';
    try { return new Date(iso).toLocaleDateString(); } catch (_) { return iso; }
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      return (p && Array.isArray(p.items)) ? p.items : null;
    } catch (_) { return null; }
  }

  function writeCache(items) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items: items })); }
    catch (_) {}
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  async function fetchMyPublishedDecks() {
    var myUserId = await window.CardForgePublished.getMyUserId();
    if (!myUserId) return { signedIn: false, items: [] };
    var res;
    try {
      res = await fetch(API_DECK_LOAD, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    } catch (_) { return { signedIn: true, items: [], error: 'network' }; }
    if (!res.ok) return { signedIn: true, items: [], error: 'http_' + res.status };
    var data = await res.json();
    var pool = Array.isArray(data && data.publishedDecks) ? data.publishedDecks : [];
    var mine = pool.filter(function (d) { return d && d.userId === myUserId; });
    return { signedIn: true, items: mine, myUserId: myUserId };
  }

  function findLocalDeckByShareId(shareId) {
    try {
      var decks = JSON.parse(localStorage.getItem('cardforge_decks') || '[]');
      return decks.find(function (d) { return d && d.shareId === shareId; }) || null;
    } catch (_) { return null; }
  }

  function loadIntoBuilder(deck) {
    if (!deck || !deck.shareId) return;
    var localMatch = findLocalDeckByShareId(deck.shareId);
    if (localMatch && localMatch.id) {
      window.location.href = '/cardforge/deck.html?edit=' + encodeURIComponent(localMatch.id);
      return;
    }
    // No local copy — synthesize one from the published snapshot, save, then edit.
    var newId = 'deck_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    var synthetic = {
      id: newId,
      shareId: deck.shareId,
      name: deck.name || 'Untitled Deck',
      icon: deck.icon || 'fas fa-layer-group',
      description: deck.description || '',
      tags: deck.tags || [],
      cardIds: Array.isArray(deck.cardIds) ? deck.cardIds.slice()
            : (Array.isArray(deck.cards) ? deck.cards.map(function (c) { return c.id; }).filter(Boolean) : []),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    try {
      var decks = JSON.parse(localStorage.getItem('cardforge_decks') || '[]');
      decks.unshift(synthetic);
      localStorage.setItem('cardforge_decks', JSON.stringify(decks));
    } catch (_) {}
    window.location.href = '/cardforge/deck.html?edit=' + encodeURIComponent(newId);
  }

  async function unpublishDeck(shareId) {
    if (!shareId) return;
    if (!confirm('Unpublish this deck? It will be removed from the public gallery. Your local deck (if any) is not affected.')) return;
    var myUserId = await window.CardForgePublished.getMyUserId();
    if (!myUserId) { alert('Sign in required.'); return; }
    // Direct call to the Function App (cross-origin). Same userId-in-body
    // pattern as cardforgedeckdelete and the hero-config admin flow.
    var res;
    try {
      res = await fetch(API_DECK_DELETE, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareId: shareId, userId: myUserId })
      });
    } catch (_) { alert('Network error — try again.'); return; }
    if (!res.ok) {
      var msg = 'Unpublish failed (' + res.status + ').';
      try { var b = await res.json(); if (b && b.error) msg = b.error; } catch (_) {}
      alert(msg);
      return;
    }
    state.items = state.items.filter(function (x) { return x.shareId !== shareId; });
    writeCache(state.items);
    var grid = document.getElementById('cf-mpd-grid');
    if (grid) renderInto(grid, { signedIn: true, items: state.items });
    window.CardForgePublished.notifyChanged({ kind: 'deck', action: 'unpublish', shareId: shareId });
  }

  function renderInto(container, result) {
    if (!container) return;
    if (!result.signedIn) {
      container.innerHTML = '<div class="db-mpd-empty"><i class="fas fa-right-to-bracket"></i><p>Sign in to see what you\'ve published.</p></div>';
      return;
    }
    if (result.error) {
      container.innerHTML = '<div class="db-mpd-empty"><i class="fas fa-triangle-exclamation"></i><p>Couldn\'t load (' + escHtml(result.error) + ').</p></div>';
      return;
    }
    if (!result.items.length) {
      container.innerHTML = '<div class="db-mpd-empty"><i class="fas fa-share-from-square"></i><p>No published decks yet.</p><small>Publish from the deck builder.</small></div>';
      return;
    }
    container.innerHTML = result.items.map(function (d) {
      var icon = d.icon || 'fas fa-layer-group';
      var when = fmtDate(d.publishedAt || d.publishDate || d.createdAt);
      var count = (typeof d.cardCount === 'number') ? d.cardCount : (Array.isArray(d.cardIds) ? d.cardIds.length : 0);
      return '' +
        '<div class="db-mpd-tile" data-share-id="' + escHtml(d.shareId) + '">' +
          '<div class="db-mpd-tile-icon"><i class="' + escHtml(icon) + '"></i></div>' +
          '<div class="db-mpd-tile-name">' + escHtml(d.name || 'Untitled Deck') + '</div>' +
          '<div class="db-mpd-tile-meta">' + count + ' card' + (count === 1 ? '' : 's') + ' · Published ' + escHtml(when) + '</div>' +
          '<div class="db-mpd-tile-actions">' +
            '<button type="button" class="db-btn db-mpd-load" data-action="load"><i class="fas fa-pen"></i> Edit</button>' +
            '<button type="button" class="db-btn db-mpd-unpub" data-action="unpub"><i class="fas fa-trash"></i> Unpublish</button>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function bindActions(container) {
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var tile = btn.closest('.db-mpd-tile');
      var shareId = tile && tile.getAttribute('data-share-id');
      if (!shareId) return;
      var deck = state.items.find(function (x) { return x.shareId === shareId; });
      var action = btn.getAttribute('data-action');
      if (action === 'load') loadIntoBuilder(deck);
      else if (action === 'unpub') unpublishDeck(shareId);
    });
  }

  /**
   * Public entry — called by deck builder's bootMyPublishedMode().
   * Renders into the given container. Consumes cache instantly,
   * then refreshes from API and re-renders if items changed.
   */
  async function mount(container) {
    if (!container) return;
    bindActions(container);
    // Render cache instantly.
    var cached = readCache();
    if (cached && cached.length) {
      state.items = cached;
      renderInto(container, { signedIn: true, items: cached });
    } else {
      container.innerHTML = '<div class="db-mpd-empty"><i class="fas fa-spinner fa-spin"></i><p>Loading…</p></div>';
    }
    state.loading = true;
    try {
      var result = await fetchMyPublishedDecks();
      state.items = result.items || [];
      if (result.signedIn && !result.error) writeCache(state.items);
      renderInto(container, result);
    } finally { state.loading = false; }
  }

  // Listen for invalidation events globally.
  // Bind via setTimeout so window.CardForgePublished (loaded by the helper
  // module) is guaranteed available by the time we read .EVENT.
  setTimeout(function () {
    var eventName = (window.CardForgePublished && window.CardForgePublished.EVENT) || 'cardforge:my-published-changed';
    window.addEventListener(eventName, function () {
      clearCache();
      var grid = document.getElementById('cf-mpd-grid');
      if (grid) mount(grid);
    });
  }, 0);

  window.CardForgeMyPublishedDecks = { mount: mount };
})();
```

- [ ] **Step 2: Syntax check**

Run: `node --check c:/Dev/Ambientpixels/ambientpixels/cardforge/js/cardforge-my-published-decks.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd c:/Dev/Ambientpixels/ambientpixels
git add cardforge/js/cardforge-my-published-decks.js
git commit -m "feat(cardforge): My Published Decks module (deck builder view)

Fetches publishedDecks filtered by my userId, renders tiles with Edit
+ Unpublish actions. Edit either navigates to deck.html?edit={localId}
if a local deck has the matching shareId, or synthesizes a local entry
from the snapshot first then edits. Unpublish reuses
POST /api/cardforgedeckdelete (owner-gated).

Exports window.CardForgeMyPublishedDecks.mount(container) for the deck
builder router (next task) to call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — Deck builder routing + UI for My Published Decks

**Files:**
- Modify: `c:/Dev/Ambientpixels/ambientpixels/cardforge/deck.html` (load the two new JS files; cache-bust handled in Task 8)
- Modify: `c:/Dev/Ambientpixels/ambientpixels/cardforge/js/cardforge-deck-builder.js` (add `bootMyPublishedMode()`; route from URL param + tab clicks; add toggle markup to `db-bar`)
- Modify: `c:/Dev/Ambientpixels/ambientpixels/cardforge/css/cardforge-deck-builder.css` (toggle styling + `.db-mpd-*` tile styles)

- [ ] **Step 1: Load the two new JS files in deck.html**

Open `deck.html`. Find the script loads at the bottom:

```html
  <script src="/cardforge/js/config.js"></script>
```

Replace with:
```html
  <script src="/cardforge/js/config.js"></script>
  <script src="/cardforge/js/cardforge-published-events.js?v=20260425a"></script>
  <script src="/cardforge/js/cardforge-my-published-decks.js?v=20260425a"></script>
```

(Keep the existing auth bootstrap script + the existing `cardforge-deck-builder.js` script load below them.)

- [ ] **Step 2: Add `bootMyPublishedMode` and routing in deck-builder.js**

Open `cardforge/js/cardforge-deck-builder.js`. Find the IIFE entry around line 18 where `shareId` and `isViewMode` are read.

Old (around line 18):
```js
  const shareId = params.get('deck') || '';
  const isViewMode = !!shareId;
```

New (extend with a third mode):
```js
  const shareId = params.get('deck') || '';
  const view = params.get('view') || '';
  const isViewMode = !!shareId;
  const isMyPublishedMode = !shareId && view === 'published';
```

Find where `bootBuilderMode()` is called (search for `bootBuilderMode()`). Wrap with the new mode dispatch. Old:

```js
  if (isViewMode) {
    bootViewMode();
  } else {
    bootBuilderMode();
  }
```

New:
```js
  if (isViewMode) {
    bootViewMode();
  } else if (isMyPublishedMode) {
    bootMyPublishedMode();
  } else {
    bootBuilderMode();
  }
```

Now add the `bootMyPublishedMode` function. Insert after `bootViewMode` ends and before `BUILDER MODE` section (around line 160):

```js
  // ================================================================
  //  MY PUBLISHED MODE — list of decks I've published
  // ================================================================
  async function bootMyPublishedMode() {
    const app = document.getElementById('db-app');
    app.innerHTML =
      '<div class="db-bar">' +
        '<a href="/cardforge/" class="db-bar-brand"><i class="fas fa-fire-flame-curved db-bar-brand__mark" aria-hidden="true"></i><span>CardForge</span></a>' +
        '<div class="db-bar-tabs">' +
          '<a href="/cardforge/deck.html" class="db-bar-tab"><i class="fas fa-hammer"></i> Builder</a>' +
          '<a href="/cardforge/deck.html?view=published" class="db-bar-tab is-active" aria-current="page"><i class="fas fa-share-from-square"></i> My Published</a>' +
        '</div>' +
        '<div class="db-bar-actions"></div>' +
      '</div>' +
      '<main class="db-mpd-main">' +
        '<h1 class="db-mpd-title">My Published Decks</h1>' +
        '<div class="db-mpd-grid" id="cf-mpd-grid">' +
          '<div class="db-mpd-empty"><i class="fas fa-spinner fa-spin"></i><p>Loading…</p></div>' +
        '</div>' +
      '</main>';

    // Wait for auth bootstrap (matches builder mode pattern).
    if (window._authReady) { try { await window._authReady; } catch (e) {} }

    if (window.CardForgeMyPublishedDecks && window.CardForgeMyPublishedDecks.mount) {
      window.CardForgeMyPublishedDecks.mount(document.getElementById('cf-mpd-grid'));
    }
  }
```

Also add the matching tab toggle to `bootBuilderMode`'s top bar so users can navigate to the new view. Find the `db-bar` block in `buildBuilderHTML()` around line 199:

Old:
```js
      '<div class="db-bar">' +
        '<a href="/cardforge/" class="db-bar-brand"><i class="fas fa-fire-flame-curved db-bar-brand__mark" aria-hidden="true"></i><span>CardForge</span></a>' +
        '<div class="db-bar-title"><i class="fas fa-hammer"></i> Deck Builder</div>' +
        '<div class="db-bar-actions">' +
```

New:
```js
      '<div class="db-bar">' +
        '<a href="/cardforge/" class="db-bar-brand"><i class="fas fa-fire-flame-curved db-bar-brand__mark" aria-hidden="true"></i><span>CardForge</span></a>' +
        '<div class="db-bar-tabs">' +
          '<a href="/cardforge/deck.html" class="db-bar-tab is-active" aria-current="page"><i class="fas fa-hammer"></i> Builder</a>' +
          '<a href="/cardforge/deck.html?view=published" class="db-bar-tab"><i class="fas fa-share-from-square"></i> My Published</a>' +
        '</div>' +
        '<div class="db-bar-actions">' +
```

(The old `db-bar-title` block is removed — it just said "Deck Builder" and is now redundant with the active tab.)

- [ ] **Step 3: Append CSS to cardforge-deck-builder.css**

Open `cardforge-deck-builder.css`. Append at the end:

```css
/* ── My Published view (deck builder secondary mode) ── */
.db-bar-tabs {
  display: flex;
  gap: 4px;
  flex: 1 1 auto;
  margin-left: 16px;
}
.db-bar-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--cf-ob-text-2, #a6aeb9);
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2px;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.db-bar-tab:hover {
  border-color: var(--cf-ob-ember-33, rgba(255,122,26,0.33));
  color: var(--cf-ob-text-1, #e7ebf1);
}
.db-bar-tab.is-active {
  background: var(--cf-ob-ember-dim, rgba(255,122,26,0.12));
  border-color: var(--cf-ob-ember, #ff7a1a);
  color: var(--cf-ob-ember, #ff7a1a);
}

.db-mpd-main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 24px 80px;
}
.db-mpd-title {
  font-family: 'Unbounded', sans-serif;
  font-size: clamp(28px, 3vw, 40px);
  font-weight: 800;
  letter-spacing: -1px;
  margin: 8px 0 24px;
}
.db-mpd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}
.db-mpd-empty {
  grid-column: 1 / -1;
  padding: 48px 24px;
  border: 1px dashed var(--cf-ob-line-2, rgba(255,255,255,0.08));
  border-radius: 8px;
  text-align: center;
  color: var(--cf-ob-text-mute, #6b7280);
  font-size: 13px;
}
.db-mpd-empty i { font-size: 28px; display: block; margin-bottom: 12px; color: var(--cf-ob-ember, #ff7a1a); }
.db-mpd-empty p { margin: 0 0 6px; color: var(--cf-ob-text-2, #a6aeb9); font-size: 14px; }
.db-mpd-empty small { display: block; }

.db-mpd-tile {
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: var(--cf-ob-bg-1, #0d1015);
  border: 1px solid var(--cf-ob-line-2, rgba(255,255,255,0.08));
  border-radius: 8px;
  transition: border-color 0.18s ease, transform 0.2s ease;
}
.db-mpd-tile:hover {
  border-color: var(--cf-ob-ember-33, rgba(255,122,26,0.33));
  transform: translateY(-2px);
}
.db-mpd-tile-icon {
  font-size: 32px;
  color: var(--cf-ob-ember, #ff7a1a);
  margin-bottom: 12px;
}
.db-mpd-tile-name {
  font-weight: 700;
  font-size: 15px;
  color: var(--cf-ob-text-1, #e7ebf1);
  margin-bottom: 4px;
}
.db-mpd-tile-meta {
  font-size: 11px;
  color: var(--cf-ob-text-mute, #6b7280);
  margin-bottom: 14px;
}
.db-mpd-tile-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}
.db-mpd-tile-actions .db-btn { font-size: 11px; padding: 6px 10px; flex: 1 1 auto; justify-content: center; }
.db-mpd-unpub {
  color: #ff8888;
  border-color: rgba(220, 60, 60, 0.4);
}
.db-mpd-unpub:hover {
  background: rgba(220, 60, 60, 0.12);
  color: #ffaaaa;
}
```

- [ ] **Step 4: Syntax check**

Run: `node --check c:/Dev/Ambientpixels/ambientpixels/cardforge/js/cardforge-deck-builder.js`
Expected: exit 0.

- [ ] **Step 5: Manual verification**

Open `http://localhost:4280/cardforge/deck.html?view=published` while signed in.
- Page renders the new top bar with two tabs (Builder | My Published, active).
- Below: "My Published Decks" title + grid.
- Empty: "No published decks yet."
- With published decks: tiles with name + count + date + Edit + Unpublish.

Click **Edit** on a tile:
- If your local `cardforge_decks` has a matching shareId → navigates to `?edit={localId}` and the existing builder loads it.
- Otherwise → synthesizes a local entry, saves it, then navigates. Verify the new entry exists in localStorage `cardforge_decks` after the redirect.

Click **Unpublish**:
- Confirm prompt → tile disappears.
- Reload the page → still gone (cache + server agree).

Click **Builder** tab → navigates to `/cardforge/deck.html` (existing builder), which now shows the same tab toggle in its top bar.

- [ ] **Step 6: Commit**

```bash
cd c:/Dev/Ambientpixels/ambientpixels
git add cardforge/deck.html cardforge/js/cardforge-deck-builder.js cardforge/css/cardforge-deck-builder.css
git commit -m "feat(cardforge): deck builder — My Published view + tab toggle

New deck.html?view=published mode renders my published decks with Edit
+ Unpublish per tile. db-bar gets a Builder | My Published tab toggle
shared across both views. Edit synthesizes a local cardforge_decks
entry from the snapshot if no local match exists, preserving shareId
so future Publish overwrites the same gallery slot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 — Cache-bust + integration smoke

**Files:**
- Modify: `c:/Dev/Ambientpixels/ambientpixels/cardforge/editor.html` (bump every existing `?v=20260424z` → `?v=20260425a`)
- Modify: `c:/Dev/Ambientpixels/ambientpixels/cardforge/deck.html` (bump every existing `?v=20260424y` → `?v=20260425a`)

- [ ] **Step 1: Bump editor.html cache-bust**

Per CLAUDE.md and the cardforge skill, bump the shared YYYYMMDDx token across editor.html.

Run from `c:/Dev/Ambientpixels/ambientpixels/cardforge/`:
```bash
grep -c "v=20260424z" editor.html
```
Expected: a count > 0 (current version on this file). Then use the Edit tool with `replace_all: true` to swap `v=20260424z` → `v=20260425a`. (Skip if zero — file may already be on a different stamp; in that case bump whatever it is.)

- [ ] **Step 2: Bump deck.html cache-bust**

```bash
grep -c "v=20260424y" deck.html
```
Then use Edit with `replace_all: true` to swap `v=20260424y` → `v=20260425a`.

- [ ] **Step 3: Final integration smoke**

Hard-reload `editor.html`. Sign in as the admin user.

1. **Card publish round-trip:**
   - Create a small card in the editor, give it a unique name.
   - Click Save (saves to localStorage + cloud).
   - Click Publish.
   - Switch to **Published** tab → new card appears at top with today's date.
   - Click **Edit** on it → editor's My Cards tab activates, card loads.
   - Change the name slightly → Save → Publish.
   - Switch back to **Published** tab → updated name reflected.
   - Click **Unpublish** → confirm → row disappears.
   - `curl -s https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeloadcards | jq '.galleryCards | map(select(.id == "<your-card-id>"))'` → empty array.

2. **Deck publish round-trip:**
   - In the editor, switch to **Deck Manager** tab. Create a new deck, add a couple of cards, save, publish.
   - Open `http://localhost:4280/cardforge/deck.html?view=published` → tile shows.
   - Click **Edit** → opens builder with the deck loaded.
   - Click **Unpublish** → confirm → tile disappears.
   - `curl -s https://ambientpixels-nova-api.azurewebsites.net/api/cardforgedeckload | jq '.publishedDecks | length'` → count decreased by 1.

3. **Cross-browser:** sign in as the same user in a different browser, hard-reload `deck.html?view=published` → published decks list still matches.

4. **Empty / signed-out:**
   - Sign out, reload editor's Published tab → "Sign in to see what you've published."
   - Sign out, visit `deck.html?view=published` → same.

- [ ] **Step 4: Commit + push**

```bash
cd c:/Dev/Ambientpixels/ambientpixels
git add cardforge/editor.html cardforge/deck.html
git commit -m "chore(cardforge): cache-bust to v=20260425a for My Published tabs

Bumps editor.html (was 20260424z) and deck.html (was 20260424y) to
the new shared YYYYMMDDx token so all CardForge UI gets the new JS
references.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin master
```

---

## Out of scope (do NOT add)

- Analytics (views, last-viewed counters)
- Bulk select / batch unpublish
- Sort / filter beyond the empty-state messaging
- Visibility states (unlisted / private)
- Backend changes
- Editing the existing `refreshGalleryDecks` view in `cardforge-forge-actions.js` (the editor's "all gallery decks" view is unrelated and stays untouched)
