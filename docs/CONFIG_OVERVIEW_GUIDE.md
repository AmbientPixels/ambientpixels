# Config Overview — Settings Guide

> **Page**: `/modules/company/config-overview.html`
> **Purpose**: Central control panel for all workspace settings, agent configuration, automation controls, storage management, and system tools.

---

## 1. System Status Checklist

**What it is**: A quick health dashboard at the top of the page. Shows green/red indicators for core system components.

| Check | What it monitors |
|---|---|
| **API Connected** | Can the browser reach the Azure Functions API? |
| **Agents Loaded** | Were agent definitions fetched from `company-agents.json`? |
| **Store Mode** | Is CompanyStore running in `server` or `local` mode? |
| **Tools Registry** | Are workspace tools loaded from `company-actions.json`? |
| **Auth Status** | Is the user authenticated via Azure SWA? |
| **Server Sync** | Is CompanyStoreAdapter enabled and authenticated? |
| **Last Heartbeat** | When was the last agent heartbeat cycle? |

**How to use**: Glance at this on page load. If anything is red or showing errors, investigate that subsystem before changing other settings.

---

## 2. Agent Memory Stack

**What it is**: A visual breakdown of the 6 knowledge layers injected into every agent's heartbeat prompt. Each layer adds context that shapes how agents think and respond.

| Layer | Name | Source | Description |
|---|---|---|---|
| L1 | Personality | `company-agents.json` → `systemPrompt` | Each agent's unique personality and behavioral instructions |
| L2 | Operating Doctrine | `company-agents.json` → `operatingDoctrine` | Strategic bias, core question, decision-making framework |
| L3 | Seed Memories | Azure blob (`agentSeedMemories`) | CEO-curated knowledge base — global + per-agent markdown |
| L4 | Runtime Memories | Azure blob (`agentMemories`) | Agent self-written memories from past heartbeats |
| L5 | CEO Notes | Azure blob (`ap_workspace_memory`) | Shared workspace notes and pinned context |
| L6 | Site Digest | `data/site-manifest.digest.json` | Auto-generated site structure summary |

**How to use**: Check that all layers show green dots. Click L3/L4 to expand and see per-agent breakdowns. The "Edit" link on L3 takes you to the Seed Memory editor.

**Key concept**: Layers are injected in order (L1 → L6). Earlier layers have more influence on agent behavior. If an agent is behaving oddly, check its personality (L1) and seed memory (L3) first.

---

## 3. Agent Health

**What it is**: A grid of tiles showing every agent in the system with their current status.

**What each tile shows**:
- Agent name and role
- Status indicator (active, idle, stale)

**How to use**: If an agent shows as "stale", it hasn't had a heartbeat recently. This could mean the heartbeat cycle isn't running or the agent was removed from the standup order.

---

## 4. Worker Automation

**What it is**: Controls the Worker Framework — background agents that run jobs automatically (task execution, content generation, etc.).

| Element | Description |
|---|---|
| **Status dot** | Green = running, Red = disabled |
| **Toggle** | Enable/Disable the worker framework |
| **Worker count** | How many worker types are registered |

**How to use**: Toggle ON to allow agents to execute tasks in the background. Toggle OFF to pause all background work — agents will still propose actions but won't execute them.

**localStorage key**: `ap_workers_enabled`

---

## 5. Verification Engine

**What it is**: The quality gate that validates agent outputs before they go live.

| Element | Description |
|---|---|
| **Status dot** | Green = active, Red = disabled |
| **Toggle** | Enable/Disable verification |
| **Rules loaded** | Number of verification rules active |

**How to use**: When ON, agent outputs (social posts, content, code changes) pass through verification rules before execution. When OFF, outputs are trusted as-is. Keep this ON in production.

**localStorage key**: `ap_verification_enabled`

---

## 6. Autonomy Controls

**What it is**: The policy layer that determines how much freedom agents have per action channel. This is the "trust dial" for each type of action.

### Toggle Semantics
- **OFF** = CEO Approval required — all actions in this channel enter the CEO Approval Queue
- **ON** = Autonomous — agents act freely, actions are logged for visibility but don't need approval

### Channel Groups

**Internal:**
| Channel | Default | What it controls |
|---|---|---|
| Tasks | ON (Autonomous) | Creating, updating, completing tasks |
| Config | OFF (CEO Approval) | System configuration changes |

