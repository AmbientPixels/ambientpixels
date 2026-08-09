# Instagram — scoping, and the blocker that stops it being an afternoon

**Status:** NOT BUILT. Blocked on a credential decision that is the CEO's, not a session's.
**Date:** 2026-08-09
**Prerequisite reading:** `2026-08-09-facebook-and-video-handoff.md`, `2026-08-09-video-pipeline.md`

---

## The blocker, found by probing before scoping

The handoff says *"@ambientpixels2022 is a Business account linked to the Page and the same
Meta app covers it."* **I could not confirm any part of that, and one part is definitely false.**

Probed with the live Page token:

| Probe | Result |
|---|---|
| `GET /{page}?fields=instagram_business_account` | field **absent from the response** |
| `GET /{page}/instagram_accounts` | `{"data":[]}` — empty, and **not** an error |
| `GET /debug_token` scopes | `email, read_insights, pages_show_list, business_management, pages_read_engagement, pages_manage_metadata, pages_read_user_content, pages_manage_posts, pages_manage_engagement, facebook_creator_marketplace_discovery, facebook_branded_content_ads_brand, public_profile` |

**The token has no `instagram_basic` and no `instagram_content_publish`.** Instagram publishing
is therefore impossible with this credential no matter what code gets written. That part is
certain.

What is *not* certain is whether the account is linked at all. Graph omits fields you lack
permission for instead of erroring, so the missing `instagram_business_account` could be either
"not linked" or "not visible to you". `instagram_accounts` came back empty without an error,
which points at not-linked — but that is the legacy ads edge and can be empty even when a
Business account is properly connected. **Say which nothing you mean: this is "unverified",
not "confirmed absent".**

That distinction is the whole reason to stop here. The last channel scoped on an unverified
audience claim was Facebook, where the "existing followers" turned out to live on a personal
profile the API cannot post to at all. The rule that came out of it — *verify the audience
asset exists and is API-reachable BEFORE scoping a channel* — applies to its own next
sentence.

### What unblocks it

Re-run the Meta OAuth flow requesting `instagram_basic` + `instagram_content_publish`, then
re-probe `instagram_business_account`. If it returns an id, the account is linked and reachable
and the plan below is real work. If it returns nothing, the IG account needs connecting to the
Page in Meta Business Suite first, and **it has 0 followers either way**.

