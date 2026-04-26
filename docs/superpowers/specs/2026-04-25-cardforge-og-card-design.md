# CardForge OG card — design spec

**Date:** 2026-04-25
**Status:** Draft, awaiting CEO review before implementation plan
**Scope owner:** CardForge

---

## Goal

Ship Open Graph (social-share preview) images for CardForge so that links shared to Twitter/X, LinkedIn, Bluesky, and other platforms render with a meaningful 1200×630 preview. Two surfaces:

1. **Per-card OG** — `/api/cardshare?card={cardId}` returns meta tags pointing to a PNG that visually represents the actual card.
2. **Static brand OG** — every other CardForge page (index, gallery, faq, roadmap, deck, devlog, editor) serves a single shared `cardforge-og.png` brand image, ending the current state where 4 pages reference a file that doesn't exist and 3 pages reference a stale `og-cardforge.jpg`.

## Non-goals

- Pixel-perfect server-side card rendering. We are NOT shipping a headless-Chromium Function in v1.
- Backfilling OG PNGs for the ~50–200 cards already published. They will serve the static brand OG until re-published. Migration is organic.
- Per-page OG variants (a unique image per page beyond card vs brand).
- Auto-rebaking the brand OG on a schedule. CEO bakes it manually via a tool.
- Satori-based server-side fallback composition. Revisit if capture-failure rates are high in the wild.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Scope | Per-card OG + static brand OG fallback | Per-card alone leaves 6 pages serving broken/stale `og:image`. The static brand OG is ~30 minutes of work and stops that. |
| Render fidelity | Client-side capture at publish (no server compute, no Satori) | Browser already has the rendered card DOM with all its CSS effects (image-borders, foils, glow). Capturing the live DOM gets the highest fidelity for free. Server-side rendering would either need Chromium (~300MB cold-start cost) or Satori (rebuild card render in a second, simplified path). |
| Composition layout | Layout A — card-left / info-right | Most legible at thumbnail size, no CORS landmines that a full-bleed blurred portrait would hit, shows the card AS a card. |
| Backfill | None for existing cards | Cheapest. They serve the static brand OG; migration happens organically as cards are re-published. |
| Static brand OG content | Bake Layout A once with a CEO-curated card | Reuses the per-card composition template — same code path, two outputs. CEO can re-bake any time by picking a new card. |
| Capture lib | `modern-screenshot` | Better CSS support than html2canvas (pseudo-elements, filters), small (~40KB), maintained, MIT-licensed. |
| Failure UX | Publish never blocks on capture | If capture throws, log + continue. The card publishes; its OG falls through to the static brand OG. |

## Architecture

Three units, one shared composition.

### Unit A — Composition template (browser-only)

**Files:** `cardforge/js/cardforge-og-composition.js`, `cardforge/css/cardforge-og.css`

Pure DOM builder: `buildOgComposition(cardData) → HTMLElement`. Returns a 1200×630 detached node. Caller is responsible for attaching it to the document (off-screen) so the browser can paint it before capture, and for removing it after.

The composition uses the actual `.card-preview-canvas` markup the editor produces for the card portrait — the same render path as the live preview, scaled to fit the left zone. Right zone is independent layout (wordmark, name, stats, tagline) using existing obsidian/ember tokens.

Used by both:
- The publish-time capture path (Unit B)
- The brand-OG bake tool (`tools/og-baker.html`)

### Unit B — Capture-at-publish path

**Modifies:** `cardforge/js/cardforge-forge-actions.js` (`handlePublishCard`)

Sequence after successful card publish:

1. Build composition off-screen using `buildOgComposition(cardData)`.
2. Wait for paint (`requestAnimationFrame` × 2) and any nested `<img>` `decode()` promises to resolve. **This step is non-negotiable** — without it, the captured PNG will show mid-frame glow animations and unloaded portrait images.
3. Call `modernScreenshot.domToBlob(node, { width: 1200, height: 630 })`.
4. POST the resulting `Blob` to `/api/cardforgesaveogimage` with auth + CSRF headers.
5. Remove composition from DOM.

Wrapped in try/catch. Any failure: log to `console.warn`, surface in product analytics as `og_capture_failed` with the card id, but do NOT block or fail the publish flow. The card is published successfully regardless.

### Unit C — `/api/cardshare?id={id}` meta tag logic

**Modifies:** `api/cardshare/index.js`

Existing endpoint already serves dynamic OG meta tags per card. New behavior:

1. Look up card metadata (already happens).
2. Issue a HEAD against blob `cardforge/og-cards/{cardId}.png`.
3. If present (200): `og:image = https://cardforgeblobdata.blob.core.windows.net/cardforge/og-cards/{cardId}.png?v={card.updatedAt}`.
4. If absent (404): `og:image = https://ambientpixels.ai/cardforge/images/cardforge-og.png`.
5. Always set: `twitter:card = summary_large_image`, `og:image:width = 1200`, `og:image:height = 630`.

The HEAD-then-fetch pattern is cheap on Linux Consumption (~30–80ms) and avoids serializing a fallback in metadata. Could be replaced by a stored boolean on card metadata in v2 if HEAD latency becomes a problem.

## Composition spec — Layout A

**Canvas:** 1200×630. Background: obsidian gradient (`--cf-ob-bg-0` → `--cf-ob-bg-1`, diagonal). Decorative: scattered static ember dots in negative space (no animation needed for static export). Thin 1px ember-orange (`#ff7a1a`) hairline at the right edge.

**Left zone (0–560px wide, full height):**

- Existing `.card-preview-canvas` markup (front face only) scaled to ~440×616px, centered vertically, with ~7px padding bleed for soft drop shadow.
- Card retains its actual styling: image-border PNG overlay, glow effect, foil background, image filters. The whole point of capturing the live DOM is to preserve these.

**Right zone (560–1200px wide, padded 60px on all sides):**

- **Top block:** "CARDFORGE" eyebrow label (Unbounded, 16px, ember `#ff7a1a`, letter-spaced 0.16em). Below: full wordmark (Unbounded, 48px, white).
- **Middle block:** card name (Unbounded, 56px, white, max 2 lines via `-webkit-line-clamp: 2`). Author handle below (Inter, 20px, `--cf-ob-text-mute`).
- **Stat pills:** up to 3 inline pills, e.g. `STR 78 · INT 65 · LCK 92` (Inter, 20px, ember accent text on `--cf-ob-bg-2` chip background, 8px corner radius). Source: `card.combatStats` if present (highest 3 by value), else top 3 entries from `card.stats[]` by value, else section is hidden and name absorbs vertical space.
- **Bottom:** tagline "Design, Customize & Share" (Inter, 22px, `--cf-ob-text-2`) + small `cardforge.ambientpixels.ai` URL line (Inter, 14px, `--cf-ob-text-mute`).

**Edge cases:**

| Case | Handling |
|---|---|
| Missing or broken avatar URL | Card renders with placeholder silhouette (existing editor behavior — no special-case needed in composition). |
| Card name > 2 lines | CSS `-webkit-line-clamp: 2` with ellipsis. |
| Author handle > 24 chars | CSS ellipsis after 24 chars. |
| Legacy card with no `combatStats` and no `stats[]` | Stat-pill row is omitted; name + author block centers vertically. |
| External (CORS-blocked) avatar | Captured PNG renders portrait as blank — composition technically "succeeds" so no fallback to static brand OG. **Known v1 limitation.** Worth a follow-up: tainted-canvas detection or an image proxy. |

**Fonts:** Unbounded + Inter, both already loaded on every CardForge page. No font loading work needed in the composition itself.

## Implementation surfaces

### New files

- `cardforge/js/cardforge-og-composition.js` — DOM builder (~150 LOC).
- `cardforge/css/cardforge-og.css` — composition styles, scoped under `.cf-og-canvas`.
- `cardforge/tools/og-baker.html` — manual brand-OG bake tool. Card-picker dropdown (loads from `/api/cardforgeloadcards`), live composition preview, "Download PNG" button. CEO opens this, picks a curated card, downloads, drops the file at `cardforge/images/cardforge-og.png`, commits. **No puppeteer / no Node script / no extra deps required.**
- `cardforge/vendor/modern-screenshot.js` — UMD build of `modern-screenshot` lib (~40KB).
- `api/cardforgesaveogimage/index.js` + `function.json` — `POST` endpoint. Pattern copied from `cardforgepublishcard`. Auth via `extractUserInfo` (anonymous rejected with 401), CSRF check, body validation: PNG magic bytes (`89 50 4E 47`), `Content-Length ≤ 500KB`, decode header to confirm 1200×630. Writes to `cardforgeblobdata` blob `cardforge/og-cards/{cardId}.png`. CORS headers per existing CardForge pattern. Demo-guarded via `demoGuard.httpGuard`.

### Modified files