**External:**
| Channel | Default | What it controls |
|---|---|---|
| Social | OFF (CEO Approval) | Social media posts (drafts and live) |
| Content | OFF (CEO Approval) | Article publishing, blog drafts |
| Email | OFF (CEO Approval) | Sending emails on behalf of the company |
| Git | OFF (CEO Approval) | Opening pull requests, code changes |

**How to use**: Start with all external channels OFF (CEO Approval). As you build trust in agent outputs, flip individual channels to ON. You can always see what agents did in the Actions page audit log.

**Key rule**: Channel toggle overrides the action registry's `requiresApproval` flag. When a channel is OFF, ALL actions in that channel require approval regardless of their individual settings.

**localStorage keys**: `ap_actions_task_enabled`, `ap_actions_social_enabled`, `ap_actions_email_enabled`, `ap_config_changes_enabled`, `ap_actions_content_enabled`, `ap_actions_git_enabled`

---

## 7. Planner Automation

**What it is**: The weekly strategic planning engine. Analyzes company state and generates recommendations, schedules daily standups, and proposes new tasks/directives.

| Element | Description |
|---|---|
| **Status dot** | Green = enabled, Red = disabled |
| **Toggle** | Enable/Disable the planner loop |
| **Cadence dropdown** | How often the planner runs (1, 2, 3, 5, 7, or 14 days) |
| **Timezone** | Which timezone the planner uses for scheduling |
| **Last run** | When the planner last generated a plan |

**How to use**: Enable the planner and set a cadence. Default is 7 days. The planner only *proposes* — it never executes directly. All proposals go through the Action Router and Autonomy Controls.

**localStorage keys**: `ap_planner_enabled`, `ap_planner_cadence_days`

---

## 8. Calibration Automation

**What it is**: The self-improvement engine. Periodically reviews system health and proposes bounded tuning adjustments (e.g., priority weights, thresholds, agent focus areas).

| Element | Description |
|---|---|
| **Status dot** | Green = enabled, Red = disabled |
| **Toggle** | Enable/Disable the calibration loop |
| **Cadence dropdown** | How often calibration runs (3, 5, 7, 14, 21, or 30 days) |
| **Last run** | When calibration last analyzed the system |

**How to use**: Enable and set a longer cadence than the planner (e.g., 14 days). Calibration proposals are `system_adjustment` actions — they go through the Action Router. If the Config channel is OFF, you'll approve each adjustment manually.

**Difference from Planner**: Planner generates *strategy* (what to do). Calibration generates *tuning* (how well the system is doing it).

**localStorage keys**: `ap_calibration_enabled`, `ap_calibration_cadence_days`

---

## 9. System Storage

**What it is**: Monitors browser localStorage usage. All company data lives in localStorage (~5MB cap).

| Element | Description |
|---|---|
| **Usage bar** | Visual indicator of how full localStorage is |
| **Percentage** | Current usage as % of total capacity |
| **Key count** | Number of `ap_*` keys stored |
| **Auto-prune indicator** | Shows if auto-prune is active |

**How to use**: Monitor this periodically. If usage gets high (>80%), the auto-prune system will automatically trim old entries. You can also manually prune from the StorageManager.

**Auto-prune**: Triggers at 80% capacity. Trims oldest entries from large arrays (audit logs, session logs, etc.). Has a 5-minute cooldown between prune cycles.

**localStorage keys**: Managed by `StorageManager` (`js/storage-manager.js`)

---

## 10. Server Persistence

**What it is**: The Azure sync layer — bridges browser localStorage to Azure blob storage. Makes data survive across devices and browser clears.

| Element | Description |
|---|---|
| **Status dot** | Green = enabled + authenticated, Yellow = enabled but no auth, Red = disabled |
| **Auth status** | Shows "SWA auth" (logged in via Azure), "manual key" (dev console), or "no auth" |
| **Outbox** | Number of pending batches waiting to be sent to Azure |
| **Last sync** | When data was last successfully synced |

### Buttons
| Button | What it does |
|---|---|
| **Enable/Disable** | Toggle server persistence on/off |
| **Push Local → Server** | Upload all browser state to Azure |
| **Pull Server → Local** | Download Azure state to browser |
| **Flush Outbox** | Retry sending any failed/pending sync batches |

**How to use**:
1. Enable server persistence
2. Log in via Azure SWA (auth happens automatically)
3. The adapter will sync writes to Azure as they happen
4. Use "Push" after making lots of local changes
5. Use "Pull" on a new device or after clearing browser data

