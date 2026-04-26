# CardForge OG card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working `og:image` for every CardForge page — a per-card preview at `/api/cardshare?card={cardId}` and a single static brand OG everywhere else — replacing today's broken/stale references.

**Architecture:** A browser-only DOM composition template (`buildOgComposition(cardData)`) is the single source of visual truth. At publish time, the editor renders it off-screen, captures it via `modern-screenshot`, and POSTs the PNG to a new save endpoint that writes to blob `cardforge/og-cards/{cardId}.png`. `/api/cardshare` HEAD-probes that blob — if present, the per-card PNG becomes `og:image`; if absent, the static brand OG (baked once with the same template via a manual tool) is the fallback.

**Tech Stack:** Vanilla JS, Azure Functions (Node), Azure Blob Storage, `modern-screenshot` (UMD vendor drop, ~40KB).

**Spec:** [`docs/superpowers/specs/2026-04-25-cardforge-og-card-design.md`](../specs/2026-04-25-cardforge-og-card-design.md)

**Working directory convention:** all paths in this plan are relative to `c:/Dev/Ambientpixels/ambientpixels/` unless prefixed `c:/`. The git repo lives at `ambientpixels/.git`, NOT the parent.

**Testing approach:** No automated test framework exists in this codebase (per [`package.json`](../../../package.json) — only `simple-git`/`axios`/etc., no Jest/Mocha/Vitest). The spec explicitly opts out of automated tests for v1. Verification is via:
- `curl` smoke tests for the API endpoint
- Visual eyeballing in a temporary HTML harness for the composition
- Twitter Card Validator + LinkedIn Post Inspector for end-to-end OG rendering

**Cache-bust convention:** CardForge bumps a shared `?v=YYYYMMDD<letter>` token across every changed asset in a sprint. Use `v=20260425og` for all assets touched by this work.

---

## File Structure

**New files:**
- `cardforge/css/cardforge-og.css` — composition styles, scoped under `.cf-og-canvas`
- `cardforge/js/cardforge-og-composition.js` — DOM builder, exposes `window.buildOgComposition(cardData)`
- `cardforge/vendor/modern-screenshot.js` — UMD vendor drop of the capture library
- `cardforge/tools/og-baker.html` — manual brand-OG bake tool (CEO-facing)
- `cardforge/images/cardforge-og.png` — output of the manual bake (tracked in git, ~50–200KB)
- `api/cardforgesaveogimage/index.js` — POST endpoint
- `api/cardforgesaveogimage/function.json` — Azure Functions binding

**Modified files:**
- `api/cardshare/index.js` — add HEAD probe, change fallback URL
- `cardforge/js/cardforge-forge-actions.js` — `_doPublishCard` triggers capture on success
- `cardforge/config.js` — register `saveOgImage` endpoint
- `cardforge/editor.html` — load new composition CSS/JS and `modern-screenshot` (deferred)
- `cardforge/index.html`, `gallery.html`, `faq.html`, `roadmap.html` — already point to `cardforge-og.png`, will start working once the file is committed
- `cardforge/deck.html`, `cardforge/devlog.html`, `cardforge/editor.html` — change `og-cardforge.jpg` → `cardforge-og.png`
- `staticwebapp.config.json` — route entry for `/api/cardforgesaveogimage`

**Deleted files:**
- `cardforge/images/og-cardforge.jpg` — stale, replaced by the new brand PNG (after task 4 confirms references are gone)

---

## Task 1: Composition CSS + JS module

**Files:**
- Create: `cardforge/css/cardforge-og.css`
- Create: `cardforge/js/cardforge-og-composition.js`

This is the foundation — both the per-card capture path and the brand-OG bake tool consume it. The composition is a detached 1200×630 DOM tree using existing obsidian/ember tokens (already declared in `cardforge-base.css`).

- [ ] **Step 1: Create `cardforge/css/cardforge-og.css`**

```css
/* CardForge OG composition — 1200x630 social share canvas.
   Scoped under .cf-og-canvas so it never bleeds onto the editor. */

.cf-og-canvas {
  width: 1200px;
  height: 630px;
  background: linear-gradient(135deg, var(--cf-ob-bg-0) 0%, var(--cf-ob-bg-1) 100%);
  font-family: 'Inter', system-ui, sans-serif;
  color: var(--cf-ob-text-1);
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: stretch;
}

/* Decorative ember dots scattered in negative space */
.cf-og-canvas::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(circle at 78% 22%, var(--cf-ob-ember-22) 0, transparent 2px),
    radial-gradient(circle at 92% 64%, var(--cf-ob-ember-22) 0, transparent 1.5px),
    radial-gradient(circle at 64% 88%, var(--cf-ob-ember-22) 0, transparent 1.5px),
    radial-gradient(circle at 86% 11%, var(--cf-ob-ember-22) 0, transparent 1px);
  pointer-events: none;
  z-index: 0;
}

/* Right-edge ember hairline */
.cf-og-canvas::after {
  content: '';
  position: absolute;
  top: 60px;
  bottom: 60px;
  right: 0;
  width: 1px;
  background: var(--cf-ob-ember);
  opacity: 0.5;
  pointer-events: none;
}

.cf-og-canvas__left {
  width: 560px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
  padding: 7px;
}

.cf-og-canvas__card {
  width: 440px;
  height: 616px;
  filter: drop-shadow(0 12px 32px rgba(0, 0, 0, 0.55));
}

.cf-og-canvas__right {
  flex: 1;
  padding: 60px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
  z-index: 1;
}

.cf-og-canvas__eyebrow {
  font-family: 'Unbounded', sans-serif;
  font-weight: 600;
  font-size: 16px;
  color: var(--cf-ob-ember);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin: 0 0 12px 0;
}

.cf-og-canvas__wordmark {
  font-family: 'Unbounded', sans-serif;
  font-weight: 700;
  font-size: 48px;
  color: var(--cf-ob-text-1);
  margin: 0;
  letter-spacing: -0.01em;
}

.cf-og-canvas__name {
  font-family: 'Unbounded', sans-serif;
  font-weight: 700;
  font-size: 56px;
  color: var(--cf-ob-text-1);
  margin: 0 0 12px 0;
  line-height: 1.05;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.cf-og-canvas__author {
  font-family: 'Inter', sans-serif;
  font-size: 20px;
  color: var(--cf-ob-text-mute);
  margin: 0 0 24px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 480px;
}

.cf-og-canvas__stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.cf-og-canvas__stat {
  background: var(--cf-ob-bg-2);
  color: var(--cf-ob-ember);
  padding: 8px 16px;
  border-radius: 8px;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 20px;
  letter-spacing: 0.04em;
}

.cf-og-canvas__tagline {
  font-family: 'Inter', sans-serif;
  font-size: 22px;
  color: var(--cf-ob-text-2);
  margin: 0 0 6px 0;
}

.cf-og-canvas__url {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  color: var(--cf-ob-text-mute);
  margin: 0;
  letter-spacing: 0.02em;
}

/* Off-screen mounting wrapper used by the capture path. The composition
   needs to be in the DOM (not just detached) for fonts/images to render
   correctly. Position it far off-screen, never visible to the user. */
.cf-og-offscreen {
  position: fixed;
  left: -10000px;
  top: 0;
  pointer-events: none;
  z-index: -1;
}
```

