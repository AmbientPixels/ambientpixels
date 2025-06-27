# 🃏 RPG Identity Card Studio – Project Kickoff

> *"Everyone’s the hero of their own card."*

---

## 📌 Project Summary

The RPG Identity Card Studio is a creative web app that allows users to design, personalize, and share collectible RPG-style character cards. Originally inspired by internal team cards, this expanded platform supports a broader audience including gamers, creators, teams, and fandoms.

Each card is a stylized identity snapshot—featuring name, class, avatar, stats, powers, achievements, and quotes—rendered in a modular, shareable format.

The system is powered by **Cascade** (the AI agent in Windsurf) and supported by **Nova** (an ambient emotional synthesis AI) for future creative integrations.

---

## 🎯 Goals

- Create a flexible UI to generate and render custom RPG identity cards
- Enable embeddable, downloadable, and social-sharing outputs
- Support multiple visual themes (fantasy, sci-fi, professional, pixel, etc.)
- Allow use cases ranging from team recognition to creative portfolios
- Build a future-friendly system ready for decks, remixing, and AI-assisted generation

---

## 🧩 Core Features

### ✅ Card System (Live)
- JSON-driven rendering (`rpg-avatar-cards.json`)
- Responsive grid layout with adjustable column layout
- Modular, stylized card engine with:
  - Flip animation
  - Stat bars
  - Badge icons
  - Quotes, avatars, themes
- Role-based badge logic and animated theming (legendary, epic, rare, etc.)

### ✅ Dev Environment (Complete)
- Local dev sandbox: `card-forge-dev/`
- Manual HTML/CSS/JS components (via Cascade-generated code)
- Live reload via local server or VS Code
- Git-safe isolation from production branch

---

## 🎨 Output Options (Planned)

- Export as PNG (using `html2canvas`)
- Save/load card JSON files
- Embed-ready iframe or script snippets
- Shareable hosted card URL (static or via Gist)

---

## 🧱 Templates & Themes (Live + Planned)

- ✅ Legendary / Epic / Rare
- 🟡 Pixel Pack (retro)
- 🟡 Sci-Fi HUD
- 🟡 Tarot / Arcana
- 🟡 Corporate RPG
- 🟡 UX Pro (minimalist)
- 🔲 Mood-reactive cards (powered by Nova)

---

## 🛠️ Tech Stack

| Layer            | Tool/Tech                                             | Purpose |
|------------------|-------------------------------------------------------|---------|
| **Frontend**     | HTML + CSS + JS *(written by Cascade)*               | Modular UI rendering, animations, card logic |
| **Rendering**    | CSS Grid + JS + `html2canvas` *(planned)*            | Live layout and future image export |
| **Data Layer**   | JSON (`rpg-avatar-cards.json`)                       | Defines card structure, stats, and metadata |
| **Avatar Editor**| Manual upload *(Cropper.js or Avatar Studio planned)*| Image cropping and avatar placement |
| **Dev Agent**    | Cascade (Windsurf AI)                                | Code generation + style logic |
| **Deployment**   | GitHub + Azure CI/CD                                 | Auto-deploy updates from main/dev branches |
| **Optional AI**  | Nova / OpenAI / Hugging Face *(future)*             | Will support stat generation, names, lore, etc. |

---

## 🚀 MVP Scope (Phase 1)

| Feature                         | Status      |
|----------------------------------|-------------|
| Static card rendering from JSON | ✅ Complete |
| Flip animation + stats          | ✅ Complete |
| Local dev sandbox               | ✅ Complete |
| Avatar image loader             | ✅ Complete |
| Theming system (rare, epic, etc)| ✅ Complete |
| PNG export                      | ⬜ Planned   |
| Card builder UI                 | ⬜ Planned   |
| JSON save/load toggle           | ⬜ Planned   |

---

## 📝 Progress Update (2025-06-26)

- **Azure Function Save Integration:** ✅ Card Forge now saves card data to Azure Blob Storage via `/api/saveCardData`.
- **Asset Loading Fixed:** ✅ All Card Forge assets use absolute paths, resolving 404/MIME errors on custom domains.
- **Backend Debugging:** ✅ 500 error resolved by:
  - Setting `api_location` in Azure Static Web Apps workflow
  - Ensuring `/api/package.json` exists and removing `"type": "module"` for CommonJS compatibility
  - Adding detailed error logging (stack trace in dev only)