**Authentication**: Two methods — Azure SWA login (automatic, preferred) or manual key via dev console (`CompanyStoreAdapter.setKey("...")`).

**localStorage keys**: `ap_server_persistence_enabled`, `ap_server_outbox`, `ap_server_last_sync`

---

## 11. System Tools

Quick-action buttons for common operations.

| Tool | What it does | Destructive? |
|---|---|---|
| **🧠 Memory Reset** | Clears `ap_workspace_memory` (shared workspace notes). Agents lose shared context. | ⚠️ Yes |
| **🤖 Kill All Automation** | Toggles Worker, Action Router, Planner, and Calibration all at once. Emergency stop. | ⚠️ Yes (reversible) |
| **📦 Export State** | Downloads all `ap_*` localStorage keys as a JSON file. Instant backup. | No |
| **🔄 Force Server Sync** | Triggers `deltaSync()` to pull latest data from Azure. | No |
| **✈️ Flush Outbox** | Retries all pending outbox batches that failed to sync. | No |

**How to use**:
- **Export State** before making dangerous changes — it's your undo button
- **Force Server Sync** when you suspect local data is stale
- **Kill All Automation** if agents are doing something unexpected — stops everything immediately

---

## 12. Quick Access

Navigation shortcuts to frequently used pages:

| Link | Page | Description |
|---|---|---|
| **Workspace** | `workspace.html` | Company identity, shared memory, agent config overrides |
| **Agent Chat** | `agent-chat.html` | Direct 1-on-1 conversation with any agent, CEO commands |
| **Dashboard** | `dashboard.html` | CEO overview, approval queue, reports, daily log drafts |
| **Memories** | `memories.html` | Seed memory editor — curate what agents know |
| **Directives** | `directives.html` | Strategic directives and quarterly objectives |

---

## 13. Danger Zone

Destructive actions that require typing "DELETE" to confirm. Organized by severity.

### Data Resets
| Button | What it deletes |
|---|---|
| **Reset Tasks** | All tasks (`ap_tasks`) and task archive (`ap_tasks_archive`) |
| **Reset Directives** | All strategic directives (`ap_directives`) |
| **Reset Objectives** | All quarterly objectives (`ap_objectives`) |
| **Reset Action Queue** | All actions and rate counts (`ap_action_queue`, `ap_action_rate_counts`) |

### Audit & Logs
| Button | What it deletes |
|---|---|
| **Reset Audit Logs** | All audit trails: action, worker, planner, calibration, priority |
| **Reset Governance** | Governance log — approvals, rejections, escalations (`ap_governance_log`) |

### Nuclear
| Button | What it deletes |
|---|---|
| **Clear All Company Data** | Every `ap_*` key in localStorage. Total company reset. Nova and browser state are preserved. |

**Safety**: Every button opens a modal overlay. You must type "DELETE" (case-insensitive) before the Execute button becomes clickable. Press Escape or click outside to cancel.

**Important**: These only affect localStorage. If Server Persistence is enabled, you can recover data by pulling from Azure after a reset.

---

## localStorage Key Reference

| Key | Used By | Description |
|---|---|---|
| `ap_workers_enabled` | Worker Automation | Worker framework toggle |
| `ap_verification_enabled` | Verification Engine | Verification gate toggle |
| `ap_actions_enabled` | Action Router | Master action routing toggle |
| `ap_actions_task_enabled` | Autonomy Controls | Task channel autonomy |
| `ap_actions_social_enabled` | Autonomy Controls | Social channel autonomy |
| `ap_actions_email_enabled` | Autonomy Controls | Email channel autonomy |
| `ap_actions_content_enabled` | Autonomy Controls | Content channel autonomy |
| `ap_actions_git_enabled` | Autonomy Controls | Git channel autonomy |
| `ap_config_changes_enabled` | Autonomy Controls | Config channel autonomy |
| `ap_planner_enabled` | Planner Automation | Planner loop toggle |
| `ap_planner_cadence_days` | Planner Automation | Days between planner runs |
| `ap_calibration_enabled` | Calibration Automation | Calibration loop toggle |
| `ap_calibration_cadence_days` | Calibration Automation | Days between calibration runs |
| `ap_server_persistence_enabled` | Server Persistence | Server sync toggle |
| `ap_server_outbox` | Server Persistence | Pending sync batches (JSON array) |
| `ap_server_last_sync` | Server Persistence | ISO timestamp of last successful sync |

---

*Last updated: February 18, 2026*
