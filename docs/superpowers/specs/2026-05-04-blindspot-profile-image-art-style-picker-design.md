# Blindspot Profile Image — Art Style Picker

**Date:** 2026-05-04
**Status:** Approved (design)
**Owner:** CEO + Claude

## Goal

Add a user-controlled "Art Style" picker to the Blindspot profile image generator modal so players can choose the visual style of their AI-generated profile portrait, rather than always receiving the current hardcoded "painterly fantasy or cyberpunk" look.

## Context

- Phase D (commit `617719373`) shipped the profile image generator modal: textarea + "Surprise Me" + Generate, calling `content-quick-generate` with a fixed style fragment baked into the prompt.
- Players have no way to pick a different visual style. Every generated portrait reads the same.
- This spec adds a small, scoped style selector — no rework of the modal, no server changes, no persistence.

## Affected Files

- `ambientpixels/blindspot/play.html` — modal markup (lines 1616–1653)
- `ambientpixels/blindspot/js/lib/bs-profile-image.js` — state, handlers, prompt builder (~line 143)

## UI

Added inside the existing `bs-profile-image-modal`, between the textarea and the action buttons:

- **Label:** "Art Style"
- **`<select id="bs-pim-style">`** — 8 options (7 presets + `Other (custom)`)
- **Shuffle button** (`#bs-pim-shuffle-style`) — small dice icon next to the select; re-rolls to a new random preset (never lands on `Other`)
- **Custom input** (`#bs-pim-style-custom`) — hidden by default; revealed only when `Other` is selected. Plain text input, no validation beyond trim/length cap (140 chars).

The existing **Surprise Me** button keeps its current behavior — re-rolls the description textarea only. No rename, no relocation.

## Style List

```js
const ART_STYLES = [
  { id: 'anime',      label: 'Anime',          fragment: 'anime illustration, cel shaded, expressive linework' },
  { id: 'photoreal',  label: 'Photoreal',      fragment: 'photorealistic portrait, cinematic lighting, sharp focus' },
  { id: 'oil',        label: 'Oil painting',   fragment: 'oil painting, thick brushstrokes, classical portrait composition' },
  { id: 'watercolor', label: 'Watercolor',     fragment: 'watercolor painting, soft washes, paper texture' },
  { id: 'pixel',      label: 'Pixel art',      fragment: 'pixel art portrait, 16-bit style, limited palette' },
  { id: 'comic',      label: 'Comic / ink',    fragment: 'comic book ink art, bold outlines, halftone shading' },
  { id: 'cyberpunk',  label: 'Cyberpunk',      fragment: 'cyberpunk neon-lit portrait, synthwave colors, high contrast' },
  { id: 'other',      label: 'Other (custom)', fragment: null }
];
```

## Behavior

| Event | Behavior |
|---|---|
| Modal open | Pick a random style from the 7 presets (excludes `other`); set as initial dropdown value. Custom input stays hidden. |
| User selects `Other` | Reveal `#bs-pim-style-custom` text input below the dropdown. Focus it. |
| User selects any preset | Hide `#bs-pim-style-custom`. |
| User clicks shuffle button | Pick a new random preset (excluding the currently selected one and `other`). Update dropdown. Hide custom input if visible. |
| User clicks Surprise Me | Unchanged — re-rolls description textarea only. |
| User clicks Generate | Read selected style. Resolve to a fragment (preset → `fragment`; `other` → trimmed custom text). Build prompt and call `content-quick-generate`. |

## Prompt Plumbing

Current prompt (around `bs-profile-image.js:143`):

```js
const fullPrompt = 'Player profile portrait: ' + prompt;
// ...with style hint hardcoded elsewhere as "painterly fantasy or cyberpunk style"
```

New prompt:

```js
const styleFragment = resolveStyleFragment(); // preset.fragment OR custom input text
const fullPrompt =
  'Player profile portrait: ' + prompt
  + '. Art style: ' + styleFragment
  + '. Square composition, centered face and upper body.';
```

The hardcoded "painterly fantasy or cyberpunk" fragment is removed so it can't conflict with the user's choice. The "square composition, centered face and upper body" hint stays — it's framing, not style.

If `Other` is selected and the custom input is empty/whitespace, fall back to a random preset's fragment (don't send a malformed prompt). No error UI for this edge case — silent fallback.

## Out of Scope

- Persisting last-used style (default is Random per session).
- Changing the description textarea or Surprise Me semantics.
- Server-side changes to `content-quick-generate`.
- Style presets beyond the 7 listed; future additions are a separate change.
- Visual preview of styles (no thumbnails, no examples).
- Localization of style labels.

## Risks / Edge Cases

- **Empty custom input on `Other`** — handled by silent fallback to a random preset.
- **Style fragment fights the user's freeform description** — acceptable; the user is opting into both. Don't try to detect or merge.
- **Modal re-open** — fresh random pick each time per the agreed default. Users who want sticky behavior can ask for it later as a follow-up.

## Success Criteria

- Dropdown renders inside the modal with all 8 options.
- Random preset is selected on each modal open.
- Shuffle button changes the selection without lingering on the previous value or landing on `Other`.
- `Other` reveals/hides the custom input correctly.
- Generated images visibly differ across styles for the same description prompt (manual smoke test: generate "a tall warrior with a red cape" in Anime, Pixel art, and Photoreal — they should look distinctly different).
- No regression to Surprise Me or Generate flows.