- [ ] **Step 2: Create `cardforge/js/cardforge-og-composition.js`**

```javascript
/**
 * CardForge OG composition builder.
 * Pure DOM constructor — no side effects, no DOM mounting.
 * Caller mounts the returned node off-screen, awaits paint + image decode,
 * captures via modern-screenshot, then removes the node.
 *
 * Public API: window.buildOgComposition(cardData) -> HTMLElement
 */
(function () {
  'use strict';

  const TAGLINE = 'Design, Customize & Share';
  const URL_LINE = 'cardforge.ambientpixels.ai';

  function escapeText(s) {
    return String(s == null ? '' : s);
  }

  function pickTopStats(cardData) {
    // Combat stats first (STR/AGI/INT/END/LCK), top 3 by value
    const combat = cardData && cardData.combatStats;
    if (combat && typeof combat === 'object') {
      const entries = Object.entries(combat)
        .filter(([, v]) => typeof v === 'number' && v > 0)
        .map(([k, v]) => ({ name: k.toUpperCase().slice(0, 3), value: v }));
      if (entries.length) {
        return entries.sort((a, b) => b.value - a.value).slice(0, 3);
      }
    }
    // Else freeform stats[]
    const stats = cardData && cardData.stats;
    if (Array.isArray(stats)) {
      return stats
        .filter(s => s && s.name && typeof s.value === 'number')
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
        .map(s => ({ name: String(s.name).toUpperCase().slice(0, 4), value: s.value }));
    }
    return [];
  }

  function getAuthorHandle(cardData) {
    // Card payload field varies — try common candidates, ellipsis at 24 chars.
    const raw =
      (cardData && (cardData.authorName || cardData.author || cardData.creatorName)) || '';
    const trimmed = String(raw).trim();
    if (!trimmed) return '';
    return trimmed.length > 24 ? trimmed.slice(0, 24) + '…' : '@' + trimmed.replace(/^@/, '');
  }

  /**
   * Build a 1200x630 composition for cardData.
   * Returns a detached HTMLElement. Caller is responsible for mount/cleanup.
   */
  function buildOgComposition(cardData) {
    cardData = cardData || {};

    const canvas = document.createElement('div');
    canvas.className = 'cf-og-canvas';

    // --- LEFT ZONE: card preview ---
    const left = document.createElement('div');
    left.className = 'cf-og-canvas__left';

    const cardWrap = document.createElement('div');
    cardWrap.className = 'cf-og-canvas__card';

    // Reuse the editor's card render. CardForge.renderCardPreview is the
    // canonical path used by Quick Build modal previews and others.
    // Fallback: if the API isn't ready, leave the wrapper empty (caller can
    // detect and abort capture).
    if (window.CardForge && typeof window.CardForge.renderCardPreview === 'function') {
      try {
        window.CardForge.renderCardPreview(cardWrap, cardData, { face: 'front' });
      } catch (err) {
        console.warn('[CardForge OG] renderCardPreview failed:', err);
      }
    }

    left.appendChild(cardWrap);
    canvas.appendChild(left);

    // --- RIGHT ZONE: brand + name + stats + tagline ---
    const right = document.createElement('div');
    right.className = 'cf-og-canvas__right';

    // Top: eyebrow + wordmark
    const topBlock = document.createElement('div');
    const eyebrow = document.createElement('p');
    eyebrow.className = 'cf-og-canvas__eyebrow';
    eyebrow.textContent = 'CardForge';
    const wordmark = document.createElement('h2');
    wordmark.className = 'cf-og-canvas__wordmark';
    wordmark.textContent = 'CardForge';
    topBlock.appendChild(eyebrow);
    topBlock.appendChild(wordmark);
    right.appendChild(topBlock);

    // Middle: name + author + stats
    const middleBlock = document.createElement('div');
    const name = document.createElement('h1');
    name.className = 'cf-og-canvas__name';
    name.textContent = escapeText(cardData.name) || 'Untitled Card';
    middleBlock.appendChild(name);

    const author = document.createElement('p');
    author.className = 'cf-og-canvas__author';
    const handle = getAuthorHandle(cardData);
    if (handle) {
      author.textContent = handle;
      middleBlock.appendChild(author);
    }

    const topStats = pickTopStats(cardData);
    if (topStats.length) {
      const statsRow = document.createElement('div');
      statsRow.className = 'cf-og-canvas__stats';
      topStats.forEach(s => {
        const pill = document.createElement('span');
        pill.className = 'cf-og-canvas__stat';
        pill.textContent = `${s.name} ${s.value}`;
        statsRow.appendChild(pill);
      });
      middleBlock.appendChild(statsRow);
    }
    right.appendChild(middleBlock);

    // Bottom: tagline + URL
    const bottomBlock = document.createElement('div');
    const tagline = document.createElement('p');
    tagline.className = 'cf-og-canvas__tagline';
    tagline.textContent = TAGLINE;
    const url = document.createElement('p');
    url.className = 'cf-og-canvas__url';
    url.textContent = URL_LINE;
    bottomBlock.appendChild(tagline);
    bottomBlock.appendChild(url);
    right.appendChild(bottomBlock);

    canvas.appendChild(right);
    return canvas;
  }

  window.buildOgComposition = buildOgComposition;
})();
```

- [ ] **Step 3: Verify the composition renders by creating a temporary visual harness**

Create a throwaway file `cardforge/tools/_og-test.html` (will be deleted in Step 6):

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>OG composition test</title>
  <link rel="stylesheet" href="../css/cardforge-base.css">
  <link rel="stylesheet" href="../css/cardforge-card.css">
  <link rel="stylesheet" href="../css/cardforge-bg-effects.css">
  <link rel="stylesheet" href="../css/cardforge-border-effects.css">
  <link rel="stylesheet" href="../css/cardforge-glow-effects.css">
  <link rel="stylesheet" href="../css/cardforge-icons.css">
  <link rel="stylesheet" href="../css/cardforge-og.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Unbounded:wght@600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0; padding:20px; background:#000;">
  <div id="mount"></div>
  <script src="../js/cardforge-og-composition.js"></script>
  <script>
    // Stub renderCardPreview so we can see the layout without the full editor
    window.CardForge = {
      renderCardPreview: function (mount, data) {
        const card = document.createElement('div');
        card.style.cssText =
          'width:100%;height:100%;background:linear-gradient(180deg,#3a1f0a,#1a0a04);' +
          'border:2px solid #ff7a1a;border-radius:16px;display:flex;align-items:end;' +
          'justify-content:center;padding:20px;color:#fff;font-family:sans-serif;' +
          'font-weight:bold;text-align:center;';
        card.textContent = (data && data.name) || 'Card stub';
        mount.appendChild(card);
      }
    };

    const sample = {
      name: 'Ember Knight of the Obsidian Dawn',
      authorName: 'thechadmartin',
      combatStats: { str: 78, agi: 64, int: 92, end: 71, lck: 55 }
    };

    document.getElementById('mount').appendChild(window.buildOgComposition(sample));
  </script>
