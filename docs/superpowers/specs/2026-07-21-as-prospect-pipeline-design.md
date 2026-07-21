# AmbientScore Outbound Prospect Pipeline (v1) — Design

**Date:** 2026-07-21
**Status:** Approved by CEO (chat session 2026-07-21)
**Goal:** Turn the fleet loose on lead generation. Find people who just launched a site and asked for feedback, run a real AmbientScore audit of their site, and reply to their post with one grounded finding plus a free shareable report link. Every send is CEO-approved.

**Why now:** The `First Paying Customer` objective (deadline 2026-07-31) sits at 0 with 14 lifetime public scans. The funnel audit verdict was a TRAFFIC problem. The scan machinery (`run-ambientscore-scan` → `asScanQueue` → `asScanRunner`) has existed since the revenue pivot and has fired **zero times** because nothing supplies agents with real prospect URLs. This pipeline supplies them deterministically.

## Decisions (CEO-confirmed)

1. **Channel: Bluesky replies only.** Rides the existing discovery → Scribe → quality gate → CEO approval → AT-Protocol reply rails. No email infra in v1.
2. **Targeting: launch/feedback intent.** People actively posting "just launched", "feedback welcome", "redesigned my portfolio". They asked for eyes on their site — lowest spam-feel, highest receptivity.
3. **Autonomy: full-auto to the approval queue.** Discovery, scanning, and draft-spawning run without CEO touch. The CEO's single touchpoint is approve/reject on the send.

## Architecture

One new timer function **`api/asProspectCron/`** (NCRONTAB every 2 hours, offset from the hourly heartbeat, e.g. `0 20 */2 * * *`), pure-core + IO shell — the same isolation pattern as `proposalGeneratorCron`, `reflectionWriterCron`, `rewardsEngineCron`, and Milestone Herald. Zero edits to `companyHeartbeat/index.js`.

Each run, three passes:

```
Pass 1 — DISCOVER
  blueskyDiscovery sweep with the launch-intent keyword set
  → extract site URL (post text regex + record.facets links + embed.external.uri)
  → junk filters (own domains, aggregators/shorteners, big-brand blocklist,
    non-http(s), post older than 24h, engagement floor)
  → dedup vs asProspects (author ever touched, domain 30d) + existing
    bluesky_reply task 7d dedup
  → new asProspects entry (status: discovered)
  → for the top qualifying prospects within caps:
      create bluesky_reply task  (status: BACKLOG, assignee: scribe,
        source: 'asProspectCron', dueDate +3d, threadContext {uri,cid,author,text},
        description = fact sheet: verbatim post text + site URL + instructions)
      queue scan in asScanQueue { url, taskId } (existing 7d dedup + queue cap 20)
      status → scan_queued

Pass 2 — PROMOTE
  for prospects with status scan_queued:
    find their asScanQueue job
    job.status done  → flip task backlog → todo (Scribe drafts next heartbeat,
                       scan comment with score/findings/report link is already
                       on the task courtesy of asScanRunner)
                       status → task_ready, stamp scanScore + reportId
    job.status error → task → done with system note, status → dismissed

Pass 3 — TRACK / PRUNE
  task done + reply action approved/posted → status sent (stamp actionId)
  Scribe declined (empty deliverable path)  → status declined
  entries older than 60d or dismissed >14d  → pruned
  asProspects capped at 300 (FIFO)
```

**Why backlog→todo two-phase:** Scribe must never draft before the scan facts exist on the task. Backlog tasks are invisible to agent execution; the cron promotes only after `asScanRunner` has commented score + findings + shareable link. Cron-created tasks carry `source: 'asProspectCron'` (≠ 'heartbeat') plus assignee + dueDate, which rides the existing "CEO/manual task" triage exception — no Nova-triage wait.

**Downstream is untouched, existing rails:** `asScanRunner` (runs audit, stores `cc_report_<id>`, comments on task), Scribe's `bluesky_reply` drafter (founder voice, sentence-case, 280-char cap, declines spam via empty deliverable), quality gate on reply text (auto-reject ≥70% confidence + rewrite loop), approval queue `kind: 'bluesky_reply'` (renders thread quote + draft + View Thread), Bluesky reply executor (AT-Protocol root/parent uri+cid).

## State & config

### `asProspects` (new state key, cron-owned, cap 300)

```js
{
  id: 'pros_<ts>_<rand>',
  uri, cid, author, authorDid,          // from discovery candidate
  postText,                              // verbatim, for the fact sheet
  siteUrl, domain,
  discoveredAt,
  status: 'discovered' | 'scan_queued' | 'task_ready' | 'sent'
        | 'declined' | 'dismissed',
  scanScore: null | number,              // stamped at promote
  reportId: null | string,
  taskId: null | string,
  actionId: null | string                // stamped when reply action created/sent
}
```

Written ONLY by `asProspectCron`. Not a company-state VALID_KEY concern — add it to VALID_KEYS so the dashboard/scripts can read it (read-only surface).

### Config — `systemConfig.asProspecting` (runtime-tunable, merge semantics)

```js
{
  enabled: true,                         // kill switch
  keywords: [ ...launch-intent set... ], // overrides file default
  maxScansPerDay: 3,
  maxDraftsPerDay: 2,
  maxQueuedProspects: 10,                // discovered-but-unscanned backlog cap
  minEngagement: 1,                      // floor: likeCount + replyCount >= 1
  maxPostAgeHours: 24,
  domainCooldownDays: 30
}
```

