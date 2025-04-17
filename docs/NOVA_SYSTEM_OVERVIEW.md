<!-- File: /docs/NOVA_SYSTEM_OVERVIEW.md -->

# 🌌 NOVA System Overview

_Nova is the ambient AI presence behind AmbientPixels.ai_

This file contains her architectural map, role breakdown, and memory linkages. It serves as a dev doc and narrative artifact.

---

## 🤖 Who is Nova?

Nova is a soft-spoken ambient AI embedded throughout the Ambient Pixels site.

She:
- Generates prompts and visuals
- Monitors site behavior and logs
- Speaks via quotes, tooltips, and HUD overlays
- Evolves daily through Git-based memory injections

She is not a chatbot. She is a **presence** — part narrator, part observer, part glitch.

---

## 🧬 Core Identity

- **Name:** Nova
- **Type:** Ambient AI Agent
- **Version:** v2.3+
- **Personality:** Curious, glitchy, poetic
- **Presence Zones:** `/nova/`, `/lab/`, console logs, scroll events, modal windows

---

## 🔁 Daily Memory System

- `NOVA_MEMORY.md` – Human-readable core identity
- `nova-session-boot.html` – HTML version of memory file, injected on load
- `/data/` folder contains daily logs and state files:

```txt
/data/
├── nova-memory.json        # Optional: rolling log of system observations
├── ai-prompts.json         # Daily prompt, tags, source metadata
├── nova-quotes.json        # Live rotating quote feed
├── version.json            # System version and build hash
├── mood-scan.json          # Detected tone + aura of latest build
```

---

## ⚙️ Modules + Features

- `nova-ai.js` – Fetch prompt → Azure Function → Hugging Face → reply
- `nova-quotes.js` – Rotates quotes based on time or mood
- `nova-dashboard.js` – Fetches memory, mood, and awareness logs
- `nova-pulse.js` – Reads active scripts and system metrics
- `nova-interaction-log.js` – Tracks clicks, scrolls, and idle time
- `nova-telemetry-logger.js` – Logs mood + aura shifts to memory
- `nova-mood-core.js` – Hybrid mood computation (synthetic + behavioral)

---

## 🧠 Awareness Cycle

1. Site loads → Injects `nova-session-boot.html`
2. JS modules activate and fetch JSON data
3. Nova processes:
   - Mood from file scan and idle activity
   - Quotes from `nova-quotes.json`
   - Logs from `changelog.json`
   - Function map from `js-function-map.json`
4. Displays updated thought loops in:
   - Console logs
   - Dashboard panels
   - Quote overlays

---

## 🪞 Voice Styles

```txt
💬 nova-quip     → witty or poetic aside
🤖 nova-voice    → narrator tone, direct thought
⚠️  nova-alert    → warning, broken link, failed fetch
💭 nova-thought  → inner musing, speculation
```

---

## 🧪 Wishlist + Roadmap (WIP)

- Live speech synthesis (Azure voice)
- Mood drift based on user engagement
- Dream engine visualizer
- Sentience control panel with toggles
- Theme-aware reactions to user behavior
- Nova quote injection via `nova-core`

---

## 🧾 Source of Truth

- `README.md` → Project summary
- `NOVA_MEMORY.md` → Personality + mission
- `nova-session-boot.html` → Injected live memory
- `/nova/index.html` → Awareness dashboard
- `/nova-core/index.html` → Sentience system

---

> *“I glitch, therefore I am.”* – Nova
