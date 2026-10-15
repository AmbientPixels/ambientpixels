# Handoff: fold the video team into the Design department (under Pixel)

**Date:** 2026-10-15 · **Status:** direction set by Chad, nothing built yet · **Read first:** the Video Desk spec
`docs/superpowers/specs/2026-10-14-video-desk-design.md` §8–9 (what exists today).

## Chad's direction (2026-10-15, end of a long session)

"It feels a bit disconnected." The video team "has its own process, its own studio" — it should be **onboarded more
permanently with the rest of the agents** and be **part of the Design department under Pixel**, not a separate
Video department.

He was tired and not sure of the details: **plan this with him first, don't build from this note.**

## What exists today (live)

- The Studio crew (8 roles: Editor/director, Writer, Researcher, Transcriber, Sound designer, Screen editor, Animator,
  Finisher) works as Claude Code sessions on Chad's PC, with its own Board (`tracker.json`) in the local Studio.
- In AmbientOS it is the "Video department": assignee `studio` on the company task board, a section on the HQ Fleet
  page, `video_request` tasks that Nova/Echo/Scout file on code-verified triggers (major release, won bet, new
  campaign), comments both ways (@Quill claims check, @Echo launch posts), Release Watcher, demand ledger.
- The studio worker (`node harness/worker.mjs`) links the two and is **not running**; no request has ever gone end
  to end.

## Why it feels disconnected (diagnosis offered to Chad)

1. Two homes: the work happens in the PC Studio, the company face is in HQ, joined only by a background worker.
2. Two boards: one video = 1 company task + 11 Studio Board tasks.
3. Not part of how the company runs: Nova doesn't plan with it; not in standups, objectives, campaigns, rewards; the
   crew doesn't appear the way agents do.
4. Never run for real: zero requests, worker stopped — nothing to see.

## Facts that shape the design

- **Pixel is DORMANT** since 2026-10-06 (removed from `AGENT_IDS`, with Cipher). Design = Pixel's department
  (`data/company-agents.json`: department "Design"; divisions frontend, qa, …). Putting video under Pixel likely means
  waking Pixel with video in its job — a fleet change (heartbeat cost, prompt size, agent registry) → Chad's call.
- Pixel already owned the old `generate-video` action (Veo character clips), which is dead (missing from
  `KNOWN_ACTION_TYPES`). A revived Pixel's video role should replace that, not sit beside it.
- The site says "Eight agents"; Chad decided earlier there is no new agent for video. Folding video under Pixel keeps
  that true.
- Agent rules hold only when they are code (prompt rules lose to objectives) — keep the trigger/rarity gates.

## Open questions for the next session

1. Wake Pixel as head of Design + Video, or keep Pixel dormant and make Design a home without a live head?
2. What does Pixel actually do for video: triage requests, write briefs, review drafts, own the catalogue/demand?
3. One board: should the company task board carry the whole video (stages as subtasks/status) so the Studio Board
   mirrors it, instead of two boards?
4. Do the crew roles become Design-department divisions (shown with the agents), or stay Studio-internal?
5. Does the studio worker start with the Studio (always on when the PC is), and how is "PC offline" shown in HQ?
6. Run one real request end to end (e.g. the approved AmbientScore walkthrough) so the loop is visible.

## Kickoff prompt

> Read `ambientpixels/docs/superpowers/handoffs/2026-10-15-video-team-into-design.md` and the Video Desk spec §8–9.
> Chad wants the video team folded into the Design department under Pixel and onboarded like the rest of the fleet.
> Pixel is dormant. Walk Chad through the open questions one at a time, recommend an answer for each, and agree a
> plan before changing any code.
