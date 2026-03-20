# Project improvement tasks

## Status
AmbientPixels is a live Azure Static Web App (162 HTML pages, 115 API functions, 8 AI agents) with no test suite and one build script. Build passes, no tests exist.

## Done
(empty — nothing done yet)

## Next up (do these in order)
1. Replace weak `Math.random()` UUID generation with `crypto.randomUUID()` in `api/actionsExecute/index.js`, `api/actionsExecute/executors/content/publishDocument.js`, `api/agentchat/index.js`
2. Wrap unsafe `JSON.parse()` calls with try-catch in `api/actionsExecute/executors/social/linkedin.js`, `api/agentchat/index.js`, `api/as-webhook/index.js`
3. Add missing radix parameter to `parseInt()` calls in `api/azureCosts/index.js`, `api/agentRunCampaign/index.js`, `api/agentCreateContent/index.js`
4. Remove hardcoded mock cost data in `api/azureCosts/index.js` (random day cost generation at line ~25)
5. Convert `var` declarations to `const`/`let` in `api/companyHeartbeat/agent-runner.js`
6. Clean up root-level `tmp-*.js` and `tmp_*.json` scratch files (15+ files)
7. Add explicit `return` after `context.res` assignments in API functions (`api/formIntake/index.js` — 14+ instances)

## Backlog
- Standardize logging (console.log vs console.error vs console.warn) across API functions
- Replace `.split('T')[0]` date patterns with a shared `getDateOnly()` helper
- Audit HTML files for missing meta charset/viewport/description tags
- Deduplicate CSS selectors in `css/nova.css`
- Convert TODO/FIXME comments to GitHub issues and remove from code
- Add a basic smoke-test script that validates each API function's `function.json` is parseable
- Centralize hardcoded config values (allowed origins, breakpoints) into a shared constants file
