# My Published Tabs — Design

**Date:** 2026-04-24
**Status:** Approved (brainstorming complete)
**Author:** CEO + Claude
**Phase:** 1

## Problem

Cards and decks published from CardForge become public on the splash/gallery, but the user has **no per-user view of "what I have made public"**. There is also no escape hatch — once published, a non-admin cannot remove their own card or deck without admin help. Users on a fresh browser cannot recover their own published content into their working state.

The deck builder Collection panel was just patched (commit `fa649a0a9`) to surface the user's published cards under "My Collection" by filtering `galleryCards` by `publishedBy`. That covers the *deck-building* case. It does not address management or visibility of what is currently public.

## Goals

- Give the signed-in user a clear view of every card and deck they have published.
- Provide an **unpublish** action so removal does not require admin intervention.
- Provide an **edit-and-republish** round-trip so users on a fresh device can recover their work and iterate.
- Reuse existing endpoints — no new APIs.

## Non-goals (Phase 1)

- Analytics: view counts, last-viewed, popularity ranking.
- Bulk select / batch unpublish.
- Sort or filter beyond search-by-name.
- Visibility states (unlisted, private published).
- Any change to the publish flow itself.

## Scope

Two new tabs, in two places:

| Tab | Lives in | Source |
|---|---|---|
| **My Published Cards** | `editor.html` Forge sidebar, between `My Cards` and `Deck Manager` | `/api/cardforgeloadcards` → `galleryCards` filtered by current user |
| **My Published Decks** | `deck.html` as a top-level view toggle (`Builder` / `My Published`) | `/api/cardforgedeckload` (no shareId) → `publishedDecks` filtered by current user |

Both tabs require sign-in. Empty / signed-out states are explicit.

## Architecture

### Data sources (all existing)

```
GET /api/cardforgeloadcards
  → response.galleryCards[]
  → filter: c.publishedBy === myUserId
            || c.cardData?.publishedBy === myUserId
            || c.userId === myUserId
            || c.cardData?.userId === myUserId
  (multiple field checks cover legacy entries)

GET /api/cardforgedeckload
  → response.publishedDecks[]
  → filter: d.userId === myUserId
```

### Mutation paths (all existing)

```
POST /api/cardforgedeletecard   { cardId, userId }   — owner-gated
POST /api/cardforgedeckdelete   { shareId, userId }  — owner-gated
```

Both endpoints already authorize via `extractUserInfo()` against the principal and accept the owner's userId for the resource. No backend work.

### User-id retrieval

All client code uses the existing `_cfGetAuthHeaders()` helper. The principal is parsed out of the cached `X-CF-Auth-Principal` header value:

```js
const headers = await window._cfGetAuthHeaders();
let myUserId = null;
try {
  const p = JSON.parse(headers['X-CF-Auth-Principal'] || '{}');
  myUserId = p.userId || null;
} catch (_) {}
```

## UI

### Editor — new Forge sidebar tab

Insert between the existing `My Cards` and `Deck Manager` tabs:

```html
<button class="forge-sidebar-tab"
        data-forge-tab="published"
        aria-selected="false"
        tabindex="-1"
        title="My Published Cards">
  <span class="tab-pip" id="my-published-pip"></span>
  <i class="fas fa-share-from-square"></i>
  <span class="tab-label">My Published</span>
  <span class="tab-badge" id="my-published-count"></span>
</button>
```

Tab content section mirrors the My Cards layout (search input + scrollable list using `mini-card-scaler` for thumbnails). Each row:

- Thumbnail (`renderedFront` from gallery payload, fallback to portrait)
- Card name
- "Published {relative date}" subtitle
- Action row: **✏ Load into editor** · **🗑 Unpublish**

### Deck builder — top-level view toggle

The deck builder currently has two boot modes (`bootViewMode` for `?shareId=`, `bootBuilderMode` default). Add `bootMyPublishedMode()` and route from URL param `?view=published` or a new tab in the existing `db-bar`:

```
db-bar:  [CardForge wordmark]  [Deck Builder] [My Published]   [Save] [Publish]
```

My Published view: deck-card grid, reusing the `db-view-grid` pattern. Each tile shows:

- Deck name + icon
- Card count
- Publish date
- Action row: **✏ Load into builder** · **🗑 Unpublish**

### Empty + signed-out states

| State | Cards tab | Decks view |
|---|---|---|
| Signed-out | "Sign in to see what you've published." | Same |
| Empty (signed in, none published) | "You haven't published any cards yet. Publish from the editor's Ship tab." | "You haven't published any decks yet. Publish from the deck builder." |
| Loading | spinner + "Loading…" | spinner + "Loading…" |
| Network error | "Couldn't load. Retry." with retry button | Same |

## Round-trip behavior

Per Q4-A: load published item as a working copy; save/publish overwrites the matching source by id.