Defaults live in `api/_data/as-prospect-keywords.json` (same fallback pattern as `bluesky-discovery-keywords.json`). Starter keyword set: "just launched", "we launched", "launched my", "i built", "new website", "redesigned my site", "redesigned my portfolio", "portfolio feedback", "roast my landing page", "feedback on my site", "site feedback welcome", "check out my new site".

### Junk filters (Pass 1)

- Own properties: `ambientpixels.ai`, `*.azurestaticapps.net` (self-promo loop guard)
- Shorteners/aggregators: bit.ly, t.co, linktr.ee, lnk.bio, youtube.com, github.com (repo ≠ website), twitter/x.com, bsky.app, medium.com, substack.com (platform pages score meaninglessly)
- Big-brand blocklist: domains with major-site profiles (heuristic list in the data file; editable)
- Non-http(s) or unparseable URL
- Author already in `asProspects` (any status) — one touch per author, ever

## Anti-spam / brand-safety posture

- **3 scans/day, 2 outreach drafts/day** (tunable; both enforced by the cron, counted per UTC day from `asProspects` timestamps — deterministic, no separate counter key).
- Silence-default: nothing qualifying → the cron does nothing (Milestone Herald rule).
- Every send is CEO-approved. `bluesky_reply` is not in the auto-publish grace path and stays out of it.
- The reply NEVER pitches the $29 directly. It leads with one specific finding and links the free report (score + top findings visible, rest paywalled — the report does the selling).
- Scribe retains the explicit right to decline (existing empty-deliverable path) — the cron treats a decline as terminal for that prospect.

## Grounding (no invented claims)

The task description embeds a **fact sheet** (Milestone Herald pattern):

```
PROSPECT FACT SHEET (use ONLY these facts + the scan comment below)
- Their post (verbatim): "<postText>"
- Their site: <siteUrl>
- You are replying AS the AmbientPixels founder account.
Rules: reference one specific finding from the scan comment; include the free
report link from the scan comment; do not mention pricing; do not claim we
"reviewed" anything the scan did not measure; founder voice, no em dashes.
```

The scan comment (already generated by `asScanRunner`) supplies: score, grade, top findings, shareable report URL. Report URLs on ambientpixels.ai get UTM injection via the existing action rails, so report views attribute back to the reply action in the funnel.

## Error handling

| Failure | Behavior |
|---|---|
| Bluesky auth/search fails | Log + exit run (non-fatal); next run retries. Same posture as Scout discovery. |
| Scan job errors | `asScanRunner` already comments the failure on the task; cron Pass 2 marks prospect `dismissed`, closes the task with a system note. No draft. |
| Scan queue full (20) | Prospect stays `discovered`; retried next run. |
| Scribe declines | Prospect `declined`, task done (existing path). Never retried. |
| Quality gate rejects draft | Existing rewrite loop on the task; cron does nothing (task stays in flight). |
| Cron crash mid-run | All writes idempotent per prospect id + status transitions; next run reconciles from state. |
| `enabled: false` | Cron exits immediately, logs one line. |

Governance events (via helpers `logEvent`, so they hit the new archive too): `prospect-discovered` (per batch, with count), `prospect-outreach-ready` (per promoted task). Volume is tiny (≤3/day) — no FIFO pressure.

## Testing

- **Pure cores** exported for test: `extractSiteUrl(candidate)` (text regex + facets + embed), `filterProspects(candidates, existing, config)` (junk filters + dedup + caps), `promoteReady(prospects, scanQueue)` (status transitions). Unit tests in `api/asProspectCron/asProspectCron.test.js`, node:assert style, run with `node api/asProspectCron/asProspectCron.test.js`.
- **Manual trigger**: `POST /api/as-prospect-trigger` (x-company-secret gated) mirrors the reflection/rewards trigger pattern for live verification without waiting 2h.
- **Smoke path**: trigger with `maxScansPerDay` temporarily satisfied by a known-good test post/URL, verify: prospect entry → scan queued → (10 min) scan comment → promote → Scribe drafts next heartbeat → approval queue entry renders.
- **Success metrics** (existing surfaces, no new dashboards): `as-funnel` `scans.agent` > 0 for the first time ever; approval queue shows `bluesky_reply` drafts; report views with `utm_content=<actionId>`; eventually `as_leads` / `revenueLedger` joins.

## Explicitly NOT in v1

Outbound email, follow-up sequences, DMs, non-Bluesky prospect sources, auto-send/grace-window inclusion, ML lead scoring, a dedicated dashboard page (prospects are visible via the task board + approval queue; a Bluesky-discovery-style dashboard tile is a later stage), backfill of historical launch posts.

## Files touched (implementation preview)

| File | Change |
|---|---|
| `api/asProspectCron/index.js` + `function.json` | NEW — the cron (pure cores + IO shell) |
| `api/asProspectCron/asProspectCron.test.js` | NEW — unit tests |
| `api/as-prospect-trigger/` | NEW — manual trigger endpoint |
| `api/_data/as-prospect-keywords.json` | NEW — keyword + blocklist defaults |
| `api/_utils/blueskyDiscovery.js` | ADDITIVE — capture `record.facets` link targets + `embed.external.uri` on candidates |
| `api/company-state/index.js` | ONE LINE — add `asProspects` to VALID_KEYS (read surface). High-blast file: explicit, minimal, CEO-approved via this spec |

No heartbeat edits. No changes to asScanRunner, Scribe's drafter, quality gate, approval queue, or executors.
