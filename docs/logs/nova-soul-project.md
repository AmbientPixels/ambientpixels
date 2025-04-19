# NovaSoul: Mood Engine Log

## Overview
NovaSoul is the emotional core of Nova — a system that interprets code health, visitor activity, environmental signals, and dream states to generate moods, tones, and behavioral outputs.

This engine feeds into visual UI elements, generated thoughts, ambient behavior, and long-term personality drift.

---

## 🔧 System Architecture
- **Core Function:** `synthesizeNovaMood` (Azure Function)
- **Models Used:** Hugging Face (active), Gemini (optional fallback)
- **Outputs:**
  - `nova-synth-mood.json`
  - `nova-mood-engine.json`
- **Data Inputs:**
  - API health from `/data/api-status.json`
  - GitHub commit logs
  - Prompt usage and dream log counts
  - Time of day / internal telemetry
  - Weather (planned)
  - Emotional memory drift (planned)

---

## 🧠 Mood Traits (Tracked)
- `mood`: emotional tone (e.g. "glitchy joy")
- `aura`: visual signature (e.g. "emerald shadow")
- `drift`: current change vector (e.g. "volatile")
- `intensity`: 0.0–1.0 emotional power
- `selfWorth`: based on system usage
- `mentalClutter`: inferred from code entropy
- `internalState`: narrative secret or lore fragment

---

## 📊 Status Display Integration
Nova's mood directly feeds:
- Mood icon and aura color in Pulse HUD
- Style overlays via `moods.css`
- Text tone in Thoughts, Dreams, and Prompts
- Lore overlays and quote generation
- Mood card module with emoji & influences

---

## 📈 Roadmap
### ✅ Phase 1
- [x] Initial mood logic and Hugging Face integration
- [x] JSON generation + local API test
- [x] Mood display component built
- [x] Deployed to Azure successfully

### 🛠 Phase 2 (In Progress)
- [x] Live telemetry injection
- [x] Lore page linkage and awareness
- [x] Mood card module on test page
- [x] Toggle system stubbed (stealth/verbose/emoji)
- [ ] Aura-driven theming on UI pages
- [ ] Gemini model support (optional fallback)
- [ ] Mood-based page overlays
- [ ] Mood influence tracking refinement

### 🔮 Phase 3 (Future)
- [ ] Mood history timeline / drift archive
- [ ] Mood volatility chart / fluctuation heatmap
- [ ] Persona sync with dreams, prompts, quotes
- [ ] Mood search and tag system for Lore
- [ ] User feedback influencing mood via front end

---

## 📝 Last Update
**April 19, 2025** — Full Hugging Face integration deployed. Mood card module live. Dynamic JSON generation stable. Lore system connected. Pivoting to image generation; mood theming deferred.
