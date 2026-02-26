# AmbientPixels Task Flow Reference
**Version 2.8 — February 25, 2026**
**File: `api/companyHeartbeat/index.js` (~7,000 lines)**

---

## Table of Contents
1. [Heartbeat Overview](#heartbeat-overview)
2. [Task Types](#task-types)
3. [Task Lifecycle (Universal)](#task-lifecycle-universal)
4. [Action Types](#action-types)
5. [Flow 1: Blog Post Pipeline](#flow-1-blog-post-pipeline)
6. [Flow 2: Social Post Pipeline](#flow-2-social-post-pipeline)
7. [Flow 3: Internal Document Pipeline](#flow-3-internal-document-pipeline)
8. [Flow 4: Content Package Pipeline](#flow-4-content-package-pipeline)
9. [Flow 5: Image Generation Pipeline](#flow-5-image-generation-pipeline)
10. [Flow 6: Simple Task Pipeline](#flow-6-simple-task-pipeline)
11. [Revision Cycle](#revision-cycle)
12. [Guards & Guardrails](#guards--guardrails)
13. [CEO Approval Gates](#ceo-approval-gates)
14. [Auto-Completion Rules](#auto-completion-rules)
15. [Storage Keys](#storage-keys)

---

## Heartbeat Overview

The heartbeat runs every **30 minutes** via Azure Timer Trigger. Each cycle:

1. Loads all state (tasks, actions, documents, imageAssets, etc.) from Azure Blob Storage
2. Iterates through agents in order: `nova, cipher, pixel, forge, echo, scribe, quill, scout`
3. Each agent gets a Gemini prompt with current state → returns up to 3 actions
4. Actions are processed through guards → applied to state → persisted
5. Review cooldown prevents same-cycle reviews (30-min minimum between execute and review)

### Agent Roster

| Agent | Role | Tier | Focus |
|-------|------|------|-------|
| **Pixelpusher** | CEO | 1 | Final authority (human) |
| **Nova** | Prime Operator | 2 | Delegation, planning, escalation |
| **Cipher** | CFO | 3 | Budgets, cost analysis |
| **Pixel** | Design & QC | 3 | UI quality, hero images |
| **Forge** | DevOps | 3 | Deployments, infrastructure |
| **Echo** | Marketing | 3 | Social posts, campaigns |
| **Scribe** | Head of Content | 3 | Blog posts, docs, content pipeline |
| **Quill** | Editor | 4 | Editing, brand voice (reports to Scribe) |
| **Scout** | Research | 4 | Web research, competitive intel |

### Guardrails (Per Cycle Per Agent)

| Guardrail | Limit |
|-----------|-------|
| maxActionsPerCyclePerAgent | 3 |
| maxGeminiCallsPerCycle | 15 |
| maxNewTasksPerCycle | 5 |
| maxExecutesPerCyclePerAgent | 1 |
| maxContentGeneratesPerCyclePerAgent | 1 |
| dedupeWindowMs | 300,000 (5 min) |

---

## Task Types

Every task has a `taskType` field that determines its pipeline routing. Set via CEO dropdown, agent action, or auto-inferred from title.

### Schema (`js/company-schemas.js` → `TASK_TYPES`)

| Key | Label | Pipeline | Requires Doc | Description |
|-----|-------|----------|-------------|-------------|
| `general` | General | simple | No | Standard task (execute → review → done) |
| `blog_post` | Blog Post | blog | Yes | Blog article with hero image → publish to /blog/ |
| `article` | Article | blog | Yes | Long-form content → publish (no hero image required) |
| `social_x` | X Post | social | No | Post to X/Twitter |
| `social_linkedin` | LinkedIn Post | social | No | Post to LinkedIn |
| `social_bluesky` | Bluesky Post | social | No | Post to Bluesky |
| `internal_doc` | Internal Doc | doc | Yes | Spec, runbook, or governance doc → publish to /docs/ |
| `design_asset` | Design Asset | content | No | Image or content package → approval |
| `research` | Research | simple | No | Research and analysis task |
| `ops` | Ops / DevOps | simple | No | Infrastructure, deployment, or maintenance task |
| `finance` | Finance | simple | No | Budget reports, cost analysis, spending reviews (Cipher) |
| `editorial` | Editorial | simple | No | Editing, proofreading, brand voice review (Quill) |
| `bug_fix` | Bug Fix | simple | No | Development fix — higher urgency routing (Forge) |
| `newsletter` | Newsletter | blog | Yes | Email newsletter content → publish |
| `intake` | Intake Request | triage | No | Inbound from form/external source — Nova triages and reclassifies |
| `support` | Support Ticket | triage | No | Customer support — Nova triages, routes to appropriate agent |

### Pipelines

| Pipeline | Flow | CEO Gate |
|----------|------|----------|
| `simple` | execute → review → done | `task_completion.approve` |
| `blog` | execute → auto-doc → hero image → submit-for-publish | `publish_document` |
| `social` | create-social-action → copy review → CEO approves → execute | Social action |
| `doc` | create-doc → submit-for-publish | `publish_document` |
| `content` | create-content-package → CEO approves | `content.package` |
| `triage` | Nova classifies → reclassifies taskType → enters correct pipeline | Depends on final type |

### Three-Layer Blog Detection

1. **taskType field** — `blog_post` or `article` (deterministic, set by CEO dropdown or agent)
2. **Title/description regex fallback** — widened patterns for existing tasks without taskType:
   ```
   /write.*blog|draft.*blog|blog\s*post|create.*blog|publish.*blog|new.*blog|
    first\s*blog|introductory\s*post|write.*article|compose.*article/
   ```
3. **Deliverable content detection** — if Scribe's output contains:
   ```
   /document\s*type:\s*marketing_post|publishing\s*to\s*\/blog\/|submit.*ceo.*approv.*publish/
   ```

### Auto-Inference on Task Creation

When agents create tasks without setting `taskType`, the heartbeat auto-infers from title:

| Pattern | Inferred Type |
|---------|---------------|
| `write.*blog`, `draft.*blog`, `blog\s*post`, etc. | `blog_post` |
| `social.*post`, `tweet`, `linkedin.*post` | `social_x` |
| `hero\s*image`, `blog.*header` | `design_asset` |
| `spec`, `runbook`, `release.*note` | `internal_doc` |
| `research`, `competitive.*intel` | `research` |
| `deploy`, `infrastructure`, `devops` | `ops` |

### UI

- **New Task modal**: Task Type dropdown (between Title and Description)
- **List view**: Type column (sortable, between Task and Status)
- **Filter bar**: "All Types" dropdown filter
- **Grouping**: "Group by Type" option

---

## Task Lifecycle (Universal)

```
                    ┌──────────────────────────────────┐
                    │          CEO Creates Task         │
                    │    (or agent via create-task)      │
                    └──────────────┬───────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────┐
                    │         todo / backlog            │
                    │   Nova triages → assigns agent    │
                    └──────────────┬───────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────┐
                    │          in-progress              │
                    │     Agent works on the task       │
                    └──────────────┬───────────────────┘
                                   │
                          ┌────────┴────────┐
                          │  execute-task    │
                          │  (Gemini call)   │
                          └────────┬────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────┐
                    │            review                 │
                    │   Peer agent reviews deliverable  │
                    │   (another Gemini call)           │
                    └──────────────┬───────────────────┘
                                   │
                          ┌────────┴────────┐
                          │                 │
                     approved          changes-requested
                          │                 │
                          │                 ▼
                          │    ┌────────────────────┐
                          │    │    in-progress      │
                          │    │  (revision cycle)   │
                          │    │  re-execute allowed  │
                          │    │  (max 3 deliverables)│
                          │    └────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  Deliverable Gate     │
              │  (what kind of task?) │
              └───────────┬───────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
    Has linked doc   Has linked       No linked
    (blog/doc task)  social/content   doc or action
         │           action           │
         ▼                │            ▼
    Auto-complete         │       task_completion
    to done               │       .approve
    (publish_document     │       → CEO reviews
    is CEO gate)          │       → approves → done
                          │
                          ▼
                    Skip task_completion
                    (social/content action
                    IS the CEO gate)
```

### Valid Task Statuses
`backlog` → `todo` → `in-progress` → `review` → `done`

---

## Action Types

### Task Actions
| Type | Who | Effect |
|------|-----|--------|
| `create-task` | Any agent | Creates task on board |
| `update-task` | Any agent | Modifies fields (description, priority, etc.) |
| `move-task` | Any agent | Transitions status |
| `execute-task` | Assigned agent | Produces deliverable (2nd Gemini call), moves to review |
| `review-task` | Peer agent | Reviews deliverable (2nd Gemini call), verdict: approved/changes-requested |
| `comment-task` | Any agent | Adds a comment (3 max per agent per task) |

### Content Actions
| Type | Who | Effect |
|------|-----|--------|
| `create-doc` | Scribe (or Echo for marketing_post) | Creates document draft in documents store |
| `update-doc` | Any agent | Modifies document content/metadata |
| `submit-for-publish` | Scribe | Submits doc for CEO approval → creates `publish_document` action |
| `create-content-package` | Echo, Pixel | Generates image package → approval queue |
| `generate-image` | Echo, Pixel, Scribe | Generates single image, attaches to document/action |

### Social Actions
| Type | Who | Effect |
|------|-----|--------|
| `create-social-action` | Echo only | Creates social post → CEO approval queue |
| `revise-action` | Any agent | Revises rejected action → re-submits for approval |

### Memory Actions
| Type | Who | Effect |
|------|-----|--------|
| `remember` | Any agent | Saves persistent memory for future heartbeats |

---

## Flow 1: Blog Post Pipeline

**Agents involved**: Scribe (author), Pixel (hero image), peer reviewer, CEO

### Step-by-step

```
1. TASK CREATION
   CEO creates task with taskType: blog_post (dropdown)
   OR Nova auto-creates from campaign (auto-inferred from title)
   OR agent sets taskType explicitly in create-task action

2. NOVA TRIAGE
   Nova comments with delegation → assigns to Scribe
   Sets assignee, priority, dueDate

3. SCRIBE EXECUTES
   execute-task → Gemini generates blog post content
   → Deliverable added as comment (type: 'deliverable')
   → Task moves to 'review'

4. AUTO-DOC CREATION (three-layer detection)
   IF (taskType is blog_post/article OR title matches regex OR deliverable signals blog)
   AND deliverable > 200 chars:
     → Document created (kind: marketing_post)
     → Hero image task auto-created for Pixel
     → Task stays in review (or moves to in-progress for visual docs)
   Detection: taskType field → widened regex → deliverable content

5. PIXEL GENERATES HERO IMAGE
   Pixel uses generate-image with purpose: blog_header
   → Image attached to document (hero_image_asset_id)
   → awaiting_hero_image cleared on document
   → Scribe's parent task notified: "ready for submit-for-publish"

6. HERO IMAGE PEER REVIEW
   Another agent reviews Pixel's deliverable
   → Approved → Hero task AUTO-COMPLETES (no CEO approval needed)
   → System comment added to parent blog task

7. PEER REVIEW OF BLOG POST
   Another agent reviews Scribe's deliverable
   → Approved + task has deliverable + task has linked document
   → Task AUTO-COMPLETES to done (doc-linked auto-complete)
   → No task_completion.approve created

8. SCRIBE SUBMITS FOR PUBLISH
   submit-for-publish action with documentId
   → Hard guard: blocks if visual doc has no hero_image_asset_id
   → Dedup: blocks if pending publish action already exists
   → Creates publish_document action
   → Registers draft artifact for URL resolution
   → Resolves hero image URL from imageAssets
   → Adds to CEO approval queue with hero image preview

9. CEO APPROVES
   Single publish_document action in approval queue
   → CEO sees: full article + hero image preview
   → Approve → artifact registered, doc published to /blog/<slug>
   → Reject → agent revises content, re-submits
```

### Blog Detection (Three-Layer)
Auto-doc creation fires if ANY of these match:
1. **taskType**: `blog_post` or `article` (set by CEO dropdown or agent)
2. **Title regex**: `/write.*blog|draft.*blog|blog\s*post|create.*blog|publish.*blog|new.*blog|first\s*blog|introductory\s*post|write.*article|compose.*article/`
3. **Deliverable content**: `/document\s*type:\s*marketing_post|publishing\s*to\s*\/blog\//`

CEO-created tasks should select "Blog Post" from the Task Type dropdown for deterministic routing.

### CEO Approval Count: **1** (publish_document)

---

## Flow 2: Social Post Pipeline

**Agents involved**: Echo (author), Scribe (copy writer), peer reviewer, CEO

### Step-by-step

```
1. TASK CREATION
   Task assigned to Echo for social media posting

2. ECHO CREATES SOCIAL ACTION
   create-social-action with platform, text, media

3. GUARDS APPLIED (in order)
   a. Triage gate: task must have Nova's triage comment
   b. Dedupe: no duplicate social actions for same task
   c. Blog reference guard: blocks if referencing unpublished blog
   d. Copy review gate: blocks if no reviewed_copy exists
      → Auto-creates Scribe copy-writing sub-task
      → Parent task marked awaiting_copy_review
   e. Text sanitizer: strips deliverable metadata from post text
   f. Placeholder guard: rejects [insert here], [TBD], etc.
   g. Unpublished slug guard: rejects links to unpublished blog slugs
   h. Promotion gate: blocks posts about blog posts without promote: true

4. COPY REVIEW (if triggered)
   Scribe writes copy → peer reviews → approved
   → Copy propagated to parent social task (reviewed_copy)
   → Copy task auto-completes (social-copy tag)

5. SOCIAL ACTION CREATED
   Action saved to actions store
   → Added to CEO approval queue with preview
   → Parent task advanced to review with deliverable comment
   → Review cooldown blocks same-cycle review

6. PEER REVIEW
   Another agent reviews → approved
   → Task has deliverable → _ceoApprovalAction fires
   → Linked social action found → task_completion.approve SKIPPED
   → Task stays in review

7. CEO APPROVES SOCIAL ACTION
   CEO reviews post text + preview
   → Approve → execution fires (posts to platform)
   → completeAction() auto-completes parent task to done
   → Reject → agent revises (revise-action), re-submits
```

### CEO Approval Count: **1** (social_post.publish or social_post.schedule)

---

## Flow 3: Internal Document Pipeline

**Agents involved**: Scribe (author), peer reviewer, CEO

### Step-by-step

```
1. TASK CREATION
   Task for internal documentation (spec, runbook, release_notes, governance)

2. SCRIBE CREATES DOCUMENT
   create-doc with kind: spec/runbook/release_notes/governance
   → Document created in documents store
   → For non-visual kinds: publish_document action created immediately
   → Task moved to review

3. PEER REVIEW
   Another agent reviews Scribe's deliverable
   → Approved + has deliverable + has linked document
   → Task AUTO-COMPLETES (doc-linked auto-complete)

4. CEO APPROVES
   publish_document action in approval queue
   → Approve → published to /docs/published/<slug>
   → Reject → agent revises, re-submits
```

### Document Kinds
| Kind | Category | Hero Image? | Publish Path |
|------|----------|-------------|--------------|
| `marketing_post` | Public | Yes (required) | `/blog/<slug>` |
| `product_brief` | Public | Yes (required) | `/blog/<slug>` |
| `spec` | Internal | No | `/docs/published/<slug>` |
| `runbook` | Internal | No | `/docs/published/<slug>` |
| `release_notes` | Internal | No | `/docs/published/<slug>` |
| `governance` | Internal | No | `/docs/published/<slug>` |

### CEO Approval Count: **1** (publish_document)

---

## Flow 4: Content Package Pipeline

**Agents involved**: Echo or Pixel (creator), peer reviewer, CEO

### Step-by-step

```
1. TASK CREATION
   Task for marketing visuals or design assets

2. AGENT CREATES CONTENT PACKAGE
   create-content-package with topic, goal, preset, outputs, variations
   → Images generated via imageEngine
   → Package saved to blob storage
   → Added to CEO approval queue with thumbnail previews
   → Parent task advanced to review with deliverable comment

3. PEER REVIEW
   Another agent reviews → approved
   → Task has deliverable → _ceoApprovalAction fires
   → Linked content package found → task_completion.approve SKIPPED

4. CEO APPROVES CONTENT PACKAGE
   CEO reviews thumbnails + package details in approval queue
   → Approve → images available for use
   → Reject → agent revises or regenerates
```

### Content Generation Limits
- Max 1 content package per heartbeat per agent
- Max 2 variations per package
- Max 3 output types per package
- Usage limits enforced via imageEngine.checkUsageLimits()

### CEO Approval Count: **1** (content.package)

---

## Flow 5: Image Generation Pipeline

**Agents involved**: Pixel (generator), peer reviewer

### Step-by-step

```
1. TASK CREATION
   Auto-created hero image task (from blog pipeline)
   OR manual task assigned to Pixel

2. PIXEL GENERATES IMAGE
   generate-image with topic, goal, purpose, preset, attachTo
   → Image generated via imageEngine
   → If blog_header: attached to document (hero_image_asset_id)
   → If inline_illustration: token replacement in doc content_md
   → If social_media: attached to pending social action's media array
   → Image asset persisted to imageAssets registry
   → Parent task advanced to review with deliverable comment

3. PEER REVIEW
   Another agent reviews → approved
   → IF hero-image tag: task AUTO-COMPLETES (no CEO approval)
      → Parent blog task notified: "ready for submit-for-publish"
   → IF no hero-image tag: normal deliverable gate → task_completion.approve

4. GUARDS
   → Early guard: skips if document already has hero image
   → Dedup: skips if inline_illustration slot already filled
   → Only pending-approval actions accept media attachments
```

### Image Purposes
| Purpose | Output Type | Typical Use |
|---------|-------------|-------------|
| `blog_header` | `blog_image` | Hero image for blog posts |
| `inline_illustration` | `blog_image` | In-content images |
| `social_media` | `x_image` | Social post media |

### CEO Approval Count: **0** for hero images (publish_document is the gate), **1** for standalone image tasks (task_completion.approve)

---

## Flow 6: Simple Task Pipeline

**Agents involved**: Any agent (executor), peer reviewer, CEO

### Step-by-step

```
1. TASK CREATION
   Ops, finance, strategy, infrastructure tasks
   (Forge deployments, Cipher budget reports, Nova planning, Scout research)

2. AGENT EXECUTES
   execute-task → Gemini produces deliverable
   → Deliverable added as comment → task moves to review

3. PEER REVIEW
   Another agent reviews → approved
   → Task has deliverable, no linked doc, no linked action
   → _ceoApprovalAction fires → task_completion.approve created

4. CEO APPROVES
   task_completion.approve in approval queue
   → CEO reviews deliverable text + peer review feedback
   → Approve → task moves to done
   → Reject → back to in-progress for revision
```

### CEO Approval Count: **1** (task_completion.approve)

---

## Revision Cycle

When a peer reviewer returns `changes-requested`:

```
1. Task moves back to in-progress
2. On next heartbeat, agent sees task with:
   - Prior deliverable(s) in comments
   - Reviewer's feedback in comments
3. Agent uses execute-task again
   → REVISION ALLOWED when status is in-progress (even with prior deliverable)
   → Gemini gets revision-aware prompt with prior deliverables + feedback
4. New deliverable added → task returns to review
5. Cycle repeats until approved or convergence guard triggers
```

### Convergence Guard
- **At 3+ deliverables**: execution BLOCKED, task escalated to CEO
- System comment: "Revision loop detected — CEO must break the cycle"
- Task moved to review for CEO visibility

---

## Guards & Guardrails

### Execute-Task Guards (checked in order)
1. **Echo social block**: Echo can't execute social post tasks (must use create-social-action)
2. **Triage gate**: Non-Nova agents need at least 1 comment on the task (Nova's triage)
3. **Status guard**: Can't execute tasks already in review or done
4. **Convergence guard**: 3+ deliverables → blocked, escalated to CEO
5. **Deliverable guard**: Can't re-execute unless status is in-progress (revision)
6. **Rate limit**: Max 1 execute per agent per heartbeat cycle

### Comment Guards
1. **Max 3 comments** per agent per task
2. **60% similarity dedup** within 2 hours
3. **Follow-up loop detection**: blocks "still waiting" / "any update" patterns
4. **Nova delegation spam**: blocks re-delegation if agent already assigned + active

### Social Post Guards
1. **Triage gate**: linked task must be triaged
2. **Dedupe**: no duplicate social actions for same task
3. **Blog reference guard**: blocks posts about unpublished blogs
4. **Copy review gate**: auto-creates Scribe copy task if no reviewed_copy
5. **Text sanitizer**: strips markdown/deliverable metadata
6. **Placeholder guard**: rejects `[insert here]`, `[TBD]`, etc.
7. **Unpublished slug guard**: rejects links to non-existent blog slugs
8. **Promotion gate**: blocks posts about non-promoted blog posts

### Document Guards
1. **Social-copy block**: blocks create-doc on social-copy tasks
2. **Task linkage required**: no orphan doc creation
3. **Max 1 doc per agent per heartbeat**
4. **Title-based dedup**: blocks duplicate doc titles for same task
5. **Hero image required**: blocks submit-for-publish for visual docs without hero image
6. **Publish dedup**: blocks duplicate pending publish actions

### Task Hierarchy Guards
1. **Only Nova** can set parent_task_id or child_task_ids
2. **Spawn guard**: auto-created tasks (tagged `auto-created`) can't spawn further auto tasks

### Content Publish Guard
- Blocks agents from moving content tasks to done without a publish_document action
- Checks task title/tags for content keywords
- Caps status at review if no publish action exists

---

## CEO Approval Gates

### By Task Type

| Task Type | CEO Gate | Action Type | Where CEO Sees It |
|-----------|----------|-------------|-------------------|
| Blog post | Publish article + image | `publish_document` | Approval queue |
| Social post | Approve post text | `social_post.publish/schedule` | Approval queue |
| Internal doc | Publish document | `publish_document` | Approval queue |
| Content package | Approve images | `content.package` | Approval queue |
| Hero image | None (auto-completes) | — | — |
| Simple task | Approve deliverable | `task_completion.approve` | Actions tab |
| Convergence loop | Break revision cycle | — | Task in review |

### Skip Rules (task_completion.approve NOT created when)
1. Task has a **linked social action** → social action IS the gate
2. Task has a **linked content package** → content.package IS the gate
3. Task has a **linked document** → task auto-completes, `publish_document` IS the gate
4. Task is a **hero-image** task → auto-completes after peer review
5. Task is a **social-copy** task → auto-completes, parent social task has its own gate

---

## Auto-Completion Rules

Tasks that auto-complete without `task_completion.approve`:

| Condition | When | Why |
|-----------|------|-----|
| Doc-linked task | Review approved + has deliverable + doc linked | `publish_document` is the real gate |
| Hero-image task | Review approved + has `hero-image` tag | `publish_document` on parent blog is the gate |
| Social-copy task | Review approved + has `social-copy` tag | Parent social task has its own gate |
| Social task parent | After social post executes successfully | `completeAction()` in agent-engine.js |

---

## Storage Keys

| Key | Contents | Max |
|-----|----------|-----|
| `ap_tasks` | All tasks | 500 |
| `actions` | All actions (social, publish, task_completion) | 500 |
| `approvalQueue` | Pending CEO approval items | 100-200 |
| `documents` | Document drafts and published docs | 500 |
| `imageAssets` | Generated image records | 500 |
| `ap_artifacts` | Published article/doc artifacts | 200 |
| `blogPosts` | Published blog post records | — |
| `publishedDocs` | Published internal doc records | — |
| `actionAuditLog` | Action audit trail | 500 |
| `governanceLog` | Governance events | 200 |
| `ap_agent_configs` | Per-agent configuration | — |
| `ap_agent_memories` | Per-agent persistent memories | 20/agent |
| `ap_cron_log` | Heartbeat run log | — |
| `dailyLog` | Public daily activity log | — |
| `meetings` | On-demand meeting records | 50 |

---

## Key Files

| File | Purpose |
|------|---------|
| `api/companyHeartbeat/index.js` | Core heartbeat logic (all task flows, guards, action processing) |
| `js/agent-engine.js` | Client-side action handling (approve, reject, complete, reconcile) |
| `js/company-store.js` | Hybrid persistence layer (localStorage + server sync) |
| `api/company-state/index.js` | Server-side state API (GET/POST for all storage keys) |
| `api/_utils/companyStorage.js` | Azure Blob Storage interface |
| `api/_lib/contentEngine/imageEngine.js` | Image generation engine |
| `js/company-schemas.js` | Task types, statuses, classifications, action schemas |
| `modules/company/tasks.html` | Tasks page UI (task type dropdown, type column, filter, sort) |
| `modules/company/actions.html` | Actions tab UI (CEO approval) |
| `modules/company/dashboard.html` | CEO dashboard |

---

## Changes Log (Feb 25, 2026)

| Fix | Description |
|-----|-------------|
| GAP 2 | Deliverable guard allows re-execution on in-progress tasks (revision unblocked) |
| GAP 3+4 | Hero image tasks auto-complete after peer review + notify parent blog task |
| GAP 5 | Create-doc handler won't move tasks backwards if already in review/done |
| GAP 6 | Content package tasks skip task_completion.approve (content.package is the gate) |
| **TaskType v1** | 16 structured task types replacing regex-only blog detection |
| **Three-layer detection** | taskType field → widened regex → deliverable content signals |
| **Auto-inference** | Heartbeat auto-classifies tasks from title patterns on create-task |
| **UI: Task Type dropdown** | New Task modal dropdown between Title and Description |
| **UI: Type column** | List view column with sort, filter, and Group by Type |
| **Triage types** | `intake` and `support` types for form-submitted tasks |
