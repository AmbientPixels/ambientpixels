# Nova Voice — Dashboard Module Variant (Design Spec)

**Date:** 2026-06-12
**Status:** Approved design
**Type:** Dashboard module (`/modules/company/voice.html`)
**Parent feature:** `docs/superpowers/specs/2026-06-10-nova-voice-design.md`

## Summary

A compact operator-console version of Nova Voice for the authenticated company
dashboard. Same tool as the public lab page (`/lab/nova-voice.html`) but in a
console layout that leads with the orb instead of a marketing hero. Lives at
`/modules/company/voice.html`, which the route config already gates behind the
`authenticated` role — so it is password-protected with no auth work.

## Decisions (from brainstorm 2026-06-12)

- **Keep the Monolith look** — orb, teal transcript, mono labels carry over unchanged.
  The module is a deliberate Monolith DS island inside the (older, Inter-based)
  dashboard. The orb IS the brand of this tool.
- **Reuse, don't fork** — `js/nova-voice.js` and `css/nova-voice.css` are shared
  between the lab page and the module. The JS is entirely ID-based and
  layout-agnostic, so the module reuses it unchanged as long as it carries the same
  element IDs. One source of truth; a fix to either surface fixes both.
- **Lab page stays orphaned** — it is linked from nowhere today (verified). Leave it
  as an unlisted public test surface for now; retire it in a later follow-up once the
  module is verified (it is the unthrottled public surface flagged in the parent spec).

## Architecture

**New file: `/modules/company/voice.html`** — compact console, top-down:

1. `‹ Back to HQ` link (mirrors `agent-chat.html`'s back-link pattern, links to
   `/modules/company/`).
2. One mono header line: `§ NOVA VOICE — TALK TO THE CREW`.
3. Agent switcher row (`#nova-voice-agents`, 8 agents).
4. Orb (`#nova-voice-orb`) + mood/status line (`#nova-voice-mood`) + hint
   (`#nova-voice-hint`).
5. Type-to-talk fallback (`#nova-voice-fallback` + `#nova-voice-input` +
   `#nova-voice-send`).
6. Teal transcript (`#nova-voice-log`) filling the rest.

Element IDs are identical to the lab page so `js/nova-voice.js` drives it unchanged.

**Stylesheets:** Monolith DS (`ap-tokens.css`, `ap-base.css`, `ap-components.css`) +
shared `css/nova-voice.css`. The page root carries a `nova-voice--compact` class.

**New CSS (additive, in `css/nova-voice.css`):** a `.nova-voice--compact` modifier
that tightens `.nova-voice-stage` for the console — drops the hero-tuned top
spacing (`padding-top`, `margin-top`, `border-top`) and centers the stage in the
viewport with comfortable padding. The lab page is unaffected (it does not carry the
modifier).

**Nav wiring:** add a `Voice` `.hq-nav-pill` to the dashboard index quick-nav row
(`/modules/company/index.html`), e.g. `fa-microphone` icon.

## Data flow

Identical to the parent feature — `js/nova-voice.js` calls `POST /api/agentchat`
(`mode:'chat'`, per-agent) and `POST /api/nova-voice-tts` (per-agent voice). No new
endpoints. The authenticated context makes the proactive greeting even more apt
(it is the operator's own console).

## Error handling

Inherited from `js/nova-voice.js` unchanged: no-SpeechRecognition → type-to-talk
fallback, mic-denied → fallback + disabled orb, agentchat error → glitch line, TTS
failure → text-only note, greeting 25s abort.

## Out of scope

- No JS changes (reuse only).
- No dashboard-DS restyle of the orb (Monolith island is the chosen look).
- Retiring the lab page (separate follow-up).
- Server-side confirm, session persistence, operational mood (parent backlog).

## Testing

- Playwright against local server: module renders compact (orb above the fold, no
  hero), agent switching works, transcript + scrollbar render, fallback path works.
- Post-deploy: load `/modules/company/voice.html` (authenticated), confirm orb +
  greeting + a per-agent round trip; confirm the HQ nav pill links correctly.
