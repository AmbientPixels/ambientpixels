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
- Build a community gallery of user-created cards with attribution
- Provide distinct signed-in and signed-out experiences
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

### ✅ Card Gallery (Implemented)
- Public gallery of user-created cards for inspiration
- Card attribution to creators (username and avatar display)
- Category filtering and discovery tools (filter by category, sort by newest/popular)
- Different experiences for signed-in vs. signed-out users (gallery for anonymous, personal library for authenticated)
- Social features including card publishing and favorites
- Responsive grid layout with card previews

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
- **Azure save errors:** Check `AZURE_STORAGE_CONNECTION_STRING` and `/api/package.json` dependencies. Verify Azure Blob Storage container 'cardforge' exists at https://cardforgeblobdata.blob.core.windows.net/cardforge.
- **API 404 errors:** The `/api/loadCardData` endpoint may not be deployed to production yet. Try using POST method instead of GET for this endpoint. The client will fall back to localStorage if the API is unavailable.
- **Authentication detection:** If user info is not stored in session storage, the cloud storage service uses persistent browser fingerprinting IDs to ensure authenticated users can still save/load cards. Check browser console logs for detailed authentication state information.
- **Card not rendering:** Validate your JSON structure in `card-forge.json` or `rpg-avatar-cards.json`.
- **CSS/Theme issues:** Ensure you're reusing existing badge/tag classes to avoid conflicts.
- **Gallery vs. Library:** The gallery displays public cards while the library contains private user cards. Different components appear based on authentication state.

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

## 🆕 Card Forge + Ambient Pixels Integration

> Implementation complete: Phase 1 (Authentication UI) and Phase 2 (Cloud Save/Load) finished. Phase 3 (Enhanced Features) in planning.

### ✅ Phase 1: Authentication UI (Completed June 30, 2025)

- **Auth-Aware Interface:** Conditional UI that changes based on authentication state
- **Sign-In Prompt:** Clean prompt for unauthenticated users explaining benefits of Ambient Pixels account
- **My Cards Dashboard:** Dashboard UI for authenticated users showing stats and personal collection
- **User Identity:** Display user's name from Ambient Pixels account in the Card Forge UI
- **Action Buttons:** Placeholder buttons for cloud save/load functionality

### ✅ Phase 2: Cloud Storage (Completed June 30, 2025)

- **Cloud Save/Load:** Implemented production cloud storage service with authenticated API endpoints
- **User-Specific Storage:** Cards are saved with user ID to isolate data per user
- **Unified Card Management:** Refactored "Your Cards" section to become auth-aware "My Cards"
- **Card Stats:** Added card count tracking for personal and shared cards
- **Loading States:** Added loading indicators and error handling for cloud operations
- **API Integration:** Connected to `/api/saveCardData` and `/api/loadCardData` endpoints with authentication
- **Fallback Mechanism:** Added localStorage fallback if API calls fail
- **Clear UI Distinction:** Enhanced UI to clearly differentiate between local "Card Library" and cloud "My Cards"
- **Improved Button States:** Updated button labels and states to reflect available actions in each auth state

### ✅ Phase 3: Enhanced Features (Implemented)

- **User-Specific Card Decks:** Authenticated users now have their own private/public card sets. "My Card Collection" dashboard for managing creations. Public/private publishing options.
- **Save/Load to Cloud:** Cards save to Ambient Pixels cloud storage. Removed localStorage fallback for simplified data flow.
- **Profile Avatars & Identity:** User profiles and avatars included with card attribution. Display names shown on published cards.
- **Social & Collaboration:** Cards can be viewed in the public gallery with proper attribution to creators.
- **Card Ownership & Attribution:** Shows "Created by [username]" and tracks publishing status. Published cards maintain creator info.
- **Access Control:** Advanced features restricted to authenticated users. Publishing requires authentication.
- **Seamless Onboarding:** Sign-in prompts at strategic locations throughout the UI to encourage authentication.
- **Activity Feed/History:** User's personal library shows published/draft status of their cards.

---

## 🔐 Access & Collaboration

