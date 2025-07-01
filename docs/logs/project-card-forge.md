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

## 🚦 Quickstart

1. **Clone the Repo**
   ```sh
   git clone https://github.com/your-org/ambientpixels.git
   cd ambientpixels/EchoGrid/lab/card-forge-dev
   ```
2. **Open the Dev Sandbox**
   - Open `index.html` in your browser, or use VS Code Live Server for hot reload.
   - All development happens in `/lab/card-forge/` (HTML/CSS/JS).
3. **Edit & Preview**
   - Modify `card-forge.js`, `card-forge.css`, or `card-forge-editor.js`.
   - Card data: edit `/lab/card-forge/card-forge.json` or `/data/rpg-avatar-cards.json`.
4. **Commit Workflow**
   - Work in a feature branch.
   - PRs should target the `dev` branch.
   - Use session logs in `/docs/logs/` for handoff notes.

---

## 🗺️ Codebase Map

| Path/Folder                        | Purpose                                      |
|------------------------------------|----------------------------------------------|
| `/lab/card-forge/index.html`       | Main entry point for Card Forge UI           |
| `/lab/card-forge/card-forge.js`    | Core card rendering logic                    |
| `/lab/card-forge/card-forge.css`   | All card styling and themes                  |
| `/lab/card-forge/card-forge-editor.js` | Card builder/editor UI logic             |
| `/lab/card-forge/card-forge.json`  | Example card data for dev/testing            |
| `/data/rpg-avatar-cards.json`      | Main deck of cards (JSON-driven)             |
| `/api/saveCardData/index.js`       | Azure Function for saving cards (backend)    |
| `/docs/project-card-forge.html`    | Canonical onboarding, contribution, and tech doc |
| `/docs/logs/project-card-forge.md` | Session log, TODOs, handoff notes            |

---

## 🤝 Contribution Guide

- **Branches:** Work in feature branches, PR to `dev`.
- **Commits:** Use clear, descriptive messages.
- **Session Logs:** Update `/docs/logs/project-card-forge.md` with blockers, breakthroughs, and TODOs.
- **Onboarding:** See `/docs/project-card-forge.html` for full protocols.
- **Code Style:** Follow existing patterns in JS/CSS; reuse utility classes for badges/tags.
- **Review:** All PRs require at least one review before merge.

---

## 🖼️ Visuals

- Add screenshots or GIFs of the UI/card editor to this doc or `/docs/project-card-forge.html` for instant visual context.
- Example:  
  `![Card Forge UI Screenshot](../assets/card-forge-ui.png)`

---

## 🛠️ Troubleshooting / Known Issues

- **Dev server not updating:** Try hard-refresh or restart Live Server.
- **Azure save errors:** Check `AZURE_STORAGE_CONNECTION_STRING` and `/api/package.json` dependencies.
- **Card not rendering:** Validate your JSON structure in `card-forge.json` or `rpg-avatar-cards.json`.
- **CSS/Theme issues:** Ensure you’re reusing existing badge/tag classes to avoid conflicts.

---

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

## 🆕 Card Forge + Azure AD B2C Integration (Planned)

> These features will guide the next phase of Card Forge development with authentication and user accounts.

- **User-Specific Card Decks:** Authenticated users can have their own private/public card sets. "My Cards" dashboard for managing creations. Public/private/shareable options.
- **Save/Load to Cloud:** Save card decks to Azure Blob Storage or user-specific cloud. "Save to My Account" and "Load My Cards" for signed-in users.
- **Profile Avatars & Identity:** Pull user info from Azure AD (name, avatar, email) to pre-fill cards and personalize UI. "Create Card from My Profile" quick action.
- **Social & Collaboration:** Allow remixing cards by others, with attribution. Enable commenting, likes, or sharing (future community features).
- **Card Ownership & Attribution:** Show "Created by [username]" and track edits/versions. Add badges for authenticated users.
- **Access Control:** Restrict advanced features to authenticated users. Admin/special roles can moderate or feature cards.
- **Seamless Onboarding:** Prompt sign-in to unlock full features. Onboarding modal explaining benefits of signing in.
- **Activity Feed/History:** Show recent edits, creations, or remix activity for each user.

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

