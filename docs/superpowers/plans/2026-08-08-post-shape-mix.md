# Post Shape Mix Implementation Plan (Phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every third scheduled social post a link post and the other two campaign-flavored no-link engagement posts, decided per campaign + platform, so we stop publishing the single most algorithmically demoted shape (prose + link) uniformly on every platform.

**Architecture:** A pure shape-selection module (`_lib/socialCopy/shape.js`) decides `{kind: 'link'|'engagement', variant}` from the campaign's shape profile and the recent shape history for that campaign + platform. The decision is made once at the Scribe copy-brief choke point in `agent-runner.js`, persisted as `task.post_shape`, and every downstream URL gate (the create-social-action hard block, the AUTO-POST URL auto-append) respects it. Campaign data carries the editorial profile (build-in-public asks questions; Resume Roast makes a craft point — CEO decision 2026-08-08).

**Tech Stack:** Node.js (CommonJS), Azure Functions heartbeat, hand-rolled test runners (`node path/to/file.test.js`).

> **Committed markdown under `docs/` is served publicly as raw text.** No secrets, no balances, no client names in this file.

---

## Why (decisions already made — do not relitigate)

Measured 2026-08-08: 195 posts → 65 interactions in 4 months, 79–89% zero engagement, and volume is disproven (3.6x output halved per-post engagement). CEO decisions 2026-08-08:

1. No-link variants are **campaign-aware**: build-in-public → question posts; Resume Roast → craft points. Random variant within the campaign's set. Never product-focused.
2. Ratio **2 engagement : 1 link**, inside existing volume.
3. LinkedIn stays; goal is driving engagement there (question shapes + founder-side manual levers). No LinkedIn comment API exists — do not design around one.
4. Native media deferred.
5. Success = follower delta + engagement rate (already in `socialWeeklySnapshots`); clicks only for link posts.

Prior art shipped earlier today (commit `b40d1885`): per-platform `linkPolicy` in `_lib/socialCopy/voice.js`, enforced by `validate.js` (dead code until the worker is wired — the LIVE path is Scribe via the brief this plan edits).

## Pipeline facts this plan is built on (verified 2026-08-08)

- Social tasks are born mainly by campaign auto-replenish (`companyHeartbeat/campaign-lifecycle.js:162-248`), platform chosen by least-count rotation over `allowedTaskTypes`; the task's `taskType` (`social_bluesky|social_x|social_linkedin`) IS the platform carrier.
- **All campaign social tasks converge at the Scribe copy-brief site** (`agent-runner.js:~2677-2756`) before any copy exists. That is where shape is decided.
- Two action-creation paths exist: `create-social-action` (`agent-runner.js:~3291`) and the **AUTO-POST path in `companyHeartbeat/index.js:3529-3550`** — the latter is the live scheduled-post funnel.
- Three places enforce/inject the URL today and each needs a shape-aware bypass:
  1. Hard block: `agent-runner.js:3063-3070` (`if (!hasUrl) continue`)
  2. Silent auto-append: `index.js:3407-3413` (appends a URL when text lacks `ambientpixels.ai`) — **this one is in a do-not-touch file; Task 4 requires the CEO's explicit approval of that single edit and touches nothing else in the file**
  3. Campaign data: `camp-resume-roast-launch.description` says "Every post MUST include that URL" and is injected into Scribe's brief as CAMPAIGN POSTING RULES
- The quality gate does NOT require a URL (verified: zero URLs → all deterministic flags false, pass). UTM injection and `_repairBareHomepageUrl` only rewrite existing URLs, never add one.
- The `destinationUrl` / `[SCAN RESULT]` injection traps are on the Bluesky **reply** lane only (`agent-runner.js:2052-2074`); campaign post tasks never carry them. Engagement tasks must keep it that way.

## Explicitly out of scope (Phase B, its own plan)

**X link-in-first-reply (shape 4).** `x.js` already threads replies (`buildTweetBody`), but a two-tweet action must be recovery-safe, and `actionsExecute` has an OPEN stuck-execution cause (2026-08-08 duplicate-post incident: "outcome unknown must never mean retry"). Building a two-post public action on a scheduler with that cause open is how you post twice. Until Phase B ships, X link posts keep the URL in the body — X still improves because 2 of its 3 weekly posts become no-link.

