# Prospect reply attribution — UTM on the outbound sales channel

**Date:** 2026-07-31 · **Status:** proposed, awaiting CEO approval. Changes what is sent to real prospects.

## 1. The problem

100% of the company's revenue ($398, two AmbientScore Teardowns) is unattributed. That is not a rewards-engine bug — it is the designed-in consequence of the only channel that talks to buyers being untracked.

UTM coverage across the 62 fleet actions of the last week:

| Action type | `utm_content` coverage |
|---|---|
| `social_post.schedule` | 23/24 |
| **`social_post.reply`** | **0/24** |
| `research_intel.approve` | 0/8 (no link, n/a) |
| `publish_document` | 0/6 (n/a) |

Prospect replies carry a personalised report link — `https://ambientpixels.ai/ambientscore/report.html?id=ccr_...` — and **no UTM parameters at all**.

Revenue Seasons attributes a sale by matching `utm_content` to the originating social action id, then walking to `actions[].created_by` plus the parent task's assignee/reviewer (`rewards-engine.js:390`). With no `utm_content` on the outbound channel, a sale originating from prospect outreach can never be attributed. It falls through to the 50%-to-recent-campaign-assignees fallback, which is what paid Echo 168 / Scribe 148 by guesswork.

**Why the agents cannot fix this themselves.** The link is minted without UTM in `api/asScanRunner/index.js:73`, and `api/companyHeartbeat/quality-gate.js:204` *requires* report links be "copied EXACTLY from the [SCAN RESULT] comment". A deterministic repair (`_repairReplyLink`, `agent-runner.js:2120`) then rewrites any link the drafter invented back to the exact scan link. The system is deliberately built so the drafter cannot alter this URL — correctly, since an invented report link is a fabrication. So the fix must be a system-side stamp, not a prompt change.

## 2. Prior art — the scheduled-post path already solves this

`agent-runner.js:3313-3328` injects UTM at action-creation time, once `newAction.id` exists:

```js
const _utmS = _resolvedPlatform;
const _utmC = newAction.id;
newAction.payload.text = String(newAction.payload.text || '').replace(
  /https?:\/\/(?:www\.)?ambientpixels\.ai(?:\/[^\s)]*)?/gi,
  function (_url) {
    if (_url.indexOf('utm_') !== -1) return _url;
    const _sep = _url.indexOf('?') !== -1 ? '&' : '?';
    return _url + _sep + 'utm_source=' + ... + '&utm_content=' + ...;
  }
);
```

It is non-fatal, skips already-tagged URLs, and its `_sep` logic already handles a URL that carries `?id=...`. This is the behaviour to reuse — not reinvent.

## 3. The hazard that makes this non-trivial

**A naive copy of that block will silently truncate the report link out of prospect replies.**

- The reply text is capped at **280 chars** (`agent-runner.js:2110`), with Bluesky's real limit at 300.
- The UTM suffix is `&utm_source=bluesky&utm_content=<reply action id>`. Reply ids have the form `act_<13-digit ms>_bsreply_<5 chars>` (`agent-runner.js:2152`) — 31 chars — so the suffix is **~63 chars**.
- 280 + 63 = **~343**, over the 300 cap. The executor would tail-chop, and the thing chopped off the end is the report link, because the link is last in every observed reply.

The scheduled-post path already learned this: it reserves headroom *before* composing (`_utmReserve`, `agent-runner.js:3064`) and re-trims URL-preservingly *after* injection (`agent-runner.js:3333`). Memory `project_social_char_limit_fix` records the same rule — any new post-trim text mutation needs a re-trim.

## 4. Design

Inject UTM on the reply path immediately after the reply action id is minted (`agent-runner.js:2151-2152`), and make room for it.

1. **Reserve headroom at composition.** Lower the 280-char truncation at `agent-runner.js:2110` by the UTM reserve, computed the same way the scheduled path computes it, rather than hard-coded — so it tracks any future change to id format or platform name.
2. **Inject after the id exists**, reusing the exact regex and `utm_` guard from `agent-runner.js:3313-3328`. `utm_source=bluesky`, `utm_content=<_replyActionId>`.
3. **Re-trim URL-preservingly** with `_trimSocialToLimit` after injection, so a reply that is still over cap loses prose, never the link.
4. **Non-fatal.** A failure in the injection must leave the reply text untouched and postable — an untracked reply is worse than no reply only in measurement, not in revenue.

### Explicitly not changed

- `asScanRunner/index.js:73` keeps minting the bare canonical link. That link is quoted into the `[SCAN RESULT]` task comment and compared verbatim by the quality gate and `_repairReplyLink`. Adding UTM at the mint site would mean the QG's exact-match comparison is against a URL carrying another action's id — wrong, and it would break link repair.
- `quality-gate.js` keeps its fabricated-URL detector unchanged. **Correction to an earlier assumption in this spec:** the stamp actually runs *before* the gate, not after — it has to, because the tag must be in the text before the length is settled. That is safe because the detector does not compare against the `[SCAN RESULT]` link at all; it validates the *path* against `_OWN_URL_ALLOWLIST` (`quality-gate.js:156-171`), and `/^\/ambientscore\/report\.html\?id=ccr_[\w]+/` carries no end anchor, so a trailing `&utm_...` still matches. Verified: `detectFabricatedUrl` returns `fabricated: false` on the stamped link, identical to the untagged one, and `composeQualityVerdict` passes with no issues. The prompt text at `quality-gate.js:204` telling agents to copy links exactly is also untouched — it constrains the *drafter*, and the drafter still does not touch the URL.
- `social_post.schedule` is untouched — it already works.

## 5. How we will know it worked

- Next prospect reply action stores a `payload.text` whose report link carries `utm_source=bluesky&utm_content=act_..._bsreply_...`, and whose total length is ≤300.
- The link still resolves to the same `ccr_` report id as the `[SCAN RESULT]` comment — the repair path is unaffected.
- On the next sale originating from outbound, `revenueDigest.attributedRevenueCents` is non-zero and the Seasons dashboard's attribution panel drops below 100% unattributed.

## 6. Testing

`_trimSocialToLimit` and the UTM injection are both string transforms and testable without IO:

- A reply with a `?id=ccr_...` link gains `&utm_source=&utm_content=` (ampersand, not `?`).
- A reply whose link already contains `utm_` is left unchanged (idempotent — a re-draft must not double-stamp).
- A 280-char reply plus UTM is re-trimmed to ≤300 **with the full report link intact**, prose lost instead.
- A reply containing no ambientpixels.ai link is unchanged.
- A malformed/empty payload does not throw.

## 7. Out of scope — tracked separately

**The reply dedup guard is too narrow, and it is a live bug.** `agent-runner.js:2137` blocks a re-draft only when an existing reply for the same `_parentTaskId` has `approval.status === 'pending'`. Once a reply is approved and executed it no longer matches, so a second draft proceeds. Evidence: the guard landed 2026-07-24 10:40 (`0a9eb9ec`) in response to the fruitfop duplicate, yet `zimpirate.bsky.social` still received near-duplicate outreach at 2026-07-28 02:02 and 12:01. 3 of 21 `sent` prospects have duplicate outreach. Separate root cause, separate fix.

## 8. Related

- `docs/superpowers/specs/2026-07-30-revenue-seasons-design.md` — the attribution chain this feeds.
- Memories `project_revenue_seasons`, `project_social_char_limit_fix`, `project_as_prospect_pipeline`, `project_prospect_reply_qg_gap`.