**Note, not a re-litigation:** granting scopes issues a *new* Page token as a side effect of
re-consent. That is a mechanical consequence of adding permissions, not the security rotation
the CEO declined — that decision stands and is not being reopened. It does mean the new token
must be written to the Function App app settings and `FB_PAGE_TOKEN.txt`, and that the
`data_access_expires_at` clock restarts (currently **2026-11-07T03:21:14Z**, confirmed by probe
this session — the handoff's date was exactly right).

---

## The shape problem, and how a post gets its image

Instagram cannot post text-only. The pipeline is text-first: Echo briefs, Scribe writes copy,
Quill reviews, CEO approves *words*. Nothing in that chain produces an image, and
`payload.media` is optional everywhere else.

Three ways to close that gap. **Recommend A as the default.**

### A. Render the copy onto a brand card, server-side, $0 — RECOMMENDED

`satori` + `@resvg/resvg-js` are already dependencies and already proven in production by
`api/pixel-agent-share-card/index.js`, which renders a 1200×630 PNG with a bundled
Space Grotesk face and **no browser** — the exact constraint that blocks video compositing in
the Function App does not apply to still images.

- New `api/_lib/contentEngine/cardEngine.js`, sibling of `imageEngine`/`videoEngine`.
- Render at **1080×1350 (4:5)** — the tallest ratio IG feed allows, so the most phone screen.
- `sharp` (already a dep) converts PNG → **JPEG**, which is what the IG container endpoint wants.
- Upload to a **public** blob container with the exact `_uploadBlob` +
  `createIfNotExists({ access: 'blob' })` pattern `videoEngine.js` uses. IG fetches the image
  itself from a public URL, the same way `facebook.js` hands `/videos` a `file_url`.
- Cost **$0**. Deterministic. No AI, so no new fabrication surface — the card shows the copy the
  CEO already approved, and nothing else.

**Carry the line-break lesson across.** The video spec records a deliberate 3-line hook becoming
5 visual lines with two words stranded, because the renderer was allowed to re-wrap. The card
renderer must honour the author's explicit breaks rather than reflowing to fit.

**Inherit the public-container warning too.** `videoEngine` notes that if that container is ever
made private, publishing starts failing with a *Facebook-side fetch error* that points nowhere
near the container. Same failure mode here.

### B. Generate an image with `imageEngine` — for specific campaigns only

~$0.039/post, already priced in `IMAGE_COST_PER_IMAGE`. Rejected as the default: it needs a
prompt per post, drifts off-brand, and adds an asset that can assert something the approved copy
does not. Keep it available as an override.

### C. Reuse an existing blog hero — free, narrow

Works only when the post promotes an article that already has a hero image. Good override, not a
default. See the link problem below for why this is narrower than it looks.

---

## The link problem — a pipeline constraint, not a detail

**Instagram captions do not render clickable links.** The post-shapes work (2:1
engagement:link per campaign+platform, `task.post_shape`) means link-shaped posts exist
specifically to carry a URL. On Instagram that URL is dead text.

So the shape selector must never hand Instagram a `link` shape. Either IG receives only
`engagement` shapes, or link posts are rewritten to a "link in bio" form — which then requires
somebody to actually maintain the bio link. **Decide this before the adapter, or the channel
ships a steady stream of unclickable URLs and the funnel attributes zero to it correctly and
for the wrong reason.**

---

## Publishing shape

Two calls, not one:

1. `POST /{ig-user-id}/media` with `image_url` + `caption` → returns a **container id**
2. `POST /{ig-user-id}/media_publish` with `creation_id` → publishes

Images are effectively immediate, so both fit inside one execution and Azure's 230s HTTP kill is
not a factor. **Reels are different** and need the store-operation-id-and-poll-later shape the
video spec already describes — do not try to do that inline.

Idempotency needs care the other adapters did not: a container created but never published is
invisible and costs nothing, but a *retry* that re-creates the container and publishes both is a
double post. Follow `facebook.js`'s content-hash receipt check, and treat "container created,
publish outcome unknown" as **needs_manual_review**, never as retry — same rule that
`actionsScheduler`'s stuck-execution path already enforces.

---

## Every list that must change in the same commit

The Facebook rollout was bitten twice by exactly this, once by a stale SKIP list
(`_manualPlatforms`) and once — found today, ~35h before it would have fired silently — by an
ALLOW list that lives in an **env var** where no grep would find it. Adding Instagram touches:

| Location | Kind |
|---|---|
| `SOCIAL_PLATFORMS_ENABLED` (Function App app setting) | ALLOW — **not in the repo** |
| `actionsScheduler/index.js` `_manualPlatforms` | SKIP |
| `actionsExecute/executors/index.js` registry | ALLOW |
| `actionsExecute/index.js:240` enabled-platform gate | ALLOW |
| `socialEngagementPull/index.js` `SOCIAL_PLATFORMS` | ALLOW |
| `socialMetrics/telemetry.js` `SOCIAL_PLATFORMS` | ALLOW |
| `engagementInbox/index.js` `coverage` | disclosure |
| `socialAccountStats/index.js`, `social-intel.js` (×4), `research-intel.js` | ALLOW |
| `campaign-lifecycle.js` `_validTaskTypes` + assignee map | ALLOW |
| `prompt-builders.js` `_schemaEnum`, `_socialPlatformMap`, taskType lists (lines ~230, ~1935, ~1958, ~2355) | **prompt enum** |

**The prompt enum ships in the same commit as the handler.** A capability wired in the executor
whose enum was never touched is invisible to the agent forever.

Minor pre-existing drift noticed while mapping this: `agent-runner.js:1796` `_platNames` lists
linkedin/x/bluesky/reddit but **not facebook**, so a Facebook task renders an undefined platform
name in that message. Small, unrelated, worth sweeping when someone is next in that file.

---

## Recommended order

1. **CEO:** re-consent with `instagram_basic` + `instagram_content_publish`; re-probe
   `instagram_business_account`. Everything below is dead until this returns an id.
2. Decide the link-shape question above.
3. `cardEngine.js` + tests, rendered and **looked at** before anything is called done.
4. Adapter + the full list sweep + prompt enum, one commit.
5. Feed images only. Reels are phase 2 and need the video pipeline, which is still
   local-only for anything with text burned in.

**Reels remain the actual prize** — they reach non-followers, which Facebook Pages structurally
do not, and that is the one surface where starting at 0 followers is not a dead end. That is an
argument for doing this eventually, not for doing it before the token can see the account.