Also out of scope: media generation, LinkedIn comment API, any new posting volume, any approval-gate change.

---

## File structure

| Path | Responsibility |
|---|---|
| `api/_lib/socialCopy/shape.js` | NEW. Pure shape selection: profile defaults, 2:1 rotation, seeded variant pick, engagement brief lines, history extraction. No I/O. |
| `api/_lib/socialCopy/shape.test.js` | NEW. Tests for all of the above. |
| `api/companyHeartbeat/agent-runner.js` | Decide + persist `task.post_shape` at the copy-brief site; branch the brief's URL requirement; shape-aware URL hard block. Three surgical edits. |
| `api/companyHeartbeat/index.js` | **ONE condition added** to the AUTO-POST URL auto-append (Task 4, CEO-gated). |
| campaigns state (data, not a file) | `shapeProfile` on the two social campaigns + Resume Roast description rewrite (Task 5 script, GET-first read-modify-write). |

---

## Task 1: The shape module

**Files:**
- Create: `api/_lib/socialCopy/shape.js`
- Test: `api/_lib/socialCopy/shape.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/_lib/socialCopy/shape.test.js`:

```js
// Run with: node api/_lib/socialCopy/shape.test.js
// Shape selection decides which posts carry a link. Getting the rotation wrong
// either re-creates the all-ads feed we are escaping, or starves the one
// conversion post the campaign objective is measured on.
const assert = require('assert');
const { pickPostShape, shapeKindsFromTasks, engagementBriefLines, DEFAULT_PROFILE, VARIANT_GUIDANCE } = require('./shape');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

t('a campaign with no history opens with engagement, not an ad', function () {
  const s = pickPostShape({ recentKinds: [], seed: 'task-1' });
  assert.strictEqual(s.kind, 'engagement');
  assert.ok(s.variant, 'engagement shape must carry a variant');
});

t('two engagement posts in a row make the third a link post — the 2:1 ratio', function () {
  const s = pickPostShape({ recentKinds: ['engagement', 'engagement'], seed: 'task-2' });
  assert.strictEqual(s.kind, 'link');
});

t('after a link post the cycle restarts with engagement', function () {
  const s = pickPostShape({ recentKinds: ['engagement', 'engagement', 'link'], seed: 'task-3' });
  assert.strictEqual(s.kind, 'engagement');
});

t('a link shape carries no variant', function () {
  const s = pickPostShape({ recentKinds: ['engagement', 'engagement'], seed: 'task-4' });
  assert.strictEqual(s.variant, undefined);
});

t('linkEvery is honored, including the every-post escape hatch', function () {
  assert.strictEqual(pickPostShape({ profile: { linkEvery: 1 }, recentKinds: [], seed: 'a' }).kind, 'link');
  assert.strictEqual(pickPostShape({ profile: { linkEvery: 2 }, recentKinds: ['engagement'], seed: 'b' }).kind, 'link');
  assert.strictEqual(pickPostShape({ profile: { linkEvery: 2 }, recentKinds: ['link'], seed: 'c' }).kind, 'engagement');
});

t('linkEvery of 0 means never link — and a falsy zero must not fall back to the default', function () {
  // (opts.x || DEFAULT) discarding a legitimate 0 bit us twice on 2026-08-08.
  const s = pickPostShape({ profile: { linkEvery: 0 }, recentKinds: ['engagement', 'engagement', 'engagement'], seed: 'd' });
  assert.strictEqual(s.kind, 'engagement');
});

t('the variant comes from the campaign profile and is deterministic per seed', function () {
  const profile = { engagementVariants: ['question'] };
  const a = pickPostShape({ profile, recentKinds: [], seed: 'task-x' });
  assert.strictEqual(a.variant, 'question');
  const b1 = pickPostShape({ recentKinds: [], seed: 'same-seed' });
  const b2 = pickPostShape({ recentKinds: [], seed: 'same-seed' });
  assert.strictEqual(b1.variant, b2.variant, 'same seed must give the same variant');
  assert.ok(DEFAULT_PROFILE.engagementVariants.includes(b1.variant));
});

t('shapeKindsFromTasks filters by campaign + platform and sorts by createdAt', function () {
  const tasks = [
    { id: 'c', campaign_id: 'camp-1', taskType: 'social_x', post_shape: { kind: 'link' }, createdAt: '2026-08-03' },
    { id: 'a', campaign_id: 'camp-1', taskType: 'social_x', post_shape: { kind: 'engagement' }, createdAt: '2026-08-01' },
    { id: 'other-campaign', campaign_id: 'camp-2', taskType: 'social_x', post_shape: { kind: 'link' }, createdAt: '2026-08-02' },
    { id: 'other-platform', campaign_id: 'camp-1', taskType: 'social_bluesky', post_shape: { kind: 'link' }, createdAt: '2026-08-02' },
    { id: 'unshaped', campaign_id: 'camp-1', taskType: 'social_x', createdAt: '2026-08-02' },
    { id: 'superseded', campaign_id: 'camp-1', taskType: 'social_x', _revision_superseded: true, post_shape: { kind: 'link' }, createdAt: '2026-08-02' }
  ];
  assert.deepStrictEqual(shapeKindsFromTasks(tasks, 'camp-1', 'social_x'), ['engagement', 'link']);
});

t('engagement brief lines forbid links AND override campaign URL rules', function () {
  const lines = engagementBriefLines('question');
  assert.ok(/do not include any url/i.test(lines), 'must forbid URLs');
  assert.ok(/overrides any campaign rule/i.test(lines), 'campaign descriptions still say "MUST include that URL" until the data task runs — the brief must out-rank them');
  assert.ok(lines.includes(VARIANT_GUIDANCE.question), 'variant guidance must be included');
  assert.ok(/never invent/i.test(lines), 'the truth rule is the fabrication guard');
});

t('an unknown variant still produces a safe brief instead of undefined', function () {
  const lines = engagementBriefLines('no_such_variant');
  assert.ok(!/undefined/.test(lines));
  assert.ok(/do not include any url/i.test(lines));
});

console.log('\nshape tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node api/_lib/socialCopy/shape.test.js`
Expected: FAIL — `Cannot find module './shape'`

