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

Your task: build the Seasons dashboard described in §4 of the handoff.

It is a company module page that answers "is this economy measuring anything real?" — not a
vanity leaderboard. Four panels: season header (with an honest "unscored season" state),
standings with the revenue-XP-vs-churn split, effort vs outcome, and the attribution trace
with its unattributed counter (100% today). If you only get one panel done, make it effort
vs outcome — that's the one that would have surfaced our funnel problem weeks ago.

Copy modules/company/agent-progress.html + js/agent-progress.js as the template (pure
functions in a separate JS file with node tests, matching how the engine was built). All the
data comes from one call to GET /api/agentRewards. Register the page with one line in
modules/company/js/sidebar.js.

Before you write code: brainstorm the panel design with me and get my approval on the plan.
Read §3 of the handoff (Hazards) before touching any state — several of those cost us real
incidents today, especially that POST /api/company-state is full-replace with no merge.

This repo auto-pushes to production within minutes of a commit, so verify before you commit:
run the test suites, and check any live change against real state rather than assuming.
```

## Why this prompt is shaped this way
- Points at ONE document as the source of truth rather than restating everything (the handoff is already precise).
- Names the task and the success criterion (which panel matters most) so scope survives a context squeeze.
- Front-loads the hazards, because every one of them cost time or caused an incident today.
- Asks for a design checkpoint before code — the dashboard has real design choices (what "unscored season" looks like, how to show the split) that are cheaper to settle in conversation.
- States the deploy risk explicitly: this repo pushes to a live autonomous fleet.