</body>
</html>
```

Open `c:/Dev/Ambientpixels/ambientpixels/cardforge/tools/_og-test.html` in a browser via Live Server (or any local server — `file://` won't work because of relative URLs).

Expected: a 1200×630 dark composition with:
- Stub card on left (orange-bordered black gradient with the card name)
- Right side: small "CARDFORGE" eyebrow, "CardForge" wordmark, card name (2 lines, truncated), `@thechadmartin`, 3 stat pills (`INT 92 · STR 78 · END 71`), tagline + URL at bottom.
- Subtle ember dots in the upper-right negative space
- Thin orange hairline at the right edge

If the layout looks broken, fix the CSS/JS and re-test. Do NOT commit the test harness.

- [ ] **Step 4: Commit composition**

```bash
git add cardforge/css/cardforge-og.css cardforge/js/cardforge-og-composition.js
git commit -m "$(cat <<'EOF'
feat(cardforge): OG composition template (Layout A, 1200x630)

Pure DOM builder + scoped CSS. Used by both the publish-time capture
path and the manual brand-OG bake tool. No mount/cleanup logic — caller
owns the lifecycle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Brand-OG bake tool

**Files:**
- Create: `cardforge/tools/og-baker.html`
- Delete: `cardforge/tools/_og-test.html` (the throwaway harness from Task 1)

A standalone HTML page that loads the composition, lets the user pick any published card, renders the composition with that card's real data, and provides a "Download PNG" button. The CEO uses this once per brand-OG refresh; it is also the manual fallback if a per-card capture ever needs re-running by hand.

The tool uses `modern-screenshot` to render to PNG — task ordering matters: this task adds the lib reference, but the actual UMD file is dropped in Task 6. Until then, the "Download" button will throw. The card-picker + live preview will work standalone.

- [ ] **Step 1: Delete the temporary test harness**

```bash
rm cardforge/tools/_og-test.html
```

- [ ] **Step 2: Create `cardforge/tools/og-baker.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CardForge OG Baker</title>
  <meta name="robots" content="noindex,nofollow">
  <link rel="stylesheet" href="../css/cardforge-base.css?v=20260425og">
  <link rel="stylesheet" href="../css/cardforge-card.css?v=20260425og">
  <link rel="stylesheet" href="../css/cardforge-bg-effects.css?v=20260425og">
  <link rel="stylesheet" href="../css/cardforge-border-effects.css?v=20260425og">
  <link rel="stylesheet" href="../css/cardforge-glow-effects.css?v=20260425og">
  <link rel="stylesheet" href="../css/cardforge-icons.css?v=20260425og">
  <link rel="stylesheet" href="../css/cardforge-og.css?v=20260425og">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Unbounded:wght@600;700&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 0;
      padding: 24px;
      background: var(--cf-ob-bg-0);
      color: var(--cf-ob-text-1);
      font-family: 'Inter', sans-serif;
    }
    .baker {
      max-width: 1280px;
      margin: 0 auto;
      display: grid;
      gap: 24px;
    }
    .baker__bar {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    .baker__bar select { padding: 8px 12px; min-width: 280px; font-size: 16px; }
    .baker__bar button {
      padding: 8px 16px; font-size: 16px;
      background: var(--cf-ob-ember); color: var(--cf-ob-bg-0);
      border: none; border-radius: 6px; font-weight: 600; cursor: pointer;
    }
    .baker__bar button:disabled { opacity: 0.5; cursor: not-allowed; }
    .baker__preview {
      border: 1px solid var(--cf-ob-line-1);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .baker__notice { font-size: 14px; color: var(--cf-ob-text-mute); }
  </style>
</head>
<body>
  <div class="baker">
    <h1 style="font-family:'Unbounded',sans-serif;margin:0;">CardForge OG Baker</h1>
    <p class="baker__notice">
      Pick a published card, click Download, and save the result as
      <code>cardforge/images/cardforge-og.png</code>. Commit the file.
    </p>
    <div class="baker__bar">
      <select id="card-picker" disabled><option>Loading published cards…</option></select>
      <button id="download-btn" disabled>Download PNG</button>
    </div>
    <div class="baker__preview" id="preview-mount"></div>
  </div>

  <!-- Reuse the editor's card render. The full editor stack is heavy — for
       the baker we only need card-forge-editor.js's renderCardPreview,
       which depends on config.js, presets, and template-loader. -->
  <script src="../js/config.js?v=20260425og"></script>
  <script src="../js/cardforge-template-loader.js?v=20260425og"></script>
  <script src="../js/cardforge-presets.js?v=20260425og"></script>
  <script src="../js/card-forge-editor.js?v=20260425og"></script>
  <script src="../js/cardforge-og-composition.js?v=20260425og"></script>
  <script src="../vendor/modern-screenshot.js?v=20260425og"></script>
  <script>
    (async function () {
      const picker = document.getElementById('card-picker');
      const btn = document.getElementById('download-btn');
      const mount = document.getElementById('preview-mount');

      let currentNode = null;
      let cardsById = {};

      function rerender(card) {
        mount.innerHTML = '';
        currentNode = window.buildOgComposition(card || {});
        mount.appendChild(currentNode);
      }

      // Fetch published cards for the picker
      try {
        const res = await fetch('/api/cardforgeloadcards?published=1');
        const data = await res.json();
        const list = (data && data.cards) || (data && data.publishedCards) || [];
        if (!list.length) {
          picker.innerHTML = '<option>No published cards found</option>';
          return;
        }
        picker.innerHTML = '';
        list.forEach((c, i) => {
          const card = c.cardData || c;
          cardsById[c.id || i] = card;
          const opt = document.createElement('option');
          opt.value = c.id || i;
          opt.textContent = (card.name || 'Untitled') + ' — ' + (card.authorName || 'unknown');
          picker.appendChild(opt);
        });
        picker.disabled = false;
        btn.disabled = false;
        rerender(cardsById[picker.value]);
      } catch (err) {
        picker.innerHTML = '<option>Failed to load cards: ' + err.message + '</option>';
      }

      picker.addEventListener('change', () => rerender(cardsById[picker.value]));

      btn.addEventListener('click', async () => {
        if (!currentNode) return;
        if (!window.modernScreenshot || !window.modernScreenshot.domToBlob) {
          alert('modern-screenshot vendor file not loaded yet — run Task 6 first.');
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Rendering…';
        try {
          // Wait two frames + image decoding so glow + filters settle
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const imgs = currentNode.querySelectorAll('img');
          await Promise.all(Array.from(imgs).map(i => i.decode().catch(() => {})));

          const blob = await window.modernScreenshot.domToBlob(currentNode, {
            width: 1200,
            height: 630
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'cardforge-og.png';
          a.click();
          URL.revokeObjectURL(url);
        } catch (err) {
          alert('Bake failed: ' + err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = 'Download PNG';
        }
      });
    })();
  </script>
</body>
</html>
```

- [ ] **Step 3: Smoke-test the picker (composition only — Download will fail until Task 6)**

Open `cardforge/tools/og-baker.html` via Live Server. Expected:
- Picker populates with published cards from `/api/cardforgeloadcards?published=1`
- Selecting a card re-renders the composition in the preview area
- Clicking Download shows an alert "modern-screenshot vendor file not loaded yet — run Task 6 first." (this is correct — vendor file lands in Task 6)

If the picker shows "Failed to load cards" with a CORS error, that's a sign the dev server is hitting the local SWA emulator without the `/api/*` rewrite. Run via `swa start . --app-location .` not plain Live Server.

- [ ] **Step 4: Commit baker tool**

```bash
git add cardforge/tools/og-baker.html
git commit -m "$(cat <<'EOF'
feat(cardforge): brand-OG baker tool (cardforge/tools/og-baker.html)

Card-picker + live composition preview + Download PNG button.
Uses the same buildOgComposition() as the publish-time capture path,
so brand OG and per-card OG share visual language.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: /api/cardshare meta tag update

**Files:**
- Modify: `api/cardshare/index.js`

Two changes:
1. Replace the avatar-or-rainbow-logo `og:image` logic with: HEAD probe `cardforge/og-cards/{cardId}.png`; if 200, use that blob URL with cache-bust; else use `https://ambientpixels.ai/cardforge/images/cardforge-og.png`.
2. Run the HEAD probe in parallel with the existing `published-cards.json` download for latency parity.

Before this task ships, the per-card blobs don't exist yet, so every share will fall through to the static brand OG. That's the intended behavior — the per-card path lights up later in Task 8 once capture-on-publish is wired.

- [ ] **Step 1: Read the current `api/cardshare/index.js`**

Done in research. Key lines:
- Lines 4–6: constants (`STORAGE_ACCOUNT_NAME`, `CONTAINER_NAME`, `SITE_ORIGIN`)
- Lines 54–70: card lookup
- Lines 82–90: existing `og:image` logic (the part being replaced)

- [ ] **Step 2: Replace the og:image logic block**

In `api/cardshare/index.js`, find the existing block (lines 82–90 in the current file):

```javascript
  // og:image — use card avatar if it's an HTTP URL, otherwise fallback to site logo
  let ogImage = `${SITE_ORIGIN}/images/ambient-pixel-logo-rainbow.png`;
  if (card && card.avatar && typeof card.avatar === 'string') {
    if (card.avatar.startsWith('http://') || card.avatar.startsWith('https://')) {
      ogImage = card.avatar;
    } else if (card.avatar.startsWith('data:image/')) {
      // data URIs don't work for og:image — keep fallback
    }
  }
```

Replace with:

```javascript
  // og:image: per-card capture (cardforge/og-cards/{cardId}.png) if it exists,
  // else the static brand OG (cardforge/images/cardforge-og.png).
  const STATIC_BRAND_OG = `${SITE_ORIGIN}/cardforge/images/cardforge-og.png`;
  const PER_CARD_BLOB_PATH = `og-cards/${cardId}.png`;
  let ogImage = STATIC_BRAND_OG;
  try {
    // containerClient is in scope from the card-lookup block above.
    // If the card lookup failed, containerClient may be undefined — guard.
    if (typeof containerClient !== 'undefined' && containerClient) {
      const ogBlobClient = containerClient.getBlockBlobClient(PER_CARD_BLOB_PATH);
      const ogExists = await ogBlobClient.exists();
      if (ogExists) {
        const cacheBust = (card && (card.updatedAt || card.publishedAt)) || cardId;
        ogImage = `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net/${CONTAINER_NAME}/${PER_CARD_BLOB_PATH}?v=${encodeURIComponent(cacheBust)}`;
      }
    }
  } catch (err) {
    context.log.warn(`cardshare: og blob probe failed for ${cardId}: ${err.message}`);
    // Fall through to static brand OG
  }
```

**Important:** the `containerClient` variable in the existing code is declared inside the try block at lines 56–67. To use it in the new block, hoist its declaration. Change line 54–67 from:

```javascript
  let card = null;
  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const publishedBlobClient = containerClient.getBlockBlobClient('published-cards.json');
    // ...
  } catch (err) {
    context.log.warn(`cardshare: failed to load card ${cardId}: ${err.message}`);
  }
```

to:

```javascript
  let card = null;
  let containerClient = null;
  try {
    const blobServiceClient = await createBlobServiceClient();
    containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const publishedBlobClient = containerClient.getBlockBlobClient('published-cards.json');
    // ...
  } catch (err) {
    context.log.warn(`cardshare: failed to load card ${cardId}: ${err.message}`);
  }
```

(The `const` becomes a hoisted `let`; everything else in the block stays the same.)

- [ ] **Step 3: Add og:image dimensions to the meta tag block**

The current HTML template (lines 92–123 in the original file) sets `og:image` but not its dimensions. Find the `<meta property="og:image"` line in the template and add these two lines immediately after it:

```html
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
```

The existing `<meta name="twitter:card" content="summary_large_image">` already covers Twitter dimensions.

- [ ] **Step 4: Smoke-test locally**

```bash
cd c:/Dev/Ambientpixels/ambientpixels
swa start . --app-location . --api-location api
```

In another shell:

```bash
curl -s "http://localhost:4280/api/cardshare?card=NONEXISTENT_CARD_ID" | grep og:image
```

Expected output:
```
  <meta property="og:image" content="https://ambientpixels.ai/cardforge/images/cardforge-og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
```

(The non-existent card produces no card data, so og:image falls through to the static brand OG. That's the correct behavior. The static URL points at a file that won't exist until Task 5 — that's fine for the smoke test, we're verifying the CODE is producing the right URL.)

Pick a real published card ID and re-run:
```bash
curl -s "http://localhost:4280/api/cardshare?card=<REAL_CARD_ID>" | grep og:image
```

Expected: same URL (per-card blob doesn't exist yet, so still falls through to brand OG).

- [ ] **Step 5: Commit**

```bash
git add api/cardshare/index.js
git commit -m "$(cat <<'EOF'
feat(cardshare): per-card og:image probe with static brand fallback

HEAD probe cardforge/og-cards/{cardId}.png. If present, use it as
og:image with ?v={updatedAt} cache-bust. Else fall through to the
static brand OG at cardforge/images/cardforge-og.png. Adds explicit
og:image:width/height (1200x630) for platforms that respect them.

Replaces the old avatar-or-rainbow-logo logic. Per-card blobs don't
exist yet, so every share falls through to brand OG until the
capture-on-publish path lands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Static brand OG bake (manual)

This is a manual one-shot. No code changes — it produces a binary file (`cardforge/images/cardforge-og.png`) that is the static brand OG used by every page that isn't `cardshare`.

Prereqs:
- Task 1 + 2 + 3 committed (composition + baker tool exist)
- The user has at least one published card to use as the curated hero

**Note:** the baker's Download button currently fails with an alert because `modern-screenshot` isn't vendored yet (Task 6). To complete the bake, either:
- (a) Run Task 6 first, then come back here, OR
- (b) Quick alternative for this one-time manual bake: open the baker tool, screenshot the live preview at exactly 1200×630 using OS screenshot tools (Snipping Tool on Windows). Lower fidelity but unblocks the page-fix work.

**Recommended:** do Task 6 first, then bake here. The alternative is a stopgap.

- [ ] **Step 1: Run Task 6 (vendor modern-screenshot)** if not already done.

- [ ] **Step 2: Open the baker tool**

Start the local dev server (if not already running):
```bash
swa start . --app-location . --api-location api
```

Navigate to `http://localhost:4280/cardforge/tools/og-baker.html`.

- [ ] **Step 3: Pick a curated hero card**

In the dropdown, select a card the CEO wants as the brand-OG hero. Recommendation: pick from the highest-rated cards in the gallery, or one of the curated splash-fan cards. Avoid: cards with broken portraits, debug/test names, or short bland names.

- [ ] **Step 4: Click Download PNG**

The browser downloads `cardforge-og.png` to the default Downloads folder.

- [ ] **Step 5: Move and verify**

```bash
# Adjust the source path to wherever your browser saved the download
mv ~/Downloads/cardforge-og.png c:/Dev/Ambientpixels/ambientpixels/cardforge/images/cardforge-og.png
```

Verify dimensions:
```bash
# Quick check on Windows via PowerShell (or use any image viewer)
powershell -Command "Add-Type -AssemblyName System.Drawing; \$img = [System.Drawing.Image]::FromFile('c:/Dev/Ambientpixels/ambientpixels/cardforge/images/cardforge-og.png'); Write-Host \"\$(\$img.Width)x\$(\$img.Height)\""
```

Expected: `1200x630`. File size should be in the 50KB–300KB range.

- [ ] **Step 6: Commit the binary**

```bash
git add cardforge/images/cardforge-og.png
git commit -m "$(cat <<'EOF'
feat(cardforge): bake initial brand OG image (1200x630)

Output of cardforge/tools/og-baker.html with the CEO-curated hero card.
Used as og:image for every CardForge page except per-card share URLs.
Re-bake by re-running the baker and replacing this file.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Page reference fixes + delete stale jpg

**Files:**
- Modify: `cardforge/deck.html`, `cardforge/devlog.html`, `cardforge/editor.html`
- Delete: `cardforge/images/og-cardforge.jpg`

Three pages reference the stale `og-cardforge.jpg`. After Task 4 ships `cardforge-og.png`, the four pages that already point to it (`index.html`, `gallery.html`, `faq.html`, `roadmap.html`) start working with no edit. The other three need their `og:image` URL updated. Then we can delete the `.jpg`.

- [ ] **Step 1: Update `cardforge/deck.html`**

Find the line (currently `cardforge/deck.html:13`):
```html
  <meta property="og:image" content="https://www.ambientpixels.ai/cardforge/images/og-cardforge.jpg" />
```

Replace with:
```html
  <meta property="og:image" content="https://ambientpixels.ai/cardforge/images/cardforge-og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
```

(Note: drop the `www.` to match what the working pages use, and add explicit dimensions.)

- [ ] **Step 2: Update `cardforge/devlog.html`**

Find the line (currently `cardforge/devlog.html:12`) — same content as deck.html. Apply the same replacement.

- [ ] **Step 3: Update `cardforge/editor.html`**

Find the line (currently `cardforge/editor.html:17`) — same content. Apply the same replacement. Editor is `noindex` so social shares are unlikely, but consistency is cheap.

- [ ] **Step 4: Verify no remaining references to `og-cardforge.jpg`**

```bash
cd c:/Dev/Ambientpixels/ambientpixels
grep -r "og-cardforge.jpg" cardforge/ api/ 2>/dev/null
```

Expected: no output.

- [ ] **Step 5: Delete the stale jpg**

```bash
rm cardforge/images/og-cardforge.jpg
```

- [ ] **Step 6: Commit**

```bash
git add cardforge/deck.html cardforge/devlog.html cardforge/editor.html
git rm cardforge/images/og-cardforge.jpg
git commit -m "$(cat <<'EOF'
fix(cardforge): point deck/devlog/editor at new cardforge-og.png

These three pages still referenced the stale og-cardforge.jpg. The
other four pages (index, gallery, faq, roadmap) already pointed at the
new filename, so they came alive automatically when the new PNG
landed. Drop the leading 'www.' to match the working pages, add
explicit og:image:width/height. Delete the stale jpg.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Vendor modern-screenshot

**Files:**
- Create: `cardforge/vendor/modern-screenshot.js`

`modern-screenshot` is the capture library — better CSS support than html2canvas (filters, pseudo-elements, font rendering), small (~40KB UMD), MIT-licensed. We drop the UMD build directly into the repo (no bundler, no npm install in the editor's path).

- [ ] **Step 1: Create the vendor directory**

```bash
mkdir -p c:/Dev/Ambientpixels/ambientpixels/cardforge/vendor
```

- [ ] **Step 2: Download the UMD build**

The library is at https://github.com/qq15725/modern-screenshot. Use the latest release's UMD build from unpkg or jsDelivr.

```bash
curl -L "https://unpkg.com/modern-screenshot@4/dist/index.umd.js" \
  -o c:/Dev/Ambientpixels/ambientpixels/cardforge/vendor/modern-screenshot.js
```

Verify the file:
```bash
ls -la c:/Dev/Ambientpixels/ambientpixels/cardforge/vendor/modern-screenshot.js
head -5 c:/Dev/Ambientpixels/ambientpixels/cardforge/vendor/modern-screenshot.js
```

Expected: file size ~40–80KB, first few lines contain a UMD wrapper (`(function (global, factory) { ... }(this, ...))`) and reference `modernScreenshot`.

- [ ] **Step 3: Verify it loads in the baker tool**

Open `http://localhost:4280/cardforge/tools/og-baker.html`. In DevTools console, type:

```javascript
window.modernScreenshot
```

Expected: an object with methods including `domToBlob`, `domToPng`, `domToCanvas`. If it's `undefined`, the script tag in og-baker.html references `../vendor/modern-screenshot.js` — confirm the file is there at the right path.

Click Download PNG. Expected: a `cardforge-og.png` downloads (replaces the alert from Task 2 step 3).

- [ ] **Step 4: Commit**

```bash
git add cardforge/vendor/modern-screenshot.js
git commit -m "$(cat <<'EOF'
feat(cardforge): vendor modern-screenshot UMD build

Capture library used by the OG baker and (in next commit) the
publish-time per-card OG capture. ~40-80KB, MIT-licensed, no
transitive deps. Pinned UMD bundle in vendor/ so it's not on the
npm install path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Save endpoint (`POST /api/cardforgesaveogimage`)

**Files:**
- Create: `api/cardforgesaveogimage/function.json`
- Create: `api/cardforgesaveogimage/index.js`
- Modify: `staticwebapp.config.json`
- Modify: `cardforge/config.js`

POST endpoint that accepts a PNG and writes it to `cardforge/og-cards/{cardId}.png`. Auth required (no anonymous writes — would let anyone overwrite anyone's OG). Pattern copied from `api/cardforgeheroconfig/index.js` and `api/cardforgedeckdelete/index.js`.

Body format: raw binary PNG with `Content-Type: image/png`. Card ID in query string (`?cardId=...`).

- [ ] **Step 1: Create `api/cardforgesaveogimage/function.json`**

```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["post", "options"],
      "dataType": "binary"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

(`dataType: "binary"` makes Azure Functions provide `req.body` as a `Buffer` instead of a string.)

- [ ] **Step 2: Create `api/cardforgesaveogimage/index.js`**

```javascript
const { BlobServiceClient } = require('@azure/storage-blob');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const MAX_BYTES = 500 * 1024; // 500KB hard cap
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With, X-CF-Auth-Principal'
};

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  const { DefaultAzureCredential } = require('@azure/identity');
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(`https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, credential);
}

function extractUserInfo(req, context) {
  const swaPrincipal = req.headers['x-ms-client-principal'];
  if (swaPrincipal) {
    try {
      const decoded = Buffer.from(swaPrincipal, 'base64').toString('utf8');
      const cp = JSON.parse(decoded);
      const userId = cp.userId || 'anonymous';
      return { userId, isAuthenticated: userId !== 'anonymous' };
    } catch (err) {
      context.log.warn(`Failed to parse SWA principal: ${err.message}`);
    }
  }
  const cfPrincipal = req.headers['x-cf-auth-principal'];
  if (cfPrincipal) {
    try {
      const cp = JSON.parse(cfPrincipal);
      const userId = cp.userId || 'anonymous';
      return { userId, isAuthenticated: userId !== 'anonymous' };
    } catch (err) {
      context.log.warn(`Failed to parse X-CF-Auth-Principal: ${err.message}`);
    }
  }
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) return { userId: devUserId, isAuthenticated: true };
  }
  return { userId: 'anonymous', isAuthenticated: false };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  // Auth — must be signed in. Anonymous users cannot write OG images.
  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated) {
    context.res = { status: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'auth_required' }) };
    return;
  }

  // cardId from query string
  const cardId = (req.query && req.query.cardId) || '';
  if (!CARD_ID_PATTERN.test(cardId)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'invalid_card_id' }) };
    return;
  }

  // Body must be a non-empty Buffer
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    context.res = { status: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'empty_body' }) };
    return;
  }

  // Size cap
  if (body.length > MAX_BYTES) {
    context.res = { status: 413, headers: CORS_HEADERS, body: JSON.stringify({ error: 'too_large', maxBytes: MAX_BYTES }) };
    return;
  }

  // PNG magic bytes
  if (body.length < 8 || !body.subarray(0, 8).equals(PNG_MAGIC)) {
    context.res = { status: 415, headers: CORS_HEADERS, body: JSON.stringify({ error: 'not_a_png' }) };
    return;
  }

  // Write to blob
  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blobPath = `og-cards/${cardId}.png`;
    const blobClient = containerClient.getBlockBlobClient(blobPath);
    await blobClient.uploadData(body, {
      blobHTTPHeaders: {
        blobContentType: 'image/png',
        blobCacheControl: 'public, max-age=2592000' // 30 days; social platforms cache anyway
      }
    });
    context.log(`[saveogimage] user=${userId} cardId=${cardId} bytes=${body.length}`);
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        cardId,
        path: blobPath,
        url: `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net/${CONTAINER_NAME}/${blobPath}`,
        bytes: body.length
      })
    };
  } catch (err) {
    context.log.error(`[saveogimage] blob write failed: ${err.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'storage_error' }) };
  }
};
```

- [ ] **Step 3: Add the route to `staticwebapp.config.json`**

⚠️ This file is on the protected list (high blast radius per CLAUDE.md). Only this single addition is in scope for this task — DO NOT touch other entries.

Open `staticwebapp.config.json`. Find the `routes` array. Find the entry for `/api/cardforgeloadcards` (used as a pattern reference). Add a new entry next to it:

```json
{
  "route": "/api/cardforgesaveogimage",
  "methods": ["POST", "OPTIONS"],
  "allowedRoles": ["anonymous"]
}
```

(The `anonymous` role here means SWA forwards the request — auth is enforced inside the Function via `extractUserInfo`, same pattern as every other CardForge endpoint.)

- [ ] **Step 4: Register the endpoint in `cardforge/config.js`**

Open `cardforge/config.js`. Find the `apiEndpoints` object. Add a new entry alongside `loadCards`/`heroConfig`/etc:

```javascript
saveOgImage: '/api/cardforgesaveogimage',
```

(Maintain the existing alphabetical or grouping order — match the surrounding style.)

- [ ] **Step 5: Local smoke test**

Restart the SWA dev server:
```bash
swa start . --app-location . --api-location api
```

Test rejection paths:
```bash
# 401 — anonymous
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:4280/api/cardforgesaveogimage?cardId=abc" \
  -H "Content-Type: image/png" --data-binary "fake"
# Expected: 401
```

```bash
# 400 — invalid cardId
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:4280/api/cardforgesaveogimage?cardId=" \
  -H "Content-Type: image/png" -H "X-User-ID: dev-user-1" --data-binary "fake"
# Expected: 400
```

```bash
# 415 — not a PNG (bytes don't match magic)
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:4280/api/cardforgesaveogimage?cardId=test123" \
  -H "Content-Type: image/png" -H "X-User-ID: dev-user-1" --data-binary "this is not a png"
# Expected: 415
```

```bash
# 200 — valid PNG (use the brand OG from Task 4 as a stand-in)
curl -s -X POST "http://localhost:4280/api/cardforgesaveogimage?cardId=smoke-test" \
  -H "Content-Type: image/png" -H "X-User-ID: dev-user-1" \
  --data-binary "@c:/Dev/Ambientpixels/ambientpixels/cardforge/images/cardforge-og.png"
# Expected: { "cardId":"smoke-test","path":"og-cards/smoke-test.png","url":"...","bytes":NNN }
```

Confirm the blob exists in Azure (only meaningful if `AZURE_STORAGE_CONNECTION_STRING` is set in `local.settings.json` — otherwise the local test is hitting the cloud-managed identity path and may fail, in which case skip the 200-path test locally and verify in production after deploy).

- [ ] **Step 6: Commit**

```bash
git add api/cardforgesaveogimage/ staticwebapp.config.json cardforge/config.js
git commit -m "$(cat <<'EOF'
feat(cardforge): POST /api/cardforgesaveogimage endpoint

Accepts raw PNG body (max 500KB) with cardId query param. Auth
required (anonymous = 401). Validates PNG magic bytes + size cap +
cardId pattern. Writes to blob cardforge/og-cards/{cardId}.png.

Pattern copied from cardforgeheroconfig: BlobServiceClient via
DefaultAzureCredential or AZURE_STORAGE_CONNECTION_STRING fallback,
extractUserInfo with SWA + X-CF-Auth-Principal + dev X-User-ID
headers.

SWA route added with allowedRoles: ["anonymous"] (auth enforced in
the Function, same pattern as every other CardForge endpoint).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Hook capture into the publish flow

**Files:**
- Modify: `cardforge/editor.html` — load CSS/JS for composition + vendor lib
- Modify: `cardforge/js/cardforge-forge-actions.js` — `_doPublishCard`

This is the integration step. After a card publishes successfully, build the composition off-screen, capture via `modern-screenshot`, POST the result to the new endpoint. Wrap everything in try/catch so capture failures never block or corrupt the publish flow.

The success signal already exists: the `MutationObserver` in `_doPublishCard` (lines 654–663) watches for the publish-success modal to appear. Hook the capture step into that observer's success branch.

- [ ] **Step 1: Load composition assets in `editor.html`**

Find the existing CardForge CSS block in the `<head>` of `cardforge/editor.html`. Add this line near the other cardforge CSS (alongside `cardforge-card.css`, `cardforge-bg-effects.css`, etc.):

```html
  <link rel="stylesheet" href="css/cardforge-og.css?v=20260425og">
```

Find the script section near the bottom (the `defer` block listed in the SKILL's "Script Loading Order"). Add these two `<script>` tags, placed near `cardforge-forge-actions.js` so they're loaded before the publish flow runs:

```html
  <script defer src="js/cardforge-og-composition.js?v=20260425og"></script>
  <script defer src="vendor/modern-screenshot.js?v=20260425og"></script>
```

Bump the existing `?v=` cache-bust on `cardforge-forge-actions.js` to `v=20260425og` so the new code loads.

- [ ] **Step 2: Add a `_captureAndUploadOgImage` method to `CardForgeActions`**

In `cardforge/js/cardforge-forge-actions.js`, add this method to the `CardForgeActions` class (any location near `_doPublishCard` is fine):

```javascript
  /**
   * Build the OG composition off-screen, capture as PNG, POST to the
   * save endpoint. Failures are logged but never thrown — capture is
   * best-effort and must never block or fail the publish flow.
   */
  async _captureAndUploadOgImage(cardId, cardData) {
    if (!window.buildOgComposition) {
      console.warn('[CardForge OG] buildOgComposition not loaded; skipping capture');
      return;
    }
    if (!window.modernScreenshot || !window.modernScreenshot.domToBlob) {
      console.warn('[CardForge OG] modern-screenshot not loaded; skipping capture');
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'cf-og-offscreen';
    let composition = null;
    try {
      composition = window.buildOgComposition(cardData || {});
      wrapper.appendChild(composition);
      document.body.appendChild(wrapper);

      // Wait two animation frames so glow/filter effects settle, then
      // wait for any nested <img> to decode. modern-screenshot will
      // otherwise capture mid-load images as blank.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const imgs = composition.querySelectorAll('img');
      await Promise.all(Array.from(imgs).map(i => i.decode().catch(() => {})));

      const blob = await window.modernScreenshot.domToBlob(composition, {
        width: 1200,
        height: 630
      });

      const url = (window._config && window.buildApiPath)
        ? window.buildApiPath('saveOgImage') + '?cardId=' + encodeURIComponent(cardId)
        : '/api/cardforgesaveogimage?cardId=' + encodeURIComponent(cardId);

      const headers = (window._cfGetAuthHeaders && window._cfGetAuthHeaders()) || {};
      headers['Content-Type'] = 'image/png';

      const res = await fetch(url, {
        method: 'POST',
        credentials: 'omit',
        headers,
        body: blob
      });

      if (!res.ok) {
        console.warn(`[CardForge OG] save failed: HTTP ${res.status}`);
        if (window.ProductAnalytics) {
          window.ProductAnalytics.track('og_capture_failed', { cardId, reason: 'http_' + res.status });
        }
        return;
      }
      console.log(`[CardForge OG] captured + uploaded for cardId=${cardId}`);
    } catch (err) {
      console.warn('[CardForge OG] capture failed:', err);
      if (window.ProductAnalytics) {
        window.ProductAnalytics.track('og_capture_failed', { cardId, reason: err && err.message });
      }
    } finally {
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    }
  }
```

- [ ] **Step 3: Trigger capture from the publish-success observer**

In `cardforge/js/cardforge-forge-actions.js`, find the existing `_doPublishCard` method (around line 643). Inside the `MutationObserver` callback (around lines 655–662), modify the success branch:

Existing code:
```javascript
    const observer = new MutationObserver(function(mutations) {
      const okBtn = document.getElementById('publish-success-ok-btn');
      if (okBtn) {
        observer.disconnect();
        CardForgeActions.setPublishNavState('published');
        if (window.CardForgePublished) window.CardForgePublished.notifyChanged({ kind: 'card', action: 'publish' });
      }
    });
```

Change to (note the `self` variable captured before the observer):
```javascript
    const self = this;
    const observer = new MutationObserver(function(mutations) {
      const okBtn = document.getElementById('publish-success-ok-btn');
      if (okBtn) {
        observer.disconnect();
        CardForgeActions.setPublishNavState('published');
        if (window.CardForgePublished) window.CardForgePublished.notifyChanged({ kind: 'card', action: 'publish' });
        // Fire-and-forget OG capture. Failures are logged inside the
        // method and never thrown — publish is already complete.
        try {
          const cardData = self.collectCardData();
          self._captureAndUploadOgImage(cardId, cardData);
        } catch (err) {
          console.warn('[CardForge OG] failed to kick off capture:', err);
        }
      }
    });
```

(The capture promise is intentionally not awaited — it runs in the background. The success modal is already shown to the user; we don't want to block it on PNG generation.)

- [ ] **Step 4: Local smoke test**

```bash
swa start . --app-location . --api-location api
```

In a browser, sign in to CardForge locally (`http://localhost:4280/cardforge/editor.html`), create a card, click Publish.

Open DevTools → Network tab. Watch for:
1. The existing `/api/cardforgepublish` request (publish itself).
2. ~1–2 seconds later, a `POST /api/cardforgesaveogimage?cardId=...` with `Content-Type: image/png`.

Both should return `200`. The DevTools Console should log `[CardForge OG] captured + uploaded for cardId=...`.

Failure modes to verify gracefully degrade:
- Disable the network mid-capture (DevTools → Network → Offline). Publish should still succeed; only the OG upload fails. Console logs the failure; no error toast.

- [ ] **Step 5: Smoke-test the full per-card OG path**

Hit `/api/cardshare?card=<cardId-you-just-published>` in your browser (or `curl -s` it):
```bash
curl -s "http://localhost:4280/api/cardshare?card=<NEWLY_PUBLISHED_ID>" | grep og:image
```

Expected: `og:image` URL now points at `https://cardforgeblobdata.blob.core.windows.net/cardforge/og-cards/<id>.png?v=...`, NOT the static brand OG.

- [ ] **Step 6: Commit**

```bash
git add cardforge/editor.html cardforge/js/cardforge-forge-actions.js
git commit -m "$(cat <<'EOF'
feat(cardforge): capture per-card OG image at publish-time

After successful publish, mount the OG composition off-screen, wait
for paint + image decode, capture via modern-screenshot, POST the PNG
to /api/cardforgesaveogimage. Failures are logged + tracked via
ProductAnalytics ('og_capture_failed') but never block or fail the
publish flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: End-to-end smoke verification

No code changes. This is the final acceptance pass before merge.

- [ ] **Step 1: Deploy**

```bash
git push origin master
```

Wait for the GitHub Actions workflow `azure-static-web-apps-calm-sky-05cc8e110.yml` to deploy. Watch for green in Azure Portal → Static Web App → Deployment history.

- [ ] **Step 2: Static brand OG — verify on every page**

```bash
for page in "" gallery faq roadmap deck devlog editor; do
  echo "=== /cardforge/$page ==="
  curl -s "https://ambientpixels.ai/cardforge/${page}.html" 2>/dev/null | grep -A0 'og:image'
done
```

Expected: every page emits an `og:image` pointing at `https://ambientpixels.ai/cardforge/images/cardforge-og.png`. Confirm the file is actually 200:
```bash
curl -sI "https://ambientpixels.ai/cardforge/images/cardforge-og.png" | head -1
```
Expected: `HTTP/2 200`.

- [ ] **Step 3: Per-card OG — fresh publish path**

In a browser, sign in to production CardForge, create + publish a new card. After publish, hit:
```bash
curl -s "https://ambientpixels.ai/api/cardshare?card=<NEW_CARD_ID>" | grep og:image
```
Expected: `og:image` points at the per-card blob URL.

Verify the blob is reachable:
```bash
curl -sI "https://cardforgeblobdata.blob.core.windows.net/cardforge/og-cards/<NEW_CARD_ID>.png" | head -1
```
Expected: `HTTP/2 200`, `Content-Type: image/png`.

- [ ] **Step 4: Per-card OG — legacy card fallback**

Pick any card published BEFORE this work shipped. Hit:
```bash
curl -s "https://ambientpixels.ai/api/cardshare?card=<OLD_CARD_ID>" | grep og:image
```
Expected: `og:image` points at the static brand OG (no per-card blob exists, fallback fires).

- [ ] **Step 5: External validators**

Open in a browser:
- https://cards-dev.twitter.com/validator → paste `https://ambientpixels.ai/api/cardshare?card=<NEW_CARD_ID>` → click Preview Card. Expected: 1200×630 per-card composition renders.
- https://www.linkedin.com/post-inspector/ → paste same URL → Inspect. Expected: same image renders.
- https://www.opengraph.xyz/ → paste same URL → all OG fields parse correctly.

- [ ] **Step 6: Done**

If all checks pass, update `MEMORY.md` to note this session's work (per the project's memory conventions in `CLAUDE.md`), then move on. If any check fails, file a follow-up issue rather than scope-creeping the fix into this PR.

---

## Risks during execution

- **`renderCardPreview` API name uncertain.** The composition assumes `window.CardForge.renderCardPreview(mount, cardData, opts)` exists with that signature. The SKILL doc references "Preview clones main editor's `.card-preview-canvas` into wizard modal via `requestAnimationFrame`" for Quick Build, but doesn't name the function. **Verify in Task 1 Step 2** by reading `cardforge/js/card-forge-editor.js` — find how the Quick Build wizard renders the card preview and use the same path. If the function name is different, update the composition module accordingly.
- **`window._cfGetAuthHeaders()` may not exist on the editor page.** SKILL doc says it's defined in `config.js`, but verify by inspecting `window._cfGetAuthHeaders` in the browser console on a loaded editor page. If it's missing, fall back to manually constructing `X-CF-Auth-Principal` from `/.auth/me` (pattern used elsewhere in cardforge JS).
- **`AZURE_STORAGE_CONNECTION_STRING` for local dev.** If `local.settings.json` doesn't have this var, the save endpoint's local 200-path test will fail — DefaultAzureCredential won't have credentials in a typical dev setup. Either add the connection string to `local.settings.json` (same one prod uses, treat as a secret) or skip the local 200-path test and rely on the post-deploy verification.
- **Editor.html script load order.** SKILL doc lists a strict load order in `## Script Loading Order (editor.html)`. Adding `cardforge-og-composition.js` and `vendor/modern-screenshot.js` somewhere in the deferred block should be safe (they have no dependencies and they don't run on load), but place them AFTER `card-forge-editor.js` since the composition uses `window.CardForge.renderCardPreview`.

---

## Spec coverage check

Cross-reference every spec section against tasks above:

| Spec section | Covered by |
|---|---|
| Goal: per-card OG | Tasks 1, 6, 7, 8 |
| Goal: static brand OG | Tasks 1, 2, 4, 5 |
| Decision: client-side capture at publish | Tasks 6, 8 |
| Decision: Layout A | Task 1 (CSS + JS) |
| Decision: backfill = none | (no work — handled by Task 3 fallback logic) |
| Decision: bake brand OG via composition template | Tasks 2, 4 |
| Architecture Unit A — composition template | Task 1 |
| Architecture Unit B — capture-at-publish | Task 8 |
| Architecture Unit C — `/api/cardshare` meta tags | Task 3 |
| Composition spec: Layout A details | Task 1 (CSS) |
| Edge cases: long name / no avatar / legacy schema | Task 1 (JS handles via `pickTopStats` + `getAuthorHandle` + CSS line-clamp) |
| New file: `cardforge-og-composition.js` | Task 1 |
| New file: `cardforge-og.css` | Task 1 |
| New file: `tools/og-baker.html` | Task 2 |
| New file: `vendor/modern-screenshot.js` | Task 6 |
| New file: `api/cardforgesaveogimage/` | Task 7 |
| Modify: `cardforge-forge-actions.js handlePublishCard` | Task 8 |
| Modify: `api/cardshare/index.js` | Task 3 |
| Modify: 7 HTML pages | Tasks 4 (file output) + 5 (refs) + 8 (editor.html script tags) |
| Modify: `cardforge/config.js` | Task 7 |
| Modify: `staticwebapp.config.json` | Task 7 |
| Storage: `cardforge/og-cards/{cardId}.png` | Task 7 (writes), Task 3 (reads) |
| Cache-bust on og:image URL | Task 3 |
| Auth + size + magic-bytes validation | Task 7 |
| Out of scope: Satori, backfill, per-page variants | Documented; no tasks |

No gaps.