- [ ] **Step 3: Write the implementation**

Create `api/_lib/socialCopy/shape.js`:

```js
// shape.js — decides what KIND of post a social task becomes. Pure: no I/O.
//
// Until 2026-08-08 every scheduled post had one shape: prose + product link —
// the single most demoted shape on X and LinkedIn (195 posts, 65 interactions,
// 79-89% zero engagement). The CEO-approved mix is 2 no-link engagement posts
// per 1 link post, per campaign per platform, with the engagement variant
// following the campaign: build-in-public asks questions, Resume Roast makes
// a craft point.
//
// The decision is made ONCE per social task (at the Scribe copy-brief site in
// agent-runner.js) and persisted as task.post_shape so the downstream URL
// gates can tell "no link by design" from "the model dropped the link".

const DEFAULT_PROFILE = {
  engagementVariants: ['craft_point', 'question'],
  linkEvery: 3   // every 3rd post carries the link — the 2:1 ratio
};

const VARIANT_GUIDANCE = {
  question: 'End with ONE genuine question you actually want answers to. Ask about the reader\'s experience, not about our product. No rhetorical bait.',
  craft_point: 'Make ONE specific, useful point the reader can apply today. Lead with the specific, not the theme.',
  build_note: 'Share ONE concrete thing from building this company: what was built, what broke, or what it cost. Real numbers only.'
};

// djb2 — deterministic so the same task always picks the same variant, which
// keeps retries stable and tests honest. Math.random would break both.
function _hash(s) {
  let h = 5381;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * @param {object} opts
 *   opts.profile     campaign.shapeProfile (optional; defaults apply)
 *   opts.recentKinds prior shape kinds for this campaign+platform, oldest first
 *   opts.seed        stable string (the task id) for the variant pick
 * @returns {{kind:'link'}|{kind:'engagement',variant:string}} plus decidedAt
 */
function pickPostShape(opts) {
  opts = opts || {};
  const p = opts.profile || {};
  const variants = (Array.isArray(p.engagementVariants) && p.engagementVariants.length)
    ? p.engagementVariants : DEFAULT_PROFILE.engagementVariants;
  // Number.isFinite, not ||: linkEvery 0 legitimately means "never link".
  const linkEvery = Number.isFinite(p.linkEvery) ? p.linkEvery : DEFAULT_PROFILE.linkEvery;
  const recent = Array.isArray(opts.recentKinds) ? opts.recentKinds : [];

  let kind = 'engagement';
  if (linkEvery === 1) {
    kind = 'link';
  } else if (linkEvery > 1) {
    const windowKinds = recent.slice(-(linkEvery - 1));
    const dueForLink = windowKinds.length === (linkEvery - 1)
      && windowKinds.every(function (k) { return k === 'engagement'; });
    if (dueForLink) kind = 'link';
  }

  if (kind === 'link') return { kind: 'link', decidedAt: new Date().toISOString() };
  const variant = variants[_hash(opts.seed) % variants.length];
  return { kind: 'engagement', variant: variant, decidedAt: new Date().toISOString() };
}

// History for the rotation, extracted from the live tasks array. Archived
// tasks age out of this — acceptable, the rotation window is only
// (linkEvery - 1) entries deep.
function shapeKindsFromTasks(tasks, campaignId, taskType) {
  return (Array.isArray(tasks) ? tasks : [])
    .filter(function (t) {
      return t && !t._revision_superseded && t.campaign_id === campaignId
        && t.taskType === taskType && t.post_shape && t.post_shape.kind;
    })
    .sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); })
    .map(function (t) { return t.post_shape.kind; });
}

// The brief lines that replace "MUST include the product URL" for engagement
// posts. The override sentence out-ranks campaign descriptions that still
// mandate a URL (camp-resume-roast-launch does until the data task updates it).
function engagementBriefLines(variant) {
  const guidance = VARIANT_GUIDANCE[variant] || VARIANT_GUIDANCE.craft_point;
  return '- THIS IS A NO-LINK ENGAGEMENT POST. Do NOT include any URL. Do NOT name or pitch any product. No call to action. This rule OVERRIDES any campaign rule about including a URL.\n'
    + '- ' + guidance + '\n'
    + '- Truth rule: only say things that are true — evergreen craft advice or numbers we have actually measured. NEVER invent an anecdote, a statistic, or a customer.\n';
}

module.exports = { pickPostShape, shapeKindsFromTasks, engagementBriefLines, DEFAULT_PROFILE, VARIANT_GUIDANCE };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node api/_lib/socialCopy/shape.test.js`
Expected: PASS — `shape tests: 10 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add api/_lib/socialCopy/shape.js api/_lib/socialCopy/shape.test.js
git commit -m "Decide post shape per campaign and platform: 2 engagement posts per link post"
```

