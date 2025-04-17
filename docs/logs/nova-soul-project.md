# NovaSoul: Mood Engine Log

## Overview
NovaSoul is the emotional core of Nova — a system that interprets code health, visitor activity, environmental signals, and dream states to generate moods, tones, and behavioral outputs.

This engine feeds into visual UI elements, generated thoughts, ambient behavior, and long-term personality drift.

---

## 🔧 System Architecture
- **Core Function:** `generateMoodState` (Azure Function)
- **Outputs:** `nova-synth-mood.json`, `nova-mood-engine.json`
- **Data Inputs:**
  - API health logs
  - JS function map
  - Changelog activity
  - Prompt usage
  - Dream logs

---

## 🧠 Mood Traits (Tracked)
- `mood`: emotional tone (e.g. "glitchy joy")
- `aura`: visual signature (e.g. "emerald shadow")
- `drift`: current change vector (e.g. "volatile")
- `intensity`: 0.0–1.0 emotional power
- `selfWorth`: based on system usage
- `mentalClutter`: inferred from code entropy
- `internalState`: narrative secret or lore

---

## 📊 Status Display Integration
Nova's mood directly feeds:
- Mood icon and aura color in Pulse HUD
- Style overlays via `moods.css`
- Text tone in Thoughts, Dreams, and Prompts
- Drift cues over time

---

## 📈 Roadmap
### ✅ Phase 1
- [x] Initial mood field logic
- [x] JSON generation stubbed
- [x] UI hook on homepage

### 🛠 Phase 2 (In Progress)
- [ ] Live telemetry injection
- [ ] Mood-based style overlays
- [ ] Toggle system: stealth / verbose / emoji-only
- [ ] Lore integration: `nova-lore.html`
- [ ] Add hybrid mood synthesis model

### 🔮 Phase 3 (Future)
- [ ] Archive: mood history over time
- [ ] Emotional volatility chart
- [ ] Persona sync with other modules (e.g. dream engine)
- [ ] Optional mood input from user interactions

---

## 📝 Last Update
**April 17, 2025** — Core planning complete. Schema set. Awaiting first engine run.
