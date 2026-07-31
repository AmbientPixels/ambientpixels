# Copy-paste prompt to start the next session

Paste everything in the fenced block below as the first message of a new Claude Code session.

```
Read ambientpixels/docs/superpowers/handoffs/2026-07-31-revenue-focus-handoff.md first —
it is the record of what shipped today and the plan for what's next. Also load the
agent-rewards skill and the memories project_revenue_seasons, project_revenue_first_retune,
and project_seed_memory_truncation.

Context in one line: we shipped a revenue-first XP economy ("Revenue Seasons") and retuned
the whole agent memory stack today. The company earned its first $398 and cannot explain
where it came from — 62 fleet actions last week produced 0 leads and 0 public scans.

Your first task: the Seasons dashboard is BUILT (modules/company/seasons.html +
js/seasons.js, 13 tests green, logic verified against live data) but has never been seen in
a browser — everything under /modules/company/ is auth-gated, so I could not confirm it
renders. Open https://ambientpixels.ai/modules/company/seasons.html while logged in, check
the four panels populate and the layout holds, and fix whatever is off. The data layer is
proven; expect CSS/layout issues only. §4 of the handoff lists the exact values you should
see.

After that, pick up §5 (open items) — most valuable next is Track C, retirement knowledge
inheritance: agent prompts already promise "your successor would inherit your memories" and
that is not yet true.

Read §3 of the handoff (Hazards) before touching any state — several of those cost us real
incidents today, especially that POST /api/company-state is full-replace with no merge.
For anything substantial, brainstorm the design with me and get approval before writing code.

This repo auto-pushes to production within minutes of a commit, so verify before you commit:
run the test suites, and check any live change against real state rather than assuming.
```

## Why this prompt is shaped this way
- Points at ONE document as the source of truth rather than restating everything (the handoff is already precise).
- Names the task and the success criterion (which panel matters most) so scope survives a context squeeze.
- Front-loads the hazards, because every one of them cost time or caused an incident today.
- Asks for a design checkpoint before code — the dashboard has real design choices (what "unscored season" looks like, how to show the split) that are cheaper to settle in conversation.
- States the deploy risk explicitly: this repo pushes to a live autonomous fleet.