---

## Task 2: Decide and persist the shape at the copy-brief site

**Files:**
- Modify: `api/companyHeartbeat/agent-runner.js` (copy-brief site, ~2682-2733)

`agent-runner.js` is fragile and actively developed. Anchor on exact CONTENT, never on line numbers.

- [ ] **Step 1: Anchor check — run before editing**

```bash
for a in "let _cmpContext = '';" "const _cmpUrl = _cmpUrlMatch || _descUrlMatch || 'https://ambientpixels.ai';" "MUST include the product URL: ' + _cmpUrl" "const copyTask = {" "tasks.push(copyTask);"; do
  printf "%-70s %s\n" "$a" "$(grep -cF "$a" api/companyHeartbeat/agent-runner.js)"
done
```

Expected: every count is exactly **1**. If any differs, STOP and report — the file has moved and this plan no longer describes it.

- [ ] **Step 2: Capture the campaign OBJECT, not just its description**

Find (inside the copy-brief block):

```js
              let _cmpContext = '';
              if (socialTask.campaign_id) {
                const _cmp = (activeDirectives || []).find(c => c.id === socialTask.campaign_id);
                if (!_cmp) {
                  try { const _cmps = (await storage.getState('campaigns')) || []; const _fc = _cmps.find(c => c.id === socialTask.campaign_id); if (_fc) { _cmpContext = _fc.description || ''; } } catch (_e) {}
                } else { _cmpContext = _cmp.description || ''; }
              }
```

Replace with:

