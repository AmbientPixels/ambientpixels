# Copy-paste prompt to start the next session

Paste the fenced block below as the first message of a new Claude Code session.

```
Read ambientpixels/docs/superpowers/handoffs/2026-07-31-revenue-focus-handoff.md first —
it is the record of what shipped and what's next. Also load the agent-rewards skill and the
memories project_revenue_seasons, project_revenue_first_retune, and
project_seed_memory_truncation.

Context in one line: yesterday we shipped a revenue-first XP economy ("Revenue Seasons"),
retuned the entire agent memory stack to match, and built a Seasons dashboard. The company
earned its first $398 and cannot explain where it came from — 62 fleet actions in a week
produced 0 leads and 0 public scans.

Start with these two, in order:

1. VISUAL CHECK (5 min). modules/company/seasons.html is built, its pure functions are
   node-tested, and its logic was verified against live production data — but it has never
   been seen in a browser, because everything under /modules/company/ is auth-gated and the
   CLI cannot confirm rendering. Open https://ambientpixels.ai/modules/company/seasons.html
   logged in, confirm the four panels populate and the layout holds, and fix what's off.
   §4 of the handoff lists the exact values you should see. Expect CSS/layout only.

2. TRACK C — retirement knowledge inheritance. Agent prompts already tell agents "your
   successor would inherit your memories" and that is not true yet. Design it before the
   first retirement draft can fire (earliest 2026-10-01, CEO-gated). Brainstorm the design
   with me and get approval before writing code.

Read §3 of the handoff (Hazards) before touching any state. Several of those cost real
incidents: POST /api/company-state is FULL REPLACE with no merge (it destroyed
systemConfig.heartbeatModel once), approveProposal takes `id` not `proposalId`, and
`doctrine` is replaced wholesale on approve.

This repo auto-pushes to production within minutes of a commit, and the fleet spends real
money on a 2-hour heartbeat. Verify before you commit: run the test suites (engine 73,
dashboard 13, smoke 25) and check live changes against real state rather than assuming.
```

## Why this prompt is shaped this way
- Points at ONE document as the source of truth instead of restating it, so it cannot drift.
- Leads with the smallest highest-certainty task (the visual check) so the session starts with a win and closes the one genuinely unverified thing.
- Names the honest limitation — the dashboard was never rendered — rather than implying it is done.
- Front-loads the three hazards that actually caused incidents, with the specific consequence of each.
- States the deploy risk plainly: auto-push, live autonomous fleet, real money.
- Asks for a design checkpoint on Track C, which has real architectural choices (what a successor inherits, and how consent/pruning works).
