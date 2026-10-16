# Handoff: HQ simplification — start here

**Date:** 2026-10-16 · **From:** the session that ran the board cleanup, the routing fix and the HQ evaluation.

## Read these, in this order
1. `docs/superpowers/plans/2026-10-16-hq-simplification-plan.md` — **the plan you execute** (phases 0–6, files, checks).
2. `docs/superpowers/specs/2026-10-16-hq-evaluation-and-plan.md` — the evaluation and evidence behind it.
3. Memory: `project_hq_evaluation_2026_10_16`, `project_board_cleanup_2026_10_16`, `project_video_desk`.
4. The `ambientos-design` skill (AmbientOS v1.1 tokens and primitives — the kit is built on these).

## Where things stand
- **Shipped tonight:** routing by role to agents that run + handoff + no dead-end hero gate + directive guard +
  capacity due dates (`15d1f5c9`); one shared "overdue" rule everywhere (`bc0e02b2`); 34 stale campaigns archived and the
  board cleaned (data, backups in `C:/Dev/Ambientpixels/state-backup-2026-10-16-*.json`); evaluation (`b2240704`).
- **Live board:** one goal (`obj-build-public`), two active campaigns (Monthly Journal, Weekly Scoreboard), ~25 open
  tasks mostly Scribe's, 0 overdue after re-dating. Pixel and Cipher dormant.
- **Decisions Chad took for this plan** are listed at the top of the plan doc — don't re-ask them.
- **Not built yet:** everything in the plan. Phase 0 is first.

## Rules for this work
- Plan rigor and working rules from memory apply: search before creating, no inline styles, Playwright screenshots
  (`chromium.launch({channel:'msedge'})`) before claiming any visual change, stage by path (another session may be
  editing the same checkout — seen editing video-desk/task-mutations/studio on 10-16), re-diff before committing.
- Chad's standing permission: commit and push after verifying; full autonomy on this approved plan; still confirm
  anything destructive to prod data.
- Do-not-touch exceptions approved for this plan only: `api/company-state/index.js` (read-error branch, task 0.3) and
  `api/companyHeartbeat/index.js` (persist points, task 3.4). Nothing else in either file.
- Never write HB-owned keys 00/06/12/18 UTC :00–:12.

## Kickoff prompt (paste into a new session)

> We're simplifying AmbientPixels HQ. Read `ambientpixels/docs/superpowers/handoffs/2026-10-16-hq-simplification-kickoff.md`
> and the plan it points to (`docs/superpowers/plans/2026-10-16-hq-simplification-plan.md`), plus my memory files it
> names. The decisions are already made — don't re-ask them. Start with **phase 0** (stop pages writing on load, no
> write before sync, a failed read is never empty, saves report the truth), then **phase 1** (the shared metrics,
> `/api/hq-summary`, the 8-component HQ kit, the **Today** page, the 6-item rail landing on Today). Verify each task as
> the plan says (tests, Playwright screenshots at 1440 and 390, network tab shows no writes on load), commit and push
> per task, and show me the Today page when phase 1 is live. Keep it calm and simple — that's the whole point.