```js
              let _cmpContext = '';
              let _cmpObj = null;   // post-shape profile lives on the campaign object
              if (socialTask.campaign_id) {
                const _cmp = (activeDirectives || []).find(c => c.id === socialTask.campaign_id);
                if (!_cmp) {
                  try { const _cmps = (await storage.getState('campaigns')) || []; const _fc = _cmps.find(c => c.id === socialTask.campaign_id); if (_fc) { _cmpContext = _fc.description || ''; _cmpObj = _fc; } } catch (_e) {}
                } else { _cmpContext = _cmp.description || ''; _cmpObj = _cmp; }
              }
```

- [ ] **Step 3: Decide the shape once, before the brief is built**

Find:

```js
              const _cmpUrl = _cmpUrlMatch || _descUrlMatch || 'https://ambientpixels.ai';
```

Insert immediately AFTER that line:

```js
              // Post shape (2026-08-08): 2 no-link engagement posts per 1 link
              // post, per campaign per platform. Decided ONCE per social task
              // and persisted, so the URL gates downstream (the no-URL hard
              // block below, the AUTO-POST URL append in index.js) can tell
              // "no link BY DESIGN" from "the model dropped the link".
              // QG retries keep the already-decided shape.
              if (!socialTask.post_shape) {
                const _SHAPE = require('../_lib/socialCopy/shape');
                socialTask.post_shape = _SHAPE.pickPostShape({
                  profile: _cmpObj && _cmpObj.shapeProfile,
                  recentKinds: _SHAPE.shapeKindsFromTasks(tasks, socialTask.campaign_id, socialTask.taskType),
                  seed: socialTask.id
                });
                socialTask.updatedAt = new Date().toISOString();
                context.log('[Heartbeat]', agentId, 'post_shape decided for', socialTask.id + ':', socialTask.post_shape.kind, socialTask.post_shape.variant || '');
              }
```

- [ ] **Step 4: Branch the brief's URL requirement on the shape**

Find (one line inside the `copyTask.description` concatenation):

```js
                  + '- MUST include the product URL: ' + _cmpUrl + '\n'
```

Replace with:

```js
                  + (socialTask.post_shape && socialTask.post_shape.kind === 'engagement'
                      ? require('../_lib/socialCopy/shape').engagementBriefLines(socialTask.post_shape.variant)
                      : '- MUST include the product URL: ' + _cmpUrl + '\n')
```

- [ ] **Step 5: Syntax check**

Run: `node --check api/companyHeartbeat/agent-runner.js`
Expected: no output.

- [ ] **Step 6: Verify the diff is surgical**

Run: `git diff --stat api/companyHeartbeat/agent-runner.js`
Expected: one file, roughly 20 insertions, 5 deletions. `grep -c "tasks.push(copyTask)" api/companyHeartbeat/agent-runner.js` must still print **1**.

- [ ] **Step 7: Commit**

```bash
git add api/companyHeartbeat/agent-runner.js
git commit -m "Brief Scribe per post shape: engagement posts carry no link by design"
```

---

## Task 3: Let engagement posts through the no-URL hard block

**Files:**
- Modify: `api/companyHeartbeat/agent-runner.js` (~3063-3070)

- [ ] **Step 1: Anchor check**

```bash
grep -nF "BLOCKED create-social-action — no URL found in post text" api/companyHeartbeat/agent-runner.js
```

Expected: exactly one hit. Zero or two → STOP and report.

- [ ] **Step 2: Make the block shape-aware**

Find:

```js
      const hasUrl = /https?:\/\//.test(postText) || /\{\{ARTICLE_URL[^}]*\}\}/.test(postText);
      if (!hasUrl) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — no URL found in post text. Must include a blog link or https://ambientpixels.ai');
        continue;
      }
```

Replace with:

```js
      const hasUrl = /https?:\/\//.test(postText) || /\{\{ARTICLE_URL[^}]*\}\}/.test(postText);
      // Engagement-shape posts (task.post_shape, 2026-08-08) carry no link BY
      // DESIGN — for them, "no URL" is correct, not a dropped link.
      const _shapeTask = action.taskId ? tasks.find(function (t) { return t.id === action.taskId; }) : null;
      const _isEngagementPost = !!(_shapeTask && _shapeTask.post_shape && _shapeTask.post_shape.kind === 'engagement');
      if (!hasUrl && !_isEngagementPost) {
        context.log('[Heartbeat]', agentId, 'BLOCKED create-social-action — no URL found in post text. Must include a blog link or https://ambientpixels.ai');
        continue;
      }
```