- `cardforge/js/cardforge-forge-actions.js` (`handlePublishCard`) — appended capture step after publish-success branch. All wrapped in try/catch.
- `api/cardshare/index.js` — meta tag generator updated per Unit C above.
- 7 HTML pages — `og:image` reference fixes:
  - `cardforge/index.html`, `gallery.html`, `faq.html`, `roadmap.html` — already point to `/cardforge/images/cardforge-og.png`; need the file to exist (will after first bake).
  - `cardforge/deck.html`, `cardforge/devlog.html`, `cardforge/editor.html` — change from stale `og-cardforge.jpg` → `cardforge-og.png`. Editor is `noindex` so social shares are unlikely, but updating keeps it consistent and lets us delete the stale `.jpg`.
  - Delete the old `cardforge/images/og-cardforge.jpg` after the three reference updates.
- `cardforge/config.js` — register new endpoint in `apiEndpoints` so `buildApiPath('saveOgImage')` works.
- `staticwebapp.config.json` — route entry for `/api/cardforgesaveogimage`, `allowedRoles: ["anonymous"]` (auth gate is in code, same pattern as every other CardForge endpoint).
- `cardforge/editor.html` — load `cardforge-og.css` + `cardforge-og-composition.js` + `vendor/modern-screenshot.js` (deferred). Bump `?v=` cache-bust token across all changed assets.

### Storage

- Blob: `cardforgeblobdata` container.
- Path: `cardforge/og-cards/{cardId}.png`.
- Public-read (container is already configured for public-read on published card images — same access pattern).
- Cache-busting on the meta tag: `?v={card.updatedAt}` query param. Note: this only helps validators and unprimed clients — most social platforms cache OG images for ~30 days regardless of query string.

## Test plan

**Pre-merge:**

- Manual smoke: publish a freshly created card, hit `/api/cardshare?id=...` directly in browser, view source, confirm `og:image` URL points at the per-card blob and resolves to a 1200×630 PNG.
- Paste the share URL into Twitter Card Validator + LinkedIn Post Inspector + Open Graph Debugger. Confirm preview renders correctly.
- Open `tools/og-baker.html` and cycle through 5–6 published cards covering: long name, no avatar, legacy schema (no `combatStats`), CORS-blocked avatar (e.g. an imgur URL), known-good "hero" card. Eyeball each composition for layout integrity.
- Confirm static brand OG renders correctly on `index.html`, `gallery.html`, `faq.html`, `roadmap.html`, `deck.html`, `devlog.html`, `editor.html` after first bake. Use `curl -I` to confirm the file exists at the deployed path.

**Post-merge:**

- Watch product analytics for `og_capture_failed` events. If rate > 5%, schedule a follow-up to investigate (likely candidates: CORS, missing `decode()` await, race with glow animation).

**No automated tests in v1.** Visual fidelity is human-judgment territory; OG validators are external services. Worth revisiting if a regression slips through.

## Risks & known gotchas

- **CORS on avatar images.** External portraits (imgur, etc.) without permissive CORS headers will render as blank in the captured PNG. Capture technically succeeds so the broken-portrait OG ships. v1 accepts this; v2 candidate is a tainted-canvas check that triggers fallback to static brand OG, OR an image proxy that re-hosts external images.
- **Social platform OG caching.** Twitter/LinkedIn/Facebook cache OG images for ~30 days. Re-publishes won't update social cards until the platform refreshes. Unavoidable, not specific to our impl. Document for support; CEO can use validators to force-refresh known shares.
- **Capture timing.** Card DOM uses CSS animations (glow, ember field) and image filters. Composition MUST wait for `requestAnimationFrame` × 2 + nested `img.decode()` promises before capture, otherwise effects render mid-frame.
- **Bundle size impact on editor.** Adding `modern-screenshot` (~40KB) + composition JS/CSS (~10KB combined) to editor.html. Loaded deferred; not on critical path. Acceptable.
- **HEAD-per-share cost.** `/api/cardshare` adds one blob HEAD per request. ~30–80ms on Linux Consumption. If `/api/cardshare` traffic spikes, candidate v2 optimization is to store a boolean `hasOgImage` on card metadata and skip the HEAD.

## Out of scope / explicitly deferred

- Satori server-side fallback for capture failures.
- Backfilling existing published cards.
- Per-page OG variants beyond per-card vs static brand.
- Auto-bake brand OG on cron.
- Tainted-canvas detection / image proxy for CORS-blocked avatars.
- Storing `hasOgImage` on card metadata to skip the HEAD probe.

These are tracked here so they don't get lost; they are NOT part of this ship.
