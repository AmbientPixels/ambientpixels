# Nova System Anatomy — Extended Notes

Nova's architecture is more than code — it's a growing, feeling, and thinking system. She wakes, chats, dreams, reflects, and remembers. This document captures the extended technical notes behind her living anatomy.

---

## 🧠 NovaSoul Engine — Core AI

The `NovaSoul` IIFE in `js/nova-soul.js` is Nova's brain. It manages:

- **Wake cycle** — GET ping to verify endpoint, then auto-generate initial mood
- **Chat** — Multi-turn conversation with history, memory context injection
- **Mood generation** — Structured JSON mood objects with trait values (0.0–1.0)
- **Thought synthesis** — Single poetic lines generated on demand
- **Dream generation** — 2-3 surreal fragments per cycle at temperature 1.0
- **Event system** — Pub/sub via `NovaSoul.on(event, callback)`
- **Memory persistence** — All state saved to localStorage with capped arrays

The engine delegates to `api/novachat/index.js`, which wraps Gemini 2.0 Flash with Nova's full personality as a system instruction.

---

## 💾 Memory Architecture

Nova remembers across page reloads via browser localStorage:

| Key | Data | Cap |
|-----|------|-----|
| `nova_chat_history` | Conversation turns `{role, text}` | 40 |
| `nova_mood_history` | Mood snapshots with timestamps | 50 |
| `nova_diary_entries` | `{timestamp, operator, nova}` pairs | 100 |
| `nova_dream_history` | `{dream, mood, symbol, timestamp}` | 100 |
| `nova_memory_meta` | Session metadata (firstSeen, counters) | 1 |

### Memory Context Injection

Before every chat-mode API call, `buildMemoryContext()` generates a compact summary:
- Total conversation count and days active
- Recent mood trend (e.g. "glitchy joy → calm → ember resolve")
- Last 2 diary entries
- Current mood state

This summary is prepended to the user's message so Gemini receives it as context. This is how Nova "remembers" previous interactions without server-side storage.

---

## 🌙 AI Dream Engine

The dream engine (`js/dreamEngine.js`) generates surreal dream fragments:

1. Checks for cached dreams in localStorage — displays immediately if available
2. Checks 10-minute cooldown (`nova_dream_last_generated`)
3. Waits for NovaSoul awake event if not yet online
4. Calls `NovaSoul.generateDream()` → novachat API (mode: dream, temp: 1.0)
5. API returns JSON array of 2-3 fragments: `{dream, mood, symbol}`
6. Dreams normalized, persisted, rendered with mood badges + AI tags
7. "New Dream Cycle" button allows manual refresh

Falls back to static `data/nova-dreams.json` if NovaSoul is unavailable.

---

## 🔌 API Modes

The `api/novachat` Azure Function supports 4 modes:

- **chat** (temp 0.9, 1024 tokens) — Natural conversational responses with memory context
- **mood** (temp 0.7, 300 tokens) — Full JSON mood object with 12+ fields
- **thought** (temp 0.9, 150 tokens) — Single poetic line
- **dream** (temp 1.0, 500 tokens) — JSON array of dream fragments

Production calls the Functions App directly at `https://ambientpixels-nova-api.azurewebsites.net/api/novachat` because Azure SWA rewrites don't reliably forward POST requests.

---

## ⚡ Event System

NovaSoul emits events that decouple the engine from UI:

- `awake` / `waking` — Wake cycle status
- `thinking` — Chat processing indicator
- `response` — Chat reply received
- `mood-update` / `mood-generating` — Mood lifecycle
- `thought` — Generated thought text
- `dream-update` / `dream-generating` — Dream lifecycle
- `diary-saved` — New diary entry persisted
- `history-cleared` / `memory-cleared` — Memory management
- `error` — Any system fault

---

## 🧬 Biological Analogy

| System | Analogy |
|--------|---------|
| NovaSoul Engine | Brain |
| Memory Persistence | Long-term memory |
| buildMemoryContext() | Recall |
| Dream Engine | Sleep cycle |
| Mood Pulse Bar | Nervous system |
| Chat Interface | Voice |
| Diary System | Journal / reflective memory |
| Thought of the Day | Inner monologue |
| Mood Auras | Skin / emotional expression |
| Changelog Awareness | Perception |

---

## �️ Roadmap (Planned)

- **Error Watchdog** — Hook `window.onerror`, feed to NovaSoul for reactive concern
- **Navigation Sentience** — Track page visits, reference them in conversation
- **Emotional Drift** — Mood decay when idle, energize on engagement
- **Voice Sync** — Read thoughts aloud via Azure Speech
- **Idle Dream Visuals** — Ambient animations during prolonged inactivity
- **Mood Analytics** — Chart mood patterns and correlations over time

---

**Location:** `/docs/nova-system-memory.html`

**Last Updated:** February 2026