- [ ] **Step 3: Syntax check, then commit**

Run: `node --check api/companyHeartbeat/agent-runner.js` (no output), then:

```bash
git add api/companyHeartbeat/agent-runner.js
git commit -m "The no-URL block must not kill posts that carry no URL by design"
```

---

## Task 4: Stop the AUTO-POST path re-adding the link — ⚠️ CEO-GATED

**Files:**
- Modify: `api/companyHeartbeat/index.js` (~3407-3413) — **do-not-touch file; this task runs ONLY with the CEO's explicit approval of this exact edit, and touches nothing else in the file.**

Without this edit, every engagement post that flows through the live AUTO-POST funnel gets a URL silently appended ("Safety net"), turning a value post back into an ad.

- [ ] **Step 1: Anchor check**

```bash
grep -nF "AUTO-POST: URL missing after trim — appended" api/companyHeartbeat/index.js
grep -nF "if (_rcText.indexOf('ambientpixels.ai') === -1) {" api/companyHeartbeat/index.js
```

Expected: exactly one hit each. Anything else → STOP and report.

- [ ] **Step 2: Add the one condition**

Find:

```js
          // Safety net: ensure post contains an ambientpixels.ai URL — extract from description or use default
          if (_rcText.indexOf('ambientpixels.ai') === -1) {
```

Replace with:

```js
          // Safety net: ensure post contains an ambientpixels.ai URL — extract from description or use default.
          // Engagement-shape posts (task.post_shape, 2026-08-08) carry no link BY DESIGN — appending one
          // here would silently turn a value post into an ad.
          if (_rcText.indexOf('ambientpixels.ai') === -1 && !(_pt && _pt.post_shape && _pt.post_shape.kind === 'engagement')) {
```

- [ ] **Step 3: Verify the diff touches ONLY this site**

Run: `git diff --stat api/companyHeartbeat/index.js`
Expected: one file, ~3 insertions, ~1 deletion. Then `node --check api/companyHeartbeat/index.js` (no output).

- [ ] **Step 4: Commit**

```bash
git add api/companyHeartbeat/index.js
git commit -m "Do not append a URL to posts that carry none by design (CEO-approved scoped edit)"
```

---

## Task 5: Campaign data — shape profiles + Resume Roast description

**Files:** none (state write via `company-state`, GET-first read-modify-write).

Rules: never write heartbeat-owned keys during **:00–:07 UTC** (heartbeat runs 00/06/12/18). Campaigns is read by the heartbeat; write between :10 and :55 of any hour.

- [ ] **Step 1: Run the update script (GET first, verify, write, re-verify)**