### Card "Load into editor"
1. Hydrate the published `cardData` into the editor's `ModularState` via the existing card-load path used by My Cards click-to-load.
2. Switch the Forge sidebar to `My Cards` tab — visual cue that the user is now editing.
3. Mark editor dirty (existing dirty-state mechanism).
4. On Save → overwrites local same-id source (or creates if missing).
5. On Publish → overwrites gallery same-id (today's behavior).

### Deck "Load into builder"
1. Each `cardforge_decks` localStorage entry stores its publish state (most likely a `shareId` field set after publish — implementation plan to confirm during code read). Use that link, not raw id equality, to find a local match for a published `shareId`.
2. If a local match exists → navigate `deck.html?edit={localDeckId}` (existing path).
3. Otherwise → hydrate snapshot into a fresh builder state, generate a new local id, but preserve the snapshot's `shareId` on the new local entry so a subsequent Publish overwrites the same gallery slot.
4. Save → localStorage `cardforge_decks` overwrite by local id.
5. Publish → gallery overwrite by shareId.

### Why this avoids conflict UI
- Local "source" and gallery "snapshot" share the same id.
- Local source is the working copy; gallery snapshot is the canonical published state.
- Loading the snapshot rehydrates the working copy. Saving syncs them. Republishing syncs gallery. No diverged-state prompts needed.
- If a user has truly diverged versions and wants to preserve both, they can rename + duplicate manually.

## Caching

Two new localStorage keys, mirroring the splash gallery cache pattern:

```
cf_my_published_cards_v1  → { savedAt: <ms>, items: [...] }
cf_my_published_decks_v1  → { savedAt: <ms>, items: [...] }
```

- Render from cache instantly on tab open.
- Refresh from API in background; re-render only if signature differs (id list).
- Invalidate on:
  - Successful publish (any source — listen for a new `cardforge:my-published-changed` `CustomEvent` on `window`).
  - Successful unpublish from this tab.

The custom event is dispatched by `cardforgeforgeactions.publishCard()`, `publishDeck()`, the existing `cardforgedeletecard` flow, and the new unpublish handlers.

## Files

### New JS
- `cardforge/js/cardforge-my-published-cards.js` — fetch, render, action handlers for the editor tab. Wires into the existing Forge sidebar tab-switch handler in `cardforge-forge-actions.js` (or wherever the My Cards tab activation lives).
- `cardforge/js/cardforge-my-published-decks.js` — same shape, for the deck builder. Exports a `bootMyPublishedMode()` function that the deck builder router calls.

### Modified
- `cardforge/editor.html` — new tab markup in `.forge-sidebar-nav` + new `<section class="forge-tab-content" data-forge-content="published">` block.
- `cardforge/deck.html` — load the new published-decks JS, add a slot for the toggle if needed.
- `cardforge/js/cardforge-deck-builder.js` — add `bootMyPublishedMode()`, route from `?view=published` URL param + tab click.
- `cardforge/js/cardforge-forge-actions.js` — dispatch `cardforge:my-published-changed` after `handlePublishCard()` and `publishDeck()` succeed.
- `cardforge/css/cardforge-ui.css` — minimal additions for the published-tab action-button row + danger-styled unpublish button.
- `cardforge/css/cardforge-deck-builder.css` — minimal additions for the My Published view toggle in the db-bar.

### No changes
- Backend / Azure Functions — zero changes.
- `staticwebapp.config.json` — no new routes.

## Verification

1. **Smoke (cards)**: Sign in. Publish a card from the editor's Ship tab. Open My Published Cards → see it with thumbnail + publish date + correct count badge.
2. **Unpublish (cards)**: Click Unpublish on a card → confirm modal → POST succeeds → card disappears from list. Hard-reload splash → it no longer appears in the hero fan.
3. **Round-trip (cards)**: Load a published card into editor → edit name → Save → My Cards reflects edit; My Published still shows old version. Click Publish from editor → My Published refreshes (via `cardforge:my-published-changed`) and shows the new name.
4. **Cross-browser (cards)**: Publish from browser A. Sign in as same user on browser B → My Published lists the card. Click Load into editor → My Cards rehydrates the local state with that card.
5. **Smoke / Unpublish / Round-trip / Cross-browser (decks)**: same four flows on the deck side.
6. **Empty + signed-out states**: verify each renders correctly.
7. **Cache**: open My Published twice in one session → second open renders instantly from cache, then background refresh runs.

## Open questions (for implementation plan to resolve)

1. **Deck local-id ↔ shareId mapping** — confirm whether `cardforge_decks` entries already carry a `shareId` field after publish; if not, the deck publish handler needs to write it back so Load-into-builder can find local matches.
2. **Forge sidebar tab activation hook** — confirm the exact entry point in `cardforge-forge-actions.js` (or wherever the My Cards tab handler lives) so the new published-cards module can lazy-load on first activation.
3. **Cache-bust letter after `z`** — current sequence has burned through `t→u→y→z` on 2026-04-24. Either start a new date stamp (`v=20260425a`) or use a double-letter (`v=20260424za`). Pick during planning.

Phase 2 may revisit visibility states, analytics, and bulk actions.

## Cache-bust

Single shared bump from `v=20260424z` → `v=20260424zz` (or rotate to `aa` per the convention) on:
- `editor.html` (all `?v=` references)
- `deck.html` (all `?v=` references)
- The two new JS files reference themselves at the new version.
