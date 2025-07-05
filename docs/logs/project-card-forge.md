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

## 🚀 Quickstart

- **To run locally:** Open `lab/card-forge/index.html` with a local web server (e.g., VS Code Live Server, Python's `http.server`, or `npx serve`).
- **To test the gallery:** Open the browser console and run `CardForgeTests.runAll()` to check both signed-in and signed-out experiences. Use `CardForgeTests.testLoadGallery()` or `CardForgeTests.testLoadPersonalLibrary()` for targeted tests.
- **API requirements:** Ensure Azure Blob Storage is set up and `AZURE_STORAGE_CONNECTION_STRING` is configured in your environment for API endpoints to work.
- **Authentication:** Ambient Pixels authentication scripts must be loaded (see `/auth/authUI.js`).
- **Endpoints:** (Updated July 4, 2025)
  - `/api/cardforge/cards` — public gallery (GET)
  - `/api/cardforge/mycards` — personal library (GET, authenticated)
  - `/api/cardforge/cardpublish/:id` — publish card (POST, authenticated)
  - `/api/cardforge/loadcards` — load user cards (GET)
  - `/api/cardforge/savecards` — save user cards (POST)
  - `/api/cardforge/gallery` — gallery view (GET)

---

## 🐛 Known Issues & API Debugging (2025-07-01 Update)

### API Deployment Status
- 404 errors observed for `/api/cards` endpoint on both production and Azure domains
- Authentication works for `/api/myCards` (returns 401 when not authenticated)
- CORS issues identified between ambientpixels.ai and Azure Static Web Apps domain

### Debugging Steps Taken
- Created new `/api/debug` endpoint to check environment variables and connection strings
- Enhanced `/api/cards` endpoint with explicit CORS headers and OPTIONS request handling
- Improved error logging for Azure Storage connection string validation
- Added response headers for cross-domain access

### API Structure
- Azure Static Web Apps doesn't require function.json files (unlike standard Azure Functions)
- CORS configuration exists in both host.json and can be added to individual API responses
- Connection string validation shows environment variables are properly set

### Open Issues
- Some API endpoints require Azure credentials and may not work offline or without correct environment variables
- User profile avatars and display names in the gallery require `user-profiles.json` to be populated in Blob Storage
- If a user signs out while editing a card, unsaved changes may be lost
- Activity feed, advanced social features, and card remixing are planned for future phases

### Next Steps (2025-07-02)
- Test `/api/debug` endpoint after GitHub Actions deployment completes
- Check if Azure Storage container "cardforge" exists and is accessible
- Verify published-cards.json is properly initialized in the container
- Review GitHub Actions logs for deployment errors
- Test direct API access via browser to isolate CORS vs endpoint issues

## 🔄 Latest Debug Progress (2025-07-04 Update)

### API Structure Migration (July 4, 2025)
- ✅ Complete API restructuring to standardize naming and improve maintainability
- ✅ All CardForge API endpoints now consolidated under `/api/cardforge/` parent folder
- ✅ Standardized all API folder names to lowercase for Azure compatibility
- ✅ Fixed publish endpoint issues by replacing problematic "publish" folder with "cardpublish"
- ✅ Updated all frontend references and staticwebapp.config.json to use new API paths
- ✅ Removed unused test files and legacy code to clean up codebase
- ✅ Full code review performed to ensure all paths and references are updated

### Fixed Issues (July 3, 2025)
- ✅ Card replacement bug has been fixed - new cards now correctly persist and don't replace existing cards
- ✅ Card saving to cloud storage is working properly (both automatic saves and manual "Save to My Account")
- ✅ Loading cards from cloud storage works correctly
- ✅ Frontend auth state detection is working correctly (signed-in state is properly detected)
- ✅ CardForgeAuth global object is now properly exposed and accessible from all modules
- ✅ User ID propagation from session storage to auth system is functioning correctly
- ✅ Login redirect now correctly preserves the current page instead of always redirecting to home

### Remaining Issues
- ❌ 401 Unauthorized error still occurs when attempting to publish cards to the gallery
- The publish API endpoint (`/api/cards/publish/:id`) is receiving the request but returning 401
- Frontend properly sends user ID in both header (`X-User-ID`) and request body
- Full card data is now included in the request body

### Latest Debugging Steps
- Enhanced error logging for publishing flow in both frontend and backend
- Modified publishCardToGallery function to include full card data in the request
- Ensured case-sensitivity of headers matches backend expectations (`X-User-ID`)
- Verified user ID is correctly extracted from CardForgeAuth
- Console logs show correct auth state and user ID before sending publish request

### Next Debug Steps
- Investigate backend API authentication handling for the publish endpoint
- Check if the publish API endpoint is correctly validating the user ID
- Verify that the `/api/cards/publish/:id` function is properly deployed
- Add more detailed logging to the backend function for the publish endpoint
- Consider investigating any environment variable issues specific to the publish function

### API Function Status (Updated July 4, 2025)
| Endpoint | Status | Notes |
|----------|--------|-------|
| `/api/cardforge/cards` | ✅ Working | Public gallery endpoint - Returns empty array initially |
| `/api/cardforge/mycards` | ✅ Working | Personal library - Requires authentication (401 when unauthenticated) |
| `/api/cardforge/savecards` | ✅ Working | Saves cards to blob storage |
| `/api/cardforge/loadcards` | ✅ Working | Loads cards from blob storage |
| `/api/cardforge/cardpublish` | ✅ Working | Publishes cards to gallery |
| `/api/cardforge/gallery` | ✅ Working | Gallery view endpoint |
| `/api/debug` | ✅ Working | Diagnostic endpoint for blob storage access (legacy)

### CardForge API Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                   Client Browser                    │
└───────────────────────────┬─────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────┐
│               Azure Static Web Apps                 │
│                                                     │
│   ┌─────────────────┐         ┌─────────────────┐   │
│   │  Authentication │◄────────┤   Frontend JS   │   │
│   └────────┬────────┘         └─────────────────┘   │
│            │                                        │
│            ▼                                        │
│   ┌─────────────────────────────────────────────┐   │
│   │              /api/cardforge/                │   │
│   │                                             │   │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  │   │
│   │  │ loadcards│  │savecards │  │  cards   │  │   │
│   │  └────┬─────┘  └─────┬────┘  └────┬─────┘  │   │
│   │       │             │             │        │   │
│   │       │             │             │        │   │
│   │  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐  │   │
│   │  │  mycards │  │cardpublish│  │ gallery  │  │   │
│   │  └──────────┘  └──────────┘  └──────────┘  │   │
│   └─────────────────────┬───────────────────────┘   │
│                         │                           │
└─────────────────────────┼───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                Azure Blob Storage                   │
│                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────┐  │
│  │  User Cards  │   │Published Cards│   │User Data│  │
│  └──────────────┘   └──────────────┘   └─────────┘  │
└─────────────────────────────────────────────────────┘
```

#### Endpoint Relationships:
- **loadcards**: Retrieves user's cards from blob storage
- **savecards**: Saves user's cards to blob storage
- **cards**: Public gallery API to fetch all published cards
- **mycards**: Personal library - requires authentication
- **cardpublish**: Updates card status to published
- **gallery**: Provides gallery view with filtering options

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
|------------------|-------------------------------------------------------|--------|
| **Frontend**     | HTML + CSS + JS *(written by Cascade)*               | Modular UI rendering, animations, card logic |
| **Rendering**    | CSS Grid + JS + `html2canvas` *(planned)*            | Live layout and future image export |
| **Data Layer**   | JSON (`rpg-avatar-cards.json`)                       | Defines card structure, stats, and metadata |
| **Avatar Editor**| Manual upload *(Cropper.js or Avatar Studio planned)*| Image cropping and avatar placement |
| **Dev Agent**    | Cascade (Windsurf AI)                                | Code generation + style logic |
| **Deployment**   | GitHub + Azure CI/CD                                 | Auto-deploy updates from main/dev branches |
| **Backend**      | Azure Functions (JavaScript)                         | API endpoints for data storage and retrieval |
| **Storage**      | Azure Blob Storage                                   | Card data persistence and gallery management |
| **Authentication**| Azure Static Web Apps authentication                | User identity and access control |
| **Optional AI**  | Nova / OpenAI / Hugging Face *(future)*             | Will support stat generation, names, lore, etc. |

### Azure Infrastructure Setup

#### Azure Static Web Apps
- **Resource Type**: Azure Static Web Apps
- **URL**: https://ambientpixels.ai/
- **Authentication**: Managed by Azure Static Web Apps
- **Managed Identity**: System-assigned managed identity enabled
- **Deployment**: Integrated GitHub Actions workflow

#### Azure Functions
- **Hosting**: Integrated with Azure Static Web Apps
- **Runtime**: Node.js v16
- **Deployment**: Part of Static Web Apps GitHub Actions workflow
- **Configuration**: 
  - `AZURE_STORAGE_CONNECTION_STRING`: Points to `cardforgeblobdata` storage account
  - `WEBSITE_RUN_FROM_PACKAGE=1`: Set for inline ZIP deployment

#### Azure Blob Storage
- **Storage Account**: cardforgeblobdata
- **Container**: cardforge
- **Key Files**:
  - `published-cards.json`: Public gallery cards (schema: `{cards: [], metadata: {...}}`)
  - `user-profiles.json`: User profile data
  - `user/<userId>/cards.json`: Individual user card collections

#### Identity & Permissions
- **Authentication**: Azure Static Web Apps built-in auth
- **Storage Access**: System-assigned managed identity with roles:
  - Storage Blob Data Reader: Read access to blob container
  - Storage Blob Data Contributor: Write access to blob container

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

---

## 🔄 CardForge 2025 Rebuild Project

> *"Building the future of digital identity cards."*

### Project Status
- **Current Phase**: Complete rebuild from ground up (July 2025)
- **Previous Status**: Legacy system retired due to structural issues
- **Goal**: Create a modular, maintainable system with next-generation features

### 🚀 Next-Level Features

#### AI Integration
- **Nova-Powered Themes**: Mood-reactive card styling using Nova's emotional synthesis
- **AI-Generated Content**: Character backstories and power descriptions
- **Style Transfer**: Transform user photos into themed avatar styles

#### Enhanced Interaction
- **Dynamic Animations**: Interactive cards with hover/click effects
- **3D Cards**: CSS-based 3D rotation and perspective
- **Progressive Reveal**: Staged disclosure of card details

#### Collections & Teams
- **Deck Building**: Group cards into themed collections
- **Team Libraries**: Shared card access for organizations
- **Collaborative Creation**: Multi-user card design

#### Social & Community
- **Card Battles**: Competitive card interaction system
- **Community Gallery**: Enhanced voting, comments, and sharing
- **Social Integration**: Direct posting to social platforms

#### Advanced Customization
- **Custom Templates**: User-definable card layouts and structures
- **Animation Editor**: Custom effect creation
- **Theme Designer**: Color palette and style customization

#### Publishing & Export
- **Embeddable Cards**: Website widgets and embeds
- **QR Integration**: Physical-to-digital card linking
- **Enhanced Export**: Print-ready and animated formats

#### Gamification
- **Creator Achievements**: Recognition for creative milestones
- **Seasonal Events**: Themed contests and limited editions
- **Progression System**: Unlockable features and templates

#### Collaboration Tools
- **Real-Time Co-Editing**: Simultaneous card creation
- **Version History**: Card evolution tracking
- **Activity Notifications**: Team updates and changes

#### Modern Web Features
- **Progressive Web App**: Offline capabilities
- **Background Sync**: Reliable data persistence
- **Mobile-First Design**: Responsive across all devices

### 🏗️ Architecture Priorities

1. **Modularity & Maintainability**
   - Clear separation of concerns
   - Reusable component architecture
   - Consistent coding patterns

2. **Security & Authentication**
   - Robust session management
   - Proper authorization checks
   - Secure data handling

3. **Nova/Windsurf Alignment**
   - Adherence to style conventions
   - Integration with ambient mood system
   - Following Windsurf development protocol

4. **Performance Optimization**
   - Efficient rendering pipelines
   - Strategic caching
   - Lazy loading and progressive enhancement

### 🔍 Additional Considerations

- **Accessibility**: WCAG compliance and inclusive design
- **Scalability**: Support for large card collections and user bases
- **Testing**: Comprehensive unit and integration tests
- **Documentation**: Clear developer and user guides
| `/lab/card-forge/card-forge-gallery.js`| Gallery display and filtering        |
| `/api/cardforge/savecards/index.js`    | API endpoint for saving cards        |
| `/api/cardforge/loadcards/index.js`    | API endpoint for loading cards       |
| `/api/cardforge/cards/index.js`        | API endpoint for gallery cards       |
| `/api/cardforge/cardpublish/index.js`  | API endpoint for publishing cards    |
| `/api/cardforge/mycards/index.js`      | API endpoint for user cards          |
| `/card-forge-dev/`                     | Local dev folder for isolated testing|
| `/docs/logs/project-card-forge.html`   | Log page for project documentation   |

---