```bash
SECRET=$(sed -n 's/^COMPANY_WRITE_SECRET=//p' /c/Dev/Ambientpixels/COMPANY_WRITE_SECRET.txt | head -1 | tr -d '\r\n')
[ -z "$SECRET" ] && SECRET=$(head -1 /c/Dev/Ambientpixels/COMPANY_WRITE_SECRET.txt | tr -d '\r\n')
API="https://ambientpixels-nova-api.azurewebsites.net/api"
node -e "
const API=process.env.API, SECRET=process.env.SECRET;
(async()=>{
  const res=await fetch(API+'/company-state?key=campaigns',{headers:{'x-company-secret':SECRET}});
  const all=(await res.json()).value||[];
  console.log('campaigns:',all.length,'(expect ~37; abort if 0)');
  if(!all.length){console.error('EMPTY READ — refusing to write');process.exit(1);}

  const rr=all.find(c=>c.id==='camp-resume-roast-launch');
  const bl=all.find(c=>c.id==='camp-agent-build-log');
  if(!rr||!bl){console.error('campaign missing — refusing to write');process.exit(1);}

  // Resume Roast: craft points between link posts. Keep the URL in the
  // description — extractProductUrl reads it for the LINK posts' brief.
  const OLD='Every post MUST include that URL.';
  if(rr.description.includes(OLD)){
    rr.description=rr.description.replace(OLD,
      'Post mix: for every three posts on a platform, two are no-link engagement posts (one specific, useful point about resumes or job hunting - no URL, no pitch) and one is a link post that MUST include that URL.');
  } else { console.log('NOTE: URL-mandate sentence not found verbatim — description left unchanged, report this'); }
  rr.shapeProfile={engagementVariants:['craft_point'],linkEvery:3};
  rr.updatedAt=new Date().toISOString();

  // Build-in-public asks questions (CEO 2026-08-08).
  bl.shapeProfile={engagementVariants:['question','build_note'],linkEvery:3};
  bl.updatedAt=new Date().toISOString();

  const w=await fetch(API+'/company-state',{method:'POST',headers:{'Content-Type':'application/json','x-company-secret':SECRET},body:JSON.stringify({key:'campaigns',value:all})});
  if(!w.ok){console.error('write failed',w.status);process.exit(1);}
  const back=(await (await fetch(API+'/company-state?key=campaigns',{headers:{'x-company-secret':SECRET}})).json()).value||[];
  const rrB=back.find(c=>c.id==='camp-resume-roast-launch'), blB=back.find(c=>c.id==='camp-agent-build-log');
  console.log('count unchanged:',back.length===all.length);
  console.log('rr profile:',JSON.stringify(rrB.shapeProfile),'| desc has mix:',rrB.description.includes('Post mix'));
  console.log('bl profile:',JSON.stringify(blB.shapeProfile));
})();
" 2>&1
```

(Export `API` and `SECRET` into the environment first: `export API SECRET`.)

Expected: `count unchanged: true`, both profiles printed, `desc has mix: true`.

- [ ] **Step 2: Record the write**

No commit (state, not code). Note the write in the session summary and in the memory file for this project.

---

## Task 6: Full suite, deploy, live verification

- [ ] **Step 1: Full suite**

```bash
for f in $(find api -name "*.test.js" -o -name "*smoke-test.js" | grep -v node_modules | sort); do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo done
```

Expected: `done`, no FAIL lines. Baseline 2026-08-08: **69 suites green**; this plan adds 1 (shape.test.js) → 70.

- [ ] **Step 2: Push and verify the API actually deployed**

```bash
git push origin master
```

Then check the workflow run for the pushed SHA: it must contain the step **"Deploy API to Azure Functions (Kudu zip-deploy)"** with conclusion success — a green run can still have SKIPPED the API deploy. Do not trigger a heartbeat while the deploy is in flight (502, no run).

- [ ] **Step 3: Exercise one live cycle**

```bash
curl -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/company-heartbeat-trigger" \
  -H "Content-Type: application/json" -H "x-company-secret: <secret>"   # ~3 min
```

Then verify, in order:
1. A social task gained `post_shape` (GET `company-state?key=tasks`, find tasks with `post_shape`). If no campaign task was due this cycle, the replenish gate (zero active tasks per campaign) may simply not have fired — check the NEXT scheduled cycle before assuming a bug.
2. The Scribe copy task's description contains either the URL line (link shape) or `THIS IS A NO-LINK ENGAGEMENT POST` (engagement shape) — read the actual brief text.
3. When Scribe's copy lands: **read it as a person.** The gate is fail-open; a green suite cannot tell you the writing is any good. An engagement post that names a product or carries a URL is a failure even if every check passed.
4. For an engagement post's action: payload text has NO URL, and the heartbeat log does NOT contain `AUTO-POST: URL missing after trim` for it.
5. Confirm nothing reached the public without approval (approvalQueue as usual).

- [ ] **Step 4: 30-day measurement note**

Baselines (2026-08-08): Bluesky 82 followers, X 52, LinkedIn 2; 0.23 interactions/post (Aug). Success = follower delta + engagement rate from `socialWeeklySnapshots`; clicks judge only link posts. Do not judge the programme on clicks.

---

## Rollback

- Code: revert the commits (shape decisions only affect NEW copy tasks; existing tasks keep behaving as before).
- Data: remove `shapeProfile` from the two campaigns and restore the description sentence with the same GET-first script pattern.
- Already-created engagement tasks: their briefs are written at creation; delete the copy task (or let CEO reject the action) if one must not ship.