- **Connection String Checks:** ✅ Ensured `AZURE_STORAGE_CONNECTION_STRING` is set in Azure portal
- **Blob Container:** ✅ `cardforge` container created automatically if missing
- **Frontend Save Flow:** ✅ UI now receives 200 success on save; backend errors return detailed stack trace for debugging

**Next Steps:**
- [ ] Restore button and form event handlers (Add, Remove, Import, Export, Save, Reset, Flip)
- [ ] Fix tab switching logic (Front/Back)
- [ ] Ensure all form fields update preview and card data
- [ ] Restore card list interactivity and persistent storage
- [ ] Add user feedback and error handling
- [ ] Update documentation and project JSON as features are restored

---

## 🧭 Reference Sheet (for future dev sessions)

### Architecture & Key Files
- **Frontend:** `/lab/card-forge/index.html`, `card-forge.js`, `card-forge.css`, `card-forge-editor.js`
- **Data:** `/lab/card-forge/card-forge.json` (card data), `/data/rpg-avatar-cards.json` (main deck)
- **Backend:** `/api/saveCardData/index.js` (Azure Function, CommonJS, saves JSON to Blob Storage)

---

### 🛠️ UI Tweaks & Next Steps (2025-06-26)

- Further UI refinement is needed for Card Forge preview and editor.
- Goals:
  - Polish spacing, padding, and card alignment for a more balanced look.
  - Ensure card preview and grid cards scale smoothly across device sizes.
  - Review badge/tag color usage to strictly reuse existing classes for visual consistency.
  - Audit for any remaining redundant or conflicting CSS rules.
  - Test 3D flip and interactive elements for accessibility and responsiveness.

**Next Actions:**
- [ ] Adjust card and preview container padding/margins for optimal balance.
- [ ] Review mobile breakpoints and scaling.
- [ ] Fine-tune badge/tag styling to match Nova/utility classes.
- [ ] Clean up any legacy or duplicate CSS.
- [ ] Continue documenting all visual and functional changes.

---
- **API Config:** `/api/package.json` (must have `@azure/storage-blob` dep, no `type: module`)
- **CI/CD:** `.github/workflows/azure-static-web-apps-*.yml` (must set `api_location: "api"`)
- **Logs/Docs:** `/docs/logs/project-card-forge.me` (this file), `/docs/project-card-forge.html` (feature/tech doc)

### Onboarding & Dev Handoff Reference

For onboarding, troubleshooting, and contribution protocols, see [`project-card-forge.html`](../project-card-forge.html).

**This `.me` file is your living session log:**
- Use it for real-time blockers, breakthroughs, TODOs, and session handoff notes.
- Fill out the handoff template at the end of each session.
- Summarize what changed, what’s next, and any open issues.

Keep this log focused on session continuity and dev communication. All canonical onboarding and contribution steps live in the HTML doc.

---

## 🔮 Future Features (Phase 2+)

- AI-generated cards from prompts or traits
- Drag-and-drop builder for non-devs
- Deck creation (grouped cards)
- Trade mechanic or remix mode
- Animated intros / reveal FX
- Lore-based filters (by power, origin, alignment)
- “Remix this card” / clone-and-customize

---

## 🔐 Access & Collaboration

- All card data is editable via `rpg-avatar-cards.json`
- Dev changes are tested in `card-forge-dev/` before production deploy
- GitHub Actions + Azure handle deployment automatically
- Cascade (Windsurf AI) generates production-ready CSS and rendering logic
- Nova is available for experimental AI assistance (quote generation, mood-driven stats)

---

## 📁 Key Files

| Path                                 | Description                          |
|--------------------------------------|--------------------------------------|
| `/data/rpg-avatar-cards.json`        | Full list of all card data           |
| `/js/card-render.js`                 | Rendering engine (Cascade-generated) |
| `/css/card-styles.css`               | Full style system for card visuals   |
| `/card-forge-dev/`                   | Local dev folder for isolated testing|
| `/docs/logs/project-card-forge.html` | Log page for project documentation   |

---