- All card data is editable via `rpg-avatar-cards.json`
- Dev changes are tested in `card-forge-dev/` before production deploy
- GitHub Actions + Azure handle deployment automatically
- Cascade (Windsurf AI) generates production-ready CSS and rendering logic
- Nova is available for experimental AI assistance (quote generation, mood-driven stats)

---

## 🌥️ Cloud Storage Integration Details

### Azure Blob Storage Configuration

- **Container Name:** `cardforge`
- **Blob Storage URL:** `https://cardforgeblobdata.blob.core.windows.net/cardforge`
- **Blob File Name:** `card-forge.json` (stores user card data)
- **Environment Variable:** `AZURE_STORAGE_CONNECTION_STRING` (required for API access)
- **Authentication:** User ID passed via `X-User-ID` header
- **Encryption:** Account-encryption-key enabled

### API Endpoints

#### Save Card Data
- **Endpoint:** `/api/saveCardData`
- **Method:** POST
- **Headers:** 
  - `Content-Type: application/json`
  - `X-User-ID: [user-id]`
- **Body:** JSON array of card objects
- **Response:** Success/error message
- **Implementation:** Azure Function using Blob Storage SDK

#### Load Card Data
- **Endpoint:** `/api/loadCardData`
- **Method:** GET/POST
- **Headers:** `X-User-ID: [user-id]`
- **Query Params:** `userId=[user-id]` (if using GET)
- **Body:** `{"userId": "[user-id]"}` (if using POST)
- **Response:** JSON array of card objects
- **Implementation:** Azure Function using Blob Storage SDK

#### Gallery Cards (Implemented)
- **Endpoint:** `/api/cards`
- **Method:** GET
- **Query Params:** `category=[category]`, `sort=[newest|popular|staff-picks]`, `limit=[number]`, `page=[number]` 
- **Response:** JSON object with cards array and pagination metadata
- **Implementation:** Azure Function using Blob Storage SDK, includes creator attribution

#### User Cards (Implemented)
- **Endpoint:** `/api/myCards`
- **Method:** GET
- **Headers:** `X-User-ID: [user-id]`
- **Query Params:** `filter=[all|published|drafts]`, `sort=[newest|oldest|az]`, `page=[number]`, `limit=[number]`
- **Response:** JSON object with cards array and pagination metadata
- **Implementation:** Azure Function with authentication check

#### Publish Card (Implemented)
- **Endpoint:** `/api/cards/publish/:id`
- **Method:** POST
- **Headers:** `X-User-ID: [user-id]`
- **Response:** JSON with published card details and success message
- **Implementation:** Adds card to public gallery with creator attribution

### Client Integration

- **Authentication Check:** `getUserId()` function verifies user is signed in
- **Error Handling:** Detailed error logging in `card-forge-cloud.js`
- **Authentication-Driven UI:** Dynamic UI elements based on signed-in state
- **Card Metadata:** Adds user ID, creator name, and timestamps to saved cards

### User Experience

#### Signed-Out Experience
- Access to card editor with all design features
- View public gallery of community-created cards
- Can create cards but cannot save to cloud
- Authentication prompts to save creations

#### Signed-In Experience
- Full card editor functionality
- Private card library for personal creations
- Options to publish cards to public gallery
- Additional customization features

## 📁 Key Files

| Path                                   | Description                          |
|----------------------------------------|---------------------------------------|
| `/data/rpg-avatar-cards.json`          | Full list of all card data           |
| `/js/card-render.js`                   | Rendering engine (Cascade-generated) |
| `/css/card-styles.css`                 | Full style system for card visuals   |
| `/lab/card-forge/card-forge-cloud.js`  | Cloud storage service for user cards |
| `/lab/card-forge/card-forge-auth.js`   | Authentication integration           |
| `/lab/card-forge/card-forge-gallery.js`| Gallery display and filtering (planned)|
| `/api/saveCardData/index.js`           | API endpoint for saving cards        |
| `/api/loadCardData/index.js`           | API endpoint for loading cards       |
| `/api/cards/index.js`                  | API endpoint for gallery cards (planned)|
| `/api/myCards/index.js`                | API endpoint for user cards (planned) |
| `/card-forge-dev/`                     | Local dev folder for isolated testing|
| `/docs/logs/project-card-forge.html`   | Log page for project documentation   |

---
